-- Function public.recruit_trial_start: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.recruit_trial_start(p_application_id integer, p_actor integer)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_app recruit_applications;
  v_today date := (now() at time zone 'America/New_York')::date;
  v_ends date;
  v_name text;
  v_class text;
  v_spec text;
  v_spec_id integer;
  v_theirs boolean;
  v_discord text;
  v_member integer;
  v_restored boolean := false;
  v_added integer;
  v_player integer;
begin
  v_app := recruit_lock(p_application_id, p_actor);
  if v_app.status not in ('waiting_on_officers', 'waiting_on_applicant') then
    raise exception 'Only an open recruit who isn''t on trial can start one';
  end if;
  select v_today + r.trial_days into v_ends from team_recruiting r where r.team_id = v_app.team_id;

  -- The character applied with, by its name now while it is still theirs
  -- (for an officer's ticket-only record, theirs by name); otherwise the copy
  -- taken when they applied, which goes on the roster unlinked, as the signup
  -- add does with a character that has moved to someone else.
  select c.name_realm, c.class_name, c.spec_name into v_name, v_class, v_spec
    from characters c
   where c.person_id = v_app.person_id
     and (c.id = v_app.character_id
          or (v_app.character_id is null and c.name_realm_key = lower(replace(v_app.name_realm, ' ', ''))))
   limit 1;
  v_theirs := found;
  if not v_theirs then
    v_name := v_app.name_realm;
    v_class := v_app.class_name;
    v_spec := v_app.spec_name;
  end if;
  select cs.id into v_spec_id from classes_specs cs where cs.class = v_class and cs.spec = v_spec;

  -- The membership, by the person: made or brought back as a raider, as
  -- through the invite link; a current one stays as it is. Making one needs
  -- their Discord id (team_members is keyed on it); a ticket-only recruit
  -- with neither goes on the roster unlinked, as an officer's hand add.
  if v_app.person_id is not null then
    select m.id, m.archived_at is not null into v_member, v_restored
      from team_members m
     where m.team_id = v_app.team_id and m.person_id = v_app.person_id
       for update;
    if v_member is null then
      select p.discord_id into v_discord from people p where p.id = v_app.person_id;
      if v_discord is not null then
        insert into team_members (team_id, discord_id, role)
        values (v_app.team_id, v_discord, 'raider')
        on conflict (team_id, person_id) do nothing
        returning id into v_added;
        v_member := v_added;
        -- An invite-link join in the same instant made it first.
        if v_member is null then
          select m.id, m.archived_at is not null into v_member, v_restored
            from team_members m
           where m.team_id = v_app.team_id and m.person_id = v_app.person_id
             for update;
        end if;
      end if;
    end if;
    if v_restored then
      update team_members set archived_at = null, role = 'raider' where id = v_member;
      v_added := v_member;
    end if;
  end if;

  -- New, or back from the archive: a new stint, on trial, without the flags
  -- an officer set for the last one, as the invite link resets them. Never a
  -- character on the roster now, or one someone else holds.
  insert into players (team_id, name_realm, class_spec_id, is_trial, join_date, team_member_id)
  values (v_app.team_id, v_name, v_spec_id, true, v_today, case when v_theirs then v_member end)
  on conflict (team_id, name_realm_key) do update
     set team_member_id = excluded.team_member_id,
         class_spec_id = coalesce(excluded.class_spec_id, players.class_spec_id),
         is_trial = true,
         -- Bench or Rotator from the last stint would outrank Trial in loot
         -- priority (CodeRabbit).
         is_bench = false,
         is_rotator = false,
         join_date = excluded.join_date,
         is_backup_tank = false,
         is_backup_healer = false,
         wishlist_allowed = false,
         bis_allowed = false,
         archived_at = null
   where players.archived_at is not null
     and (players.team_member_id is null or players.team_member_id = excluded.team_member_id)
  returning id into v_player;

  if v_player is null then
    if exists (select 1 from players p
                where p.team_id = v_app.team_id and p.name_realm_key = lower(replace(v_name, ' ', ''))
                  and p.archived_at is null) then
      raise exception '% is already on the roster', v_name;
    end if;
    raise exception '% is someone else''s character on this team', v_name;
  end if;

  update recruit_applications
     set status = 'on_trial', trial_starts_on = v_today, trial_ends_on = v_ends, trial_player_id = v_player,
         trial_team_member_id = v_added
   where id = p_application_id;
  insert into recruit_events (application_id, kind, actor_person_id, detail)
  values (p_application_id, 'trial_started', p_actor, 'Until ' || v_ends);
  perform recruit_log(v_app.team_id, p_actor, 'Recruit Trial Started', p_application_id,
                      jsonb_build_object('name_realm', v_name, 'player_id', v_player,
                                         'trial_ends_on', v_ends, 'membership_restored', coalesce(v_restored, false)));
  return v_player;
end;
$function$;
