-- Function public.my_recruits: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.my_recruits()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me integer := my_person_id();
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id,
             'team_id', a.team_id,
             'team_name', t.name,
             'name', case when a.person_id is not null then guild_person_name(t.guild_id, a.person_id) end,
             'name_realm', a.name_realm,
             'status', a.status,
             'applied_at', a.applied_at,
             'closed_at', a.closed_at,
             'trial_starts_on', a.trial_starts_on,
             'trial_ends_on', a.trial_ends_on) order by a.applied_at desc, a.id desc)
      from recruit_applications a
      join teams t on t.id = a.team_id
     where a.recruiter_person_id = v_me and in_guild(t.guild_id, v_me)), '[]'::jsonb);
end;
$function$;
