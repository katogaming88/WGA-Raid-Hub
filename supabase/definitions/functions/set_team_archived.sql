-- Function public.set_team_archived: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_team_archived(p_team_id integer, p_archived boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_guild_id integer;
  v_was_archived boolean;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select t.guild_id, t.archived_at is not null into v_guild_id, v_was_archived from teams t where t.id = p_team_id;
  if v_guild_id is null or not public.is_guild_officer_of(v_guild_id) then
    raise exception 'Not authorized';
  end if;
  if p_archived is null then
    raise exception 'Say whether to archive the team';
  end if;
  -- No change, no write and no audit line.
  if p_archived = v_was_archived then
    return;
  end if;

  update teams
     set archived_at = case when p_archived then now() end
   where id = p_team_id;

  perform public.write_audit_log(p_team_id, case when p_archived then 'Team Archived' else 'Team Restored' end,
                                 'teams', p_team_id, null);
end;
$function$;
