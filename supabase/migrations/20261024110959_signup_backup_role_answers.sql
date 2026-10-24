-- #1622 (part of #1342, blocks #1466): a raider says on their signup whether
-- they can backup tank or backup heal.
--
-- Until now only officers set is_backup_tank and is_backup_healer, from the
-- boxes on the Projected Roster. The raider's two ticks set the same flags
-- (Kat, 2026-10-24): on a new signup and again on every change to one, so an
-- officer's tick stands until the raider changes their signup. A class with
-- no spec in the role always stores false: a Blood Death Knight who ticked
-- backup tank and changes to a Demonology Warlock loses it. A main spec in
-- the role stores false too. is_trial and the officer's note are left alone,
-- and the current site's submit_season_signup() and update_own_signup() do not
-- change.
--
-- The two answers are new trailing arguments, so the old six-argument
-- function is dropped rather than left as a second one. Only the new app,
-- not yet shipping, calls it.

drop function public.declare_season_signup(integer, text, integer, integer, text, text);

create function public.declare_season_signup(
  p_team_id integer,
  p_season text,
  p_character_id integer,
  p_class_spec_id integer,
  p_off_specs text default null,
  p_note text default null,
  p_backup_tank boolean default false,
  p_backup_healer boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_person_id integer := public.my_person_id();
  v_character public.characters%rowtype;
  v_spec_class text;
  v_spec_role text;
  v_backup_tank boolean;
  v_backup_healer boolean;
  v_current text;
  v_swap boolean;
  v_existing public.season_signups%rowtype;
  v_id integer;
begin
  if v_uid is null or v_person_id is null then
    raise exception 'Not signed in';
  end if;

  if not exists (
    select 1 from public.team_seasons ts
     where ts.team_id = p_team_id and ts.season_code = p_season and ts.signups_open
  ) then
    raise exception 'signups are not open for that season on this team';
  end if;

  -- Signups are for the coming tier only and close before it starts (Kat,
  -- 2026-10-23), so a tier already under way is refused even while its
  -- switch is still on, as MID2's is on two teams today.
  if exists (
    select 1 from public.seasons se
     where se.code = p_season
       and se.starts_at <= (now() at time zone 'America/New_York')::date
  ) then
    raise exception 'That season has already started; signups are for the next one';
  end if;

  select * into v_character from public.characters
   where id = p_character_id and person_id = v_person_id;
  if not found then
    raise exception 'That character is not on your account';
  end if;

  select cs.class, cs.role into v_spec_class, v_spec_role from public.classes_specs cs where cs.id = p_class_spec_id;
  if v_spec_class is null then
    raise exception 'Unknown spec';
  end if;
  if v_character.class_name is not null and v_spec_class is distinct from v_character.class_name then
    raise exception '% is a %, not a %', v_character.name, v_character.class_name, v_spec_class;
  end if;

  -- A backup answer holds only for a class with a spec in that role, and not
  -- for someone who mains it: a main tank is not a backup tank. The class is
  -- the character's (the spec's when the character has none on file, which
  -- the check above has then nothing to compare with).
  v_backup_tank := coalesce(p_backup_tank, false)
    and v_spec_role is distinct from 'Tank'
    and exists (
      select 1 from public.classes_specs cs
       where cs.class = coalesce(v_character.class_name, v_spec_class) and cs.role = 'Tank'
    );
  v_backup_healer := coalesce(p_backup_healer, false)
    and v_spec_role is distinct from 'Heal'
    and exists (
      select 1 from public.classes_specs cs
       where cs.class = coalesce(v_character.class_name, v_spec_class) and cs.role = 'Heal'
    );

  -- Their character on this team's roster now, if any. Picking one already
  -- there is not a swap, even when they have a second one on it.
  select p.name_realm into v_current
    from public.players p
    join public.team_members tm on tm.id = p.team_member_id
   where p.team_id = p_team_id
     and p.archived_at is null
     and tm.archived_at is null
     and tm.person_id = v_person_id
   order by p.name_realm_key = v_character.name_realm_key desc, p.id
   limit 1;
  v_swap := v_current is not null and lower(replace(v_current, ' ', '')) <> v_character.name_realm_key;

  -- Their signup for the tier already, by person or, for one the current site
  -- took, by account. An added one first, so it is never passed over; then
  -- their own declared one, so an older current-site row turned back from
  -- rejected never takes its place and trips the one-per-person index.
  select * into v_existing
    from public.season_signups s
   where s.team_id = p_team_id
     and s.season = p_season
     and s.status <> 'rejected'
     and (s.person_id = v_person_id or (s.person_id is null and s.auth_user_id = v_uid))
   order by s.status = 'added' desc, s.person_id is not null desc, s.id
   limit 1
     for update;

  if found and v_existing.status = 'added' then
    raise exception 'You are already on this season''s roster for this team. Ask one of its officers to change your signup.';
  end if;

  if found then
    update public.season_signups
       set person_id = v_person_id,
           character_id = v_character.id,
           auth_user_id = v_uid,
           signup_name_realm = v_character.name_realm,
           class_spec_id = case when v_swap then null else p_class_spec_id end,
           main_swap = v_swap,
           swap_class_spec_id = case when v_swap then p_class_spec_id end,
           swap_from_name_realm = case when v_swap then v_current end,
           off_specs = nullif(btrim(p_off_specs), ''),
           player_note = nullif(btrim(p_note), ''),
           is_backup_tank = v_backup_tank,
           is_backup_healer = v_backup_healer,
           status = 'pending',
           submitted_at = now(),
           reviewed_at = null,
           reviewed_by = null
     where id = v_existing.id
    returning id into v_id;
    return v_id;
  end if;

  -- None yet. The unique index settles two first signups racing each other:
  -- the second replaces the first, as a later signup would.
  insert into public.season_signups (
    team_id, season, person_id, character_id, auth_user_id, signup_name_realm,
    class_spec_id, main_swap, swap_class_spec_id, swap_from_name_realm,
    off_specs, player_note, is_backup_tank, is_backup_healer, status
  )
  values (
    p_team_id, p_season, v_person_id, v_character.id, v_uid, v_character.name_realm,
    case when v_swap then null else p_class_spec_id end, v_swap,
    case when v_swap then p_class_spec_id end, case when v_swap then v_current end,
    nullif(btrim(p_off_specs), ''), nullif(btrim(p_note), ''), v_backup_tank, v_backup_healer, 'pending'
  )
  on conflict (person_id, team_id, season) where status <> 'rejected' do update
     set character_id = excluded.character_id,
         signup_name_realm = excluded.signup_name_realm,
         class_spec_id = excluded.class_spec_id,
         main_swap = excluded.main_swap,
         swap_class_spec_id = excluded.swap_class_spec_id,
         swap_from_name_realm = excluded.swap_from_name_realm,
         off_specs = excluded.off_specs,
         player_note = excluded.player_note,
         is_backup_tank = excluded.is_backup_tank,
         is_backup_healer = excluded.is_backup_healer,
         submitted_at = now()
   where season_signups.status <> 'added'
  returning id into v_id;

  if v_id is null then
    raise exception 'You are already on this season''s roster for this team. Ask one of its officers to change your signup.';
  end if;
  return v_id;
end;
$$;

revoke all on function public.declare_season_signup(integer, text, integer, integer, text, text, boolean, boolean) from public, anon;
grant execute on function public.declare_season_signup(integer, text, integer, integer, text, text, boolean, boolean) to authenticated;

comment on column public.season_signups.is_backup_tank is
  'Backup tank: the raider''s answer on their signup (#1622) or the officer''s box on the Projected Roster (#1342), whichever came last; applied when signups close (#1467).';
comment on column public.season_signups.is_backup_healer is
  'Backup healer: the raider''s answer on their signup (#1622) or the officer''s box on the Projected Roster (#1342), whichever came last; applied when signups close (#1467).';
