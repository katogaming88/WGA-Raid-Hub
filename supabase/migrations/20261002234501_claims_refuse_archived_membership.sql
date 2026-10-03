-- #1401: a claim and the Battle.net import refuse an archived membership.
--
-- Since #1423 an officer can archive someone's membership, and it comes back
-- only through an officer (decided on #1355, 2026-10-02): the invite link
-- today, a signup add (#1402), a Roster re-add (#1133) or a role grant
-- (#1403). claim_character() and link_battlenet_roster_characters() both
-- found the person's archived membership and attached the character to it,
-- which skipped that decision and left the membership archived with a live
-- character on it.
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
-- the archived membership, until #1133 or #1402 restores it. So the three
-- reads that decide what a person owns on a team, is_own_player(),
-- my_active_player_ids() and request_main_swap()'s roster lookup, skip an
-- archived membership too, and the person owns nothing there however the
-- character came back.

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

comment on column public.team_members.archived_at is
  'Set when an officer archives this membership (archive_team_member, #1355) for someone who left -- never deleted, so the account''s history keeps pointing at something. Cleared by team_invite_link_join() if they come back. Neither changes it any other way: a direct update of the column is refused (team_members_archived_at_through_functions). Every "what is this person on this team" predicate (my_team_role, my_officer_team_ids, my_leader_team_ids, is_any_team_officer, is_team_leader_anywhere) skips an archived row, and so does every "what does this person own there" read (is_own_player, my_active_player_ids, #1401); my_player_ids() and earlier_characters() still read it, since that is the history.';
