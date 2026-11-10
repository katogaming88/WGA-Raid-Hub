-- Function public.recruit_trial_bot_actor: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.recruit_trial_bot_actor(p_application_id integer, p_actor_discord_id text)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_actor integer := bot_actor(p_actor_discord_id);
begin
  perform bot_check(p_application_id, v_actor, false);
  if not exists (select 1 from guild_grants g where g.person_id = v_actor and g.grant_type = 'site_admin')
     and not exists (select 1 from recruit_applications a
                       join team_members m on m.team_id = a.team_id
                      where a.id = p_application_id and m.person_id = v_actor and m.archived_at is null
                        and (m.rank = 'owner'
                             or exists (select 1 from team_rank_permissions k
                                         where k.team_id = m.team_id and k.rank = m.rank
                                           and k.permission = 'edit_roster'))) then
    raise exception 'Not authorized';
  end if;
  return v_actor;
end;
$function$;
