-- #1649: my_permissions() answers what the caller's rank may do on one team
-- and its guild, in one call.
--
-- The new app decided what to show from role names. It now asks the grids
-- instead, and has_team_permission() / has_guild_permission() answer one
-- permission at a time, which would be about two dozen calls per page. This
-- runs them over every permission on the two grids and returns the names the
-- answer is true for, so the app shows exactly what the database will allow.
-- Both arguments are optional: a guild page names no team, and a signed-in
-- caller with no rank anywhere gets two empty lists. A team that is not in
-- the guild named is asked about on its own guild, so one argument cannot be
-- used to borrow the other's rank.

create or replace function public.my_permissions(
  p_team_id integer default null,
  p_guild_id integer default null
)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'team', coalesce((
      select jsonb_agg(k.permission order by k.position)
        from rank_permissions k
       where k.scope = 'team' and has_team_permission(p_team_id, k.permission)
    ), '[]'::jsonb),
    'guild', coalesce((
      select jsonb_agg(k.permission order by k.position)
        from rank_permissions k
       where k.scope = 'guild'
         and has_guild_permission(
               coalesce((select t.guild_id from teams t where t.id = p_team_id), p_guild_id),
               k.permission)
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.my_permissions(integer, integer) from public, anon;
grant execute on function public.my_permissions(integer, integer) to authenticated;
