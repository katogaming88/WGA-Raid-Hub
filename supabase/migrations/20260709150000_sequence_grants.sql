-- anon/authenticated missing USAGE grant on public sequences (#383).
--
-- #312 granted base table DML (select/insert/update/delete on all public
-- tables) to anon/authenticated, which is what lets RLS get consulted on a
-- write at all. But a serial/identity column's nextval() call checks USAGE
-- on its backing sequence *before* RLS is reached, and #312 never granted
-- that -- nothing had tried an insert through PostgREST until #216's Add
-- Player flow hit it: "permission denied for sequence players_id_seq" even
-- though the row-level "Officers write players" RLS rule permits the insert.
-- Same class of gap #332 flagged for service_role, just the anon/
-- authenticated half.
--
-- Doesn't loosen anything: RLS still gates every row; a sequence grant only
-- lets a client's `INSERT ... DEFAULT` reach that check at all, same
-- reasoning #312 gave for the table grants.
grant usage, select on all sequences in schema public to anon, authenticated;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated;
