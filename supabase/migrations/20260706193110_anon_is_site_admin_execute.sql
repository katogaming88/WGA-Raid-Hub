-- The baseline granted EXECUTE on my_team_role() to anon and authenticated
-- but EXECUTE on is_site_admin() only to authenticated. Row-security rules
-- on team_members, audit_log, and site_admins call is_site_admin(), so an
-- anonymous request against those tables raised "permission denied for
-- function is_site_admin" instead of filtering to zero rows. Found by the
-- RLS test harness (#296) on its first run.

grant execute on function public.is_site_admin() to anon;
