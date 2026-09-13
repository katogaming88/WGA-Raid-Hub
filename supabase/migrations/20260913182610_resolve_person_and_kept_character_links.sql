-- #941: resolve_person(), a normalised name_realm key, and the person link kept
-- on archived characters.
--
-- There is no person row yet (#942). "Who is this" is spread over
-- team_members, site_admins, guild_officers and boe_managers (keyed on
-- discord_id) and players (keyed on name_realm, linked to a person through the
-- single slot players.team_member_id). Measured on production 2026-09-05 and
-- re-measured 2026-09-13, three defects follow from that:
--
--   1. A main swap destroyed the link. add_signup_to_roster() nulled
--      team_member_id on the character it archived, so anything that later
--      walks from that character to a person finds no one. Eight BoE finds
--      point at such a character, which is why resolve_boe_finder_discord_id()
--      step 2 (player -> team_member -> discord_id) resolved none of them.
--   2. name_realm is not normalised. Area 52 / Area52, Borean Tundra /
--      BoreanTundra and Earthen Ring / EarthenRing all exist, and two people
--      forked into two Phoenix rows each (Fxd, Adrestia). The loot import has
--      matched ignoring case and spaces since #320's stubs, but nothing stops
--      a second row being inserted.
--   3. players.team_member_id has no index.
--
-- This migration:
--
--   a. merges the existing spacing duplicates into one row each,
--   b. adds players.name_realm_key (lower case, spaces removed) with a unique
--      index per team, so a variant spelling collides instead of forking,
--   c. relinks the eight finds' archived characters to their people (Kat,
--      2026-09-13, below),
--   d. keeps the link on archive in add_signup_to_roster(), and makes its
--      revive path replace a link that belongs to someone other than the
--      person signing up,
--   e. adds the archived filter to is_own_player(), the one person-to-character
--      reader in the database that lacked it, now that a person can own an
--      archived row,
--   f. adds resolve_person(), and the index on team_member_id.
--
-- It also teaches the raider self-update guard on players to ignore the new
-- generated column (see b).
--
-- The client readers that embed a person's characters (js/discord.js
-- findClaimElsewhere, js/guild.js, js/roster.js) filter archived rows in the
-- same change.

-- a. Merge spacing duplicates.
--
-- Each group of rows on one team that share a normalised name keeps one
-- survivor: an active row first, then a linked row, then the lowest id. On
-- production both groups are an archived officer-entered row (7, 8) and an
-- archived stub the loot import made before it matched ignoring spaces (166,
-- 167); the stubs carry three rclc_loot rows and their import audit entries,
-- and nothing else.
--
-- Only the tables that can hold a stub's rows without a uniqueness clash are
-- moved. For every other table that references players, a row on a merged-away
-- character stops the migration rather than being moved or cascaded away:
-- a clash there needs a person to decide which row wins.

create temporary table player_merge as
select p.id as loser_id, s.id as survivor_id
  from public.players p
  cross join lateral (
    select s.id
      from public.players s
     where s.team_id = p.team_id
       and lower(replace(s.name_realm, ' ', '')) = lower(replace(p.name_realm, ' ', ''))
     order by (s.archived_at is null) desc, (s.team_member_id is not null) desc, s.id
     limit 1
  ) s
 where s.id <> p.id;

do $$
begin
  if exists (
    select 1
      from player_merge m
      join public.players p on p.id = m.loser_id
     where p.archived_at is null or p.team_member_id is not null
  ) then
    raise exception 'A spacing duplicate to merge is active or linked to a person; reconcile it by hand first';
  end if;

  if exists (select 1 from public.attendance x join player_merge m on m.loser_id = x.player_id)
     or exists (select 1 from public.scoring x join player_merge m on m.loser_id = x.player_id)
     or exists (select 1 from public.bis_items x join player_merge m on m.loser_id = x.player_id)
     or exists (select 1 from public.priority_order x join player_merge m on m.loser_id = x.player_id)
     or exists (select 1 from public.item_preferences x join player_merge m on m.loser_id = x.player_id)
     or exists (select 1 from public.player_wcl_season_perf x join player_merge m on m.loser_id = x.player_id)
     or exists (select 1 from public.player_equipped_gear x join player_merge m on m.loser_id = x.player_id)
     or exists (select 1 from public.player_officer_notes x join player_merge m on m.loser_id = x.player_id)
     or exists (select 1 from public.streamers x join player_merge m on m.loser_id = x.player_id)
     or exists (select 1 from public.notifications x join player_merge m on m.loser_id = x.player_id)
     or exists (select 1 from public.mplus_exclusion_requests x join player_merge m on m.loser_id = x.player_id)
     or exists (select 1 from public.priority_conflict_dismissals x join player_merge m on m.loser_id = x.player_id)
     or exists (select 1 from public.priority_stale_dismissals x join player_merge m on m.loser_id = x.player_id)
     or exists (select 1 from public.raid_rsvps x join player_merge m on m.loser_id = x.player_id)
     or exists (select 1 from public.raid_rsvp_reminders_sent x join player_merge m on m.loser_id = x.player_id)
  then
    raise exception 'A spacing duplicate to merge has rows that cannot be moved safely; reconcile it by hand first';
  end if;
