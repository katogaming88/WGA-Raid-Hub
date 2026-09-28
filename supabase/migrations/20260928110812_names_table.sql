-- #1355: a roster row's display label, separate from its membership.
--
-- team_members carries a required person_id (#942), so it cannot represent
-- someone who hasn't signed in yet, and an officer had no way to pre-list a
-- raider before they exist as an account. names bridges that: a label an
-- officer can create bare (team_member_id null), that a raider later claims
-- (self-service, claim_name) or an officer assigns (a plain table write,
-- assign is not a distinct action from rename/remove -- all three are just
-- updates to this table). team_members itself never gets created or merged
-- as part of claiming -- only names churns.
--
-- The "joined, but hasn't claimed a Name" pool isn't tracked here: it's just
-- team_members rows for a team with no names row pointing at them yet.
--
-- Shape reviewed by Rex on the issue (2026-09-28) before this shipped, and
-- built the way he laid it out: unique (team_id, label) so claiming is
-- picking an unambiguous row off a list, unique team_member_id (a plain
-- unique index admits any number of nulls, so bare Names still coexist) so
-- one membership holds at most one Name, and a names row survives its
-- membership being archived (archive_team_member, below) on purpose -- a
-- departed raider's history keeps its label.

create table public.names (
  id integer generated always as identity primary key,
  team_id integer not null references public.teams (id) on delete cascade,
  label text not null check (btrim(label) <> ''),
  -- Cascades rather than nulling: the only path that still deletes a
  -- team_members row outright (admin_revoke_team_role(), when nobody's
  -- characters point at it any more) has nothing left worth keeping a bare
  -- Name around for.
  team_member_id integer unique references public.team_members (id) on delete cascade,
  -- The raid role an officer expects this Name to fill, so a bare row can sit
  -- on the roster under the right tab before anyone has a character. Ignored
  -- once claimed: the real role comes from the claimed character's spec.
  role text check (role in ('Tank', 'Heal', 'Melee', 'Ranged')),
  created_at timestamptz not null default now()
);

-- Claiming means picking a label off a list, so two Names sharing one on a
-- team is the wrong-claim risk this whole design exists to avoid. Also
-- serves the roster's read-by-team.
create unique index names_team_id_label_key on public.names (team_id, lower(btrim(label)));

comment on table public.names is
  'A team roster row''s display label (#1355), independent of team_members: bare (team_member_id null, officer-created), or claimed once linked to a real membership. Claiming/assigning/unclaiming only ever updates this row -- team_members is never created or merged as part of it, and a names row outlives its membership being archived.';
comment on column public.names.label is
  'The display name shown until claimed. Survives Remove claim (the label goes back to bare) and the membership being archived (archive_team_member) -- unique per team, case- and whitespace-insensitive, since claiming is picking one off a list.';
comment on column public.names.team_member_id is
  'Null for a bare, unclaimed Name. Set by self-service claim (claim_name) or an officer''s direct assign/remove-claim table write. Unique: one Name per membership.';
comment on column public.names.role is
  'The raid role (Tank/Heal/Melee/Ranged) an officer expects this bare Name to fill, so it can sit on the roster under that tab before it has a character. Meaningless once claimed -- a claimed row''s role comes from its character''s class_spec_id instead, never from here.';

-- A names row has to point at a membership on its own team; nothing else
-- enforced that, and an officer's client picking from the wrong team's
-- unclaimed-members pool would otherwise silently cross teams.
create function public.names_team_member_same_team() returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_member_team_id integer;
begin
  if new.team_member_id is null then
    return new;
  end if;
  select team_id into v_member_team_id from public.team_members where id = new.team_member_id;
  if v_member_team_id is null or v_member_team_id <> new.team_id then
    raise exception 'That membership is not on this team';
  end if;
  return new;
end;
$$;

create trigger names_check_team_member_same_team
  before insert or update of team_member_id on public.names
  for each row execute function public.names_team_member_same_team();

alter table public.names enable row level security;

create policy "Claude readers read names" on public.names
  for select to claude_readers using (true);

create policy "Public read names" on public.names
  for select to public using (true);

create policy "Officers write names" on public.names
  for all to public using (
    team_id = any ((select public.my_officer_team_ids())::integer[])
    or (select public.is_guild_officer())
    or (select public.is_site_admin())
  )
  with check (
    team_id = any ((select public.my_officer_team_ids())::integer[])
    or (select public.is_guild_officer())
    or (select public.is_site_admin())
  );

-- Self-service claim: generalizes claim_character()'s self-pick pattern to a
-- names row instead of a players row, and to no-BattleTag-required matching
-- (nothing is typed; the raider just picks their row). Un-archives the
-- caller's own membership if this is their second stint on the team, the
-- same idea team_invite_link_join() applies on the join side (#1355).
create function public.claim_name(p_team_id integer, p_name_id integer) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_member_id integer;
  v_discord_id text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select tm.id into v_member_id
    from public.team_members tm
   where tm.team_id = p_team_id and tm.person_id = public.my_person_id();

  if v_member_id is null then
    v_discord_id := public.current_discord_id();
    if v_discord_id is null then
      raise exception 'This account has no Discord identity to claim with';
    end if;
    insert into public.team_members (team_id, discord_id, role)
    values (p_team_id, v_discord_id, 'raider')
    returning id into v_member_id;
  else
    update public.team_members set archived_at = null where id = v_member_id and archived_at is not null;
  end if;

  update public.names
     set team_member_id = v_member_id
   where id = p_name_id and team_id = p_team_id and team_member_id is null;

  if not found then
    raise exception 'That Name is not available to claim';
  end if;
end;
$$;

comment on function public.claim_name(integer, integer) is
  'Self-service claim of a bare or joined-unclaimed Name (#1355): links the caller''s own team_members row (creating it from their Discord identity if this is their first claim on the team, the same as claim_character(); un-archiving it if they''d left) to the picked names row. Refuses a Name that is already claimed.';

revoke all on function public.claim_name(integer, integer) from public;
revoke execute on function public.claim_name(integer, integer) from anon;
grant execute on function public.claim_name(integer, integer) to authenticated;

-- Officer-only: someone left. Archives the membership and their active
-- characters rather than deleting the row (#1355, Rex's review) -- deleting
-- it would null every archived character's team_member_id too
-- (players.team_member_id is ON DELETE SET NULL), losing who an archived
-- character's history belonged to and freeing its name for the next Battle.net
-- import to revive as theirs. The names row is untouched: it survives an
-- archived membership on purpose, so a departed raider's history keeps its
-- label. Idempotent -- archiving twice does nothing the second time.
create function public.archive_team_member(p_team_id integer, p_team_member_id integer) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_team_id integer;
begin
  if not (
    p_team_id = any (public.my_officer_team_ids())
    or public.is_guild_officer()
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  select team_id into v_team_id from public.team_members where id = p_team_member_id;
  if v_team_id is null or v_team_id <> p_team_id then
    raise exception 'That membership is not on this team';
  end if;

  -- Logged before the archive, not after: write_audit_log() re-checks the
  -- caller's own officer status live, and an officer archiving their own
  -- membership would otherwise fail that check the instant their own row
  -- says archived_at is not null, aborting the archive it just did.
  perform public.write_audit_log(p_team_id, 'team_member_archived', 'team_member', p_team_member_id);

  update public.team_members set archived_at = now() where id = p_team_member_id and archived_at is null;
  update public.players set archived_at = now() where team_member_id = p_team_member_id and archived_at is null;
end;
$$;

comment on function public.archive_team_member(integer, integer) is
  'Officer-only: archives a team_members row for someone who left (#1355), and their active characters with it, rather than deleting either -- players.team_member_id is ON DELETE SET NULL, so a delete would sever an archived character''s history and free it for the next Battle.net import to claim as theirs (Rex''s review, 2026-09-28). The names row that claimed the membership is untouched. team_invite_link_join() clears archived_at if they come back.';

revoke all on function public.archive_team_member(integer, integer) from public;
revoke execute on function public.archive_team_member(integer, integer) from anon;
grant execute on function public.archive_team_member(integer, integer) to authenticated;
