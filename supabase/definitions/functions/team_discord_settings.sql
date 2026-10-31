-- Function public.team_discord_settings: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.team_discord_settings(p_team_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_config team_discord_config;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not (has_team_permission(p_team_id, 'change_discord_settings') or is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  select * into v_config from team_discord_config c where c.team_id = p_team_id;

  return jsonb_build_object(
    'server_id', v_config.guild_id,
    'quiet_hours', case when v_config.quiet_hours_start is null then null else jsonb_build_object(
      'start', v_config.quiet_hours_start,
      'end', v_config.quiet_hours_end,
      'timezone', v_config.quiet_hours_timezone) end,
    'posts', (
      select jsonb_agg(jsonb_build_object(
               'kind', k.kind,
               'channel_id', p.channel_id,
               'ping_role_id', p.ping_role_id,
               'last_posted_at', p.last_posted_at) order by k.n)
        from unnest(array['officer_requests', 'mplus_requests', 'rsvp_changes']) with ordinality as k(kind, n)
        left join team_discord_posts p on p.team_id = p_team_id and p.kind = k.kind),
    'sheets', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id,
               'channel_id', s.channel_id,
               'raid_days', s.raid_days,
               'keep_raids_posted', s.keep_raids_posted,
               'hours_before', s.hours_before,
               'ping_role_id', s.ping_role_id,
               'last_posted_at', s.last_posted_at) order by s.raid_days[1], s.id)
        from team_discord_signup_sheets s
       where s.team_id = p_team_id), '[]'::jsonb)
  );
end;
$function$;
