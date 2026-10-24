-- #1608 (part of #1342): signups still open when the season starts close by
-- themselves, team by team, doing what a team leader closing them with every
-- tick left on would do (promote_season_signups(), #1467): each signup the
-- plan places goes on the roster, every roster character nobody signed up
-- for is archived as "Did not sign up", and signups close. A signup the plan
-- skips stays pending for an officer. The leader can still close them from 14
-- days before the start (#648).
--
-- Nobody is signed in when the job runs, so the officer-only steps
-- (restore_team_member(), archive_player(), set_team_season(),
-- write_audit_log()) are done here directly, in the same lock order, and the
-- audit rows say the job made them.
--
-- A season already started when this ships is closed on the first run. Kat
-- closes Midnight Season 2's signups by hand before this merges.

-- The audit row's "Changed by" reads "Automatic". Not inferred from a null
-- actor_id: thousands of older officer rows have none.
alter table public.audit_log add column automatic boolean not null default false;

comment on column public.audit_log.automatic is
  'True when a scheduled job made the change, with nobody signed in (#1608). The Audit Log shows "Automatic" for it.';

CREATE OR REPLACE FUNCTION public.close_started_season_signups()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  v_open record;
  v_plan jsonb;
  v_step record;
  v_member record;
  v_player_id integer;
  v_closed integer := 0;
begin
  for v_open in
    select ts.id, ts.team_id, ts.season_code, s.display_name
      from public.team_seasons ts
      join public.seasons s on s.code = ts.season_code
     where ts.signups_open and s.starts_at <= v_today
     order by ts.team_id, ts.season_code
  loop
    -- One team's failure leaves the others to close; it is retried next hour.
    begin
      -- Signups closed by hand while this waited: nothing left to do.
      perform 1 from public.team_seasons where id = v_open.id and signups_open for update;
      if not found then
        continue;
      end if;

      -- The locks promote_season_signups() takes, in its order (#1467).
      perform 1 from public.season_signups
       where team_id = v_open.team_id and season = v_open.season_code
       order by id
         for update;

      perform 1 from public.team_members tm
       where tm.team_id = v_open.team_id
         and (exists (select 1 from public.players p
                       where p.team_member_id = tm.id and p.archived_at is null)
              or exists (select 1 from public.season_signups s
                           join public.people pe on pe.id = tm.person_id
                          where s.team_id = v_open.team_id and s.season = v_open.season_code
                            and (s.person_id = pe.id or (s.person_id is null and s.auth_user_id = pe.auth_user_id))))
       order by tm.id
         for share;

      v_plan := public.signup_promotion_plan(v_open.team_id, v_open.season_code);

      for v_step in
        select x.signup_id, x.from_player_id, x.from_name_realm,
               s.is_trial, s.is_backup_tank, s.is_backup_healer, s.person_id, s.auth_user_id,
               concat_ws(' ', cs.class, cs.spec, cs.role) as spec_label
          from jsonb_to_recordset(v_plan) as x(kind text, signup_id integer, from_player_id integer, from_name_realm text)
          join public.season_signups s on s.id = x.signup_id
          left join public.classes_specs cs on cs.id = coalesce(s.swap_class_spec_id, s.class_spec_id)
         where x.kind in ('stays', 'swaps', 'first_mains', 'joins')
         order by x.signup_id
      loop
        -- An archived signer comes back as a raider, as restore_team_member()
        -- does for an officer's add (#1402), before add_signup_to_roster(),
        -- which would otherwise ask an officer to.
        select tm.id, tm.role into v_member
          from public.team_members tm
          join public.people pe on pe.id = tm.person_id
         where tm.team_id = v_open.team_id
           and tm.archived_at is not null
           and (pe.id = v_step.person_id or (v_step.person_id is null and pe.auth_user_id = v_step.auth_user_id))
           for update of tm;
        if found then
          update public.team_members set archived_at = null, role = 'raider' where id = v_member.id;
          insert into public.audit_log (team_id, actor_id, automatic, action, target_type, target_id, detail)
          values (v_open.team_id, null, true, 'team_member_restored', 'team_member', v_member.id,
                  jsonb_build_object('role', 'raider', 'archived_role', v_member.role));
        end if;

        update public.season_signups
           set status = 'approved', reviewed_at = now(), reviewed_by = null
         where id = v_step.signup_id and status = 'pending';
        v_player_id := public.add_signup_to_roster(
          v_step.signup_id, coalesce(v_step.is_trial, true), v_step.from_player_id,
          v_step.is_backup_tank, v_step.is_backup_healer
        );

        -- The rows add_signup_to_roster() writes for a signed-in officer.
        insert into public.audit_log (team_id, actor_id, automatic, action, target_type, target_id, detail)
        values (v_open.team_id, null, true, 'Player Added', 'players', v_player_id,
                to_jsonb(concat_ws(', ',
                  coalesce(nullif(v_step.spec_label, ''), 'Unknown spec'),
                  'from signup',
                  case when v_step.from_name_realm is not null then 'main swap from ' || v_step.from_name_realm end,
                  case when v_member.id is not null then 'membership restored' end)));
        if v_step.from_name_realm is not null then
          insert into public.audit_log (team_id, actor_id, automatic, action, target_type, target_id, detail)
          values (v_open.team_id, null, true, 'Main Swap: Old Character Removed', 'players', v_step.from_player_id,
                  (select to_jsonb('Replaced by ' || signup_name_realm) from public.season_signups where id = v_step.signup_id));
        end if;
      end loop;

      -- Every character the plan lists, as archive_player() archives one:
      -- the membership held before the character (#1432).
      for v_step in
        select (e ->> 'player_id')::integer as player_id
          from jsonb_array_elements(v_plan) e
         where e ->> 'kind' = 'archives'
         order by 1
      loop
        perform public.hold_team_member((select team_member_id from public.players where id = v_step.player_id));
        update public.players set archived_at = now()
         where id = v_step.player_id and archived_at is null;
        if found then
          insert into public.player_officer_notes (player_id, team_id, archived_reason, archived_reason_detail)
          values (v_step.player_id, v_open.team_id, 'no_signup', v_open.display_name)
          on conflict (player_id) do update
             set archived_reason = excluded.archived_reason,
                 archived_reason_detail = excluded.archived_reason_detail;
          insert into public.audit_log (team_id, actor_id, automatic, action, target_type, target_id, detail)
          values (v_open.team_id, null, true, 'Player Removed', 'players', v_step.player_id,
                  to_jsonb('no_signup: ' || v_open.display_name));
        end if;
      end loop;

      update public.team_seasons set signups_open = false, updated_at = now() where id = v_open.id;
      insert into public.audit_log (team_id, actor_id, automatic, action, target_type, target_id, detail)
      values (v_open.team_id, null, true, 'Signups Closed', 'team_seasons', v_open.id::integer,
              jsonb_build_object('season', v_open.season_code));

      v_closed := v_closed + 1;
    exception when others then
      raise warning 'Closing % signups for team % failed: %', v_open.season_code, v_open.team_id, sqlerrm;
    end;
  end loop;
  return v_closed;
end;
$function$;

alter function public.close_started_season_signups() owner to postgres;

comment on function public.close_started_season_signups() is
  'Closes signups still open for a season that has started, team by team, as a team leader closing them with every tick on would (#1608). Run hourly by pg_cron; nobody can call it from the site. Returns how many teams it closed.';

revoke all on function public.close_started_season_signups() from public, anon, authenticated;

-- Hourly, so a season starting at midnight Eastern closes within the hour
-- whatever the UTC offset. A team already closed is skipped.
do $$
begin
  perform cron.unschedule('close-started-season-signups');
exception when others then
  null;
end $$;

select cron.schedule(
  'close-started-season-signups',
  '20 * * * *',
  $cron$ select public.close_started_season_signups(); $cron$
);
