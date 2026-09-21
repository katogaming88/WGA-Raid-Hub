-- Function public.get_own_signup: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.get_own_signup(p_team_id integer, p_season text DEFAULT NULL::text)
 RETURNS TABLE(id integer, signup_name_realm text, class text, spec text, off_specs text, main_swap boolean, swap_class text, swap_spec text, swap_from_name_realm text, player_note text, status text, season text, submitted_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;

  return query
  select s.id,
         coalesce(live.name_realm, s.signup_name_realm),
         coalesce(cs_live.class, cs_main.class),
         coalesce(cs_live.spec, cs_main.spec),
         s.off_specs, s.main_swap,
         cs_swap.class, cs_swap.spec, s.swap_from_name_realm,
         s.player_note, s.status, s.season, s.submitted_at
  from public.season_signups s
  left join public.classes_specs cs_main on cs_main.id = s.class_spec_id
  left join public.classes_specs cs_swap on cs_swap.id = s.swap_class_spec_id
  left join public.players live on live.id = s.approved_player_id
  left join public.classes_specs cs_live on cs_live.id = live.class_spec_id
  where s.team_id = p_team_id
    and s.auth_user_id = v_uid
    and (
      (p_season is not null and s.season = p_season)
      or (p_season is null and exists (
        select 1 from public.team_seasons ts
        where ts.team_id = s.team_id and ts.season_code = s.season and ts.signups_open
      ))
    )
  order by s.submitted_at desc
  limit 1;
end $function$;
