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
  v_archived_at timestamptz;
  v_discord_id text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select tm.id, tm.archived_at into v_member_id, v_archived_at
    from public.team_members tm
   where tm.team_id = p_team_id and tm.person_id = public.my_person_id();

  -- An archived membership does not un-archive itself by claiming a Name --
  -- rejoining an ended membership only ever happens through a fresh invite
  -- link (team_invite_link_join), which an officer controls. Self-service
  -- Claim is not that door.
  if v_member_id is not null and v_archived_at is not null then
    raise exception 'Your membership on this team has ended; ask an officer for a new invite link to rejoin';
  end if;

  if v_member_id is null then
    v_discord_id := public.current_discord_id();
    if v_discord_id is null then
      raise exception 'This account has no Discord identity to claim with';
    end if;
    insert into public.team_members (team_id, discord_id, role)
    values (p_team_id, v_discord_id, 'raider')
    returning id into v_member_id;
  end if;

  update public.names
     set team_member_id = v_member_id
   where id = p_name_id and team_id = p_team_id and team_member_id is null;

  if not found then
    raise exception 'That Name is not available to claim';
  end if;
end;
$function$;
