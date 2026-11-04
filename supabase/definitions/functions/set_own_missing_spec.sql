-- Function public.set_own_missing_spec: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_own_missing_spec(p_player_id integer, p_class_spec_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_team_id integer;
  v_name_realm text;
  v_spec_class text;
  v_spec_label text;
  v_known_class text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  if not coalesce(public.is_own_player(p_player_id), false) then
    raise exception 'That is not your character.';
  end if;

  select cs.class, cs.spec || ' ' || cs.class into v_spec_class, v_spec_label
    from public.classes_specs cs
   where cs.id = p_class_spec_id;
  if v_spec_class is null then
    raise exception 'Unknown spec.';
  end if;

  select p.team_id, p.name_realm into v_team_id, v_name_realm
    from public.players p
   where p.id = p_player_id;

  select c.class_name into v_known_class
    from public.characters c
   where c.person_id = public.my_person_id()
     and c.name_realm_key = lower(replace(v_name_realm, ' ', ''))
     and c.class_name is not null
   limit 1;
  if v_known_class is not null and v_known_class <> v_spec_class then
    raise exception 'That spec is not one of %''s. Pick a % spec.', v_known_class, v_known_class;
  end if;

  update public.players
     set class_spec_id = p_class_spec_id
   where id = p_player_id
     and class_spec_id is null;
  if not found then
    raise exception 'This character already has a spec. Ask an officer to change it.';
  end if;

  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (v_team_id, v_uid, 'Spec Set by Raider', 'players', p_player_id,
          jsonb_build_object('name_realm', v_name_realm, 'spec', v_spec_label));
end;
$function$;
