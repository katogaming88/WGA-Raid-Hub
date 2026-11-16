-- #1641: names for the audit's Raids and Dungeons tabs (#1261). The weekly row
-- (character_weeks) stores each boss kill by Blizzard's journal encounter id and
-- each M+ run by Blizzard's dungeon id, and nothing says what those are called.
--
-- * season_raid_bosses: the bosses of each season's counted raids
--   (season_vault_raids), in the order the game lists them, so the Raids tab has
--   a column per boss. Added by migration per season, like the other season
--   settings. Names and ids from Blizzard's JournalEncounter table (wago.tools).
-- * mplus_dungeons: every Mythic+ dungeon's name by the id the profile API uses
--   (Blizzard's MapChallengeMode id), so a run's dungeon_id reads as a name. Not
--   per season: a dungeon keeps its id, and the season's pool is simply the
--   dungeons its runs name.
--
-- Reference data, read by anyone and written only by migrations, like
-- season_vault_raids. A new table grants its own access (revoke all, then a
-- grant per role).

create table public.season_raid_bosses (
  season text not null,
  instance_id integer not null check (instance_id > 0),
  encounter_id integer not null check (encounter_id > 0),
  name text not null check (name ~ '\S'),
  sort_order smallint not null check (sort_order > 0),
  primary key (season, encounter_id),
  foreign key (season, instance_id) references public.season_vault_raids (season, instance_id)
);

comment on table public.season_raid_bosses is
  'The bosses of each season''s counted raids (#1641), by Blizzard journal encounter id, in the game''s order. Added by migration per season.';

create table public.mplus_dungeons (
  dungeon_id integer primary key check (dungeon_id > 0),
  name text not null check (name ~ '\S')
);

comment on table public.mplus_dungeons is
  'Mythic+ dungeon names by the dungeon id the profile API uses, Blizzard''s MapChallengeMode id (#1641). Every dungeon, not a season''s pool.';

alter table public.season_raid_bosses owner to postgres;
alter table public.season_raid_bosses enable row level security;
alter table public.mplus_dungeons owner to postgres;
alter table public.mplus_dungeons enable row level security;

create policy "Public read season_raid_bosses" on public.season_raid_bosses for select using (true);
create policy "Public read mplus_dungeons" on public.mplus_dungeons for select using (true);
create policy "Claude readers read season_raid_bosses" on public.season_raid_bosses
  for select to claude_readers using (true);
create policy "Claude readers read mplus_dungeons" on public.mplus_dungeons
  for select to claude_readers using (true);

revoke all on table public.season_raid_bosses from public, anon, authenticated, service_role;
grant select on table public.season_raid_bosses to anon, authenticated, service_role;
revoke all on table public.mplus_dungeons from public, anon, authenticated, service_role;
grant select on table public.mplus_dungeons to anon, authenticated, service_role;

-- Midnight Season 2: The Venomous Abyss (8 bosses) and The Tidebound Grotto.
insert into public.season_raid_bosses (season, instance_id, encounter_id, name, sort_order) values
  ('MID2', 1320, 2888, 'Nek''zali the Soulcoiler', 1),
  ('MID2', 1320, 2874, 'Entombed Sentinels', 2),
  ('MID2', 1320, 2894, 'The Lost Explorers', 3),
  ('MID2', 1320, 2882, 'Vashnik the Malignant', 4),
  ('MID2', 1320, 2871, 'Sszorak', 5),
  ('MID2', 1320, 2887, 'The Twin Fangs', 6),
  ('MID2', 1320, 2883, 'The Coiled Altar', 7),
  ('MID2', 1320, 2895, 'Ula''tek', 8),
  ('MID2', 1317, 2849, 'Nymrissa Wavecaller', 9);

insert into public.mplus_dungeons (dungeon_id, name) values
  (2, 'Temple of the Jade Serpent'),
  (56, 'Stormstout Brewery'),
  (57, 'Gate of the Setting Sun'),
  (58, 'Shado-Pan Monastery'),
  (59, 'Siege of Niuzao Temple'),
  (60, 'Mogu''shan Palace'),
  (76, 'Scholomance'),
  (77, 'Scarlet Halls'),
  (78, 'Scarlet Monastery'),
  (161, 'Skyreach'),
  (163, 'Bloodmaul Slag Mines'),
  (164, 'Auchindoun'),
  (165, 'Shadowmoon Burial Grounds'),
  (166, 'Grimrail Depot'),
  (167, 'Upper Blackrock Spire'),
  (168, 'The Everbloom'),
  (169, 'Iron Docks'),
  (197, 'Eye of Azshara'),
  (198, 'Darkheart Thicket'),
  (199, 'Black Rook Hold'),
  (200, 'Halls of Valor'),
  (206, 'Neltharion''s Lair'),
  (207, 'Vault of the Wardens'),
  (208, 'Maw of Souls'),
  (209, 'The Arcway'),
  (210, 'Court of Stars'),
  (227, 'Return to Karazhan: Lower'),
  (233, 'Cathedral of Eternal Night'),
  (234, 'Return to Karazhan: Upper'),
  (239, 'Seat of the Triumvirate'),
  (244, 'Atal''Dazar'),
  (245, 'Freehold'),
  (246, 'Tol Dagor'),
  (247, 'The MOTHERLODE!!'),
  (248, 'Waycrest Manor'),
  (249, 'Kings'' Rest'),
  (250, 'Temple of Sethraliss'),
  (251, 'The Underrot'),
  (252, 'Shrine of the Storm'),
  (353, 'Siege of Boralus'),
  (369, 'Operation: Mechagon - Junkyard'),
  (370, 'Operation: Mechagon - Workshop'),
  (375, 'Mists of Tirna Scithe'),
  (376, 'The Necrotic Wake'),
  (377, 'De Other Side'),
  (378, 'Halls of Atonement'),
  (379, 'Plaguefall'),
  (380, 'Sanguine Depths'),
  (381, 'Spires of Ascension'),
  (382, 'Theater of Pain'),
  (391, 'Tazavesh: Streets of Wonder'),
  (392, 'Tazavesh: So''leah''s Gambit'),
  (399, 'Ruby Life Pools'),
  (400, 'The Nokhud Offensive'),
  (401, 'The Azure Vault'),
  (402, 'Algeth''ar Academy'),
  (403, 'Uldaman: Legacy of Tyr'),
  (404, 'Neltharus'),
  (405, 'Brackenhide Hollow'),
  (406, 'Halls of Infusion'),
  (438, 'The Vortex Pinnacle'),
  (456, 'Throne of the Tides'),
  (463, 'Dawn of the Infinite: Galakrond''s Fall'),
  (464, 'Dawn of the Infinite: Murozond''s Rise'),
  (499, 'Priory of the Sacred Flame'),
  (500, 'The Rookery'),
  (501, 'The Stonevault'),
  (502, 'City of Threads'),
  (503, 'Ara-Kara, City of Echoes'),
  (504, 'Darkflame Cleft'),
  (505, 'The Dawnbreaker'),
  (506, 'Cinderbrew Meadery'),
  (507, 'Grim Batol'),
  (525, 'Operation: Floodgate'),
  (541, 'The Stonecore'),
  (542, 'Eco-Dome Al''dani'),
  (556, 'Pit of Saron'),
  (557, 'Windrunner Spire'),
  (558, 'Magisters'' Terrace'),
  (559, 'Nexus-Point Xenas'),
  (560, 'Maisara Caverns'),
  (583, 'Seat of the Triumvirate'),
  (584, 'The Blinding Vale'),
  (585, 'Voidscar Arena'),
  (586, 'Den of Nalorakk'),
  (587, 'Murder Row'),
  (588, 'Altar of Fangs');
