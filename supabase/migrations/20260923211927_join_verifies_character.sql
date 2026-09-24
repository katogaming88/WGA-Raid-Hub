-- #1319: the invite-link join takes the character from the caller's own
-- Battle.net account, not from what they type.
--
-- team_invite_link_join() (#1264, 20260923132616) took the character as plain
-- text. The join page only offers characters it read from the person's own
-- Battle.net account, and that read is verified against the account the token
-- belongs to, but the database function is a public endpoint: a call made
-- anywhere other than that page was not held to the same list. Anyone holding
-- a live invite link could join as any character name they typed.
--
-- The sharpest version is a character that was archived when a raider left.
-- Removing their membership row clears the character's link to them
-- (players.team_member_id is ON DELETE SET NULL), so nothing records whose it
-- was, and the join brought it back onto the roster under whoever typed the
-- name, carrying its attendance, loot and BoE history. claim_character() and
-- link_battlenet_roster_characters() both refuse archived rows, so this
-- function was the only path that could do that.
--
-- The fix is the shape request_main_swap() already uses: the caller names a
-- character they hold rather than describing one. public.characters is written
-- only by save_battlenet_characters(), only from the battlenet-characters Edge
-- Function, which holds the person's own Battle.net token, so a row there is a
-- confirmed fact about who holds what. The join page saves the picked
-- character before it joins, and passes its Battle.net id.
--
-- Both writes stop being select-then-insert. The roster row becomes one upsert
-- on (team_id, name_realm_key) with the holder guard in the update's own
-- condition, as add_signup_to_roster() and review_main_swap_request() do, and
-- the membership insert arbitrates on (team_id, person_id). The old form
-- locked nothing when no row matched, so two joins racing each other both
-- reached the insert and the second surfaced a unique index as a raw
-- duplicate-key error instead of the refusal or the join.

drop function if exists public.team_invite_link_join(text, text, text, text, text);

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
  -- checked, so it can arbitrate on it. do nothing rather than do update,
  -- since there is nothing to change on a membership that already exists and
  -- an update would touch its updated_at.
  insert into public.team_members (team_id, discord_id, role)
  values (v_team_id, v_discord_id, 'raider')
  on conflict (team_id, person_id) do nothing
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
$$;

comment on function public.team_invite_link_join(text, bigint) is
  'Joins the signed-in person to the team behind a live invite code with the character they picked, named by its Battle.net id and resolved from public.characters so it is one their own account holds (#1319). Adds their team_members row (their guild membership) and puts the character on the roster. Refuses a dead code, a person with no Discord, a character that is not on their account, and one someone else holds. Always ''joined'' until the character limit (#1259) exists (#1264).';

revoke all on function public.team_invite_link_join(text, bigint) from public;
revoke execute on function public.team_invite_link_join(text, bigint) from anon;
grant execute on function public.team_invite_link_join(text, bigint) to authenticated;