end $$;

update public.rclc_loot x set player_id = m.survivor_id from player_merge m where x.player_id = m.loser_id;
update public.boe_items x set player_id = m.survivor_id from player_merge m where x.player_id = m.loser_id;
update public.bis_requests x set player_id = m.survivor_id from player_merge m where x.player_id = m.loser_id;
update public.self_received_requests x set player_id = m.survivor_id from player_merge m where x.player_id = m.loser_id;
update public.season_signups x set approved_player_id = m.survivor_id from player_merge m where x.approved_player_id = m.loser_id;
-- audit_log.target_id has no FK, so a deleted target would read "Unknown"
-- forever rather than fail.
update public.audit_log x set target_id = m.survivor_id
  from player_merge m
 where x.target_id = m.loser_id and x.target_type = 'players';

delete from public.players p using player_merge m where p.id = m.loser_id;

drop table player_merge;

-- b. The normalised key.
--
-- Case and spaces only, the same rule import_rclc_loot() already matches on:
-- RCLootCouncil strips the spaces from a multi-word realm and officers type
-- them. The stored name_realm keeps whatever spelling it was entered with.

alter table public.players
  add column name_realm_key text generated always as (lower(replace(name_realm, ' ', ''))) stored;

comment on column public.players.name_realm_key is
  'name_realm in lower case with spaces removed, so "Fxd-Area 52" and "fxd-Area52" are one character (#941). Unique per team.';

create unique index players_team_id_name_realm_key_key on public.players (team_id, name_realm_key);

create index players_team_member_id_idx on public.players (team_member_id);

-- The raider self-update guard compares the whole row before and after, less
-- the one column a raider may change. A stored generated column is not yet
-- computed when a BEFORE trigger sees NEW, so name_realm_key reads null there
-- and every raider's bonus-roll update would look like a change to it. It
-- cannot be written directly anyway, so the guard ignores it.
create or replace function public.restrict_players_self_update_to_bonus_roll() returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if coalesce(public.my_team_role(new.team_id) = any (array['officer', 'team_leader']), false)
     or public.is_guild_officer()
     or public.is_site_admin()
  then
    return new;
  end if;

  if (to_jsonb(new) - 'bonus_roll_encounter_id' - 'updated_at' - 'name_realm_key')
     is distinct from (to_jsonb(old) - 'bonus_roll_encounter_id' - 'updated_at' - 'name_realm_key') then
    raise exception 'Raiders may only update bonus_roll_encounter_id on their own player row';
  end if;
  return new;
end $$;

-- c. Relink the archived characters behind the unresolved BoE finds.
--
-- Nothing recorded who they belonged to (the swap nulled the link and the
-- audit log has no main-swap target), so Kat named each one on 2026-09-13.
-- Each is linked to the person who holds that player's current Phoenix
-- character. A name that does not exist, or a current character with no link,
-- updates nothing, so this is a no-op on a local stack.

update public.players arch
   set team_member_id = cur.team_member_id
  from (values
         ('Fluphie-Stormrage', 'Fluffyfistz-Stormrage'),
         ('Razuvious-Thrall', 'Torbjorn-Tichondrius'),
         ('Xyorill-Area52', 'Neldreth-Area 52'),
         ('Inquizical-Tichondrius', 'Soulcialist-Tichondrius'),
         ('Flamess-Tichondrius', 'Flamè-Tichondrius')
       ) as v (archived_name, current_name)
  join public.teams t on t.slug = 'phoenix'
  join public.players cur on cur.team_id = t.id and cur.name_realm = v.current_name and cur.team_member_id is not null
 where arch.team_id = t.id
   and arch.name_realm = v.archived_name
   and arch.archived_at is not null
   and arch.team_member_id is null;

-- d. add_signup_to_roster(): keep the link on archive, and fix the revive.
--
-- Two changes to the previous body, nothing else:
--
--   * The swap archives the old character without nulling team_member_id, so
--     the person stays reachable from its history.
--   * A signup whose name matches an archived row revives that row. Now that
--     archived rows keep their link, the revived row may still name its
--     previous holder. When the signing account belongs to someone else on
--     this team, the link moves to them. When the signup has no account (19
--     of 76 on production are like that), the link is left alone: a re-signing
--     returning raider is far more common than a reused character name.
--
-- The conflict target is the normalised key, so a signup spelled "Area52"
-- revives an archived "Area 52" row instead of failing on the new index.

