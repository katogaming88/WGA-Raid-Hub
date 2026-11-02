-- Function public.claim_discord_posts: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.claim_discord_posts(p_limit integer DEFAULT 25)
 RETURNS TABLE(id bigint, team_id integer, kind text, action text, payload jsonb, created_at timestamp with time zone, attempts integer)
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  update discord_post_queue q
     set claimed_at = now(), attempts = q.attempts + 1
   where q.id in (
     select d.id
       from discord_post_queue d
       left join team_discord_config c on c.team_id = d.team_id
      where d.status = 'queued'
        and d.next_try_at <= now()
        and (d.claimed_at is null or d.claimed_at < now() - interval '10 minutes')
        and not coalesce(
              case when c.quiet_hours_start < c.quiet_hours_end
                   then (now() at time zone c.quiet_hours_timezone)::time >= c.quiet_hours_start
                    and (now() at time zone c.quiet_hours_timezone)::time < c.quiet_hours_end
                   else (now() at time zone c.quiet_hours_timezone)::time >= c.quiet_hours_start
                     or (now() at time zone c.quiet_hours_timezone)::time < c.quiet_hours_end
              end, false)
      order by d.id
      limit p_limit
      for update of d skip locked)
  returning q.id, q.team_id, q.kind, q.action, q.payload, q.created_at, q.attempts;
$function$;
