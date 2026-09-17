-- #1216: per-boss lineups for a raid night. Officers pick, boss by boss, which
-- raiders sit out; everyone else on the roster is in.
--
-- Kat and Phoenix's officers chose the grid layout (2026-09-17): raiders down
-- the side, the season's bosses across, click a cell to put a raider in or take
-- them out. A night starts with everyone in, and "Copy last week's lineup"
-- brings the previous night's sit-outs forward, so only the sit-outs are
-- stored: a raider who joins the roster later is in by default, and a night
-- nobody planned needs no rows at all.
--
-- Bosses are named, not numbered. They come from Season Settings
-- (team_settings.config.raidProgression), which is a list officers edit by
-- hand with no ids, so a row names its raid and boss as that list spells them.
-- Renaming a boss there leaves earlier nights' rows under the old name, which
-- only matters for nights already played.
--
-- Who reads: the team's raiders (each will see their own bosses on the night
-- page), the team's officers and leader, guild officers and site admins. A
-- sit-out is not guild-wide news, so there is no public read. Nobody writes
-- the table directly: set_boss_lineup() replaces one raid's lineup for a night
-- in one go, so a save never leaves half a lineup behind.

create table "public"."boss_lineup_sitouts" (
    "id" serial primary key,
    "team_id" integer not null references "public"."teams"("id") on delete cascade,
    "raid_date" date not null,
    "raid_name" text not null,
    "boss_name" text not null,
    "player_id" integer not null references "public"."players"("id") on delete cascade,
    "created_at" timestamp with time zone not null default now(),
    unique ("team_id", "raid_date", "raid_name", "boss_name", "player_id")
);

create index "boss_lineup_sitouts_player_id_idx" on "public"."boss_lineup_sitouts" ("player_id");

comment on table "public"."boss_lineup_sitouts" is
  'Per-boss lineups for a raid night (#1216): one row per raider an officer sat out for one boss. A raider with no row is in. Raid and boss are named as Season Settings (team_settings.config.raidProgression) spells them. Written only through set_boss_lineup().';

alter table "public"."boss_lineup_sitouts" owner to "postgres";
alter table "public"."boss_lineup_sitouts" enable row level security;

create policy "Claude readers read boss_lineup_sitouts" on "public"."boss_lineup_sitouts"
    for select to "claude_readers" using (true);

create policy "Officers read boss_lineup_sitouts" on "public"."boss_lineup_sitouts" for select
    using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_guild_officer()) OR (SELECT is_site_admin())));

create policy "Team raiders read boss_lineup_sitouts" on "public"."boss_lineup_sitouts" for select
    using ((team_id IN (SELECT p.team_id FROM players p WHERE p.id = ANY ((SELECT my_active_player_ids())::integer[]))));

-- p_sitouts: [{"boss": "Sszorak", "player_id": 12}, ...], the whole raid's
-- sit-outs for the night. An empty array puts everyone back in.
create or replace function "public"."set_boss_lineup"(
    "p_team_id" integer,
    "p_raid_date" date,
    "p_raid_name" text,
    "p_sitouts" jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
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

  if p_raid_date is null or coalesce(trim(p_raid_name), '') = '' then
    raise exception 'Choose a raid night and a raid.';
  end if;

  if p_sitouts is null or jsonb_typeof(p_sitouts) <> 'array' then
    raise exception 'The lineup must be a list of sit-outs.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_sitouts) e
    where coalesce(trim(e->>'boss'), '') = '' or (e->>'player_id') is null
  ) then
    raise exception 'Each sit-out needs a boss and a raider.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_sitouts) e
    left join players p on p.id = (e->>'player_id')::integer and p.team_id = p_team_id
    where p.id is null
  ) then
    raise exception 'Every raider in the lineup must be on this team.';
  end if;

  delete from boss_lineup_sitouts
  where team_id = p_team_id and raid_date = p_raid_date and raid_name = p_raid_name;

  insert into boss_lineup_sitouts (team_id, raid_date, raid_name, boss_name, player_id)
  select distinct p_team_id, p_raid_date, p_raid_name, trim(e->>'boss'), (e->>'player_id')::integer
  from jsonb_array_elements(p_sitouts) e;

  get diagnostics v_count = row_count;

  perform public.write_audit_log(
    p_team_id,
    'Set Boss Lineup',
    'boss_lineup_sitouts',
    null,
    jsonb_build_object('raid_date', p_raid_date, 'raid_name', p_raid_name, 'sitouts', v_count)
  );

  return v_count;
end;
$$;

alter function "public"."set_boss_lineup"(integer, date, text, jsonb) owner to "postgres";

comment on function "public"."set_boss_lineup"(integer, date, text, jsonb) is
  'Replaces one raid''s per-boss sit-outs for a raid night (#1216), for the team''s officers and leader, guild officers and site admins. Returns how many sit-outs were saved.';

revoke all on function "public"."set_boss_lineup"(integer, date, text, jsonb) from public, anon;
grant execute on function "public"."set_boss_lineup"(integer, date, text, jsonb) to authenticated;
