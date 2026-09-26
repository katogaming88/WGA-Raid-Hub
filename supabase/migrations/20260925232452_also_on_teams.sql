-- #486: a person raiding on two teams at once. Kat's call (2026-09-14, on
-- #942): a team's officers see the other team's name and nothing else. A
-- Phoenix officer sees "also on Hellfire" on that raider's profile.
--
-- Which rows belong to the same person is not public: a team's officers read
-- only their own team's memberships, so they cannot see the Hellfire row behind
-- a Phoenix raider. This answers only the pair (roster row, other team's
-- name), and only for a team's officers, site admins and guild officers.
-- A raider already knows their own teams, so they are not answered.

create or replace function public.also_on_teams(p_team_id integer)
returns table(player_id integer, team_name text)
language sql stable security definer set search_path to 'public'
as $$
  select p.id, t.name
    from players p
    join team_members tm on tm.id = p.team_member_id
    join team_members tq on tq.person_id = tm.person_id and tq.team_id <> p.team_id
    join players q on q.team_member_id = tq.id and q.archived_at is null
    join teams t on t.id = q.team_id
   where p.team_id = p_team_id
     and p.archived_at is null
     and t.archived_at is null
     and (
       p_team_id = any ((select my_officer_team_ids())::integer[])
       or (select is_site_admin())
       or (select is_guild_officer())
     )
   group by p.id, t.name;
$$;

comment on function public.also_on_teams(integer) is
  'For each active roster row on a team, the names of the other teams where the same person also has an active character (#486). Answers only the team''s officers, site admins and guild officers; a raider gets nothing.';

revoke all on function public.also_on_teams(integer) from public, anon;
grant execute on function public.also_on_teams(integer) to authenticated;
