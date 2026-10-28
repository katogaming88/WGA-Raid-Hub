-- Function public.set_team_officer_bios: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_team_officer_bios(p_team_id integer, p_bios jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_config jsonb;
begin
  if not (
    coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false)
    or public.is_site_admin()
    -- "Officer on every team", or the Owner, of this team's guild (#1647):
    -- the role check above does not see it.
    or exists (select 1 from public.guild_ranks g join public.teams t on t.guild_id = g.guild_id
                where t.id = p_team_id and g.person_id = public.my_person_id()
                  and (g.officer_on_every_team or g.rank = 'owner'))
  ) then
    raise exception 'Not authorized';
  end if;

  update public.team_settings
  set config = config || jsonb_build_object('teamOfficerBios', p_bios)
  where team_id = p_team_id
  returning config into v_config;

  if not found then
    raise exception 'Not authorized';
  end if;

  perform public.write_audit_log(
    p_team_id,
    'Team Officer Bios Saved',
    'team_settings',
    null,
    jsonb_build_object('count', jsonb_array_length(p_bios))
  );

  return v_config;
end;
$function$;
