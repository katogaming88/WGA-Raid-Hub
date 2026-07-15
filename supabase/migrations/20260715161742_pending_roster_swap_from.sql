-- Exposes swap_from_name_realm on pending_roster so the officer Add-to-Roster
-- control (js/tabs/tab-pending-roster.js) can auto-select the correct "old
-- character to archive" for a verified-claim mainswap, instead of always
-- requiring a manual pick from the full roster. security_invoker preserved
-- from the view's original definition (#251) -- season_signups RLS must still
-- apply to the caller, not the view owner.
create or replace view public.pending_roster
with (security_invoker = on)
as
select s.id as signup_id, s.team_id, s.season, s.signup_name_realm,
       coalesce(s.swap_class_spec_id, s.class_spec_id) as class_spec_id,
       cs.class, cs.spec, cs.role,
       s.off_specs, s.main_swap, s.player_note, s.signup_officer_note,
       s.reviewed_at, s.reviewed_by, s.swap_from_name_realm
from public.season_signups s
left join public.classes_specs cs
  on cs.id = coalesce(s.swap_class_spec_id, s.class_spec_id)
where s.status = 'approved' and s.approved_player_id is null;
