-- #942 step 3: every team access check finds the caller through their person.
--
-- Until now "who is this member" was answered by the membership's own copies
-- of the account and the Discord id: my_team_role() matched
-- team_members.auth_user_id to auth.uid(), resolve_person() matched
-- team_members.discord_id, and so on through the functions below. Steps 1 and
-- 2 (20260914221328_people_table.sql, 20260915092357_guild_grants.sql) gave
-- every membership a person and moved the guild-wide grants onto it. This step
-- moves every remaining reader, so at cutover (#1105, step 6) the membership's
-- two copies can be dropped with nothing left reading them.
--
-- Nobody's access changes. Before anything moves, this checks that every
-- membership's account and Discord id are its person's; then a trigger keeps
-- them so. The copies stay only for the current site, which still filters its
-- own memberships by auth_user_id (js/common.js, js/discord.js) and writes
-- nothing but the role.
--
-- One real change, stated so nobody reads it as an accident: a membership's
-- auth_user_id can no longer be written by hand. A team leader could previously
-- set it on a row in their team, binding the membership to any account; the
-- trigger now replaces whatever is written with the person's account.
--
-- Not in this step: season_signups.auth_user_id is the signup's own record of
-- who submitted it, not a membership copy, and stays. account_preferences and
-- notifications move onto the person in step 4. The Edge Functions and the bot
-- still read team_members.discord_id through the service role, which the
-- trigger keeps correct; they move when step 6 drops the column.

-- 1. The copies agree with the person today. Stop rather than change access.
do $$
declare
  v_bad text;
begin
  select string_agg(format('team_members id %s', tm.id), ', ') into v_bad
    from public.team_members tm
    join public.people p on p.id = tm.person_id
   where tm.auth_user_id is distinct from p.auth_user_id
      or tm.discord_id is distinct from p.discord_id;
  if v_bad is not null then
    raise exception 'Memberships whose account or Discord id is not their person''s: %', v_bad;
  end if;
end $$;

-- 2. The caller's person. Security definer so a rule can use it without
-- reading people under the caller's own rules.
create or replace function public.my_person_id() returns integer
language sql stable security definer set search_path to 'public'
as $$ select id from people where auth_user_id = auth.uid(); $$;

revoke all on function public.my_person_id() from public;
grant execute on function public.my_person_id() to anon, authenticated;

create index if not exists team_members_person_id_idx on public.team_members (person_id);

-- 3. The membership's account is its person's, always.
--
-- On the membership: whatever is written, the account comes from the person
-- the Discord id names. On the person: when the account changes (a first
-- sign-in, a discarded account), every membership follows. Together they are
-- why the checks below may read the person and the current site may keep
-- reading the copy.
create or replace function public.set_person_from_discord_id() returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  new.person_id := person_for_discord_id(new.discord_id);
  -- Joined to auth.users so that deleting an account works: the foreign key
  -- nulls this row's copy before it nulls the person's, and copying the
  -- person's not-yet-nulled account back would name a deleted account.
  new.auth_user_id := (
    select u.id from people p join auth.users u on u.id = p.auth_user_id where p.id = new.person_id
  );
  return new;
end;
$$;

create or replace function public.copy_person_account_to_members() returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  update team_members
     set auth_user_id = new.auth_user_id
   where person_id = new.id
     and auth_user_id is distinct from new.auth_user_id;
  return null;
end;
$$;

revoke all on function public.copy_person_account_to_members() from public, anon, authenticated;

create trigger people_copy_account_to_members
  after update of auth_user_id on public.people
  for each row
  when (old.auth_user_id is distinct from new.auth_user_id)
  execute function public.copy_person_account_to_members();

-- The sign-in trigger attaches the account to the person; the trigger above
-- carries it to the memberships, so its own team_members update goes.
create or replace function public.link_auth_user_to_member()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_listed integer;
  v_own integer;
begin
  select id into v_own from people where auth_user_id = new.user_id;

  -- Only a Discord identity attaches a person listed by Discord id.
  if new.provider is distinct from 'discord' then
    if v_own is null then
      insert into people (auth_user_id) values (new.user_id) on conflict do nothing;
    end if;
    return new;
  end if;

  select id into v_listed from people where discord_id = new.provider_id;

  if v_listed is null and v_own is null then
    insert into people (auth_user_id, discord_id) values (new.user_id, new.provider_id);
  elsif v_listed is null then
    update people set discord_id = new.provider_id where id = v_own and discord_id is null;
  elsif v_own is null then
    update people set auth_user_id = new.user_id where id = v_listed and auth_user_id is null;
  elsif v_listed <> v_own then
    delete from people where id = v_own;
    update people set auth_user_id = new.user_id where id = v_listed and auth_user_id is null;
  end if;

  return new;
end;
$function$;

-- 4. Who reads a person. Their own row, as before; and now whoever reads the
-- membership pointing at it: an officer or team leader of that team, a site
-- admin, a guild officer. They already read its discord_id and auth_user_id
-- copies on team_members, so nothing new is exposed, and the functions that run
-- as the caller (add_signup_to_roster) can join people as they joined the
-- copies. The read-only database role already reads every row.
create policy "Officers read people on their teams" on public.people
  for select using (
    id in (
      select tm.person_id
        from public.team_members tm
       where tm.team_id = any ((select public.my_officer_team_ids())::integer[])
    )
    or (select public.is_site_admin())
    or (select public.is_guild_officer())
  );

-- 5. The team access checks.

create or replace function public.my_team_role(p_team_id integer) returns text
language sql stable security definer set search_path to 'public'
as $$
  select role
  from team_members
  where team_id = p_team_id
    and person_id = my_person_id()
  limit 1;
$$;

create or replace function public.my_officer_team_ids() returns integer[]
language sql stable security definer set search_path to 'public'
as $$
  select coalesce(array_agg(distinct team_id), '{}')
    from team_members
   where person_id = my_person_id()
     and role = any (array['officer', 'team_leader']);
$$;

create or replace function public.my_leader_team_ids() returns integer[]
language sql stable security definer set search_path to 'public'
as $$
  select coalesce(array_agg(distinct team_id), '{}')
    from team_members
   where person_id = my_person_id()
     and role = 'team_leader';
$$;

create or replace function public.my_active_player_ids() returns integer[]
language sql stable security definer set search_path to 'public'
as $$
  select coalesce(array_agg(p.id), '{}')
    from players p
    join team_members tm on tm.id = p.team_member_id
   where tm.person_id = my_person_id()
     and p.archived_at is null;
$$;

create or replace function public.is_own_player(p_player_id integer) returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1
    from players p
    join team_members tm on tm.id = p.team_member_id
    where p.id = p_player_id
      and p.archived_at is null
      and tm.person_id = my_person_id()
  );
