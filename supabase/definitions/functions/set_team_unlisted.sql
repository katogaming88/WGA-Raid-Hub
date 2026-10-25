-- Function public.set_team_unlisted: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_team_unlisted(p_team_id integer, p_unlisted boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_guild_id integer;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select t.guild_id into v_guild_id from teams t where t.id = p_team_id;
  if v_guild_id is null or not public.is_guild_officer_of(v_guild_id) then
    raise exception 'Not authorized';
  end if;

  update teams set unlisted = coalesce(p_unlisted, false) where id = p_team_id;

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, case when p_unlisted then 'Team Unlisted' else 'Team Listed' end,
          'teams', p_team_id, null);
end;
$function$;
