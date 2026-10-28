-- #1647, part 2 of 2: the team checks' guild officer arm becomes the two
-- per-person switches on guild_ranks (#1517):
--
--   "Officer on every team"     acts as an Officer on every team in the
--                               guild. has_team_permission() and
--                               my_permission_team_ids() already answer it
--                               (#1645, #1646), so every check that asks them
--                               drops its separate guild officer arm.
--   "See every team, read-only" reads every team's pages in the guild:
--                               my_permission_team_ids() answers the four
--                               read-only permissions (see_rsvps,
--                               view_reports, view_loot, view_team_audit_log)
--                               as an Officer would, and the officer reads
--                               that ask an edit permission take
--                               my_sees_every_team_ids(). Invite links stay
--                               out: they are a key to join the team.
--
-- Without either switch, a guild Admin cannot see or change anything inside
-- a team they are not on. The guild's Owner always counts as "Officer on
-- every team" (Kat, 2026-10-28), however they became Owner, so the checks
-- ask the rank as well as the switch.
--
-- The current site keeps working: today's guild officers (Admins since
-- #1645) get "Officer on every team" (Kat, 2026-10-28), and until cutover
-- the current site's Grant Guild Officer switches it on and Revoke switches
-- it off, so a guild officer there still acts on every team, as they did.
-- Changing a rank from the new side leaves the switch alone.
--
-- Nothing asks is_guild_officer_of_team() or is_guild_officer_of() any more,
-- so both go. my_guild_officer_team_ids() stays for the guild_ranks read
-- rule, which answers a guild's owner and admins (the guild_officer grant is
-- kept in step with them) until the Members tab brings its own.

-- Today's guild officers.
update public.guild_ranks r
   set officer_on_every_team = true
 where r.rank = 'admin'
   and exists (select 1 from public.guild_grants g
                where g.person_id = r.person_id and g.guild_id = r.guild_id
                  and g.grant_type = 'guild_officer');

-- The current site's Grant and Revoke Guild Officer: a grant makes an Admin
-- with "Officer on every team", a revoke takes both away. A grant made
-- because the new side made someone an owner or admin finds them already
-- one and changes nothing.
create or replace function public.guild_grants_keep_rank()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moved boolean := tg_op <> 'UPDATE'
                     or (old.person_id, old.guild_id, old.grant_type)
                        is distinct from (new.person_id, new.guild_id, new.grant_type);
begin
  if not v_moved then
    return null;
  end if;
  if tg_op <> 'INSERT' and old.grant_type = 'guild_officer' then
    if exists (select 1 from guild_ranks
                where guild_id = old.guild_id and person_id = old.person_id and rank = 'owner') then
      raise exception 'That person is the guild''s Owner. Hand the guild to someone else first.';
    end if;
    update guild_ranks set rank = 'member', officer_on_every_team = false
     where guild_id = old.guild_id and person_id = old.person_id and rank = 'admin';
  end if;
  if tg_op <> 'DELETE' and new.grant_type = 'guild_officer' then
    insert into guild_ranks (guild_id, person_id, rank, officer_on_every_team)
    values (new.guild_id, new.person_id, 'admin', true)
    on conflict (guild_id, person_id) do update set rank = 'admin', officer_on_every_team = true
     where guild_ranks.rank not in ('owner', 'admin');
  end if;
  return null;
end;
$$;

-- The helpers

create or replace function public.my_permission_team_ids(p_permission text)
returns integer[]
language sql
stable
security definer
set search_path to 'public'
as $function$
  with ranks as (
    select m.team_id, m.rank
      from team_members m
     where m.person_id = my_person_id() and m.archived_at is null
    union all
    select t.id, 'officer'
      from guild_ranks g
      join teams t on t.guild_id = g.guild_id
     where g.person_id = my_person_id() and (g.officer_on_every_team or g.rank = 'owner')
    union all
    -- "See every team, read-only": the read-only permissions, as an Officer.
    -- Nothing that writes asks any of these four.
    select t.id, 'officer'
      from guild_ranks g
      join teams t on t.guild_id = g.guild_id
     where g.person_id = my_person_id() and g.sees_every_team
       and p_permission in ('see_rsvps', 'view_reports', 'view_loot', 'view_team_audit_log')
  )
  select coalesce(array_agg(distinct r.team_id), '{}')
    from ranks r
   where exists (select 1 from rank_permissions k where k.permission = p_permission and k.scope = 'team')
     and (r.rank = 'owner'
          or exists (select 1 from team_rank_permissions p
                      where p.team_id = r.team_id and p.rank = r.rank
                        and p.permission = p_permission));
$function$;

comment on function public.my_permission_team_ids(text) is
  'The teams where the caller''s rank has this permission on the team''s grid (#1646): every team they own, any other where their rank''s row is there, with "Officer on every team", or as the guild''s Owner, every team in that guild as an officer, and with "See every team" the read-only permissions there as an officer (#1647). Empty, never null.';

-- Every team in a guild where the caller has either switch or is the Owner, for the officer
-- reads that ask an edit permission. Anon runs it because the rules are
-- evaluated for signed-out reads too; empty there.
create function public.my_sees_every_team_ids()
returns integer[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(t.id), '{}')
    from guild_ranks g
    join teams t on t.guild_id = g.guild_id
   where g.person_id = my_person_id()
     and (g.sees_every_team or g.officer_on_every_team or g.rank = 'owner');
$$;

comment on function public.my_sees_every_team_ids() is
  'Every team, archived included, in a guild where the caller has "See every team, read-only" or "Officer on every team", or is the Owner (#1647). For read rules only. Empty, never null.';

revoke all on function public.my_sees_every_team_ids() from public;
grant execute on function public.my_sees_every_team_ids() to anon, authenticated;

-- Pending signups show to the signup's team's members, to whoever manages
-- its signups, and to "See every team".
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
  WHERE s.approved_player_id IS NULL AND (s.status = 'approved'::text OR s.status = 'pending'::text AND (my_team_role(s.team_id) IS NOT NULL OR s.team_id = ANY (my_permission_team_ids('manage_signups'::text)) OR s.team_id = ANY (my_sees_every_team_ids()) OR is_site_admin()));

-- "See every team" reads the officer pages whose only rule is a write rule:
-- officer notes and the priority list's two dismissal lists (fresh review).
create policy "Every-team viewers read player_officer_notes" on public.player_officer_notes
  for select to authenticated
  using (team_id = any ((select my_sees_every_team_ids())::integer[]));
create policy "Every-team viewers read priority_conflict_dismissals" on public.priority_conflict_dismissals
  for select to authenticated
  using (team_id = any ((select my_sees_every_team_ids())::integer[]));
create policy "Every-team viewers read priority_stale_dismissals" on public.priority_stale_dismissals
  for select to authenticated
  using (team_id = any ((select my_sees_every_team_ids())::integer[]));

-- And the Signups tab, whose read asks manage_signups (fresh review).
alter policy "Officers read signups" on public.season_signups
  using (team_id = any ((select my_permission_team_ids('manage_signups'))::integer[])
         or team_id = any ((select my_sees_every_team_ids())::integer[])
         or (select is_site_admin()));


-- resolve_person: a person's teams show to the two switches instead of a
-- guild officer.
CREATE OR REPLACE FUNCTION public.resolve_person(p_discord_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_self boolean := p_discord_id is not distinct from public.current_discord_id();
  v_is_site_admin boolean := public.is_site_admin();
  -- "Officer on every team" or "See every team" (#1647); the first also
  -- passes edit_roster below.
  v_guild_team_ids integer[] := public.my_sees_every_team_ids();
  v_sees_all_teams boolean;
  v_person people%rowtype;
  v_grants text[];
  v_result jsonb;
begin
  v_sees_all_teams := v_is_self or v_is_site_admin;

  if not (v_sees_all_teams or cardinality(public.my_permission_team_ids('edit_roster')) > 0 or cardinality(v_guild_team_ids) > 0) then
    raise exception 'Not authorized';
  end if;

  select * into v_person from people where discord_id = p_discord_id;

  select coalesce(array_agg(g.grant_type), '{}') into v_grants
    from guild_grants g
   where g.person_id = v_person.id;

  if p_discord_id is null
     or not (
       exists (select 1 from team_members where person_id = v_person.id)
       or cardinality(v_grants) > 0
     ) then
    return null;
  end if;

  select jsonb_build_object(
    'discord_id', p_discord_id,
    'auth_user_id', v_person.auth_user_id,
    'site_admin', case when v_is_self or v_is_site_admin
                       then 'site_admin' = any (v_grants) end,
    'guild_officer', case when v_is_self or v_is_site_admin
                          then 'guild_officer' = any (v_grants) end,
    -- Shown to the callers who saw it before #1646 opened this function to
    -- edit_roster: the person, site admins, team officers, and (#1647) the
    -- two per-person switches, which today's guild officers hold.
    'boe_manager', ('boe_manager' = any (v_grants))
                   and (v_sees_all_teams or public.is_any_team_officer() or cardinality(v_guild_team_ids) > 0),
    'teams', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'team_id', tm.team_id,
                 'team_member_id', tm.id,
                 'role', tm.role,
                 'archived_at', tm.archived_at,
                 'characters', coalesce((
                   select jsonb_agg(
                            jsonb_build_object(
                              'player_id', p.id,
                              'name_realm', p.name_realm,
                              'url_code', p.url_code,
                              'archived_at', p.archived_at
                            )
                            order by p.archived_at desc nulls first, p.name_realm
                          )
                     from players p
                    where p.team_member_id = tm.id
                 ), '[]'::jsonb)
               )
               order by tm.team_id
             )
        from team_members tm
       where tm.person_id = v_person.id
         and (v_sees_all_teams
              or tm.team_id = any (v_guild_team_ids)
              or public.has_team_permission(tm.team_id, 'edit_roster'))
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$function$;

-- Functions: the guild officer arm goes (generated from the definitions;
-- only those lines changed). The three reads take "See every team" instead,
-- and set_team_officer_bios, which still reads the role, asks the switch.

-- also_on_teams
CREATE OR REPLACE FUNCTION public.also_on_teams(p_team_id integer)
 RETURNS TABLE(player_id integer, team_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id, t.name
    from players p
    join team_members tm on tm.id = p.team_member_id
    join team_members tq on tq.person_id = tm.person_id and tq.team_id <> p.team_id
    join players q on q.team_member_id = tq.id and q.archived_at is null
    join teams t on t.id = q.team_id
   where p.team_id = p_team_id
     and p.archived_at is null
     and t.archived_at is null
     and not t.unlisted
     and (
       p_team_id = any ((select my_permission_team_ids('edit_roster'))::integer[])
       or (select is_site_admin())
       or p_team_id = any ((select my_sees_every_team_ids())::integer[])
     )
   group by p.id, t.name;
$function$;

-- earlier_characters
CREATE OR REPLACE FUNCTION public.earlier_characters(p_team_id integer)
 RETURNS TABLE(player_id integer, earlier_player_id integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id, q.id
    from players p
    join team_members tm on tm.id = p.team_member_id
    join team_members tq on tq.person_id = tm.person_id
    join players q on q.team_member_id = tq.id
    join teams t on t.id = q.team_id
   where p.team_id = p_team_id
     and p.archived_at is null
     and q.id <> p.id
     -- An earlier character is one no longer on its roster: an old main on
     -- this team, or a character on a team the person has left (no active
     -- character there any more). A team they are still on keeps its own total.
     and q.archived_at is not null
     and (
       q.team_id = p.team_id
       or not exists (
         select 1 from players r where r.team_member_id = tq.id and r.archived_at is null
       )
     )
     and (q.team_id = p.team_id or not t.unlisted)
     and (
       p_team_id = any ((select my_permission_team_ids('edit_roster'))::integer[])
       or (select is_site_admin())
       or p_team_id = any ((select my_sees_every_team_ids())::integer[])
       or tm.person_id = (select my_person_id())
     );
$function$;

-- team_rsvp_answers
CREATE OR REPLACE FUNCTION public.team_rsvp_answers(p_team_id integer, p_from date, p_to date)
 RETURNS TABLE(player_id integer, raid_date date, status text, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not (
    exists (
      select 1 from players p
      where p.team_id = p_team_id
        and p.id = any (public.my_active_player_ids())
    )
    or public.has_team_permission(p_team_id, 'see_rsvps')
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Choose a date range of at most 62 days.';
  end if;

  return query
    select r.player_id, r.raid_date, r.status, r.updated_at
    from raid_rsvps r
    where r.team_id = p_team_id
      and r.raid_date between p_from and p_to
    order by r.raid_date, r.player_id;
end;
$function$;

-- archive_player
CREATE OR REPLACE FUNCTION public.archive_player(p_player_id integer, p_reason text, p_detail text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team_id integer;
  v_team_member_id integer;
  v_archived_at timestamptz;
begin
  select team_id, team_member_id into v_team_id, v_team_member_id from public.players where id = p_player_id;
  if v_team_id is null then
    raise exception 'Player % not found', p_player_id;
  end if;

  if not (public.has_team_permission(v_team_id, 'edit_roster')
          or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  -- The membership before the character, the order Archive Member takes
  -- (#1432). A claim moving the character to another membership after the
  -- read above is not covered: it would also need that membership archived
  -- in the same instant.
  perform public.hold_team_member(v_team_member_id);

  -- archived_at is null guards a double archive: a second call would
  -- otherwise silently rewrite the first reason with the second one.
  update public.players
     set archived_at = now()
   where id = p_player_id
     and archived_at is null
  returning archived_at into v_archived_at;

  if v_archived_at is null then
    raise exception 'Player % is already archived', p_player_id;
  end if;

  -- Only the two archive columns are written on conflict. A player being
  -- removed may already carry an officer note, and blanking it here would
  -- destroy the note at exactly the moment it is most worth keeping.
  insert into public.player_officer_notes (player_id, team_id, archived_reason, archived_reason_detail)
  values (p_player_id, v_team_id, p_reason, p_detail)
  on conflict (player_id) do update
     set archived_reason = excluded.archived_reason,
         archived_reason_detail = excluded.archived_reason_detail;

  return v_archived_at;
end;
$function$;

-- archive_team_member
CREATE OR REPLACE FUNCTION public.archive_team_member(p_team_id integer, p_team_member_id integer, p_reason text, p_detail text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team_id integer;
  v_role text;
  v_rank text;
  v_archived_at timestamptz;
  v_player_ids integer[];
begin
  if not (
    public.has_team_permission(p_team_id, 'edit_roster')
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  -- The same seven player_officer_notes.archived_reason accepts.
  if p_reason is null or p_reason not in
     ('schedule_conflict', 'performance', 'drama', 'moved_guilds', 'switching_mains', 'other', 'no_signup') then
    raise exception 'That is not one of the reasons a membership can be archived for';
  end if;

  -- Locked, so two archives of the same person cannot both pass the
  -- already-archived check below.
  select team_id, role, rank, archived_at into v_team_id, v_role, v_rank, v_archived_at
    from public.team_members where id = p_team_member_id
    for update;
  if v_team_id is null or v_team_id <> p_team_id then
    raise exception 'That membership is not on this team';
  end if;

  -- Ending an officer's membership is a role change, which belongs to the team
  -- leader or a site admin, as in admin_revoke_team_role(). The leader's own is
  -- a site admin's alone: a team left with no active leader can only be given
  -- one by a site admin.
  if v_role = 'team_leader' and not public.is_site_admin() then
    raise exception 'Only a site admin can archive the team leader';
  end if;
  if v_role = 'officer'
     and not (p_team_id = any (public.my_leader_team_ids()) or public.is_site_admin()) then
    raise exception 'Only the team leader or a site admin can archive an officer';
  end if;
  -- An Assistant comes back a Raider, so archiving one takes the rank away,
  -- which is the grid's "Promote raiders to Assistant and back" (#1646).
  if v_rank = 'assistant'
     and not (public.has_team_permission(p_team_id, 'promote_assistants')
              or public.is_site_admin()) then
    raise exception 'Only someone who can promote Assistants can archive one';
  end if;

  if v_archived_at is not null then
    return;
  end if;

  select coalesce(array_agg(p.id order by p.id), '{}') into v_player_ids
    from public.players p
   where p.team_member_id = p_team_member_id and p.archived_at is null;

  -- Logged before the archive: write_audit_log() re-checks the caller's own
  -- officer status live, so it has to run while the caller's rows read as
  -- they did when the call started.
  perform public.write_audit_log(
    p_team_id, 'team_member_archived', 'team_member', p_team_member_id,
    jsonb_build_object('reason', p_reason, 'detail', p_detail, 'player_ids', to_jsonb(v_player_ids))
  );

  -- The membership's own reason (#1427). Its characters' rows come from the
  -- notes write below, through record_removal_reason().
  insert into public.removal_reasons (team_id, team_member_id, reason, detail, removed_by)
  values (p_team_id, p_team_member_id, p_reason, p_detail, public.my_person_id());

  update public.team_members set archived_at = now() where id = p_team_member_id;
  update public.players set archived_at = now() where id = any (v_player_ids);

  -- Only the two archive columns are written on conflict, as in
  -- archive_player(): an officer note already on the character stays.
  insert into public.player_officer_notes (player_id, team_id, archived_reason, archived_reason_detail)
  select player_id, p_team_id, p_reason, p_detail from unnest(v_player_ids) as player_id
  on conflict (player_id) do update
     set archived_reason = excluded.archived_reason,
         archived_reason_detail = excluded.archived_reason_detail;
end;
$function$;

-- hold_team_member
CREATE OR REPLACE FUNCTION public.hold_team_member(p_team_member_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team_id integer;
begin
  if p_team_member_id is null then
    return;
  end if;

  select team_id into v_team_id from public.team_members where id = p_team_member_id;
  if v_team_id is null
     or not (auth.uid() is null
             or public.has_team_permission(v_team_id, 'edit_roster')
             or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  perform 1 from public.team_members where id = p_team_member_id for share;
end;
$function$;

-- officer_set_rotator_week
CREATE OR REPLACE FUNCTION public.officer_set_rotator_week(p_team_id integer, p_player_id integer, p_week_start date, p_in boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_is_rotator boolean;
  v_date date;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  if not (
    public.has_team_permission(p_team_id, 'attendance')
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  select is_rotator into v_is_rotator
  from players
  where id = p_player_id and team_id = p_team_id and archived_at is null;

  if v_is_rotator is null then
    raise exception 'Player not found on this team.';
  end if;
  if not v_is_rotator then
    raise exception 'Player is not a rotator.';
  end if;

  for v_date in
    select gs::date
    from generate_series(p_week_start, p_week_start + 6, interval '1 day') gs
    where (
      exists (
        select 1 from raid_schedule rs
        where rs.team_id = p_team_id
          and rs.active
          and rs.weekday = extract(dow from gs)::int
      )
      or exists (
        select 1 from raid_schedule_exceptions rse
        where rse.team_id = p_team_id
          and rse.raid_date = gs::date
          and rse.exception_type = 'added'
      )
    )
    and not exists (
      select 1 from raid_schedule_exceptions rse2
      where rse2.team_id = p_team_id
        and rse2.raid_date = gs::date
        and rse2.exception_type = 'cancelled'
    )
  loop
    if p_in then
      insert into raid_rsvps (team_id, player_id, raid_date, status, note)
      values (p_team_id, p_player_id, v_date, 'Rotator-In', 'Officer-assigned for the week of ' || p_week_start)
      on conflict (team_id, player_id, raid_date)
      do update set status = 'Rotator-In', note = excluded.note, updated_at = now();
    else
      delete from raid_rsvps
      where team_id = p_team_id and player_id = p_player_id and raid_date = v_date
        and status = 'Rotator-In';
    end if;
  end loop;

  perform public.write_audit_log(
    p_team_id,
    'Rotator Week Assignment',
    'raid_rsvps',
    p_player_id,
    jsonb_build_object('week_start', p_week_start, 'in', p_in)
  );
end;
$function$;

-- officer_set_rsvp
CREATE OR REPLACE FUNCTION public.officer_set_rsvp(p_team_id integer, p_player_id integer, p_raid_date date, p_status text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  if not (
    public.has_team_permission(p_team_id, 'attendance')
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if p_status is not null and p_status not in ('Attending', 'Late', 'Leaving Early', 'Tentative', 'Absent') then
    raise exception 'Invalid RSVP status: %', p_status;
  end if;

  if p_status = 'Attending' and not public.is_optional_raid_night(p_team_id, p_raid_date) then
    raise exception 'Attending is only valid on an optional raid night.';
  end if;

  if p_status is not null and coalesce(trim(p_note), '') = '' then
    raise exception 'A note is required so the raider knows why this was changed.';
  end if;

  if p_status is null then
    delete from raid_rsvps where team_id = p_team_id and player_id = p_player_id and raid_date = p_raid_date;
  else
    insert into raid_rsvps (team_id, player_id, raid_date, status, note)
    values (p_team_id, p_player_id, p_raid_date, p_status, p_note)
    on conflict (team_id, player_id, raid_date)
    do update set status = excluded.status, note = excluded.note, updated_at = now();
  end if;

  perform public.write_audit_log(
    p_team_id,
    'Officer Set RSVP',
    'raid_rsvps',
    p_player_id,
    jsonb_build_object('raid_date', p_raid_date, 'status', p_status, 'note', p_note)
  );
end;
$function$;

-- plan_raid_night
CREATE OR REPLACE FUNCTION public.plan_raid_night(p_team_id integer, p_raid_date date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not (
    public.has_team_permission(p_team_id, 'edit_schedule')
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if not coalesce((select i.exists from public.raid_night_info(p_team_id, p_raid_date) i), false) then
    raise exception 'There is no raid that night.';
  end if;

  perform pg_advisory_xact_lock(hashtext('boss_lineup'), p_team_id);
  v_count := public.fill_raid_night(p_team_id, p_raid_date);

  if v_count > 0 then
    perform public.write_audit_log(
      p_team_id,
      'Plan Raid Night',
      'raid_night_bosses',
      null,
      jsonb_build_object('raid_date', p_raid_date, 'bosses', v_count)
    );
  end if;

  return v_count;
end;
$function$;

-- record_raid_night_participation
CREATE OR REPLACE FUNCTION public.record_raid_night_participation(p_team_id integer, p_raid_date date, p_encounter_id integer, p_player_ids integer[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not (
    public.has_team_permission(p_team_id, 'attendance')
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if not exists (
    select 1 from raid_night_bosses
    where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id
  ) then
    return 0;
  end if;

  perform public.check_lineup_players(p_team_id, p_player_ids);

  delete from raid_night_participation
  where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id;
  insert into raid_night_participation (team_id, raid_date, encounter_id, player_id)
  select p_team_id, p_raid_date, p_encounter_id, x from unnest(p_player_ids) x;

  return cardinality(p_player_ids);
end;
$function$;

-- restore_player
CREATE OR REPLACE FUNCTION public.restore_player(p_player_id integer, p_name_realm text DEFAULT NULL::text, p_nickname text DEFAULT NULL::text, p_class_spec_id integer DEFAULT NULL::integer, p_is_trial boolean DEFAULT NULL::boolean, p_join_date date DEFAULT NULL::date)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team_id integer;
  v_team_member_id integer;
  v_name_realm text;
  v_restored boolean := false;
  v_spec_label text;
begin
  select team_id, team_member_id, name_realm
    into v_team_id, v_team_member_id, v_name_realm
    from public.players where id = p_player_id;
  if v_team_id is null then
    raise exception 'Player % not found', p_player_id;
  end if;

  if not (public.has_team_permission(v_team_id, 'edit_roster')
          or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  -- Asked about every linked character, not only one whose membership reads
  -- as archived: it locks the membership before the character is written, the
  -- order archive_team_member() takes, so an archive cannot land between this
  -- function's read and its update.
  if v_team_member_id is not null then
    v_restored := public.restore_team_member(v_team_id, v_team_member_id);
  end if;

  -- A blank field keeps what the character had. Only the spelling of the name
  -- may change, and the link must still be the one read above, or the
  -- membership just restored would belong to someone else.
  update public.players
     set name_realm = coalesce(nullif(p_name_realm, ''), name_realm),
         nickname = coalesce(nullif(p_nickname, ''), nickname),
         class_spec_id = coalesce(p_class_spec_id, class_spec_id),
         is_trial = coalesce(p_is_trial, is_trial),
         join_date = coalesce(p_join_date, join_date),
         is_bench = false,
         archived_at = null
   where id = p_player_id
     and archived_at is not null
     and name_realm_key = coalesce(lower(replace(nullif(p_name_realm, ''), ' ', '')), name_realm_key)
     and team_member_id is not distinct from v_team_member_id;

  if not found then
    if exists (select 1 from public.players where id = p_player_id and archived_at is null) then
      raise exception '% is already on the roster', v_name_realm;
    end if;
    raise exception 'That name is not this character''s, or the character changed while being re-added';
  end if;

  select concat_ws(' ', cs.class, cs.spec, cs.role) into v_spec_label
    from public.players p
    join public.classes_specs cs on cs.id = p.class_spec_id
   where p.id = p_player_id;

  perform public.write_audit_log(
    v_team_id, 'Player Added', 'players', p_player_id,
    to_jsonb(concat_ws(', ',
      coalesce(v_spec_label, 'Unknown spec'),
      're-added',
      case when v_restored then 'membership restored' end))
  );

  return v_restored;
end $function$;

-- restore_team_member
CREATE OR REPLACE FUNCTION public.restore_team_member(p_team_id integer, p_team_member_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team_id integer;
  v_role text;
  v_archived_at timestamptz;
begin
  if not (
    public.has_team_permission(p_team_id, 'edit_roster')
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  -- Locked, as in archive_team_member(), so a restore and an archive of the
  -- same person run one after the other, and two restores answer once.
  select team_id, role, archived_at into v_team_id, v_role, v_archived_at
    from public.team_members where id = p_team_member_id
    for update;
  if v_team_id is null or v_team_id <> p_team_id then
    raise exception 'That membership is not on this team';
  end if;

  if v_archived_at is null then
    return false;
  end if;

  perform public.write_audit_log(
    p_team_id, 'team_member_restored', 'team_member', p_team_member_id,
    jsonb_build_object('role', 'raider', 'archived_role', v_role)
  );

  -- Back as a raider whatever role the archived row held, as through the
  -- invite link; a role above that is the team leader's to grant.
  update public.team_members set archived_at = null, role = 'raider' where id = p_team_member_id;
  return true;
end;
$function$;

-- restrict_players_self_update_to_bonus_roll
CREATE OR REPLACE FUNCTION public.restrict_players_self_update_to_bonus_roll()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if public.has_team_permission(new.team_id, 'edit_roster')
     or public.is_site_admin()
  then
    return new;
  end if;

  if (to_jsonb(new) - 'bonus_roll_encounter_id' - 'updated_at' - 'name_realm_key')
     is distinct from (to_jsonb(old) - 'bonus_roll_encounter_id' - 'updated_at' - 'name_realm_key') then
    raise exception 'Raiders may only update bonus_roll_encounter_id on their own player row';
  end if;
  return new;
end $function$;

-- review_main_swap_request
CREATE OR REPLACE FUNCTION public.review_main_swap_request(p_request_id integer, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_request public.main_swap_requests%rowtype;
  v_from public.players%rowtype;
  v_player_id integer;
  v_spec_label text;
  v_note text := nullif(btrim(p_note), '');
  v_member_id integer;
  v_prior_member_id integer;
begin
  -- Read without a lock first, for the rows to lock below; the status is
  -- checked again once the request is held.
  select * into v_request from public.main_swap_requests where id = p_request_id;
  if not found then
    raise exception 'No main swap with id %', p_request_id;
  end if;

  if not (public.has_team_permission(v_request.team_id, 'edit_roster')
          or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  if v_request.status is distinct from 'pending' then
    raise exception 'That main swap was already %', v_request.status;
  end if;

  -- Rows are taken in an order that waits behind an archive instead of
  -- deadlocking with it (#1428): the membership, for share, which the share
  -- a removal or a signup add holds on it (#1432) does not block; then the
  -- new roster row,
  -- which a signup main swap writes before it archives the old character;
  -- then the old character; then the request, which the trigger cancelling a
  -- waiting swap reaches last.
  -- The raider is the person who asked (#1433), not whoever holds the old
  -- character now: a claim removed and taken by someone else while the swap
  -- waited would otherwise move the alt to them.
  select id into v_member_id from public.team_members
   where team_id = v_request.team_id and person_id = v_request.person_id and archived_at is null
     for share;
  if v_member_id is null then
    raise exception 'The raider who asked is no longer on this team';
  end if;
  select * into v_from from public.players where id = v_request.from_player_id;
  if v_from.team_member_id is distinct from v_member_id then
    raise exception '% is no longer linked to the raider who asked', v_from.name_realm;
  end if;

  if p_approve then
    -- A row by that name held by anyone else, on the roster or archived, is
    -- refused (#1433): the row carries that person's history, and only an
    -- officer can say whose the name is now. Held as the upsert below holds it.
    select team_member_id into v_prior_member_id
      from public.players
     where team_id = v_request.team_id
       and name_realm_key = lower(replace(v_request.name_realm, ' ', ''))
       for no key update;
    if v_prior_member_id is not null and v_prior_member_id <> v_member_id then
      raise exception '% is someone else''s character on this team', v_request.name_realm;
    end if;

    -- The character joins the roster, or comes back to it, as the raider's.
    -- Same on-conflict shape as add_signup_to_roster(): a character they
    -- played before keeps its id, so its loot and raid history stay attached
    -- to it.
    insert into public.players (
      team_id, name_realm, class_spec_id, is_trial, join_date, is_backup_tank, is_backup_healer, team_member_id
    )
    values (
      v_request.team_id, v_request.name_realm, v_request.class_spec_id, v_from.is_trial, v_from.join_date,
      v_from.is_backup_tank, v_from.is_backup_healer, v_member_id
    )
    on conflict (team_id, name_realm_key) do update
      set class_spec_id = excluded.class_spec_id,
          is_trial = excluded.is_trial,
          join_date = excluded.join_date,
          is_backup_tank = excluded.is_backup_tank,
          is_backup_healer = excluded.is_backup_healer,
          team_member_id = excluded.team_member_id,
          -- The officer's wishlist and BiS exceptions were for the last stint
          -- (#1618), as a signup re-add and the invite link reset them.
          wishlist_allowed = case when players.archived_at is not null
                           then false else players.wishlist_allowed end,
          bis_allowed = case when players.archived_at is not null
                      then false else players.bis_allowed end,
          archived_at = null
    returning id into v_player_id;
  end if;

  select * into v_from from public.players where id = v_request.from_player_id for no key update;
  select * into v_request from public.main_swap_requests where id = p_request_id for update;
  if not found then
    raise exception 'No main swap with id %', p_request_id;
  end if;
  if v_request.status is distinct from 'pending' then
    raise exception 'That main swap was already %', v_request.status;
  end if;

  if not p_approve then
    update public.main_swap_requests
       set status = 'declined', reviewed_at = now(), reviewed_by = public.my_person_id(), officer_note = v_note
     where id = p_request_id;

    -- Written here rather than through notify_player(), whose own check is
    -- the team's officers and site admins: a guild officer may review this.
    insert into public.notifications (team_id, player_id, message)
    values (v_request.team_id, v_request.from_player_id,
            concat('Your main swap to ', v_request.name_realm, ' was declined.',
                   case when v_note is not null then ' ' || v_note end));
    return null;
  end if;

  -- Reached only by a swap left waiting without the trigger (a restore with
  -- triggers off): the archive closes every other one first.
  if v_from.archived_at is not null then
    raise exception '% is no longer on the roster', v_from.name_realm;
  end if;

  -- The old character already renamed into the one asked for (the Roster
  -- tab's rename keeps the row): approving would archive the row it approved.
  if v_player_id = v_request.from_player_id then
    raise exception '% is already on the roster as their character', v_request.name_realm;
  end if;

  -- Approved before the old character is archived, so the trigger that cancels
  -- a waiting swap when its character leaves the roster finds this one closed.
  update public.main_swap_requests
     set status = 'approved', reviewed_at = now(), reviewed_by = public.my_person_id(),
         officer_note = v_note, approved_player_id = v_player_id
   where id = p_request_id;

  -- The link stays on the archived character (#941): its attendance, loot and
  -- BoE finds still belong to this person, and step 5b's loot total reads it.
  update public.players set archived_at = now() where id = v_request.from_player_id;

  -- Attendance follows the raider, skipping any night the destination
  -- character already has its own row for (a character they played before).
  update public.attendance a set player_id = v_player_id
   where a.player_id = v_request.from_player_id
     and a.team_id = v_request.team_id
     and not exists (
       select 1 from public.attendance b
        where b.team_id = v_request.team_id
          and b.player_id = v_player_id
          and b.raid_date = a.raid_date
     );

  -- Audit (#1136): the same two lines a main swap through a signup writes, so
  -- both read alike in the Audit Log.
  select concat_ws(' ', cs.class, cs.spec, cs.role) into v_spec_label
    from public.classes_specs cs where cs.id = v_request.class_spec_id;

  perform public.write_audit_log(
    v_request.team_id, 'Player Added', 'players', v_player_id,
    to_jsonb(concat_ws(', ', coalesce(v_spec_label, 'Unknown spec'), 'main swap from ' || v_from.name_realm))
  );
  perform public.write_audit_log(
    v_request.team_id, 'Main Swap: Old Character Removed', 'players', v_request.from_player_id,
    to_jsonb('Replaced by ' || v_request.name_realm)
  );

  insert into public.notifications (team_id, player_id, message)
  values (v_request.team_id, v_player_id,
          concat('Your main swap to ', v_request.name_realm, ' was approved.',
                 case when v_note is not null then ' ' || v_note end));

  return v_player_id;
end;
$function$;

-- set_boss_group
CREATE OR REPLACE FUNCTION public.set_boss_group(p_team_id integer, p_encounter_id integer, p_player_ids integer[], p_expected_player_ids integer[] DEFAULT NULL::integer[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_current integer[];
  v_nights date[];
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not (
    public.has_team_permission(p_team_id, 'edit_schedule')
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if not exists (select 1 from raid_encounters where id = p_encounter_id) then
    raise exception 'That boss is not in the raid list yet.';
  end if;

  perform public.check_lineup_players(p_team_id, p_player_ids);
  perform pg_advisory_xact_lock(hashtext('boss_lineup'), p_team_id);

  select coalesce(array_agg(player_id), '{}') into v_current
  from boss_groups where team_id = p_team_id and encounter_id = p_encounter_id;

  if p_expected_player_ids is not null and not public.same_player_set(v_current, p_expected_player_ids) then
    raise exception 'Someone else changed this group since you opened it. Reload to see their change.';
  end if;

  delete from boss_groups where team_id = p_team_id and encounter_id = p_encounter_id;
  insert into boss_groups (team_id, encounter_id, player_id)
  select p_team_id, p_encounter_id, x from unnest(p_player_ids) x;

  select coalesce(array_agg(raid_date order by raid_date), '{}') into v_nights
  from raid_night_bosses
  where team_id = p_team_id and encounter_id = p_encounter_id
    and raid_date >= public.raid_today() and confirmed_at is null and not skipped;

  delete from raid_night_lineups
  where team_id = p_team_id and encounter_id = p_encounter_id and raid_date = any (v_nights);
  insert into raid_night_lineups (team_id, raid_date, encounter_id, player_id)
  select p_team_id, d, p_encounter_id, x
  from unnest(v_nights) d, unnest(p_player_ids) x
  join players p on p.id = x and not p.is_bench;

  perform public.write_audit_log(
    p_team_id,
    'Set Boss Group',
    'boss_groups',
    p_encounter_id,
    jsonb_build_object(
      'boss', (select name from raid_encounters where id = p_encounter_id),
      'player_ids', to_jsonb(p_player_ids),
      'nights_following', to_jsonb(v_nights)
    )
  );

  return cardinality(p_player_ids);
end;
$function$;

-- set_lineup_role_targets
CREATE OR REPLACE FUNCTION public.set_lineup_role_targets(p_team_id integer, p_tanks integer, p_healers integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not (
    public.has_team_permission(p_team_id, 'edit_schedule')
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if p_tanks < 0 or p_tanks > 20 or p_healers < 0 or p_healers > 20 then
    raise exception 'Role targets have to be between 0 and 20.';
  end if;

  insert into team_lineup_settings (team_id, tanks_wanted, healers_wanted, updated_at)
  values (p_team_id, p_tanks, p_healers, now())
  on conflict (team_id) do update set tanks_wanted = excluded.tanks_wanted, healers_wanted = excluded.healers_wanted, updated_at = excluded.updated_at;

  perform public.write_audit_log(
    p_team_id,
    'Set Lineup Role Targets',
    'team_lineup_settings',
    p_team_id,
    jsonb_build_object('tanks_wanted', p_tanks, 'healers_wanted', p_healers)
  );
end;
$function$;

-- set_raid_night_boss_skipped
CREATE OR REPLACE FUNCTION public.set_raid_night_boss_skipped(p_team_id integer, p_raid_date date, p_encounter_id integer, p_skipped boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not (
    public.has_team_permission(p_team_id, 'edit_schedule')
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if p_skipped is null then
    raise exception 'Say whether the boss is skipped.';
  end if;

  perform pg_advisory_xact_lock(hashtext('boss_lineup'), p_team_id);

  update raid_night_bosses
     set skipped = p_skipped, skipped_for_kill_id = null, confirmed_at = null, confirmed_by = null
   where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id;

  if not found then
    raise exception 'That boss is not on this night''s plan.';
  end if;

  delete from raid_night_lineups
  where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id;

  if not p_skipped then
    insert into raid_night_lineups (team_id, raid_date, encounter_id, player_id)
    select p_team_id, p_raid_date, p_encounter_id, g.player_id
    from boss_groups g
    join players p on p.id = g.player_id and p.archived_at is null and not p.is_bench
    where g.team_id = p_team_id and g.encounter_id = p_encounter_id;
  end if;

  perform public.write_audit_log(
    p_team_id,
    case when p_skipped then 'Skip Raid Night Boss' else 'Unskip Raid Night Boss' end,
    'raid_night_bosses',
    p_encounter_id,
    jsonb_build_object('raid_date', p_raid_date, 'boss', (select name from raid_encounters where id = p_encounter_id))
  );
end;
$function$;

-- set_raid_night_lineup
CREATE OR REPLACE FUNCTION public.set_raid_night_lineup(p_team_id integer, p_raid_date date, p_encounter_id integer, p_player_ids integer[], p_expected_player_ids integer[] DEFAULT NULL::integer[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_current integer[];
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not (
    public.has_team_permission(p_team_id, 'edit_schedule')
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if p_raid_date is null or not coalesce((select i.exists from public.raid_night_info(p_team_id, p_raid_date) i), false) then
    raise exception 'There is no raid that night.';
  end if;

  if not exists (select 1 from raid_encounters where id = p_encounter_id) then
    raise exception 'That boss is not in the raid list yet.';
  end if;

  perform public.check_lineup_players(p_team_id, p_player_ids);
  perform pg_advisory_xact_lock(hashtext('boss_lineup'), p_team_id);

  select coalesce(array_agg(player_id), '{}') into v_current
  from raid_night_lineups
  where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id;

  if p_expected_player_ids is not null and not public.same_player_set(v_current, p_expected_player_ids) then
    raise exception 'Someone else changed this boss''s lineup since you opened it. Reload to see their change.';
  end if;

  insert into raid_night_bosses (team_id, raid_date, encounter_id, position, confirmed_at, confirmed_by)
  values (
    p_team_id, p_raid_date, p_encounter_id,
    coalesce((select max(position) from raid_night_bosses where team_id = p_team_id and raid_date = p_raid_date), 0) + 1,
    now(), public.my_person_id()
  )
  on conflict (team_id, raid_date, encounter_id)
  do update set skipped = false, skipped_for_kill_id = null, confirmed_at = now(), confirmed_by = public.my_person_id();

  delete from raid_night_lineups
  where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id;
  insert into raid_night_lineups (team_id, raid_date, encounter_id, player_id)
  select p_team_id, p_raid_date, p_encounter_id, x from unnest(p_player_ids) x;

  perform public.write_audit_log(
    p_team_id,
    'Set Raid Night Lineup',
    'raid_night_lineups',
    p_encounter_id,
    jsonb_build_object(
      'raid_date', p_raid_date,
      'boss', (select name from raid_encounters where id = p_encounter_id),
      'player_ids', to_jsonb(p_player_ids),
      'was', to_jsonb(v_current)
    )
  );

  return cardinality(p_player_ids);
end;
$function$;

-- set_team_officer_bios
CREATE OR REPLACE FUNCTION public.set_team_officer_bios(p_team_id integer, p_bios jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_config jsonb;
begin
  if not (
    coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false)
    or public.is_site_admin()
    -- "Officer on every team", or the Owner, of this team's guild (#1647):
    -- the role check above does not see it.
    or exists (select 1 from public.guild_ranks g join public.teams t on t.guild_id = g.guild_id
                where t.id = p_team_id and g.person_id = public.my_person_id()
                  and (g.officer_on_every_team or g.rank = 'owner'))
  ) then
    raise exception 'Not authorized';
  end if;

  update public.team_settings
  set config = config || jsonb_build_object('teamOfficerBios', p_bios)
  where team_id = p_team_id
  returning config into v_config;

  if not found then
    raise exception 'Not authorized';
  end if;

  perform public.write_audit_log(
    p_team_id,
    'Team Officer Bios Saved',
    'team_settings',
    null,
    jsonb_build_object('count', jsonb_array_length(p_bios))
  );

  return v_config;
end;
$function$;

-- team_battlenet_connections
CREATE OR REPLACE FUNCTION public.team_battlenet_connections(p_team_id integer)
 RETURNS TABLE(team_member_id integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (
    public.has_team_permission(p_team_id, 'edit_roster')
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  return query
  select tm.id
  from public.team_members tm
  join public.people pe on pe.id = tm.person_id
  where tm.team_id = p_team_id
    and pe.auth_user_id is not null
    and exists (
      select 1
      from auth.identities i
      where i.user_id = pe.auth_user_id
        and i.provider = 'custom:battlenet'
    )
  order by tm.id;
end;
$function$;

-- team_invite_link_reset
CREATE OR REPLACE FUNCTION public.team_invite_link_reset(p_team_id integer, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS team_invite_links
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_slug text;
  v_row public.team_invite_links;
begin
  if not (
    public.has_team_permission(p_team_id, 'edit_roster')
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  select slug into v_slug from public.teams where id = p_team_id;
  if v_slug is null then
    raise exception 'Team not found';
  end if;

  insert into public.team_invite_links (team_id, code, expires_at)
  values (p_team_id, v_slug || '-' || public.new_url_code(), p_expires_at)
  on conflict (team_id) do update
    set code = excluded.code,
        expires_at = excluded.expires_at
  returning * into v_row;

  perform public.write_audit_log(p_team_id, 'Invite Link Reset', 'team_invite_links', p_team_id, jsonb_build_object('expires_at', p_expires_at));

  return v_row;
end;
$function$;

-- team_invite_link_revoke
CREATE OR REPLACE FUNCTION public.team_invite_link_revoke(p_team_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (
    public.has_team_permission(p_team_id, 'edit_roster')
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  delete from public.team_invite_links where team_id = p_team_id;

  perform public.write_audit_log(p_team_id, 'Invite Link Revoked', 'team_invite_links', p_team_id, '{}'::jsonb);
end;
$function$;

-- team_unnamed_members
CREATE OR REPLACE FUNCTION public.team_unnamed_members(p_team_id integer)
 RETURNS TABLE(team_member_id integer, discord_name text, battletag text, character_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Whoever can Assign: edit_roster on the team, "Officer on every team" in
  -- its guild included (#1647), or a site admin.
  if not (
    public.has_team_permission(p_team_id, 'edit_roster')
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  return query
  select
    tm.id,
    -- An empty name counts as none, as the app reads its own sign-in.
    (select coalesce(nullif(i.identity_data -> 'custom_claims' ->> 'global_name', ''),
                     nullif(i.identity_data ->> 'full_name', ''),
                     nullif(i.identity_data ->> 'name', ''))
       from auth.identities i
      where i.user_id = pe.auth_user_id and i.provider = 'discord'
      order by i.created_at desc
      limit 1),
    (select nullif(i.identity_data -> 'custom_claims' ->> 'battletag', '')
       from auth.identities i
      where i.user_id = pe.auth_user_id and i.provider = 'custom:battlenet'
      order by i.created_at desc
      limit 1),
    (select p.name_realm
       from public.players p
      -- On this team too, not only linked to the membership (CodeRabbit).
      where p.team_member_id = tm.id and p.team_id = tm.team_id and p.archived_at is null
      order by p.id
      limit 1)
  from public.team_members tm
  join public.people pe on pe.id = tm.person_id
  where tm.team_id = p_team_id
    and tm.archived_at is null
    and not exists (select 1 from public.names n where n.team_member_id = tm.id)
  order by tm.id;
end;
$function$;

-- write_audit_log
CREATE OR REPLACE FUNCTION public.write_audit_log(p_team_id integer, p_action text, p_target_type text DEFAULT NULL::text, p_target_id integer DEFAULT NULL::integer, p_detail jsonb DEFAULT NULL::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_id integer;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  if not (exists (select 1 from public.rank_permissions k
                  where k.permission in ('edit_roster', 'edit_schedule', 'attendance', 'manage_signups',
                                         'manage_loot', 'pay_boe_cuts', 'promote_assistants')
                    and public.has_team_permission(p_team_id, k.permission)) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, p_action, p_target_type, p_target_id, p_detail)
  returning id into v_id;

  return v_id;
end;
$function$;


-- The table rules (generated from pg_policies; only the guild officer arm
-- changed). Each keeps its name and its other arms.

-- Officer reads: the guild officer arm becomes "See every team" (and
-- "Officer on every team", which reads as an officer anyway).

alter policy "Officers read boss_groups" on public.boss_groups
  using (((team_id = ANY (( SELECT my_permission_team_ids('edit_schedule'::text) AS my_permission_team_ids)::integer[])) OR (team_id = ANY (( SELECT my_sees_every_team_ids() AS my_sees_every_team_ids)::integer[])) OR ( SELECT is_site_admin() AS is_site_admin)));

alter policy "Officers read characters on their teams" on public.characters
  using (((person_id IN ( SELECT tm.person_id
   FROM team_members tm
  WHERE (tm.team_id = ANY (( SELECT my_permission_team_ids('edit_roster'::text) AS my_permission_team_ids)::integer[])))) OR (person_id IN ( SELECT tm.person_id
   FROM team_members tm
  WHERE (tm.team_id = ANY (( SELECT my_sees_every_team_ids() AS my_sees_every_team_ids)::integer[])))) OR ( SELECT is_site_admin() AS is_site_admin)));

alter policy "Officers read main swap requests on their teams" on public.main_swap_requests
  using (((team_id = ANY (( SELECT my_permission_team_ids('edit_roster'::text) AS my_permission_team_ids)::integer[])) OR (team_id = ANY (( SELECT my_sees_every_team_ids() AS my_sees_every_team_ids)::integer[])) OR ( SELECT is_site_admin() AS is_site_admin)));

alter policy "Officers read people on their teams" on public.people
  using (((id IN ( SELECT tm.person_id
   FROM team_members tm
  WHERE (tm.team_id = ANY (( SELECT my_permission_team_ids('edit_roster'::text) AS my_permission_team_ids)::integer[])))) OR (id IN ( SELECT tm.person_id
   FROM team_members tm
  WHERE (tm.team_id = ANY (( SELECT my_sees_every_team_ids() AS my_sees_every_team_ids)::integer[])))) OR ( SELECT is_site_admin() AS is_site_admin)));

alter policy "Officers read raid_night_bosses" on public.raid_night_bosses
  using (((team_id = ANY (( SELECT my_permission_team_ids('edit_schedule'::text) AS my_permission_team_ids)::integer[])) OR (team_id = ANY (( SELECT my_permission_team_ids('attendance'::text) AS my_permission_team_ids)::integer[])) OR (team_id = ANY (( SELECT my_sees_every_team_ids() AS my_sees_every_team_ids)::integer[])) OR ( SELECT is_site_admin() AS is_site_admin)));

alter policy "Officers read raid_night_lineups" on public.raid_night_lineups
  using (((team_id = ANY (( SELECT my_permission_team_ids('edit_schedule'::text) AS my_permission_team_ids)::integer[])) OR (team_id = ANY (( SELECT my_permission_team_ids('attendance'::text) AS my_permission_team_ids)::integer[])) OR (team_id = ANY (( SELECT my_sees_every_team_ids() AS my_sees_every_team_ids)::integer[])) OR ( SELECT is_site_admin() AS is_site_admin)));

alter policy "Officers read raid_night_participation" on public.raid_night_participation
  using (((team_id = ANY (( SELECT my_permission_team_ids('attendance'::text) AS my_permission_team_ids)::integer[])) OR (team_id = ANY (( SELECT my_sees_every_team_ids() AS my_sees_every_team_ids)::integer[])) OR ( SELECT is_site_admin() AS is_site_admin)));

alter policy "Officers read removal_reasons" on public.removal_reasons
  using (((team_id = ANY (( SELECT my_permission_team_ids('edit_roster'::text) AS my_permission_team_ids)::integer[])) OR (team_id = ANY (( SELECT my_sees_every_team_ids() AS my_sees_every_team_ids)::integer[])) OR ( SELECT is_site_admin() AS is_site_admin)));

alter policy "Officers read own team_members" on public.team_members
  using (((team_id = ANY (( SELECT my_permission_team_ids('edit_roster'::text) AS my_permission_team_ids)::integer[])) OR (team_id = ANY (( SELECT my_sees_every_team_ids() AS my_sees_every_team_ids)::integer[])) OR ( SELECT is_site_admin() AS is_site_admin)));

-- The rest: "Officer on every team" passes through my_permission_team_ids(),
-- the read-only permissions answer "See every team" there too, and invite
-- links are a key to join the team, not something to look at.

alter policy "Officers write attendance" on public.attendance
  using (((team_id = ANY (( SELECT my_permission_team_ids('attendance'::text) AS my_permission_team_ids)::integer[])) OR ( SELECT is_site_admin() AS is_site_admin)))
  with check (((team_id = ANY (( SELECT my_permission_team_ids('attendance'::text) AS my_permission_team_ids)::integer[])) OR ( SELECT is_site_admin() AS is_site_admin)));

alter policy "Officers read item_preferences" on public.item_preferences
  using (((team_id = ANY (( SELECT my_permission_team_ids('view_loot'::text) AS my_permission_team_ids)::integer[])) OR ( SELECT is_site_admin() AS is_site_admin)));

alter policy "Officers write names" on public.names
  using (((team_id = ANY (( SELECT my_permission_team_ids('edit_roster'::text) AS my_permission_team_ids)::integer[])) OR ( SELECT is_site_admin() AS is_site_admin)))
  with check (((team_id = ANY (( SELECT my_permission_team_ids('edit_roster'::text) AS my_permission_team_ids)::integer[])) OR ( SELECT is_site_admin() AS is_site_admin)));

alter policy "Officers write player_officer_notes" on public.player_officer_notes
  using (((team_id = ANY (( SELECT my_permission_team_ids('edit_roster'::text) AS my_permission_team_ids)::integer[])) OR ( SELECT is_site_admin() AS is_site_admin)))
  with check (((team_id = ANY (( SELECT my_permission_team_ids('edit_roster'::text) AS my_permission_team_ids)::integer[])) OR ( SELECT is_site_admin() AS is_site_admin)));

alter policy "Officers write players" on public.players
  using (((team_id = ANY (( SELECT my_permission_team_ids('edit_roster'::text) AS my_permission_team_ids)::integer[])) OR ( SELECT is_site_admin() AS is_site_admin)))
  with check (((team_id = ANY (( SELECT my_permission_team_ids('edit_roster'::text) AS my_permission_team_ids)::integer[])) OR ( SELECT is_site_admin() AS is_site_admin)));

alter policy "Officers read raid_rsvps" on public.raid_rsvps
  using (((team_id = ANY (( SELECT my_permission_team_ids('see_rsvps'::text) AS my_permission_team_ids)::integer[])) OR ( SELECT is_site_admin() AS is_site_admin)));

alter policy "Officers write raid_schedule" on public.raid_schedule
  using (((team_id = ANY (( SELECT my_permission_team_ids('edit_schedule'::text) AS my_permission_team_ids)::integer[])) OR ( SELECT is_site_admin() AS is_site_admin)))
  with check (((team_id = ANY (( SELECT my_permission_team_ids('edit_schedule'::text) AS my_permission_team_ids)::integer[])) OR ( SELECT is_site_admin() AS is_site_admin)));

alter policy "Officers write raid_schedule_exceptions" on public.raid_schedule_exceptions
  using (((team_id = ANY (( SELECT my_permission_team_ids('edit_schedule'::text) AS my_permission_team_ids)::integer[])) OR ( SELECT is_site_admin() AS is_site_admin)))
  with check (((team_id = ANY (( SELECT my_permission_team_ids('edit_schedule'::text) AS my_permission_team_ids)::integer[])) OR ( SELECT is_site_admin() AS is_site_admin)));

alter policy "Officers read team_invite_links" on public.team_invite_links
  using (((team_id = ANY (( SELECT my_permission_team_ids('edit_roster'::text) AS my_permission_team_ids)::integer[])) OR ( SELECT is_site_admin() AS is_site_admin)));

alter policy "Officers read team_raid_kills" on public.team_raid_kills
  using (((team_id = ANY (( SELECT my_permission_team_ids('view_reports'::text) AS my_permission_team_ids)::integer[])) OR ( SELECT is_site_admin() AS is_site_admin)));

alter policy "Officers read team_raid_reports" on public.team_raid_reports
  using (((team_id = ANY (( SELECT my_permission_team_ids('view_reports'::text) AS my_permission_team_ids)::integer[])) OR ( SELECT is_site_admin() AS is_site_admin)));

alter policy "Officers write team_schedule_settings" on public.team_schedule_settings
  using (((team_id = ANY (( SELECT my_permission_team_ids('edit_schedule'::text) AS my_permission_team_ids)::integer[])) OR ( SELECT is_site_admin() AS is_site_admin)))
  with check (((team_id = ANY (( SELECT my_permission_team_ids('edit_schedule'::text) AS my_permission_team_ids)::integer[])) OR ( SELECT is_site_admin() AS is_site_admin)));


-- Nothing asks these any more.
drop function public.is_guild_officer_of_team(integer);
drop function public.is_guild_officer_of(integer);
