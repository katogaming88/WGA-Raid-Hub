-- Guild officers run their own guild's teams (#1643): add one, rename it or
-- change its address, archive or bring it back, and unlist it. Staff do not
-- (Kat, 2026-10-24): every function checks a guild_officer grant for the
-- team's own guild, not one anywhere (is_guild_officer(), #1324).
--
-- The current site's admin_create_team(), admin_update_team() and
-- admin_set_team_archived() stay until it is retired (#1105): its Site Admin
-- page still calls them.

-- Unlisted: kept off the team lists of anyone not on the team, and out of
-- every read across teams, but still opened by its address. A flag the lists
-- read, not a read rule on teams: resolve_address() reads teams as the
-- visitor, so hiding the row would close the address too.
alter table public.teams add column unlisted boolean not null default false;

comment on column public.teams.unlisted is
  'Kept off the team switcher, the cold-landing picker and the guild''s pages for anyone not on the team, and out of also_on_teams(); still opened by its address. Set by a guild officer of the team''s guild through set_team_unlisted() (#1643).';

-- Wrathless raids with the guild but does not use the site; the current site
-- already hides it from its pickers with a hidden flag in js/common.js.
update public.teams
   set unlisted = true
 where slug = 'wrathless'
   and guild_id = (select id from public.guilds where url_key = 'wga');

-- Whether the caller holds a guild_officer grant for this guild. Answers only
-- about the caller, so the new app can ask it to decide what to show.
create or replace function public.is_guild_officer_of(p_guild_id integer)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from guild_grants g
      join people p on p.id = g.person_id
     where p.auth_user_id = auth.uid()
       and g.guild_id = p_guild_id
       and g.grant_type = 'guild_officer'
  );
$$;

comment on function public.is_guild_officer_of(integer) is
  'Whether the caller holds a guild_officer grant for this guild (#1643). The check behind create_team(), update_team(), set_team_archived() and set_team_unlisted().';

revoke all on function public.is_guild_officer_of(integer) from public;
revoke execute on function public.is_guild_officer_of(integer) from anon;
grant execute on function public.is_guild_officer_of(integer) to authenticated;

