-- View public.incoming_roster: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- select (site roles): anon, authenticated

create or replace view public.incoming_roster with (security_barrier=true) as
 SELECT s.id AS signup_id,
    s.team_id,
    s.signup_name_realm,
    cs.class,
    cs.spec,
    cs.role,
    s.swap_from_name_realm,
    s.status
   FROM season_signups s
     JOIN team_seasons ts ON ts.team_id = s.team_id AND ts.season_code = s.season
     LEFT JOIN classes_specs cs ON cs.id = COALESCE(s.swap_class_spec_id, s.class_spec_id)
  WHERE s.approved_player_id IS NULL AND (s.status = 'approved'::text OR s.status = 'pending'::text AND (my_team_role(s.team_id) IS NOT NULL OR is_guild_officer() OR is_site_admin()));
