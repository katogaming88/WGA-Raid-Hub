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
