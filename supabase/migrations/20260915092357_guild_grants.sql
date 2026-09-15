-- #942 step 2: one guild_grants table replaces site_admins, guild_officers and boe_managers.
--
-- The three tables were the same table three times: a Discord id, the account
-- it links to, and since step 1 (20260914221328_people_table.sql) the person.
-- A grant is now one row saying which person holds which grant in which guild.
-- Adding a fourth guild-wide grant later is a new value, not a new table with
-- its own trio of admin functions, trigger branch and read rules.
--
-- Nothing a person can do changes. is_site_admin(), is_guild_officer(),
-- is_boe_manager() and the nine admin_* grant functions keep their names,
-- arguments and results; they read and write guild_grants instead. Before the
-- tables go, this checks that every grant's account is its person's account,
-- which is what makes "reads the person's account" answer the same as "reads
-- the grant's account" did.
--
-- A grant names its account through the person, so it no longer carries its
-- own copy: link_auth_user_to_member() stops filling three auth_user_id columns
-- and the person alone is linked.
--
-- The old names stay as read-only views until cutover (#1105, step 6 of the
-- plan on #942), for the service-role and read-only database readers that
-- still use them. Neither site reads them: the current site's admin page goes
-- through the admin_* functions.
--
-- Guild: every grant is backfilled onto the one guild there is. The access
-- checks still ask "in any guild", as the tables did; scoping them to the
-- guild being viewed is multi-tenancy (#1045), after cutover.

create table public.guild_grants (
  id integer generated always as identity primary key,
  person_id integer not null references public.people (id),
  guild_id integer not null references public.guilds (id),
  grant_type text not null,
  created_at timestamp with time zone not null default now(),
  constraint guild_grants_grant_type_check check (grant_type in ('site_admin', 'guild_officer', 'boe_manager')),
  constraint guild_grants_person_id_guild_id_grant_type_key unique (person_id, guild_id, grant_type)
);

comment on table public.guild_grants is
  'Guild-wide grants, one row per person per grant per guild (#942). Replaced site_admins, guild_officers and boe_managers, which remain as read-only views until cutover.';

create index guild_grants_guild_id_idx on public.guild_grants (guild_id);

alter table public.guild_grants enable row level security;

-- The read and write rules the three tables had, unchanged: site admins read
-- and write every grant; any officer or team leader reads who the BoE managers
-- are (#766), so an ungranted officer looking at a find can see who can act on
-- it; the read-only database role reads everything.
create policy "Claude readers read guild_grants" on public.guild_grants
  for select to claude_readers using (true);

create policy "Site Admins read guild_grants" on public.guild_grants
  for select using ((select public.is_site_admin()));

create policy "Officers read BoE manager grants" on public.guild_grants
  for select using (grant_type = 'boe_manager' and (select public.is_any_team_officer()));

create policy "Site Admins write guild_grants" on public.guild_grants
  for all using ((select public.is_site_admin())) with check ((select public.is_site_admin()));

-- Backfill. created_at is only known for BoE managers.
insert into public.guild_grants (person_id, guild_id, grant_type, created_at)
select g.person_id, (select id from public.guilds), g.grant_type, g.created_at
  from (
    select person_id, 'site_admin' as grant_type, now() as created_at from public.site_admins
    union all
    select person_id, 'guild_officer', now() from public.guild_officers
    union all
    select person_id, 'boe_manager', created_at from public.boe_managers
  ) g;

-- Every grant's account is its person's account, both ways round. A grant
-- still waiting for its account while its person already has one (or the
-- reverse) would gain or lose access the moment the checks read the person, so
-- stop rather than change anyone's access silently.
do $$
declare
  v_bad text;
begin
  if (select count(*) from public.guilds) <> 1 then
    raise exception 'guild_grants backfill expects exactly one guild';
  end if;

  select string_agg(format('%s id %s', t.tbl, t.id), ', ') into v_bad
    from (
      select 'site_admins' tbl, id, person_id, auth_user_id from public.site_admins
      union all
      select 'guild_officers', id, person_id, auth_user_id from public.guild_officers
      union all
      select 'boe_managers', id, person_id, auth_user_id from public.boe_managers
    ) t
    join public.people p on p.id = t.person_id
   where t.auth_user_id is distinct from p.auth_user_id;
  if v_bad is not null then
    raise exception 'Grant rows whose account is not their person''s account: %', v_bad;
  end if;
end $$;

drop table public.site_admins;
drop table public.guild_officers;
drop table public.boe_managers;

-- The old names, read-only, until cutover. security_invoker, so a reader sees
-- through the rules on guild_grants and people rather than past them. Only the
-- service role and the read-only database role may read them.
create view public.site_admins with (security_invoker = on) as
  select g.id, p.discord_id, p.auth_user_id, g.person_id, g.created_at
    from public.guild_grants g
    join public.people p on p.id = g.person_id
   where g.grant_type = 'site_admin';

create view public.guild_officers with (security_invoker = on) as
  select g.id, p.discord_id, p.auth_user_id, g.person_id, g.created_at
    from public.guild_grants g
    join public.people p on p.id = g.person_id
   where g.grant_type = 'guild_officer';

create view public.boe_managers with (security_invoker = on) as
  select g.id, p.discord_id, p.auth_user_id, g.person_id, g.created_at
    from public.guild_grants g
    join public.people p on p.id = g.person_id
   where g.grant_type = 'boe_manager';

comment on view public.site_admins is 'Read-only view of guild_grants (#942), dropped at cutover (#1105).';
comment on view public.guild_officers is 'Read-only view of guild_grants (#942), dropped at cutover (#1105).';
comment on view public.boe_managers is 'Read-only view of guild_grants (#942), dropped at cutover (#1105).';

revoke all on table public.site_admins, public.guild_officers, public.boe_managers from public, anon, authenticated, service_role, claude_readers;
grant select on table public.site_admins, public.guild_officers, public.boe_managers to service_role, claude_readers;

-- The one guild a new grant goes to, until grants are given per guild (#1045).
create or replace function public.only_guild_id() returns integer
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if (select count(*) from guilds) <> 1 then
    raise exception 'A grant needs a guild once there is more than one (#1045)';
  end if;
  return (select id from guilds);
end;
$$;

revoke all on function public.only_guild_id() from public, anon, authenticated;

-- The access checks.

create or replace function public.is_site_admin() returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from guild_grants g
      join people p on p.id = g.person_id
     where p.auth_user_id = auth.uid()
       and g.grant_type = 'site_admin'
  );
$$;

create or replace function public.is_guild_officer() returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from guild_grants g
      join people p on p.id = g.person_id
     where p.auth_user_id = auth.uid()
       and g.grant_type = 'guild_officer'
  );
$$;

create or replace function public.is_boe_manager() returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from guild_grants g
      join people p on p.id = g.person_id
     where p.auth_user_id = auth.uid()
       and g.grant_type = 'boe_manager'
  );
$$;

-- The admin page's list, grant and revoke functions. One body each, shared by
-- the three grants, so the three copies cannot drift; the named wrappers keep
-- the signatures and error wording the current site's admin page expects.

create or replace function public.admin_list_grants(p_grant_type text)
returns table(id integer, discord_id text, auth_user_id uuid, display_name text)
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;

  return query
    select g.id, p.discord_id, p.auth_user_id,
      coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')
    from guild_grants g
    join people p on p.id = g.person_id
    left join auth.users u on u.id = p.auth_user_id
    where g.grant_type = p_grant_type
    order by g.id;
end;
$$;

create or replace function public.admin_grant(p_grant_type text, p_discord_id text, p_label text)
returns integer
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_person integer;
  v_id integer;
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;

  if exists (
    select 1 from guild_grants g
      join people p on p.id = g.person_id
     where p.discord_id = p_discord_id
       and g.grant_type = p_grant_type
  ) then
    raise exception 'That Discord account already has % access', p_label;
  end if;

  v_person := person_for_discord_id(p_discord_id);

  insert into guild_grants (person_id, guild_id, grant_type)
  values (v_person, only_guild_id(), p_grant_type)
  returning guild_grants.id into v_id;

  perform write_audit_log(null, p_grant_type || '_granted', p_grant_type, v_id, jsonb_build_object('discord_id', p_discord_id));

  return v_id;
end;
$$;

create or replace function public.admin_revoke(p_grant_type text, p_discord_id text, p_label text)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_id integer;
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;

  if p_grant_type = 'site_admin'
     and (select count(*) from guild_grants where grant_type = 'site_admin') <= 1 then
    raise exception 'Cannot revoke the last remaining site admin';
  end if;

  delete from guild_grants g
   using people p
   where p.id = g.person_id
     and p.discord_id = p_discord_id
     and g.grant_type = p_grant_type
  returning g.id into v_id;

  if v_id is null then
    raise exception 'That Discord account does not have % access', p_label;
  end if;

  perform write_audit_log(null, p_grant_type || '_revoked', p_grant_type, v_id, jsonb_build_object('discord_id', p_discord_id));
end;
$$;

revoke all on function public.admin_list_grants(text) from public, anon, authenticated;
revoke all on function public.admin_grant(text, text, text) from public, anon, authenticated;
revoke all on function public.admin_revoke(text, text, text) from public, anon, authenticated;

create or replace function public.admin_list_site_admins()
returns table(id integer, discord_id text, auth_user_id uuid, display_name text)
language sql security definer set search_path to 'public'
as $$ select * from admin_list_grants('site_admin'); $$;

create or replace function public.admin_list_guild_officers()
returns table(id integer, discord_id text, auth_user_id uuid, display_name text)
language sql security definer set search_path to 'public'
as $$ select * from admin_list_grants('guild_officer'); $$;

create or replace function public.admin_list_boe_managers()
returns table(id integer, discord_id text, auth_user_id uuid, display_name text)
language sql security definer set search_path to 'public'
as $$ select * from admin_list_grants('boe_manager'); $$;

create or replace function public.admin_grant_site_admin(p_discord_id text) returns integer
language sql security definer set search_path to 'public'
as $$ select admin_grant('site_admin', p_discord_id, 'site admin'); $$;

create or replace function public.admin_grant_guild_officer(p_discord_id text) returns integer
language sql security definer set search_path to 'public'
as $$ select admin_grant('guild_officer', p_discord_id, 'guild officer'); $$;

create or replace function public.admin_grant_boe_manager(p_discord_id text) returns integer
language sql security definer set search_path to 'public'
as $$ select admin_grant('boe_manager', p_discord_id, 'BoE manager'); $$;

create or replace function public.admin_revoke_site_admin(p_discord_id text) returns void
language sql security definer set search_path to 'public'
as $$ select admin_revoke('site_admin', p_discord_id, 'site admin'); $$;

create or replace function public.admin_revoke_guild_officer(p_discord_id text) returns void
language sql security definer set search_path to 'public'
as $$ select admin_revoke('guild_officer', p_discord_id, 'guild officer'); $$;

create or replace function public.admin_revoke_boe_manager(p_discord_id text) returns void
language sql security definer set search_path to 'public'
as $$ select admin_revoke('boe_manager', p_discord_id, 'BoE manager'); $$;

-- The sign-in trigger links the person only. The grants reach the account
-- through it, so the three grant updates are gone; team_members keeps its own
-- auth_user_id until step 3 moves its readers onto the person.
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

  -- Only a Discord identity attaches a person listed by Discord id.
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

  return new;
end;
$function$;

-- resolve_person() reads the grants from guild_grants. Same signature, same
-- result shape; step 3 moves the rest of it onto the person.
create or replace function public.resolve_person(p_discord_id text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_is_self boolean := p_discord_id is not distinct from public.current_discord_id();
  v_is_site_admin boolean := public.is_site_admin();
  v_sees_all_teams boolean;
  v_person people%rowtype;
  v_grants text[];
  v_result jsonb;
begin
  v_sees_all_teams := v_is_self or v_is_site_admin or public.is_guild_officer();

  if not (v_sees_all_teams or public.is_any_team_officer()) then
    raise exception 'Not authorized';
  end if;

  select * into v_person from people where discord_id = p_discord_id;

  select coalesce(array_agg(g.grant_type), '{}') into v_grants
    from guild_grants g
   where g.person_id = v_person.id;

  if p_discord_id is null
     or not (
       exists (select 1 from team_members where discord_id = p_discord_id)
       or cardinality(v_grants) > 0
     ) then
    return null;
  end if;

  select jsonb_build_object(
    'discord_id', p_discord_id,
    'auth_user_id', coalesce(
      (select tm.auth_user_id from team_members tm where tm.discord_id = p_discord_id and tm.auth_user_id is not null limit 1),
      case when cardinality(v_grants) > 0 then v_person.auth_user_id end
    ),
    'site_admin', case when v_is_self or v_is_site_admin
                       then 'site_admin' = any (v_grants) end,
    'guild_officer', case when v_is_self or v_is_site_admin
                          then 'guild_officer' = any (v_grants) end,
    'boe_manager', 'boe_manager' = any (v_grants),
    'teams', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'team_id', tm.team_id,
                 'team_member_id', tm.id,
                 'role', tm.role,
                 'characters', coalesce((
                   select jsonb_agg(
                            jsonb_build_object(
                              'player_id', p.id,
                              'name_realm', p.name_realm,
                              'url_code', p.url_code,
                              'archived_at', p.archived_at
                            )
                            order by p.archived_at desc nulls first, p.name_realm
                          )
                     from players p
                    where p.team_member_id = tm.id
                 ), '[]'::jsonb)
               )
               order by tm.team_id
             )
        from team_members tm
       where tm.discord_id = p_discord_id
         and (v_sees_all_teams or public.my_team_role(tm.team_id) = any (array['officer', 'team_leader']))
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$function$;
