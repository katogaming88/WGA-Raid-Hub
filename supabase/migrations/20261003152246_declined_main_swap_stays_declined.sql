-- #1430: a declined main swap stays declined.
--
-- An officer's decline did not stick. request_main_swap() refused only while
-- another request was waiting, so the raider could ask for the same alt again
-- straight away and it was back in the officers' queue. Now a declined request
-- for that alt, from that raider on that team, refuses the ask, with no expiry.
-- The alt is matched by name key (lower case, no spaces), as #1428 matches it,
-- so asking for another spec or picking the alt again from Battle.net (a new
-- characters row) does not get round it. A cancelled request, whether the
-- raider's own or #1428's, does not block, and neither does a decline on
-- another team or another raider's decline.
--
-- The way back stays with officers: they can put the alt on the roster by
-- hand, and next season's signup asks about a main swap again. A button for
-- an officer to let the raider ask again waits until officers need one.
--
-- The check reads main_swap_requests without a lock. A decline cannot race
-- the ask: while the request still waits, the waiting check refuses, and once
-- the decline commits, this check does.

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
   limit 1
  -- Held until the request is saved, so a removal cannot take the character
  -- off the roster between this check and the insert and leave a swap
  -- waiting from it (#1428). Only the character: locking the membership here
  -- too would take it after the character, the opposite of Archive Member.
     for share of p;
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

  -- A decline stands (#1430): the same alt, by name, cannot be asked for
  -- again on this team.
  if exists (
    select 1 from public.main_swap_requests r
     where r.team_id = p_team_id
       and r.person_id = v_person_id
       and r.status = 'declined'
       and lower(replace(r.name_realm, ' ', '')) = v_character.name_realm_key
  ) then
    raise exception 'An officer declined your main swap to %. Ask one of this team''s officers if that should change.',
      v_character.name_realm;
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

comment on column public.main_swap_requests.status is
  'pending until an officer approves or declines it, or it is cancelled: by the raider, or when the character it is from leaves the roster (#1428). A decline stands: request_main_swap() refuses that raider the same alt on that team again (#1430).';
