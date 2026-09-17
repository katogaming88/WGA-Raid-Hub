-- Function public.set_boss_lineup: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_boss_lineup(p_team_id integer, p_raid_date date, p_raid_name text, p_sitouts jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not (
    coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false)
    or public.is_guild_officer()
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if p_raid_date is null or coalesce(trim(p_raid_name), '') = '' then
    raise exception 'Choose a raid night and a raid.';
  end if;

  if p_sitouts is null or jsonb_typeof(p_sitouts) <> 'array' then
    raise exception 'The lineup must be a list of sit-outs.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_sitouts) e
    where coalesce(trim(e->>'boss'), '') = '' or (e->>'player_id') is null
  ) then
    raise exception 'Each sit-out needs a boss and a raider.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_sitouts) e
    left join players p on p.id = (e->>'player_id')::integer and p.team_id = p_team_id
    where p.id is null
  ) then
    raise exception 'Every raider in the lineup must be on this team.';
  end if;

  delete from boss_lineup_sitouts
  where team_id = p_team_id and raid_date = p_raid_date and raid_name = p_raid_name;

  insert into boss_lineup_sitouts (team_id, raid_date, raid_name, boss_name, player_id)
  select distinct p_team_id, p_raid_date, p_raid_name, trim(e->>'boss'), (e->>'player_id')::integer
  from jsonb_array_elements(p_sitouts) e;

  get diagnostics v_count = row_count;

  perform public.write_audit_log(
    p_team_id,
    'Set Boss Lineup',
    'boss_lineup_sitouts',
    null,
    jsonb_build_object('raid_date', p_raid_date, 'raid_name', p_raid_name, 'sitouts', v_count)
  );

  return v_count;
end;
$function$;
