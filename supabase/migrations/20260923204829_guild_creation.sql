-- #1226: let a signed-in person create a guild and its first team, behind a
-- switch a site admin flips.
--
-- The site front page gets a create-your-guild form, but Kat is not opening
-- guild creation yet (2026-09-24: site admins only for now, "flip the switch"
-- later). So the ability is built now and gated by site_settings.
-- guild_creation_open, which starts closed. While it is closed only a site
-- admin can create a guild; once it is open, anyone signed in with Discord can.
--
-- Not safe to open yet: a second guild is still unsupported until #1045
-- (teams.name is unique across all guilds, and guild grants and
-- admin_create_team() assume one guild). The switch is the place to hold that
-- line, not a sign it is ready.

alter table public.site_settings
  add column guild_creation_open boolean not null default false;

comment on column public.site_settings.guild_creation_open is
  'When true, any signed-in person with Discord connected can create a guild and its first team (create_guild()). When false, only a site admin can. Flipped by admin_set_guild_creation_open() (#1226).';

-- Whether the create-your-guild form is on offer to everyone. Public, because
-- the signed-out front page decides whether to show it before anyone signs in.
create or replace function public.guild_creation_open()
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select coalesce((select s.guild_creation_open from public.site_settings s where s.id = 1), false);
$$;

comment on function public.guild_creation_open() is
  'True when anyone signed in may create a guild, false when only a site admin may. Public: the front page reads it before sign-in (#1226).';

revoke all on function public.guild_creation_open() from public;
grant execute on function public.guild_creation_open() to anon;
grant execute on function public.guild_creation_open() to authenticated;

create or replace function public.admin_set_guild_creation_open(p_open boolean)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;

  update public.site_settings
     set guild_creation_open = p_open, updated_at = now()
   where id = 1;

  perform public.write_audit_log(
    null,
    case when p_open then 'guild_creation_opened' else 'guild_creation_closed' end,
    'site_settings',
    null,
    null
  );
end;
$$;

comment on function public.admin_set_guild_creation_open(boolean) is
  'Opens or closes guild creation to everyone. Site admin only (#1226).';

revoke all on function public.admin_set_guild_creation_open(boolean) from public;
revoke execute on function public.admin_set_guild_creation_open(boolean) from anon;
grant execute on function public.admin_set_guild_creation_open(boolean) to authenticated;

-- Creates a guild, its first team and the creator as that team's leader, in
-- one step. The team name is optional: left blank, the team takes the guild's
-- name, since a one-team guild does not name its team. The addresses are the random defaults (a readable one is a site
-- admin's to give, #1114). Answers with the two keys so the caller can go
-- straight to the new team.
create or replace function public.create_guild(
  p_name text,
  p_region text,
  p_realm text,
  p_team_name text default null
)
returns table(guild_key text, team_key text)
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_discord_id text;
  v_name text := trim(coalesce(p_name, ''));
  v_realm text := trim(coalesce(p_realm, ''));
  v_team_name text;
  v_team_named boolean := nullif(trim(coalesce(p_team_name, '')), '') is not null;
  v_constraint text;
  v_guild_id integer;
  v_guild_key text;
  v_team_id integer;
  v_team_key text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not (public.is_site_admin() or public.guild_creation_open()) then
    raise exception 'Creating a guild is not open yet';
  end if;

  -- team_members is keyed on the Discord id, as claim_character() is.
  v_discord_id := public.current_discord_id();
  if v_discord_id is null then
    raise exception 'Connect Discord before creating a guild';
  end if;

  if v_name = '' or length(v_name) > 60 then
    raise exception 'Give the guild a name of up to 60 characters';
  end if;
  -- A guild with one team does not name it: the team takes the guild's name.
  v_team_name := coalesce(nullif(trim(coalesce(p_team_name, '')), ''), v_name);
  if length(v_team_name) > 60 then
    raise exception 'Give the first team a name of up to 60 characters';
  end if;
  if p_region is null or p_region not in ('us', 'eu', 'kr', 'tw') then
    raise exception 'Pick a region';
  end if;
  if v_realm = '' then
    raise exception 'Give the guild''s home realm';
  end if;

  if exists (select 1 from public.guilds g where lower(g.name) = lower(v_name)) then
    raise exception 'A guild called % already exists', v_name;
  end if;
  -- teams.name is unique across every guild until #1045.
  if exists (select 1 from public.teams t where lower(t.name) = lower(v_team_name)) then
    if v_team_named then
      raise exception 'A team called % already exists', v_team_name;
    end if;
    raise exception 'The first team would be named % like your guild, but a team with that name already exists: give the team its own name', v_team_name;
  end if;

  -- The checks above read, then these insert: two callers with the same name
  -- at the same instant both pass and the second hits the unique index, so
  -- that is answered in the same words instead of a raw duplicate-key error.
  begin
    insert into public.guilds (name, region, realm)
    values (v_name, p_region, v_realm)
    returning id, url_key into v_guild_id, v_guild_key;

    insert into public.teams (name, guild_id)
    values (v_team_name, v_guild_id)
    returning id, slug into v_team_id, v_team_key;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'guilds_name_key' then
      raise exception 'A guild called % already exists', v_name;
    elsif v_constraint = 'teams_name_key' then
      raise exception 'A team called % already exists', v_team_name;
    end if;
    raise;
  end;

  -- Every write path assumes a team_settings row already exists.
  insert into public.team_settings (team_id, config) values (v_team_id, '{}'::jsonb);

  -- The trigger resolves the person and its account from the Discord id.
  insert into public.team_members (team_id, discord_id, role)
  values (v_team_id, v_discord_id, 'team_leader');

  -- The caller may be a plain signed-in person, whom write_audit_log()'s
  -- officer gate would refuse; like the other self-service RPCs this writes
  -- its own row.
  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (v_team_id, v_uid, 'Guild Created', 'guilds', v_guild_id,
          jsonb_build_object('guild', v_name, 'team', v_team_name));

  return query select v_guild_key, v_team_key;
end;
$$;

comment on function public.create_guild(text, text, text, text) is
  'Creates a guild, its first team and the caller as that team''s leader. A site admin any time; anyone signed in with Discord once guild_creation_open() is true. Random address keys (#1226).';

revoke all on function public.create_guild(text, text, text, text) from public;
revoke execute on function public.create_guild(text, text, text, text) from anon;
grant execute on function public.create_guild(text, text, text, text) to authenticated;
