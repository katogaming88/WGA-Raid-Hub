-- #1793: the trial actions on a recruit record (#1539, #1551), from Raid Hub
-- or a Discord button.
--
-- * Start trial puts the applicant on the team's roster as a Trial with the
--   character they applied with, and dates the trial: today to today plus the
--   team's trial length (team_recruiting.trial_days, #1535). Their membership
--   is made, or brought back from the archive as a raider, the way the invite
--   link and the signup add do, and a returning character comes back with the
--   last stint's officer flags cleared.
-- * Extend trial adds the team's trial length to the end date, with a reason.
--   Whether to also say it in the ticket is the bot's to ask.
-- * Joined closes the record and takes Trial off the roster row.
-- * Not joining closes it and takes the trial character off the roster with a
--   removal reason. A membership left with no character on the team is
--   archived too, with the same reason: being on a team is what makes someone
--   a guild member (#1517), and they aren't joining.
--
-- Each writes a history row and an audit row in the acting person's name, the
-- same from the site and from the bot. They change the roster, so they ask
-- Edit roster as well as Edit recruiting, as the signup add asks Edit roster
-- as well as Manage signups (#1646).
--
-- Locks: the record, the team (recruit_lock()), the membership, then the
-- character: the order archive_team_member() and add_signup_to_roster() take.

alter table public.recruit_applications
  add column trial_player_id integer references public.players(id) on delete set null;

create index recruit_applications_trial_player on public.recruit_applications (trial_player_id);

comment on column public.recruit_applications.trial_player_id is
  'The roster row Start trial put them on (#1793), which Joined and Not joining act on.';

-- A removal reason's key as words: schedule_conflict is "Schedule conflict".
create function public.recruit_reason_words(p_reason text)
returns text
language sql
immutable
set search_path = public
as $$
  select upper(left(p_reason, 1)) || replace(substr(p_reason, 2), '_', ' ');
$$;

revoke all on function public.recruit_reason_words(text) from public, anon, authenticated;

-- The shared actions, for the site's functions and the bot's. The caller has
-- checked that p_actor may.
create function public.recruit_trial_start(p_application_id integer, p_actor integer)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_app recruit_applications;
  v_today date := (now() at time zone 'America/New_York')::date;
  v_ends date;
  v_name text;
  v_class text;
  v_spec text;
  v_spec_id integer;
  v_discord text;
  v_member integer;
  v_restored boolean := false;
  v_player integer;
begin
  v_app := recruit_lock(p_application_id, p_actor);
  if v_app.status not in ('waiting_on_officers', 'waiting_on_applicant') then
    raise exception 'Only an open recruit who isn''t on trial can start one';
  end if;
  select v_today + r.trial_days into v_ends from team_recruiting r where r.team_id = v_app.team_id;

  -- The character applied with, by its name now while it is still theirs;
  -- otherwise the copy taken when they applied.
  select c.name_realm, c.class_name, c.spec_name into v_name, v_class, v_spec
    from characters c
   where c.id = v_app.character_id and c.person_id = v_app.person_id;
  if not found then
    v_name := v_app.name_realm;
    v_class := v_app.class_name;
    v_spec := v_app.spec_name;
  end if;
  select cs.id into v_spec_id from classes_specs cs where cs.class = v_class and cs.spec = v_spec;

  -- The membership, made or brought back as a raider, as through the invite
  -- link; a current one stays as it is. A ticket-only recruit with no Discord
  -- id has none, and goes on the roster unlinked, as an officer's hand add.
  select p.discord_id into v_discord from people p where p.id = v_app.person_id;
  if v_discord is not null then
    insert into team_members (team_id, discord_id, role)
    values (v_app.team_id, v_discord, 'raider')
    on conflict (team_id, person_id) do nothing;
    select m.id, m.archived_at is not null into v_member, v_restored
      from team_members m
     where m.team_id = v_app.team_id and m.person_id = v_app.person_id
       for update;
    if v_restored then
      update team_members set archived_at = null, role = 'raider' where id = v_member;
    end if;
  end if;

  -- New, or back from the archive: a new stint, on trial, without the flags
  -- an officer set for the last one, as the invite link resets them. Never a
  -- character on the roster now, or one someone else holds.
  insert into players (team_id, name_realm, class_spec_id, is_trial, join_date, team_member_id)
  values (v_app.team_id, v_name, v_spec_id, true, v_today, v_member)
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
     set status = 'on_trial', trial_starts_on = v_today, trial_ends_on = v_ends, trial_player_id = v_player
   where id = p_application_id;
  insert into recruit_events (application_id, kind, actor_person_id, detail)
  values (p_application_id, 'trial_started', p_actor, 'Until ' || v_ends);
  perform recruit_log(v_app.team_id, p_actor, 'Recruit Trial Started', p_application_id,
                      jsonb_build_object('name_realm', v_name, 'player_id', v_player,
                                         'trial_ends_on', v_ends, 'membership_restored', v_restored));
  return v_player;
end;
$$;

revoke all on function public.recruit_trial_start(integer, integer) from public, anon, authenticated;

create function public.recruit_trial_extend(p_application_id integer, p_actor integer, p_reason text)
returns date
language plpgsql
set search_path = public
as $$
declare
  v_app recruit_applications;
  v_reason text := nullif(btrim(p_reason), '');
  v_ends date;
begin
  if v_reason is null then
    raise exception 'Say why the trial is extended';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'A reason is at most 500 characters';
  end if;
  v_app := recruit_lock(p_application_id, p_actor);
  if v_app.status <> 'on_trial' then
    raise exception 'That recruit is not on trial';
  end if;
  update recruit_applications a
     set trial_ends_on = a.trial_ends_on + r.trial_days
    from team_recruiting r
   where a.id = p_application_id and r.team_id = a.team_id
  returning a.trial_ends_on into v_ends;
  insert into recruit_events (application_id, kind, actor_person_id, detail)
  values (p_application_id, 'trial_extended', p_actor, 'Until ' || v_ends || ': ' || v_reason);
  perform recruit_log(v_app.team_id, p_actor, 'Recruit Trial Extended', p_application_id,
                      jsonb_build_object('name_realm', v_app.name_realm, 'reason', v_reason, 'trial_ends_on', v_ends));
  return v_ends;
end;
$$;

revoke all on function public.recruit_trial_extend(integer, integer, text) from public, anon, authenticated;

create function public.recruit_trial_joined(p_application_id integer, p_actor integer)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_app recruit_applications;
begin
  v_app := recruit_lock(p_application_id, p_actor);
  if v_app.status <> 'on_trial' then
    raise exception 'That recruit is not on trial';
  end if;
  -- The membership before the character. A claim moving the character after
  -- this read is not covered, as in archive_player().
  perform 1 from team_members m
   where m.id = (select p.team_member_id from players p where p.id = v_app.trial_player_id)
     for share;
  update players set is_trial = false where id = v_app.trial_player_id and archived_at is null;
  if not found then
    raise exception '% is no longer on the roster: add them back first', v_app.name_realm;
  end if;
  update recruit_applications set status = 'joined', closed_at = now() where id = p_application_id;
  insert into recruit_events (application_id, kind, actor_person_id) values (p_application_id, 'joined', p_actor);
  perform recruit_log(v_app.team_id, p_actor, 'Recruit Joined', p_application_id,
                      jsonb_build_object('name_realm', v_app.name_realm, 'player_id', v_app.trial_player_id));
end;
$$;

revoke all on function public.recruit_trial_joined(integer, integer) from public, anon, authenticated;

-- p_reason is one of the roster's removal reasons. A trial character an
-- officer already took off the roster by hand is left as it is.
create function public.recruit_trial_not_joining(p_application_id integer, p_actor integer, p_reason text, p_detail text)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_app recruit_applications;
  v_detail text := nullif(btrim(p_detail), '');
  v_member integer;
  v_removed_at timestamptz;
  v_member_archived boolean := false;
begin
  if p_reason is null or p_reason not in
     ('schedule_conflict', 'performance', 'drama', 'moved_guilds', 'switching_mains', 'other', 'no_signup') then
    raise exception 'That is not one of the removal reasons';
  end if;
  if char_length(v_detail) > 500 then
    raise exception 'A reason is at most 500 characters';
  end if;
  v_app := recruit_lock(p_application_id, p_actor);
  if v_app.status <> 'on_trial' then
    raise exception 'That recruit is not on trial';
  end if;

  select p.team_member_id into v_member from players p where p.id = v_app.trial_player_id;
  perform 1 from team_members m where m.id = v_member for update;

  -- A raider with no other character on the team leaves it too. The
  -- membership goes first, as in archive_team_member(), so a waiting main
  -- swap the character's archive closes reads "Membership ended" rather than
  -- "Character removed" with a notice (CodeRabbit).
  if exists (select 1 from team_members m
              where m.id = v_member and m.archived_at is null and m.rank = 'raider')
     and not exists (select 1 from players p
                      where p.team_member_id = v_member and p.archived_at is null
                        and p.id <> v_app.trial_player_id) then
    insert into removal_reasons (team_id, team_member_id, reason, detail, removed_by)
    values (v_app.team_id, v_member, p_reason, v_detail, p_actor);
    update team_members set archived_at = now() where id = v_member;
    v_member_archived := true;
  end if;

  update players set archived_at = now()
   where id = v_app.trial_player_id and archived_at is null
  returning archived_at into v_removed_at;
  if v_removed_at is not null then
    -- The removal in the actor's name first: the notes write's own row
    -- (record_removal_reason()) then finds it and adds nothing, where from
    -- the bot it would name nobody.
    insert into removal_reasons (team_id, player_id, team_member_id, removed_at, reason, detail, removed_by)
    values (v_app.team_id, v_app.trial_player_id, v_member, v_removed_at, p_reason, v_detail, p_actor);
    -- Only the archive columns, as in archive_player(): an officer note stays.
    insert into player_officer_notes (player_id, team_id, archived_reason, archived_reason_detail)
    values (v_app.trial_player_id, v_app.team_id, p_reason, v_detail)
    on conflict (player_id) do update
       set archived_reason = excluded.archived_reason,
           archived_reason_detail = excluded.archived_reason_detail;
  end if;

  update recruit_applications set status = 'not_joining', closed_at = now() where id = p_application_id;
  insert into recruit_events (application_id, kind, actor_person_id, detail)
  values (p_application_id, 'not_joining', p_actor, concat_ws(': ', recruit_reason_words(p_reason), v_detail));
  perform recruit_log(v_app.team_id, p_actor, 'Recruit Not Joining', p_application_id,
                      jsonb_build_object('name_realm', v_app.name_realm, 'player_id', v_app.trial_player_id,
                                         'reason', p_reason, 'detail', v_detail,
                                         'membership_archived', v_member_archived));
end;
$$;

revoke all on function public.recruit_trial_not_joining(integer, integer, text, text) from public, anon, authenticated;

-- Who may run a trial action from the site: whoever manages the team's
-- recruits and may edit its roster. Returns the caller's person.
create function public.recruit_trial_site_actor(p_application_id integer)
returns integer
language plpgsql
stable
set search_path = public
as $$
declare
  v_team integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select a.team_id into v_team from recruit_applications a where a.id = p_application_id;
  if recruit_access(v_team) is distinct from 'manage'
     or not (has_team_permission(v_team, 'edit_roster') or is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  return my_person_id();
end;
$$;

revoke all on function public.recruit_trial_site_actor(integer) from public, anon, authenticated;

-- The same for the person who pressed a Discord button: bot_check()'s manage,
-- plus Edit roster by their rank on the team's grid, or a site admin.
create function public.recruit_trial_bot_actor(p_application_id integer, p_actor_discord_id text)
returns integer
language plpgsql
stable
set search_path = public
as $$
declare
  v_actor integer := bot_actor(p_actor_discord_id);
begin
  perform bot_check(p_application_id, v_actor, false);
  if not exists (select 1 from guild_grants g where g.person_id = v_actor and g.grant_type = 'site_admin')
     and not exists (select 1 from recruit_applications a
                       join team_members m on m.team_id = a.team_id
                      where a.id = p_application_id and m.person_id = v_actor and m.archived_at is null
                        and (m.rank = 'owner'
                             or exists (select 1 from team_rank_permissions k
                                         where k.team_id = m.team_id and k.rank = m.rank
                                           and k.permission = 'edit_roster'))) then
    raise exception 'Not authorized';
  end if;
  return v_actor;
end;
$$;

revoke all on function public.recruit_trial_bot_actor(integer, text) from public, anon, authenticated;

-- The site's.
create function public.start_recruit_trial(p_application_id integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  return recruit_trial_start(p_application_id, recruit_trial_site_actor(p_application_id));
end;
$$;

create function public.extend_recruit_trial(p_application_id integer, p_reason text)
returns date
language plpgsql
security definer
set search_path = public
as $$
begin
  return recruit_trial_extend(p_application_id, recruit_trial_site_actor(p_application_id), p_reason);
end;
$$;

create function public.mark_recruit_joined(p_application_id integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform recruit_trial_joined(p_application_id, recruit_trial_site_actor(p_application_id));
end;
$$;

create function public.mark_recruit_not_joining(p_application_id integer, p_reason text, p_detail text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform recruit_trial_not_joining(p_application_id, recruit_trial_site_actor(p_application_id), p_reason, p_detail);
end;
$$;

comment on function public.start_recruit_trial(integer) is
  'Start trial (#1793): puts an open recruit on the team''s roster as a Trial with the character they applied with, membership made or brought back, and dates the trial by the team''s trial length. Returns the roster row. For whoever manages the team''s recruits and may edit its roster.';
comment on function public.extend_recruit_trial(integer, text) is
  'Extend trial (#1793): adds the team''s trial length to the end date, with a reason (required, at most 500). Returns the new end date. For whoever manages the team''s recruits and may edit its roster.';
comment on function public.mark_recruit_joined(integer) is
  'Joined (#1793): closes an on-trial recruit as joined and takes Trial off their roster row. For whoever manages the team''s recruits and may edit its roster.';
comment on function public.mark_recruit_not_joining(integer, text, text) is
  'Not joining (#1793): closes an on-trial recruit as not_joining and takes the trial character off the roster with one of the removal reasons and an optional detail; a raider left with no character on the team is archived too. For whoever manages the team''s recruits and may edit its roster.';

revoke all on function public.start_recruit_trial(integer) from public, anon;
grant execute on function public.start_recruit_trial(integer) to authenticated;
revoke all on function public.extend_recruit_trial(integer, text) from public, anon;
grant execute on function public.extend_recruit_trial(integer, text) to authenticated;
revoke all on function public.mark_recruit_joined(integer) from public, anon;
grant execute on function public.mark_recruit_joined(integer) to authenticated;
revoke all on function public.mark_recruit_not_joining(integer, text, text) from public, anon;
grant execute on function public.mark_recruit_not_joining(integer, text, text) to authenticated;

-- The bot's, as the person with that Discord id, as #1539's are.
create function public.bot_start_recruit_trial(p_application_id integer, p_actor_discord_id text)
returns integer
language plpgsql
set search_path = public
as $$
begin
  return recruit_trial_start(p_application_id, recruit_trial_bot_actor(p_application_id, p_actor_discord_id));
end;
$$;

create function public.bot_extend_recruit_trial(p_application_id integer, p_actor_discord_id text, p_reason text)
returns date
language plpgsql
set search_path = public
as $$
begin
  return recruit_trial_extend(p_application_id, recruit_trial_bot_actor(p_application_id, p_actor_discord_id), p_reason);
end;
$$;

create function public.bot_mark_recruit_joined(p_application_id integer, p_actor_discord_id text)
returns void
language plpgsql
set search_path = public
as $$
begin
  perform recruit_trial_joined(p_application_id, recruit_trial_bot_actor(p_application_id, p_actor_discord_id));
end;
$$;

create function public.bot_mark_recruit_not_joining(
  p_application_id integer, p_actor_discord_id text, p_reason text, p_detail text)
returns void
language plpgsql
set search_path = public
as $$
begin
  perform recruit_trial_not_joining(p_application_id, recruit_trial_bot_actor(p_application_id, p_actor_discord_id),
                                    p_reason, p_detail);
end;
$$;

comment on function public.bot_start_recruit_trial(integer, text) is
  'The bot''s Start trial button (#1793), as the person with that Discord id. Service role only; refused unless that person manages the team''s recruits and may edit its roster.';
comment on function public.bot_extend_recruit_trial(integer, text, text) is
  'The bot''s Extend trial button (#1793), as the person with that Discord id. Service role only; refused unless that person manages the team''s recruits and may edit its roster.';
comment on function public.bot_mark_recruit_joined(integer, text) is
  'The bot''s Joined button (#1793), as the person with that Discord id. Service role only; refused unless that person manages the team''s recruits and may edit its roster.';
comment on function public.bot_mark_recruit_not_joining(integer, text, text, text) is
  'The bot''s Not joining button (#1793), as the person with that Discord id. Service role only; refused unless that person manages the team''s recruits and may edit its roster.';

revoke all on function public.bot_start_recruit_trial(integer, text) from public, anon, authenticated;
grant execute on function public.bot_start_recruit_trial(integer, text) to service_role;
revoke all on function public.bot_extend_recruit_trial(integer, text, text) from public, anon, authenticated;
grant execute on function public.bot_extend_recruit_trial(integer, text, text) to service_role;
revoke all on function public.bot_mark_recruit_joined(integer, text) from public, anon, authenticated;
grant execute on function public.bot_mark_recruit_joined(integer, text) to service_role;
revoke all on function public.bot_mark_recruit_not_joining(integer, text, text, text) from public, anon, authenticated;
grant execute on function public.bot_mark_recruit_not_joining(integer, text, text, text) to service_role;
grant execute on function public.recruit_trial_bot_actor(integer, text) to service_role;
grant execute on function public.recruit_trial_start(integer, integer) to service_role;
grant execute on function public.recruit_trial_extend(integer, integer, text) to service_role;
grant execute on function public.recruit_trial_joined(integer, integer) to service_role;
grant execute on function public.recruit_trial_not_joining(integer, integer, text, text) to service_role;
grant execute on function public.recruit_reason_words(text) to service_role;
-- The bot's Not joining writes the removal in the presser's name. Insert
-- only: nothing changes or deletes a removal once written.
grant insert on table public.removal_reasons to service_role;
