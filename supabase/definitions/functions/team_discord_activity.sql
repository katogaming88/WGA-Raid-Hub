-- Function public.team_discord_activity: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.team_discord_activity(p_team_id integer, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not (has_team_permission(p_team_id, 'change_discord_settings') or is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  return jsonb_build_object(
    'total', (select count(*) from discord_post_queue q where q.team_id = p_team_id),
    'last_posted_at', (select max(q.posted_at) from discord_post_queue q where q.team_id = p_team_id),
    'rows', coalesce((
      select jsonb_agg(r.row order by r.at desc, r.id desc)
        from (
          select q.id, coalesce(q.posted_at, q.created_at) as at,
                 jsonb_build_object(
                   'id', q.id,
                   'kind', q.kind,
                   'action', q.action,
                   'status', q.status,
                   'attempts', q.attempts,
                   'at', coalesce(q.posted_at, q.created_at),
                   'error', q.last_error,
                   'channel_id', p.channel_id) as row
            from discord_post_queue q
            left join team_discord_posts p on p.team_id = q.team_id and p.kind = q.kind
           where q.team_id = p_team_id
           order by coalesce(q.posted_at, q.created_at) desc, q.id desc
           limit least(greatest(coalesce(p_limit, 50), 1), 200)) r), '[]'::jsonb)
  );
end;
$function$;
