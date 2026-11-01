-- #1714: Midnight Season 3 on file before Blizzard dates it, so teams can open
-- signups for it now (Kat, 2026-10-30). Undated, it is never the current
-- season and matches no raid night (#1717); the site and the new app show it
-- as the next season. Dating it is one later migration: end MID2 the day
-- before launch, then set MID3's start (docs/updating-fetch-items-for-new-tier.md).
insert into public.seasons (code, display_name) values ('MID3', 'Midnight Season 3');
