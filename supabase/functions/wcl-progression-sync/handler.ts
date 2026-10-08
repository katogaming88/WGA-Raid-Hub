// wcl-progression-sync (#285, extended for both difficulties in #629): keeps
// team_raid_progress current with each team's live Mythic AND Heroic pull
// count / best % remaining on the boss they're currently working, plus total
// pulls and kill date for already-killed bosses -- shown on the public
// landing page's progression card, and (for Heroic) the source of the
// automatic AOTC date. It also keeps every Heroic and Mythic kill in
// team_raid_kills (#1246), the only writer of that table; each run re-sends
// the tier's kills and the insert skips any already kept.
//
// Unlike wcl-sync, there is no logged-in officer to forward a JWT from --
// this runs on a pg_cron schedule (supabase/migrations/
// 20260821010329_wcl_progression_sync_wider_window.sql; the GitHub Actions
// workflow of the same name is the manual fallback), not a button click,
// same reasoning as twitch-live-check. It writes progress for every team at
// once, which no per-team RLS policy grants to an unauthenticated caller, so
// this uses the service-role key (auto-injected into every Edge Function's
// environment).
//
// What needs configuring (Project Settings > Edge Functions > Secrets):
//   WCL_CLIENT_ID / WCL_CLIENT_SECRET -- already set for wcl-sync, reused here.
//   WCL_PROGRESS_SYNC_SECRET -- an arbitrary shared secret checked against the
//     x-cron-secret header, same pattern as twitch-live-check's
//     TWITCH_LIVE_CHECK_SECRET. The same value also has to be set as the
//     WCL_PROGRESS_SYNC_SECRET repo secret (Settings > Secrets and variables >
//     Actions) for the GitHub Actions workflow that calls this by hand.
//
// verify_jwt is off for this function in supabase/config.toml (#958): it is
// called by a bare curl from GitHub Actions, no Supabase session/JWT at all.
// The CLI reads that at deploy, so a bare `supabase functions deploy` keeps
// it. See twitch-live-check's header comment for why this differs from
// wcl-sync (verify_jwt: true).
//
// Source of the "which zone/bosses" question: a team's raidProgression entry
// in team_settings.config (the same officer-curated list Season Settings'
// "Refresh from WCL" button writes, see js/tabs/tab-season.js). Bosses fetched
// via that button now carry a wclEncounterId -- a boss display name renamed
// in Season Settings used to silently break the join to team_raid_progress,
// since the site side matched purely by normalised name -- but
// manually-added bosses and rows saved before that fix still won't have one.
// Rather than depend on it, this re-queries WCL's own
// zone(id).encounters for the canonical id list every run, same query
// wcl-sync's getZoneEncounters action already uses.
//
// The season a raid_zones row is filed under is the current tier's code,
// current_season(), read once per run and the same for every team: since
// #1189 (2026-09-20) the season is app-wide, so a raid belongs to the tier
// that is live when it is first seen, whatever a team's own settings say
// (#933). A zone the table holds under an earlier tier is left as that tier
// left it (#1469): on the new tier's launch day every team's raid list still
// names the outgoing raid until an officer replaces it, and the reports are
// read from the new tier's start, so syncing it would rebuild its progress
// from the new tier's nights alone. raid_zones is one row per (wcl_zone_id,
// season) shared by every team. Until #933 the stamp was the syncing team's
// seasonName, to keep two teams on different cycles apart, and a team with no
// name was skipped; the cycle is gone, so a team with raids syncs whatever it
// has named, and a day with no tier row (before the first tier's migration,
// or after a slipped date) writes nothing, since the column is a foreign key
// to seasons.
//
// Every report it reads is also kept in team_raid_reports (#1469), one row per
// team and report, with the title rule's verdict (_shared/alt-run.ts) in kind.
// The sync never sends an officer's override, so a rewrite leaves it alone,
// and never deletes a row, so a report older than the tier start stays on
// record.
//
// handle() takes its reads and writes, its fetch and its environment as an
// argument (#1006), so tests/edge/ runs it against plain objects; deps.ts
// supplies the real ones and index.ts is the one line that serves it.
import { isAltRun } from '../_shared/alt-run.ts';
import { gqlInt } from '../_shared/gql.ts';
import { tierStartTimeMs } from '../_shared/tier-start.ts';
import { VERSION } from './version.ts';

