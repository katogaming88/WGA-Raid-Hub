-- Raider-facing preview of incoming roster members (#499): a narrow-columned
-- view over season_signups, scoped to the team's currently open signup
-- season, showing only a display name, class, spec, and role.
--
-- season_signups has no public read grant (applicant notes, officer notes,
-- and reviewer identity live there), and pending_roster -- the existing
-- officer worklist over the same rows -- mirrors that restriction on purpose
-- via security_invoker. This view is deliberately NOT security_invoker: it
-- runs under the view owner's own reach into season_signups instead of
-- deferring to that table's officer-only read rule. The safety boundary is
-- the column list, not the caller's role -- display name, class, spec, role,
-- and team_id only. player_note, signup_officer_note, reviewed_at,
-- reviewed_by, off_specs, main_swap, submitted_at all stay out of reach.
--
-- Season-scoping happens here too, not client-side: the join to
-- team_settings restricts rows to season_signups.season matching that
-- team's config->>'activeSignupSeason', so a caller can't see a different
-- season's approved-unpromoted signups by filtering around it.
create view public.incoming_roster
as
select s.id as signup_id,
       s.team_id,
       s.signup_name_realm,
       cs.class,
       cs.spec,
       cs.role
from public.season_signups s
join public.team_settings ts
  on ts.team_id = s.team_id
left join public.classes_specs cs
  on cs.id = coalesce(s.swap_class_spec_id, s.class_spec_id)
where s.status = 'approved'
  and s.approved_player_id is null
  and s.season = ts.config->>'activeSignupSeason';

grant select on public.incoming_roster to anon, authenticated;
