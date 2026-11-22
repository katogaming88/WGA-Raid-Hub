-- #1560: Settings > Loot's access card. Two team settings, both in
-- team_settings.config and saved by the team leader through set_team_setting():
--
--   lootHistoryAccess  'team' (default) | 'officers'
--     Who can open the team's Loot history page (#814). With 'officers', the
--     page's read, team_loot_history(), refuses anyone without the team's
--     view_loot permission, a guild "See every team" reader or a site admin.
--     The loot rows themselves stay publicly readable: Home's Recent loot,
--     profiles and the Priority page read them (Kat, 2026-11-22, "lock the
--     page").
--
--   lootImportAccess   'officers' (default) | 'leader'
--     Who can add loot rows, which only import_rclc_loot() does. With
--     'leader', only the team leader or a site admin may. Enforced by the
--     table's insert rule, so the import (security invoker) is refused too.
--
-- Anything else in either key counts as the default, so every team, We Go
-- Again's included, keeps today's access until its leader changes it.

-- Whether the caller may open the team's Loot history page.
create function public.loot_history_open(p_team_id integer)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(
           (select config ->> 'lootHistoryAccess' from public.team_settings where team_id = p_team_id),
           'team'
         ) <> 'officers'
      or p_team_id = any (public.my_permission_team_ids('view_loot'))
      or p_team_id = any (public.my_guild_permission_team_ids('view_every_team'))
      or public.is_site_admin();
$$;

comment on function public.loot_history_open(integer) is
  'True when the caller may open the team''s Loot history page (#1560): always, unless the team set lootHistoryAccess to officers.';

-- Whether the caller may add loot rows (import) for the team.
create function public.loot_import_open(p_team_id integer)
returns boolean
language sql
stable
set search_path = public
as $$
  select (p_team_id = any (public.my_permission_team_ids('manage_loot'))
          and coalesce(
                (select config ->> 'lootImportAccess' from public.team_settings where team_id = p_team_id),
                'officers'
              ) <> 'leader')
      or p_team_id = any (public.my_leader_team_ids())
      or public.is_site_admin();
$$;

comment on function public.loot_import_open(integer) is
  'True when the caller may import loot for the team (#1560): officers with manage_loot, unless the team set lootImportAccess to leader; the team leader and site admins always.';

-- The Loot history page's read: every loot row of the team with its item, no
-- player. Refused when the page is locked to officers.
create function public.team_loot_history(p_team_id integer)
returns table (
  id integer,
  team_id integer,
  track text,
  season text,
  awarded_at timestamp with time zone,
  boss text,
  response text,
  item_id integer,
  item_name text,
  slot text,
  armor_type text,
  wow_item_id integer,
  is_ptr boolean,
  icon text
)
language plpgsql
stable
set search_path = public
as $$
begin
  if not public.loot_history_open(p_team_id) then
    raise exception 'Not authorized';
  end if;
  return query
    select l.id, l.team_id, l.track, l.season, l.awarded_at, l.boss, l.response, l.item_id,
           i.name, i.slot, i.armor_type, i.wow_item_id, i.is_ptr, i.icon
      from public.rclc_loot l
      left join public.items i on i.id = l.item_id
     where l.team_id = p_team_id
     order by l.id;
end;
$$;

comment on function public.team_loot_history(integer) is
  'The team''s loot rows with their items and no player, for the Loot history page (#814). Refused unless loot_history_open() (#1560).';

revoke all on function public.loot_history_open(integer) from public, anon;
revoke all on function public.loot_import_open(integer) from public, anon;
revoke all on function public.team_loot_history(integer) from public, anon;
grant execute on function public.loot_history_open(integer) to authenticated, service_role;
grant execute on function public.loot_import_open(integer) to authenticated, service_role;
grant execute on function public.team_loot_history(integer) to authenticated, service_role;

-- The officers' write rule covered every command. Split it so adding rows
-- follows the import setting; changing and removing rows (Reassign, fixes)
-- stays with manage_loot as before.
drop policy "Officer write loot" on public.rclc_loot;

create policy "Officer update loot" on public.rclc_loot
  for update
  using (team_id = any ((select my_permission_team_ids('manage_loot'))::integer[])
         or (select is_site_admin()))
  with check (team_id = any ((select my_permission_team_ids('manage_loot'))::integer[])
         or (select is_site_admin()));

create policy "Officer delete loot" on public.rclc_loot
  for delete
  using (team_id = any ((select my_permission_team_ids('manage_loot'))::integer[])
         or (select is_site_admin()));

create policy "Importer insert loot" on public.rclc_loot
  for insert
  with check (public.loot_import_open(team_id));
