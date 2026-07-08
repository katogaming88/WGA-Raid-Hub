-- Capture the auth.users login trigger so local and CI stacks match prod.
--
-- link_auth_user_to_member() has existed since the initial schema, but the
-- trigger that fires it was created by hand in the Supabase SQL editor
-- (docs/supabase-setup-guide.md, Auth trigger section) and never captured in
-- a migration. That left local resets and CI without it, so the raider claim
-- flow (#212) and the officer auto-link could not be exercised against the
-- same behavior production runs.
--
-- Idempotent: drop-if-exists then create, so applying this against prod (which
-- already has the trigger) recreates the identical object. Seed-safe: seed.sql
-- inserts bare auth.users rows with no raw_user_meta_data, so the provider_id
-- match finds nothing and no rows change.

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.link_auth_user_to_member();
