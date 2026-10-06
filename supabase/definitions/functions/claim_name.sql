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
  v_member_archived_at timestamp with time zone;
  v_discord_id text;
  v_label text;
  v_membership_created boolean := false;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  -- The Name first, so a wrong team or Name creates no membership. No lock:
  -- the update below is what decides a race for the same Name.
  perform 1 from public.names
   where id = p_name_id and team_id = p_team_id and team_member_id is null;
  if not found then
    raise exception 'That Name is not available to claim';
  end if;

  -- for share, as in claim_character(): archive_team_member() locks this row
  -- first, so the check and the link land wholly before or after an archive.
  select tm.id, tm.archived_at into v_member_id, v_member_archived_at
    from public.team_members tm
   where tm.team_id = p_team_id and tm.person_id = public.my_person_id()
     for share;

  if v_member_archived_at is not null then
    raise exception 'Your membership on this team has ended. Ask one of its officers to add you back.';
  end if;

  if v_member_id is null then
    v_discord_id := public.current_discord_id();
    if v_discord_id is null then
      raise exception 'This account has no Discord identity to claim with';
    end if;
    insert into public.team_members (team_id, discord_id, role)
    values (p_team_id, v_discord_id, 'raider')
    returning id into v_member_id;
    v_membership_created := true;
  end if;

  -- One membership holds one Name (team_member_id is unique), so a second
  -- claim by the same person stops here, in words.
  begin
    update public.names
       set team_member_id = v_member_id
     where id = p_name_id and team_id = p_team_id and team_member_id is null
    returning label into v_label;
  exception when unique_violation then
    raise exception 'You already have a Name on this team. Ask an officer if it needs changing.';
  end;

  if not found then
    raise exception 'That Name is not available to claim';
  end if;

  -- Its own row, since write_audit_log() refuses a raider, the same way
  -- team_invite_link_join() logs a join.
  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Name Claimed', 'names', p_name_id,
          jsonb_build_object('label', v_label, 'team_member_id', v_member_id,
                             'membership_created', v_membership_created));
end;
$function$;
