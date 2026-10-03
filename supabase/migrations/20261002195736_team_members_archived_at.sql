-- #1355 (Rex's review on the issue, 2026-09-28): a membership that leaves
-- the team is archived, not deleted.
--
-- Deleting a team_members row empties team_member_id on every character
-- that pointed at it, players.team_member_id being ON DELETE SET NULL --
-- archived ones included. That link is what says whose an archived
-- character's loot, attendance and BoE finds were, and it is how
-- earlier_characters() finds an old main. Losing it also frees the character
-- for the next Battle.net import that carries the same name to revive as
-- theirs, since the join already revives any archived character nobody
-- holds. The codebase already refuses this for the same reason:
-- admin_revoke_team_role() (decisions log, #910) demotes to raider rather
-- than deleting whenever a players row still points at the membership.
--
-- team_members gets the column players already has for the same idea.
-- archive_team_member(), below, sets it and archives the person's active
-- characters instead of deleting the row; team_invite_link_join() clears it
-- when they come back.

alter table public.team_members add column archived_at timestamptz;

comment on column public.team_members.archived_at is
  'Set when an officer archives this membership (archive_team_member, #1355) for someone who left -- never deleted, so the account''s history keeps pointing at something. Cleared by team_invite_link_join() if they come back. A team leader''s direct edit of the row can also set or clear it. Every "what is this person on this team" predicate (my_team_role, my_officer_team_ids, my_leader_team_ids, is_any_team_officer, is_team_leader_anywhere) skips an archived row; my_player_ids() and earlier_characters() still read it, since that is the history.';

create or replace function public.my_team_role(p_team_id integer) returns text
language sql stable security definer set search_path to 'public'
as $$
  select role
  from team_members
  where team_id = p_team_id
    and person_id = my_person_id()
    and archived_at is null
  limit 1;
$$;

create or replace function public.my_officer_team_ids() returns integer[]
language sql stable security definer set search_path to 'public'
as $$
  select coalesce(array_agg(distinct team_id), '{}')
    from team_members
   where person_id = my_person_id()
     and role = any (array['officer', 'team_leader'])
     and archived_at is null;
$$;

create or replace function public.my_leader_team_ids() returns integer[]
language sql stable security definer set search_path to 'public'
as $$
  select coalesce(array_agg(distinct team_id), '{}')
    from team_members
   where person_id = my_person_id()
     and role = 'team_leader'
     and archived_at is null;
$$;

create or replace function public.is_any_team_officer() returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from team_members
    where person_id = my_person_id()
      and role = any (array['officer', 'team_leader'])
      and archived_at is null
  );
$$;

create or replace function public.is_team_leader_anywhere() returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from team_members
    where person_id = my_person_id()
      and role = 'team_leader'
      and archived_at is null
  );
$$;

