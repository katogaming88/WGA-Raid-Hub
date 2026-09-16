-- #942 step 5 (part c), #631: a raider asks to make one of their alts their
-- main, any day of the season.
--
-- Until now the only main swap was a field on a season signup, so it existed
-- only while a signup window was open. A raider who rerolled mid-tier (the
-- Grihzold -> Grihzy case on #631) had no way to ask for one.
--
-- Kat's calls (2026-09-16):
--   - A raider asks; an officer approves. Never a self-service roster write.
--   - They ask with a character they already listed as an alt (#942 step 5b),
--     so Blizzard's own character list is the proof they own it.
--   - Approving does what a main swap at signup already does: the new
--     character joins the roster (or comes back, if they played it before),
--     the old one leaves it but keeps its loot and raid history, and the join
--     date and attendance move across. The "every character stays on the books
--     with a Main tick" idea from #631 waits until just before cutover
--     (#1105), so the current site keeps working unchanged until then.
--
-- The swap steps below are add_signup_to_roster()'s, minus the signup: same
-- on-conflict revival, same join-date carry, same attendance move, same
-- priority_order clear, same two audit lines.

create table public.main_swap_requests (
  id integer generated always as identity primary key,
  team_id integer not null references public.teams (id) on delete cascade,
  person_id integer not null references public.people (id) on delete cascade,
  -- The character they are on now, and the one they want to be on. The
  -- character row can go (a raider re-picks their alts), so the name is kept
  -- here rather than read back through it.
  from_player_id integer not null references public.players (id) on delete cascade,
  character_id integer references public.characters (id) on delete set null,
  name_realm text not null,
  class_spec_id integer references public.classes_specs (id) on update cascade,
  note text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'declined', 'cancelled')),
  requested_at timestamp with time zone not null default now(),
  reviewed_at timestamp with time zone,
  reviewed_by integer references public.people (id),
  officer_note text,
  approved_player_id integer references public.players (id)
);

comment on table public.main_swap_requests is
  'A raider''s request to make one of their alts their roster character, outside a signup window (#631, #942 step 5c). Written only by request_main_swap(), cancel_main_swap_request() and review_main_swap_request(). name_realm and class_spec_id are what they asked for, kept here so the request still reads right after the character row changes.';

comment on column public.main_swap_requests.from_player_id is
  'Their roster character when they asked. The one that gets archived on approval.';

comment on column public.main_swap_requests.approved_player_id is
  'The roster row the approval landed on: the revived character, or the new one.';

create index main_swap_requests_team_pending_idx
  on public.main_swap_requests (team_id) where status = 'pending';
create index main_swap_requests_person_idx on public.main_swap_requests (person_id);

-- One open request per person per team. A second ask is refused by name in
-- request_main_swap(); this is the same rule as a database fact.
create unique index main_swap_requests_one_pending
  on public.main_swap_requests (team_id, person_id) where status = 'pending';

alter table public.main_swap_requests enable row level security;

create policy "Raiders read own main swap requests" on public.main_swap_requests
  for select using (person_id = (select public.my_person_id()));

create policy "Officers read main swap requests on their teams" on public.main_swap_requests
  for select using (
    team_id = any ((select public.my_officer_team_ids())::integer[])
    or (select public.is_site_admin())
    or (select public.is_guild_officer())
  );

create policy "Claude readers read main swap requests" on public.main_swap_requests
  for select to claude_readers using (true);

grant select on table public.main_swap_requests to authenticated;
grant select on table public.main_swap_requests to claude_readers;

-- Ask for a main swap.
--
-- p_character_id is one of the caller's own characters (#942 step 5b), which
-- is what makes this safe to run for the caller: the Battle.net list put it
-- there, so nobody can ask to be moved onto someone else's character.
-- p_class_spec_id is the spec they intend to raid, which is not always the
-- spec Blizzard last saw them in, so the raider picks it.
create or replace function public.request_main_swap(
  p_team_id integer,
  p_character_id integer,
  p_class_spec_id integer,
  p_note text default null
) returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_person_id integer := public.my_person_id();
  v_character public.characters%rowtype;
  v_from_player_id integer;
  v_spec_class text;
  v_request_id integer;
begin
  if v_person_id is null then
    raise exception 'Not signed in';
  end if;

  select * into v_character from public.characters
   where id = p_character_id and person_id = v_person_id;
  if not found then
    raise exception 'That character is not on your account';
  end if;

  select p.id into v_from_player_id
    from public.players p
    join public.team_members tm on tm.id = p.team_member_id
   where p.team_id = p_team_id
     and p.archived_at is null
     and tm.person_id = v_person_id
   order by p.id
   limit 1;
  if v_from_player_id is null then
    raise exception 'You have no character on this team''s roster';
  end if;

  if exists (
    select 1 from public.players p
     where p.team_id = p_team_id
       and p.archived_at is null
       and p.name_realm_key = v_character.name_realm_key
  ) then
    raise exception '% is already on this roster', v_character.name_realm;
  end if;

  select cs.class into v_spec_class from public.classes_specs cs where cs.id = p_class_spec_id;
  if v_spec_class is null then
    raise exception 'Unknown spec';
  end if;
  if v_character.class_name is not null and v_spec_class is distinct from v_character.class_name then
    raise exception '% is a %, not a %', v_character.name, v_character.class_name, v_spec_class;
  end if;

  if exists (
    select 1 from public.main_swap_requests r
     where r.team_id = p_team_id and r.person_id = v_person_id and r.status = 'pending'
  ) then
    raise exception 'You already have a main swap waiting for an officer';
  end if;

  insert into public.main_swap_requests (
    team_id, person_id, from_player_id, character_id, name_realm, class_spec_id, note
  )
  values (
    p_team_id, v_person_id, v_from_player_id, p_character_id,
    v_character.name_realm, p_class_spec_id, nullif(btrim(p_note), '')
  )
  returning id into v_request_id;

  return v_request_id;
end;
$function$;

revoke all on function public.request_main_swap(integer, integer, integer, text) from public, anon;
grant execute on function public.request_main_swap(integer, integer, integer, text) to authenticated;

-- Take it back, while it is still waiting.
create or replace function public.cancel_main_swap_request(p_request_id integer) returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_person_id integer := public.my_person_id();
begin
  if v_person_id is null then
    raise exception 'Not signed in';
  end if;

  update public.main_swap_requests
     set status = 'cancelled', reviewed_at = now()
   where id = p_request_id
     and person_id = v_person_id
     and status = 'pending';

  if not found then
    raise exception 'No main swap of yours is waiting';
  end if;
end;
$function$;

revoke all on function public.cancel_main_swap_request(integer) from public, anon;
grant execute on function public.cancel_main_swap_request(integer) to authenticated;

-- An officer approves or declines it. Approving runs the swap.
--
-- Returns the roster row the raider ends up on when approved, null when
-- declined.
create or replace function public.review_main_swap_request(
  p_request_id integer,
  p_approve boolean,
  p_note text default null
) returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_request public.main_swap_requests%rowtype;
  v_from public.players%rowtype;
  v_player_id integer;
  v_live_season text;
  v_spec_label text;
  v_note text := nullif(btrim(p_note), '');
begin
  select * into v_request from public.main_swap_requests where id = p_request_id for update;
  if not found then
    raise exception 'No main swap with id %', p_request_id;
  end if;

  if not (coalesce(public.my_team_role(v_request.team_id) = any (array['officer', 'team_leader']), false)
          or public.is_guild_officer()
          or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  if v_request.status is distinct from 'pending' then
    raise exception 'That main swap was already %', v_request.status;
  end if;

  select * into v_from from public.players where id = v_request.from_player_id;

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

  if v_from.archived_at is not null then
    raise exception '% is no longer on the roster', v_from.name_realm;
  end if;

  -- The character joins the roster, or comes back to it. Same on-conflict
  -- shape as add_signup_to_roster(): a character they played before keeps its
  -- id, so its loot and raid history stay attached to it.
  insert into public.players (
    team_id, name_realm, class_spec_id, is_trial, join_date, is_backup_tank, is_backup_healer, team_member_id
  )
  values (
    v_request.team_id, v_request.name_realm, v_request.class_spec_id, v_from.is_trial, v_from.join_date,
    v_from.is_backup_tank, v_from.is_backup_healer, v_from.team_member_id
  )
  on conflict (team_id, name_realm_key) do update
    set class_spec_id = excluded.class_spec_id,
        is_trial = excluded.is_trial,
        join_date = excluded.join_date,
        is_backup_tank = excluded.is_backup_tank,
        is_backup_healer = excluded.is_backup_healer,
        team_member_id = coalesce(players.team_member_id, excluded.team_member_id),
        archived_at = null
  returning id into v_player_id;

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

  -- The old character's standing priority rows for the live season go, the
  -- same as removing them from the roster would: they no longer hold a slot
  -- in the Priority List, the RCLootCouncil export or the addon panel.
  select regexp_replace(ts.config ->> 'seasonName', '^Midnight Season (\d+)$', 'MID\1')
    into v_live_season
    from public.team_settings ts
   where ts.team_id = v_request.team_id;

  if v_live_season is not null then
    delete from public.priority_order
     where team_id = v_request.team_id
       and season = v_live_season
       and player_id = v_request.from_player_id;
  end if;

  update public.main_swap_requests
     set status = 'approved', reviewed_at = now(), reviewed_by = public.my_person_id(),
         officer_note = v_note, approved_player_id = v_player_id
   where id = p_request_id;

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

revoke all on function public.review_main_swap_request(integer, boolean, text) from public, anon;
grant execute on function public.review_main_swap_request(integer, boolean, text) to authenticated;