export type Env = { get(name: string): string | undefined };

export type TeamRow = { id: number; wcl_guild_id: number };
export type RaidZoneRow = {
  wcl_zone_id: number;
  name: string;
  season: string;
  is_mini_raid: boolean;
  sort_index: number;
};
export type EncounterRow = { zone_id: number; wcl_encounter_id: number; name: string; sort_index: number };
export type SavedEncounter = { id: number; wcl_encounter_id: number };
export type ProgressRow = Record<string, unknown>;
export type KillRow = {
  team_id: number;
  encounter_id: number;
  difficulty: 'heroic' | 'mythic';
  report_code: string;
  fight_id: number;
  raid_date: string;
  report_started_at: string;
};
// One row of team_raid_reports (#1469): never the override columns, so the
// upsert leaves an officer's choice where it is.
export type ReportRow = {
  team_id: number;
  report_code: string;
  title: string | null;
  started_at: string;
  raid_date: string;
  wcl_zone_id: number | null;
  boss_pulls: number;
  boss_kills: number;
  kind: 'main' | 'alt';
};
export type CurrentSeason = { code: string; startsAt: string | null };

// One method per read or write the function performs. Production implements
// it over supabase-js in deps.ts; a test hands in a plain object. Each throws
// when its statement fails.
export interface ProgressDb {
  // Teams with a wcl_guild_id.
  teams(): Promise<TeamRow[]>;
  // The team's team_settings.config, {} when it has no row.
  teamConfig(teamId: number): Promise<Record<string, unknown>>;
  // current_season() and its seasons.starts_at, null when no tier has started.
  currentSeason(): Promise<CurrentSeason | null>;
  // A tier's seasons.starts_at by its code, null when it has none.
  tierStart(code: string): Promise<string | null>;
  // The season a zone is already filed under, null when raid_zones has no row for it.
  raidZoneSeason(wclZoneId: number): Promise<string | null>;
  // Upserts on (wcl_zone_id, season); returns the row id.
  upsertRaidZone(row: RaidZoneRow): Promise<number>;
  // Upserts on (zone_id, wcl_encounter_id); returns the ids.
  upsertEncounters(rows: EncounterRow[]): Promise<SavedEncounter[]>;
  // Upserts on (team_id, report_code).
  upsertReports(rows: ReportRow[]): Promise<void>;
  // Upserts on (team_id, encounter_id).
  upsertProgress(rows: ProgressRow[]): Promise<void>;
  // Inserts into team_raid_kills, skipping a (team_id, report_code, fight_id) already stored.
  insertKills(rows: KillRow[]): Promise<void>;
}

export type Deps = { fetch: typeof fetch; env: Env; db: ProgressDb };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'X-WGA-Version',
  'X-WGA-Version': VERSION
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

// Ported from wcl-sync's REPORT_TIME_ZONE/formatReportDate -- same
// America/New_York + early-morning-cutoff logic, kept in sync by hand: the two
// functions share _shared/alt-run.ts and _shared/tier-start.ts, not this yet.
const REPORT_TIME_ZONE = 'America/New_York';
const EARLY_MORNING_CUTOFF_HOUR = 6;

