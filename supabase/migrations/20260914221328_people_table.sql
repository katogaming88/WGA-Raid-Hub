-- #942 step 1: a people table, one row per human.
--
-- Until now a person had no row. Who someone is lived in five places that
-- never pointed at each other: a team_members row per team, a row in each of
-- site_admins, guild_officers and boe_managers, and the sign-in account. One
-- person on production leads both Hellfire Rollers and Wrathless, as two
-- unconnected team_members rows.
--
-- This step adds the row and points the four grant tables at it. Nothing reads
-- it yet: the access checks, the inbox and alts move onto it in the steps
-- after (the plan is on #942, 2026-09-14). The grant tables keep discord_id
-- and auth_user_id, which the current site still writes, and a trigger keeps
-- person_id level with discord_id, so neither site changes here.
--
-- What a person is:
--   - Every sign-in account is a person, whatever it signed in with. The new
--     app signs in with Battle.net and links Discord to the same account
--     (database-decisions.md, 2026-09-14), so the person hangs off the account
--     rather than off either login.
--   - A Discord id listed on a grant before its owner ever signs in is a
--     person too, with no account yet. Their account attaches the first time
--     that Discord identity appears, the same moment the grants link today.
--
-- Not in this step: players reach their person through team_members, as they
-- reach their account today, so they get no person_id of their own.
-- account_preferences moves with the inbox in step 4.

create table public.people (
  id integer generated always as identity primary key,
  auth_user_id uuid unique references auth.users (id) on delete set null,
  discord_id text unique,
  created_at timestamp with time zone not null default now()
);

comment on table public.people is
  'One row per human (#942). auth_user_id is their sign-in account, null for a Discord id listed on a grant before its owner signed in. discord_id is null for an account with no Discord linked. Grant tables point here through person_id.';

alter table public.people enable row level security;

create policy "People read own people row" on public.people
  for select using (auth_user_id = (select auth.uid()));

create policy "Claude readers read people" on public.people
  for select to claude_readers using (true);

grant select on table public.people to authenticated;
grant select on table public.people to claude_readers;

-- Backfill. Discord accounts first, so a Discord id already signed in lands on
-- its account's row rather than on a second, account-less one.
insert into public.people (auth_user_id, discord_id)
select distinct on (i.user_id) i.user_id, i.provider_id
  from auth.identities i
 where i.provider = 'discord'
 order by i.user_id, i.created_at
on conflict do nothing;

insert into public.people (auth_user_id)
select u.id
  from auth.users u
 where not exists (select 1 from public.people p where p.auth_user_id = u.id);

insert into public.people (discord_id)
select g.discord_id
  from (
    select discord_id from public.team_members
    union
    select discord_id from public.site_admins
    union
    select discord_id from public.guild_officers
    union
    select discord_id from public.boe_managers
  ) g
 where not exists (select 1 from public.people p where p.discord_id = g.discord_id);

-- A grant linked to one account while its Discord id belongs to another would
-- mean the person is ambiguous. The link trigger never writes that, so stop
-- rather than guess if it is there.
do $$
declare
  v_bad text;
begin
  select string_agg(format('%s id %s', t.tbl, t.id), ', ') into v_bad
    from (
      select 'team_members' tbl, id, discord_id, auth_user_id from public.team_members
      union all
      select 'site_admins', id, discord_id, auth_user_id from public.site_admins
      union all
      select 'guild_officers', id, discord_id, auth_user_id from public.guild_officers
      union all
      select 'boe_managers', id, discord_id, auth_user_id from public.boe_managers
    ) t
    join public.people p on p.discord_id = t.discord_id
   where t.auth_user_id is not null
     and t.auth_user_id is distinct from p.auth_user_id;
  if v_bad is not null then
    raise exception 'Grant rows linked to a different account than their Discord id: %', v_bad;
  end if;
end $$;

-- The person for a Discord id, created if nobody holds it yet. Security definer
-- because a team leader adding a member cannot write people.
create or replace function public.person_for_discord_id(p_discord_id text) returns integer
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_id integer;
  v_account uuid;
begin
  select id into v_id from people where discord_id = p_discord_id;
  if v_id is null then
    -- The account behind that Discord id, unless it is already another
    -- person's (a second Discord login on one account): then the new row
    -- waits for its account like any listed id.
    v_account := auth_user_for_discord_id(p_discord_id);
    if exists (select 1 from people where auth_user_id = v_account) then
      v_account := null;
    end if;
    insert into people (discord_id, auth_user_id)
    values (p_discord_id, v_account)
    on conflict (discord_id) do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from people where discord_id = p_discord_id;
    end if;
  end if;
  return v_id;
end;
$$;

revoke all on function public.person_for_discord_id(text) from public, anon, authenticated;

-- person_id always follows discord_id. On every insert and update, not only an
-- update of discord_id: team leaders write team_members directly, and a
-- person_id they chose would outlive the steps that start trusting it.
create or replace function public.set_person_from_discord_id() returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  new.person_id := person_for_discord_id(new.discord_id);
  return new;
end;
$$;

revoke all on function public.set_person_from_discord_id() from public, anon, authenticated;

alter table public.team_members add column person_id integer references public.people (id);
alter table public.site_admins add column person_id integer references public.people (id);
alter table public.guild_officers add column person_id integer references public.people (id);
alter table public.boe_managers add column person_id integer references public.people (id);

update public.team_members t set person_id = p.id from public.people p where p.discord_id = t.discord_id;
update public.site_admins t set person_id = p.id from public.people p where p.discord_id = t.discord_id;
update public.guild_officers t set person_id = p.id from public.people p where p.discord_id = t.discord_id;
update public.boe_managers t set person_id = p.id from public.people p where p.discord_id = t.discord_id;

alter table public.team_members alter column person_id set not null;
alter table public.site_admins alter column person_id set not null;
alter table public.guild_officers alter column person_id set not null;
alter table public.boe_managers alter column person_id set not null;

-- One membership per person per team, the same fact the (team_id, discord_id)
-- key holds today, stated on the column that outlives discord_id.
alter table public.team_members add constraint team_members_team_id_person_id_key unique (team_id, person_id);
create index site_admins_person_id_idx on public.site_admins (person_id);
create index guild_officers_person_id_idx on public.guild_officers (person_id);
create index boe_managers_person_id_idx on public.boe_managers (person_id);

create trigger team_members_set_person
  before insert or update on public.team_members
  for each row execute function public.set_person_from_discord_id();
create trigger site_admins_set_person
  before insert or update on public.site_admins
  for each row execute function public.set_person_from_discord_id();
create trigger guild_officers_set_person
  before insert or update on public.guild_officers
  for each row execute function public.set_person_from_discord_id();
create trigger boe_managers_set_person
  before insert or update on public.boe_managers
  for each row execute function public.set_person_from_discord_id();

-- A discarded account (discard-empty-account deletes an empty Battle.net
-- sign-in) nulls its person's auth_user_id. A person left with neither an
-- account nor a Discord id is nobody, so the row goes; nothing can point at
-- it, because anything that does carries a discord_id.
create or replace function public.delete_empty_person() returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  delete from people where id = new.id;
  return null;
end;
$$;

revoke all on function public.delete_empty_person() from public, anon, authenticated;

create trigger people_delete_when_empty
  after update of auth_user_id, discord_id on public.people
  for each row
  when (new.auth_user_id is null and new.discord_id is null)
  execute function public.delete_empty_person();

-- The sign-in trigger now keeps the person as well as the grants.
--
-- Any identity: the account is a person. Discord identity, three cases:
--   - its Discord id was listed, and the account has no person of its own:
--     the listed person gets the account (a Discord sign-up, as today).
--   - the account already has a person (it signed in with Battle.net first)
--     and nobody listed this Discord id: that person gets the Discord id.
--   - both exist: the account signed in with Battle.net first, then connected
--     a Discord id someone had listed. The listed person is the one the grants
--     point at, so it takes the account and the Battle.net-only person goes.
--     Nothing else points at a person yet; step 4 moves preferences here and
--     has to carry them across in this branch.
create or replace function public.link_auth_user_to_member()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_listed integer;
  v_own integer;
begin
  select id into v_own from people where auth_user_id = new.user_id;

  -- Only a Discord identity links a Discord-keyed grant. One early return
  -- rather than a condition on each update, so a fifth grant table added later
  -- is covered without anyone remembering.
  if new.provider is distinct from 'discord' then
    if v_own is null then
      insert into people (auth_user_id) values (new.user_id) on conflict do nothing;
    end if;
    return new;
  end if;

  select id into v_listed from people where discord_id = new.provider_id;

  if v_listed is null and v_own is null then
    insert into people (auth_user_id, discord_id) values (new.user_id, new.provider_id);
  elsif v_listed is null then
    update people set discord_id = new.provider_id where id = v_own and discord_id is null;
  elsif v_own is null then
    update people set auth_user_id = new.user_id where id = v_listed and auth_user_id is null;
  elsif v_listed <> v_own then
    delete from people where id = v_own;
    update people set auth_user_id = new.user_id where id = v_listed and auth_user_id is null;
  end if;

  update team_members
  set auth_user_id = new.user_id
  where discord_id = new.provider_id
    and auth_user_id is null;

  update site_admins
  set auth_user_id = new.user_id
  where discord_id = new.provider_id
    and auth_user_id is null;

  update boe_managers
  set auth_user_id = new.user_id
  where discord_id = new.provider_id
    and auth_user_id is null;

  update guild_officers
  set auth_user_id = new.user_id
  where discord_id = new.provider_id
    and auth_user_id is null;

  return new;
end;
$function$;
