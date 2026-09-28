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
-- archive_team_member() (this migration's companion change to the names
-- table, #1355) sets it and archives the person's active characters instead
-- of deleting the row; team_invite_link_join() clears it when they come
-- back. A names row survives an ended membership on purpose, so a departed
-- raider's history keeps its label.
--
-- Timestamped one second before this branch's names table migration
-- (20260928110812), which defines archive_team_member() and needs this
-- column to exist first. Neither has shipped, so the order is free to pick.

alter table public.team_members add column archived_at timestamptz;

comment on column public.team_members.archived_at is
  'Set when an officer archives this membership (archive_team_member, #1355) for someone who left -- never deleted, so a Name and the account''s history keep pointing at something. Cleared by team_invite_link_join() if they come back. Every "what is this person on this team" predicate (my_team_role, my_officer_team_ids, my_leader_team_ids, is_any_team_officer, is_team_leader_anywhere) skips an archived row; my_player_ids() and earlier_characters() still read it, since that is the history.';

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
-- this design: a returning raider's insert now conflicts on their own
-- (archived) row instead of silently doing nothing, and picks it back up.
-- Always returning an id from the insert drops the old select-fallback.
create or replace function public.team_invite_link_join(
  p_code text,
  p_blizzard_id bigint
)
returns text
language plpgsql security definer set search_path to 'public'
as $$
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

  v_discord_id := public.current_discord_id();
  if v_discord_id is null then
    raise exception 'Connect Discord before joining a team';
  end if;

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

  insert into public.team_members (team_id, discord_id, role)
  values (v_team_id, v_discord_id, 'raider')
  on conflict (team_id, person_id) do update set archived_at = null
  returning id into v_member_id;

  insert into public.players (team_id, name_realm, class_spec_id, is_trial, join_date, team_member_id)
  values (v_team_id, v_character.name_realm, v_spec_id, true, v_today, v_member_id)
  on conflict (team_id, name_realm_key) do update
     set team_member_id = excluded.team_member_id,
         class_spec_id = coalesce(excluded.class_spec_id, players.class_spec_id),
         is_trial = case when players.archived_at is not null then excluded.is_trial else players.is_trial end,
         join_date = case when players.archived_at is not null then excluded.join_date else players.join_date end,
         is_backup_tank = case when players.archived_at is not null then false else players.is_backup_tank end,
         is_backup_healer = case when players.archived_at is not null then false else players.is_backup_healer end,
         wishlist_allowed = case when players.archived_at is not null then false else players.wishlist_allowed end,
         bis_allowed = case when players.archived_at is not null then false else players.bis_allowed end,
         archived_at = null
   where players.team_member_id is null or players.team_member_id = excluded.team_member_id
  returning id into v_player_id;

  if v_player_id is null then
    raise exception '% is already claimed', v_character.name_realm;
  end if;

  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (v_team_id, v_uid, 'Joined via Invite Link', 'players', v_player_id, to_jsonb(v_character.name_realm));

  return 'joined';
end;
$$;

comment on function public.team_invite_link_join(text, bigint) is
  'Joins the signed-in person to the team behind a live invite code with the character they picked, named by its Battle.net id and resolved from public.characters so it is one their own account holds (#1319). Adds their team_members row (their guild membership) and puts the character on the roster, un-archiving either one if they had left (#1355). Refuses a dead code, a person with no Discord, a character that is not on their account, and one someone else holds. Always ''joined'' until the character limit (#1259) exists (#1264).';

-- A team leader could delete a membership directly, skipping
-- admin_revoke_team_role()'s check and everything archive_team_member() now
-- does. Ending one goes through that function only; direct writes stay to
-- insert (a new membership) and update (role changes, and archive_team_member's
-- own writes, which run as this function's definer and so aren't gated by
-- this policy at all).
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
