-- Function public.request_main_swap: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

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
