-- #1647, part 1 of 2: the guild-level checks ask the guild grid's permission
-- (#1645) in the guild they act on, and the bio cards and BoE payout settings
-- move from site_settings to the guild.
--
--   create_teams           create_team()
--   rename_archive_teams   update_team(), set_team_archived(), set_team_unlisted()
--   edit_all_bios          set_guild_officer_bios(): any card
--   edit_own_bio           set_guild_officer_bios(): only cards whose personId
--                          is the caller's; every other card must come back
--                          exactly as it was, in the same order
--   record_boe             the BoE lifecycle functions, resolve_boe_finder_discord_id()
--                          and the boe_items / boe_listings write rules
--   pay_any_boe            can_settle_boe(), beside the team's own pay_boe_cuts
--   edit_boe_settings      set_boe_payout_settings(), until now site admins only
--   view_guild_audit_log   the audit_log read rule's guild arm
--
-- With the default grid a guild Admin or Owner passes all of these, so We Go
-- Again's guild officers (Admins since #1645) keep everything they had, and
-- gain BoE recording and the payout settings. A Team Lead can create a team
-- and edit their own bio card. "Change a team's Team Owner" and "Edit guild
-- profile" have no function yet; they come with their pages.
--
-- BoE Manager is the current site's role until cutover drops it (#1517):
-- has_guild_permission() answers record_boe and pay_any_boe for a BoE
-- manager in the guild their grant names, so the current site keeps working
-- and the grant stops meaning "any guild". is_boe_manager() itself stays for
-- the current site's buttons only, as is_guild_officer() does.
--
-- The functions renaming, archiving and unlisting a team, and the two
-- settings writers, write their own audit row: their caller need not be an
-- officer of the team, which write_audit_log() asks.
--
-- The team checks' guild officer arm becomes "Officer on every team" and
-- "See every team, read-only" in part 2.

-- The bio cards and the payout settings, per guild. We Go Again is the only
-- guild on production, and the first one everywhere, so the site-wide values
-- become its own; a new guild starts with no cards and the payout defaults.
alter table public.guilds
  add column officer_bios jsonb not null default '[]'::jsonb,
  add column boe_payout_floor bigint not null default 20000,
  add column boe_payout_pivot bigint not null default 100000,
  add constraint guilds_boe_payout_floor_nonneg check (boe_payout_floor >= 0),
  add constraint guilds_boe_payout_pivot_positive check (boe_payout_pivot > 0);

comment on column public.guilds.officer_bios is
  'The guild officers'' bio cards, in display order (#1647, from site_settings). A card with a personId is that person''s own: edit_own_bio lets them change it. Written only by set_guild_officer_bios().';
comment on column public.guilds.boe_payout_floor is
  'BoE finder payout floor in gold (#745, per guild since #1647). Written only by set_boe_payout_settings(); each sale snapshots it.';
comment on column public.guilds.boe_payout_pivot is
  'BoE sale price at which the payout starts rising above the floor, in gold (#745, per guild since #1647). Written only by set_boe_payout_settings(); each sale snapshots it.';

update public.guilds g
   set officer_bios = s.guild_officer_bios,
       boe_payout_floor = s.boe_payout_floor,
       boe_payout_pivot = s.boe_payout_pivot
  from public.site_settings s
 where s.id = 1
   and g.id = (select min(id) from public.guilds);

-- The checks

-- BoE Manager, until cutover: see the header.
create or replace function public.has_guild_permission(p_guild_id integer, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with ranks as (
    select g.rank
      from guild_ranks g
     where g.guild_id = p_guild_id and g.person_id = my_person_id()
    union all
    select 'member'
      from team_members m
      join teams t on t.id = m.team_id
     where t.guild_id = p_guild_id and m.person_id = my_person_id() and m.archived_at is null
  )
  select exists (select 1 from rank_permissions k where k.permission = p_permission and k.scope = 'guild')
     and (exists (select 1 from ranks r
                   where r.rank = 'owner'
                      or exists (select 1 from guild_rank_permissions p
                                  where p.guild_id = p_guild_id and p.rank = r.rank
                                    and p.permission = p_permission))
          or (p_permission in ('record_boe', 'pay_any_boe')
              and exists (select 1 from guild_grants g
                           where g.guild_id = p_guild_id and g.person_id = my_person_id()
                             and g.grant_type = 'boe_manager')));
$$;

comment on function public.has_guild_permission(integer, text) is
  'Whether the caller''s rank in this guild has this permission on its grid (#1645). The owner has all; anyone on a team in the guild is at least a member; a BoE manager of this guild has record_boe and pay_any_boe until cutover (#1647). Never null.';

-- The teams in every guild where the caller has this permission, for the
-- table rules: one call per query, as my_permission_team_ids() is. Anon
-- runs it because the rules are evaluated for signed-out reads too; empty
-- there.
create function public.my_guild_permission_team_ids(p_permission text)
returns integer[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(t.id), '{}')
    from teams t
   where t.guild_id in (select g.id from guilds g where has_guild_permission(g.id, p_permission));
$$;

comment on function public.my_guild_permission_team_ids(text) is
  'Every team, archived included, in a guild where the caller has this guild permission (#1647). Empty, never null.';

revoke all on function public.my_guild_permission_team_ids(text) from public;
grant execute on function public.my_guild_permission_team_ids(text) to anon, authenticated;

comment on function public.is_boe_manager() is
  'Whether the caller holds a boe_manager grant in any guild. For the current site''s buttons only: access checks ask has_guild_permission(..., ''record_boe'') or my_guild_permission_team_ids(''record_boe''), which answer per guild (#1647).';

-- Teams

create or replace function public.create_team(p_guild_id integer, p_name text)
returns table(team_id integer, team_key text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_discord_id text;
  v_name text := trim(coalesce(p_name, ''));
  v_team_id integer;
  v_team_key text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not public.has_guild_permission(p_guild_id, 'create_teams') then
    raise exception 'Not authorized';
  end if;

  -- team_members is keyed on the Discord id, as in create_guild().
  v_discord_id := public.current_discord_id();
  if v_discord_id is null then
    raise exception 'Connect Discord before adding a team';
  end if;

  if v_name = '' or length(v_name) > 60 then
    raise exception 'Give the team a name of up to 60 characters';
  end if;
  if exists (select 1 from teams t where t.guild_id = p_guild_id and lower(t.name) = lower(v_name)) then
    raise exception 'This guild already has a team called %', v_name;
  end if;

  insert into teams (name, guild_id)
  values (v_name, p_guild_id)
  returning id, slug into v_team_id, v_team_key;

  -- Every write path assumes a team_settings row already exists.
  insert into team_settings (team_id, config) values (v_team_id, '{}'::jsonb);

  -- The trigger resolves the person and its account from the Discord id.
  insert into team_members (team_id, discord_id, role)
  values (v_team_id, v_discord_id, 'team_leader');

  -- The caller is the new team's owner by now, so write_audit_log() admits them.
  perform public.write_audit_log(v_team_id, 'Team Created', 'teams', v_team_id,
                                 jsonb_build_object('name', v_name, 'key', v_team_key));

  return query select v_team_id, v_team_key;
end;
$function$;

create or replace function public.update_team(p_team_id integer, p_name text, p_key text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_guild_id integer;
  v_old_name text;
  v_old_key text;
  v_name text := trim(coalesce(p_name, ''));
  v_key text := lower(trim(coalesce(p_key, '')));
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select t.guild_id, t.name, t.slug into v_guild_id, v_old_name, v_old_key
    from teams t where t.id = p_team_id;
  if v_guild_id is null or not public.has_guild_permission(v_guild_id, 'rename_archive_teams') then
    raise exception 'Not authorized';
  end if;

  if v_name = '' or length(v_name) > 60 then
    raise exception 'Give the team a name of up to 60 characters';
  end if;
  if exists (
    select 1 from teams t
     where t.guild_id = v_guild_id and t.id <> p_team_id and lower(t.name) = lower(v_name)
  ) then
    raise exception 'This guild already has a team called %', v_name;
  end if;

  -- The same shape as the teams_slug_format check, said in words.
  if v_key !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_key) not between 2 and 32 then
    raise exception 'An address is 2 to 32 letters, numbers and single dashes';
  end if;
  if exists (select 1 from teams t where t.guild_id = v_guild_id and t.id <> p_team_id and t.slug = v_key) then
    raise exception 'Another team in this guild already uses that address';
  end if;

  if v_name = v_old_name and v_key = v_old_key then
    return;
  end if;

  update teams set name = v_name, slug = v_key where id = p_team_id;

  -- Its own row: the caller need not be on the team (see the header).
  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Team Updated', 'teams', p_team_id,
          jsonb_build_object('name', v_name, 'key', v_key, 'old_name', v_old_name, 'old_key', v_old_key));
end;
$function$;

create or replace function public.set_team_archived(p_team_id integer, p_archived boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_guild_id integer;
  v_was_archived boolean;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select t.guild_id, t.archived_at is not null into v_guild_id, v_was_archived from teams t where t.id = p_team_id;
  if v_guild_id is null or not public.has_guild_permission(v_guild_id, 'rename_archive_teams') then
    raise exception 'Not authorized';
  end if;
  if p_archived is null then
    raise exception 'Say whether to archive the team';
  end if;
  -- No change, no write and no audit line.
  if p_archived = v_was_archived then
    return;
  end if;

  update teams
     set archived_at = case when p_archived then now() end
   where id = p_team_id;

  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, case when p_archived then 'Team Archived' else 'Team Restored' end,
          'teams', p_team_id, null);
end;
$function$;

create or replace function public.set_team_unlisted(p_team_id integer, p_unlisted boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_guild_id integer;
  v_was_unlisted boolean;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select t.guild_id, t.unlisted into v_guild_id, v_was_unlisted from teams t where t.id = p_team_id;
  if v_guild_id is null or not public.has_guild_permission(v_guild_id, 'rename_archive_teams') then
    raise exception 'Not authorized';
  end if;
  if p_unlisted is null then
    raise exception 'Say whether to unlist the team';
  end if;
  -- No change, no write and no audit line.
  if p_unlisted = v_was_unlisted then
    return;
  end if;

  update teams set unlisted = p_unlisted where id = p_team_id;

  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, case when p_unlisted then 'Team Unlisted' else 'Team Listed' end,
          'teams', p_team_id, null);
end;
$function$;

-- Bio cards. Left out, the guild is the only one while there is one, as for
-- the grants (#1324).

drop function public.set_guild_officer_bios(jsonb);

create function public.set_guild_officer_bios(p_bios jsonb, p_guild_id integer default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_guild integer;
  v_me text := public.my_person_id()::text;
  v_old jsonb;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if jsonb_typeof(p_bios) is distinct from 'array' then
    raise exception 'The bio cards must be a list';
  end if;

  v_guild := coalesce(p_guild_id, public.only_guild_id());
  -- Locked, so two own-card saves cannot each pass the check below against
  -- the list the other is replacing.
  select officer_bios into v_old from guilds where id = v_guild for update;
  if not found then
    raise exception 'There is no such guild';
  end if;

  if not (public.is_site_admin() or public.has_guild_permission(v_guild, 'edit_all_bios')) then
    -- Their own cards only: the cards that are not theirs, a card with no
    -- personId among them, come back unchanged and in the same order.
    if v_me is null
       or not public.has_guild_permission(v_guild, 'edit_own_bio')
       or (select coalesce(jsonb_agg(c order by i), '[]'::jsonb)
             from jsonb_array_elements(v_old) with ordinality as e(c, i)
            where c ->> 'personId' is distinct from v_me)
          is distinct from
          (select coalesce(jsonb_agg(c order by i), '[]'::jsonb)
             from jsonb_array_elements(p_bios) with ordinality as e(c, i)
            where c ->> 'personId' is distinct from v_me) then
      raise exception 'Not authorized';
    end if;
  end if;

  update guilds set officer_bios = p_bios where id = v_guild;

  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (null, v_uid, 'Guild Officer Bios Saved', 'guilds', v_guild,
          jsonb_build_object('count', jsonb_array_length(p_bios)));

  return p_bios;
end;
$$;

revoke all on function public.set_guild_officer_bios(jsonb, integer) from public, anon;
grant execute on function public.set_guild_officer_bios(jsonb, integer) to authenticated;

-- BoE

drop function public.set_boe_payout_settings(bigint, bigint);

create function public.set_boe_payout_settings(p_floor bigint, p_pivot bigint, p_guild_id integer default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_guild integer;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  v_guild := coalesce(p_guild_id, public.only_guild_id());
  if not (public.is_site_admin() or public.has_guild_permission(v_guild, 'edit_boe_settings')) then
    raise exception 'Not authorized';
  end if;
  if p_floor is null or p_floor < 0 then
    raise exception 'Payout floor must be zero or more';
  end if;
  if p_pivot is null or p_pivot <= 0 then
    raise exception 'Payout pivot must be positive';
  end if;

  update guilds set boe_payout_floor = p_floor, boe_payout_pivot = p_pivot where id = v_guild;
  if not found then
    raise exception 'There is no such guild';
  end if;

  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (null, v_uid, 'boe_payout_settings_updated', 'guilds', v_guild,
          jsonb_build_object('floor', p_floor, 'pivot', p_pivot));
end;
$$;

revoke all on function public.set_boe_payout_settings(bigint, bigint, integer) from public, anon;
grant execute on function public.set_boe_payout_settings(bigint, bigint, integer) to authenticated;

alter table public.site_settings
  drop column guild_officer_bios,
  drop column boe_payout_floor,
  drop column boe_payout_pivot;

create or replace function public.can_settle_boe(p_team_id integer)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.is_site_admin()
    or public.has_team_permission(p_team_id, 'pay_boe_cuts')
    or coalesce(p_team_id = any (public.my_guild_permission_team_ids('pay_any_boe')), false);
$function$;

create or replace function public.boe_edit_item(p_id integer, p_item_name text, p_track text, p_note text, p_item_id integer, p_upgrade_rank text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_team_id integer;
  v_old_item_name text;
  v_old_track text;
  v_old_note text;
  v_old_item_id integer;
  v_old_upgrade_rank text;
  v_detail text := '';
begin
  select b.team_id, b.item_name, b.track, b.note, b.item_id, b.upgrade_rank
    into v_team_id, v_old_item_name, v_old_track, v_old_note, v_old_item_id, v_old_upgrade_rank
  from public.boe_items b where b.id = p_id for update;
  if not found then
    raise exception 'BoE item not found';
  end if;
  if not (v_team_id = any (public.my_guild_permission_team_ids('record_boe')) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  if v_old_item_name is distinct from p_item_name then
    v_detail := v_detail || (case when v_detail = '' then '' else '; ' end)
      || 'item renamed from ' || coalesce('"' || v_old_item_name || '"', '(none)')
      || ' to ' || coalesce('"' || p_item_name || '"', '(none)');
  end if;
  if v_old_track is distinct from p_track then
    v_detail := v_detail || (case when v_detail = '' then '' else '; ' end)
      || 'track was ' || coalesce('"' || v_old_track || '"', '(none)')
      || ', now ' || coalesce('"' || p_track || '"', '(none)');
  end if;
  if v_old_note is distinct from p_note then
    v_detail := v_detail || (case when v_detail = '' then '' else '; ' end)
      || 'note was ' || coalesce('"' || v_old_note || '"', '(none)')
      || ', now ' || coalesce('"' || p_note || '"', '(none)');
  end if;
  if v_old_item_id is distinct from p_item_id then
    v_detail := v_detail || (case when v_detail = '' then '' else '; ' end)
      || 'catalog link was ' || coalesce(v_old_item_id::text, '(none)')
      || ', now ' || coalesce(p_item_id::text, '(none)');
  end if;
  if v_old_upgrade_rank is distinct from p_upgrade_rank then
    v_detail := v_detail || (case when v_detail = '' then '' else '; ' end)
      || 'rank was ' || coalesce('"' || v_old_upgrade_rank || '"', '(none)')
      || ', now ' || coalesce('"' || p_upgrade_rank || '"', '(none)');
  end if;

  update public.boe_items
  set item_name = p_item_name, track = p_track, note = p_note,
      item_id = p_item_id, upgrade_rank = p_upgrade_rank
  where id = p_id;

  if v_detail <> '' then
    insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
    values (v_team_id, auth.uid(), 'BoE Find Edited', 'boe_items', p_id, to_jsonb(v_detail));
  end if;
end $function$;

create or replace function public.boe_record_listing(p_id integer, p_price bigint, p_listed_at timestamp with time zone default null::timestamp with time zone, p_note text default null::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_team_id integer;
  v_status text;
  v_item_name text;
begin
  select b.team_id, b.status, b.item_name into v_team_id, v_status, v_item_name
  from public.boe_items b where b.id = p_id for update;
  if not found then
    raise exception 'BoE item not found';
  end if;
  if not (v_team_id = any (public.my_guild_permission_team_ids('record_boe')) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if v_status <> all (array['found', 'listed']) then
    raise exception 'Cannot record a listing on a % BoE', v_status;
  end if;
  if p_price is null or p_price < 0 then
    raise exception 'Listing price must be zero or more';
  end if;

  insert into public.boe_listings (team_id, boe_item_id, price, listed_at, note)
  values (v_team_id, p_id, p_price, coalesce(p_listed_at, now()), nullif(trim(coalesce(p_note, '')), ''));

  update public.boe_items set status = 'listed' where id = p_id;

  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (v_team_id, auth.uid(), 'BoE Listed', 'boe_items', p_id,
    to_jsonb(v_item_name || ' listed for ' || public.format_boe_gold(p_price) || 'g'));
end $function$;

create or replace function public.boe_record_sale(p_id integer, p_sale_price bigint, p_sold_at timestamp with time zone default null::timestamp with time zone)
returns table(sale_price bigint, finder_payout bigint, guild_cut bigint, ah_fee bigint)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- The game's fixed auction house cut (#861), verified against two real
  -- mails. Not a setting: nothing reads it but this function and the
  -- backfill that introduced the column.
  c_ah_fee_pct constant numeric := 5;
  v_team_id integer;
  v_status text;
  v_item_name text;
  v_floor bigint;
  v_pivot bigint;
  v_fee bigint;
  v_payout bigint;
begin
  select b.team_id, b.status, b.item_name into v_team_id, v_status, v_item_name
  from public.boe_items b where b.id = p_id for update;
  if not found then
    raise exception 'BoE item not found';
  end if;
  if not (v_team_id = any (public.my_guild_permission_team_ids('record_boe')) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if v_status <> all (array['found', 'listed']) then
    raise exception 'Cannot record a sale on a % BoE', v_status;
  end if;
  if p_sale_price is null or p_sale_price <= 0 then
    raise exception 'Sale price must be positive';
  end if;

  -- The finding team's guild's settings (#1647).
  select g.boe_payout_floor, g.boe_payout_pivot into v_floor, v_pivot
  from public.teams t join public.guilds g on g.id = t.guild_id
  where t.id = v_team_id;

  -- Whole gold, half away from zero: silver and copper are ignored by
  -- decision (a 47,999 sale carries a 2,399g 95s cut in game and 2,400 here),
  -- the same rounding the payout uses.
  v_fee := round(p_sale_price::numeric * c_ah_fee_pct / 100)::bigint;

  -- Guild rule (#745 comment): 20%-of-gross or the floor, whichever is
  -- larger, rounded to the nearest gold half away from zero, and never more
  -- than the sale net of the fee (#861), so the guild is never out of pocket
  -- on a sub-floor sale. The guild keeps what is left after the fee.
  v_payout := least(p_sale_price - v_fee, greatest(v_floor, round(p_sale_price::numeric * v_floor / v_pivot)))::bigint;

  update public.boe_items b
  set status = 'sold',
      sold_at = coalesce(p_sold_at, now()),
      sale_price = p_sale_price,
      finder_payout = v_payout,
      guild_cut = p_sale_price - v_fee - v_payout,
      ah_fee = v_fee,
      payout_floor = v_floor,
      payout_pivot = v_pivot
  where b.id = p_id;

  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (v_team_id, auth.uid(), 'BoE Sale Recorded', 'boe_items', p_id,
    to_jsonb(v_item_name || ' sold for ' || public.format_boe_gold(p_sale_price) ||
      'g; finder payout ' || public.format_boe_gold(v_payout) || 'g'));

  return query select p_sale_price, v_payout, p_sale_price - v_fee - v_payout, v_fee;
end $function$;

create or replace function public.boe_retire(p_id integer, p_note text default null::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
  v_team_id integer;
  v_item_name text;
begin
  select b.status, b.team_id, b.item_name into v_status, v_team_id, v_item_name
  from public.boe_items b where b.id = p_id for update;
  if not found then
    raise exception 'BoE item not found';
  end if;
  if not (v_team_id = any (public.my_guild_permission_team_ids('record_boe')) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if v_status <> all (array['found', 'listed']) then
    raise exception 'Cannot retire a % BoE', v_status;
  end if;

  update public.boe_items
  set status = 'retired', retired_at = now(),
      note = coalesce(nullif(trim(coalesce(p_note, '')), ''), note)
  where id = p_id;

  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (v_team_id, auth.uid(), 'BoE Retired', 'boe_items', p_id, to_jsonb(v_item_name));
end $function$;

create or replace function public.boe_revert(p_id integer)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
  v_team_id integer;
  v_item_name text;
  v_new text;
begin
  select b.status, b.team_id, b.item_name into v_status, v_team_id, v_item_name
  from public.boe_items b where b.id = p_id for update;
  if not found then
    raise exception 'BoE item not found';
  end if;
  if v_status = 'paid' then
    if not public.can_settle_boe(v_team_id) then
      raise exception 'Not authorized';
    end if;
  elsif not (v_team_id = any (public.my_guild_permission_team_ids('record_boe')) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  if v_status = 'paid' then
    update public.boe_items set status = 'sold', payout_paid_at = null where id = p_id;
    v_new := 'sold';
  elsif v_status = 'sold' then
    select case when exists (select 1 from public.boe_listings l where l.boe_item_id = p_id)
      then 'listed' else 'found' end into v_new;
    update public.boe_items
    set status = v_new, sold_at = null, sale_price = null, finder_payout = null,
        guild_cut = null, ah_fee = null, payout_floor = null, payout_pivot = null
    where id = p_id;
  elsif v_status = 'listed' then
    if exists (select 1 from public.boe_listings l where l.boe_item_id = p_id) then
      raise exception 'Delete the listing rows first to revert a listed BoE to found';
    end if;
    update public.boe_items set status = 'found' where id = p_id;
    v_new := 'found';
  elsif v_status = 'retired' then
    update public.boe_items set status = 'found', retired_at = null where id = p_id;
    v_new := 'found';
  else
    raise exception 'Nothing to revert on a found BoE';
  end if;

  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (v_team_id, auth.uid(), 'BoE Reverted', 'boe_items', p_id,
    to_jsonb(v_item_name || ': ' || v_status || ' back to ' || v_new));

  return v_new;
end $function$;

-- Checked against the find's own team now, so the row is read first. An
-- unknown id answers null to anyone who records BoE somewhere, as before.
create or replace function public.resolve_boe_finder_discord_id(p_boe_id integer)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.boe_items%rowtype;
  v_discord_id text;
  v_first text;
  v_distinct integer;
begin
  select * into v_row from public.boe_items where id = p_boe_id;

  -- The same check boe_record_sale makes, so this admits exactly the people
  -- who could have caused the message it feeds.
  if v_row.id is null then
    if not (cardinality(public.my_guild_permission_team_ids('record_boe')) > 0 or public.is_site_admin()) then
      raise exception 'Not authorized';
    end if;
    return null;
  end if;
  if not (v_row.team_id = any (public.my_guild_permission_team_ids('record_boe')) or public.is_site_admin()) then
    raise exception 'Not authorized';
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

-- The table rules. Each keeps its name and its other arms.

alter policy "BoE managers update boe_items" on public.boe_items
  using (team_id = any ((select my_guild_permission_team_ids('record_boe'))::integer[])
         or (select is_site_admin()))
  with check (team_id = any ((select my_guild_permission_team_ids('record_boe'))::integer[])
         or (select is_site_admin()));

alter policy "BoE managers delete boe_items" on public.boe_items
  using (team_id = any ((select my_guild_permission_team_ids('record_boe'))::integer[])
         or (select is_site_admin()));

alter policy "BoE managers delete boe_listings" on public.boe_listings
  using (team_id = any ((select my_guild_permission_team_ids('record_boe'))::integer[])
         or (select is_site_admin()));

-- Whoever pays a find has to see it, so pay_any_boe reads as record_boe does.
alter policy "Officers read boe_items" on public.boe_items
  using (team_id = any ((select my_permission_team_ids('pay_boe_cuts'))::integer[])
         or team_id = any ((select my_guild_permission_team_ids('record_boe'))::integer[])
         or team_id = any ((select my_guild_permission_team_ids('pay_any_boe'))::integer[])
         or (select is_site_admin()));

alter policy "Officers read boe_listings" on public.boe_listings
  using (team_id = any ((select my_permission_team_ids('pay_boe_cuts'))::integer[])
         or team_id = any ((select my_guild_permission_team_ids('record_boe'))::integer[])
         or team_id = any ((select my_guild_permission_team_ids('pay_any_boe'))::integer[])
         or (select is_site_admin()));

-- The guild's own rows (bio cards, payout settings) have no team and name
-- the guild as their target, so the guild audit log reads them too
-- (CodeRabbit). Every guild has a team: create_guild() makes its first.
alter policy "Officers read audit_log" on public.audit_log
  using (team_id = any ((select my_permission_team_ids('view_team_audit_log'))::integer[])
         or team_id = any ((select my_guild_permission_team_ids('view_guild_audit_log'))::integer[])
         or (team_id is null and target_type = 'guilds'
             and target_id in (select t.guild_id from teams t
                                where t.id = any ((select my_guild_permission_team_ids('view_guild_audit_log'))::integer[])))
         or (select is_site_admin()));
