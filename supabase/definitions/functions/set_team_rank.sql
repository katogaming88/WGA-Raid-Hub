-- Function public.set_team_rank: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_team_rank(p_team_id integer, p_team_member_id integer, p_rank text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_is_owner boolean;
  v_old text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  -- The team's owner row first, so a handover in flight is waited out and
  -- the check below sees who owns the team once it ends.
  perform 1 from team_members m
   where m.team_id = p_team_id and m.rank = 'owner' and m.archived_at is null
     for update;

  v_is_owner := exists (
    select 1 from team_members m
     where m.team_id = p_team_id and m.person_id = my_person_id()
       and m.rank = 'owner' and m.archived_at is null
  );
  if not v_is_owner and not public.has_team_permission(p_team_id, 'promote_assistants') then
    raise exception 'Not authorized';
  end if;
  if exists (select 1 from teams t where t.id = p_team_id and t.archived_at is not null) then
    raise exception 'That team is archived. Bring it back first.';
  end if;
  if p_rank is null or p_rank not in ('officer', 'assistant', 'raider') then
    raise exception 'A rank is Officer, Assistant or Raider';
  end if;

  select m.rank into v_old
    from team_members m
   where m.id = p_team_member_id and m.team_id = p_team_id and m.archived_at is null
     for update;
  if not found then
    raise exception 'That person is not on this team';
  end if;
  if v_old = 'owner' then
    raise exception 'That person is the Team Owner. A guild Owner or Admin changes the Team Owner.';
  end if;
  if (v_old = 'officer' or p_rank = 'officer') and not v_is_owner then
    raise exception 'Only the Team Owner makes someone an Officer or takes it away';
  end if;
  if v_old = p_rank then
    return;
  end if;

  update team_members set rank = p_rank where id = p_team_member_id;

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Team Rank Changed', 'team_members', p_team_member_id,
          jsonb_build_object('name', public.team_member_name(p_team_id, p_team_member_id),
                             'from', v_old, 'to', p_rank));
end;
$function$;
