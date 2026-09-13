-- #1114: guilds, URL keys, player codes and retired-key redirects.
--
-- #1100 decided the new app's addresses: /g/<guild key>/t/<team key>/...,
-- with a code for every player (/g/wga/t/phoenix/players/r5t8w2kd). WGA keeps
-- readable keys; any other guild gets random 8-character codes. Nothing in the
-- database modelled the guild or any of those keys, and the app shell (#1101)
-- routes on them, so this lands first.
--
-- 1. guilds: one row per guild, holding its URL key. WGA is seeded here.
--    Guild-wide grants (guild_officers, boe_managers, site_admins) stay
--    unscoped until #942's guild_grants; nothing needs a second guild before
--    then.
-- 2. teams.guild_id, and teams.slug becomes the team's URL key: unique within
--    its guild rather than site-wide.
-- 3. players.url_code: random, unique site-wide (so it can carry over to
--    people when #942 lands), and fixed once issued, because a shared link
--    must keep working.
-- 4. retired_url_keys: when a guild or team key changes, the old one is kept
--    so links already posted in Discord still resolve.
-- 5. resolve_address(): the one lookup the app makes per navigation.
--
-- Keys are lowercase letters, digits and single hyphens, 2 to 32 characters.
-- A new guild or team gets a random code unless a readable key is passed in;
-- the only write paths for either are site-admin functions
-- (admin_create_team/admin_update_team), so no one else can claim a readable
-- key.

-- Random 8-character code from [a-z0-9]. The byte-modulo-36 skew is harmless:
-- these are public identifiers, not secrets. 36^8 is about 2.8 trillion, so a
-- collision is not retried; the unique constraint turns one into an error.
create or replace function public.new_url_code() returns text
language sql volatile set search_path to ''
as $$
  with r as (select extensions.gen_random_bytes(8) as b)
  select string_agg(substr('abcdefghijklmnopqrstuvwxyz0123456789', get_byte(r.b, i) % 36 + 1, 1), '' order by i)
    from r, generate_series(0, 7) as i
$$;

comment on function public.new_url_code() is
  'Random 8-character [a-z0-9] code; the default for guild and team URL keys and player codes (#1114).';

-- 1. guilds

create table public.guilds (
  id integer generated always as identity primary key,
  name text not null,
  url_key text not null default public.new_url_code(),
  created_at timestamp with time zone not null default now(),
  constraint guilds_name_key unique (name),
  constraint guilds_url_key_key unique (url_key),
  constraint guilds_url_key_format check (url_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(url_key) between 2 and 32)
);

comment on table public.guilds is
  'One row per guild. url_key is the /g/<key> segment of an address: readable for WGA, a random code for any other guild (#1100, #1114).';

alter table public.guilds enable row level security;

create policy "Public read guilds" on public.guilds
  for select using (true);

create policy "Claude readers read guilds" on public.guilds
  for select to claude_readers using (true);

grant select on table public.guilds to anon, authenticated;
grant select on table public.guilds to claude_readers;

insert into public.guilds (name, url_key) values ('We Go Again', 'wga');

-- 2. teams belong to a guild; slug is the team's URL key within it

alter table public.teams add column guild_id integer references public.guilds (id);

update public.teams set guild_id = (select id from public.guilds where url_key = 'wga');

alter table public.teams alter column guild_id set not null;

alter table public.teams drop constraint teams_slug_key;
alter table public.teams add constraint teams_guild_id_slug_key unique (guild_id, slug);
alter table public.teams add constraint teams_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 2 and 32);
alter table public.teams alter column slug set default public.new_url_code();

comment on column public.teams.slug is
  'The team''s URL key: the /t/<key> segment of an address, unique within its guild (#1114). The current site''s ?team= parameter reads it too.';

-- A team made from the admin dashboard joins the guild. While there is one
-- guild that is the only choice; #1045 adds a guild argument when there is a
-- second, and until then this refuses rather than guessing.
create or replace function public.admin_create_team(
  p_name text,
  p_slug text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id integer;
  v_guild_id integer;
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;

  if (select count(*) from public.guilds) <> 1 then
    raise exception 'admin_create_team needs a guild once there is more than one (#1045)';
  end if;
  select id into v_guild_id from public.guilds;

  insert into public.teams (name, slug, guild_id)
  values (p_name, p_slug, v_guild_id)
  returning id into v_id;

  -- Every other write path (set_team_setting, fetchSupabaseSettings) assumes
  -- a team_settings row already exists and errors/returns null otherwise; a
  -- team created here would have no row until someone happened to write to
  -- it first.
  insert into public.team_settings (team_id, config) values (v_id, '{}'::jsonb);

  perform public.write_audit_log(v_id, 'team_created', 'team', v_id, jsonb_build_object('name', p_name, 'slug', p_slug));

  return v_id;
end;
$$;

-- 3. player codes

alter table public.players add column url_code text;

update public.players set url_code = public.new_url_code();

alter table public.players alter column url_code set not null;
alter table public.players alter column url_code set default public.new_url_code();
alter table public.players add constraint players_url_code_key unique (url_code);
alter table public.players add constraint players_url_code_format check (url_code ~ '^[a-z0-9]{8}$');

comment on column public.players.url_code is
  'The player''s code in an address (/players/<code>, #1114). Random, unique site-wide, and fixed once issued so shared links keep working.';

create or replace function public.keep_player_url_code() returns trigger
language plpgsql set search_path to ''
as $$
begin
  if new.url_code is distinct from old.url_code then
    raise exception 'players.url_code cannot change once issued (#1114)';
  end if;
  return new;
end;
$$;

create trigger players_keep_url_code
  before update of url_code on public.players
  for each row execute function public.keep_player_url_code();

-- 4. retired keys

create table public.retired_url_keys (
  id bigint generated always as identity primary key,
  guild_id integer not null references public.guilds (id) on delete cascade,
  team_id integer references public.teams (id) on delete cascade,
  url_key text not null,
  retired_at timestamp with time zone not null default now(),
  constraint retired_url_keys_one_per_owner unique nulls not distinct (guild_id, team_id, url_key)
);

comment on table public.retired_url_keys is
  'Keys a guild (team_id null) or team used to have, so old addresses still resolve. Written only by the key-change triggers on guilds and teams (#1114). guild_id is the guild the key lived under.';

alter table public.retired_url_keys enable row level security;

create policy "Public read retired_url_keys" on public.retired_url_keys
  for select using (true);

create policy "Claude readers read retired_url_keys" on public.retired_url_keys
  for select to claude_readers using (true);

grant select on table public.retired_url_keys to anon, authenticated;
grant select on table public.retired_url_keys to claude_readers;

-- Triggers rather than a line in each write path, so a key changed from the
-- admin dashboard, a migration or the service role is kept alike. Changing a
-- key back to one it used to have removes that retired row, so the owner's
-- current key never also sits in the retired list. Security definer because
-- whoever changes the key has no write access to retired_url_keys.
create or replace function public.retire_guild_url_key() returns trigger
language plpgsql security definer set search_path to ''
as $$
begin
  insert into public.retired_url_keys (guild_id, team_id, url_key)
  values (old.id, null, old.url_key)
  on conflict on constraint retired_url_keys_one_per_owner do update set retired_at = now();

  delete from public.retired_url_keys
   where guild_id = new.id and team_id is null and url_key = new.url_key;
  return new;
end;
$$;

revoke all on function public.retire_guild_url_key() from public, anon, authenticated;

create trigger guilds_retire_url_key
  after update of url_key on public.guilds
  for each row
  when (old.url_key is distinct from new.url_key)
  execute function public.retire_guild_url_key();

create or replace function public.retire_team_url_key() returns trigger
language plpgsql security definer set search_path to ''
as $$
begin
  insert into public.retired_url_keys (guild_id, team_id, url_key)
  values (old.guild_id, old.id, old.slug)
  on conflict on constraint retired_url_keys_one_per_owner do update set retired_at = now();

  delete from public.retired_url_keys
   where guild_id = new.guild_id and team_id = new.id and url_key = new.slug;
  return new;
end;
$$;

revoke all on function public.retire_team_url_key() from public, anon, authenticated;

create trigger teams_retire_url_key
  after update of slug, guild_id on public.teams
  for each row
  when (old.slug is distinct from new.slug or old.guild_id is distinct from new.guild_id)
  execute function public.retire_team_url_key();

-- 5. resolve_address()
--
-- Takes an address's keys as typed and returns one row naming the guild, team
-- and player they point at, with each one's current key. No row means some
-- part of the address does not exist. is_canonical is false when the address
-- used a retired key or different letter case, so the app should swap in the
-- returned keys (a redirect, not a 404).
--
-- A current key wins over a retired one, and among retired keys the most
-- recently retired wins. A team key is looked up within the guild the address
-- names, and a player code within the team, so a code pasted under the wrong
-- team is not found rather than silently moved. Security invoker: every table
-- read here is readable by anyone, which is what lets a signed-out visitor
-- open a shared link.
create or replace function public.resolve_address(
  p_guild_key text,
  p_team_key text default null,
  p_player_code text default null
)
returns table (
  guild_id integer,
  guild_key text,
  team_id integer,
  team_key text,
  player_id integer,
  player_code text,
  is_canonical boolean
)
language plpgsql stable set search_path to ''
as $$
#variable_conflict use_column
declare
  v_guild_id integer;
  v_team_id integer;
  v_player_id integer;
begin
  if p_guild_key is null or (p_player_code is not null and p_team_key is null) then
    return;
  end if;

  select g.id into v_guild_id from public.guilds g where g.url_key = lower(p_guild_key);
  if v_guild_id is null then
    select r.guild_id into v_guild_id
      from public.retired_url_keys r
     where r.team_id is null and r.url_key = lower(p_guild_key)
     order by r.retired_at desc
     limit 1;
  end if;
  if v_guild_id is null then
    return;
  end if;

  if p_team_key is not null then
    select t.id into v_team_id
      from public.teams t
     where t.guild_id = v_guild_id and t.slug = lower(p_team_key);
    if v_team_id is null then
      select r.team_id into v_team_id
        from public.retired_url_keys r
       where r.guild_id = v_guild_id and r.team_id is not null and r.url_key = lower(p_team_key)
       order by r.retired_at desc
       limit 1;
    end if;
    if v_team_id is null then
      return;
    end if;
  end if;

  if p_player_code is not null then
    select p.id into v_player_id
      from public.players p
     where p.team_id = v_team_id and p.url_code = lower(p_player_code);
    if v_player_id is null then
      return;
    end if;
  end if;

  -- A team that moved guilds is reached through its old guild's retired key,
  -- so the canonical guild is the team's own, not the one the address named.
  return query
  select g.id,
         g.url_key,
         t.id,
         t.slug,
         p.id,
         p.url_code,
         g.url_key = p_guild_key
           and t.slug is not distinct from p_team_key
           and p.url_code is not distinct from p_player_code
    from public.guilds g
    left join public.teams t on t.id = v_team_id
    left join public.players p on p.id = v_player_id
   where g.id = coalesce(t.guild_id, v_guild_id);
end;
$$;

comment on function public.resolve_address(text, text, text) is
  'Resolves an address''s guild key, team key and player code (current or retired) to ids and current keys; no row = not found, is_canonical false = redirect (#1114).';

grant execute on function public.resolve_address(text, text, text) to anon, authenticated;
