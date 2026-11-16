-- Function public.commit_attendance_scores: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.commit_attendance_scores(p_team_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_season text := public.current_season();
  v_committed integer;
  v_nights integer;
begin
  if v_season is null then
    raise exception 'No season has started';
  end if;

  with weighted as (
    select a.player_id, a.raid_date,
           case a.status
             when 'Present' then 1.0
             when 'Bench' then 1.0
             when 'Medical Leave' then 1.0
             when 'Extended Leave' then 1.0
             when 'Excused' then 0.8
             when 'Late (with notice)' then 0.9
             when 'Late (no notice)' then 0.5
             when 'No Show' then 0.0
           end as weight
    from public.attendance a
    where a.team_id = p_team_id
      and a.report_excluded = false
      -- A deleted player's rows keep no player; scoring would refuse them.
      and a.player_id is not null
  ), ratios as (
    select player_id, avg(weight) as ratio
    from weighted
    where weight is not null
    group by player_id
  ), written as (
    insert into public.scoring (team_id, player_id, season, attendance_score, attendance_pct)
    select p_team_id, player_id, v_season, least(round(ratio * 10, 2), 10), round(ratio * 100, 1)
    from ratios
    on conflict (player_id, season) do update
      set attendance_score = excluded.attendance_score,
          attendance_pct = excluded.attendance_pct
    returning 1
  )
  select (select count(*) from written),
         (select count(distinct raid_date) from weighted where weight is not null)
    into v_committed, v_nights;

  if auth.uid() is not null and v_committed > 0 then
    perform public.write_audit_log(p_team_id, 'Attendance Scores Committed', null, null,
      to_jsonb(v_committed || ' players, ' || v_nights || ' nights'));
  end if;

  return jsonb_build_object('committed', v_committed, 'totalNights', v_nights);
end;
$function$;
