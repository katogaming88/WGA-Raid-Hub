-- #1711: Settings > Discord > Activity. What the bot posted for a team, newest
-- first, and what failed. discord_post_queue is service role only, so the
-- team's officers read it through this one function.
--
-- It lists the queued notices only (officer requests, M+ requests, RSVP
-- changes): signup sheets and the weekly lineup keep just a "last posted"
-- time today, so they are not in the list (Kat, 2026-11-05).

create function public.team_discord_activity(p_team_id integer, p_limit integer default 50)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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
      select jsonb_agg(r.row order by r.created_at desc, r.id desc)
        from (
          select q.id, q.created_at,
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
           order by q.created_at desc, q.id desc
           limit least(greatest(coalesce(p_limit, 50), 1), 200)) r), '[]'::jsonb)
  );
end;
$function$;

comment on function public.team_discord_activity(integer, integer) is
  'What the bot posted for a team (#1711): how many notices are in the log, when the last one posted, and the newest p_limit (50 by default, at most 200) with their status, last error and the channel their kind posts to now. Queued notices only. For whoever holds Change Discord settings on the team, or a site admin.';

revoke all on function public.team_discord_activity(integer, integer) from public, anon;
grant execute on function public.team_discord_activity(integer, integer) to authenticated;
