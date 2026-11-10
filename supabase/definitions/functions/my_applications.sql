-- Function public.my_applications: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.my_applications()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id,
             'team_id', a.team_id,
             'team_name', t.name,
             'team_slug', t.slug,
             'guild_key', g.url_key,
             'name_realm', a.name_realm,
             'status', a.status,
             'applied_at', a.applied_at,
             'closed_at', a.closed_at,
             'trial_starts_on', a.trial_starts_on,
             'trial_ends_on', a.trial_ends_on,
             'answers', a.answers) order by a.applied_at desc, a.id desc)
      from recruit_applications a
      join teams t on t.id = a.team_id
      join guilds g on g.id = t.guild_id
     where a.person_id = my_person_id()), '[]'::jsonb);
end;
$function$;
