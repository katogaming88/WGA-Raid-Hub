-- Function public.set_team_discord_server: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_team_discord_server(p_team_id integer, p_server_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_old text;
  v_sheets integer;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not (has_team_permission(p_team_id, 'change_discord_settings') or is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if p_server_id is null or p_server_id !~ '^[0-9]{17,20}$' then
    raise exception 'That is not a Discord server id';
  end if;
  if not exists (select 1 from teams t where t.id = p_team_id) then
    raise exception 'That team does not exist';
  end if;
  if not exists (select 1 from discord_server_access a
                  where a.person_id = my_person_id() and a.server_id = p_server_id
                    and a.verified_at > now() - interval '1 hour') then
    raise exception 'Pick a server you and the bot are both in';
  end if;

  select c.guild_id into v_old from team_discord_config c where c.team_id = p_team_id for update;
  if v_old = p_server_id then
    return;
  end if;

  if v_old is null then
    insert into team_discord_config (team_id, guild_id) values (p_team_id, p_server_id);
  else
    update team_discord_config
       set guild_id = p_server_id,
           officer_channel_id = null, attendance_channel_id = null, signup_channel_id = null,
           mplus_ping_role_id = null, roster_ping_role_id = null, rsvp_ping_role_id = null,
           updated_at = now()
     where team_id = p_team_id;
    update team_discord_posts
       set channel_id = null, ping_role_id = null, updated_at = now()
     where team_id = p_team_id and channel_id is not null;
    delete from team_discord_signup_sheets where team_id = p_team_id;
    get diagnostics v_sheets = row_count;
  end if;

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Discord Server Set', 'teams', p_team_id,
          jsonb_build_object('from', v_old, 'to', p_server_id, 'sheets_removed', coalesce(v_sheets, 0)));
end;
$function$;
