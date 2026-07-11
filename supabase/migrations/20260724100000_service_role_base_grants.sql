-- service_role missing base DML grants on every table (#332).
--
-- Same defect #312 fixed for anon/authenticated: the baseline schema pull
-- granted service_role only REFERENCES/TRIGGER/TRUNCATE/MAINTAIN on every
-- table (pg_class.relacl showed service_role=Dxtm), never any DML.
-- service_role bypasses row-level security, but not base grants -- Postgres
-- checks those first, so the first Edge Function (or any service-role
-- client) write would fail with permission denied before RLS is ever
-- consulted. Also includes the sequence USAGE grant #383/#384 found was a
-- second half of the same gap for anon/authenticated -- service_role would
-- hit the identical "permission denied for sequence" on its first
-- nextval()-backed insert without it.
--
-- Additive only: service_role already bypasses RLS, so this doesn't loosen
-- any access rule -- it just lets a service-role write reach a table that
-- was previously unreachable at all.

grant select, insert, update, delete on all tables in schema public to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;

grant usage, select on all sequences in schema public to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;
