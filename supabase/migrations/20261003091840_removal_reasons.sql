-- #1427: every reason a character or a membership was removed for is kept,
-- one row each.
--
-- A character's reason lived only on its player_officer_notes row, which
-- holds the latest one: the Roster tab's re-add cleared it, and a later
-- removal wrote over it. The audit log keeps a copy for most removals, but it
-- is the record of who did what, written by the Roster tab as a separate call
-- after the removal, not the record of why someone left. A membership's reason
-- (archive_team_member(), #1355) landed only on its characters, so a member
-- with none kept it in the audit log alone.
--
-- removal_reasons is append-only. A character's row is written by a trigger
-- whenever a reason is written onto its notes row, so every path that records
-- one is covered (archive_player(), archive_team_member(), an officer editing
-- the row). A membership's row is written by archive_team_member() itself.
-- Nobody writes the table directly, and a character or membership with a
-- reason on record cannot be deleted on its own.

create table public.removal_reasons (
  id bigint generated always as identity primary key,
  team_id integer not null references public.teams(id) on delete cascade,
  player_id integer references public.players(id),
  team_member_id integer references public.team_members(id),
  removed_at timestamp with time zone not null default now(),
  reason text not null check (reason in ('schedule_conflict', 'performance', 'drama', 'moved_guilds', 'switching_mains', 'other')),
  detail text,
  removed_by integer references public.people(id) on delete set null,
  constraint removal_reasons_about_someone check (player_id is not null or team_member_id is not null)
);

comment on table public.removal_reasons is
  'Every reason a character or a membership was removed for (#1427), one row each, never updated or deleted. A character''s row comes from a trigger on player_officer_notes, a membership''s from archive_team_member(). The notes row still holds the latest reason; this holds all of them.';
comment on column public.removal_reasons.player_id is
  'The character removed. Null on a membership''s own row (archive_team_member()).';
comment on column public.removal_reasons.team_member_id is
  'The membership: the one ended, on a membership''s row, or the one the character was linked to when it was removed.';
comment on column public.removal_reasons.removed_by is
  'The person who removed them, from my_person_id(); null for a write with nobody signed in, and for an audit entry whose account has no person.';

create index removal_reasons_player_id_idx on public.removal_reasons (player_id);
create index removal_reasons_team_member_id_idx on public.removal_reasons (team_member_id);

alter table public.removal_reasons owner to postgres;
alter table public.removal_reasons enable row level security;

create trigger trg_removal_reasons_team_id_check
  before insert or update on public.removal_reasons
  for each row execute function public.check_team_id_matches_player();

create policy "Claude readers read removal_reasons" on public.removal_reasons
  for select to claude_readers using (true);
create policy "Officers read removal_reasons" on public.removal_reasons
  for select using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_guild_officer()) OR (SELECT is_site_admin())));

-- No write policy, and the privileges revoked, so a direct write fails loudly
-- rather than being filtered to nothing.
revoke insert, update, delete on public.removal_reasons from anon, authenticated;

-- Security definer because nobody may write the table directly; it runs on
-- the notes row the caller was already allowed to write.
create function public.record_removal_reason()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.removal_reasons (team_id, player_id, team_member_id, reason, detail, removed_by)
  select new.team_id, new.player_id, p.team_member_id, new.archived_reason, new.archived_reason_detail,
         public.my_person_id()
    from public.players p
   where p.id = new.player_id;
  return null;
end;
$$;

alter function public.record_removal_reason() owner to postgres;
revoke all on function public.record_removal_reason() from public, anon, authenticated;

create trigger player_officer_notes_record_removal_reason
  after insert or update of archived_reason, archived_reason_detail on public.player_officer_notes
  for each row when (new.archived_reason is not null)
  execute function public.record_removal_reason();

CREATE OR REPLACE FUNCTION public.archive_team_member(p_team_id integer, p_team_member_id integer, p_reason text, p_detail text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

-- The reasons already on record: each Roster tab removal since #476 wrote
-- "reason: detail" to its audit entry. The detail is everything after the
-- first ": ", since a detail may hold one of its own.
insert into public.removal_reasons (team_id, player_id, team_member_id, removed_at, reason, detail, removed_by)
select p.team_id, p.id, p.team_member_id, a.created_at,
       split_part(a.detail #>> '{}', ': ', 1),
       nullif(substr(a.detail #>> '{}', length(split_part(a.detail #>> '{}', ': ', 1)) + 3), ''),
       pe.id
  from public.audit_log a
  join public.players p on p.id = a.target_id
  left join public.people pe on pe.auth_user_id = a.actor_id
 where a.action = 'Player Removed'
   and a.target_type = 'players'
   and jsonb_typeof(a.detail) = 'string'
   and split_part(a.detail #>> '{}', ': ', 1) in
       ('schedule_conflict', 'performance', 'drama', 'moved_guilds', 'switching_mains', 'other')
 order by a.id;
