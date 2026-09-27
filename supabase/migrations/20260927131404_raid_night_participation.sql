-- #1242: who actually showed up for each boss on a raid night, boss by boss,
-- next to raid_night_lineups' plan for the same night.
--
-- Once a night has a per-boss lineup (#1216), "on time" moves from the first
-- pull of the whole raid to a raider's own first assigned boss -- someone
-- planned out of boss 1 and in from boss 2 is not late for showing up at
-- boss 2. wcl-sync already reads Warcraft Logs fight by fight to answer that;
-- this table is where it keeps what it read, so a later report can compare
-- the plan (raid_night_lineups) against what actually happened, boss by
-- boss, for a raider or for the team. Read-only for now (#1242's own scope
-- is attendance status, not a report built on this).
--
-- One row per raider actually present for a real pull of that boss, same
-- shape as raid_night_lineups (which is one row per raider planned for it).
-- A boss with a lineup but nobody logged in for it (skipped, or the team
-- never pulled) simply has no rows, same as an unfilled lineup. Written only
-- by record_raid_night_participation(), called from wcl-sync's attendance
-- refresh; nothing else writes here.

create table "public"."raid_night_participation" (
    "id" integer generated always as identity primary key,
    "team_id" integer not null,
    "raid_date" date not null,
    "encounter_id" integer not null,
    "player_id" integer not null references "public"."players"("id") on delete cascade,
    "created_at" timestamp with time zone not null default now(),
    unique ("team_id", "raid_date", "encounter_id", "player_id"),
    foreign key ("team_id", "raid_date", "encounter_id")
      references "public"."raid_night_bosses" ("team_id", "raid_date", "encounter_id") on delete cascade
);

create index "raid_night_participation_player_id_idx" on "public"."raid_night_participation" ("player_id");

comment on table "public"."raid_night_participation" is
  'Who was actually in for a real pull of one boss on one raid night (#1242), one row per raider present. Written only by record_raid_night_participation(), called from the attendance sync once a night has a lineup (raid_night_bosses). Compare against raid_night_lineups for planned-vs-actual.';

create trigger "trg_raid_night_participation_team_id_check"
  before insert or update on "public"."raid_night_participation"
  for each row execute function "public"."check_team_id_matches_player"();

alter table "public"."raid_night_participation" owner to "postgres";
alter table "public"."raid_night_participation" enable row level security;

create policy "Claude readers read raid_night_participation" on "public"."raid_night_participation"
    for select to "claude_readers" using (true);
create policy "Officers read raid_night_participation" on "public"."raid_night_participation" for select
    using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_guild_officer()) OR (SELECT is_site_admin())));
create policy "Team raiders read raid_night_participation" on "public"."raid_night_participation" for select
    using ((team_id IN (SELECT p.team_id FROM players p WHERE p.id = ANY ((SELECT my_active_player_ids())::integer[]))));

-- Replaces one boss's actual-participation rows for one raid night. Called
-- once per boss per report by the attendance sync, with the caller's own
-- officer session (wcl-sync forwards the JWT, same as every other write in
-- this file's family) -- same admission as set_raid_night_lineup(). A no-op,
-- not an error, when the boss isn't on the night's list at all (skipped
-- entirely, or a report from before the team planned lineups): there is
-- nothing to attach the rows to, and a whole sync run should not fail over
-- one boss with no plan.
create or replace function "public"."record_raid_night_participation"(
    "p_team_id" integer,
    "p_raid_date" date,
    "p_encounter_id" integer,
    "p_player_ids" integer[]
) returns integer
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

  if not exists (
    select 1 from raid_night_bosses
    where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id
  ) then
    return 0;
  end if;

  perform public.check_lineup_players(p_team_id, p_player_ids);

  delete from raid_night_participation
  where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id;
  insert into raid_night_participation (team_id, raid_date, encounter_id, player_id)
  select p_team_id, p_raid_date, p_encounter_id, x from unnest(p_player_ids) x;

  return cardinality(p_player_ids);
end;
$$;

alter function "public"."record_raid_night_participation"(integer, date, integer, integer[]) owner to "postgres";

comment on function "public"."record_raid_night_participation"(integer, date, integer, integer[]) is
  'Replaces one boss''s actual-participation rows for a raid night (#1242), for the team''s officers and leader, guild officers and site admins. A no-op returning 0 when the boss is not on the night''s list. Refuses archived raiders and other teams'' raiders (check_lineup_players). Called from wcl-sync''s attendance refresh, not directly by any page.';

revoke all on function "public"."record_raid_night_participation"(integer, date, integer, integer[]) from public, anon;
grant execute on function "public"."record_raid_night_participation"(integer, date, integer, integer[]) to authenticated;
