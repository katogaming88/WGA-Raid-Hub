-- Function public.add_recruit: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.add_recruit(p_team_id integer, p_name_realm text, p_discord_id text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me integer := my_person_id();
  v_person integer;
  v_name text := btrim(p_name_realm);
  v_char characters;
  v_id integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if recruit_access(p_team_id) is distinct from 'manage' then
    raise exception 'Not authorized';
  end if;
  if not exists (select 1 from team_recruiting r where r.team_id = p_team_id) then
    raise exception 'That team does not exist';
  end if;
  perform 1 from teams t where t.id = p_team_id and t.archived_at is null for share;
  if not found then
    raise exception 'That team is archived. Bring it back first.';
  end if;
  if v_name is null or char_length(v_name) > 100 or v_name !~ '^[^\s-][^-]*-\S' or v_name ~ '[\r\n]' then
    raise exception 'Enter the character as Name-Realm';
  end if;
  if p_discord_id is not null then
    if p_discord_id !~ '^[0-9]{17,20}$' then
      raise exception 'That is not a Discord id';
    end if;
    v_person := person_for_discord_id(p_discord_id);
    if v_person = v_me then
      raise exception 'That is your own Discord id';
    end if;
    if exists (select 1 from recruit_applications a
                where a.team_id = p_team_id and a.person_id = v_person and a.closed_at is null) then
      raise exception 'That person already has an open application with this team';
    end if;
    select * into v_char from characters c
     where c.person_id = v_person and c.name_realm_key = lower(replace(v_name, ' ', ''));
  end if;

  begin
    insert into recruit_applications (team_id, person_id, source, character_id, name_realm, class_name, spec_name, item_level)
    values (p_team_id, v_person, 'added_by_officer', v_char.id, coalesce(v_char.name_realm, v_name),
            v_char.class_name, v_char.spec_name, v_char.item_level)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'That person already has an open application with this team';
  end;
  insert into recruit_events (application_id, kind, actor_person_id) values (v_id, 'added_by_officer', v_me);
  perform recruit_log(p_team_id, v_me, 'Recruit Added', v_id, jsonb_build_object('name_realm', v_name));
  return v_id;
end;
$function$;
