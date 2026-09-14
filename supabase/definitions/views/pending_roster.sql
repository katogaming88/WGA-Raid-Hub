-- View public.pending_roster: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- select (site roles): anon, authenticated

create or replace view public.pending_roster with (security_invoker=on) as
 SELECT s.id AS signup_id,
    s.team_id,
    s.season,
    s.signup_name_realm,
    COALESCE(s.swap_class_spec_id, s.class_spec_id) AS class_spec_id,
    cs.class,
    cs.spec,
    cs.role,
    s.off_specs,
    s.main_swap,
    s.player_note,
    s.signup_officer_note,
    s.reviewed_at,
    s.reviewed_by,
    s.swap_from_name_realm
   FROM season_signups s
     LEFT JOIN classes_specs cs ON cs.id = COALESCE(s.swap_class_spec_id, s.class_spec_id)
  WHERE s.status = 'approved'::text AND s.approved_player_id IS NULL;