$$;

create or replace function public.is_any_team_officer() returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from team_members
    where person_id = my_person_id()
      and role = any (array['officer', 'team_leader'])
  );
$$;

create or replace function public.is_team_leader_anywhere() returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from team_members
    where person_id = my_person_id()
      and role = 'team_leader'
  );
$$;

-- A member reads their own memberships through their person.
drop policy "Members read own team_members" on public.team_members;
create policy "Members read own team_members" on public.team_members
  for select using (person_id = (select public.my_person_id()));

-- 6. claim_character(): the caller's membership on the team is found through
-- their person. A Discord identity is still required, because a membership is
-- listed by Discord id. The old refusal for a row carrying the caller's Discord
-- id but linked to another account is gone with the state itself: the trigger
-- above makes that row impossible to write.
create or replace function public.claim_character(p_team_id integer, p_name_realm text)
returns table(name_realm text, role text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_player_id integer;
  v_member_id integer;
  v_member_role text;
  v_discord_id text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  -- The target character must be an active roster member of this team.
  select p.id into v_player_id
  from public.players p
  where p.team_id = p_team_id
    and p.name_realm = p_name_realm
    and p.archived_at is null;
  if v_player_id is null then
    raise exception 'Character not found on roster';
  end if;

  select tm.id, tm.role into v_member_id, v_member_role
  from public.team_members tm
  where tm.team_id = p_team_id and tm.person_id = public.my_person_id();

  if v_member_id is null then
    v_discord_id := public.current_discord_id();

    if v_discord_id is null then
      raise exception 'This account has no Discord identity to claim a character with';
    end if;

    -- The trigger resolves the person and its account from the Discord id.
    insert into public.team_members (team_id, discord_id, role)
    values (p_team_id, v_discord_id, 'raider')
    returning id into v_member_id;
    v_member_role := 'raider';
  end if;

  -- Never silently take over a character already linked to someone. The guard
  -- rides on the write itself (team_member_id is null) rather than a separate
  -- prior select, so two concurrent claims on the same character cannot both
  -- pass a check and then both write under read-committed isolation: the second
  -- update matches no row and raises.
  update public.players p set team_member_id = v_member_id
  where p.id = v_player_id and p.team_member_id is null;

  if not found then
    raise exception '% is already claimed', p_name_realm;
  end if;

  return query select p_name_realm, v_member_role;
end;
$function$;

-- 7. admin_grant_team_role(): the existing membership is found through the
-- person, and "linked" means the person has an account. The repair branch
-- (same role, account never filled in) is gone: the trigger fills the account
-- on every write, so there is nothing left to repair. A re-grant of the same
-- role is refused like any other re-grant.
create or replace function public.admin_grant_team_role(p_team_id integer, p_discord_id text, p_role text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_team public.teams%rowtype;
  v_existing public.team_members%rowtype;
  v_auth_user_id uuid;
  v_id integer;
begin
  if not (public.is_site_admin() or coalesce(public.my_team_role(p_team_id) = 'team_leader', false)) then
    raise exception 'Not authorized';
  end if;

  if p_role is null or p_role not in ('raider', 'officer', 'team_leader') then
    raise exception 'Role must be one of raider, officer, team_leader';
  end if;

  if p_discord_id is null or btrim(p_discord_id) = '' then
    raise exception 'A Discord id is required';
  end if;

  select * into v_team from public.teams where id = p_team_id;
  if not found then
    raise exception 'No team with id %', p_team_id;
  end if;
  if v_team.archived_at is not null then
    raise exception 'That team is archived';
  end if;

  select * into v_existing
  from public.team_members
  where team_id = p_team_id
    and person_id = (select id from public.people where discord_id = p_discord_id)
  for update;

  if found then
    -- An existing row is never rewritten. `role` drives every team role
    -- helper and a wide slice of the read rules, so overwriting it would let
    -- one mistyped Discord id demote a sitting team leader. Changing a role
    -- stays with the promote path in the officer dashboard.
    if v_existing.role is distinct from p_role then
      raise exception 'That Discord account already has the % role on this team. Change a role through the promote path, not this grant.', v_existing.role;
    end if;
    if v_existing.auth_user_id is null then
      raise exception 'That Discord account already has the % role on this team, and no account exists for it to link to yet.', v_existing.role;
    end if;
    raise exception 'That Discord account already has the % role on this team.', v_existing.role;
  end if;

  insert into public.team_members (team_id, discord_id, role)
  values (p_team_id, p_discord_id, p_role)
  returning id, auth_user_id into v_id, v_auth_user_id;

  perform public.write_audit_log(
    p_team_id, 'team_role_granted', 'team_member', v_id,
    jsonb_build_object('discord_id', p_discord_id, 'role', p_role, 'linked', v_auth_user_id is not null)
  );

  return v_auth_user_id;
end;
$function$;


-- The rest read the membership's person instead of its own copies. Each is
-- today's definition with only that lookup changed.

CREATE OR REPLACE FUNCTION public.resolve_actor_name(p_actor_id uuid, p_team_id integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_member_id integer;
  v_tm_name_realm text;
  v_player_name_realm text;
  v_nickname text;
  v_display text;
begin
  if not (coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  select tm.id, tm.name_realm into v_member_id, v_tm_name_realm
  from public.team_members tm
  where tm.team_id = p_team_id
    and tm.person_id = (select pe.id from public.people pe where pe.auth_user_id = p_actor_id);

  if v_member_id is not null then
    select p.nickname, p.name_realm into v_nickname, v_player_name_realm
    from public.players p
    where p.team_member_id = v_member_id
      and p.archived_at is null
    order by p.name_realm
    limit 1;

    if v_nickname is not null and v_nickname <> '' then
      return v_nickname;
    end if;

    if coalesce(v_player_name_realm, v_tm_name_realm) is not null then
      return split_part(coalesce(v_player_name_realm, v_tm_name_realm), '-', 1);
    end if;
  end if;

  select coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')
  into v_display
  from auth.users u
  where u.id = p_actor_id;

  return v_display;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_own_rsvp(p_team_id integer, p_raid_date date, p_status text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_player_id integer;
  v_is_bench boolean;
  v_is_optional boolean;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select p.id, p.is_bench into v_player_id, v_is_bench
  from players p
  join team_members tm on tm.id = p.team_member_id
  where tm.person_id = public.my_person_id()
    and p.team_id = p_team_id
    and p.archived_at is null;

  if v_player_id is null then
    raise exception 'No active roster character found for this team.';
  end if;

  v_is_optional := is_optional_raid_night(p_team_id, p_raid_date);

  if v_is_bench and not v_is_optional then
    raise exception 'Bench players cannot set an RSVP status.';
  end if;

  if p_status is null then
    delete from raid_rsvps where team_id = p_team_id and player_id = v_player_id and raid_date = p_raid_date;
    return;
  end if;

  if p_status not in ('Attending', 'Late', 'Leaving Early', 'Tentative', 'Absent') then
    raise exception 'Invalid RSVP status: %', p_status;
  end if;

  if p_status = 'Attending' and not v_is_optional then
    raise exception 'Attending is only valid on an optional raid night.';
  end if;

  insert into raid_rsvps (team_id, player_id, raid_date, status, note)
  values (p_team_id, v_player_id, p_raid_date, p_status, p_note)
  on conflict (team_id, player_id, raid_date)
  do update set status = excluded.status, note = excluded.note, updated_at = now();
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_self_received(p_team_id integer, p_name_realm text, p_item_name text, p_track text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_slot text DEFAULT NULL::text)
 RETURNS TABLE(id integer, auto_approved boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_player_id integer;
  v_item_id integer;
  v_auto_approved boolean := false;
  v_request_id integer;
begin
  select p.id into v_player_id
  from public.players p
  where p.team_id = p_team_id and p.name_realm = p_name_realm and p.archived_at is null;
  if not found then
    raise exception 'Character not found on roster';
  end if;

  if coalesce(p_source, '') = 'Other' and btrim(coalesce(p_note, '')) = '' then
    raise exception 'Say where the item came from in the note. An officer reviews Other reports.';
  end if;

  select i.id into v_item_id from public.items i where i.name = p_item_name;
  if not found then
    raise exception 'Unknown item: %', p_item_name;
  end if;

  if auth.uid() is not null
    and coalesce(p_source, '') <> 'Other'
    and (coalesce(p_source, '') = 'Pug raid' or coalesce(p_note, '') !~* '\yraid\y') then
    select true into v_auto_approved
    from public.players p
    join public.team_members tm on tm.id = p.team_member_id
    where p.id = v_player_id and tm.person_id = public.my_person_id();
  end if;

  insert into public.self_received_requests
    (team_id, player_id, self_item_id, track, source, note, slot, status)
  values
    (p_team_id, v_player_id, v_item_id, p_track, nullif(p_source, ''), nullif(p_note, ''),
     nullif(p_slot, ''),
     case when coalesce(v_auto_approved, false) then 'approved' else 'pending' end)
  returning self_received_requests.id into v_request_id;

  if coalesce(v_auto_approved, false) then
    insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
    values (
      p_team_id,
      auth.uid(),
      'Self-Received Auto-Approved',
      'players',
      v_player_id,
      jsonb_build_object('item', p_item_name, 'track', p_track, 'source', p_source)
    );
  end if;

  return query select v_request_id, coalesce(v_auto_approved, false);
end $function$;

CREATE OR REPLACE FUNCTION public.team_battlenet_connections(p_team_id integer)
 RETURNS TABLE(team_member_id integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (
    coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false)
    or public.is_site_admin()
    or public.is_guild_officer()
  ) then
    raise exception 'Not authorized';
  end if;

  return query
  select tm.id
  from public.team_members tm
  join public.people pe on pe.id = tm.person_id
  where tm.team_id = p_team_id
    and pe.auth_user_id is not null
    and exists (
      select 1
      from auth.identities i
      where i.user_id = pe.auth_user_id
        and i.provider = 'custom:battlenet'
    )
  order by tm.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.wishlist_setup_status(p_team_id integer)
 RETURNS TABLE(player_id integer, name_realm text, discord_id text, wishlist_count integer, bis_link text, missing_bis_rows text[])
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  wishlist_slots text[] := array[
    'Head','Neck','Shoulder','Back','Chest','Wrist','Hands','Waist','Legs','Feet',
    'Finger 1','Finger 2','Trinket 1','Trinket 2','Weapon','Off Hand'
  ];
  prec record;
  bi record;
  candidates text[];
  c text;
  officer_buckets jsonb;
  tagged_rows text[];
  bis_rows text[];
  off_hand_required boolean;
  required_rows text[];
  missing text[];
begin
  for prec in
    select p.id, p.name_realm, p.bis_link, pe.discord_id,
      (select count(*) from item_preferences ip where ip.player_id = p.id) as wishlist_count
    from players p
    join team_members tm on tm.id = p.team_member_id
    join people pe on pe.id = tm.person_id
    where p.team_id = p_team_id
      and p.archived_at is null
  loop
    -- Own copy of wishlistOfficerRowBuckets' greedy row-assignment: explicit
    -- bis_items.slot rows claim their row first (pass 1), then legacy rows
    -- with no slot override fall back to their item's catalog-slot
    -- candidates in id order, first open row wins (pass 2). Stored as
    -- row -> catalog_slot so the off-hand check below can read the
    -- assigned Weapon pick's catalog slot without a second lookup.
    officer_buckets := '{}'::jsonb;

    for bi in
      select b.id, i.slot as catalog_slot, b.slot as explicit_slot
      from bis_items b
      join items i on i.id = b.item_id
      where b.player_id = prec.id
        and b.slot = any(wishlist_slots)
      order by b.id
    loop
      if not (officer_buckets ? bi.explicit_slot) then
        officer_buckets := jsonb_set(officer_buckets, array[bi.explicit_slot], to_jsonb(bi.catalog_slot));
      end if;
    end loop;

    for bi in
      select b.id, i.slot as catalog_slot
      from bis_items b
      join items i on i.id = b.item_id
      where b.player_id = prec.id
        and (b.slot is null or not (b.slot = any(wishlist_slots)))
      order by b.id
    loop
      candidates := case bi.catalog_slot
        when 'Finger' then array['Finger 1', 'Finger 2']
        when 'Trinket' then array['Trinket 1', 'Trinket 2']
        when 'One-Hand' then array['Weapon']
        when 'Two-Hand' then array['Weapon']
        when 'Ranged' then array['Weapon']
        when 'Off Hand' then array['Off Hand']
        when 'Held In Off-hand' then array['Off Hand']
        when 'Head' then array['Head']
        when 'Neck' then array['Neck']
        when 'Shoulder' then array['Shoulder']
        when 'Back' then array['Back']
        when 'Chest' then array['Chest']
        when 'Wrist' then array['Wrist']
        when 'Hands' then array['Hands']
        when 'Waist' then array['Waist']
        when 'Legs' then array['Legs']
        when 'Feet' then array['Feet']
        else array[]::text[]
      end;
      foreach c in array candidates
      loop
        if not (officer_buckets ? c) then
          officer_buckets := jsonb_set(officer_buckets, array[c], to_jsonb(bi.catalog_slot));
          exit;
        end if;
      end loop;
    end loop;

    -- Raider's own tags: wishlistCompleteness()'s taggedRows/bisRows/
    -- offHandRequired pass. item_preferences.slot mirrors bis_items.slot --
    -- present for Finger/Trinket/Weapon/Off Hand disambiguation and every
    -- placeholder row, null (falls back to catalog slot) everywhere else.
    tagged_rows := array[]::text[];
    bis_rows := array[]::text[];
    off_hand_required := false;

    for bi in
      select ip.status, ip.slot as explicit_slot, i.slot as catalog_slot
      from item_preferences ip
      join items i on i.id = ip.item_id
      where ip.player_id = prec.id
    loop
      if bi.explicit_slot is not null then
        candidates := array[bi.explicit_slot];
      else
        candidates := case bi.catalog_slot
          when 'Finger' then array['Finger 1', 'Finger 2']
          when 'Trinket' then array['Trinket 1', 'Trinket 2']
          when 'One-Hand' then array['Weapon']
          when 'Two-Hand' then array['Weapon']
          when 'Ranged' then array['Weapon']
          when 'Off Hand' then array['Off Hand']
          when 'Held In Off-hand' then array['Off Hand']
          when 'Head' then array['Head']
          when 'Neck' then array['Neck']
          when 'Shoulder' then array['Shoulder']
          when 'Back' then array['Back']
          when 'Chest' then array['Chest']
          when 'Wrist' then array['Wrist']
          when 'Hands' then array['Hands']
          when 'Waist' then array['Waist']
          when 'Legs' then array['Legs']
          when 'Feet' then array['Feet']
          else array[]::text[]
        end;
      end if;

      tagged_rows := tagged_rows || candidates;
      if bi.status = 'bis' then
        bis_rows := bis_rows || candidates;
        if (bi.explicit_slot = 'Weapon' or bi.explicit_slot is null) and bi.catalog_slot = 'One-Hand' then
          off_hand_required := true;
        end if;
      end if;
    end loop;

    if not (tagged_rows @> array['Weapon'])
      and officer_buckets ? 'Weapon'
      and officer_buckets ->> 'Weapon' = 'One-Hand'
    then
      off_hand_required := true;
    end if;

    required_rows := array(
      select s from unnest(wishlist_slots) s where s <> 'Off Hand' or off_hand_required
    );
    missing := array(
      select r from unnest(required_rows) r
      where not (bis_rows @> array[r]) and not (officer_buckets ? r)
    );

    player_id := prec.id;
    name_realm := prec.name_realm;
    discord_id := prec.discord_id;
    wishlist_count := prec.wishlist_count;
    bis_link := prec.bis_link;
    missing_bis_rows := missing;
    return next;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_boe_finder_discord_id(p_boe_id integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.boe_items%rowtype;
  v_discord_id text;
  v_first text;
  v_distinct integer;
begin
  -- The same pair boe_record_sale requires, so this admits exactly the people
  -- who could have caused the message it feeds.
  if not (public.is_boe_manager() or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  select * into v_row from public.boe_items where id = p_boe_id;
  if not found then
    return null;
  end if;

  -- 1. Stamped at submit, when the finder was signed in (#889). Trusted over
  -- everything below: it is the finder saying who they are.
  if v_row.finder_discord_id is not null then
    return v_row.finder_discord_id;
  end if;

  -- 2. The claimed character submit_boe_found resolved on the finding team.
  if v_row.player_id is not null then
    select pe.discord_id
    into v_discord_id
    from public.players p
    join public.team_members tm on tm.id = p.team_member_id
    join public.people pe on pe.id = tm.person_id
    where p.id = v_row.player_id;

    if v_discord_id is not null then
      return v_discord_id;
    end if;
  end if;

  -- 3. The name, matched across every team.
  --
  -- Compare first name segments: a finder_name may be bare ("Brugamen") or
  -- carry a realm ("Glizzygary-Dalaran", "Warbird-Burning Blade"), so neither
  -- side compares whole.
  v_first := lower(btrim(split_part(coalesce(v_row.finder_name, ''), '-', 1)));
  if v_first = '' then
    return null;
  end if;

  -- Two rules that look like bugs and are not.
  --
  -- Removed characters count. The find that prompted this was reported a
  -- month after its character left the roster, so archived_at is not filtered
  -- here: the person is still in the guild's Discord and still owed their cut.
  --
  -- Ambiguity is judged on distinct discord_id, not on matching rows. A person
  -- with two character rows pointing at one member row is the common shape
  -- (a realm rename leaves one behind), and refusing that would help nobody.
  -- Two rows reaching two different people is the case worth refusing, and it
  -- falls back to the finder's name in bold rather than pinging a guess.
  select count(distinct pe.discord_id), min(pe.discord_id)
  into v_distinct, v_discord_id
  from public.players p
  join public.team_members tm on tm.id = p.team_member_id
  join public.people pe on pe.id = tm.person_id
  where lower(btrim(split_part(p.name_realm, '-', 1))) = v_first;

  if v_distinct = 1 then
    return v_discord_id;
  end if;

  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.add_signup_to_roster(p_signup_id integer, p_is_trial boolean DEFAULT true, p_archive_player_id integer DEFAULT NULL::integer, p_is_backup_tank boolean DEFAULT false, p_is_backup_healer boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_signup public.season_signups%rowtype;
  v_player_id integer;
  v_archived_team_member_id integer;
  v_archived_join_date date;
  v_today date := (now() at time zone 'America/New_York')::date;
  v_live_season text;
  v_prior_archived_at timestamptz;
  v_prior_team_member_id integer;
  v_signer_member_id integer;
  v_spec_label text;
  v_archived_name_realm text;
begin
  select * into v_signup from public.season_signups
   where id = p_signup_id for update;
  if not found then
    raise exception 'signup % not found', p_signup_id;
  end if;
  if v_signup.status is distinct from 'approved' then
    raise exception 'signup % is not in approved status (is %)',
      p_signup_id, v_signup.status;
  end if;

  select p.archived_at, p.team_member_id
    into v_prior_archived_at, v_prior_team_member_id
    from public.players p
   where p.team_id = v_signup.team_id
     and p.name_realm_key = lower(replace(v_signup.signup_name_realm, ' ', ''));

  if v_signup.auth_user_id is not null then
    select tm.id into v_signer_member_id
      from public.team_members tm
      join public.people pe on pe.id = tm.person_id
     where tm.team_id = v_signup.team_id and pe.auth_user_id = v_signup.auth_user_id;
  end if;

  insert into public.players (
    team_id, name_realm, class_spec_id, is_trial, join_date,
    is_backup_tank, is_backup_healer
  )
  values (v_signup.team_id, v_signup.signup_name_realm,
          coalesce(v_signup.swap_class_spec_id, v_signup.class_spec_id),
          p_is_trial, v_today,
          p_is_backup_tank, p_is_backup_healer)
  on conflict (team_id, name_realm_key) do update
    set class_spec_id = excluded.class_spec_id,
        is_trial  = case when players.archived_at is not null
                         then excluded.is_trial else players.is_trial end,
        join_date = case when players.archived_at is not null
                         then excluded.join_date else players.join_date end,
        is_backup_tank = case when players.archived_at is not null
                         then excluded.is_backup_tank else players.is_backup_tank end,
        is_backup_healer = case when players.archived_at is not null
                         then excluded.is_backup_healer else players.is_backup_healer end,
        archived_at = null
  returning id into v_player_id;

  -- A revived row still linked to a different person moves to the signer.
  if v_prior_archived_at is not null
     and v_prior_team_member_id is not null
     and v_signer_member_id is not null
     and v_prior_team_member_id <> v_signer_member_id then
    update public.players set team_member_id = v_signer_member_id
     where id = v_player_id;
  end if;

  if p_archive_player_id is not null then
    select team_member_id, join_date, name_realm
      into v_archived_team_member_id, v_archived_join_date, v_archived_name_realm
      from public.players
     where id = p_archive_player_id and team_id = v_signup.team_id;

    -- The link stays on the archived character (#941): its attendance, loot
    -- and BoE finds still belong to this person.
    update public.players set archived_at = now()
     where id = p_archive_player_id and team_id = v_signup.team_id;

    if v_archived_team_member_id is not null then
      update public.players set team_member_id = v_archived_team_member_id
       where id = v_player_id and team_member_id is null;
    end if;

    -- Only overwrite when the new row is still on today's (local) date. That
    -- covers both the plain-insert path above AND a reactivated same-name-
    -- realm alt: the on-conflict branch already refreshes a reactivated
    -- archived character's join_date to today too (same as it refreshes
    -- is_trial), so there's no "alt's own original date" being protected
    -- here either way -- landing the swapped-from date on top of that
    -- today's-date keeps "main swap = continuation of tenure" true even
    -- when the destination is a known alt, not just a brand-new character.
    if v_archived_join_date is not null then
      update public.players set join_date = v_archived_join_date
       where id = v_player_id and join_date = v_today;
    end if;

    -- Carry attendance history to the new character. Skip any raid_date
    -- the new (destination) player already has its own row for -- that
    -- only happens on a reactivated-alt swap where the alt has independent
    -- attendance, and the unique (team_id, player_id, raid_date)
    -- constraint would otherwise abort the whole swap.
    update public.attendance a set player_id = v_player_id
     where a.player_id = p_archive_player_id
       and a.team_id = v_signup.team_id
       and not exists (
         select 1 from public.attendance b
          where b.team_id = v_signup.team_id
            and b.player_id = v_player_id
            and b.raid_date = a.raid_date
       );

    -- Drop the archived character's standing priority_order rows for the
    -- live season only, same as remove_player_priority_order() -- they no
    -- longer belong on the roster, so they shouldn't keep occupying a slot
    -- in the Priority tab, RCLootCouncil export, or addon panel.
    select regexp_replace(ts.config ->> 'seasonName', '^Midnight Season (\d+)$', 'MID\1')
      into v_live_season
      from public.team_settings ts
     where ts.team_id = v_signup.team_id;

    if v_live_season is not null then
      delete from public.priority_order
       where team_id = v_signup.team_id
         and season = v_live_season
         and player_id = p_archive_player_id;
    end if;
  end if;

  update public.season_signups
     set status = 'added', approved_player_id = v_player_id
   where id = p_signup_id;

  -- Audit (#1136). Same action names and detail shape the Roster tab's own
  -- add and remove write, so both paths read alike in the Audit Log. Skipped
  -- only when nobody is signed in (a service-role or test call), because
  -- write_audit_log() needs an actor and would otherwise abort the add.
  if auth.uid() is not null then
    select concat_ws(' ', cs.class, cs.spec, cs.role)
      into v_spec_label
      from public.classes_specs cs
     where cs.id = coalesce(v_signup.swap_class_spec_id, v_signup.class_spec_id);

    perform public.write_audit_log(
      v_signup.team_id, 'Player Added', 'players', v_player_id,
      to_jsonb(concat_ws(', ',
        coalesce(v_spec_label, 'Unknown spec'),
        'from signup',
        case when v_archived_name_realm is not null then 'main swap from ' || v_archived_name_realm end))
    );

    if v_archived_name_realm is not null then
      perform public.write_audit_log(
        v_signup.team_id, 'Main Swap: Old Character Removed', 'players', p_archive_player_id,
        to_jsonb('Replaced by ' || v_signup.signup_name_realm)
      );
    end if;
  end if;

  return v_player_id;
end $function$;

CREATE OR REPLACE FUNCTION public.admin_revoke_team_role(p_team_id integer, p_discord_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_existing public.team_members%rowtype;
  v_claimed integer;
begin
  if not (public.is_site_admin() or coalesce(public.my_team_role(p_team_id) = 'team_leader', false)) then
    raise exception 'Not authorized';
  end if;

  select * into v_existing
  from public.team_members
  where team_id = p_team_id
    and person_id = (select id from public.people where discord_id = p_discord_id)
  for update;

  if not found then
    raise exception 'That Discord account does not have a role on this team';
  end if;

  -- players_team_member_id_fkey is ON DELETE SET NULL, so deleting a member a
  -- character points at would silently unclaim that character, with no error
  -- anywhere and nothing in the audit log saying it happened. Somebody who
  -- has claimed a character stays on the team as a raider instead.
  select count(*) into v_claimed from public.players where team_member_id = v_existing.id;

  if v_claimed > 0 then
    update public.team_members set role = 'raider' where id = v_existing.id;

    perform public.write_audit_log(
      p_team_id, 'team_role_demoted', 'team_member', v_existing.id,
      jsonb_build_object('discord_id', p_discord_id, 'from_role', v_existing.role, 'claimed_characters', v_claimed)
    );
    return;
  end if;

  delete from public.team_members where id = v_existing.id;

  perform public.write_audit_log(
    p_team_id, 'team_role_revoked', 'team_member', v_existing.id,
    jsonb_build_object('discord_id', p_discord_id, 'from_role', v_existing.role)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.clear_no_character_dismissal_on_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  delete from account_preferences ap
   using team_members tm, people pe
   where tm.id = new.team_member_id
     and pe.id = tm.person_id
     and ap.auth_user_id = pe.auth_user_id
     and ap.key = 'no_character_dismissed';
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_person(p_discord_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_self boolean := p_discord_id is not distinct from public.current_discord_id();
  v_is_site_admin boolean := public.is_site_admin();
  v_sees_all_teams boolean;
  v_person people%rowtype;
  v_grants text[];
  v_result jsonb;
begin
  v_sees_all_teams := v_is_self or v_is_site_admin or public.is_guild_officer();

  if not (v_sees_all_teams or public.is_any_team_officer()) then
    raise exception 'Not authorized';
  end if;

  select * into v_person from people where discord_id = p_discord_id;

  select coalesce(array_agg(g.grant_type), '{}') into v_grants
    from guild_grants g
   where g.person_id = v_person.id;

  if p_discord_id is null
     or not (
       exists (select 1 from team_members where person_id = v_person.id)
       or cardinality(v_grants) > 0
     ) then
    return null;
  end if;

  select jsonb_build_object(
    'discord_id', p_discord_id,
    'auth_user_id', v_person.auth_user_id,
    'site_admin', case when v_is_self or v_is_site_admin
                       then 'site_admin' = any (v_grants) end,
    'guild_officer', case when v_is_self or v_is_site_admin
                          then 'guild_officer' = any (v_grants) end,
    'boe_manager', 'boe_manager' = any (v_grants),
    'teams', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'team_id', tm.team_id,
                 'team_member_id', tm.id,
                 'role', tm.role,
                 'characters', coalesce((
                   select jsonb_agg(
                            jsonb_build_object(
                              'player_id', p.id,
                              'name_realm', p.name_realm,
                              'url_code', p.url_code,
                              'archived_at', p.archived_at
                            )
                            order by p.archived_at desc nulls first, p.name_realm
                          )
                     from players p
                    where p.team_member_id = tm.id
                 ), '[]'::jsonb)
               )
               order by tm.team_id
             )
        from team_members tm
       where tm.person_id = v_person.id
         and (v_sees_all_teams or public.my_team_role(tm.team_id) = any (array['officer', 'team_leader']))
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$function$;

