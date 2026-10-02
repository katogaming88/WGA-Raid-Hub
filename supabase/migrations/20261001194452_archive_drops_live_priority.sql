-- #1383: removing a raider takes them off the live season's priority lists in
-- the same step, whoever removes them.
--
-- The Roster tab archived a raider with archive_player() and then cleared their
-- ranks with a second call, remove_player_priority_order(), aimed at the
-- season the page had in view and with its result ignored. A raider removed
-- from Hellfire on 2026-09-05 still held 26 ranks in MID2 three weeks later,
-- and the RCLootCouncil export listed them on those items. A guild officer,
-- whom archive_player() admits, could never clear them at all: the cleanup and
-- the priority write rule both leave guild officers out (#607).
--
-- A trigger on players.archived_at now drops the ranks inside the archive's
-- own transaction, for every path that archives a character: archive_player(),
-- an officer's direct update, the main swap, the signup promotion, and the
-- membership archive on the way. Only the live tier's ranks go; an earlier
-- tier's list is history. Security definer because the priority write rule
-- would silently filter a guild officer's delete; the archive is the act being
-- authorized, so the delete follows it.
--
-- save_priority_order() refuses a live-season list naming a raider who is no
-- longer on the roster, since a Priority tab opened before the removal would
-- otherwise save them back. build_rclc_export() leaves an archived raider out
-- of the ranked lists, as its BiS read already does.

create or replace function public.drop_archived_player_live_priority() returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  delete from priority_order
   where team_id = new.team_id
     and player_id = new.id
     and season = current_season();
  return new;
end;
$$;

revoke all on function public.drop_archived_player_live_priority() from public, anon, authenticated;

create trigger players_drop_live_priority_on_archive
  after update of archived_at on public.players
  for each row
  when (old.archived_at is null and new.archived_at is not null)
  execute function public.drop_archived_player_live_priority();

-- The ranks raiders already archived still hold in the live tier: 26 on
-- production (2026-10-01), all one raider's.
delete from public.priority_order po
 using public.players p
 where p.id = po.player_id
   and p.archived_at is not null
   and po.season = public.current_season();

-- Its only caller was the Roster tab's second call, which this change removes.
drop function public.remove_player_priority_order(integer, text, integer);

CREATE OR REPLACE FUNCTION public.save_priority_order(p_team_id integer, p_season text, p_item_id integer, p_track text, p_player_ids jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_item_name text;
  v_count integer;
  v_departed text;
begin
  if not (coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false) or public.is_site_admin()) then
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

revoke all on function public.save_priority_order(integer, text, integer, text, jsonb) from public;
revoke execute on function public.save_priority_order(integer, text, integer, text, jsonb) from anon;
grant execute on function public.save_priority_order(integer, text, integer, text, jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.build_rclc_export(p_team_id integer, p_season text, p_track text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_players jsonb;
  v_priority jsonb;
  v_status_labels jsonb;
  v_track_key text;
begin
  if not (coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false) or public.is_site_admin()) then
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

revoke all on function public.build_rclc_export(integer, text, text) from public;
revoke execute on function public.build_rclc_export(integer, text, text) from anon;
grant execute on function public.build_rclc_export(integer, text, text) to authenticated;

-- The promotion and the main swap each deleted the archived character's live
-- ranks themselves. The trigger does it now, inside the same archive.
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

CREATE OR REPLACE FUNCTION public.review_main_swap_request(p_request_id integer, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_request public.main_swap_requests%rowtype;
  v_from public.players%rowtype;
  v_player_id integer;
  v_spec_label text;
  v_note text := nullif(btrim(p_note), '');
begin
  select * into v_request from public.main_swap_requests where id = p_request_id for update;
  if not found then
    raise exception 'No main swap with id %', p_request_id;
  end if;

  if not (coalesce(public.my_team_role(v_request.team_id) = any (array['officer', 'team_leader']), false)
          or public.is_guild_officer()
          or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  if v_request.status is distinct from 'pending' then
    raise exception 'That main swap was already %', v_request.status;
  end if;

  select * into v_from from public.players where id = v_request.from_player_id;

  if not p_approve then
    update public.main_swap_requests
       set status = 'declined', reviewed_at = now(), reviewed_by = public.my_person_id(), officer_note = v_note
     where id = p_request_id;

    -- Written here rather than through notify_player(), whose own check is
    -- the team's officers and site admins: a guild officer may review this.
    insert into public.notifications (team_id, player_id, message)
    values (v_request.team_id, v_request.from_player_id,
            concat('Your main swap to ', v_request.name_realm, ' was declined.',
                   case when v_note is not null then ' ' || v_note end));
    return null;
  end if;

  if v_from.archived_at is not null then
    raise exception '% is no longer on the roster', v_from.name_realm;
  end if;

  -- The character joins the roster, or comes back to it. Same on-conflict
  -- shape as add_signup_to_roster(): a character they played before keeps its
  -- id, so its loot and raid history stay attached to it.
  insert into public.players (
    team_id, name_realm, class_spec_id, is_trial, join_date, is_backup_tank, is_backup_healer, team_member_id
  )
  values (
    v_request.team_id, v_request.name_realm, v_request.class_spec_id, v_from.is_trial, v_from.join_date,
    v_from.is_backup_tank, v_from.is_backup_healer, v_from.team_member_id
  )
  on conflict (team_id, name_realm_key) do update
    set class_spec_id = excluded.class_spec_id,
        is_trial = excluded.is_trial,
        join_date = excluded.join_date,
        is_backup_tank = excluded.is_backup_tank,
        is_backup_healer = excluded.is_backup_healer,
        team_member_id = coalesce(players.team_member_id, excluded.team_member_id),
        archived_at = null
  returning id into v_player_id;

  -- The link stays on the archived character (#941): its attendance, loot and
  -- BoE finds still belong to this person, and step 5b's loot total reads it.
  update public.players set archived_at = now() where id = v_request.from_player_id;

  -- Attendance follows the raider, skipping any night the destination
  -- character already has its own row for (a character they played before).
  update public.attendance a set player_id = v_player_id
   where a.player_id = v_request.from_player_id
     and a.team_id = v_request.team_id
     and not exists (
       select 1 from public.attendance b
        where b.team_id = v_request.team_id
          and b.player_id = v_player_id
          and b.raid_date = a.raid_date
     );


  update public.main_swap_requests
     set status = 'approved', reviewed_at = now(), reviewed_by = public.my_person_id(),
         officer_note = v_note, approved_player_id = v_player_id
   where id = p_request_id;

  -- Audit (#1136): the same two lines a main swap through a signup writes, so
  -- both read alike in the Audit Log.
  select concat_ws(' ', cs.class, cs.spec, cs.role) into v_spec_label
    from public.classes_specs cs where cs.id = v_request.class_spec_id;

  perform public.write_audit_log(
    v_request.team_id, 'Player Added', 'players', v_player_id,
    to_jsonb(concat_ws(', ', coalesce(v_spec_label, 'Unknown spec'), 'main swap from ' || v_from.name_realm))
  );
  perform public.write_audit_log(
    v_request.team_id, 'Main Swap: Old Character Removed', 'players', v_request.from_player_id,
    to_jsonb('Replaced by ' || v_request.name_realm)
  );

  insert into public.notifications (team_id, player_id, message)
  values (v_request.team_id, v_player_id,
          concat('Your main swap to ', v_request.name_realm, ' was approved.',
                 case when v_note is not null then ' ' || v_note end));

  return v_player_id;
end;
$function$;
