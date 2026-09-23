-- Function public.team_invite_link_reset: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.team_invite_link_reset(p_team_id integer, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS team_invite_links
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_slug text;
  v_row public.team_invite_links;
begin
  if not (
    coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false)
    or public.is_site_admin()
    or public.is_guild_officer()
  ) then
    raise exception 'Not authorized';
  end if;

  select slug into v_slug from public.teams where id = p_team_id;
  if v_slug is null then
    raise exception 'Team not found';
  end if;

  insert into public.team_invite_links (team_id, code, expires_at)
  values (p_team_id, v_slug || '-' || public.new_url_code(), p_expires_at)
  on conflict (team_id) do update
    set code = excluded.code,
        expires_at = excluded.expires_at
  returning * into v_row;

  perform public.write_audit_log(p_team_id, 'Invite Link Reset', 'team_invite_links', p_team_id, jsonb_build_object('expires_at', p_expires_at));

  return v_row;
end;
$function$;
