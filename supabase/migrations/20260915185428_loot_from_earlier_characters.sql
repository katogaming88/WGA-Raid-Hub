-- #942 step 5 (part b): a raider's earlier characters, so their season loot
-- total counts everything they received.
--
-- Kat's calls (2026-09-15):
--   - Loot received on an earlier main this season counts toward the raider's
--     total, because officers weigh it when awarding loot. The total is shown
--     in the new app's roster Items column and the profile's loot list, with
--     old-main items marked "on <character>".
--   - Loot from a team the raider left mid-season carries over too, marked
--     "on <team>". Someone raiding on two teams at once keeps a separate total
--     on each (2026-09-14: officers see only the other team's name).
--   - The Priority List's "already has this item" check stays per character,
--     and the current site is unchanged.
--
-- Loot and roster rows are public to read, but which rows belong to the same
-- person is not: a team's officers read only their own team's memberships. So
-- this answers only the pairs, and only for a team's officers (and site admins
-- and guild officers, who read every team) or for the raider's own rows.

create or replace function public.earlier_characters(p_team_id integer)
returns table(player_id integer, earlier_player_id integer)
language sql stable security definer set search_path to 'public'
as $$
  select p.id, q.id
    from players p
    join team_members tm on tm.id = p.team_member_id
    join team_members tq on tq.person_id = tm.person_id
    join players q on q.team_member_id = tq.id
   where p.team_id = p_team_id
     and p.archived_at is null
     and q.id <> p.id
     -- An earlier character is one no longer on its roster: an old main on
     -- this team, or a character on a team the person has left (no active
     -- character there any more). A team they are still on keeps its own total.
     and q.archived_at is not null
     and (
       q.team_id = p.team_id
       or not exists (
         select 1 from players r where r.team_member_id = tq.id and r.archived_at is null
       )
     )
     and (
       p_team_id = any ((select my_officer_team_ids())::integer[])
       or (select is_site_admin())
       or (select is_guild_officer())
       or tm.person_id = (select my_person_id())
     );
$$;

comment on function public.earlier_characters(integer) is
  'For each active roster row on a team, the same person''s archived characters whose season loot counts toward that row''s total: old mains on the team, and characters on teams the person has left (#942 step 5b). Answers every row for the team''s officers, site admins and guild officers, and only the caller''s own rows for anyone else.';

revoke all on function public.earlier_characters(integer) from public, anon;
grant execute on function public.earlier_characters(integer) to authenticated;
