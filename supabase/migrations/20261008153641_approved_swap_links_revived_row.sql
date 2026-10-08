-- #1433: an approved main swap refuses an alt that is someone else's.
--
-- The approval revived the alt's roster row with whatever link it already
-- had. When the alt was once someone else's character on this team, the
-- raider's old character was archived, the alt came back as the other
-- person's, and the "approved" notice went to that person's inbox.
--
-- Moving the row to the raider was rejected: the row carries the other
-- person's loot, attendance, inbox and notes, and the database cannot tell
-- whether the name came back to its owner or was freed and taken by someone
-- else. So a row by that name held by anyone else, on the roster or archived,
-- is refused, and an officer declines the swap or sorts out the row. How a
-- reused name keeps two people's history apart is decided separately. A row
-- nobody holds, or the raider's own, is approved onto as before, and takes
-- the raider's membership.
--
-- The raider is the person on the request. The old character's link used to
-- stand in for them, and a claim removed and taken by someone else while the
-- swap waited would have moved the alt, and the notice, to that person. An
-- old character no longer linked to the raider is refused too.
--
-- The read that decides the refusal holds the row the upsert holds next, so
-- the lock order stays membership, new roster row, old character, request.

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
  v_member_id integer;
  v_prior_member_id integer;
begin
  -- Read without a lock first, for the rows to lock below; the status is
  -- checked again once the request is held.
  select * into v_request from public.main_swap_requests where id = p_request_id;
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

  -- Rows are taken in an order that waits behind an archive instead of
  -- deadlocking with it (#1428): the membership, for share, which the share
  -- a removal or a signup add holds on it (#1432) does not block; then the
  -- new roster row,
  -- which a signup main swap writes before it archives the old character;
  -- then the old character; then the request, which the trigger cancelling a
  -- waiting swap reaches last.
  -- The raider is the person who asked (#1433), not whoever holds the old
  -- character now: a claim removed and taken by someone else while the swap
  -- waited would otherwise move the alt to them.
  select id into v_member_id from public.team_members
   where team_id = v_request.team_id and person_id = v_request.person_id and archived_at is null
     for share;
  if v_member_id is null then
    raise exception 'The raider who asked is no longer on this team';
  end if;
  select * into v_from from public.players where id = v_request.from_player_id;
  if v_from.team_member_id is distinct from v_member_id then
    raise exception '% is no longer linked to the raider who asked', v_from.name_realm;
  end if;

  if p_approve then
    -- A row by that name held by anyone else, on the roster or archived, is
    -- refused (#1433): the row carries that person's history, and only an
    -- officer can say whose the name is now. Held as the upsert below holds it.
    select team_member_id into v_prior_member_id
      from public.players
     where team_id = v_request.team_id
       and name_realm_key = lower(replace(v_request.name_realm, ' ', ''))
       for no key update;
    if v_prior_member_id is not null and v_prior_member_id <> v_member_id then
      raise exception '% is someone else''s character on this team', v_request.name_realm;
    end if;

    -- The character joins the roster, or comes back to it, as the raider's.
    -- Same on-conflict shape as add_signup_to_roster(): a character they
    -- played before keeps its id, so its loot and raid history stay attached
    -- to it.
    insert into public.players (
      team_id, name_realm, class_spec_id, is_trial, join_date, is_backup_tank, is_backup_healer, team_member_id
    )
    values (
      v_request.team_id, v_request.name_realm, v_request.class_spec_id, v_from.is_trial, v_from.join_date,
      v_from.is_backup_tank, v_from.is_backup_healer, v_member_id
    )
    on conflict (team_id, name_realm_key) do update
      set class_spec_id = excluded.class_spec_id,
          is_trial = excluded.is_trial,
          join_date = excluded.join_date,
          is_backup_tank = excluded.is_backup_tank,
          is_backup_healer = excluded.is_backup_healer,
          team_member_id = excluded.team_member_id,
          archived_at = null
    returning id into v_player_id;
  end if;

  select * into v_from from public.players where id = v_request.from_player_id for no key update;
  select * into v_request from public.main_swap_requests where id = p_request_id for update;
  if not found then
    raise exception 'No main swap with id %', p_request_id;
  end if;
  if v_request.status is distinct from 'pending' then
    raise exception 'That main swap was already %', v_request.status;
  end if;

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

  -- Reached only by a swap left waiting without the trigger (a restore with
  -- triggers off): the archive closes every other one first.
  if v_from.archived_at is not null then
    raise exception '% is no longer on the roster', v_from.name_realm;
  end if;

  -- The old character already renamed into the one asked for (the Roster
  -- tab's rename keeps the row): approving would archive the row it approved.
  if v_player_id = v_request.from_player_id then
    raise exception '% is already on the roster as their character', v_request.name_realm;
  end if;

  -- Approved before the old character is archived, so the trigger that cancels
  -- a waiting swap when its character leaves the roster finds this one closed.
  update public.main_swap_requests
     set status = 'approved', reviewed_at = now(), reviewed_by = public.my_person_id(),
         officer_note = v_note, approved_player_id = v_player_id
   where id = p_request_id;

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