create or replace function public.add_signup_to_roster(
  p_signup_id integer,
  p_is_trial boolean default true,
  p_archive_player_id integer default null::integer,
  p_is_backup_tank boolean default false,
  p_is_backup_healer boolean default false
)
returns integer
language plpgsql
set search_path to 'public'
as $$
declare
  v_signup public.season_signups%rowtype;
  v_player_id integer;
  v_archived_team_member_id integer;
  v_archived_join_date date;
  v_today date := (now() at time zone 'America/New_York')::date;
  v_live_season text;
  v_prior_archived_at timestamptz;
  v_prior_team_member_id integer;
  v_signer_member_id integer;
begin
  select * into v_signup from public.season_signups
   where id = p_signup_id for update;
  if not found then
    raise exception 'signup % not found', p_signup_id;
  end if;
  if v_signup.status is distinct from 'approved' then
    raise exception 'signup % is not in approved status (is %)',
      p_signup_id, v_signup.status;
  end if;

  select p.archived_at, p.team_member_id
    into v_prior_archived_at, v_prior_team_member_id
    from public.players p
   where p.team_id = v_signup.team_id
     and p.name_realm_key = lower(replace(v_signup.signup_name_realm, ' ', ''));

  if v_signup.auth_user_id is not null then
    select tm.id into v_signer_member_id
      from public.team_members tm
     where tm.team_id = v_signup.team_id and tm.auth_user_id = v_signup.auth_user_id;
  end if;

  insert into public.players (
    team_id, name_realm, class_spec_id, is_trial, join_date,
    is_backup_tank, is_backup_healer
  )
  values (v_signup.team_id, v_signup.signup_name_realm,
          coalesce(v_signup.swap_class_spec_id, v_signup.class_spec_id),
          p_is_trial, v_today,
          p_is_backup_tank, p_is_backup_healer)
  on conflict (team_id, name_realm_key) do update
    set class_spec_id = excluded.class_spec_id,
        is_trial  = case when players.archived_at is not null
                         then excluded.is_trial else players.is_trial end,
        join_date = case when players.archived_at is not null
                         then excluded.join_date else players.join_date end,
        is_backup_tank = case when players.archived_at is not null
                         then excluded.is_backup_tank else players.is_backup_tank end,
        is_backup_healer = case when players.archived_at is not null
                         then excluded.is_backup_healer else players.is_backup_healer end,
        archived_at = null
  returning id into v_player_id;

  -- A revived row still linked to a different person moves to the signer.
  if v_prior_archived_at is not null
     and v_prior_team_member_id is not null
     and v_signer_member_id is not null
     and v_prior_team_member_id <> v_signer_member_id then
    update public.players set team_member_id = v_signer_member_id
     where id = v_player_id;
  end if;

  if p_archive_player_id is not null then
    select team_member_id, join_date
      into v_archived_team_member_id, v_archived_join_date
      from public.players
     where id = p_archive_player_id and team_id = v_signup.team_id;

    -- The link stays on the archived character (#941): its attendance, loot
    -- and BoE finds still belong to this person.
    update public.players set archived_at = now()
     where id = p_archive_player_id and team_id = v_signup.team_id;

    if v_archived_team_member_id is not null then
      update public.players set team_member_id = v_archived_team_member_id
       where id = v_player_id and team_member_id is null;
    end if;

    -- Only overwrite when the new row is still on today's (local) date. That
    -- covers both the plain-insert path above AND a reactivated same-name-
    -- realm alt: the on-conflict branch already refreshes a reactivated
    -- archived character's join_date to today too (same as it refreshes
    -- is_trial), so there's no "alt's own original date" being protected
    -- here either way -- landing the swapped-from date on top of that
    -- today's-date keeps "main swap = continuation of tenure" true even
    -- when the destination is a known alt, not just a brand-new character.
    if v_archived_join_date is not null then
      update public.players set join_date = v_archived_join_date
       where id = v_player_id and join_date = v_today;
    end if;

    -- Carry attendance history to the new character. Skip any raid_date
    -- the new (destination) player already has its own row for -- that
    -- only happens on a reactivated-alt swap where the alt has independent
    -- attendance, and the unique (team_id, player_id, raid_date)
    -- constraint would otherwise abort the whole swap.
    update public.attendance a set player_id = v_player_id
     where a.player_id = p_archive_player_id
       and a.team_id = v_signup.team_id
       and not exists (
         select 1 from public.attendance b
          where b.team_id = v_signup.team_id
            and b.player_id = v_player_id
            and b.raid_date = a.raid_date
       );

    -- Drop the archived character's standing priority_order rows for the
    -- live season only, same as remove_player_priority_order() -- they no
    -- longer belong on the roster, so they shouldn't keep occupying a slot
    -- in the Priority tab, RCLootCouncil export, or addon panel.
    select regexp_replace(ts.config ->> 'seasonName', '^Midnight Season (\d+)$', 'MID\1')
      into v_live_season
      from public.team_settings ts
     where ts.team_id = v_signup.team_id;

    if v_live_season is not null then
      delete from public.priority_order
       where team_id = v_signup.team_id
         and season = v_live_season
         and player_id = p_archive_player_id;
    end if;
  end if;

  update public.season_signups
     set status = 'added', approved_player_id = v_player_id
   where id = p_signup_id;

  return v_player_id;
