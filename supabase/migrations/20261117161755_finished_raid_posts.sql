-- #1825: what the bot does with a raid night's signup sheet, and the week's
-- boss lineup post, once that raid has passed. Today every sheet stays in
-- the channel for good, still showing a dropdown that no longer does
-- anything.
--
-- A team picks on Settings > Discord:
--   'finish': the bot edits the post to say the raid has finished and takes
--             its dropdown and buttons off; the roster picture stays as a
--             record. The default, since nothing is lost.
--   'delete': the bot deletes the post, so the channel only shows raids to come.
-- One choice per team covers both kinds of post. A sheet is handled 4 hours
-- after its raid starts, the point the bot already stops updating it; a
-- weekly lineup post once the last raid night it covers is that far past.
--
-- finished_at on each post's row records that it was handled, so it happens
-- once. Posts already up (one on production, 2026-11-17) are handled on the
-- first run after deploy like any other.

alter table public.team_discord_config
  add column after_raid text not null default 'finish' check (after_raid in ('finish', 'delete'));

comment on column public.team_discord_config.after_raid is
  'What the bot does with a raid night''s signup sheet and the weekly lineup post once the raid has passed (#1825): finish (edit it to say so, without its dropdown and buttons) or delete. Set by set_team_discord_after_raid().';

alter table public.raid_signup_sheets add column finished_at timestamp with time zone;

comment on column public.raid_signup_sheets.finished_at is
  'When the bot marked this raid''s sheet finished or deleted it, as the team chose (#1825); null while the raid is still to come. A sheet it could no longer reach is set here too.';

alter table public.team_lineup_posts add column finished_at timestamp with time zone;

comment on column public.team_lineup_posts.finished_at is
  'When the bot marked this week''s lineup post finished or deleted it, once the week''s last raid night had passed (#1825). A finished week is never edited or posted again.';

create or replace function public.set_team_discord_after_raid(p_team_id integer, p_after_raid text)
 returns void
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_uid uuid := auth.uid();
  v_old text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not (has_team_permission(p_team_id, 'change_discord_settings') or is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if p_after_raid is null or p_after_raid not in ('finish', 'delete') then
    raise exception 'Pick finish or delete';
  end if;

  select c.after_raid into v_old from team_discord_config c where c.team_id = p_team_id for update;
  if not found then
    raise exception 'Pick the team''s Discord server first';
  end if;
  if v_old = p_after_raid then
    return;
  end if;

  update team_discord_config set after_raid = p_after_raid, updated_at = now() where team_id = p_team_id;

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Discord After Raid Set', 'teams', p_team_id,
          jsonb_build_object('from', v_old, 'to', p_after_raid));
end;
$function$;

revoke all on function public.set_team_discord_after_raid(integer, text) from public, anon;
grant execute on function public.set_team_discord_after_raid(integer, text) to authenticated;

-- The settings read gains after_raid; otherwise as 20261105075606 left it.
create or replace function public.team_discord_settings(p_team_id integer)
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
    -- What the bot does with a raid's posts once it has passed (#1825); a
    -- team with no server yet reads the default.
    'after_raid', coalesce(v_config.after_raid, 'finish'),
    'quiet_hours', case when v_config.quiet_hours_start is null then null else jsonb_build_object(
      'start', v_config.quiet_hours_start,
      'end', v_config.quiet_hours_end,
      'timezone', v_config.quiet_hours_timezone) end,
    'posts', (
      select jsonb_agg(jsonb_build_object(
               'kind', k.kind,
               'channel_id', p.channel_id,
               'ping_role_id', p.ping_role_id,
               'last_posted_at', p.last_posted_at,
               'post_weekday', p.post_weekday,
               'post_time', p.post_time,
               'post_timezone', p.post_timezone,
               'rsvp_when', p.rsvp_when,
               'rsvp_time', p.rsvp_time,
               'rsvp_timezone', p.rsvp_timezone,
               'rsvp_hours', p.rsvp_hours) order by k.n)
        from unnest(array['officer_requests', 'mplus_requests', 'rsvp_changes', 'weekly_lineup']) with ordinality as k(kind, n)
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