function formatReportDate(ms: number): string {
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: REPORT_TIME_ZONE }).format(new Date(ms));
  const localHour = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: REPORT_TIME_ZONE, hourCycle: 'h23', hour: '2-digit' }).format(
      new Date(ms)
    ),
    10
  );
  if (localHour >= EARLY_MORNING_CUTOFF_HOUR) return localDate;
  const d = new Date(`${localDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function getAccessToken(deps: Deps): Promise<string | null> {
  const clientId = deps.env.get('WCL_CLIENT_ID');
  const clientSecret = deps.env.get('WCL_CLIENT_SECRET');
  const credentials = btoa(`${clientId}:${clientSecret}`);
  const response = await deps.fetch('https://www.warcraftlogs.com/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const data = await response.json();
  if (!data.access_token) {
    console.error('WCL token response:', JSON.stringify(data));
    return null;
  }
  return data.access_token;
}

async function wclQuery(deps: Deps, token: string, query: string): Promise<any | null> {
  try {
    const response = await deps.fetch('https://www.warcraftlogs.com/api/v2/client', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query })
    });
    const data = await response.json();
    if (data.errors) {
      console.error('WCL GraphQL errors:', JSON.stringify(data.errors));
      return null;
    }
    return data;
  } catch (err) {
    console.error('WCL request failed:', err);
    return null;
  }
}

// A reports page's complexity is set by the query's shape, not by the guild's
// data (measured 2026-10-06 against two guilds with very different fight
// counts): page size x (5 + 100 x fields asked per fight) + 4, and Warcraft
// Logs refuses a query above 50,000 outright. The five fight fields here
// make about 25,250 at 50 a page and 50,504 at 100, so the 2026-08-21
// refusal ("50000 but got 50401", every team on every tick, while the loop
// silently stopped on page 1) was the page size, not a log that grew. A query
// costs one point per report returned plus one, whatever its fields, so a
// smaller page costs a point per extra page and nothing else. #1470 asks for
// ten fields per fight, which fit at 25 a page.
const REPORT_LIMIT = 50;
// 20 pages * 50/page = 1000 reports per team per run -- far beyond any real
// tier's report count, just a guard against an unexpected has_more_pages
// loop (e.g. a WCL response that never actually terminates).
const MAX_REPORT_PAGES = 20;
const MYTHIC_DIFF = 5;
const HEROIC_DIFF = 4;

type RaidConfigEntry = {
  wclZoneId?: string | number;
  name?: string;
  isMiniRaid?: boolean;
};

type WclReport = {
  code: string;
  title?: string | null;
  startTime: number;
  zone?: { id: number } | null;
  fights?: any[];
};

// One raid on the team's list as this run syncs it: Warcraft Logs' encounter
// ids for its bosses, mapped to raid_encounters ids.
type SyncedZone = { zoneName: string; encounterIdByWcl: Map<number, number> };

// One of these per difficulty (Mythic, Heroic) tracked for an encounter.
type DifficultyAgg = {
  pulls: number;
  killed: boolean;
  killMs: number | null;
  // Best (lowest) % remaining seen on a non-kill attempt so far.
  bestPct: number | null;
  bestReportCode: string | null;
  bestFightId: number | null;
  // The kill attempt's report/fight, once one is found.
  killReportCode: string | null;
  killFightId: number | null;
};

type EncounterAgg = {
  mythic: DifficultyAgg;
  heroic: DifficultyAgg;
};

function newDifficultyAgg(): DifficultyAgg {
  return {
    pulls: 0,
    killed: false,
    killMs: null,
    bestPct: null,
    bestReportCode: null,
    bestFightId: null,
    killReportCode: null,
    killFightId: null
  };
}

function zoneIdOf(raid: RaidConfigEntry): number | null {
  const zoneId = parseInt(String(raid.wclZoneId || ''), 10);
  return !zoneId || Number.isNaN(zoneId) ? null : zoneId;
}

// Every report the guild has logged since the tier start (every report, when
// the tier has no start date), once per team per run (#1469).
//
// No zoneID filter on the reports() query, deliberately -- confirmed live
// that filtering by zoneID undercounted pulls relative to WCL's own guild
// progress page (this app showed 145 pulls on a boss WCL's
// /guild/progress/<id>?zone=<id> page showed 174 for). A report's own zone
// tag isn't reliable enough to filter on: wcl-sync's refreshAttendance hit
// the same gap and works around it by classifying each report itself
// rather than trusting reports(zoneID:) -- see getReportZone there. This
// does the equivalent by keeping only fights whose encounterID belongs to a
// raid's own encounter list (checked against encounterIdByWcl), rather than
// trusting the report-level zone, which is only stored.
//
// reports(guildID, limit) also only returns one page (up to REPORT_LIMIT
// reports) per call -- paginate through has_more_pages instead of trusting
// a single call, capped at MAX_REPORT_PAGES as a runaway guard. A page
// Warcraft Logs does not return throws, so the team writes nothing that run:
// progress rebuilt from a partial list can lose a kill date. A report
// uploaded while the pages are read pushes the list down by one, so a page
// can repeat the last report of the page before it; it is kept once.
async function fetchReports(deps: Deps, token: string, guildId: number, startMs: number | null): Promise<WclReport[]> {
  const window = startMs === null ? '' : `, startTime: ${gqlInt(startMs)}`;
  const reports: WclReport[] = [];
  const seen = new Set<string>();
  for (let page = 1; ; page++) {
    const reportsQuery = `
      query {
        reportData {
          reports(guildID: ${gqlInt(guildId)}, limit: ${REPORT_LIMIT}, page: ${page}${window}) {
            data {
              code
              title
              startTime
              zone { id }
              fights {
                id
                encounterID
                difficulty
                kill
                bossPercentage
              }
            }
            has_more_pages
          }
        }
      }
    `;
    const pageResult = await wclQuery(deps, token, reportsQuery);
    const pageReports = pageResult?.data?.reportData?.reports;
    if (!pageReports) throw new Error(`Reports page ${page} not returned`);
    for (const report of (pageReports.data || []) as WclReport[]) {
      if (seen.has(report.code)) continue;
      seen.add(report.code);
      reports.push(report);
    }
    if (!pageReports.has_more_pages || page >= MAX_REPORT_PAGES) return reports;
  }
}

// One raid on the team's list: its zone and bosses from Warcraft Logs, filed
// in raid_zones and raid_encounters. Null when the raid is not synced this
// run: no usable zone id, a zone filed under an earlier tier (see the
// header), or a zone Warcraft Logs does not know. A zone query it does not
// answer throws instead, as a reports page does: read as an unknown zone,
// its bosses would drop out of every report's counts.
async function prepareZone(
  deps: Deps,
  token: string,
  season: string,
  raid: RaidConfigEntry,
  sortIndex: number
): Promise<SyncedZone | null> {
  const zoneId = zoneIdOf(raid);
  if (zoneId === null) return null;
  const filedSeason = await deps.db.raidZoneSeason(zoneId);
  if (filedSeason !== null && filedSeason !== season) return null;

  const zoneQuery = `query { worldData { zone(id: ${gqlInt(zoneId)}) { name encounters { id name } } } }`;
  const zoneResult = await wclQuery(deps, token, zoneQuery);
  if (!zoneResult) throw new Error(`Zone ${zoneId} not returned`);
  const zone = zoneResult.data?.worldData?.zone;
  if (!zone) return null;
  const encounters: Array<{ id: number; name: string }> = zone.encounters || [];
  const encounterIdByWcl = new Map<number, number>();
  if (encounters.length === 0) return { zoneName: zone.name, encounterIdByWcl };

  const zoneRowId = await deps.db.upsertRaidZone({
    wcl_zone_id: zoneId,
    name: raid.name || zone.name || 'Unnamed Raid',
    season,
    is_mini_raid: !!raid.isMiniRaid,
    sort_index: sortIndex
  });

  const encounterRows = encounters.map((e, i) => ({
    zone_id: zoneRowId,
    wcl_encounter_id: e.id,
    name: e.name,
    sort_index: i
  }));
  const savedEncounters = await deps.db.upsertEncounters(encounterRows);
  for (const row of savedEncounters || []) encounterIdByWcl.set(row.wcl_encounter_id as number, row.id as number);
  return { zoneName: zone.name, encounterIdByWcl };
}

// A team_raid_reports row per report: its Heroic and Mythic pulls and kills
// on the bosses of the raids synced this run, as the progression card counts
// them, and the title rule's verdict. Never the override columns.
function reportRows(teamId: number, reports: WclReport[], bossIds: Set<number>): ReportRow[] {
  return reports.map((report) => {
    let pulls = 0;
    let kills = 0;
    for (const fight of report.fights || []) {
      if (!bossIds.has(fight.encounterID)) continue;
      if (fight.difficulty !== MYTHIC_DIFF && fight.difficulty !== HEROIC_DIFF) continue;
      pulls++;
      if (fight.kill) kills++;
    }
    return {
      team_id: teamId,
      report_code: report.code,
      title: report.title ?? null,
      started_at: new Date(report.startTime).toISOString(),
      raid_date: formatReportDate(report.startTime),
      wcl_zone_id: report.zone?.id ?? null,
      boss_pulls: pulls,
      boss_kills: kills,
      kind: isAltRun(report.title) ? 'alt' : 'main'
    };
  });
}

// One raid's progress rows and kills from the team's reports. Returns the
// kills write's error, if it failed.
async function writeZoneProgress(
  deps: Deps,
  teamId: number,
  reports: WclReport[],
  encounterIdByWcl: Map<number, number>
): Promise<string | undefined> {
  const agg = new Map<number, EncounterAgg>();
  function entryFor(encId: number): EncounterAgg {
    if (!agg.has(encId)) agg.set(encId, { mythic: newDifficultyAgg(), heroic: newDifficultyAgg() });
    return agg.get(encId)!;
  }

  // The reports() query no longer filters by difficulty -- fetching every
  // difficulty's fights in one pass and bucketing by fight.difficulty here
  // covers Heroic without a second report fetch/page loop per zone (avoiding
  // the API-usage doubling flagged when #629 was filed). LFR/Normal fights
  // come through too but are simply ignored below.
  // Every kill is also kept as its own row (#1246), not just the first.
  const kills: KillRow[] = [];
  for (const report of reports) {
    for (const fight of report.fights || []) {
      const encId = fight.encounterID;
      // Only this zone's own bosses -- the guild's reports are read once for
      // every raid on the list (see fetchReports for why).
      if (encId == null || !encounterIdByWcl.has(encId)) continue;
      let e: DifficultyAgg;
      if (fight.difficulty === MYTHIC_DIFF) {
        e = entryFor(encId).mythic;
      } else if (fight.difficulty === HEROIC_DIFF) {
        e = entryFor(encId).heroic;
      } else {
        continue;
      }
      e.pulls++;
      if (fight.kill) {
        kills.push({
          team_id: teamId,
          encounter_id: encounterIdByWcl.get(encId)!,
          difficulty: fight.difficulty === MYTHIC_DIFF ? 'mythic' : 'heroic',
          report_code: report.code,
          fight_id: fight.id,
          raid_date: formatReportDate(report.startTime),
          report_started_at: new Date(report.startTime).toISOString()
        });
        // Track the earliest kill across every report returned, not just
        // the last one iterated -- a farmed boss has many kill fights, and
        // the kill date should be the *first* one, matching fetchProgression's
        // own "min timestamp among kills" logic in wcl-sync.
        e.killed = true;
        if (e.killMs === null || report.startTime < e.killMs) {
          e.killMs = report.startTime;
          e.killReportCode = report.code;
          e.killFightId = fight.id;
        }
      } else if (fight.bossPercentage != null) {
        if (e.bestPct === null || fight.bossPercentage < e.bestPct) {
          e.bestPct = fight.bossPercentage;
          e.bestReportCode = report.code;
          e.bestFightId = fight.id;
        }
      }
    }
  }

  const rows: ProgressRow[] = [];
  const now = new Date().toISOString();
  function difficultyColumns(d: DifficultyAgg, prefix: 'mythic' | 'heroic') {
    return {
      [`${prefix}_date`]: d.killed ? d.killMs && formatReportDate(d.killMs) : null,
      [`${prefix}_pulls`]: d.pulls,
      [`${prefix}_best_pct`]: d.killed ? null : d.bestPct,
      [`${prefix}_report_code`]: d.killed ? d.killReportCode : d.bestReportCode,
      [`${prefix}_fight_id`]: d.killed ? d.killFightId : d.bestFightId
    };
  }

  for (const [wclEncId, data] of agg) {
    const encounterId = encounterIdByWcl.get(wclEncId);
    if (!encounterId) continue;
    rows.push({
      team_id: teamId,
      encounter_id: encounterId,
      ...difficultyColumns(data.mythic, 'mythic'),
      ...difficultyColumns(data.heroic, 'heroic'),
      updated_at: now
    });
  }
  if (rows.length > 0) {
    await deps.db.upsertProgress(rows);
  }
  // A failed kills write is reported, not thrown, so the progress of the
  // team's other raids still syncs.
  if (kills.length > 0) {
    try {
      await deps.db.insertKills(kills);
    } catch (err) {
      return err instanceof Error ? err.message : 'Unknown error';
    }
  }
  return undefined;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const cronSecret = deps.env.get('WCL_PROGRESS_SYNC_SECRET');
    if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
      return jsonResponse({ success: false, error: 'Not authorized' }, 401);
    }

    const clientId = deps.env.get('WCL_CLIENT_ID');
    const clientSecret = deps.env.get('WCL_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      return jsonResponse({ success: false, error: 'WCL credentials not configured' }, 500);
    }

    const teams = await deps.db.teams();
    if (teams.length === 0) return jsonResponse({ success: true, teams: 0, synced: 0 });

    const token = await getAccessToken(deps);
    if (!token) return jsonResponse({ success: false, error: 'Failed to get WCL access token' }, 500);

    // The stamp on every team's raid_zones rows and the start of the reports
    // window; no tier, no rows.
    const season = await deps.db.currentSeason();
    if (!season)
      return jsonResponse({ success: true, teams: teams.length, synced: 0, errors: [], note: 'no current tier' });
    const startMs = tierStartTimeMs(season.startsAt);

    let synced = 0;
    let reportsWritten = 0;
    const errors: Array<{ teamId: number; error: string }> = [];

    for (const team of teams) {
      try {
        const config: any = await deps.db.teamConfig(team.id);
        const raids: RaidConfigEntry[] = Array.isArray(config.raidProgression) ? config.raidProgression : [];
        if (!raids.some((raid) => zoneIdOf(raid) !== null)) continue;

        const reports = await fetchReports(deps, token, team.wcl_guild_id, startMs);
        const zones: SyncedZone[] = [];
        for (let i = 0; i < raids.length; i++) {
          const zone = await prepareZone(deps, token, season.code, raids[i], i);
          if (zone) zones.push(zone);
        }

        // The reports are the newest write, as the kills were: a failure is
        // reported, and the progress the landing page reads still syncs.
        const bossIds = new Set(zones.flatMap((zone) => [...zone.encounterIdByWcl.keys()]));
        const rows = reportRows(team.id, reports, bossIds);
        if (rows.length > 0) {
          try {
            await deps.db.upsertReports(rows);
            reportsWritten += rows.length;
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            errors.push({ teamId: team.id, error: `Reports not saved: ${message}` });
          }
        }

        for (const zone of zones) {
          const killsError = await writeZoneProgress(deps, team.id, reports, zone.encounterIdByWcl);
          synced++;
          if (killsError) errors.push({ teamId: team.id, error: `Kills not saved: ${killsError}` });
        }
      } catch (err) {
        errors.push({ teamId: team.id, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    return jsonResponse({ success: true, teams: teams.length, synced, errors, reports: reportsWritten });
  } catch (err) {
    console.error('wcl-progression-sync error:', err);
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
}
