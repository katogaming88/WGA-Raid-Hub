-- #1355: a roster row's display label, separate from team_members so it can
-- exist bare (officer-created, no account yet) before someone claims it.
--
-- team_members carries a required person_id (#942), so it cannot represent
-- someone who hasn't signed in yet, and an officer had no way to pre-list a
-- raider before they exist as an account. names bridges that: a label an
-- officer can create bare (team_member_id null), that a raider later claims
-- (self-service, claim_name) or an officer assigns (a plain table write --
-- assign is not a distinct action from rename/remove, all three are just
-- updates to this table). Claiming never merges memberships: a raider's first
-- claim on a team creates their team_members row from their Discord identity,
-- as claim_character() does, and every other claim only updates names.
--
-- The "joined, but hasn't claimed a Name" pool isn't tracked here: it's just
-- a team_members row with no names row pointing at it yet.
--
-- Shape reviewed by Rex on the issue (2026-09-28): unique (team_id, label)
-- so claiming is picking an unambiguous row off a list, unique
-- team_member_id (a plain unique index admits any number of nulls, so bare
-- Names still coexist) so one membership holds at most one Name, and a
-- names row survives its membership being archived (archive_team_member(),
-- #1423, already on main) on purpose -- a departed raider's history keeps
-- its label. Cascades on delete rather than nulling: the only path that
-- still deletes a team_members row outright (admin_revoke_team_role(), when
-- nobody's characters point at it any more) has nothing left worth keeping
-- a bare Name around for.

create table public.names (
  id integer generated always as identity primary key,
  team_id integer not null references public.teams (id) on delete cascade,
  label text not null check (btrim(label) <> ''),
  team_member_id integer unique references public.team_members (id) on delete cascade,
  -- The raid role an officer expects this Name to fill, so a bare row can sit
  -- on the roster under the right tab before it has a character. Ignored
  -- once claimed: the real role comes from the claimed character's spec.
  role text check (role in ('Tank', 'Heal', 'Melee', 'Ranged')),
  created_at timestamp with time zone not null default now()
);

-- Claiming means picking a label off a list, so two Names sharing one on a
-- team is the wrong-claim risk this whole design exists to avoid. Also
-- serves the roster's read-by-team.
create unique index names_team_id_label_key on public.names (team_id, lower(btrim(label)));

comment on table public.names is
  'A team roster row''s display label (#1355), independent of team_members: bare (team_member_id null, officer-created), or claimed once linked to a real membership. Claiming, assigning and unclaiming update this row; a raider''s first claim on a team also creates their membership (claim_name), and nothing merges memberships. A names row outlives its membership being archived.';
comment on column public.names.label is
  'The display name shown until claimed. Survives Remove claim (the label goes back to bare) and the membership being archived -- unique per team, case- and whitespace-insensitive, since claiming is picking one off a list.';
comment on column public.names.team_member_id is
  'Null for a bare, unclaimed Name. Set by self-service claim (claim_name) or an officer''s direct assign/remove-claim table write. Unique: one Name per membership.';
comment on column public.names.role is
  'The raid role (Tank/Heal/Melee/Ranged) an officer expects this bare Name to fill, so it can sit on the roster under that tab before it has a character. Meaningless once claimed -- a claimed row''s role comes from its character''s class_spec_id instead, never from here.';

-- A names row has to point at a membership on its own team; nothing else
-- enforced that, and an officer's client picking from the wrong team's
-- unclaimed-members pool would otherwise silently cross teams. It runs on
-- every write, so moving a claimed Name by its team_id alone is checked too.
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
  before insert or update on public.names
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
-- (nothing is typed; the raider just picks their row). Refuses on an
-- archived membership, the same rule claim_character() and
-- link_battlenet_roster_characters() apply (#1401, #1355 decided
-- 2026-10-02): coming back is an officer's call, not self-service.
create function public.claim_name(p_team_id integer, p_name_id integer) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_member_id integer;
  v_member_archived_at timestamp with time zone;
  v_discord_id text;
  v_label text;
  v_membership_created boolean := false;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  -- The Name first, so a wrong team or Name creates no membership. No lock:
  -- the update below is what decides a race for the same Name.
  perform 1 from public.names
   where id = p_name_id and team_id = p_team_id and team_member_id is null;
  if not found then
    raise exception 'That Name is not available to claim';
  end if;

  -- for share, as in claim_character(): archive_team_member() locks this row
  -- first, so the check and the link land wholly before or after an archive.
  select tm.id, tm.archived_at into v_member_id, v_member_archived_at
    from public.team_members tm
   where tm.team_id = p_team_id and tm.person_id = public.my_person_id()
     for share;

  if v_member_archived_at is not null then
    raise exception 'Your membership on this team has ended. Ask one of its officers to add you back.';
  end if;

  if v_member_id is null then
    v_discord_id := public.current_discord_id();
    if v_discord_id is null then
      raise exception 'This account has no Discord identity to claim with';
    end if;
    insert into public.team_members (team_id, discord_id, role)
    values (p_team_id, v_discord_id, 'raider')
    returning id into v_member_id;
    v_membership_created := true;
  end if;

  -- One membership holds one Name (team_member_id is unique), so a second
  -- claim by the same person stops here, in words.
  begin
    update public.names
       set team_member_id = v_member_id
     where id = p_name_id and team_id = p_team_id and team_member_id is null
    returning label into v_label;
  exception when unique_violation then
    raise exception 'You already have a Name on this team. Ask an officer if it needs changing.';
  end;

  if not found then
    raise exception 'That Name is not available to claim';
  end if;

  -- Its own row, since write_audit_log() refuses a raider, the same way
  -- team_invite_link_join() logs a join.
  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Name Claimed', 'names', p_name_id,
          jsonb_build_object('label', v_label, 'team_member_id', v_member_id,
                             'membership_created', v_membership_created));
end;
$$;

comment on function public.claim_name(integer, integer) is
  'Self-service claim of a bare Name (#1355): links the caller''s own team_members row (creating it from their Discord identity if this is their first claim on the team, the same as claim_character()) to the picked names row. Checks the Name before anything is written, refuses a Name that is already claimed or a second Name for the same membership, and refuses on the caller''s own archived membership (#1401) -- coming back takes an officer, not a claim. Writes its own Name Claimed audit row, since write_audit_log() refuses a raider.';

revoke all on function public.claim_name(integer, integer) from public;
revoke execute on function public.claim_name(integer, integer) from anon;
grant execute on function public.claim_name(integer, integer) to authenticated;
