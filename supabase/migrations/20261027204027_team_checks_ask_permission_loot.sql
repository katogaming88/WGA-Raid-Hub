-- #1646, part 2 of 2: the loot, priority, scoring, BoE, audit log and
-- team-leader-only checks ask the team grid (#1645) instead of "officer or
-- team leader". Part 1 (20261027192144_team_checks_ask_permission.sql) did
-- the roster, schedule, RSVP, attendance, signup and report checks.
--
--   manage_loot          writing loot, priority, scoring, performance and
--                        gear, raid progress, clearing a wishlist note,
--                        reviewing BiS, M+ and received-item requests and
--                        telling the raider, loot responses, marking received
--   view_loot            reading wishlists and those requests, the RCLC
--                        export, the drift check and the suggested order
--   pay_boe_cuts         the team's own BoE finds and listings, and settling
--   view_team_audit_log  the audit log and the names on it
--   edit_roster          the streamer list (part 1's permission)
--   Team Owner           team settings, the team leaders' direct membership
--                        writes, season start, granting and revoking roles,
--                        archiving an officer
--
-- The Team Owner lines are not on the grid (#1517: "Team Owner only"), so
-- they go through my_leader_team_ids(), which now means the teams the caller
-- owns. Production has one current team leader per team and #1645 made each
-- its owner, so nobody's access moves; a second team leader made later on
-- the current site is an Officer by rank, as #1517 has co-leads.
--
-- The guild officer, BoE Manager and site admin arms are unchanged, and so
-- are is_any_team_officer() and is_team_leader_anywhere(): the guild-level
-- checks (BoE Manager grants, bio cards, resolve_person's BoE flag) are the
-- next issue.

create or replace function public.my_leader_team_ids()
returns integer[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct team_id), '{}')
    from team_members
   where person_id = my_person_id()
     and rank = 'owner'
     and archived_at is null;
$$;

comment on function public.my_leader_team_ids() is
  'The teams the caller owns (#1646): the Team Owner lines of #1517''s grid (team settings, season start, roles). Was "team leader on", which on production is the same people.';

-- The table rules. Each keeps its name and its other arms.

-- Loot, priority and scoring: changing them
alter policy "Officer write loot" on public.rclc_loot
  using (team_id = any ((select my_permission_team_ids('manage_loot'))::integer[])
         or (select is_site_admin()))
  with check (team_id = any ((select my_permission_team_ids('manage_loot'))::integer[])
         or (select is_site_admin()));

alter policy "Officers write priority_order" on public.priority_order
  using (team_id = any ((select my_permission_team_ids('manage_loot'))::integer[])
         or (select is_site_admin()))
  with check (team_id = any ((select my_permission_team_ids('manage_loot'))::integer[])
         or (select is_site_admin()));

alter policy "Officers write priority_order_confirmed_empty" on public.priority_order_confirmed_empty
  using (team_id = any ((select my_permission_team_ids('manage_loot'))::integer[])
         or (select is_site_admin()))
  with check (team_id = any ((select my_permission_team_ids('manage_loot'))::integer[])
         or (select is_site_admin()));

alter policy "Officers manage priority_conflict_dismissals" on public.priority_conflict_dismissals
  using (team_id = any ((select my_permission_team_ids('manage_loot'))::integer[])
         or (select is_site_admin()))
  with check (team_id = any ((select my_permission_team_ids('manage_loot'))::integer[])
         or (select is_site_admin()));

alter policy "Officers manage priority_stale_dismissals" on public.priority_stale_dismissals
  using (team_id = any ((select my_permission_team_ids('manage_loot'))::integer[])
         or (select is_site_admin()))
  with check (team_id = any ((select my_permission_team_ids('manage_loot'))::integer[])
         or (select is_site_admin()));

alter policy "Officers write scoring" on public.scoring
  using ((select players.team_id from players where players.id = scoring.player_id) = any ((select my_permission_team_ids('manage_loot'))::integer[])
         or (select is_site_admin()))
  with check ((select players.team_id from players where players.id = scoring.player_id) = any ((select my_permission_team_ids('manage_loot'))::integer[])
         or (select is_site_admin()));

alter policy "Officers write player_wcl_season_perf" on public.player_wcl_season_perf
  using (team_id = any ((select my_permission_team_ids('manage_loot'))::integer[])
         or (select is_site_admin()))
  with check (team_id = any ((select my_permission_team_ids('manage_loot'))::integer[])
         or (select is_site_admin()));

alter policy "Officers write player_equipped_gear" on public.player_equipped_gear
  using ((select players.team_id from players where players.id = player_equipped_gear.player_id) = any ((select my_permission_team_ids('manage_loot'))::integer[])
         or (select is_site_admin()))
  with check ((select players.team_id from players where players.id = player_equipped_gear.player_id) = any ((select my_permission_team_ids('manage_loot'))::integer[])
         or (select is_site_admin()));

alter policy "Officers write team_raid_progress" on public.team_raid_progress
  using (team_id = any ((select my_permission_team_ids('manage_loot'))::integer[])
         or (select is_site_admin()))
  with check (team_id = any ((select my_permission_team_ids('manage_loot'))::integer[])
         or (select is_site_admin()));

alter policy "Officers clear item_preferences note" on public.item_preferences
  using (team_id = any ((select my_permission_team_ids('manage_loot'))::integer[])
         or (select is_site_admin()))
  with check (team_id = any ((select my_permission_team_ids('manage_loot'))::integer[])
         or (select is_site_admin()));

alter policy "Officers update bis_requests" on public.bis_requests
  using (team_id = any ((select my_permission_team_ids('manage_loot'))::integer[])
         or (select is_site_admin()))
  with check (team_id = any ((select my_permission_team_ids('manage_loot'))::integer[])
         or (select is_site_admin()));

alter policy "Officers update mplus_exclusion_requests" on public.mplus_exclusion_requests
  using (team_id = any ((select my_permission_team_ids('manage_loot'))::integer[])
         or (select is_site_admin()))
  with check (team_id = any ((select my_permission_team_ids('manage_loot'))::integer[])
         or (select is_site_admin()));

alter policy "Officers update self_received_requests" on public.self_received_requests
  using (team_id = any ((select my_permission_team_ids('manage_loot'))::integer[])
         or (select is_site_admin()))
  with check (team_id = any ((select my_permission_team_ids('manage_loot'))::integer[])
         or (select is_site_admin()));

-- Loot: reading wishlists and requests
alter policy "Officers read item_preferences" on public.item_preferences
  using (team_id = any ((select my_permission_team_ids('view_loot'))::integer[])
         or team_id = any ((select my_guild_officer_team_ids())::integer[])
         or (select is_site_admin()));

alter policy "Officers read bis_requests" on public.bis_requests
  using (team_id = any ((select my_permission_team_ids('view_loot'))::integer[])
         or (select is_site_admin()));

alter policy "Officers read mplus_exclusion_requests" on public.mplus_exclusion_requests
  using (team_id = any ((select my_permission_team_ids('view_loot'))::integer[])
         or (select is_site_admin()));

alter policy "Officers read self_received_requests" on public.self_received_requests
  using (team_id = any ((select my_permission_team_ids('view_loot'))::integer[])
         or (select is_site_admin()));

-- BoE cuts for the team's own finds
alter policy "Officers read boe_items" on public.boe_items
  using (team_id = any ((select my_permission_team_ids('pay_boe_cuts'))::integer[])
         or (select is_boe_manager())
         or (select is_site_admin()));

alter policy "Officers read boe_listings" on public.boe_listings
  using (team_id = any ((select my_permission_team_ids('pay_boe_cuts'))::integer[])
         or (select is_boe_manager())
         or (select is_site_admin()));

-- The team audit log and the streamer list
alter policy "Officers read audit_log" on public.audit_log
  using (team_id = any ((select my_permission_team_ids('view_team_audit_log'))::integer[])
         or team_id = any ((select my_guild_officer_team_ids())::integer[])
         or (select is_site_admin()));

alter policy "Officers write streamers" on public.streamers
  using (team_id = any ((select my_permission_team_ids('edit_roster'))::integer[])
         or (select is_site_admin()))
  with check (team_id = any ((select my_permission_team_ids('edit_roster'))::integer[])
         or (select is_site_admin()));

-- The functions. Each body is as it was except its check.

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
  if not (public.is_site_admin() or p_team_id = any (public.my_leader_team_ids())) then
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

  -- Someone archived off the team holds no role on it, so the grant brings
  -- them back with the one it gives, in the row locked above. Their
  -- characters stay archived: an officer re-adds the ones they play.
  if found and v_existing.archived_at is not null then
    -- Only a site admin archives a team leader, so only a site admin brings
    -- anyone back as one; a team leader brings them back below it.
    if p_role = 'team_leader' and not public.is_site_admin() then
      raise exception 'Only a site admin can bring someone who left back as team leader';
    end if;

    perform public.write_audit_log(
      p_team_id, 'team_member_restored', 'team_member', v_existing.id,
      jsonb_build_object('role', p_role, 'archived_role', v_existing.role)
    );

    update public.team_members set archived_at = null, role = p_role
     where id = v_existing.id
     returning auth_user_id into v_auth_user_id;

    perform public.write_audit_log(
      p_team_id, 'team_role_granted', 'team_member', v_existing.id,
      jsonb_build_object('discord_id', p_discord_id, 'role', p_role, 'linked', v_auth_user_id is not null, 'restored', true)
    );

    return v_auth_user_id;
  end if;

  if found then
    -- A current row is never rewritten. `role` drives every team role
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

create or replace function public.admin_revoke_team_role(p_team_id integer, p_discord_id text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_existing public.team_members%rowtype;
  v_claimed integer;
begin
  if not (public.is_site_admin() or p_team_id = any (public.my_leader_team_ids())) then
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

  -- An archived membership holds no role, so there is nothing to take, and
  -- the row is kept as it is (#1403).
  if v_existing.archived_at is not null then
    raise exception 'That Discord account''s membership on this team has ended, so it has no role to remove';
  end if;

  -- players_team_member_id_fkey is ON DELETE SET NULL, so deleting a member a
  -- character points at would silently unclaim that character, with no error
  -- anywhere and nothing in the audit log saying it happened. Somebody who
  -- has claimed a character stays on the team as a raider instead, and so
  -- does somebody with a removal reason on record (#1427).
  select count(*) into v_claimed from public.players where team_member_id = v_existing.id;

  if v_claimed > 0 or exists (select 1 from public.removal_reasons where team_member_id = v_existing.id) then
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

create or replace function public.archive_team_member(p_team_id integer, p_team_member_id integer, p_reason text, p_detail text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_team_id integer;
  v_role text;
  v_rank text;
  v_archived_at timestamptz;
  v_player_ids integer[];
begin
  if not (
    public.has_team_permission(p_team_id, 'edit_roster')
    or public.is_guild_officer_of_team(p_team_id)
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  -- The same seven player_officer_notes.archived_reason accepts.
  if p_reason is null or p_reason not in
     ('schedule_conflict', 'performance', 'drama', 'moved_guilds', 'switching_mains', 'other', 'no_signup') then
    raise exception 'That is not one of the reasons a membership can be archived for';
  end if;

  -- Locked, so two archives of the same person cannot both pass the
  -- already-archived check below.
  select team_id, role, rank, archived_at into v_team_id, v_role, v_rank, v_archived_at
    from public.team_members where id = p_team_member_id
    for update;
  if v_team_id is null or v_team_id <> p_team_id then
    raise exception 'That membership is not on this team';
  end if;

  -- Ending an officer's membership is a role change, which belongs to the team
  -- leader or a site admin, as in admin_revoke_team_role(). The leader's own is
  -- a site admin's alone: a team left with no active leader can only be given
  -- one by a site admin.
  if v_role = 'team_leader' and not public.is_site_admin() then
    raise exception 'Only a site admin can archive the team leader';
  end if;
  if v_role = 'officer'
     and not (p_team_id = any (public.my_leader_team_ids()) or public.is_site_admin()) then
    raise exception 'Only the team leader or a site admin can archive an officer';
  end if;
  -- An Assistant comes back a Raider, so archiving one takes the rank away,
  -- which is the grid's "Promote raiders to Assistant and back" (#1646).
  if v_rank = 'assistant'
     and not (public.has_team_permission(p_team_id, 'promote_assistants')
              or public.is_guild_officer_of_team(p_team_id) or public.is_site_admin()) then
    raise exception 'Only someone who can promote Assistants can archive one';
  end if;

  if v_archived_at is not null then
    return;
  end if;

  select coalesce(array_agg(p.id order by p.id), '{}') into v_player_ids
    from public.players p
   where p.team_member_id = p_team_member_id and p.archived_at is null;

  -- Logged before the archive: write_audit_log() re-checks the caller's own
  -- officer status live, so it has to run while the caller's rows read as
  -- they did when the call started.
  perform public.write_audit_log(
    p_team_id, 'team_member_archived', 'team_member', p_team_member_id,
    jsonb_build_object('reason', p_reason, 'detail', p_detail, 'player_ids', to_jsonb(v_player_ids))
  );

  -- The membership's own reason (#1427). Its characters' rows come from the
  -- notes write below, through record_removal_reason().
  insert into public.removal_reasons (team_id, team_member_id, reason, detail, removed_by)
  values (p_team_id, p_team_member_id, p_reason, p_detail, public.my_person_id());

  update public.team_members set archived_at = now() where id = p_team_member_id;
  update public.players set archived_at = now() where id = any (v_player_ids);

  -- Only the two archive columns are written on conflict, as in
  -- archive_player(): an officer note already on the character stays.
  insert into public.player_officer_notes (player_id, team_id, archived_reason, archived_reason_detail)
  select player_id, p_team_id, p_reason, p_detail from unnest(v_player_ids) as player_id
  on conflict (player_id) do update
     set archived_reason = excluded.archived_reason,
         archived_reason_detail = excluded.archived_reason_detail;
end;
$function$;

create or replace function public.build_rclc_export(p_team_id integer, p_season text, p_track text)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_players jsonb;
  v_priority jsonb;
  v_status_labels jsonb;
  v_track_key text;
begin
  if not (public.has_team_permission(p_team_id, 'view_loot') or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if p_track not in ('Hero', 'Myth') then
    raise exception 'Invalid track';
  end if;
  v_track_key := case p_track when 'Hero' then 'H' when 'Myth' then 'M' end;

  with bis as (
    select
      p.name_realm,
      i.wow_item_id,
      ip.id,
      case coalesce(ip.slot, i.slot)
        -- BIS_SLOTS row labels (an officer-assigned position).
        when 'Head' then 'helm'
        when 'Neck' then 'neck'
        when 'Shoulder' then 'shoulders'
        when 'Back' then 'cloak'
        when 'Chest' then 'chest'
        when 'Wrist' then 'bracers'
        when 'Hands' then 'gloves'
        when 'Waist' then 'belt'
        when 'Legs' then 'legs'
        when 'Feet' then 'boots'
        when 'Finger 1' then 'ring1'
        when 'Finger 2' then 'ring2'
        when 'Trinket 1' then 'trinket1'
        when 'Trinket 2' then 'trinket2'
        when 'Weapon' then 'mh2h'
        when 'Off Hand' then 'oh'
        -- Catalog slots (an item type), reached when a preference row has no
        -- slot of its own. A type cannot say which of a paired position it
        -- fills, so default to the first rather than dropping the entry.
        when 'Finger' then 'ring1'
        when 'Trinket' then 'trinket1'
        when 'Two-Hand' then 'mh2h'
        when 'One-Hand' then 'mh2h'
        when 'Ranged' then 'mh2h'
        when 'Held In Off-hand' then 'oh'
        -- 'Curio' deliberately has no arm: a class-set trade token names no
        -- gear position, so it is not exportable as a BiS slot.
        else null
      end as slot_key
    from public.item_preferences ip
    join public.players p on p.id = ip.player_id
    join public.items i on i.id = ip.item_id
    where p.team_id = p_team_id
      and p.archived_at is null
      and ip.season = p_season
      and ip.status = 'bis'
      and not i.is_placeholder
      and i.source = 'raid'
      and i.wow_item_id is not null
  ),
  bis_by_slot as (
    select name_realm, slot_key, jsonb_agg(wow_item_id order by id) as item_ids
    from bis
    where slot_key is not null
    group by name_realm, slot_key
  ),
  players_agg as (
    select name_realm, jsonb_object_agg(slot_key, jsonb_build_object('bis', item_ids)) as slots
    from bis_by_slot
    group by name_realm
  ),
  -- Same exclusion generate_priority_order() applies at generation time
  -- (#480): a Mythic recipient drops from every track's ranked list for that
  -- item; a Heroic recipient drops from the Heroic list only.
  recip as (
    select
      player_id,
      item_id,
      bool_or(track = 'Myth') as has_myth,
      bool_or(track = 'Hero') as has_hero
    from public.rclc_loot
    where team_id = p_team_id
      and season = p_season
      and player_id is not null
      -- Main spec awards only once the team saved a button list (#1561);
      -- with none, every award, as today.
      and coalesce(public.loot_response_counts_as(p_team_id, response) = 'main', true)
    group by player_id, item_id
  ),
  -- A rank's own player+item wishlist tier, when one actually exists --
  -- only bis/good/ok are wishlist "wants this" tiers (catalyst and pass
  -- aren't ranking signals in that sense, so left unmatched on purpose).
  -- Not every ranked player has a row here: tier-token matching and other
  -- fallback signals in generate_priority_order() can place a player with
  -- no item_preferences entry behind them at all. Scoped to the tier being
  -- exported (#936), the same scope generate_priority_order() ranks in: a
  -- status from another tier beside a rank generated from this one is a label
  -- the addon would show against a pick the raider did not make here.
  -- Deduped to one row per player+item -- a dual-wieldable weapon can have
  -- separate Weapon/Off Hand preference rows for the same item_id, and only
  -- the single best-tier status should ever reach the export.
  wish as (
    select
      player_id,
      item_id,
      (array_agg(status order by
        case status
          when 'bis' then 1
          when 'good' then 2
          when 'ok' then 3
        end
      ))[1] as status
    from public.item_preferences
    where team_id = p_team_id
      and season = p_season
      and status in ('bis', 'good', 'ok')
    group by player_id, item_id
  ),
  prio as (
    select
      i.wow_item_id,
      p.name_realm,
      po.rank,
      w.status as wish_status
    from public.priority_order po
    join public.items i on i.id = po.item_id
    join public.players p on p.id = po.player_id
    left join recip r on r.player_id = po.player_id and r.item_id = po.item_id
    left join wish w on w.player_id = po.player_id and w.item_id = po.item_id
    where po.team_id = p_team_id
      and p.archived_at is null
      and po.season = p_season
      and po.track = p_track
      and not coalesce(r.has_myth, false)
      and not (po.track = 'Hero' and coalesce(r.has_hero, false))
  ),
  prio_agg as (
    select
      wow_item_id,
      jsonb_build_object(v_track_key, jsonb_agg(name_realm order by rank))
      || jsonb_build_object(
           v_track_key || '_status',
           coalesce(
             jsonb_object_agg(name_realm, wish_status) filter (where wish_status is not null),
             '{}'::jsonb
           )
         ) as tracks
    from prio
    group by wow_item_id
  )
  select
    coalesce((select jsonb_object_agg(name_realm, slots) from players_agg), '{}'::jsonb),
    coalesce((select jsonb_object_agg(wow_item_id::text, tracks) from prio_agg), '{}'::jsonb)
  into v_players, v_priority;

  -- WISHLIST_LABEL_DEFAULTS (js/tabs/tab-admin.js) is the site's own
  -- default for each tier -- mirrored here (bis/good/ok only, the only
  -- tiers this export attaches statuses for) so the export always hands
  -- the addon a complete label set, whether or not the team has overridden
  -- any of them.
  select jsonb_build_object('bis', 'BiS', 'good', '2nd Choice', 'ok', 'Sidegrade')
      || coalesce(
           (select ts.config -> 'wishlistStatusLabels' from public.team_settings ts where ts.team_id = p_team_id),
           '{}'::jsonb
         )
  into v_status_labels;

  return jsonb_build_object('players', v_players, 'priority', v_priority, 'statusLabels', v_status_labels);
end;
$function$;

create or replace function public.can_settle_boe(p_team_id integer)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.is_boe_manager()
    or public.is_site_admin()
    or public.has_team_permission(p_team_id, 'pay_boe_cuts');
$function$;

create or replace function public.check_priority_order_drift(p_team_id integer, p_season text)
returns TABLE(item_id integer, item_name text, track text, saved_top3 text[], current_top3 text[])
language plpgsql
stable
set search_path to 'public'
as $function$
begin
  if not (public.has_team_permission(p_team_id, 'view_loot') or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  return query
  with combos as (
    select distinct po.item_id, po.track
    from public.priority_order po
    where po.team_id = p_team_id
      and po.season = p_season
  ),
  saved as (
    select
      po.item_id,
      po.track,
      array_agg(p.name_realm order by po.rank) as top3
    from public.priority_order po
    join public.players p on p.id = po.player_id
    where po.team_id = p_team_id
      and po.season = p_season
      and po.rank <= 3
    group by po.item_id, po.track
  ),
  current as (
    select
      c.item_id,
      c.track,
      array_agg(g.name_realm order by g.ord) as top3
    from combos c
    cross join lateral (
      select t.name_realm, t.ord
      from public.generate_priority_order(p_team_id, p_season, c.item_id, c.track)
        with ordinality as t(player_id, name_realm, role, weighted_total, status_label, wishlist_status, ord)
      order by t.ord
      limit 3
    ) g
    group by c.item_id, c.track
  )
  select
    co.item_id,
    i.name,
    co.track,
    coalesce(s.top3, array[]::text[]),
    coalesce(cu.top3, array[]::text[])
  from combos co
  join public.items i on i.id = co.item_id
  left join saved s on s.item_id = co.item_id and s.track = co.track
  left join current cu on cu.item_id = co.item_id and cu.track = co.track
  where coalesce(s.top3, array[]::text[]) is distinct from coalesce(cu.top3, array[]::text[])
  order by i.name, co.track;
end;
$function$;

create or replace function public.delete_self_received_request(p_id integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_team_id integer;
  v_player_id integer;
  v_item_id integer;
  v_status text;
  v_track text;
  v_source text;
  v_slot text;
  v_player_name text;
  v_item_name text;
begin
  select r.team_id, r.player_id, r.self_item_id, r.status, r.track, r.source, r.slot
    into v_team_id, v_player_id, v_item_id, v_status, v_track, v_source, v_slot
  from public.self_received_requests r
  where r.id = p_id
  for update;
  if not found then
    raise exception 'Self-received request not found';
  end if;

  if not (public.has_team_permission(v_team_id, 'manage_loot')
          or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  select p.name_realm into v_player_name from public.players p where p.id = v_player_id;
  select i.name into v_item_name from public.items i where i.id = v_item_id;

  delete from public.self_received_requests where id = p_id;

  perform public.write_audit_log(
    v_team_id,
    'Self-Received Deleted',
    'players',
    v_player_id,
    to_jsonb(
      'Deleted ' || v_status || ' request: ' || coalesce(v_item_name, 'unknown item')
      || coalesce(' (' || nullif(v_slot, '') || ')', '')
      || coalesce(', ' || v_track, '')
      || coalesce(', ' || v_source, '')
      || case when v_player_id is null or v_player_name is null
              then ', player no longer on roster' else '' end
    )
  );
end $function$;

create or replace function public.direct_mark_received(p_team_id integer, p_name_realm text, p_item_name text, p_track text default NULL::text, p_source text default NULL::text, p_note text default NULL::text, p_slot text default NULL::text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_player_id integer;
  v_item_id integer;
  v_existing_status text;
  v_track_label text := case p_track
    when 'Myth' then ' at Mythic' when 'Hero' then ' at Heroic' when 'Champion' then ' on the Champion track'
    else '' end;
  v_request_id integer;
begin
  if not (public.has_team_permission(p_team_id, 'manage_loot') or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  select p.id into v_player_id
  from public.players p
  where p.team_id = p_team_id and p.name_realm = p_name_realm and p.archived_at is null
  for update;
  if not found then
    raise exception 'Character not found on roster';
  end if;

  select i.id into v_item_id from public.items i where i.name = p_item_name;
  if not found then
    raise exception 'Unknown item: %', p_item_name;
  end if;

  select r.status into v_existing_status
  from public.self_received_requests r
  where r.player_id = v_player_id
    and r.self_item_id = v_item_id
    and r.slot is not distinct from nullif(p_slot, '')
    and r.track is not distinct from p_track
    and r.status in ('pending', 'approved')
  order by r.status
  limit 1;
  if v_existing_status = 'approved' then
    raise exception 'This item is already marked received% for this character.', v_track_label;
  elsif v_existing_status = 'pending' then
    raise exception 'A report for this item% is already waiting for review. Approve or reject that one instead of marking it again.', v_track_label;
  end if;

  insert into public.self_received_requests
    (team_id, player_id, self_item_id, track, source, note, slot, status)
  values
    (p_team_id, v_player_id, v_item_id, p_track, nullif(p_source, ''), nullif(p_note, ''),
     nullif(p_slot, ''), 'approved')
  returning self_received_requests.id into v_request_id;

  return v_request_id;
end $function$;

create or replace function public.generate_priority_order(p_team_id integer, p_season text, p_item_id integer, p_track text)
returns TABLE(player_id integer, name_realm text, role text, weighted_total numeric, status_label text, wishlist_status text)
language plpgsql
stable
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_item_slot text;
  v_equipment_slots text[];
begin
  if not (public.has_team_permission(p_team_id, 'view_loot') or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if p_track not in ('Hero', 'Myth') then
    raise exception 'Invalid track';
  end if;

  select i.slot into v_item_slot from public.items i where i.id = p_item_id;

  v_equipment_slots := case v_item_slot
    when 'Head' then array['HEAD']
    when 'Neck' then array['NECK']
    when 'Shoulder' then array['SHOULDER']
    when 'Back' then array['BACK']
    when 'Chest' then array['CHEST']
    when 'Wrist' then array['WRIST']
    when 'Hands' then array['HANDS']
    when 'Waist' then array['WAIST']
    when 'Legs' then array['LEGS']
    when 'Feet' then array['FEET']
    when 'Finger' then array['FINGER_1', 'FINGER_2']
    when 'Trinket' then array['TRINKET_1', 'TRINKET_2']
    when 'One-Hand' then array['MAIN_HAND']
    when 'Two-Hand' then array['MAIN_HAND']
    when 'Ranged' then array['MAIN_HAND']
    when 'Off Hand' then array['OFF_HAND']
    else array[]::text[]
  end;

  return query
  -- The picks filed under the tier being generated, and only those (#936).
  -- A raider holds a separate pick for the same item in each tier since the
  -- unique key carried the season, so the strongest status across every row
  -- would let a BiS mark left in an earlier tier outvote this tier's pass.
  with wishlist as (
    select
      ip.player_id,
      (array_agg(ip.status order by
        case ip.status
          when 'bis' then 1
          when 'good' then 2
          when 'catalyst' then 3
          when 'ok' then 4
          when 'pass' then 5
        end
      ))[1] as status
    from public.item_preferences ip
    join public.players p on p.id = ip.player_id
    where ip.item_id = p_item_id
      and p.team_id = p_team_id
      and p.archived_at is null
      and ip.season = p_season
    group by ip.player_id
  ),
  candidates as (
    select player_id from wishlist where status <> 'pass'
  ),
  -- wow_item_id space, not items.id (20260913004747). Null entries drop out
  -- on their own: an IN-list containing only null matches nothing. The
  -- item_id alias is load-bearing -- see that migration for why an
  -- unaliased column here silently becomes a self-referential tautology.
  equipped_item_ids as (
    select wow_item_id as item_id from public.items where id = p_item_id
    union
    select i.wow_item_id as item_id
    from public.tier_token_map ttm
    join public.items i on i.id = ttm.resolved_item_id
    where ttm.token_item_id = p_item_id
      and ttm.season = p_season
  ),
  recip as (
    select
      player_id,
      bool_or(track = 'Myth') as has_myth,
      bool_or(track = 'Hero') as has_hero,
      bool_or(track = 'Champion') as has_champ
    from (
      select player_id, track
      from public.rclc_loot
      where team_id = p_team_id
        and item_id = p_item_id
        and season = p_season
        and player_id is not null
        -- A Main spec award under the team's button list (#1561); with no
        -- list saved, today's rule: anything but an OS or M+ roll.
        and coalesce(
          public.loot_response_counts_as(p_team_id, response) = 'main',
          not coalesce(response ~* '\mos\M', false) and not coalesce(response ~* 'm\+', false)
        )
      union all
      select player_id, track
      from public.self_received_requests
      where team_id = p_team_id
        and self_item_id = p_item_id
        and status = 'approved'
        and player_id is not null
      union all
      select peg.player_id, peg.track
      from public.player_equipped_gear peg
      join public.players p on p.id = peg.player_id
      where p.team_id = p_team_id
        and p.archived_at is null
        and peg.wow_item_id in (select item_id from equipped_item_ids where item_id is not null)
    ) owned
    group by player_id
  ),
  -- The lowest track worn across this item's equipment slot(s), as a rank
  -- (3 = Myth, 2 = Hero, 1 = anything lower, 0 = nothing worn). min() over
  -- the slots gives rings/trinkets their lower-of-two grading and is a
  -- no-op for the single-slot cases. A slot with no synced row contributes
  -- nothing to min(), so the count check below catches an unfilled half of
  -- a pair and drops the whole thing to the lowest step.
  equipped as (
    select
      peg.player_id,
      case
        when count(*) < coalesce(array_length(v_equipment_slots, 1), 0) then 0
        else min(case peg.track when 'Myth' then 3 when 'Hero' then 2 else 1 end)
      end as slot_track_rank
    from public.player_equipped_gear peg
    where peg.equipment_slot = any (v_equipment_slots)
    group by peg.player_id
  ),
  tier_meta as (
    select exists(
      select 1 from public.tier_token_map
      where token_item_id = p_item_id
        and season = p_season
    ) as is_tier_token
  ),
  existing_priority as (
    select
      po.player_id,
      avg(po.rank) as avg_existing_rank
    from public.priority_order po
    where po.team_id = p_team_id
      and po.season = p_season
      and po.track = p_track
      and po.item_id <> p_item_id
    group by po.player_id
  ),
  base as (
    select
      p.id as player_id,
      p.name_realm,
      cs.role,
      p.is_bench,
      p.is_trial,
      p.is_rotator,
      p.tier_pieces_equipped,
      sc.performance_score,
      sc.attendance_score,
      coalesce(r.has_myth, false) as has_myth,
      coalesce(r.has_hero, false) as has_hero,
      coalesce(r.has_champ, false) as has_champ,
      coalesce(e.slot_track_rank, 0) as slot_track_rank,
      w.status as wishlist_status,
      tm.is_tier_token,
      ep.avg_existing_rank
    from candidates c
    join public.players p on p.id = c.player_id
    left join public.classes_specs cs on cs.id = p.class_spec_id
    left join public.scoring sc on sc.player_id = p.id and sc.season = p_season
    left join recip r on r.player_id = p.id
    left join equipped e on e.player_id = p.id
    left join wishlist w on w.player_id = p.id
    left join existing_priority ep on ep.player_id = p.id
    cross join tier_meta tm
    where not coalesce(r.has_myth, false)
      and not (p_track = 'Hero' and coalesce(r.has_hero, false))
  ),
  scored as (
    select
      player_id,
      name_realm,
      role,
      case
        when role in ('Tank', 'Heal') then
          case when attendance_score > 0 then attendance_score else null end
        else
          case
            when performance_score > 0 or attendance_score > 0
              then round((coalesce(performance_score, 0) * 0.5 + coalesce(attendance_score, 0) * 0.5), 1)
            else null
          end
      end as raw_score,
      case role
        when 'Tank' then 0.50
        when 'Heal' then 0.75
        else 1.0
      end as role_mult,
      -- Sort tier only, no longer a score input: 0 = full status, 1 =
      -- trial, 2 = rotator (#924), 3 = bench. Precedence when more than one
      -- flag is somehow set: bench > rotator > trial, matching the old
      -- bench-over-trial precedence this branch already had.
      case when is_bench then 3 when is_rotator then 2 when is_trial then 1 else 0 end as status_tier,
      -- Wishlist status as a hard sort tier, not just a score multiplier --
      -- BiS always outranks Good, which always outranks OK/Catalyst (tied),
      -- regardless of raw_score. Tier tokens keep their existing binary
      -- split (0 = keeping it, 1 = any sidegrade tag) since tier_rank is a
      -- stronger, more specific signal there than a 3-way wishlist split
      -- would add.
      case
        when is_tier_token then
          case
            when wishlist_status = 'bis' then 0
            else 1
          end
        when wishlist_status = 'bis' then 0
        when wishlist_status = 'good' then 1
        when wishlist_status in ('ok', 'catalyst') then 2
        else 0
      end as wishlist_rank,
      case
        when not is_tier_token then 0
        else case coalesce(tier_pieces_equipped, 0)
          when 1 then 1
          when 0 then 2
          when 3 then 3
          when 2 then 4
          when 4 then 5
          else 6
        end
      end as tier_rank,
      avg_existing_rank,
      is_tier_token,
      tier_pieces_equipped,
      is_bench,
      is_trial,
      is_rotator,
      has_myth,
      has_hero,
      has_champ,
      slot_track_rank,
      wishlist_status
    from base
  ),
  multiplied as (
    select
      player_id,
      name_realm,
      role,
      raw_score,
      status_tier,
      wishlist_rank,
      tier_rank,
      avg_existing_rank,
      wishlist_status,
      (role_mult
      -- Item-ownership multipliers stack on top, mythic and heroic branches
      -- are mutually exclusive since p_track is one or the other.
      * case when p_track = 'Myth' and has_hero then 0.85 else 1.0 end
      * case when p_track = 'Myth' and has_champ and not has_hero then 1.07 else 1.0 end
      * case when p_track = 'Myth' and not has_hero and not has_champ then 1.15 else 1.0 end
      * case when p_track = 'Hero' and has_champ then 0.90 else 1.0 end
      -- Equipped-slot track steps: a weaker, independent signal from the
      -- same-item ones above -- "already itemized here," not "already owns
      -- this drop." Applies to both generated tracks alike; the question
      -- (how well is this slot already covered, and can they improve it
      -- themselves) does not change with the track being handed out.
      * case slot_track_rank when 3 then 0.92 when 2 then 0.96 else 1.0 end
      -- Wishlist multiplier (#515): 'bis' stays at 1.0. 'pass' never reaches
      -- here -- already excluded by the candidates CTE above.
      * case wishlist_status
          when 'bis' then 1.0
          when 'good' then 0.90
          when 'ok' then 0.60
          when 'catalyst' then 0.75
          else 1.0
        end
      ) as final_mult,
      (case
        when is_bench then 'Bench'
        when is_rotator then 'Rotator'
        when is_trial then 'Trial'
        else ''
      end) as base_status,
      case when is_tier_token then 'Tier: ' || coalesce(tier_pieces_equipped, 0) || '/5' end as tier_status_label,
      case when p_track = 'Myth' and has_hero then 'Has Heroic' end as myth_hero_status,
      case when p_track = 'Myth' and has_champ and not has_hero then 'Has Champion' end as myth_champ_status,
      case when p_track = 'Myth' and not has_hero and not has_champ then 'No Version' end as myth_neither_status,
      case when p_track = 'Hero' and has_champ then 'Has Champion' end as hero_champ_status,
      -- No longer says "ilvl": the step is the slot's actual gear track now,
      -- not whether an item level cleared a threshold.
      case slot_track_rank
        when 3 then 'Myth Equipped (Slot)'
        when 2 then 'Hero Equipped (Slot)'
      end as slot_track_status
    from scored
  )
  select
    player_id,
    name_realm,
    role,
    case when raw_score is not null then round(raw_score * final_mult, 1) end as weighted_total,
    nullif(
      array_to_string(
        array_remove(
          array[
            nullif(base_status, ''),
            tier_status_label,
            myth_hero_status,
            myth_champ_status,
            myth_neither_status,
            hero_champ_status,
            slot_track_status
          ],
          null
        ),
        ', '
      ),
      ''
    ) as status_label,
    wishlist_status
  from multiplied
  order by
    status_tier asc,
    wishlist_rank asc,
    tier_rank asc,
    avg_existing_rank desc nulls first,
    coalesce(case when raw_score is not null then round(raw_score * final_mult, 1) end, -1) desc;
end;
$function$;

create or replace function public.import_rclc_loot(p_team_id integer, p_season text, p_rows jsonb)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_row jsonb;
  v_name_realm text;
  v_player_id integer;
  v_item_id integer;
  v_track text;
  v_track_from_bonus text;
  v_instance text;
  v_item_string text;
  v_string_parts text[];
  v_num_bonus integer;
  v_bonus_ids integer[];
  v_awarded_at timestamptz;
  v_rclc_id text;
  v_dedupe_key text;
  v_boss text;
  v_response text;
  v_new_id integer;
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_unresolved_item integer := 0;
  v_detail text;
  -- Season MID2 raid gear track bonus IDs -- see migration header comment.
  c_champion_bonus_ids constant integer[] := array[12833,12834,12835,12836,12837,12838];
  c_hero_bonus_ids constant integer[] := array[12841,12842,12843,12844,12845,12846];
  c_myth_bonus_ids constant integer[] := array[12849,12850,12851,12852,12853,12854,13848];
begin
  if not (public.has_team_permission(p_team_id, 'manage_loot') or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_name_realm := trim(both from coalesce(v_row->>'player', ''));
    v_rclc_id := nullif(trim(both from coalesce(v_row->>'id', '')), '');
    if v_name_realm = '' or v_rclc_id is null then
      continue;
    end if;

    -- Player: name_realm match, ignoring case and whitespace. RCLC's
    -- UnitName()-sourced realm strips spaces from multi-word realms
    -- ("Wyrmrest Accord" -> "WyrmrestAccord"); the DB's officer-typed
    -- name_realm keeps them. Comparing with spaces stripped from both sides
    -- makes either shape resolve to the same row. Unknown names still get
    -- an archived stub (same shape as the #320 import's stub rows), never
    -- a null player_id.
    select id into v_player_id from public.players
     where team_id = p_team_id
       and lower(replace(name_realm, ' ', '')) = lower(replace(v_name_realm, ' ', ''));
    if v_player_id is null then
      insert into public.players (team_id, name_realm, archived_at)
      values (p_team_id, v_name_realm, now())
      returning id into v_player_id;
    end if;

    -- Item: wow_item_id first (RCLC provides itemID directly and it's
    -- unambiguous), item name as fallback. Left null, not auto-created, when
    -- neither resolves -- a genuinely unresolved item means the season's Item
    -- Lookup needs updating, not something to paper over with a placeholder
    -- row (see docs/database-decisions.md).
    v_item_id := null;
    if (v_row->>'itemID') is not null and (v_row->>'itemID') ~ '^\d+$' then
      select id into v_item_id from public.items
       where wow_item_id = (v_row->>'itemID')::integer
       order by id limit 1;
    end if;
    if v_item_id is null and coalesce(v_row->>'itemName', '') <> '' then
      select id into v_item_id from public.items
       where lower(name) = lower(v_row->>'itemName')
       limit 1;
    end if;
    if v_item_id is null then
      v_unresolved_item := v_unresolved_item + 1;
    end if;

    -- Track, preferred source: the item's own bonus IDs (see header
    -- comment). v_bonus_ids/v_num_bonus reset every row -- a plpgsql
    -- variable keeps its value across loop iterations if not reassigned,
    -- and a row with no itemString must not inherit the previous row's.
    v_track_from_bonus := null;
    v_bonus_ids := null;
    v_item_string := coalesce(v_row->>'itemString', '');
    if v_item_string <> '' then
      v_string_parts := string_to_array(v_item_string, ':');
      if array_length(v_string_parts, 1) >= 14 then
        v_num_bonus := nullif(v_string_parts[14], '')::integer;
        if v_num_bonus is not null and v_num_bonus > 0
           and array_length(v_string_parts, 1) >= 14 + v_num_bonus then
          select array_agg(x::integer) into v_bonus_ids
            from unnest(v_string_parts[15 : 14 + v_num_bonus]) x
           where x ~ '^\d+$';
        end if;
      end if;
    end if;
    if v_bonus_ids is not null then
      v_track_from_bonus := case
        when v_bonus_ids && c_champion_bonus_ids then 'Champion'
        when v_bonus_ids && c_hero_bonus_ids then 'Hero'
        when v_bonus_ids && c_myth_bonus_ids then 'Myth'
        else null
      end;
    end if;

    -- Track, fallback source: search anywhere in the instance string for a
    -- standalone difficulty word (e.g. "The Dreamrift-Mythic" -> Myth,
    -- "Sporefall-Mythic - Flexible Raiding" -> Myth too) rather than
    -- assuming a fixed "<Name>-<Difficulty>" shape (20260806214054). Only
    -- used when the bonus IDs above didn't resolve a track -- prose can
    -- drift (see header comment), the item's own bonus IDs can't.
    v_instance := coalesce(v_row->>'instance', '');
    v_track := coalesce(v_track_from_bonus, case
      when v_instance ~* '\mmythic\M' then 'Myth'
      when v_instance ~* '\mheroic\M' then 'Hero'
      when v_instance ~* '\mnormal\M' then 'Champion'
      else null
    end);

    -- awarded_at: RCLC's date/time are the raid's local wall-clock time, same
    -- assumption the rest of the site already makes for this data (see
    -- mapSupabaseLoot()'s America/New_York formatting in js/common.js).
    -- Falls back to the import moment if either field is unparseable rather
    -- than failing the whole row.
    begin
      v_awarded_at := (
        to_date(replace(coalesce(v_row->>'date', ''), '/', '-'), 'YYYY-MM-DD')
        + coalesce(nullif(v_row->>'time', '')::interval, interval '0')
      ) at time zone 'America/New_York';
    exception when others then
      v_awarded_at := now();
    end;

    v_boss := nullif(trim(both from coalesce(v_row->>'boss', '')), '');
    v_response := nullif(trim(both from coalesce(v_row->>'response', '')), '');
    v_dedupe_key := 't' || p_team_id || ':rclc:' || v_rclc_id;

    insert into public.rclc_loot
      (team_id, player_id, item_id, track, season, awarded_at, rclc_id, dedupe_key, boss, response)
    values
      (p_team_id, v_player_id, v_item_id, v_track, nullif(p_season, ''), v_awarded_at, v_rclc_id, v_dedupe_key, v_boss, v_response)
    on conflict (dedupe_key) do nothing
    returning id into v_new_id;

    if v_new_id is not null then
      v_inserted := v_inserted + 1;
      v_detail := coalesce(v_track || ' - ', '') || coalesce(nullif(v_row->>'itemName', ''), 'Unknown item');
      perform public.write_audit_log(
        p_team_id, 'Loot Imported (RCLC)', 'players', v_player_id,
        jsonb_build_object('summary', v_detail, 'season', nullif(p_season, ''))
      );
    else
      v_skipped := v_skipped + 1;
    end if;
    v_new_id := null;
  end loop;

  return jsonb_build_object(
    'inserted', v_inserted,
    'skipped_duplicate', v_skipped,
    'unresolved_item', v_unresolved_item
  );
end;
$function$;

create or replace function public.notify_player(p_player_id integer, p_message text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_team_id integer;
  v_id integer;
begin
  select team_id into v_team_id from players where id = p_player_id;
  if v_team_id is null then
    raise exception 'Unknown player_id %', p_player_id;
  end if;

  if not (public.has_team_permission(v_team_id, 'manage_loot') or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  insert into public.notifications (team_id, player_id, message)
  values (v_team_id, p_player_id, p_message)
  returning id into v_id;

  return v_id;
end;
$function$;

create or replace function public.resolve_actor_name(p_actor_id uuid, p_team_id integer)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_member_id integer;
  v_tm_name_realm text;
  v_player_name_realm text;
  v_nickname text;
  v_display text;
begin
  if not (public.has_team_permission(p_team_id, 'view_team_audit_log') or public.is_site_admin()) then
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

create or replace function public.save_priority_order(p_team_id integer, p_season text, p_item_id integer, p_track text, p_player_ids jsonb)
returns integer
language plpgsql
set search_path to 'public'
as $function$
declare
  v_item_name text;
  v_count integer;
  v_departed text;
begin
  if not (public.has_team_permission(p_team_id, 'manage_loot') or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if p_track not in ('Hero', 'Myth') then
    raise exception 'Invalid track';
  end if;

  -- A page opened before a raider left still lists them. An earlier tier keeps
  -- whoever was on its lists, so only the live tier is checked (#1383).
  if p_season = public.current_season() then
    select p.name_realm into v_departed
      from jsonb_array_elements_text(coalesce(p_player_ids, '[]'::jsonb)) with ordinality as t(elem, ord)
      join public.players p on p.id = (t.elem)::integer
     where p.archived_at is not null
     order by t.ord
     limit 1;
    if v_departed is not null then
      raise exception '% is no longer on the roster. Reload the page to get the current list.', v_departed;
    end if;
  end if;

  delete from public.priority_order
   where team_id = p_team_id
     and season = p_season
     and item_id = p_item_id
     and track = p_track;

  insert into public.priority_order (team_id, season, item_id, track, rank, player_id, updated_at)
  select p_team_id, p_season, p_item_id, p_track, ord::integer, (elem)::integer, now()
  from jsonb_array_elements_text(coalesce(p_player_ids, '[]'::jsonb)) with ordinality as t(elem, ord);

  get diagnostics v_count = row_count;

  if v_count = 0 then
    insert into public.priority_order_confirmed_empty (team_id, season, item_id, track, marked_at)
    values (p_team_id, p_season, p_item_id, p_track, now())
    on conflict (team_id, season, item_id, track) do update set marked_at = excluded.marked_at;
  else
    delete from public.priority_order_confirmed_empty
     where team_id = p_team_id
       and season = p_season
       and item_id = p_item_id
       and track = p_track;
  end if;

  select name into v_item_name from public.items where id = p_item_id;

  perform public.write_audit_log(
    p_team_id,
    'Priority Order Saved',
    'items',
    p_item_id,
    jsonb_build_object('item', v_item_name, 'track', p_track, 'players', v_count)
  );

  return v_count;
end;
$function$;

create or replace function public.set_loot_responses(p_team_id integer, p_responses jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_config jsonb;
  v_group jsonb;
  v_button jsonb;
  v_count integer := 0;
begin
  if not (
    public.has_team_permission(p_team_id, 'manage_loot')
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if jsonb_typeof(p_responses) is distinct from 'object'
    or jsonb_typeof(p_responses -> 'buttons') is distinct from 'array'
    or jsonb_typeof(p_responses -> 'groups') is distinct from 'array'
  then
    raise exception 'The button list must have buttons and groups.';
  end if;

  for v_group in select g from jsonb_array_elements(p_responses -> 'groups') as g loop
    if jsonb_typeof(v_group -> 'name') is distinct from 'string'
      or length(btrim(v_group ->> 'name')) not between 1 and 60
    then
      raise exception 'Every button group needs a name.';
    end if;
    if jsonb_typeof(v_group -> 'buttons') is distinct from 'array' then
      raise exception 'Button group "%" needs a list of buttons.', v_group ->> 'name';
    end if;
  end loop;

  -- The normal buttons and every group's buttons, checked alike.
  for v_button in
    select b from jsonb_array_elements(p_responses -> 'buttons') as b
    union all
    select b
    from jsonb_array_elements(p_responses -> 'groups') as g,
      jsonb_array_elements(g -> 'buttons') as b
  loop
    if jsonb_typeof(v_button -> 'text') is distinct from 'string'
      or length(btrim(v_button ->> 'text')) not between 1 and 100
    then
      raise exception 'Every button needs its text, as spelled in game.';
    end if;
    if (v_button ->> 'countsAs') is null
      or (v_button ->> 'countsAs') not in ('main', 'off', 'none', 'hidden')
    then
      raise exception 'Button "%" needs what it counts as.', v_button ->> 'text';
    end if;
    v_count := v_count + 1;
  end loop;

  update public.team_settings
  set config = config || jsonb_build_object('lootResponses', p_responses)
  where team_id = p_team_id
  returning config into v_config;

  if not found then
    raise exception 'Not authorized';
  end if;

  perform public.write_audit_log(
    p_team_id,
    'Loot Responses Saved',
    'team_settings',
    null,
    jsonb_build_object('buttons', v_count, 'groups', jsonb_array_length(p_responses -> 'groups'))
  );

  return v_config;
end;
$function$;

