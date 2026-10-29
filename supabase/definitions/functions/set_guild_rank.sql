-- Function public.set_guild_rank: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_guild_rank(p_guild_id integer, p_person_id integer, p_rank text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_old text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  -- Locking the caller's owner row also waits out a handover in flight.
  perform 1 from guild_ranks g
   where g.guild_id = p_guild_id and g.person_id = my_person_id() and g.rank = 'owner'
     for update;
  if not found then
    raise exception 'Not authorized';
  end if;
  if p_rank is null or p_rank not in ('admin', 'team_lead', 'member') then
    raise exception 'A rank is Admin, Team Lead or Member';
  end if;

  select g.rank into v_old
    from guild_ranks g
   where g.guild_id = p_guild_id and g.person_id = p_person_id
     for update;
  if v_old = 'owner' then
    raise exception 'That person is the guild''s Owner. Hand the guild to someone else first.';
  end if;
  if v_old is null and not exists (
    select 1 from team_members m join teams t on t.id = m.team_id
     where t.guild_id = p_guild_id and m.person_id = p_person_id and m.archived_at is null
  ) then
    raise exception 'That person is not in this guild';
  end if;
  if coalesce(v_old, 'member') = p_rank then
    return;
  end if;

  if p_rank = 'member' then
    delete from guild_ranks where guild_id = p_guild_id and person_id = p_person_id;
  else
    insert into guild_ranks (guild_id, person_id, rank)
    values (p_guild_id, p_person_id, p_rank)
    on conflict (guild_id, person_id) do update set rank = excluded.rank;
  end if;

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (null, v_uid, 'Guild Rank Changed', 'guilds', p_guild_id,
          jsonb_build_object('person_id', p_person_id, 'from', coalesce(v_old, 'member'), 'to', p_rank));
end;
$function$;
