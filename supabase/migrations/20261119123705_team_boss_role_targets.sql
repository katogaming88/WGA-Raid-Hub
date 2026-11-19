-- #1682: officers set what each boss needs: tanks, healers, melee, ranged.
--
-- The lineup checks every boss against the team's own targets
-- (team_lineup_settings: 2 tanks, 4 healers unless the team says otherwise).
-- A fight can want something else, a third tank or at least six ranged, and
-- today the page calls the right setup a problem.
--
-- team_boss_role_targets holds a boss's own numbers, one row per team and
-- boss, each optional. A missing tanks or healers number means the team's
-- target; a missing melee or ranged number means no target ("Any"). It is a
-- standing setting for every night, saved the moment an officer presses - or
-- + on Boss Lineup (Kat, 2026-10-27), never part of the lineup's Save.
-- team_lineup_settings stays the team's default.

create table public.team_boss_role_targets (
  team_id integer not null references public.teams (id) on delete cascade,
  encounter_id integer not null references public.raid_encounters (id) on delete cascade,
  tanks integer check (tanks between 0 and 30),
  healers integer check (healers between 0 and 30),
  melee integer check (melee between 0 and 30),
  ranged integer check (ranged between 0 and 30),
  updated_at timestamp with time zone not null default now(),
  primary key (team_id, encounter_id),
  -- A boss with nothing of its own has no row.
  check (num_nonnulls(tanks, healers, melee, ranged) > 0)
);

comment on table public.team_boss_role_targets is
  'What one boss needs for a team (#1682): tanks, healers, melee and ranged counts for the boss lineup''s checks. A null tanks or healers uses the team''s target (team_lineup_settings); a null melee or ranged means no target. A boss with no row uses the team''s targets. Written only by set_boss_role_targets().';

create index team_boss_role_targets_encounter_id_idx on public.team_boss_role_targets (encounter_id);

alter table public.team_boss_role_targets owner to postgres;
alter table public.team_boss_role_targets enable row level security;

-- Read by whoever reads the team's raid nights (raid_night_bosses' rules).
create policy "Claude readers read team_boss_role_targets" on public.team_boss_role_targets
  for select to claude_readers using (true);
create policy "Officers read team_boss_role_targets" on public.team_boss_role_targets for select
  using (((team_id = any ((select my_permission_team_ids('edit_schedule'))::integer[]))
    or (team_id = any ((select my_permission_team_ids('attendance'))::integer[]))
    or (team_id = any ((select my_guild_permission_team_ids('view_every_team'))::integer[]))
    or (select is_site_admin())));
create policy "Team raiders read team_boss_role_targets" on public.team_boss_role_targets for select
  using ((team_id in (select p.team_id from players p where p.id = any ((select my_active_player_ids())::integer[]))));

-- Read only for the site's roles: every write goes through the function
-- below, so a direct write fails loudly rather than matching no row.
revoke all on table public.team_boss_role_targets from public, anon, authenticated, service_role;
grant select on table public.team_boss_role_targets to anon, authenticated;
grant select, insert, update, delete on table public.team_boss_role_targets to service_role;

-- One boss's targets; all four null clears the boss back to the team's.
create or replace function public.set_boss_role_targets(
  p_team_id integer,
  p_encounter_id integer,
  p_tanks integer default null,
  p_healers integer default null,
  p_melee integer default null,
  p_ranged integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not (
    public.has_team_permission(p_team_id, 'edit_schedule')
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if not exists (select 1 from raid_encounters where id = p_encounter_id) then
    raise exception 'There is no such boss.';
  end if;

  if p_tanks not between 0 and 30 or p_healers not between 0 and 30
     or p_melee not between 0 and 30 or p_ranged not between 0 and 30 then
    raise exception 'A boss''s targets have to be between 0 and 30.';
  end if;

  if num_nonnulls(p_tanks, p_healers, p_melee, p_ranged) = 0 then
    delete from team_boss_role_targets where team_id = p_team_id and encounter_id = p_encounter_id;
  else
    insert into team_boss_role_targets (team_id, encounter_id, tanks, healers, melee, ranged, updated_at)
    values (p_team_id, p_encounter_id, p_tanks, p_healers, p_melee, p_ranged, now())
    on conflict (team_id, encounter_id) do update
      set tanks = excluded.tanks, healers = excluded.healers, melee = excluded.melee,
          ranged = excluded.ranged, updated_at = excluded.updated_at;
  end if;

  perform public.write_audit_log(
    p_team_id,
    'Set Boss Role Targets',
    'team_boss_role_targets',
    null,
    jsonb_build_object(
      'boss', (select name from raid_encounters where id = p_encounter_id),
      'tanks', p_tanks, 'healers', p_healers, 'melee', p_melee, 'ranged', p_ranged
    )
  );
end;
$$;

alter function public.set_boss_role_targets(integer, integer, integer, integer, integer, integer) owner to postgres;

comment on function public.set_boss_role_targets(integer, integer, integer, integer, integer, integer) is
  'Boss Lineup (#1682): one boss''s standing tanks/healers/melee/ranged targets for a team; a null uses the team''s target (tanks, healers) or none (melee, ranged), and all null clears the boss. edit_schedule or site admin.';

revoke all on function public.set_boss_role_targets(integer, integer, integer, integer, integer, integer) from public, anon;
grant execute on function public.set_boss_role_targets(integer, integer, integer, integer, integer, integer) to authenticated;
