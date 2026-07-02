# Read-Only Database Access for Claude

This doc records how direct read-only Postgres access is set up for Claude Code
sessions, per the decision in issue #259 (Option B: a shared group role plus one
login role per person). It covers the SQL that was run, how to add or remove a
person, and how to configure a client machine.

## Why this exists

For the Phase 1 audit work (#250, #257, #258) we want Claude to query the live
schema instead of inferring it from docs. The role is read-only: SELECT only, no
writes, no DDL.

Supabase's `postgres` role is not a superuser, so it cannot grant `BYPASSRLS`,
and `pg_read_all_data` does not bypass RLS. A plain read-only login role
therefore sees zero rows on the officer-gated tables. The fix is one permissive
SELECT policy per public table, scoped to the read-only group role only, so the
app roles (`anon`, `authenticated`) are unaffected.

## The role structure

- `claude_readers` -- a `nologin` group role. Holds the schema grants and the
  RLS read policies. Nobody logs in as this.
- `claude_ro_russ`, `claude_ro_kat` -- personal login roles that inherit from
  `claude_readers`. One per person, each with its own password, so access can be
  rotated or revoked per person and `pg_stat_activity` shows who is connected.

## Quick start for a new person

The group role and policies below are shared and only get set up once. To give
yourself access:

1. Run the two statements in [Adding a person](#adding-a-person) in the
   Supabase SQL Editor, with a password you choose. This requires dashboard
   access.
2. Follow [Client setup](#client-setup) on your machine.
3. Run the checks in [Verifying access](#verifying-access).

## Setup SQL

Run in the Supabase SQL Editor as one query. It is idempotent: re-running it
skips anything that already exists.

```sql
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'claude_readers') then
    create role claude_readers nologin;
  end if;
end $$;

grant usage on schema public to claude_readers;
grant select on all tables in schema public to claude_readers;
alter default privileges in schema public grant select on tables to claude_readers;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t
        and policyname = 'Claude readers read ' || t
    ) then
      execute format(
        'create policy %I on public.%I for select to claude_readers using (true)',
        'Claude readers read ' || t, t);
    end if;
  end loop;
end $$;
```

The second block loops over every table currently in the `public` schema and
creates a policy named `Claude readers read <table>` for each, targeting only
`claude_readers`. Policies that target a specific role do not apply to any other
role, so `anon` and `authenticated` behave exactly as before.

## Adding a person

Each person runs this themselves in the SQL Editor with their own password, so
no password ever changes hands:

```sql
create role claude_ro_<name> login password '<your password>';
grant claude_readers to claude_ro_<name>;
```

Do not add `noinherit` -- the default `inherit` is what makes the group's grants
and policies apply to the login role.

## Removing or rotating a person

```sql
-- rotate a password (you can always change your own)
alter role claude_ro_<name> password '<new password>';

-- revoke someone entirely
drop role claude_ro_<name>;
```

## After adding a new table

`alter default privileges` covers the SELECT grant for future tables, but RLS
policies are per-table and are not created automatically. After adding a table,
re-run the second `do` block from the setup SQL above (it skips tables that
already have the policy).

## Client setup

Connect through the **Session pooler** (IPv4 compatible, port 5432). The exact
hostname is on the dashboard Connect page and looks like
`aws-N-<region>.pooler.supabase.com`. The pooler requires the username in
`<role>.<project-ref>` form, e.g. `claude_ro_russ.kxgjqnpwfklbgrxdgmmv`.

Install the psql client (on Windows: `scoop install postgresql`, or the
PostgreSQL installer with only Command Line Tools checked).

Create two files. On Windows they live in `%APPDATA%\postgresql\`; on
Linux/macOS they are `~/.pg_service.conf` and `~/.pgpass` (the latter needs
`chmod 600`).

`.pg_service.conf` (Windows: `%APPDATA%\postgresql\.pg_service.conf`):

```ini
[wga]
host=<session-pooler-host>
port=5432
dbname=postgres
user=claude_ro_<name>.kxgjqnpwfklbgrxdgmmv
sslmode=require
```

`pgpass.conf` (Windows: `%APPDATA%\postgresql\pgpass.conf`; Linux: `~/.pgpass`),
one line:

```
<session-pooler-host>:5432:postgres:claude_ro_<name>.kxgjqnpwfklbgrxdgmmv:<password>
```

The password lives only in pgpass, never in a command line or a chat transcript.

Then connect with:

```
psql service=wga
```

## Verifying access

```sql
select current_user;                  -- shows your personal role
select count(*) from audit_log;      -- officer-gated table: should return a count
select count(*) from teams;          -- public-read table: should return a count
insert into teams (name) values ('x');   -- should FAIL with permission denied
create table claude_test(id int);        -- should FAIL with permission denied
```

To confirm the app roles were not widened, check that every Claude policy
targets only `claude_readers`:

```sql
select tablename, policyname, roles from pg_policies
where policyname like 'Claude readers read %'
order by tablename;
```
