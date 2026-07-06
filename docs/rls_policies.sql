-- Exports every public-schema RLS policy to docs/rls_policies.csv.
-- Run from the repo root with the local stack up: npm run db:rls
-- The \copy meta-command must stay on one line.
\copy (select tablename as table_name, policyname as policy_name, array_to_string(roles, ';') as roles, cmd as operation, permissive, qual as using_expression, with_check as with_check_expression from pg_policies where schemaname = 'public' order by tablename, policyname) to 'docs/rls_policies.csv' csv header