end $$;

-- e. is_own_player(): the signed-in person's own *active* character.
--
-- Every raider-own-row rule goes through this (wishlists, BiS obtained flags,
-- streamer, notifications, self-received, RSVPs, BoE reads, the bonus roll
-- target). Before #941 an archived character had no link, so it never
-- matched; keeping the link must not quietly hand a raider write access to a
-- retired character's wishlist.

create or replace function public.is_own_player(p_player_id integer)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from players p
    join team_members tm on tm.id = p.team_member_id
    where p.id = p_player_id
      and p.archived_at is null
      and tm.auth_user_id = auth.uid()
  );
$$;

-- f. resolve_person()
--
-- Everything the identity tables know about one Discord account, as one jsonb
-- value, or null when the account appears in none of them: the account id,
-- the three guild-wide grants, and per team the membership and its characters
-- (archived ones included, newest activity first). This is the question #486
-- asks, and what #942's people table will answer with a row.
--
-- Security definer, because team_members, site_admins and guild_officers are
-- not readable across people. Who sees what:
--   * the person themself, a site admin, or a guild officer: everything,
--     except that the site_admin and guild_officer flags are shown only to the
--     person and to site admins, matching who can read those two tables;
--   * an officer or team leader: only the teams they run, plus the BoE manager
--     flag (boe_managers is readable by any officer);
--   * anyone else: refused.

create or replace function public.resolve_person(p_discord_id text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_is_self boolean := p_discord_id is not distinct from public.current_discord_id();
  v_is_site_admin boolean := public.is_site_admin();
  v_sees_all_teams boolean;
  v_result jsonb;
begin
  v_sees_all_teams := v_is_self or v_is_site_admin or public.is_guild_officer();

  if not (v_sees_all_teams or public.is_any_team_officer()) then
    raise exception 'Not authorized';
  end if;

  if p_discord_id is null
     or not (
       exists (select 1 from team_members where discord_id = p_discord_id)
       or exists (select 1 from site_admins where discord_id = p_discord_id)
       or exists (select 1 from guild_officers where discord_id = p_discord_id)
       or exists (select 1 from boe_managers where discord_id = p_discord_id)
     ) then
    return null;
  end if;

  select jsonb_build_object(
    'discord_id', p_discord_id,
    'auth_user_id', coalesce(
      (select tm.auth_user_id from team_members tm where tm.discord_id = p_discord_id and tm.auth_user_id is not null limit 1),
      (select sa.auth_user_id from site_admins sa where sa.discord_id = p_discord_id),
      (select go.auth_user_id from guild_officers go where go.discord_id = p_discord_id),
      (select bm.auth_user_id from boe_managers bm where bm.discord_id = p_discord_id)
    ),
    'site_admin', case when v_is_self or v_is_site_admin
                       then exists (select 1 from site_admins where discord_id = p_discord_id) end,
    'guild_officer', case when v_is_self or v_is_site_admin
                          then exists (select 1 from guild_officers where discord_id = p_discord_id) end,
    'boe_manager', exists (select 1 from boe_managers where discord_id = p_discord_id),
    'teams', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'team_id', tm.team_id,
                 'team_member_id', tm.id,
                 'role', tm.role,
                 'characters', coalesce((
                   select jsonb_agg(
                            jsonb_build_object(
                              'player_id', p.id,
                              'name_realm', p.name_realm,
                              'url_code', p.url_code,
                              'archived_at', p.archived_at
                            )
                            order by p.archived_at desc nulls first, p.name_realm
                          )
                     from players p
                    where p.team_member_id = tm.id
                 ), '[]'::jsonb)
               )
               order by tm.team_id
             )
        from team_members tm
       where tm.discord_id = p_discord_id
         and (v_sees_all_teams or public.my_team_role(tm.team_id) = any (array['officer', 'team_leader']))
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

comment on function public.resolve_person(text) is
  'Everything the identity tables know about one Discord account: grants, and per team the membership and its characters, archived included (#941). Null when unknown.';

revoke all on function public.resolve_person(text) from public, anon;
grant execute on function public.resolve_person(text) to authenticated;
