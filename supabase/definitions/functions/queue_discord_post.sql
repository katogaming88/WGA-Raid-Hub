-- Function public.queue_discord_post: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.queue_discord_post(p_team_id integer, p_kind text, p_action text, p_payload jsonb)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  insert into discord_post_queue (team_id, kind, action, payload)
  select p_team_id, p_kind, p_action, p_payload
   where exists (select 1 from team_discord_posts p
                  where p.team_id = p_team_id and p.kind = p_kind and p.channel_id is not null);
$function$;
