-- Function public.team_recruiting_page: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): anon, authenticated

CREATE OR REPLACE FUNCTION public.team_recruiting_page(p_guild_key text, p_team_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'team_id', t.id,
           'name', t.name,
           'slug', t.slug,
           'taking_applications', r.taking_applications,
           'join_method', r.join_method,
           'ticket_link', r.ticket_link,
           'about', r.about,
           'schedule_note', r.schedule_note,
           'extra_night', r.extra_night,
           'raid_languages', r.raid_languages,
           'split_runs', r.split_runs,
           'alts_expected', r.alts_expected,
           'ptr_testing', r.ptr_testing,
           'min_item_level', r.min_item_level,
           'attendance_percent', r.attendance_percent,
           'trial_days', r.trial_days,
           'logs_required', r.logs_required,
           'other_requirements', r.other_requirements,
           'exceptional_line', case when r.exceptional_line_on then r.exceptional_line end,
           'spots', team_recruiting_spot_list(t.id),
           'nights', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'weekday', s.weekday,
                      'start_time', s.start_time,
                      'timezone', s.timezone,
                      'duration_minutes', s.duration_minutes,
                      'is_optional', s.is_optional,
                      'difficulty', s.difficulty) order by s.weekday, s.start_time)
               from raid_schedule s
              where s.team_id = t.id and s.active), '[]'::jsonb),
           'progress', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'zone', z.name,
                      'season', z.season,
                      'boss', e.name,
                      'mythic_date', p.mythic_date,
                      'mythic_best_pct', p.mythic_best_pct,
                      'heroic_date', p.heroic_date,
                      'heroic_best_pct', p.heroic_best_pct) order by z.sort_index, z.id, e.sort_index, e.id)
               from team_raid_progress p
               join raid_encounters e on e.id = p.encounter_id
               join raid_zones z on z.id = e.zone_id
              where p.team_id = t.id), '[]'::jsonb)
         ) order by t.name), '[]'::jsonb)
    from guilds g
    join teams t on t.guild_id = g.id and t.archived_at is null
    join team_recruiting r on r.team_id = t.id
   where g.url_key = p_guild_key
     and case when p_team_key is null
              then r.listed_on_guild_page and not t.unlisted
              else t.slug = p_team_key and (r.taking_applications or r.listed_on_guild_page)
         end;
$function$;
