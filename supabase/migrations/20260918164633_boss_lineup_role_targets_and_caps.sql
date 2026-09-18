-- #1244: the boss lineup's per-boss cap and per-team role targets come from
-- data, with today's numbers as the default.
--
-- Two gaps the review of #1231/#1232 raised and Kat's own comment on #1244
-- sharpened. First: the grid checks every boss on a Mythic raid against 20 and
-- a mini raid against 25 (app/src/calendar/lineup.ts's MYTHIC_CAP and
-- MINI_RAID_CAP), read off raid_zones.is_mini_raid. Nymrissa Wavecaller and
-- Kith'ix are flex bosses inside The Venomous Abyss that allow 25 on Mythic
-- while the raid's other eight bosses allow 20, and WCL lists all ten under
-- one zone, so a cap that lives on the zone can never say that -- both grids
-- read a 24-raider group on those two bosses as "4 over" when it is fine. The
-- cap has to live on the boss. Second: the tanks-wanted and healers-wanted
-- counts "Needs a look" checks against (TANKS_WANTED = 2, HEALERS_WANTED = 4)
-- are typed into the same file, the same way the caps were, with the same
-- problem: a team that wants a different mix has no way to say so.
--
-- Shape, matching Kat's comment: a nullable cap on raid_encounters, null
-- meaning "use the raid's own cap" (today's is_mini_raid rule, unchanged), set
-- per boss rather than per raid or per zone. Role targets are a team's own
-- call, not shared reference data like the bosses are, so they get their own
-- small table keyed by team rather than a column anywhere: team_lineup_settings,
-- one row per team, absent meaning today's 2 tanks / 4 healers (the app treats
-- a missing row as that default, so nothing is seeded here for the four
-- existing teams).
--
-- Neither write goes through the tables directly. raid_encounters is shared
-- across every team (one row per zone/season, upserted by
-- wcl-progression-sync for whichever team syncs first), so editing a boss's
-- cap is a guild-wide action, gated the way other guild-wide writes are
-- (is_guild_officer() or is_site_admin()), not a per-team officer check --
-- there is no team to check it against. Role targets are per-team, gated the
-- same way set_boss_group() is: the team's own officers and leader, or a
-- guild officer or site admin.
--
-- Buff list unification (the third piece #1244 named) is not in this
-- migration -- see the issue for why it's tracked separately.

alter table "public"."raid_encounters"
  add column "cap" integer;

alter table "public"."raid_encounters"
  add constraint "raid_encounters_cap_check" check (cap is null or (cap > 0 and cap <= 30));

comment on column "public"."raid_encounters"."cap" is
  'A raider cap for this one boss, overriding the raid''s own (20 Mythic, 25 mini raid via raid_zones.is_mini_raid). Null for every boss except a flex fight like Nymrissa Wavecaller or Kith''ix (#1244). Set by set_encounter_cap(); wcl-progression-sync''s upsert never includes this column, so a sync run cannot clear it.';

-- Guild-wide, so a per-team officer check has nothing to check against: gated
-- the same way other guild-wide reference writes are, is_guild_officer() or
-- is_site_admin(). p_cap null clears the override back to the raid's own cap.
create or replace function "public"."set_encounter_cap"(
    "p_encounter_id" integer,
    "p_cap" integer default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not (public.is_guild_officer() or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  if not exists (select 1 from raid_encounters where id = p_encounter_id) then
    raise exception 'That boss is not in the raid list yet.';
  end if;

  if p_cap is not null and (p_cap <= 0 or p_cap > 30) then
    raise exception 'A boss cap has to be between 1 and 30.';
  end if;

  update raid_encounters set cap = p_cap where id = p_encounter_id;

  perform public.write_audit_log(null, 'Set Boss Cap', 'raid_encounters', p_encounter_id, jsonb_build_object('cap', p_cap));
end;
$$;

alter function "public"."set_encounter_cap"(integer, integer) owner to "postgres";
revoke all on function "public"."set_encounter_cap"(integer, integer) from public, anon;
grant execute on function "public"."set_encounter_cap"(integer, integer) to authenticated;

comment on function "public"."set_encounter_cap"(integer, integer) is
  'Sets, or (null) clears, one boss''s raider cap override (#1244), for guild officers and site admins -- raid_encounters is shared across every team, so there is no per-team officer to check against.';

-- One row per team; a team with no row here uses today's defaults (2 tanks, 4
-- healers), which is why nothing is seeded for the teams that already exist.
create table "public"."team_lineup_settings" (
    "team_id" integer primary key references "public"."teams"("id") on delete cascade,
    "tanks_wanted" integer not null default 2 check (tanks_wanted >= 0 and tanks_wanted <= 20),
    "healers_wanted" integer not null default 4 check (healers_wanted >= 0 and healers_wanted <= 20),
    "updated_at" timestamp with time zone not null default now()
);

comment on table "public"."team_lineup_settings" is
  'A team''s own tanks-wanted and healers-wanted counts for the boss lineup''s "Needs a look" check (#1244), defaulting to 2 and 4 when a team has no row. Written only by set_lineup_role_targets().';

alter table "public"."team_lineup_settings" owner to "postgres";
alter table "public"."team_lineup_settings" enable row level security;

create policy "Claude readers read team_lineup_settings" on "public"."team_lineup_settings"
    for select to "claude_readers" using (true);
-- Not secret, and read on every load of the two lineup grids (#1216); public
-- read matches team_settings' own "Public read settings" policy.
create policy "Public read team_lineup_settings" on "public"."team_lineup_settings"
    for select using (true);

-- Same gate as set_boss_group(): the team's own officers and leader, a guild
-- officer, or a site admin. Upserts, since a team's first edit has no row yet.
create or replace function "public"."set_lineup_role_targets"(
    "p_team_id" integer,
    "p_tanks" integer,
    "p_healers" integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not (
    coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false)
    or public.is_guild_officer()
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if p_tanks < 0 or p_tanks > 20 or p_healers < 0 or p_healers > 20 then
    raise exception 'Role targets have to be between 0 and 20.';
  end if;

  insert into team_lineup_settings (team_id, tanks_wanted, healers_wanted, updated_at)
  values (p_team_id, p_tanks, p_healers, now())
  on conflict (team_id) do update set tanks_wanted = excluded.tanks_wanted, healers_wanted = excluded.healers_wanted, updated_at = excluded.updated_at;

  perform public.write_audit_log(
    p_team_id,
    'Set Lineup Role Targets',
    'team_lineup_settings',
    p_team_id,
    jsonb_build_object('tanks_wanted', p_tanks, 'healers_wanted', p_healers)
  );
end;
$$;

alter function "public"."set_lineup_role_targets"(integer, integer, integer) owner to "postgres";
revoke all on function "public"."set_lineup_role_targets"(integer, integer, integer) from public, anon;
grant execute on function "public"."set_lineup_role_targets"(integer, integer, integer) to authenticated;

comment on function "public"."set_lineup_role_targets"(integer, integer, integer) is
  'Sets a team''s tanks-wanted and healers-wanted counts for the boss lineup (#1244), for the team''s officers and leader, guild officers and site admins.';
