-- #1537: recruiters and their links, so an applicant is credited to whoever
-- sent them (#1551). The database half; the Members tab switch and the My
-- recruits page are the pages' issues, and storing the credit on an
-- application is the applications issue (#1539).
--
-- What this adds:
--
-- * guild_recruiters: one row per recruiter per guild, with their link code
--   and whether they are switched on. A recruiter need not be an officer.
--   The code is random, 8 characters, unique site-wide and fixed once issued,
--   like a player's url_code: links already posted in recruiting Discords keep
--   working, and it is never the recruiter's name. Switching someone off keeps
--   the row and its code, so past credit keeps its recruiter and switching
--   them back on brings the same link back.
-- * manage_recruiters, a new guild permission, on for Admins. The guild's
--   Owner has every permission.
-- * set_guild_recruiter() switches someone on or off; guild_recruiter_list()
--   is the Members tab's read of who is a recruiter and their codes.
-- * Two lookups for the apply pages, for anyone, signed out included (someone
--   may open a link before signing in): recruiter_for_code() turns a link's
--   code into the recruiter's name and whether they are on, and
--   guild_active_recruiters() is the "Who sent you?" list. Both give names
--   only: no Discord ids, characters or people ids. The list carries each
--   recruiter's code too, as the key the form sends back; it is already in
--   the recruiter's public links.

create table public.guild_recruiters (
  guild_id integer not null references public.guilds(id) on delete cascade,
  person_id integer not null references public.people(id) on delete cascade,
  code text not null unique default public.new_url_code()
    constraint guild_recruiters_code_format check (code ~ '^[a-z0-9]{8}$'),
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (guild_id, person_id)
);

comment on table public.guild_recruiters is
  'A guild''s recruiters (#1537): one row per person per guild, with the code in their apply links (?from=<code>) and whether they are switched on. Switched off keeps the row and its code. Changed only through set_guild_recruiter(); read through guild_recruiter_list(), recruiter_for_code() and guild_active_recruiters().';
comment on column public.guild_recruiters.code is
  'The code in the recruiter''s apply links. Random, unique site-wide, and fixed once issued so links already posted keep working; never the recruiter''s name.';
comment on column public.guild_recruiters.active is
  'Off: the code stops crediting new applications. Past applications keep the recruiter.';

alter table public.guild_recruiters owner to postgres;
alter table public.guild_recruiters enable row level security;

create policy "Claude readers read guild_recruiters" on public.guild_recruiters
  for select to claude_readers using (true);

-- Nobody reads or writes it directly: the functions run as their owner.
revoke all on table public.guild_recruiters from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.guild_recruiters to service_role;

-- The grid row, last on the guild grid, on for every guild's Admins.
insert into public.rank_permissions (permission, scope, position, default_ranks)
values ('manage_recruiters', 'guild', 13, '{admin}');

insert into public.guild_rank_permissions (guild_id, rank, permission)
select g.id, 'admin', 'manage_recruiters' from public.guilds g;

-- A person's name in a guild, as the Members tab shows it (guild_members()):
-- their Name on a current team there, else their Discord name. Called only
-- from the functions below, which run as the owner.
create function public.guild_person_name(p_guild_id integer, p_person_id integer)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select min(n.label)
       from names n
       join team_members m on m.id = n.team_member_id
       join teams t on t.id = m.team_id
      where m.person_id = p_person_id and t.guild_id = p_guild_id and m.archived_at is null),
    (select coalesce(nullif(i.identity_data -> 'custom_claims' ->> 'global_name', ''),
                     nullif(i.identity_data ->> 'full_name', ''),
                     nullif(i.identity_data ->> 'name', ''))
       from people pe
       join auth.identities i on i.user_id = pe.auth_user_id and i.provider = 'discord'
      where pe.id = p_person_id
      order by i.created_at desc
      limit 1),
    'Unnamed');
$$;

revoke all on function public.guild_person_name(integer, integer) from public, anon, authenticated;

