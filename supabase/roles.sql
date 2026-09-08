-- Custom cluster-level roles that RLS policies in the migrations reference.
-- The CLI applies this file when creating the local and shadow databases
-- (supabase start / db reset / db pull), where these roles do not exist.
--
-- Only the nologin group role is needed here: every "Claude readers read
-- <table>" policy is scoped TO claude_readers. The per-person login roles
-- (claude_ro_*) exist only in the cloud project and are never in the repo.
-- See docs/claude-readonly-db-access.md.
--
-- Roles are cluster-level and survive `supabase db reset`, so creation must
-- be idempotent.
do $$
begin
  if not exists (select from pg_roles where rolname = 'claude_readers') then
    create role claude_readers nologin;
  end if;
end
$$;

-- #1010: match production's function grants. The local Postgres image grants
-- EXECUTE on every new public function to the three API roles (its own
-- 00000000000000-initial-schema.sql:41); production's default privileges read
-- {postgres=X/postgres}, granting none of them.
--
-- This belongs here rather than in a migration because the CLI applies this
-- file before any migration runs, so the default is in place before the first
-- function exists. A migration would run last and align nothing.
--
-- Postgres's built-in PUBLIC default is deliberately left alone: a per-schema
-- default is added on top of it and cannot remove it, so function migrations
-- keep revoking `public` explicitly the way they already do.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role;
