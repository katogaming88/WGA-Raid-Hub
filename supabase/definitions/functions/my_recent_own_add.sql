-- Function public.my_recent_own_add: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.my_recent_own_add(p_team_slug text)
 RETURNS TABLE(audit_id integer, team_slug text, member text, name_realm text, class_spec text, added_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- add_own_character() writes detail as the spec label followed by this.
  select a.id,
         t.slug,
         n.label,
         p.name_realm,
         left(a.detail #>> '{}', -length(', added by the member')),
         a.created_at
    from public.audit_log a
    join public.teams t on t.id = a.team_id
    join public.players p on p.id = a.target_id
    left join public.names n on n.team_member_id = p.team_member_id
   where a.actor_id = auth.uid()
     and t.slug = p_team_slug
     and a.action = 'Player Added'
     and a.target_type = 'players'
     and a.detail #>> '{}' like '%, added by the member'
     and a.created_at >= now() - interval '5 minutes'
   order by a.created_at desc
   limit 1;
$function$;
