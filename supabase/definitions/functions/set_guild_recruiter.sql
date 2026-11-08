-- Function public.set_guild_recruiter: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_guild_recruiter(p_guild_id integer, p_person_id integer, p_on boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_old guild_recruiters;
  v_code text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not has_guild_permission(p_guild_id, 'manage_recruiters') then
    raise exception 'Not authorized';
  end if;
  if p_on is null then
    raise exception 'Say on or off';
  end if;

  select * into v_old from guild_recruiters r
   where r.guild_id = p_guild_id and r.person_id = p_person_id
     for update;

  if not found then
    if not p_on then
      return null;
    end if;
    -- The same test as set_guild_rank(): a guild rank, or a current team there.
    if not exists (select 1 from guild_ranks g
                    where g.guild_id = p_guild_id and g.person_id = p_person_id and g.rank <> 'member')
       and not exists (select 1 from team_members m join teams t on t.id = m.team_id
                        where t.guild_id = p_guild_id and m.person_id = p_person_id
                          and m.archived_at is null) then
      raise exception 'That person is not in this guild';
    end if;
    -- A new code that happens to be taken: try again (36^8 codes, so rarely).
    loop
      begin
        insert into guild_recruiters (guild_id, person_id)
        values (p_guild_id, p_person_id)
        returning code into v_code;
        exit;
      exception when unique_violation then
        if exists (select 1 from guild_recruiters r
                    where r.guild_id = p_guild_id and r.person_id = p_person_id) then
          raise exception 'Someone else just changed this. Reload and try again.';
        end if;
      end;
    end loop;
  else
    v_code := v_old.code;
    if v_old.active = p_on then
      return v_code;
    end if;
    update guild_recruiters
       set active = p_on, updated_at = now()
     where guild_id = p_guild_id and person_id = p_person_id;
  end if;

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (null, v_uid, case when p_on then 'Recruiter Switched On' else 'Recruiter Switched Off' end,
          'guilds', p_guild_id, jsonb_build_object('person_id', p_person_id, 'code', v_code));

  return v_code;
end;
$function$;