-- Un-archives on the way back in, the one step team_invite_link_join() owed
-- this design: a returning member's insert now conflicts on their own
-- (archived) row and picks it back up instead of leaving it archived. The
-- rest of the function is as it was.
CREATE OR REPLACE FUNCTION public.team_invite_link_join(p_code text, p_blizzard_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_discord_id text;
  v_team_id integer;
  v_member_id integer;
  v_character public.characters%rowtype;
  v_spec_id integer;
  v_player_id integer;
  v_today date := (now() at time zone 'America/New_York')::date;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select l.team_id into v_team_id
    from public.team_invite_links l
   where l.code = p_code
     and (l.expires_at is null or l.expires_at > now());
  if v_team_id is null then
    raise exception 'This invite link does not work';
  end if;

  -- team_members is keyed on the Discord id, as claim_character() is.
  v_discord_id := public.current_discord_id();
  if v_discord_id is null then
    raise exception 'Connect Discord before joining a team';
  end if;

  -- The character has to be one Blizzard confirmed for this person, the way
  -- request_main_swap() takes a character id rather than a name. Everything
  -- below reads the name from this row, so the caller never supplies it.
  select * into v_character
    from public.characters c
   where c.blizzard_id = p_blizzard_id
     and c.person_id = public.my_person_id();
  if not found then
    raise exception 'That character is not on your account';
  end if;

  select cs.id into v_spec_id
    from public.classes_specs cs
   where cs.class = v_character.class_name and cs.spec = v_character.spec_name;

  -- The membership goes the same way, for the same reason: a person opening
  -- the link in two tabs would otherwise have both find no membership and both
  -- insert, and the second would surface team_members_team_id_person_id_key
  -- instead of joining. The trigger fills person_id before the conflict is
  -- checked, so it can arbitrate on it. An existing membership is updated only
  -- when it was archived (#1355): the person is coming back, and as a raider,
  -- since the link is a raider's way in. A current one is left alone, since an
  -- update would touch its updated_at for nothing; the select below finds it.
  insert into public.team_members (team_id, discord_id, role)
  values (v_team_id, v_discord_id, 'raider')
  on conflict (team_id, person_id) do update
     set role = 'raider', archived_at = null
   where team_members.archived_at is not null
  returning id into v_member_id;

  if v_member_id is null then
    select tm.id into v_member_id
      from public.team_members tm
     where tm.team_id = v_team_id and tm.person_id = public.my_person_id();
  end if;

  -- One statement for the new character and the returning one, so a join
  -- racing another on the same name cannot pass a check and then write.
  insert into public.players (team_id, name_realm, class_spec_id, is_trial, join_date, team_member_id)
  values (v_team_id, v_character.name_realm, v_spec_id, true, v_today, v_member_id)
  on conflict (team_id, name_realm_key) do update
     set team_member_id = excluded.team_member_id,
         class_spec_id = coalesce(excluded.class_spec_id, players.class_spec_id),
         -- Back from the archive: a new stint, on trial and without the flags an
         -- officer set for the last one, like any new add.
         is_trial = case when players.archived_at is not null then excluded.is_trial else players.is_trial end,
         join_date = case when players.archived_at is not null then excluded.join_date else players.join_date end,
         -- The backup flags add_signup_to_roster() resets, plus the two
         -- grants an officer made to whoever held the character before.
         is_backup_tank = case when players.archived_at is not null then false else players.is_backup_tank end,
         is_backup_healer = case when players.archived_at is not null then false else players.is_backup_healer end,
         wishlist_allowed = case when players.archived_at is not null then false else players.wishlist_allowed end,
         bis_allowed = case when players.archived_at is not null then false else players.bis_allowed end,
         archived_at = null
   -- Never take over a character that belongs to someone else, active or
   -- archived; the same guard claim_character() applies, on the write itself.
   where players.team_member_id is null or players.team_member_id = excluded.team_member_id
  returning id into v_player_id;

  if v_player_id is null then
    raise exception '% is already claimed', v_character.name_realm;
  end if;

  -- The caller is a raider, so write_audit_log()'s officer gate would refuse
  -- them; this is one of the RPCs that writes its own row.
  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (v_team_id, v_uid, 'Joined via Invite Link', 'players', v_player_id, to_jsonb(v_character.name_realm));

  return 'joined';
end;
$function$;

comment on function public.team_invite_link_join(text, bigint) is
  'Joins the signed-in person to the team behind a live invite code with the character they picked, named by its Battle.net id and resolved from public.characters so it is one their own account holds (#1319). Adds their team_members row (their guild membership) and puts the character on the roster, un-archiving either one if they had left (#1355); a returning officer or team leader comes back as a raider. Refuses a dead code, a person with no Discord, a character that is not on their account, and one someone else holds. Always ''joined'' until the character limit (#1259) exists (#1264).';

-- A team leader could delete a membership directly, skipping
-- admin_revoke_team_role()'s check and everything archive_team_member() now
-- does. Ending one goes through that function, or a team leader's direct
-- edit of archived_at, which the update policy below allows both ways; direct
-- writes stay to insert (a new membership) and update (role changes, and
-- archive_team_member's own writes, which run as this function's definer and so
-- aren't gated by this policy at all).
drop policy "Team leaders write team_members" on public.team_members;

create policy "Team leaders insert team_members" on public.team_members
  for insert to public with check (
    team_id = any ((select public.my_leader_team_ids())::integer[])
    or (select public.is_site_admin())
  );

create policy "Team leaders update team_members" on public.team_members
  for update to public
  using (
    team_id = any ((select public.my_leader_team_ids())::integer[])
    or (select public.is_site_admin())
  )
  with check (
    team_id = any ((select public.my_leader_team_ids())::integer[])
    or (select public.is_site_admin())
  );

-- Officer-only: someone left. Archives the membership and their active
-- characters rather than deleting the row (#1355, Rex's review) -- deleting
-- it would null every archived character's team_member_id too
-- (players.team_member_id is ON DELETE SET NULL), losing who an archived
-- character's history belonged to and freeing its name for the next Battle.net
-- import to revive as theirs. Records why they left the way archive_player()
-- does (#476), on each character it archives. Idempotent -- archiving twice
-- does nothing the second time.
create function public.archive_team_member(
  p_team_id integer,
  p_team_member_id integer,
  p_reason text,
  p_detail text
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_team_id integer;
  v_role text;
  v_archived_at timestamptz;
  v_player_ids integer[];
begin
  if not (
    p_team_id = any (public.my_officer_team_ids())
    or public.is_guild_officer()
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  -- The same six player_officer_notes.archived_reason accepts.
  if p_reason is null or p_reason not in
     ('schedule_conflict', 'performance', 'drama', 'moved_guilds', 'switching_mains', 'other') then
    raise exception 'That is not one of the reasons a membership can be archived for';
  end if;

  -- Locked, so two archives of the same person cannot both pass the
  -- already-archived check below.
  select team_id, role, archived_at into v_team_id, v_role, v_archived_at
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
     and not (coalesce(public.my_team_role(p_team_id) = 'team_leader', false) or public.is_site_admin()) then
    raise exception 'Only the team leader or a site admin can archive an officer';
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
$$;

comment on function public.archive_team_member(integer, integer, text, text) is
  'Officer-only: archives a team_members row for someone who left (#1355), and their active characters with it, rather than deleting either -- players.team_member_id is ON DELETE SET NULL, so a delete would sever an archived character''s history and free it for the next Battle.net import to claim as theirs (Rex''s review, 2026-09-28). Records the reason (one of the six archive_player() takes) and the detail on each character it archives, and in the audit entry with the archived character ids. An officer''s membership is archived only by the team leader or a site admin, the team leader''s only by a site admin. A second archive does nothing. team_invite_link_join() clears archived_at if they come back.';

revoke all on function public.archive_team_member(integer, integer, text, text) from public;
revoke execute on function public.archive_team_member(integer, integer, text, text) from anon;
grant execute on function public.archive_team_member(integer, integer, text, text) to authenticated;
