-- #1355: a roster row's display label, separate from its membership.
--
-- team_members carries a required person_id (#942), so it cannot represent
-- someone who hasn't signed in yet, and an officer had no way to pre-list a
-- raider before they exist as an account. names bridges that: a label an
-- officer can create bare (team_member_id null), that a raider later claims
-- (self-service, claim_name) or an officer assigns (a plain table write,
-- assign_name is not a distinct action from rename/remove -- all three are
-- just updates to this table). team_members itself never gets created,
-- merged or deleted as part of claiming -- only names churns; the one place
-- team_members is deleted at all is when an officer removes someone who
-- left, via delete_team_member, which takes the names row for that
-- membership down with it.
--
-- The "joined, but hasn't claimed a Name" pool isn't tracked here: it's just
-- team_members rows for a team with no names row pointing at them yet.

create table public.names (
  id integer generated always as identity primary key,
  team_id integer not null references public.teams (id) on delete cascade,
  label text not null,
  team_member_id integer references public.team_members (id) on delete set null,
  -- The raid role an officer expects this Name to fill, so a bare row can sit
  -- on the roster under the right tab before anyone has a character. Ignored
  -- once claimed: the real role comes from the claimed character's spec.
  role text check (role in ('Tank', 'Heal', 'Melee', 'Ranged')),
  created_at timestamptz not null default now()
);

create index names_team_id_idx on public.names (team_id);

-- One Name can hold a given membership; a claim points at exactly one row.
create unique index names_team_member_id_key on public.names (team_member_id)
  where team_member_id is not null;

comment on table public.names is
  'A team roster row''s display label (#1355), independent of team_members: bare (team_member_id null, officer-created), or claimed once linked to a real membership. Claiming/assigning/unclaiming only ever updates this row -- team_members is never created, merged or deleted as part of it.';
comment on column public.names.label is
  'The display name shown until claimed. Survives Remove claim (the label goes back to bare); does not survive Delete Member (the row is deleted with the membership).';
comment on column public.names.team_member_id is
  'Null for a bare, unclaimed Name. Set by self-service claim (claim_name) or an officer''s direct assign/remove-claim table write.';
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
-- (nothing is typed; the raider just picks their row).
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
  'Self-service claim of a bare or joined-unclaimed Name (#1355): links the caller''s own team_members row (creating it from their Discord identity if this is their first claim on the team, the same as claim_character()) to the picked names row. Refuses a Name that is already claimed.';

revoke all on function public.claim_name(integer, integer) from public;
revoke execute on function public.claim_name(integer, integer) from anon;
grant execute on function public.claim_name(integer, integer) to authenticated;

-- Officer-only: someone left. Takes their names row down with the
-- membership -- a left Name isn't reusable the way a wrong-claim Name is
-- (Remove claim leaves the label behind, bare).
create function public.delete_team_member(p_team_id integer, p_team_member_id integer) returns void
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

  delete from public.names where team_member_id = p_team_member_id;
  delete from public.team_members where id = p_team_member_id;

  perform public.write_audit_log(p_team_id, 'team_member_deleted', 'team_member', p_team_member_id);
end;
$$;

comment on function public.delete_team_member(integer, integer) is
  'Officer-only: removes a team_members row outright for someone who left (#1355), and the names row that claimed it, if any. players.team_member_id already goes to null on its own (existing ON DELETE SET NULL); nothing else references a membership.';

revoke all on function public.delete_team_member(integer, integer) from public;
revoke execute on function public.delete_team_member(integer, integer) from anon;
grant execute on function public.delete_team_member(integer, integer) to authenticated;
