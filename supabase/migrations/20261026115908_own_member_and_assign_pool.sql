-- #1355's last pieces (Kat, 2026-10-26).
--
-- 1. create_own_name(): someone already on a team with no Name makes their
--    own, so they are not stuck waiting for an officer to list them. It is
--    claimed by them the moment it exists. Only for a current member: joining
--    is the invite link's job (or an officer's), so this cannot be used to add
--    a row to a team the caller is not on.
-- 2. team_unnamed_members(): the people Assign can attach a bare Name to --
--    current memberships with no Name -- with the names their sign-ins carry,
--    so an officer can tell them apart. The names come from auth.identities,
--    the record only the Discord and Battle.net sign-ins write, never from
--    user metadata the account holder can rewrite (Rex, on #1355, finding 2).
--    Assign itself stays a plain officer write to names, as Remove claim is.
-- 3. team_invite_link_join() takes no character: the link joins the team, and
--    the person claims or makes their Name before picking a character. With a
--    character it does what it did before.

create or replace function public.create_own_name(p_team_id integer, p_label text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_label text := btrim(p_label);
  v_member_id integer;
  v_member_archived_at timestamp with time zone;
  v_name_id integer;
  v_constraint text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  if v_label is null or v_label = '' then
    raise exception 'Type a name for your Member';
  end if;

  -- Typed by a raider and readable by anyone, so kept to a name's shape: one
  -- line, and short enough for a roster row (fresh-agent review).
  if length(v_label) > 40 then
    raise exception 'Keep your Member''s name to 40 characters or fewer';
  end if;
  if v_label ~ '[[:cntrl:]]' then
    raise exception 'Your Member''s name has to fit on one line';
  end if;

  -- for share, as in claim_name(): archive_team_member() locks this row
  -- first, so the check and the insert land wholly before or after an archive.
  select tm.id, tm.archived_at into v_member_id, v_member_archived_at
    from public.team_members tm
   where tm.team_id = p_team_id and tm.person_id = public.my_person_id()
     for share;

  if v_member_id is null then
    raise exception 'You are not on this team. Join it through its invite link first.';
  end if;

  if v_member_archived_at is not null then
    raise exception 'Your membership on this team has ended. Ask one of its officers to add you back.';
  end if;

  if exists (select 1 from public.names n where n.team_member_id = v_member_id) then
    raise exception 'You already have a Member on this team. Ask an officer if it needs changing.';
  end if;

  -- The unique indexes decide a race: the same person in two tabs, or two
  -- people typing the same label at once.
  begin
    insert into public.names (team_id, label, team_member_id)
    values (p_team_id, v_label, v_member_id)
    returning id into v_name_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'names_team_id_label_key' then
      raise exception 'This team already has a Member called %. If that is you, claim it instead.', v_label;
    end if;
    raise exception 'You already have a Member on this team. Ask an officer if it needs changing.';
  end;

  -- Its own row, since write_audit_log() refuses a raider, as claim_name()
  -- does. self marks it apart from an officer's Name Created.
  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Name Created', 'names', v_name_id,
          jsonb_build_object('label', v_label, 'team_member_id', v_member_id, 'self', true));

  return v_name_id;
end;
$$;

comment on function public.create_own_name(integer, text) is
  'A current member with no Name on the team makes their own, claimed by them (#1355). Refuses a non-member, an ended membership, a second Name and a label the team already has. Writes its own Name Created audit row.';

revoke all on function public.create_own_name(integer, text) from public;
revoke execute on function public.create_own_name(integer, text) from anon;
grant execute on function public.create_own_name(integer, text) to authenticated;

create or replace function public.team_unnamed_members(p_team_id integer)
returns table (team_member_id integer, discord_name text, battletag text, character_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Whoever can Assign: the team's officers, a site admin, or a guild officer
  -- of this team's own guild. is_guild_officer() would answer for a guild
  -- officer anywhere and hand one guild's sign-in names to another (#1643's
  -- rule, CodeRabbit on this function).
  if not (
    coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false)
    or public.is_site_admin()
    or exists (select 1 from public.teams t where t.id = p_team_id and public.is_guild_officer_of(t.guild_id))
  ) then
    raise exception 'Not authorized';
  end if;

  return query
  select
    tm.id,
    -- An empty name counts as none, as the app reads its own sign-in.
    (select coalesce(nullif(i.identity_data -> 'custom_claims' ->> 'global_name', ''),
                     nullif(i.identity_data ->> 'full_name', ''),
                     nullif(i.identity_data ->> 'name', ''))
       from auth.identities i
      where i.user_id = pe.auth_user_id and i.provider = 'discord'
      order by i.created_at desc
      limit 1),
    (select nullif(i.identity_data -> 'custom_claims' ->> 'battletag', '')
       from auth.identities i
      where i.user_id = pe.auth_user_id and i.provider = 'custom:battlenet'
      order by i.created_at desc
      limit 1),
    (select p.name_realm
       from public.players p
      where p.team_member_id = tm.id and p.archived_at is null
      order by p.id
      limit 1)
  from public.team_members tm
  join public.people pe on pe.id = tm.person_id
  where tm.team_id = p_team_id
    and tm.archived_at is null
    and not exists (select 1 from public.names n where n.team_member_id = tm.id)
  order by tm.id;
