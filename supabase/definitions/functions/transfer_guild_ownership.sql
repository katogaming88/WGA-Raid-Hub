-- Function public.transfer_guild_ownership: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.transfer_guild_ownership(p_guild_id integer, p_person_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_me integer := my_person_id();
  v_old text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  perform 1 from guild_ranks g
   where g.guild_id = p_guild_id and g.person_id = v_me and g.rank = 'owner'
     for update;
  if not found then
    raise exception 'Not authorized';
  end if;
  if p_person_id is null or p_person_id = v_me then
    raise exception 'Pick someone else in the guild';
  end if;

  select g.rank into v_old
    from guild_ranks g
   where g.guild_id = p_guild_id and g.person_id = p_person_id
     for update;
  v_old := coalesce(v_old, 'member');
  if v_old = 'member' and not exists (
    select 1 from team_members m join teams t on t.id = m.team_id
     where t.guild_id = p_guild_id and m.person_id = p_person_id and m.archived_at is null
  ) then
    raise exception 'That person is not in this guild';
  end if;
  -- An Owner nobody can sign in as would leave the guild with no one to act
  -- for it (fresh-agent review).
  if not exists (select 1 from people pe where pe.id = p_person_id and pe.auth_user_id is not null) then
    raise exception 'That person has not signed in yet';
  end if;

  -- The caller steps down first: a guild has one owner (guild_ranks_one_owner).
  update guild_ranks set rank = 'admin' where guild_id = p_guild_id and person_id = v_me;
  insert into guild_ranks (guild_id, person_id, rank)
  values (p_guild_id, p_person_id, 'owner')
  on conflict (guild_id, person_id) do update set rank = excluded.rank;

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (null, v_uid, 'Guild Ownership Transferred', 'guilds', p_guild_id,
          jsonb_build_object('from_person_id', v_me, 'to_person_id', p_person_id,
                             'to_old_rank', v_old));
end;
$function$;
