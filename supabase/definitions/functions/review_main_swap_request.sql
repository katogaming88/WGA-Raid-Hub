-- Function public.review_main_swap_request: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

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
  v_live_season text;
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

  -- The old character's standing priority rows for the live season go, the
  -- same as removing them from the roster would: they no longer hold a slot
  -- in the Priority List, the RCLootCouncil export or the addon panel.
  select regexp_replace(ts.config ->> 'seasonName', '^Midnight Season (\d+)$', 'MID\1')
    into v_live_season
    from public.team_settings ts
   where ts.team_id = v_request.team_id;

  if v_live_season is not null then
    delete from public.priority_order
     where team_id = v_request.team_id
       and season = v_live_season
       and player_id = v_request.from_player_id;
  end if;

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
