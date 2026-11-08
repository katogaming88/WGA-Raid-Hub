-- Function public.recruiters_off_on_leaving: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.recruiters_off_on_leaving()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_guild integer;
begin
  if old.person_id is null then
    return null;
  end if;
  if tg_table_name = 'guild_ranks' then
    v_guild := old.guild_id;
  else
    select t.guild_id into v_guild from teams t where t.id = old.team_id;
  end if;

  with off as (
    update guild_recruiters r
       set active = false, updated_at = now()
     where r.guild_id = v_guild and r.person_id = old.person_id and r.active
       and not in_guild(r.guild_id, r.person_id)
    returning r.guild_id, r.person_id, r.code
  )
  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  select null, auth.uid(), 'Recruiter Switched Off', 'guilds', off.guild_id,
         jsonb_build_object('person_id', off.person_id, 'code', off.code, 'reason', 'left the guild')
    from off;
  return null;
end;
$function$;
