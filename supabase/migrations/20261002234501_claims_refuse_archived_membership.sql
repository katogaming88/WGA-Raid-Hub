-- #1401: a claim and the Battle.net import refuse an archived membership.
--
-- Since #1423 an officer can archive someone's membership, and it comes back
-- only through an officer (decided on #1355, 2026-10-02): the invite link
-- and a signup add (#1402) today, and a Roster re-add (#1133) or a role
-- grant (#1403) to come. claim_character() and
-- link_battlenet_roster_characters() both found the person's archived
-- membership and attached the character to it, which skipped that decision
-- and left the membership archived with a live character on it.
--
-- claim_character() now refuses with a message the current site shows as it
-- stands, and claim_name() (#1355's names table) will reuse. The import
-- reports the team's characters as membership_ended and links nothing,
-- including a character still linked to the archived membership, which it
-- used to call already_yours. A claim or import on any other team is
-- unchanged. Both hold the membership row for share from the check to the
-- link, so an archive committing in between cannot leave a live character
-- on an archived membership.
--
-- Closing the ways in does not make that state impossible: the Roster tab's
-- re-add un-archives a character with a direct write and leaves its link on
-- the archived membership, until #1133 restores it. So the reads
-- that decide what a person owns on a team, is_own_player(),
-- my_active_player_ids(), and the own-character lookups in
-- request_main_swap(), set_own_rsvp() and submit_self_received()'s
-- auto-approval, skip an archived membership too, and the person owns
-- nothing there however the character came back.

CREATE OR REPLACE FUNCTION public.claim_character(p_team_id integer, p_name_realm text)
 RETURNS TABLE(name_realm text, role text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_player_id integer;
  v_member_id integer;
  v_member_role text;
  v_member_archived_at timestamptz;
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

  -- for share: archive_team_member() locks this row before it reads which
  -- characters to sweep, so the check and the link below land wholly before
  -- or wholly after an archive, never in between (#1401).
  select tm.id, tm.role, tm.archived_at into v_member_id, v_member_role, v_member_archived_at
  from public.team_members tm
  where tm.team_id = p_team_id and tm.person_id = public.my_person_id()
  for share;

  -- An archived membership comes back only through an officer (#1401).
  if v_member_archived_at is not null then
    raise exception 'Your membership on this team has ended. Ask one of its officers to add you back.';
  end if;

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

CREATE OR REPLACE FUNCTION public.link_battlenet_roster_characters(p_person_id integer, p_characters jsonb)
 RETURNS TABLE(player_id integer, team_id integer, name_realm text, outcome text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_discord_id text;
  v_row record;
  v_member_id integer;
  v_member_archived_at timestamptz;
begin
  select discord_id into v_discord_id from people where id = p_person_id;
  if not found then
    raise exception 'No person with id %', p_person_id;
  end if;

  for v_row in
    select p.id, p.team_id, p.name_realm, p.team_member_id, tm.person_id as holder, tm.archived_at as holder_archived_at
      from players p
      left join team_members tm on tm.id = p.team_member_id
     where p.archived_at is null
       and p.name_realm_key in (
         select lower(replace((c ->> 'name') || '-' || (c ->> 'realm'), ' ', ''))
           from jsonb_array_elements(coalesce(p_characters, '[]'::jsonb)) c
       )
     order by p.team_id, p.name_realm
  loop
    player_id := v_row.id;
    team_id := v_row.team_id;
    name_realm := v_row.name_realm;

    if v_row.team_member_id is not null then
      outcome := case
                   when v_row.holder <> p_person_id then 'claimed_by_someone_else'
                   when v_row.holder_archived_at is not null then 'membership_ended'
                   else 'already_yours'
                 end;
      return next;
      continue;
    end if;

    -- for share, as claim_character() holds it: an archive cannot slip in
    -- between this check and the link (#1401).
    select tm.id, tm.archived_at into v_member_id, v_member_archived_at
      from team_members tm
     where tm.team_id = v_row.team_id and tm.person_id = p_person_id
       for share;

    if v_member_archived_at is not null then
      outcome := 'membership_ended';
      return next;
      continue;
    end if;

    if v_member_id is null then
      if v_discord_id is null then
        outcome := 'needs_discord';
        return next;
        continue;
      end if;
      insert into team_members (team_id, discord_id, role)
      values (v_row.team_id, v_discord_id, 'raider')
      returning id into v_member_id;
    end if;

    -- The same guard claim_character() rides on: the write only lands on a row
    -- still unclaimed, so a claim racing this one cannot be overwritten.
    update players set team_member_id = v_member_id
     where id = v_row.id and team_member_id is null;

    outcome := case when found then 'linked' else 'claimed_by_someone_else' end;
    return next;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.is_own_player(p_player_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from players p
    join team_members tm on tm.id = p.team_member_id
    where p.id = p_player_id
      and p.archived_at is null
      and tm.archived_at is null
      and tm.person_id = my_person_id()
  );
$function$;

CREATE OR REPLACE FUNCTION public.my_active_player_ids()
 RETURNS integer[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(array_agg(p.id), '{}')
    from players p
    join team_members tm on tm.id = p.team_member_id
   where tm.person_id = my_person_id()
     and p.archived_at is null
     and tm.archived_at is null;
$function$;

CREATE OR REPLACE FUNCTION public.request_main_swap(p_team_id integer, p_character_id integer, p_class_spec_id integer, p_note text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_person_id integer := public.my_person_id();
  v_character public.characters%rowtype;
  v_from_player_id integer;
  v_spec_class text;
  v_request_id integer;
begin
  if v_person_id is null then
    raise exception 'Not signed in';
  end if;

  select * into v_character from public.characters
   where id = p_character_id and person_id = v_person_id;
  if not found then
    raise exception 'That character is not on your account';
  end if;

  select p.id into v_from_player_id
    from public.players p
    join public.team_members tm on tm.id = p.team_member_id
   where p.team_id = p_team_id
     and p.archived_at is null
     and tm.archived_at is null
     and tm.person_id = v_person_id
   order by p.id
   limit 1;
  if v_from_player_id is null then
    raise exception 'You have no character on this team''s roster';
  end if;

  if exists (
    select 1 from public.players p
     where p.team_id = p_team_id
       and p.archived_at is null
       and p.name_realm_key = v_character.name_realm_key
  ) then
    raise exception '% is already on this roster', v_character.name_realm;
  end if;

  select cs.class into v_spec_class from public.classes_specs cs where cs.id = p_class_spec_id;
  if v_spec_class is null then
    raise exception 'Unknown spec';
  end if;
  if v_character.class_name is not null and v_spec_class is distinct from v_character.class_name then
    raise exception '% is a %, not a %', v_character.name, v_character.class_name, v_spec_class;
  end if;

  if exists (
    select 1 from public.main_swap_requests r
     where r.team_id = p_team_id and r.person_id = v_person_id and r.status = 'pending'
  ) then
    raise exception 'You already have a main swap waiting for an officer';
  end if;

  insert into public.main_swap_requests (
    team_id, person_id, from_player_id, character_id, name_realm, class_spec_id, note
  )
  values (
    p_team_id, v_person_id, v_from_player_id, p_character_id,
    v_character.name_realm, p_class_spec_id, nullif(btrim(p_note), '')
  )
  returning id into v_request_id;

  return v_request_id;
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
    and tm.archived_at is null
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
  v_existing_status text;
  v_track_label text := case p_track
    when 'Myth' then ' at Mythic' when 'Hero' then ' at Heroic' when 'Champion' then ' on the Champion track'
    else '' end;
  v_auto_approved boolean := false;
  v_request_id integer;
begin
  select p.id into v_player_id
  from public.players p
  where p.team_id = p_team_id and p.name_realm = p_name_realm and p.archived_at is null
  for update;
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
    raise exception 'You already reported this item%. It is waiting for an officer to review it.', v_track_label;
  end if;

  if auth.uid() is not null
    and coalesce(p_source, '') <> 'Other'
    and (coalesce(p_source, '') = 'Pug raid' or coalesce(p_note, '') !~* '\yraid\y') then
    select true into v_auto_approved
    from public.players p
    join public.team_members tm on tm.id = p.team_member_id
    where p.id = v_player_id and tm.person_id = public.my_person_id() and tm.archived_at is null;
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

comment on column public.team_members.archived_at is
  'Set when an officer archives this membership (archive_team_member, #1355) for someone who left -- never deleted, so the account''s history keeps pointing at something. Cleared when an officer brings them back: team_invite_link_join(), or restore_team_member() when an officer adds their season signup (#1402). Nothing changes it any other way: a direct update of the column is refused (team_members_archived_at_through_functions). Every "what is this person on this team" predicate (my_team_role, my_officer_team_ids, my_leader_team_ids, is_any_team_officer, is_team_leader_anywhere) skips an archived row, and so does every "what does this person own there" read (is_own_player, my_active_player_ids, and the own-character lookups in request_main_swap, set_own_rsvp and submit_self_received, #1401); my_player_ids() and earlier_characters() still read it, since that is the history.';
