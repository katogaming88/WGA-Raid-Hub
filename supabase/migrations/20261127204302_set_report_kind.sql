-- #1472: an officer marks a report as the team's raid or not, and the plan
-- and the progression card follow at once.
--
-- team_raid_reports.kind_override (#1469) has had no writer: effective_kind
-- was the title rule's verdict alone. set_report_kind() sets it, or clears it
-- back to the verdict, for whoever holds the team's attendance permission
-- (Kat, 2026-11-27: the switch lives on Attendance Manage, #1473) and site
-- admins, and moves everything that reads effective_kind in the same call:
--
-- * A report made main: its kills are run through the killed-boss skip as if
--   they had just arrived. The skip's body moves out of the trigger into
--   skip_bosses_for_kills(kill ids) so the two share one rule, the same per
--   night check and the same Skip Killed Boss entries (#1246).
-- * A report made alt: a boss whose skipped_for_kill_id names one of its
--   kills, on a night not yet started, is taken by the team's next main kill
--   of it before the night if there is one, and otherwise comes back from its
--   group as Put back brings it. A boss an officer put back, saved or skipped
--   since names no kill, so it stays as they left it. A night already under
--   way keeps its plan, as the skip leaves it alone.
-- * Either way: team_raid_progress is rebuilt (#1470), so the card and its
--   AOTC date move.
--
-- Attendance cannot follow here: it is built from who was in the log, which
-- the database does not keep. #1473 runs the attendance sync after the change.

create or replace function public.skip_bosses_for_kills(p_kill_ids integer[])
returns void
language plpgsql
set search_path = public
as $$
declare
  v_team integer;
  v_skipped integer[];
begin
  -- The lock every lineup write takes, before anything is read, so a night
  -- filled at the same moment either is seen here or sees these kills.
  for v_team in select distinct team_id from team_raid_kills where id = any (p_kill_ids) order by team_id loop
    perform pg_advisory_xact_lock(hashtext('boss_lineup'), v_team);
  end loop;

  -- A night already under way is left alone: tonight counts until its
  -- scheduled start, and a night with no start time counts as started. A
  -- night with no difficulty set is never skipped.
  with new_kills as (
    select k.id, k.team_id, k.encounter_id from team_raid_kills k where k.id = any (p_kill_ids)
  ),
  nights as (
    select b.id, b.team_id, b.raid_date, b.encounter_id, b.plan
    from raid_night_bosses b
    cross join lateral raid_night_info(b.team_id, b.raid_date) i
    where i.difficulty is not null
      and (b.team_id, b.encounter_id) in (select team_id, encounter_id from new_kills)
      and (b.raid_date > raid_today()
           or (b.raid_date = raid_today() and now() < (b.raid_date + i.start_time) at time zone i.timezone))
      and b.confirmed_at is null
      and not b.skipped
  ),
  first_kills as (
    -- Only when every kill of the boss before the night is among these:
    -- another log of a kill already counted changes nothing.
    select n.id as night_id, (array_agg(k.id order by k.report_started_at, k.fight_id))[1] as kill_id
    from nights n
    cross join lateral kills_before_night(n.team_id, n.encounter_id, n.raid_date, n.plan) k
    left join new_kills nk on nk.id = k.id
    group by n.id
    having bool_and(nk.id is not null)
  ),
  skipped as (
    update raid_night_bosses b
       set skipped = true, skipped_for_kill_id = f.kill_id
      from first_kills f
     where b.id = f.night_id
    returning b.id
  )
  select array_agg(id) into v_skipped from skipped;

  delete from raid_night_lineups l
  using raid_night_bosses b
  where b.id = any (v_skipped)
    and l.team_id = b.team_id and l.raid_date = b.raid_date and l.encounter_id = b.encounter_id and l.plan = b.plan;

  perform log_killed_boss_skips(v_skipped);
end;
$$;

alter function public.skip_bosses_for_kills(integer[]) owner to postgres;
revoke all on function public.skip_bosses_for_kills(integer[]) from public, anon, authenticated;

comment on function public.skip_bosses_for_kills(integer[]) is
  'The killed-boss skip (#1246) for a set of team_raid_kills ids: takes a boss off the team''s raid nights not yet started (tonight until its scheduled start), at the night''s difficulty, where no officer has saved or skipped it, when these are the first main kills of it before the night in that lockout (kills_before_night()). Marks it skipped with the earliest such kill in skipped_for_kill_id, removes its lineup and logs Skip Killed Boss with no actor (log_killed_boss_skips()). Takes the per-team lineup lock first. Run by skip_killed_bosses() on each insert, and by set_report_kind() for a report made main (#1472).';

create or replace function public.skip_killed_bosses()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform skip_bosses_for_kills(array(select id from new_kills));
  return null;
end;
$$;

comment on function public.skip_killed_bosses() is
  'Runs after each insert into team_raid_kills (#1246): the inserted kills through skip_bosses_for_kills(). An error fails the insert; the progression sync sends the kills again on its next run.';

create or replace function public.set_report_kind(p_team_id integer, p_report_code text, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
$$;

alter function public.set_report_kind(integer, text, text) owner to postgres;
revoke all on function public.set_report_kind(integer, text, text) from public, anon;
grant execute on function public.set_report_kind(integer, text, text) to authenticated;

comment on function public.set_report_kind(integer, text, text) is
  'Marks a team''s Warcraft Logs report as the team''s raid (main) or an alt run, or null to go back to the title rule''s verdict (#1472), in team_raid_reports.kind_override. For the team''s attendance permission and site admins. Under the team''s lineup lock, a report made main runs its kills through skip_bosses_for_kills(); a report made alt hands each boss its kill took off a night not yet started to the team''s next main kill of it, or puts it back from its group. team_raid_progress is rebuilt either way. Writes a Set Report Kind audit entry with the report, its title, the old and new kind and any bosses put back. Attendance follows on its next sync.';
