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
  v_was_unlisted boolean;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select t.guild_id, t.unlisted into v_guild_id, v_was_unlisted from teams t where t.id = p_team_id;
  if v_guild_id is null or not public.has_guild_permission(v_guild_id, 'rename_archive_teams') then
    raise exception 'Not authorized';
  end if;
  if p_unlisted is null then
    raise exception 'Say whether to unlist the team';
  end if;
  -- No change, no write and no audit line.
  if p_unlisted = v_was_unlisted then
    return;
  end if;

  update teams set unlisted = p_unlisted where id = p_team_id;

  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, case when p_unlisted then 'Team Unlisted' else 'Team Listed' end,
          'teams', p_team_id, null);
end;
$function$;
