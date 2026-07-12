-- Drop the unused season_snapshots table (#455).
--
-- Designed in the original migration plan to hold one row per archived season
-- per team ("replaces the season history blob"), but #221's actual archive
-- implementation wrote to team_settings.config.seasonHistory instead -- that
-- decision was never written down anywhere, and looks like an oversight rather
-- than a reconsideration. The table shipped with correct RLS from day one and
-- has stayed accurately documented through several later RLS audits, but
-- nothing in js/ has ever read or written it. Surfaced while fixing #423
-- (Danger Zone's Clear Season History op, which used to describe itself as
-- clearing this table -- it never did).
--
-- Verified dead before dropping: 0 rows on every team, zero references
-- anywhere in js/, and no foreign key from any other table points at it. The
-- guard below re-checks the row count at migration time rather than trusting
-- that to still be true.
do $$
begin
  if exists (select 1 from public.season_snapshots limit 1) then
    raise exception 'Refusing to drop season_snapshots: it has rows';
  end if;
end $$;

drop table public.season_snapshots;
