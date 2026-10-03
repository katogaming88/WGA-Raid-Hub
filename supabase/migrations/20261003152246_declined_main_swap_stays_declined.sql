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
-- The decline and the waiting request are read in one statement, which takes
-- one snapshot. So a decline that commits while the raider asks again cannot
-- slip between two reads: the ask sees the request either still waiting or
-- declined, and refuses either way. Read separately, a decline landing between
-- them passed both, and only #1428's lock on the character the ask swaps from
-- stopped it, when that was the character the declined request was from.

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
  v_open text;
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

  -- A decline stands for the same alt, by name (#1430). One read for this
  -- and the waiting check below, so a decline landing mid-ask cannot pass both.
  select r.status into v_open
    from public.main_swap_requests r
   where r.team_id = p_team_id
     and r.person_id = v_person_id
     and (r.status = 'pending'
          or (r.status = 'declined' and lower(replace(r.name_realm, ' ', '')) = v_character.name_realm_key))
   order by r.status = 'declined' desc
   limit 1;
  if v_open = 'declined' then
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

  if v_open = 'pending' then
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
  'pending until an officer approves or declines it or the raider cancels it. When the character it is from leaves the roster, a trigger cancels it, or approves it if the alt is on the roster by then (#1428). A decline stands: request_main_swap() refuses that raider the same alt on that team again (#1430).';