-- A new team in the guild: the next address, an empty settings row, and the
-- caller as its team leader, the way create_guild() makes a guild's first
-- team.
create or replace function public.create_team(p_guild_id integer, p_name text)
returns table (team_id integer, team_key text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_discord_id text;
  v_name text := trim(coalesce(p_name, ''));
  v_team_id integer;
  v_team_key text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_guild_officer_of(p_guild_id) then
    raise exception 'Not authorized';
  end if;

  -- team_members is keyed on the Discord id, as in create_guild().
  v_discord_id := public.current_discord_id();
  if v_discord_id is null then
    raise exception 'Connect Discord before adding a team';
  end if;

  if v_name = '' or length(v_name) > 60 then
    raise exception 'Give the team a name of up to 60 characters';
  end if;
  if exists (select 1 from teams t where t.guild_id = p_guild_id and lower(t.name) = lower(v_name)) then
    raise exception 'This guild already has a team called %', v_name;
  end if;

  insert into teams (name, guild_id)
  values (v_name, p_guild_id)
  returning id, slug into v_team_id, v_team_key;

  -- Every write path assumes a team_settings row already exists.
  insert into team_settings (team_id, config) values (v_team_id, '{}'::jsonb);

  -- The trigger resolves the person and its account from the Discord id.
  insert into team_members (team_id, discord_id, role)
  values (v_team_id, v_discord_id, 'team_leader');

  perform public.write_audit_log(v_team_id, 'Team Created', 'teams', v_team_id,
                                 jsonb_build_object('name', v_name, 'key', v_team_key));

  return query select v_team_id, v_team_key;
end;
$$;

comment on function public.create_team(integer, text) is
  'Adds a team to a guild, for a guild officer of that guild (#1643): the next address, an empty team_settings row, and the caller as team_leader. Returns the team id and its address key.';

revoke all on function public.create_team(integer, text) from public;
revoke execute on function public.create_team(integer, text) from anon;
grant execute on function public.create_team(integer, text) to authenticated;

-- Rename a team and/or change its address. The teams_retire_url_key trigger
-- keeps the old address working.
create or replace function public.update_team(p_team_id integer, p_name text, p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_guild_id integer;
  v_old_name text;
  v_old_key text;
  v_name text := trim(coalesce(p_name, ''));
  v_key text := lower(trim(coalesce(p_key, '')));
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select t.guild_id, t.name, t.slug into v_guild_id, v_old_name, v_old_key
    from teams t where t.id = p_team_id;
  if v_guild_id is null or not public.is_guild_officer_of(v_guild_id) then
    raise exception 'Not authorized';
  end if;

  if v_name = '' or length(v_name) > 60 then
    raise exception 'Give the team a name of up to 60 characters';
  end if;
  if exists (
    select 1 from teams t
     where t.guild_id = v_guild_id and t.id <> p_team_id and lower(t.name) = lower(v_name)
  ) then
    raise exception 'This guild already has a team called %', v_name;
  end if;

  -- The same shape as the teams_slug_format check, said in words.
  if v_key !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_key) not between 2 and 32 then
    raise exception 'An address is 2 to 32 letters, numbers and single dashes';
  end if;
  if exists (select 1 from teams t where t.guild_id = v_guild_id and t.id <> p_team_id and t.slug = v_key) then
    raise exception 'Another team in this guild already uses that address';
  end if;

  if v_name = v_old_name and v_key = v_old_key then
    return;
  end if;

  update teams set name = v_name, slug = v_key where id = p_team_id;

  perform public.write_audit_log(p_team_id, 'Team Updated', 'teams', p_team_id,
                                 jsonb_build_object('name', v_name, 'key', v_key, 'old_name', v_old_name, 'old_key', v_old_key));
end;
$$;

comment on function public.update_team(integer, text, text) is
  'Renames a team and/or changes its address key, for a guild officer of the team''s guild (#1643). The old key keeps resolving through retired_url_keys.';

revoke all on function public.update_team(integer, text, text) from public;
revoke execute on function public.update_team(integer, text, text) from anon;
grant execute on function public.update_team(integer, text, text) to authenticated;

create or replace function public.set_team_archived(p_team_id integer, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_guild_id integer;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select t.guild_id into v_guild_id from teams t where t.id = p_team_id;
  if v_guild_id is null or not public.is_guild_officer_of(v_guild_id) then
    raise exception 'Not authorized';
  end if;

  -- Archiving an archived team keeps its first date.
  update teams
     set archived_at = case when p_archived then coalesce(archived_at, now()) end
   where id = p_team_id;

  perform public.write_audit_log(p_team_id, case when p_archived then 'Team Archived' else 'Team Restored' end,
                                 'teams', p_team_id, null);
end;
$$;

comment on function public.set_team_archived(integer, boolean) is
  'Archives a team or brings it back, for a guild officer of the team''s guild (#1643).';

revoke all on function public.set_team_archived(integer, boolean) from public;
revoke execute on function public.set_team_archived(integer, boolean) from anon;
grant execute on function public.set_team_archived(integer, boolean) to authenticated;

create or replace function public.set_team_unlisted(p_team_id integer, p_unlisted boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_guild_id integer;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select t.guild_id into v_guild_id from teams t where t.id = p_team_id;
  if v_guild_id is null or not public.is_guild_officer_of(v_guild_id) then
    raise exception 'Not authorized';
  end if;

  update teams set unlisted = coalesce(p_unlisted, false) where id = p_team_id;

  perform public.write_audit_log(p_team_id, case when p_unlisted then 'Team Unlisted' else 'Team Listed' end,
                                 'teams', p_team_id, null);
end;
$$;

comment on function public.set_team_unlisted(integer, boolean) is
  'Unlists a team or lists it again, for a guild officer of the team''s guild (#1643).';

revoke all on function public.set_team_unlisted(integer, boolean) from public;
revoke execute on function public.set_team_unlisted(integer, boolean) from anon;
grant execute on function public.set_team_unlisted(integer, boolean) to authenticated;

-- An unlisted team is left out of "Also on", so #1347's testers, who join the
-- Sandbox with their real characters, show nothing new on their real team.
create or replace function public.also_on_teams(p_team_id integer)
returns table (player_id integer, team_name text)
language sql
stable
security definer
set search_path = public
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
     and not t.unlisted
     and (
       p_team_id = any ((select my_officer_team_ids())::integer[])
       or (select is_site_admin())
       or (select is_guild_officer())
     )
   group by p.id, t.name;
$$;
