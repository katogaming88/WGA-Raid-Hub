-- Function public.add_own_character: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.add_own_character(p_team_id integer, p_character_id integer, p_class_spec_id integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_person_id integer := public.my_person_id();
  v_member_id integer;
  v_member_archived boolean;
  v_character public.characters%rowtype;
  v_spec_class text;
  v_spec_label text;
  v_player_id integer;
  v_today date := (now() at time zone 'America/New_York')::date;
begin
  if v_uid is null or v_person_id is null then
    raise exception 'Not signed in';
  end if;

  -- The membership first, the order every roster write takes (#1432), so this
  -- waits behind Archive Member instead of racing it. Stronger than the share
  -- hold the officers' writes take, so two of the caller's own adds (a double
  -- click, two tabs) queue too and the second finds the first's character.
  select tm.id, tm.archived_at is not null into v_member_id, v_member_archived
    from public.team_members tm
   where tm.team_id = p_team_id and tm.person_id = v_person_id
     for no key update;
  if v_member_id is null then
    raise exception 'You are not on this team';
  end if;
  if v_member_archived then
    raise exception 'Your place on this team has ended. Ask one of its officers to bring you back.';
  end if;

  select * into v_character from public.characters
   where id = p_character_id and person_id = v_person_id;
  if not found then
    raise exception 'That character is not on your account';
  end if;

  select cs.class, concat_ws(' ', cs.class, cs.spec, cs.role)
    into v_spec_class, v_spec_label
    from public.classes_specs cs where cs.id = p_class_spec_id;
  if v_spec_class is null then
    raise exception 'Unknown spec';
  end if;
  if v_character.class_name is not null and v_spec_class is distinct from v_character.class_name then
    raise exception '% is a %, not a %', v_character.name, v_character.class_name, v_spec_class;
  end if;

  if exists (
    select 1 from public.players p
     where p.team_id = p_team_id and p.team_member_id = v_member_id and p.archived_at is null
  ) then
    raise exception 'You already have a character on this team''s roster. Ask for a main swap instead.';
  end if;

  -- One statement for a new character and a returning one. A new one starts
  -- as a trial joining today. A returning one keeps its own trial flag, join
  -- date and history, as an officer's re-add does (restore_player()); the
  -- backup flags and the wishlist and BiS exceptions an officer set for its
  -- last stint do not carry over, as with the signup add and the invite link.
  insert into public.players (team_id, name_realm, class_spec_id, is_trial, join_date, team_member_id)
  values (p_team_id, v_character.name_realm, p_class_spec_id, true, v_today, v_member_id)
  on conflict (team_id, name_realm_key) do update
     set team_member_id = excluded.team_member_id,
         class_spec_id = excluded.class_spec_id,
         is_bench = false,
         is_backup_tank = false,
         is_backup_healer = false,
         wishlist_allowed = false,
         bis_allowed = false,
         archived_at = null
   -- Only a character off the roster, and never one someone else held here.
   where players.archived_at is not null
     and (players.team_member_id is null or players.team_member_id = excluded.team_member_id)
  returning id into v_player_id;

  if v_player_id is null then
    if exists (
      select 1 from public.players p
       where p.team_id = p_team_id and p.name_realm_key = v_character.name_realm_key and p.archived_at is null
    ) then
      raise exception '% is already on this roster', v_character.name_realm;
    end if;
    raise exception '% was someone else''s on this team. Ask one of its officers.', v_character.name_realm;
  end if;

  -- write_audit_log() is an officer's, so this writes its own row, as
  -- team_invite_link_join() does. Same action and detail shape as an
  -- officer's add, so both read alike in the Audit Log.
  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Player Added', 'players', v_player_id,
          to_jsonb(v_spec_label || ', added by the member'));

  return v_player_id;
end;
$function$;
