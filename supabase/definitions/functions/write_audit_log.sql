-- Function public.write_audit_log: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.write_audit_log(p_team_id integer, p_action text, p_target_type text DEFAULT NULL::text, p_target_id integer DEFAULT NULL::integer, p_detail jsonb DEFAULT NULL::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_id integer;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  if not (exists (select 1 from public.rank_permissions k
                  where k.permission in ('edit_roster', 'edit_schedule', 'attendance', 'manage_signups',
                                         'manage_loot', 'pay_boe_cuts', 'promote_assistants')
                    and public.has_team_permission(p_team_id, k.permission)) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, p_action, p_target_type, p_target_id, p_detail)
  returning id into v_id;

  return v_id;
end;
$function$;
