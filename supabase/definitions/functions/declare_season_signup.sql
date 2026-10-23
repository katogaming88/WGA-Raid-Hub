-- Function public.declare_season_signup: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.declare_season_signup(p_team_id integer, p_season text, p_character_id integer, p_class_spec_id integer, p_off_specs text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_person_id integer := public.my_person_id();
  v_character public.characters%rowtype;
  v_spec_class text;
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

  select cs.class into v_spec_class from public.classes_specs cs where cs.id = p_class_spec_id;
  if v_spec_class is null then
    raise exception 'Unknown spec';
  end if;
  if v_character.class_name is not null and v_spec_class is distinct from v_character.class_name then
    raise exception '% is a %, not a %', v_character.name, v_character.class_name, v_spec_class;
  end if;

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
    off_specs, player_note, status
  )
  values (
    p_team_id, p_season, v_person_id, v_character.id, v_uid, v_character.name_realm,
    case when v_swap then null else p_class_spec_id end, v_swap,
    case when v_swap then p_class_spec_id end, case when v_swap then v_current end,
    nullif(btrim(p_off_specs), ''), nullif(btrim(p_note), ''), 'pending'
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
         submitted_at = now()
   where season_signups.status <> 'added'
  returning id into v_id;

  if v_id is null then
    raise exception 'You are already on this season''s roster for this team. Ask one of its officers to change your signup.';
  end if;
  return v_id;
end;
$function$;
