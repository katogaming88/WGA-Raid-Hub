-- Function public.hold_team_member: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.hold_team_member(p_team_member_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team_id integer;
begin
  if p_team_member_id is null then
    return;
  end if;

  select team_id into v_team_id from public.team_members where id = p_team_member_id;
  if v_team_id is null
     or not (auth.uid() is null
             or v_team_id = any (public.my_officer_team_ids())
             or public.is_guild_officer()
             or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  perform 1 from public.team_members where id = p_team_member_id for share;
end;
$function$;
