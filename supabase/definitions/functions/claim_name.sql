-- Function public.claim_name: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.claim_name(p_team_id integer, p_name_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_member_id integer;
  v_discord_id text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select tm.id into v_member_id
    from public.team_members tm
   where tm.team_id = p_team_id and tm.person_id = public.my_person_id();

  if v_member_id is null then
    v_discord_id := public.current_discord_id();
    if v_discord_id is null then
      raise exception 'This account has no Discord identity to claim with';
    end if;
    insert into public.team_members (team_id, discord_id, role)
    values (p_team_id, v_discord_id, 'raider')
    returning id into v_member_id;
  else
    update public.team_members set archived_at = null where id = v_member_id and archived_at is not null;
  end if;

  update public.names
     set team_member_id = v_member_id
   where id = p_name_id and team_id = p_team_id and team_member_id is null;

  if not found then
    raise exception 'That Name is not available to claim';
  end if;
end;
$function$;