-- The name signed-out visitors see: the Name on a current team, else the
-- Discord display name, else null. Never the Discord username, the handle
-- people search for to message someone (Kat, 2026-11-08).
create function public.guild_person_public_name(p_guild_id integer, p_person_id integer)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select min(n.label)
       from names n
       join team_members m on m.id = n.team_member_id
       join teams t on t.id = m.team_id
      where m.person_id = p_person_id and t.guild_id = p_guild_id and m.archived_at is null),
    (select nullif(i.identity_data -> 'custom_claims' ->> 'global_name', '')
       from people pe
       join auth.identities i on i.user_id = pe.auth_user_id and i.provider = 'discord'
      where pe.id = p_person_id
      order by i.created_at desc
      limit 1));
$$;

revoke all on function public.guild_person_public_name(integer, integer) from public, anon, authenticated;

-- Whether a person is in the guild: a guild rank, or a current team there
-- (set_guild_rank()'s test). A recruiter who leaves the guild stops crediting
-- new applications without their row changing, so their code and past credit
-- stay, and they can't be switched back on until they are back (CodeRabbit).
-- Leaving also switches them off (the trigger below), so coming back needs
-- an Admin to switch them on again.
create function public.in_guild(p_guild_id integer, p_person_id integer)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (select 1 from guild_ranks g
                  where g.guild_id = p_guild_id and g.person_id = p_person_id and g.rank <> 'member')
      or exists (select 1 from team_members m join teams t on t.id = m.team_id
                  where t.guild_id = p_guild_id and m.person_id = p_person_id and m.archived_at is null);
$$;

revoke all on function public.in_guild(integer, integer) from public, anon, authenticated;

-- Switches someone on (p_on true) or off as a recruiter in the guild, and
-- returns their code. The first switch-on issues the code; later ones bring
-- the same code back.
create function public.set_guild_recruiter(p_guild_id integer, p_person_id integer, p_on boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_old guild_recruiters;
  v_code text;
  v_constraint text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not has_guild_permission(p_guild_id, 'manage_recruiters') then
    raise exception 'Not authorized';
  end if;
  if p_on is null then
    raise exception 'Say on or off';
  end if;

  select * into v_old from guild_recruiters r
   where r.guild_id = p_guild_id and r.person_id = p_person_id
     for update;

  if p_on and not in_guild(p_guild_id, p_person_id) then
    raise exception 'That person is not in this guild';
  end if;

  if v_old.person_id is null then
    if not p_on then
      return null;
    end if;
    -- A new code that happens to be taken: try again (36^8 codes, so rarely,
    -- and at most 5 times). The same person switched on a moment ago by
    -- someone else trips the primary key instead (fresh-agent review).
    for v_try in 1..5 loop
      begin
        insert into guild_recruiters (guild_id, person_id)
        values (p_guild_id, p_person_id)
        returning code into v_code;
        exit;
      exception when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint <> 'guild_recruiters_code_key' then
          raise exception 'Someone else just changed this. Reload and try again.';
        end if;
      end;
    end loop;
    if v_code is null then
      raise exception 'Could not make a new link code. Try again.';
    end if;
  else
    v_code := v_old.code;
    if v_old.active = p_on then
      return v_code;
    end if;
    update guild_recruiters
       set active = p_on, updated_at = now()
     where guild_id = p_guild_id and person_id = p_person_id;
  end if;

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (null, v_uid, case when p_on then 'Recruiter Switched On' else 'Recruiter Switched Off' end,
          'guilds', p_guild_id, jsonb_build_object('person_id', p_person_id, 'code', v_code));

  return v_code;
end;
$$;

comment on function public.set_guild_recruiter(integer, integer, boolean) is
  'Switches a person in the guild on or off as a recruiter (#1537) and returns their link code, issued on the first switch-on and kept after. For anyone whose guild rank has manage_recruiters (Admins by default; the Owner has every permission). Logged when it changes.';

revoke all on function public.set_guild_recruiter(integer, integer, boolean) from public, anon;
grant execute on function public.set_guild_recruiter(integer, integer, boolean) to authenticated;

-- The Members tab: everyone who has been a recruiter in the guild, on or off,
-- with their code.
create function public.guild_recruiter_list(p_guild_id integer)
returns table (person_id integer, display_name text, code text, active boolean, in_guild boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not has_guild_permission(p_guild_id, 'manage_recruiters') then
    raise exception 'Not authorized';
  end if;

  return query
  select r.person_id, guild_person_name(p_guild_id, r.person_id), r.code, r.active,
         public.in_guild(p_guild_id, r.person_id)
    from guild_recruiters r
   where r.guild_id = p_guild_id
   order by 2, r.person_id;
end;
$$;

comment on function public.guild_recruiter_list(integer) is
  'Everyone who has been a recruiter in the guild, on or off, with their link code and whether they are still in the guild (#1537), for the Members tab. A recruiter who left is not crediting even when active. For anyone whose guild rank has manage_recruiters.';

revoke all on function public.guild_recruiter_list(integer) from public, anon;
grant execute on function public.guild_recruiter_list(integer) to authenticated;

-- A link's code to its recruiter, for the guild in the link's address:
-- {"name": ..., "active": ...}, or null when the code is not that guild's.
-- The same code credits its recruiter whichever of the guild's teams the
-- person applies to.
create function public.recruiter_for_code(p_guild_key text, p_code text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('name', guild_person_public_name(r.guild_id, r.person_id),
                            'active', r.active and in_guild(r.guild_id, r.person_id))
    from guild_recruiters r
    join guilds g on g.id = r.guild_id
   where g.url_key = p_guild_key and r.code = lower(p_code);
$$;

comment on function public.recruiter_for_code(text, text) is
  'The recruiter behind an apply link''s ?from= code (#1537): their public name (Name or Discord display name, else null; never the Discord username) and whether they are crediting (switched on and still in the guild), or null when the code is not this guild''s. For anyone, signed out included. Names only.';

revoke all on function public.recruiter_for_code(text, text) from public;
grant execute on function public.recruiter_for_code(text, text) to anon, authenticated;

-- The "Who sent you?" list: the guild's switched-on recruiters, by name, each
-- with the code the form sends back.
create function public.guild_active_recruiters(p_guild_key text)
returns table (name text, code text)
language sql
stable
security definer
set search_path = public
as $$
  select n.name, r.code
    from guild_recruiters r
    join guilds g on g.id = r.guild_id
    cross join lateral (select guild_person_public_name(r.guild_id, r.person_id) as name) n
   where g.url_key = p_guild_key and r.active and in_guild(r.guild_id, r.person_id)
     and n.name is not null
   order by 1, 2;
$$;

comment on function public.guild_active_recruiters(text) is
  'The guild''s switched-on recruiters for the apply form''s "Who sent you?" list (#1537): each public name with its link code, the key the form sends back; a recruiter with no Name or Discord display name is left off. For anyone, signed out included. Names only.';

revoke all on function public.guild_active_recruiters(text) from public;
grant execute on function public.guild_active_recruiters(text) to anon, authenticated;

-- Leaving the guild switches a recruiter off (Kat, 2026-11-08): their last
-- current team in it is archived, removed or moved off them, or their guild
-- rank goes, and nothing else keeps them in. The row and code stay; an Admin
-- switches them back on after they return. Logged like any switch, with no
-- actor when nobody signed in did it.
create function public.recruiters_off_on_leaving()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guild integer;
begin
  if old.person_id is null then
    return null;
  end if;
  if tg_table_name = 'guild_ranks' then
    v_guild := old.guild_id;
  else
    select t.guild_id into v_guild from teams t where t.id = old.team_id;
  end if;

  with off as (
    update guild_recruiters r
       set active = false, updated_at = now()
     where r.guild_id = v_guild and r.person_id = old.person_id and r.active
       and not in_guild(r.guild_id, r.person_id)
    returning r.guild_id, r.person_id, r.code
  )
  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  select null, auth.uid(), 'Recruiter Switched Off', 'guilds', off.guild_id,
         jsonb_build_object('person_id', off.person_id, 'code', off.code, 'reason', 'left the guild')
    from off;
  return null;
end;
$$;

revoke all on function public.recruiters_off_on_leaving() from public, anon, authenticated;

create trigger team_members_recruiters_off_on_leaving
  after update of archived_at, person_id, team_id or delete on public.team_members
  for each row execute function public.recruiters_off_on_leaving();
create trigger guild_ranks_recruiters_off_on_leaving
  after update of rank, person_id, guild_id or delete on public.guild_ranks
  for each row execute function public.recruiters_off_on_leaving();
