-- Function public.change_team_owner: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.change_team_owner(p_team_id integer, p_team_member_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_guild integer;
  v_archived timestamptz;
  v_old_owner integer;
  v_old_rank text;
  v_signed_in boolean;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select t.guild_id, t.archived_at into v_guild, v_archived from teams t where t.id = p_team_id;
  if not public.has_guild_permission(v_guild, 'change_team_owner') then
    raise exception 'Not authorized';
  end if;
  if v_archived is not null then
    raise exception 'That team is archived. Bring it back first.';
  end if;

  -- A team may have no owner, when its last team leader left.
  select m.id into v_old_owner
    from team_members m
   where m.team_id = p_team_id and m.rank = 'owner' and m.archived_at is null
     for update;

  select m.rank, pe.auth_user_id is not null into v_old_rank, v_signed_in
    from team_members m
    join people pe on pe.id = m.person_id
   where m.id = p_team_member_id and m.team_id = p_team_id and m.archived_at is null
     for update of m;
  if not found then
    raise exception 'That person is not on this team';
  end if;
  if v_old_rank = 'owner' then
    raise exception 'That person is already the Team Owner';
  end if;
  -- An owner nobody can sign in as would leave the team with no one to act
  -- for it, as transfer_guild_ownership() refuses for a guild.
  if not v_signed_in then
    raise exception 'That person has not signed in yet';
  end if;

  -- One statement, on purpose. Stepping down alone would fire
  -- team_members_pass_ownership at once, handing the team to any other team
  -- leader, and the new owner would then hit team_members_one_owner. In one
  -- statement that trigger waits until the end, and finds an owner. The
  -- subquery makes the old owner step down first, as the unique index needs.
  with stepped_down as (
    update team_members set rank = 'officer' where id = v_old_owner returning id
  )
  update team_members set rank = 'owner'
   where id = p_team_member_id and (select count(*) from stepped_down) >= 0;

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Team Owner Changed', 'team_members', p_team_member_id,
          jsonb_build_object('from_team_member_id', v_old_owner, 'to_old_rank', v_old_rank));
end;
$function$;
