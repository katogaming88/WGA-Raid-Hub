-- Function public.set_report_kind: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_report_kind(p_team_id integer, p_report_code text, p_kind text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_report team_raid_reports;
  v_new text;
  v_kills integer[];
  v_mine integer[];
  v_retaken integer[];
  v_back integer[];
  v_back_detail jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not (public.has_team_permission(p_team_id, 'attendance') or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  if p_kind is not null and p_kind not in ('main', 'alt') then
    raise exception 'A report is main or alt, or null to go back to its title''s verdict.';
  end if;

  perform pg_advisory_xact_lock(hashtext('boss_lineup'), p_team_id);

  select * into v_report from team_raid_reports
   where team_id = p_team_id and report_code = p_report_code
   for update;
  if not found then
    raise exception 'That report is not on file for this team.';
  end if;

  update team_raid_reports
     set kind_override = p_kind,
         kind_override_by = case when p_kind is null then null else my_person_id() end,
         kind_override_at = case when p_kind is null then null else now() end
   where team_id = p_team_id and report_code = p_report_code
  returning effective_kind into v_new;

  select coalesce(array_agg(id), '{}'::integer[]) into v_kills
    from team_raid_kills where team_id = p_team_id and report_code = p_report_code;

  if v_new = 'main' and v_report.effective_kind = 'alt' then
    perform skip_bosses_for_kills(v_kills);
  elsif v_new = 'alt' and v_report.effective_kind = 'main' then
    -- The bosses this report's kills took off nights not yet started.
    select coalesce(array_agg(b.id), '{}'::integer[]) into v_mine
    from raid_night_bosses b
    cross join lateral raid_night_info(b.team_id, b.raid_date) i
    where b.team_id = p_team_id
      and b.skipped_for_kill_id = any (v_kills)
      and (b.raid_date > raid_today()
           or (b.raid_date = raid_today() and now() < (b.raid_date + i.start_time) at time zone i.timezone));

    -- The team's next main kill of the boss before the night keeps it off,
    -- naming that kill instead (the report is alt now, so its own kills no
    -- longer count).
    with retaken as (
      update raid_night_bosses b
         set skipped_for_kill_id = n.kill_id
        from (
          select b2.id, (array_agg(k.id order by k.report_started_at, k.fight_id))[1] as kill_id
          from raid_night_bosses b2
          cross join lateral kills_before_night(b2.team_id, b2.encounter_id, b2.raid_date, b2.plan) k
          where b2.id = any (v_mine)
          group by b2.id
        ) n
       where b.id = n.id
      returning b.id
    )
    select coalesce(array_agg(id), '{}'::integer[]) into v_retaken from retaken;

    select coalesce(array_agg(id), '{}'::integer[]) into v_back
      from unnest(v_mine) id where not (id = any (v_retaken));

    -- The groups' picked alts, held without waiting, as Put back holds them.
    begin
      perform 1 from characters
      where id in (
        select g.character_id
        from boss_groups g
        join raid_night_bosses b on b.team_id = g.team_id and b.encounter_id = g.encounter_id and b.plan = g.plan
        where b.id = any (v_back) and g.character_id is not null
      )
      for key share nowait;
    exception when lock_not_available then
      raise exception 'A raider''s characters are being updated right now. Try again in a moment.';
    end;

    update raid_night_bosses set skipped = false, skipped_for_kill_id = null where id = any (v_back);

    insert into raid_night_lineups (team_id, raid_date, encounter_id, plan, player_id, character_id, class_spec_id)
    select b.team_id, b.raid_date, b.encounter_id, b.plan, g.player_id, g.character_id, g.class_spec_id
    from raid_night_bosses b
    join boss_groups g on g.team_id = b.team_id and g.encounter_id = b.encounter_id and g.plan = b.plan
    join players p on p.id = g.player_id and p.archived_at is null and not p.is_bench
    where b.id = any (v_back);

    select jsonb_agg(jsonb_build_object('raid_date', b.raid_date, 'boss', e.name, 'plan', b.plan)
                     order by b.raid_date, b.position)
      into v_back_detail
      from raid_night_bosses b
      join raid_encounters e on e.id = b.encounter_id
     where b.id = any (v_back);
  end if;

  perform rebuild_team_raid_progress(p_team_id);

  perform public.write_audit_log(
    p_team_id,
    'Set Report Kind',
    'team_raid_reports',
    null,
    jsonb_build_object('report_code', p_report_code, 'title', v_report.title, 'raid_date', v_report.raid_date,
                       'from', v_report.effective_kind, 'to', v_new, 'override', p_kind)
    || case when v_back_detail is null then '{}'::jsonb else jsonb_build_object('put_back', v_back_detail) end
  );
end;
$function$;
