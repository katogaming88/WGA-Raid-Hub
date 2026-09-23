-- #1264: join a team through its invite link, in one step.
--
-- The link is the approval (Kat, 2026-09-19): opening a live /join/<code> link
-- puts the person in the guild and on the team's roster with the character
-- they picked, with no officer in between. Without this, the join page can
-- resolve a code (team_invite_link_resolve) but has nothing to call once the
-- raider picks a character.
--
-- Guild membership is not a row of its own: a person belongs to a guild
-- through a team_members row on one of its teams, so the team_members insert
-- below is the "added to the guild" step.
--
-- The active-character limit (#1259) does not exist yet, so every join lands
-- on the roster and the outcome is always 'joined'. The join page already
-- handles 'waiting'; the limit check goes here when #1259 builds the limit.

create or replace function public.team_invite_link_join(
  p_code text,
  p_name text,
  p_realm text,
  p_class text default null,
  p_spec text default null
)
returns text
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_discord_id text;
  v_team_id integer;
  v_member_id integer;
  v_name_realm text := trim(p_name) || '-' || trim(p_realm);
  v_spec_id integer;
  v_player public.players%rowtype;
  v_player_id integer;
  v_today date := (now() at time zone 'America/New_York')::date;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if trim(coalesce(p_name, '')) = '' or trim(coalesce(p_realm, '')) = '' then
    raise exception 'Pick a character to join with';
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

  select cs.id into v_spec_id
    from public.classes_specs cs
   where cs.class = p_class and cs.spec = p_spec;

  select tm.id into v_member_id
    from public.team_members tm
   where tm.team_id = v_team_id and tm.person_id = public.my_person_id();

  if v_member_id is null then
    -- The trigger resolves the person and its account from the Discord id.
    insert into public.team_members (team_id, discord_id, role)
    values (v_team_id, v_discord_id, 'raider')
    returning id into v_member_id;
  end if;

  select * into v_player
    from public.players p
   where p.team_id = v_team_id
     and p.name_realm_key = lower(replace(v_name_realm, ' ', ''))
     for update;

  if not found then
    insert into public.players (team_id, name_realm, class_spec_id, is_trial, join_date, team_member_id)
    values (v_team_id, v_name_realm, v_spec_id, true, v_today, v_member_id)
    returning id into v_player_id;
  else
    -- Never take over a character that belongs to someone else, active or
    -- archived; the same guard claim_character() applies.
    if v_player.team_member_id is not null and v_player.team_member_id <> v_member_id then
      raise exception '% is already claimed', v_name_realm;
    end if;

    v_player_id := v_player.id;
    update public.players
       set team_member_id = v_member_id,
           class_spec_id = coalesce(v_spec_id, class_spec_id),
           -- Back from the archive: a new stint, on trial like any new add.
           is_trial = case when archived_at is not null then true else is_trial end,
           join_date = case when archived_at is not null then v_today else join_date end,
           archived_at = null
     where id = v_player_id;
  end if;

  -- The caller is a raider, so write_audit_log()'s officer gate would refuse
  -- them; this is one of the RPCs that writes its own row.
  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (v_team_id, v_uid, 'Joined via Invite Link', 'players', v_player_id, to_jsonb(v_name_realm));

  return 'joined';
end;
$$;

comment on function public.team_invite_link_join(text, text, text, text, text) is
  'Joins the signed-in person to the team behind a live invite code with the character they picked: adds their team_members row (their guild membership) and puts the character on the roster. Refuses a dead code, a person with no Discord, and a character someone else holds. Always ''joined'' until the character limit (#1259) exists (#1264).';

revoke all on function public.team_invite_link_join(text, text, text, text, text) from public;
revoke execute on function public.team_invite_link_join(text, text, text, text, text) from anon;
grant execute on function public.team_invite_link_join(text, text, text, text, text) to authenticated;
