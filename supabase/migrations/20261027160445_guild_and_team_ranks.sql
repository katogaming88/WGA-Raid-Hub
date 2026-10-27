-- #1645: guild and team ranks, each rank's permissions stored, kept in step
-- with today's roles until cutover (the database step of #1517).
--
-- What this adds:
--
-- * Team ranks on team_members.rank: owner (one per team), officer,
--   assistant, raider.
-- * Guild ranks in guild_ranks: owner (one per guild), admin, team_lead and
--   member. Member is automatic for anyone on a team in the guild, so a row
--   is only needed for the other three, or for a member who holds one of the
--   two per-person switches ("See every team, read-only" and "Officer on
--   every team"), both off for everyone.
-- * rank_permissions, the two grids' rows with #1517's defaults, and
--   guild_rank_permissions / team_rank_permissions, each guild's and team's
--   own copy, filled from the defaults when the guild or team is made. A row
--   means that rank has that permission. An owner holds every permission, so
--   owners have no rows.
-- * has_team_permission(team_id, permission) and
--   has_guild_permission(guild_id, permission), the two checks later rules
--   and functions ask. Nothing asks them yet: moving the existing checks over
--   is the next two issues.
--
-- Kept in step with what the current site reads, both ways, until the old
-- roles are dropped after the switch:
--
--   team rank   owner -> team_leader, officer -> officer,
--               assistant and raider -> raider
--   team role   team_leader -> owner, or officer when the team already has
--               one (Phoenix's co-leader case: both stay team_leader on the
--               current site), officer -> officer, raider -> raider
--   guild rank  owner or admin <-> a guild_officer grant
--
-- team_members_rank_matches_role holds the team pairs to that table, so the
-- two can never disagree. boe_manager and site_admin grants are untouched:
-- BoE Manager goes away at cutover, and Staff is site_admin renamed.
--
-- Converting We Go Again's people is its own issue. Here each team's one
-- team leader becomes its owner and each guild officer an admin, which is
-- only what keeps the two in step; We Go Again has no guild owner until that
-- issue picks one. create_guild() makes its caller the new guild's owner.

-- The two grids. scope says which grid the row is on; position is its order
-- there; default_ranks are the ranks a new guild or team starts with it on.
create table public.rank_permissions (
  permission text primary key,
  scope text not null check (scope in ('guild', 'team')),
  position integer not null,
  default_ranks text[] not null,
  unique (permission, scope)
);

comment on table public.rank_permissions is
  'Every permission on the guild and team grids, with the ranks that have it in a new guild or team (#1517, #1645). Owners hold every permission and are not listed.';

insert into public.rank_permissions (permission, scope, position, default_ranks) values
  ('create_teams',          'guild',  1, '{team_lead,admin}'),
  ('rename_archive_teams',  'guild',  2, '{admin}'),
  ('change_team_owner',     'guild',  3, '{admin}'),
  ('edit_guild_profile',    'guild',  4, '{admin}'),
  ('edit_own_bio',          'guild',  5, '{team_lead,admin}'),
  ('edit_all_bios',         'guild',  6, '{admin}'),
  ('record_boe',            'guild',  7, '{admin}'),
  ('pay_any_boe',           'guild',  8, '{admin}'),
  ('edit_boe_settings',     'guild',  9, '{admin}'),
  ('view_guild_audit_log',  'guild', 10, '{admin}'),
  ('export_guild_data',     'guild', 11, '{}'),
  ('own_character',         'team',   1, '{raider,assistant,officer}'),
  ('edit_own_wishlist',     'team',   2, '{raider,assistant,officer}'),
  ('edit_roster',           'team',   3, '{assistant,officer}'),
  ('edit_schedule',         'team',   4, '{assistant,officer}'),
  ('see_rsvps',             'team',   5, '{assistant,officer}'),
  ('attendance',            'team',   6, '{assistant,officer}'),
  ('manage_signups',        'team',   7, '{assistant,officer}'),
  ('view_reports',          'team',   8, '{assistant,officer}'),
  ('view_loot',             'team',   9, '{assistant,officer}'),
  ('manage_loot',           'team',  10, '{officer}'),
  ('pay_boe_cuts',          'team',  11, '{officer}'),
  ('promote_assistants',    'team',  12, '{officer}'),
  ('view_team_audit_log',   'team',  13, '{officer}');

create table public.guild_rank_permissions (
  guild_id integer not null references public.guilds(id) on delete cascade,
  rank text not null check (rank in ('member', 'team_lead', 'admin')),
  permission text not null,
  scope text not null default 'guild' check (scope = 'guild'),
  primary key (guild_id, rank, permission),
  foreign key (permission, scope) references public.rank_permissions (permission, scope)
);

comment on table public.guild_rank_permissions is
  'Each guild''s grid: a row means that guild rank has that permission there (#1645). Filled from rank_permissions.default_ranks when the guild is made; the Owner changes it later.';

create table public.team_rank_permissions (
  team_id integer not null references public.teams(id) on delete cascade,
  rank text not null check (rank in ('raider', 'assistant', 'officer')),
  permission text not null,
  scope text not null default 'team' check (scope = 'team'),
  primary key (team_id, rank, permission),
  foreign key (permission, scope) references public.rank_permissions (permission, scope)
);

comment on table public.team_rank_permissions is
  'Each team''s grid: a row means that team rank has that permission there (#1645). Filled from rank_permissions.default_ranks when the team is made; the Team Owner changes it later.';

-- A new guild or team starts with the default grid.
create function public.seed_rank_permissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'guilds' then
    insert into guild_rank_permissions (guild_id, rank, permission)
    select new.id, r.rank, p.permission
      from rank_permissions p, unnest(p.default_ranks) as r(rank)
     where p.scope = 'guild';
  else
    insert into team_rank_permissions (team_id, rank, permission)
    select new.id, r.rank, p.permission
      from rank_permissions p, unnest(p.default_ranks) as r(rank)
     where p.scope = 'team';
  end if;
  return null;
end;
$$;

revoke all on function public.seed_rank_permissions() from public, anon, authenticated;

create trigger guilds_seed_rank_permissions
  after insert on public.guilds
  for each row execute function public.seed_rank_permissions();
create trigger teams_seed_rank_permissions
  after insert on public.teams
  for each row execute function public.seed_rank_permissions();

insert into public.guild_rank_permissions (guild_id, rank, permission)
select g.id, r.rank, p.permission
  from public.guilds g, public.rank_permissions p, unnest(p.default_ranks) as r(rank)
 where p.scope = 'guild';

insert into public.team_rank_permissions (team_id, rank, permission)
select t.id, r.rank, p.permission
  from public.teams t, public.rank_permissions p, unnest(p.default_ranks) as r(rank)
 where p.scope = 'team';

-- Team ranks. The backfill runs with the two update triggers off so it
-- neither stamps updated_at on every row (#272: null means never edited) nor
-- re-resolves every person.
alter table public.team_members add column rank text;

alter table public.team_members disable trigger trg_team_members_updated_at;
alter table public.team_members disable trigger team_members_set_person;

update public.team_members
   set rank = case role when 'raider' then 'raider' else 'officer' end;

-- Each team's earliest current team leader is its owner; every team on
-- production has exactly one.
update public.team_members
   set rank = 'owner'
 where id in (select distinct on (team_id) id
                from public.team_members
               where role = 'team_leader' and archived_at is null
               order by team_id, id);

alter table public.team_members enable trigger trg_team_members_updated_at;
alter table public.team_members enable trigger team_members_set_person;

alter table public.team_members alter column rank set not null;

alter table public.team_members add constraint team_members_rank_matches_role check (
  (rank = 'owner' and role = 'team_leader')
  or (rank = 'officer' and role in ('officer', 'team_leader'))
  or (rank in ('assistant', 'raider') and role = 'raider')
);

-- One owner per team. An archived owner holds no rank there, so they do
-- not count.
create unique index team_members_one_owner on public.team_members (team_id)
  where rank = 'owner' and archived_at is null;

comment on column public.team_members.rank is
  'Team rank (#1645): owner (one per team), officer, assistant or raider. Kept in step with role until the old roles are dropped at cutover, both ways, by team_members_keep_rank_and_role: setting one sets the other. team_members_rank_matches_role holds the pairs.';

-- Whichever of rank and role the write changed, the other follows. A role
-- of team_leader on a team that already has an owner, or bringing an
-- archived owner back to such a team, makes an officer who is still a
-- team_leader on the current site. Naming owner outright is left to the
-- unique index to refuse.
create function public.team_members_keep_rank_and_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rank_named boolean := new.rank is not null
                          and (tg_op = 'INSERT' or new.rank is distinct from old.rank);
begin
  if v_rank_named then
    if tg_op = 'UPDATE' or new.role is null then
      new.role := case new.rank when 'owner' then 'team_leader'
                                when 'officer' then 'officer'
                                else 'raider' end;
    end if;
  elsif tg_op = 'INSERT' or new.role is distinct from old.role then
    new.rank := case new.role when 'team_leader' then 'owner'
                              when 'officer' then 'officer'
                              else 'raider' end;
  end if;

  if not v_rank_named and new.rank = 'owner' and new.archived_at is null
     and exists (select 1 from team_members m
                  where m.team_id = new.team_id and m.id <> new.id
                    and m.rank = 'owner' and m.archived_at is null) then
    new.rank := 'officer';
  end if;
  return new;
end;
$$;

revoke all on function public.team_members_keep_rank_and_role() from public, anon, authenticated;

create trigger team_members_keep_rank_and_role
  before insert or update of role, rank, archived_at on public.team_members
  for each row execute function public.team_members_keep_rank_and_role();

-- Guild ranks.
create table public.guild_ranks (
  guild_id integer not null references public.guilds(id),
  person_id integer not null references public.people(id),
  rank text not null default 'member' check (rank in ('owner', 'admin', 'team_lead', 'member')),
  sees_every_team boolean not null default false,
  officer_on_every_team boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (guild_id, person_id)
);

create unique index guild_ranks_one_owner on public.guild_ranks (guild_id) where rank = 'owner';
create index guild_ranks_person_id_idx on public.guild_ranks (person_id);

comment on table public.guild_ranks is
  'A person''s rank in a guild (#1645): owner (one per guild), admin, team_lead or member. Member is automatic for anyone on a team in the guild, so a member has a row only to hold one of the two switches. Owner and admin are kept in step with a guild_officer grant until cutover, both ways.';
comment on column public.guild_ranks.sees_every_team is
  '"See every team, read-only" (#1517): set by the guild Owner per person. Off for everyone; the read rules that use it come later.';
comment on column public.guild_ranks.officer_on_every_team is
  '"Officer on every team" (#1517): set by the guild Owner per person. While on, has_team_permission() answers as an Officer on every team in the guild.';

insert into public.guild_ranks (guild_id, person_id, rank)
select guild_id, person_id, 'admin'
  from public.guild_grants
 where grant_type = 'guild_officer';

-- A guild owner or admin holds a guild_officer grant; nobody else does.
create function public.guild_ranks_keep_grant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' and old.rank in ('owner', 'admin')
     and (tg_op = 'DELETE' or new.rank not in ('owner', 'admin')) then
    delete from guild_grants
     where person_id = old.person_id and guild_id = old.guild_id and grant_type = 'guild_officer';
  end if;
  if tg_op <> 'DELETE' and new.rank in ('owner', 'admin') then
    insert into guild_grants (person_id, guild_id, grant_type)
    values (new.person_id, new.guild_id, 'guild_officer')
    on conflict (person_id, guild_id, grant_type) do nothing;
  end if;
  return null;
end;
$$;

revoke all on function public.guild_ranks_keep_grant() from public, anon, authenticated;

create trigger guild_ranks_keep_grant
  after insert or update of rank or delete on public.guild_ranks
  for each row execute function public.guild_ranks_keep_grant();

-- The current site's Grant and Revoke Guild Officer, the other way. Revoking
-- the owner's grant is refused: the guild would keep an owner with no
-- guild_officer grant.
create function public.guild_grants_keep_rank()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.grant_type = 'guild_officer' then
      insert into guild_ranks (guild_id, person_id, rank)
      values (new.guild_id, new.person_id, 'admin')
      on conflict (guild_id, person_id) do update set rank = 'admin'
       where guild_ranks.rank not in ('owner', 'admin');
    end if;
  elsif old.grant_type = 'guild_officer' then
    if exists (select 1 from guild_ranks
                where guild_id = old.guild_id and person_id = old.person_id and rank = 'owner') then
      raise exception 'That person is the guild''s Owner. Hand the guild to someone else first.';
    end if;
    update guild_ranks set rank = 'member'
     where guild_id = old.guild_id and person_id = old.person_id and rank = 'admin';
  end if;
  return null;
end;
$$;

revoke all on function public.guild_grants_keep_rank() from public, anon, authenticated;

create trigger guild_grants_keep_rank
  after insert or delete on public.guild_grants
  for each row execute function public.guild_grants_keep_rank();

-- The two checks. Never null. An owner holds every permission on its grid;
-- anyone else, what their rank's row in the grid says. A permission name not
-- on that grid is false for everyone, owners included, so a misspelt name
-- fails closed.
create function public.has_team_permission(p_team_id integer, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with ranks as (
    select m.rank
      from team_members m
     where m.team_id = p_team_id and m.person_id = my_person_id() and m.archived_at is null
    union all
    select 'officer'
      from guild_ranks g
      join teams t on t.guild_id = g.guild_id
     where t.id = p_team_id and g.person_id = my_person_id() and g.officer_on_every_team
  )
  select exists (select 1 from rank_permissions k where k.permission = p_permission and k.scope = 'team')
     and exists (select 1 from ranks r
                  where r.rank = 'owner'
                     or exists (select 1 from team_rank_permissions p
                                 where p.team_id = p_team_id and p.rank = r.rank
                                   and p.permission = p_permission));
$$;

comment on function public.has_team_permission(integer, text) is
  'Whether the caller''s rank on this team has this permission on its grid (#1645). The owner has all; "Officer on every team" in the team''s guild answers as an officer. Never null.';

revoke all on function public.has_team_permission(integer, text) from public, anon;
grant execute on function public.has_team_permission(integer, text) to authenticated;

create function public.has_guild_permission(p_guild_id integer, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with ranks as (
    select g.rank
      from guild_ranks g
     where g.guild_id = p_guild_id and g.person_id = my_person_id()
    union all
    select 'member'
      from team_members m
      join teams t on t.id = m.team_id
     where t.guild_id = p_guild_id and m.person_id = my_person_id() and m.archived_at is null
  )
  select exists (select 1 from rank_permissions k where k.permission = p_permission and k.scope = 'guild')
     and exists (select 1 from ranks r
                  where r.rank = 'owner'
                     or exists (select 1 from guild_rank_permissions p
                                 where p.guild_id = p_guild_id and p.rank = r.rank
                                   and p.permission = p_permission));
$$;

comment on function public.has_guild_permission(integer, text) is
  'Whether the caller''s rank in this guild has this permission on its grid (#1645). The owner has all; anyone on a team in the guild is at least a member. Never null.';

revoke all on function public.has_guild_permission(integer, text) from public, anon;
grant execute on function public.has_guild_permission(integer, text) to authenticated;

-- Whoever creates a guild is its owner, and so also its guild officer.
create or replace function public.create_guild(p_name text, p_region text, p_realm text, p_team_name text default null::text)
returns table(guild_key text, team_key text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_discord_id text;
  v_name text := trim(coalesce(p_name, ''));
  v_realm text := trim(coalesce(p_realm, ''));
  v_team_name text;
  v_guild_id integer;
  v_guild_key text;
  v_team_id integer;
  v_team_key text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not public.guild_creation_open() then
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

  -- Names are labels, not identities (names_unique_per_guild): two guilds may
  -- share a name, and a brand-new guild has no other team to clash with.
  insert into public.guilds (name, region, realm)
  values (v_name, p_region, v_realm)
  returning id, url_key into v_guild_id, v_guild_key;

  -- The creator owns the guild (#1645); guild_ranks_keep_grant() gives them
  -- the guild_officer grant the current site reads.
  insert into public.guild_ranks (guild_id, person_id, rank)
  values (v_guild_id, public.person_for_discord_id(v_discord_id), 'owner');

  insert into public.teams (name, guild_id)
  values (v_team_name, v_guild_id)
  returning id, slug into v_team_id, v_team_key;

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
$function$;

-- Access. The grids hold nothing private, so they read like team_settings:
-- anyone. A guild's ranks read to the person themself, that guild's
-- officers and site admins. No write for any client role: the pages that
-- change ranks and grids come with functions of their own.
alter table public.rank_permissions enable row level security;
alter table public.guild_rank_permissions enable row level security;
alter table public.team_rank_permissions enable row level security;
alter table public.guild_ranks enable row level security;

create policy "Claude readers read rank_permissions" on public.rank_permissions
  for select to claude_readers using (true);
create policy "Anyone reads rank_permissions" on public.rank_permissions
  for select to anon, authenticated using (true);

create policy "Claude readers read guild_rank_permissions" on public.guild_rank_permissions
  for select to claude_readers using (true);
create policy "Anyone reads guild_rank_permissions" on public.guild_rank_permissions
  for select to anon, authenticated using (true);

create policy "Claude readers read team_rank_permissions" on public.team_rank_permissions
  for select to claude_readers using (true);
create policy "Anyone reads team_rank_permissions" on public.team_rank_permissions
  for select to anon, authenticated using (true);

create policy "Claude readers read guild_ranks" on public.guild_ranks
  for select to claude_readers using (true);
create policy "Own, guild officers and site admins read guild_ranks" on public.guild_ranks
  for select to authenticated
  using (person_id = (select my_person_id()) or (select is_site_admin())
         or guild_id in (select t.guild_id from teams t
                          where t.id = any ((select my_guild_officer_team_ids())::integer[])));

revoke all on table public.rank_permissions from public, anon, authenticated, service_role;
grant select on table public.rank_permissions to anon, authenticated, service_role;
revoke all on table public.guild_rank_permissions from public, anon, authenticated, service_role;
grant select on table public.guild_rank_permissions to anon, authenticated, service_role;
revoke all on table public.team_rank_permissions from public, anon, authenticated, service_role;
grant select on table public.team_rank_permissions to anon, authenticated, service_role;
revoke all on table public.guild_ranks from public, anon, authenticated, service_role;
grant select on table public.guild_ranks to authenticated, service_role;
