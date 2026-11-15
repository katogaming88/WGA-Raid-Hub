-- #1637: the roster audit's Great Vault (#1261), worked out from the weekly
-- row (character_weeks, #1635) as the game fills it. Three rows of three
-- slots: Raid (2, 4 and 6 bosses), Dungeons (1, 4 and 8 keys) and World (2, 4
-- and 8 delves). A filled slot offers the weakest reward among the runs it
-- counts; an empty one says how many runs are left.
--
-- Season settings, added by migration per season like season_crests:
-- * season_track_steps: each upgrade step's item level (Hero 4/6 is 315).
-- * season_vault_slots: how many runs fill each slot.
-- * season_vault_rewards: what a run offers in the vault: a raid kill by
--   difficulty (and, for a named boss, its own reward), a key by level, a
--   delve by tier, each the floor of a range ("from +10").
-- * season_vault_raids: the raids whose kills count, by Blizzard's journal
--   instance id (the profile API's ids; not the WCL ids raid_encounters holds).
--
-- Midnight Season 2's rows, from Kat's in-game chart (2026-11-15), which
-- agrees with Method's tables once their Hero 4/6 is read as 315:
-- * a raid kill offers one difficulty up (Heroic -> Myth 1/6), and Mythic
--   kills of The Coiled Altar and Ula'tek offer Myth 9/6 (344);
-- * The Venomous Abyss and The Tidebound Grotto count (Kat);
-- * World is delves only: Prey hunts and other world activities are not in
--   Blizzard's API, and the addon (#1440) adds them. Heroic and Mythic 0
--   dungeons, which also fill Dungeon slots, are not in it either.
--
-- character_weeks works out its vault on every write (vault, vault_at). Delves
-- are running totals, so a week's delves are its row less the week before's;
-- unless both were read, the World row is unknown (null). A boss counts once
-- a week, at its best difficulty. The
-- addon's exact vault (#1440), when it arrives, wins over this one.

create table public.season_track_steps (
  season text not null references public.seasons (code),
  track text not null check (track in ('Adventurer', 'Veteran', 'Champion', 'Hero', 'Myth')),
  rank smallint not null check (rank > 0),
  item_level smallint not null check (item_level > 0),
  primary key (season, track, rank)
);

comment on table public.season_track_steps is
  'Each upgrade step''s item level in a season (#1637), e.g. MID2 Hero 4 = 315. Myth 9 is the special step the last Mythic bosses drop. Added by migration.';

create table public.season_vault_slots (
  season text not null references public.seasons (code),
  vault_row text not null check (vault_row in ('raid', 'dungeon', 'world')),
  slot smallint not null check (slot between 1 and 3),
  needs smallint not null check (needs > 0),
  primary key (season, vault_row, slot)
);

comment on table public.season_vault_slots is
  'How many runs fill each Great Vault slot in a season (#1637): raid bosses, keys, or delves. Added by migration.';

create table public.season_vault_rewards (
  season text not null references public.seasons (code),
  vault_row text not null check (vault_row in ('raid', 'dungeon', 'world')),
  difficulty text check (difficulty in ('lfr', 'normal', 'heroic', 'mythic')),
  encounter_id integer check (encounter_id > 0),
  from_level smallint check (from_level > 0),
  track text not null,
  rank smallint not null,
  foreign key (season, track, rank) references public.season_track_steps (season, track, rank),
  constraint season_vault_rewards_key check (
    case vault_row
      when 'raid' then difficulty is not null and from_level is null
      else difficulty is null and encounter_id is null and from_level is not null
    end
  ),
  constraint season_vault_rewards_unique unique nulls not distinct (season, vault_row, difficulty, encounter_id, from_level)
);

comment on table public.season_vault_rewards is
  'What a run offers in the Great Vault in a season (#1637). Raid: by kill difficulty, and encounter_id (Blizzard journal id) for a boss with its own reward. Dungeon: a key from from_level up. World: a delve from tier from_level up. Added by migration.';

create table public.season_vault_raids (
  season text not null references public.seasons (code),
  instance_id integer not null check (instance_id > 0),
  name text not null check (name ~ '\S'),
  primary key (season, instance_id)
);

comment on table public.season_vault_raids is
  'The raids whose kills fill Raid vault slots in a season (#1637), by Blizzard journal instance id. Added by migration.';

alter table public.season_track_steps owner to postgres;
alter table public.season_track_steps enable row level security;
alter table public.season_vault_slots owner to postgres;
alter table public.season_vault_slots enable row level security;
alter table public.season_vault_rewards owner to postgres;
alter table public.season_vault_rewards enable row level security;
alter table public.season_vault_raids owner to postgres;
alter table public.season_vault_raids enable row level security;

-- Reference data, like season_crests: anyone reads, nobody writes but
-- migrations.
create policy "Public read season_track_steps" on public.season_track_steps for select using (true);
create policy "Public read season_vault_slots" on public.season_vault_slots for select using (true);
create policy "Public read season_vault_rewards" on public.season_vault_rewards for select using (true);
create policy "Public read season_vault_raids" on public.season_vault_raids for select using (true);
create policy "Claude readers read season_track_steps" on public.season_track_steps
  for select to claude_readers using (true);
create policy "Claude readers read season_vault_slots" on public.season_vault_slots
  for select to claude_readers using (true);
create policy "Claude readers read season_vault_rewards" on public.season_vault_rewards
  for select to claude_readers using (true);
create policy "Claude readers read season_vault_raids" on public.season_vault_raids
  for select to claude_readers using (true);

revoke all on table public.season_track_steps from public, anon, authenticated, service_role;
grant select on table public.season_track_steps to anon, authenticated, service_role;
revoke all on table public.season_vault_slots from public, anon, authenticated, service_role;
grant select on table public.season_vault_slots to anon, authenticated, service_role;
revoke all on table public.season_vault_rewards from public, anon, authenticated, service_role;
grant select on table public.season_vault_rewards to anon, authenticated, service_role;
revoke all on table public.season_vault_raids from public, anon, authenticated, service_role;
grant select on table public.season_vault_raids to anon, authenticated, service_role;

-- The vault for a week's runs: raid kills and M+ runs as character_weeks
-- holds them, delves as this week's count by tier (null: unknown, which
-- leaves the World row null). Each row is a list of its slots in order.
create function public.season_vault(p_season text, p_raid_kills jsonb, p_mplus_runs jsonb, p_delves jsonb)
returns jsonb
language sql
stable
set search_path = public
as $$
  with kills as (
    select k.* from jsonb_to_recordset(coalesce(p_raid_kills, '[]')) k(encounter_id integer, instance_id integer, difficulty text)
  ),
  -- A boss counts once a week, at its best reward, however many difficulties
  -- it was killed on.
  raid_offers as (
    select distinct on (k.encounter_id) w.track, w.rank
      from kills k
      join season_vault_raids r on r.season = p_season and r.instance_id = k.instance_id
      cross join lateral (
        select w.track, w.rank from season_vault_rewards w
         where w.season = p_season and w.vault_row = 'raid' and w.difficulty = k.difficulty
           and (w.encounter_id is null or w.encounter_id = k.encounter_id)
         order by w.encounter_id nulls last
         limit 1) w
      join season_track_steps t on t.season = p_season and t.track = w.track and t.rank = w.rank
     order by k.encounter_id, t.item_level desc
  ),
  offers as (
    select 'raid' as vault_row, track, rank from raid_offers
    union all
    select 'dungeon', w.track, w.rank
      from jsonb_to_recordset(coalesce(p_mplus_runs, '[]')) m(level integer)
      cross join lateral (
        select w.track, w.rank from season_vault_rewards w
         where w.season = p_season and w.vault_row = 'dungeon' and w.from_level <= m.level
         order by w.from_level desc
         limit 1) w
    union all
    select 'world', w.track, w.rank
      from jsonb_each_text(coalesce(p_delves, '{}')) d(tier, n)
      cross join generate_series(1, greatest(d.n::integer, 0))
      cross join lateral (
        select w.track, w.rank from season_vault_rewards w
         where w.season = p_season and w.vault_row = 'world' and w.from_level <= d.tier::integer
         order by w.from_level desc
         limit 1) w
  ),
  ranked as (
    select o.vault_row, o.track, o.rank, t.item_level,
           row_number() over (partition by o.vault_row order by t.item_level desc, o.rank desc) as pos,
           count(*) over (partition by o.vault_row) as done
      from offers o
      join season_track_steps t on t.season = p_season and t.track = o.track and t.rank = o.rank
  ),
  slots as (
    select s.vault_row, s.slot,
           jsonb_build_object('needs', s.needs, 'done', coalesce(d.done, 0))
           || case when r.pos is not null
                   then jsonb_build_object('track', r.track, 'rank', r.rank, 'item_level', r.item_level)
                   else jsonb_build_object('left', s.needs - coalesce(d.done, 0)) end as slot_json
      from season_vault_slots s
      left join (select distinct vault_row, done from ranked) d on d.vault_row = s.vault_row
      left join ranked r on r.vault_row = s.vault_row and r.pos = s.needs
     where s.season = p_season
  )
  -- Unknown rows are null: World without this week's delves, Raid while any
  -- kill lacks its raid (saved before #1637; the next raids read adds it).
  select coalesce(jsonb_object_agg(vault_row, case
           when vault_row = 'world' and p_delves is null then null
           when vault_row = 'raid' and exists (select 1 from kills where instance_id is null) then null
           else list end), '{}')
    from (select vault_row, jsonb_agg(slot_json order by slot) as list from slots group by vault_row) g;
$$;

comment on function public.season_vault(text, jsonb, jsonb, jsonb) is
  'A week''s Great Vault (#1637) from its raid kills, M+ runs and delves this week by tier (null: unknown, World row null): per row, its slots in order, each {needs, done} plus the weakest counted reward {track, rank, item_level} when filled, or {left} when not.';

revoke all on function public.season_vault(text, jsonb, jsonb, jsonb) from public;
grant execute on function public.season_vault(text, jsonb, jsonb, jsonb) to anon, authenticated, service_role;

-- Every write to a weekly row works out its vault again, from the row and the
-- week before's delves (only that week: a gap leaves the World row unknown
-- rather than counting two weeks' delves as one). Delves count only once
-- read (delves_at set), this week's and the week before's: an unread {} less
-- last week's is not zero delves, and an unread {} as last week's would count
-- every delve the character ever did.
create function public.character_weeks_fill_vault()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_prev jsonb;
  v_delves jsonb;
begin
  select w.delves into v_prev
    from character_weeks w
   where w.name_realm_key = lower(replace(new.name_realm, ' ', '')) and w.week_of = new.week_of - 7
     and w.delves_at is not null;
  if found and new.delves_at is not null then
    select coalesce(jsonb_object_agg(d.key, greatest(d.value::integer - coalesce((v_prev ->> d.key)::integer, 0), 0)), '{}')
      into v_delves
      from jsonb_each_text(new.delves) d;
  end if;
  new.vault := coalesce(season_vault(current_season(new.week_of), new.raid_kills, new.mplus_runs, v_delves), '{}');
  new.vault_at := now();
  return new;
end;
$$;

comment on function public.character_weeks_fill_vault() is
  'Trigger: works out character_weeks.vault (#1637) on every write, with this week''s delves as the row less the week before''s.';

revoke all on function public.character_weeks_fill_vault() from public, anon, authenticated;

create trigger character_weeks_fill_vault
  before insert or update on public.character_weeks
  for each row execute function public.character_weeks_fill_vault();

comment on column public.character_weeks.raid_kills is
  'Bosses killed this week: [{"encounter_id": 2888, "instance_id": 1320, "difficulty": "mythic"}, ...], Blizzard journal ids. instance_id from #1637 on.';
comment on column public.character_weeks.vault is
  'The Great Vault worked out from this row (#1637, season_vault()): per row (raid, dungeon, world) its three slots. World is null unless both this week''s and the week before''s delves were read; Raid is null while a kill lacks its instance_id.';

-- Midnight Season 2. Each track: +3, +3, +4, +3, +3 from its first step;
-- Myth 9 is the last Mythic bosses' 344.
insert into public.season_track_steps (season, track, rank, item_level)
select 'MID2', t.track, s.rank, t.floor + (array[0, 3, 6, 10, 13, 16])[s.rank]
  from (values ('Adventurer', 266), ('Veteran', 279), ('Champion', 292), ('Hero', 305), ('Myth', 318)) t(track, floor)
  cross join generate_series(1, 6) s(rank);
insert into public.season_track_steps (season, track, rank, item_level) values ('MID2', 'Myth', 9, 344);

insert into public.season_vault_slots (season, vault_row, slot, needs) values
  ('MID2', 'raid', 1, 2), ('MID2', 'raid', 2, 4), ('MID2', 'raid', 3, 6),
  ('MID2', 'dungeon', 1, 1), ('MID2', 'dungeon', 2, 4), ('MID2', 'dungeon', 3, 8),
  ('MID2', 'world', 1, 2), ('MID2', 'world', 2, 4), ('MID2', 'world', 3, 8);

insert into public.season_vault_rewards (season, vault_row, difficulty, encounter_id, from_level, track, rank) values
  ('MID2', 'raid', 'lfr', null, null, 'Champion', 1),
  ('MID2', 'raid', 'normal', null, null, 'Hero', 1),
  ('MID2', 'raid', 'heroic', null, null, 'Myth', 1),
  ('MID2', 'raid', 'mythic', null, null, 'Myth', 6),
  ('MID2', 'raid', 'mythic', 2883, null, 'Myth', 9), -- The Coiled Altar
  ('MID2', 'raid', 'mythic', 2895, null, 'Myth', 9), -- Ula'tek
  ('MID2', 'dungeon', null, null, 2, 'Hero', 1),
  ('MID2', 'dungeon', null, null, 4, 'Hero', 2),
  ('MID2', 'dungeon', null, null, 6, 'Hero', 3),
  ('MID2', 'dungeon', null, null, 7, 'Hero', 4),
  ('MID2', 'dungeon', null, null, 10, 'Myth', 1),
  ('MID2', 'world', null, null, 1, 'Veteran', 1),
  ('MID2', 'world', null, null, 2, 'Veteran', 2),
  ('MID2', 'world', null, null, 3, 'Veteran', 3),
  ('MID2', 'world', null, null, 4, 'Veteran', 4),
  ('MID2', 'world', null, null, 5, 'Champion', 1),
  ('MID2', 'world', null, null, 6, 'Champion', 3),
  ('MID2', 'world', null, null, 7, 'Champion', 4),
  ('MID2', 'world', null, null, 8, 'Hero', 1);

insert into public.season_vault_raids (season, instance_id, name) values
  ('MID2', 1320, 'The Venomous Abyss'),
  ('MID2', 1317, 'The Tidebound Grotto');
