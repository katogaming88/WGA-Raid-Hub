-- #1683: officers order the raiders within each role section on Boss Lineup.
--
-- Each section lists raiders A-Z. An officer can move one (a fill raider to
-- the bottom of Ranged); that order is the team's, shared by every officer
-- and raider, a standing setting that saves the moment it is moved (Kat,
-- 2026-10-27), never part of the lineup's Save.
--
-- team_raider_order: one row per team and raider that has been placed. A
-- section with no rows is A-Z; a raider with no row (joined after) lists
-- after the placed ones, A-Z among the other new raiders. Sort A-Z deletes
-- the section's rows.

create table public.team_raider_order (
  team_id integer not null references public.teams (id) on delete cascade,
  player_id integer not null references public.players (id) on delete cascade,
  position integer not null check (position > 0),
  updated_at timestamp with time zone not null default now(),
  primary key (team_id, player_id)
);

comment on table public.team_raider_order is
  'The order a team lists its raiders in within a role section of Boss Lineup (#1683); position counts from 1 within the raider''s role. A raider with no row lists after the placed ones, A-Z. Written only by set_lineup_raider_order().';

create index team_raider_order_player_id_idx on public.team_raider_order (player_id);

alter table public.team_raider_order owner to postgres;
alter table public.team_raider_order enable row level security;

-- Read by whoever reads the team's raid nights (the same rules as
-- team_boss_role_targets).
create policy "Claude readers read team_raider_order" on public.team_raider_order
  for select to claude_readers using (true);
create policy "Officers read team_raider_order" on public.team_raider_order for select
  using (((team_id = any ((select my_permission_team_ids('edit_schedule'))::integer[]))
    or (team_id = any ((select my_permission_team_ids('attendance'))::integer[]))
    or (team_id = any ((select my_guild_permission_team_ids('view_every_team'))::integer[]))
    or (select is_site_admin())));
create policy "Team raiders read team_raider_order" on public.team_raider_order for select
  using ((team_id in (select p.team_id from players p where p.id = any ((select my_active_player_ids())::integer[]))));

-- Read only for the site's roles: every write goes through the function
-- below, so a direct write fails loudly rather than matching no row.
revoke all on table public.team_raider_order from public, anon, authenticated, service_role;
grant select on table public.team_raider_order to anon, authenticated;
grant select, insert, update, delete on table public.team_raider_order to service_role;

-- One role section's order: the raiders in it, first at the top. An empty
-- list puts the section back to A-Z.
create or replace function public.set_lineup_raider_order(
  p_team_id integer,
  p_role text,
  p_player_ids integer[]
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

  if not exists (select 1 from teams where id = p_team_id) then
    raise exception 'There is no such team.';
  end if;

  if p_role is null or p_role not in (select distinct role from classes_specs) then
    raise exception 'There is no such role.';
  end if;

  p_player_ids := coalesce(p_player_ids, '{}');

  if (select count(distinct x) from unnest(p_player_ids) x) <> cardinality(p_player_ids) then
    raise exception 'A raider can be listed only once.';
  end if;

  -- Only this team's raiders, and only in their own role's section.
  if exists (
    select 1
    from unnest(p_player_ids) x
    where not exists (
      select 1
      from players p
      join classes_specs cs on cs.id = p.class_spec_id
      where p.id = x and p.team_id = p_team_id and cs.role = p_role
    )
  ) then
    raise exception 'Every raider has to be on this team and in the % section.', p_role;
  end if;

  -- Two officers moving at once: the later move wins, whole.
  perform pg_advisory_xact_lock(hashtext('raider_order'), p_team_id);

  delete from team_raider_order o
  using players p, classes_specs cs
  where o.team_id = p_team_id and p.id = o.player_id and cs.id = p.class_spec_id and cs.role = p_role;

  -- Also a raider who changed spec to another role since being placed.
  delete from team_raider_order o
  where o.team_id = p_team_id and o.player_id = any (p_player_ids);

  insert into team_raider_order (team_id, player_id, position)
  select p_team_id, o.player_id, o.ord
  from unnest(p_player_ids) with ordinality as o(player_id, ord);

  perform public.write_audit_log(
    p_team_id,
    case when cardinality(p_player_ids) = 0 then 'Reset Raider Order' else 'Set Raider Order' end,
    'team_raider_order',
    null,
    jsonb_build_object(
      'role', p_role,
      'raiders', (select coalesce(jsonb_agg(p.name_realm order by o.ord), '[]'::jsonb)
                    from unnest(p_player_ids) with ordinality as o(player_id, ord)
                    join players p on p.id = o.player_id)
    )
  );
end;
$$;

alter function public.set_lineup_raider_order(integer, text, integer[]) owner to postgres;

comment on function public.set_lineup_raider_order(integer, text, integer[]) is
  'Boss Lineup (#1683): the order of one role section''s raiders for the team, first at the top; an empty list puts the section back to A-Z. Every raider has to be on the team and in that role. edit_schedule or site admin.';

revoke all on function public.set_lineup_raider_order(integer, text, integer[]) from public, anon;
grant execute on function public.set_lineup_raider_order(integer, text, integer[]) to authenticated;
