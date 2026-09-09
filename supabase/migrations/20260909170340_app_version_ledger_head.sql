-- #969: app_version(), the schema's own version as a public fact.
--
-- The schema's version is its migration ledger head, and nothing exposed it,
-- so a client had no way to ask what schema it was talking to. #970 compares
-- this to the REQUIRED_SCHEMA the version stamp writes into js/common.js and
-- says so when the site is deployed ahead of its migrations.
--
-- SECURITY DEFINER because supabase_migrations is owned by postgres with no
-- grants to any API role, and it stays that way: this returns one derived
-- fact, while a direct select on the ledger is still refused.

create or replace function public.app_version()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'head', max(version),
    'count', count(*)
  )
  from supabase_migrations.schema_migrations;
$$;

revoke all on function public.app_version() from public;
grant execute on function public.app_version() to anon, authenticated;
