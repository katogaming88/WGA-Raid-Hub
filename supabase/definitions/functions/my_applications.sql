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
             'answers', a.answers,
             'ticket_url', case
               when a.closed_at is null and a.ticket_deleted_at is null
                    and a.discord_channel_id is not null and c.guild_id ~ '^[0-9]{17,20}$'
               then 'https://discord.com/channels/' || c.guild_id || '/' || a.discord_channel_id
             end,
             'joined_discord', coalesce(d.kind = 'joined_discord', false),
             'join_failed', coalesce(d.kind = 'discord_join_failed', false),
             'add_to_server', coalesce(r.add_to_server, false)) order by a.applied_at desc, a.id desc)
      from recruit_applications a
      join teams t on t.id = a.team_id
      join guilds g on g.id = t.guild_id
      left join team_recruiting r on r.team_id = a.team_id
      left join team_discord_config c on c.team_id = a.team_id
      left join lateral (
        select e.kind
          from recruit_events e
         where e.application_id = a.id and e.kind in ('joined_discord', 'discord_join_failed')
         order by e.created_at desc, e.id desc
         limit 1) d on true
     where a.person_id = my_person_id()), '[]'::jsonb);
end;
$function$;