end;
$$;

comment on function public.team_unnamed_members(integer) is
  'Current members of a team who hold no Name, for an officer''s Assign (#1355): each with the Discord name and BattleTag their sign-ins carry (from auth.identities) and their active roster character, any of which may be null.';

revoke all on function public.team_unnamed_members(integer) from public;
revoke execute on function public.team_unnamed_members(integer) from anon;
grant execute on function public.team_unnamed_members(integer) to authenticated;

create or replace function public.team_invite_link_join(p_code text, p_blizzard_id bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_discord_id text;
  v_team_id integer;
  v_member_id integer;
  v_character public.characters%rowtype;
  v_spec_id integer;
  v_player_id integer;
  v_joined boolean;
  v_today date := (now() at time zone 'America/New_York')::date;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select l.team_id into v_team_id
    from public.team_invite_links l
   where l.code = p_code
     and (l.expires_at is null or l.expires_at > now());
  if v_team_id is null then
    raise exception 'This invite link does not work';
  end if;

  -- team_members is keyed on the Discord id, as claim_character() is.
  v_discord_id := public.current_discord_id();
  if v_discord_id is null then
    raise exception 'Connect Discord before joining a team';
  end if;

  -- The character has to be one Blizzard confirmed for this person, the way
  -- request_main_swap() takes a character id rather than a name. Everything
  -- below reads the name from this row, so the caller never supplies it. No
  -- character (#1355) means joining the team only; checked before the
  -- membership is written, so a wrong character joins nothing.
  if p_blizzard_id is not null then
    select * into v_character
      from public.characters c
     where c.blizzard_id = p_blizzard_id
       and c.person_id = public.my_person_id();
    if not found then
      raise exception 'That character is not on your account';
    end if;

    select cs.id into v_spec_id
      from public.classes_specs cs
     where cs.class = v_character.class_name and cs.spec = v_character.spec_name;
  end if;

  -- The membership goes the same way, for the same reason: a person opening
  -- the link in two tabs would otherwise have both find no membership and both
  -- insert, and the second would surface team_members_team_id_person_id_key
  -- instead of joining. The trigger fills person_id before the conflict is
  -- checked, so it can arbitrate on it. An existing membership is updated only
  -- when it was archived (#1355): the person is coming back, and as a raider,
  -- since the link is a raider's way in. A current one is left alone, since an
  -- update would touch its updated_at for nothing; the select below finds it.
  insert into public.team_members (team_id, discord_id, role)
  values (v_team_id, v_discord_id, 'raider')
  on conflict (team_id, person_id) do update
     set role = 'raider', archived_at = null
   where team_members.archived_at is not null
  returning id into v_member_id;

  -- A row came back only when the membership was made or brought back.
  v_joined := v_member_id is not null;

  if v_member_id is null then
    select tm.id into v_member_id
      from public.team_members tm
     where tm.team_id = v_team_id and tm.person_id = public.my_person_id();
  end if;

  if p_blizzard_id is null then
    -- The caller is a raider, so write_audit_log()'s officer gate would refuse
    -- them; this is one of the functions that writes its own row. Only for a
    -- real join: a member reopening the link, or the page's own second step,
    -- adds nothing to the log (fresh-agent review).
    if v_joined then
      insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
      values (v_team_id, v_uid, 'Joined via Invite Link', 'team_members', v_member_id, null);
    end if;
    return 'joined';
  end if;

  -- One statement for the new character and the returning one, so a join
  -- racing another on the same name cannot pass a check and then write.
  insert into public.players (team_id, name_realm, class_spec_id, is_trial, join_date, team_member_id)
  values (v_team_id, v_character.name_realm, v_spec_id, true, v_today, v_member_id)
  on conflict (team_id, name_realm_key) do update
     set team_member_id = excluded.team_member_id,
         class_spec_id = coalesce(excluded.class_spec_id, players.class_spec_id),
         -- Back from the archive: a new stint, on trial and without the flags an
         -- officer set for the last one, like any new add.
         is_trial = case when players.archived_at is not null then excluded.is_trial else players.is_trial end,
         join_date = case when players.archived_at is not null then excluded.join_date else players.join_date end,
         -- The backup flags add_signup_to_roster() resets, plus the two
         -- grants an officer made to whoever held the character before.
         is_backup_tank = case when players.archived_at is not null then false else players.is_backup_tank end,
         is_backup_healer = case when players.archived_at is not null then false else players.is_backup_healer end,
         wishlist_allowed = case when players.archived_at is not null then false else players.wishlist_allowed end,
         bis_allowed = case when players.archived_at is not null then false else players.bis_allowed end,
         archived_at = null
   -- Never take over a character that belongs to someone else, active or
   -- archived; the same guard claim_character() applies, on the write itself.
   where players.team_member_id is null or players.team_member_id = excluded.team_member_id
  returning id into v_player_id;

  if v_player_id is null then
    raise exception '% is already claimed', v_character.name_realm;
  end if;

  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (v_team_id, v_uid, 'Joined via Invite Link', 'players', v_player_id, to_jsonb(v_character.name_realm));

  return 'joined';
end;
$$;
