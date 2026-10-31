-- Function public.set_team_discord_post: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_team_discord_post(p_team_id integer, p_kind text, p_channel_id text, p_ping_role_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_old team_discord_posts;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not (has_team_permission(p_team_id, 'change_discord_settings') or is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if p_kind is null or p_kind not in ('officer_requests', 'mplus_requests', 'rsvp_changes') then
    raise exception 'That is not a kind of post';
  end if;
  if p_channel_id is not null and p_channel_id !~ '^[0-9]{17,20}$' then
    raise exception 'That is not a Discord channel id';
  end if;
  if p_ping_role_id is not null and p_ping_role_id !~ '^[0-9]{17,20}$' then
    raise exception 'That is not a Discord role id';
  end if;
  if p_channel_id is null and p_ping_role_id is not null then
    raise exception 'Pick a channel before a role to ping';
  end if;
  perform 1 from team_discord_config c where c.team_id = p_team_id for update;
  if not found then
    raise exception 'Pick the team''s Discord server first';
  end if;

  select * into v_old from team_discord_posts p where p.team_id = p_team_id and p.kind = p_kind;
  if v_old.channel_id is not distinct from p_channel_id
     and v_old.ping_role_id is not distinct from p_ping_role_id then
    return;
  end if;

  insert into team_discord_posts (team_id, kind, channel_id, ping_role_id)
  values (p_team_id, p_kind, p_channel_id, p_ping_role_id)
  on conflict (team_id, kind) do update
    set channel_id = excluded.channel_id, ping_role_id = excluded.ping_role_id, updated_at = now();

  -- The old bot's columns, until #959 and #960.
  update team_discord_config c
     set officer_channel_id = case when p_kind = 'officer_requests' and p_channel_id is not null
                                   then p_channel_id else c.officer_channel_id end,
         roster_ping_role_id = case when p_kind = 'officer_requests' then p_ping_role_id else c.roster_ping_role_id end,
         mplus_ping_role_id = case when p_kind = 'mplus_requests' then p_ping_role_id else c.mplus_ping_role_id end,
         attendance_channel_id = case when p_kind = 'rsvp_changes' then p_channel_id else c.attendance_channel_id end,
         rsvp_ping_role_id = case when p_kind = 'rsvp_changes' then p_ping_role_id else c.rsvp_ping_role_id end,
         updated_at = now()
   where c.team_id = p_team_id;

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Discord Post Set', 'teams', p_team_id,
          jsonb_build_object('kind', p_kind,
                             'from', jsonb_build_object('channel_id', v_old.channel_id, 'ping_role_id', v_old.ping_role_id),
                             'to', jsonb_build_object('channel_id', p_channel_id, 'ping_role_id', p_ping_role_id)));
end;
$function$;
