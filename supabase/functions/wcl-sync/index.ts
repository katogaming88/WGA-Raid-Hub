// wcl-sync (#223): ports WarcraftLogs API access out of Apps Script
// (gs/WCL.gs, gs/Attendance.gs, gs/wgaWebApp.gs) into a Supabase Edge
// Function. Stage 1: the two read-only WCL proxies behind Season Settings'
// raid progression picker (getZoneEncounters, fetchProgression). Stage 2:
// the Scoring tab's "Refresh from WCL" read (refreshPerformance). Stage 3:
// the Attendance tab's "Refresh from WCL" write (refreshAttendance) -- see
// js/tabs/tab-scoring.js and js/tabs/tab-attendance.js for why the commit/
// manual-edit steps in both features stay direct Supabase writes rather
// than more actions here.
//
// No service-role key: officers already have full RLS write access to
// attendance/scoring via their own session (docs/RLS.md), so this function
// forwards the caller's JWT (auto-attached by supabase.functions.invoke())
// and lets RLS gate everything, same as every direct-write call site
// elsewhere in this app. The only real secret is WCL_CLIENT_ID/
// WCL_CLIENT_SECRET, needed purely to keep the WarcraftLogs OAuth
// credentials off the client -- configured in Project Settings > Edge
// Functions > Secrets per #205.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

// GAS formatted every WCL-derived date via Utilities.formatDate(ts,
// Session.getScriptTimeZone(), 'yyyy-MM-dd') -- America/New_York throughout
// this app (js/common.js, migrations, docs/database-decisions.md). Report
// startTime is a UTC epoch ms; a raid starting evening US time can already
// be past midnight UTC, so a naive `.toISOString().slice(0,10)` silently
// shifts it to the wrong calendar day -- this reproduces GAS's timezone-
// correct date instead.
const REPORT_TIME_ZONE = 'America/New_York';
// A raid that runs past midnight still belongs to the night it started, not
// the calendar day its report timestamp technically falls on -- reports
// starting in the small hours (before this cutoff, local time) are dated as
// the previous day instead.
const EARLY_MORNING_CUTOFF_HOUR = 6;

function formatReportDate(ms: number): string {
  // en-CA formats as YYYY-MM-DD, conveniently matching the date column format.
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: REPORT_TIME_ZONE }).format(new Date(ms));
  const localHour = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: REPORT_TIME_ZONE, hourCycle: 'h23', hour: '2-digit' }).format(
      new Date(ms)
    ),
    10
  );
  if (localHour >= EARLY_MORNING_CUTOFF_HOUR) return localDate;
  // Pure calendar-date arithmetic (not ms/DST math) to step back one day.
  const d = new Date(`${localDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ── WCL API helpers (ported from gs/WCL.gs) ─────────────────────────────────

async function getAccessToken(): Promise<string | null> {
  const clientId = Deno.env.get('WCL_CLIENT_ID');
  const clientSecret = Deno.env.get('WCL_CLIENT_SECRET');
  const credentials = btoa(`${clientId}:${clientSecret}`);
  const response = await fetch('https://www.warcraftlogs.com/oauth/token', {
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

async function wclQuery(token: string, query: string): Promise<any | null> {
  try {
    const response = await fetch('https://www.warcraftlogs.com/api/v2/client', {
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

// ── Actions ──────────────────────────────────────────────────────────────

// Ported from gs/wgaWebApp.gs's getWclZoneEncounters handler. Not
// guild-scoped -- world data, same for every team.
async function getZoneEncounters(zoneId: number) {
  const token = await getAccessToken();
  if (!token) throw new Error('Failed to get WCL access token. Check WCL_CLIENT_ID/WCL_CLIENT_SECRET.');

  const query = `query { worldData { zone(id: ${zoneId}) { name encounters { id name } } } }`;
  const result = await wclQuery(token, query);
  const zone = result?.data?.worldData?.zone;
  if (!zone) throw new Error('Zone not found');
  return { success: true, zoneName: zone.name, encounters: zone.encounters || [] };
}

// Ported from gs/wgaWebApp.gs's fetchWclProgressionData (lines 2919-2985).
// Guild-scoped -- needs the calling team's wcl_guild_id.
async function fetchProgression(zoneId: number, guildId: number) {
  const token = await getAccessToken();
  if (!token) throw new Error('Failed to get WCL access token. Check WCL_CLIENT_ID/WCL_CLIENT_SECRET.');

  const query = `
    query {
      reportData {
        reports(guildID: ${guildId}, zoneID: ${zoneId}, limit: 100) {
          data {
            startTime
            fights(killType: Kills) {
              encounterID
              name
              difficulty
            }
          }
        }
      }
    }
  `;
  const result = await wclQuery(token, query);
  if (!result) throw new Error('WCL query returned no data');

  const reports = result.data?.reportData?.reports?.data || [];
  const firstKills: Record<number, { name: string; mythicMs: number | null; heroicMs: number | null }> = {};

  for (const report of reports) {
    const fights = report.fights || [];
    for (const fight of fights) {
      const encId = fight.encounterID;
      const diff = fight.difficulty;
      const name = fight.name || '';
      const ts = report.startTime;

      if (!firstKills[encId]) firstKills[encId] = { name, mythicMs: null, heroicMs: null };
      if (name && !firstKills[encId].name) firstKills[encId].name = name;

      if (diff === 5) {
        if (firstKills[encId].mythicMs === null || ts < firstKills[encId].mythicMs!) firstKills[encId].mythicMs = ts;
      } else if (diff === 4) {
        if (firstKills[encId].heroicMs === null || ts < firstKills[encId].heroicMs!) firstKills[encId].heroicMs = ts;
      }
    }
  }

  const encIds = Object.keys(firstKills)
    .map((id) => parseInt(id, 10))
    .sort((a, b) => a - b);

  function formatDate(ms: number | null): string {
    if (!ms) return '';
    return formatReportDate(ms);
  }

  const bosses = encIds.map((encId) => {
    const k = firstKills[encId];
    return {
      encounterID: encId,
      name: k.name,
      mythicDate: formatDate(k.mythicMs),
      heroicDate: formatDate(k.heroicMs)
    };
  });

  const aotcDate = bosses.length > 0 ? bosses[bosses.length - 1].heroicDate || '' : '';

  return { success: true, bosses, aotcDate };
}

// Ported from gs/WCL.gs's refreshWclPerformanceCore + collectPlayerData +
// writeDualScores. Guild-scoped -- needs the calling team's wcl_guild_id.
// Read-only: unlike GAS (which writes "draft" cells the app never reads
// back), this just returns the computed scores -- the frontend already
// treats the response as the draft state (sessionStorage cache), and the
// actual commit is a direct Supabase write from the client (see
// js/tabs/tab-scoring.js), not another Edge Function round trip.
const RECENT_REPORTS = 2;
const TREND_REPORTS = 8;
const BEST_REPORTS = 20;
const MYTHIC_DIFF = 5;
const HEROIC_DIFF = 4;

type Role = 'tank' | 'healer' | 'dps';

function classRoleToScoringRole(role: string | null | undefined): Role {
  if (role === 'Tank') return 'tank';
  if (role === 'Heal') return 'healer';
  return 'dps';
}

async function fetchReportFights(token: string, reportCode: string): Promise<any[]> {
  async function fightsForDifficulty(difficulty: number): Promise<any[]> {
    const query = `
      query {
        reportData {
          report(code: "${reportCode}") {
            rankings(difficulty: ${difficulty})
          }
        }
      }
    `;
    const result = await wclQuery(token, query);
    const rankingsRaw = result?.data?.reportData?.report?.rankings;
    if (!rankingsRaw) return [];
    try {
      const rankings = typeof rankingsRaw === 'string' ? JSON.parse(rankingsRaw) : rankingsRaw;
      return rankings?.data || [];
    } catch (err) {
      console.error('Failed to parse rankings JSON:', err);
      return [];
    }
  }

  let fights = await fightsForDifficulty(MYTHIC_DIFF);
  if (!fights || fights.length === 0) fights = await fightsForDifficulty(HEROIC_DIFF);
  return fights;
}

async function refreshPerformance(
  token: string,
  guildId: number,
  teamId: number,
  supabase: ReturnType<typeof createClient>
) {
  const reportsQuery = `
    query {
      reportData {
        reports(guildID: ${guildId}, limit: ${BEST_REPORTS}) {
          data { code title startTime endTime }
        }
      }
    }
  `;
  const reportsResult = await wclQuery(token, reportsQuery);
  const reports = reportsResult?.data?.reportData?.reports?.data || [];
  if (reports.length === 0) throw new Error('No reports found for this guild.');

  const { data: players, error: playersError } = await supabase
    .from('players')
    .select('id, name_realm, classes_specs(role)')
    .eq('team_id', teamId)
    .is('archived_at', null);
  if (playersError) throw new Error(playersError.message);

  const roleByFirstName = new Map<string, Role>();
  const rosterByFirstName = new Map<string, { playerId: number; displayName: string }>();
  for (const p of players || []) {
    const displayName = String(p.name_realm).split('-')[0].trim();
    const firstName = displayName.toLowerCase();
    if (!firstName) continue;
    const classSpec = Array.isArray(p.classes_specs) ? p.classes_specs[0] : p.classes_specs;
    roleByFirstName.set(firstName, classRoleToScoringRole(classSpec?.role));
    rosterByFirstName.set(firstName, { playerId: p.id, displayName });
  }

  // recent(2)/trend(8)/best(20) are prefixes of the same 20-report window,
  // so each report's rankings are fetched exactly once here and bucketed
  // into all three accumulators it belongs to -- GAS refetches per window
  // (up to 3x per report), which isn't viable under an Edge Function's
  // execution time limit.
  const recentData = new Map<string, number[]>();
  const trendData = new Map<string, number[]>();
  const bestData = new Map<string, number[]>();

  for (let i = 0; i < reports.length; i++) {
    const fights = await fetchReportFights(token, reports[i].code);
    for (const fight of fights) {
      if (!fight.roles) continue;
      for (const roleKey of ['dps', 'healers', 'tanks'] as const) {
        const entries = fight.roles[roleKey]?.characters || [];
        for (const character of entries) {
          const name = character.name;
          const ilvlPct = character.bracketPercent;
          if (!name || ilvlPct == null || ilvlPct === 0) continue;

          const firstName = String(name).trim().toLowerCase();
          const expectedRole = roleByFirstName.get(firstName) || 'dps';
          if (expectedRole === 'tank') continue;
          if (expectedRole === 'healer') continue;
          if (expectedRole === 'dps' && roleKey !== 'dps') continue;

          if (i < RECENT_REPORTS) {
            if (!recentData.has(firstName)) recentData.set(firstName, []);
            recentData.get(firstName)!.push(ilvlPct);
          }
          if (i < TREND_REPORTS) {
            if (!trendData.has(firstName)) trendData.set(firstName, []);
            trendData.get(firstName)!.push(ilvlPct);
          }
          if (!bestData.has(firstName)) bestData.set(firstName, []);
          bestData.get(firstName)!.push(ilvlPct);
        }
      }
    }
  }

  function calcScore(pcts: number[] | undefined): number | null {
    if (!pcts || pcts.length === 0) return null;
    const avg = pcts.reduce((a, b) => a + b, 0) / pcts.length;
    return Math.round((avg / 10) * 100) / 100;
  }

  let updated = 0;
  const scores: Array<{
    playerId: number;
    name: string;
    role: Role;
    recent: number | null;
    trend: number | null;
    best: number | null;
    noData: boolean;
    usedTrend: boolean;
    manual: boolean;
  }> = [];

  for (const [firstName, { playerId, displayName }] of rosterByFirstName) {
    const role = roleByFirstName.get(firstName) || 'dps';

    if (role === 'tank' || role === 'healer') {
      scores.push({
        playerId,
        name: displayName,
        role,
        recent: null,
        trend: null,
        best: null,
        noData: false,
        usedTrend: false,
        manual: true
      });
      continue;
    }

    const recentScore = calcScore(recentData.get(firstName));
    const trendScore = calcScore(trendData.get(firstName));
    const bestPcts = bestData.get(firstName) || [];
    const bestScore = bestPcts.length > 0 ? Math.round((Math.max(...bestPcts) / 10) * 100) / 100 : null;

    if (recentScore !== null) updated++;

    scores.push({
      playerId,
      name: displayName,
      role,
      recent: recentScore !== null ? recentScore : trendScore,
      trend: trendScore,
      best: bestScore,
      noData: recentScore === null && trendScore === null,
      usedTrend: recentScore === null && trendScore !== null,
      manual: false
    });
  }

  return {
    success: true,
    updated,
    recentReports: Math.min(RECENT_REPORTS, reports.length),
    trendReports: Math.min(TREND_REPORTS, reports.length),
    scores
  };
}

// Ported from gs/Attendance.gs's refreshAttendanceCore + helpers. Guild-
// scoped -- needs the calling team's wcl_guild_id. Writes attendance rows
// directly (source='WCL'/'Auto (Bench)') rather than a sheet -- see the
// attendance.source migration comment for why that column exists. The
// commit step (weighted score/pct into scoring) stays a direct client
// write, same reasoning as refreshPerformance/js/tabs/tab-scoring.js: no
// WCL secret is needed to aggregate rows that are already in the table.
const SEASON_REPORT_LIMIT = 50;
const ALT_RUN_KEYWORD = 'Alt';

async function getReportZone(token: string, reportCode: string): Promise<number | null> {
  const query = `query { reportData { report(code: "${reportCode}") { zone { id } } } }`;
  const result = await wclQuery(token, query);
  return result?.data?.reportData?.report?.zone?.id ?? null;
}

// Ported from gs/Attendance.gs's getReportParticipants: combines ranked-fight
// characters (mythic->heroic fallback, unlike refreshPerformance this is NOT
// role-filtered -- any character in the log counts as present) with a
// masterData.actors combatant dump, to also catch players present on nights
// with no ranked boss kill (wipes-only, non-kill logs).
async function getReportParticipants(token: string, reportCode: string): Promise<Set<string>> {
  const names = new Set<string>();

  const fights = await fetchReportFights(token, reportCode);
  for (const fight of fights) {
    if (!fight.roles) continue;
    for (const roleKey of ['dps', 'healers', 'tanks'] as const) {
      const entries = fight.roles[roleKey]?.characters || [];
      for (const character of entries) {
        if (character.name) names.add(String(character.name).split('-')[0].trim().toLowerCase());
      }
    }
  }

  const combatantsQuery = `
    query {
      reportData {
        report(code: "${reportCode}") {
          masterData { actors(type: "Player") { name } }
        }
      }
    }
  `;
  const combatantsResult = await wclQuery(token, combatantsQuery);
  const actors = combatantsResult?.data?.reportData?.report?.masterData?.actors || [];
  for (const actor of actors) {
    if (actor.name) names.add(String(actor.name).split('-')[0].trim().toLowerCase());
  }

  return names;
}

async function refreshAttendance(
  token: string,
  guildId: number,
  teamId: number,
  supabase: ReturnType<typeof createClient>
) {
  const { data: settingsRow } = await supabase
    .from('team_settings')
    .select('config')
    .eq('team_id', teamId)
    .maybeSingle();
  const config: any = (settingsRow as any)?.config || {};
  const seasonStart: string | null = config.seasonStart || null;
  const raidProgression: any[] = Array.isArray(config.raidProgression) ? config.raidProgression : [];
  const validZoneIds = new Set(
    raidProgression.map((r) => parseInt(r.wclZoneId, 10)).filter((id) => !Number.isNaN(id))
  );
  const startTimeMs = seasonStart && !Number.isNaN(Date.parse(seasonStart)) ? Date.parse(seasonStart) : null;

  const reportsQuery = `
    query {
      reportData {
        reports(guildID: ${guildId}, limit: ${SEASON_REPORT_LIMIT}${startTimeMs ? `, startTime: ${startTimeMs}` : ''}) {
          data { code title startTime }
        }
      }
    }
  `;
  const reportsResult = await wclQuery(token, reportsQuery);
  const reports = (reportsResult?.data?.reportData?.reports?.data || []).filter((r: any) => r.title);
  if (reports.length === 0) return { success: true, mainNights: 0, excluded: 0 };

  // A report already recorded (some attendance row references its code) is
  // trusted as a known main night and skipped entirely -- no zone or
  // participant re-fetch. Excluded reports never get attendance rows, so
  // they're re-classified every refresh; that's a cheap single zone-fetch
  // each, not the 3x-per-report cost stage 2 had to solve for.
  const { data: existingReportRows, error: existingReportsError } = await supabase
    .from('attendance')
    .select('report_id')
    .eq('team_id', teamId)
    .not('report_id', 'is', null);
  if (existingReportsError) throw new Error(existingReportsError.message);
  const cachedReportIds = new Set((existingReportRows || []).map((r: any) => r.report_id));

  const { data: players, error: playersError } = await supabase
    .from('players')
    .select('id, name_realm, is_bench, join_date')
    .eq('team_id', teamId)
    .is('archived_at', null);
  if (playersError) throw new Error(playersError.message);

  const roster = (players || [])
    .map((p: any) => ({
      playerId: p.id as number,
      firstName: String(p.name_realm).split('-')[0].trim().toLowerCase(),
      isBench: !!p.is_bench,
      joinDate: p.join_date as string | null
    }))
    .filter((p) => p.firstName);

  // Rows already set by an officer are never touched by a refresh -- same
  // "Auto sources are always recomputed, Officer sources are sticky" rule
  // gs/Attendance.gs's readExistingAttendance enforced via the sheet.
  const { data: existingStatusRows, error: existingStatusError } = await supabase
    .from('attendance')
    .select('player_id, raid_date, source')
    .eq('team_id', teamId);
  if (existingStatusError) throw new Error(existingStatusError.message);
  const officerLocked = new Set(
    (existingStatusRows || [])
      .filter((r: any) => r.source === 'Officer')
      .map((r: any) => `${r.raid_date}|${r.player_id}`)
  );

  let mainNights = 0;
  let excluded = 0;
  let latestNewZoneId: number | null = null;
  // Keyed by player_id|raid_date rather than a plain array: attendance's
  // unique constraint is (team_id, player_id, raid_date), not report_id, so
  // two reports landing on the same calendar date would otherwise produce
  // two rows for the same conflict target in one upsert batch -- Postgres
  // rejects that ("ON CONFLICT DO UPDATE command cannot affect row a second
  // time"). A Map collapses same-date duplicates to one row (last report
  // processed wins), which is the same "one report per date" limitation
  // this table already has via toggleReportExcluded/setPlayerStatus.
  const rowsToUpsert = new Map<string, any>();

  const sorted = [...reports].sort((a: any, b: any) => b.startTime - a.startTime);

  for (const report of sorted) {
    const date = formatReportDate(report.startTime);

    if (cachedReportIds.has(report.code)) {
      mainNights++;
      continue;
    }

    if (String(report.title).includes(ALT_RUN_KEYWORD)) {
      excluded++;
      continue;
    }

    const zoneId = await getReportZone(token, report.code);

    // Classification, matching gs/Attendance.gs's refreshAttendanceCore:
    // raid-progression zones take priority; a season-start filter with no
    // progression trusts every report the query already returned; with
    // neither configured, fall back to comparing against the most recent
    // *new* report's zone (a non-persisted stand-in for GAS's script-
    // property-backed "current zone" heuristic).
    let isMain: boolean;
    if (validZoneIds.size > 0) {
      isMain = zoneId != null && validZoneIds.has(zoneId);
    } else if (startTimeMs) {
      isMain = true;
    } else {
      if (latestNewZoneId === null) latestNewZoneId = zoneId;
      isMain = zoneId === latestNewZoneId;
    }

    if (!isMain) {
      excluded++;
      continue;
    }

    mainNights++;
    const participants = await getReportParticipants(token, report.code);

    for (const player of roster) {
      if (officerLocked.has(`${date}|${player.playerId}`)) continue;

      const base = {
        team_id: teamId,
        player_id: player.playerId,
        raid_date: date,
        report_id: report.code,
        report_title: report.title,
        report_excluded: false
      };

      const key = `${player.playerId}|${date}`;
      if (participants.has(player.firstName)) {
        rowsToUpsert.set(key, { ...base, status: 'Present', source: 'WCL' });
      } else if (player.isBench) {
        rowsToUpsert.set(key, { ...base, status: 'Bench', source: 'Auto (Bench)' });
      } else if (player.joinDate && date < player.joinDate) {
        rowsToUpsert.set(key, { ...base, status: 'Not on Roster', source: 'WCL' });
      }
      // else: left unset -- officer fills the status in manually via the grid.
    }
  }

  if (rowsToUpsert.size > 0) {
    const { error: upsertError } = await supabase
      .from('attendance')
      .upsert([...rowsToUpsert.values()], { onConflict: 'team_id,player_id,raid_date' });
    if (upsertError) throw new Error(upsertError.message);
  }

  return { success: true, mainNights, excluded };
}

// ── Entry point ──────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // Every response is HTTP 200 with a { success, error } body, matching the
  // GAS jsonpResponse convention this replaces -- callers check `.success`/
  // `.error` themselves rather than unpacking supabase-js's FunctionsHttpError
  // (which requires reading error.context separately to get this same body).
  try {
    const { action, teamId, zoneId } = await req.json();

    if (!action || !teamId) {
      return jsonResponse({ success: false, error: 'Missing action or teamId' });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ success: false, error: 'Not signed in' });
    }

    // Forwards the caller's own JWT rather than using the service role, so
    // RLS/my_team_role resolve exactly as they would for a direct frontend
    // call -- see the file header comment for why.
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });

    const [{ data: role }, { data: isSiteAdmin }] = await Promise.all([
      supabase.rpc('my_team_role', { p_team_id: teamId }),
      supabase.rpc('is_site_admin')
    ]);
    const authorized = role === 'officer' || role === 'team_leader' || isSiteAdmin === true;
    if (!authorized) {
      return jsonResponse({ success: false, error: 'Not authorized' });
    }

    if (action === 'getZoneEncounters') {
      if (!zoneId) return jsonResponse({ success: false, error: 'Missing zoneId' });
      const result = await getZoneEncounters(zoneId);
      return jsonResponse(result);
    }

    if (action === 'fetchProgression') {
      if (!zoneId) return jsonResponse({ success: false, error: 'Missing zoneId' });
      const { data: team, error: teamError } = await supabase
        .from('teams')
        .select('wcl_guild_id')
        .eq('id', teamId)
        .maybeSingle();
      if (teamError) return jsonResponse({ success: false, error: teamError.message });
      if (!team?.wcl_guild_id) {
        return jsonResponse({ success: false, error: 'No WCL guild ID configured for this team' });
      }
      const result = await fetchProgression(zoneId, team.wcl_guild_id);
      return jsonResponse(result);
    }

    if (action === 'refreshPerformance') {
      const { data: team, error: teamError } = await supabase
        .from('teams')
        .select('wcl_guild_id')
        .eq('id', teamId)
        .maybeSingle();
      if (teamError) return jsonResponse({ success: false, error: teamError.message });
      if (!team?.wcl_guild_id) {
        return jsonResponse({ success: false, error: 'No WCL guild ID configured for this team' });
      }
      const token = await getAccessToken();
      if (!token) return jsonResponse({ success: false, error: 'Failed to get WCL access token. Check WCL_CLIENT_ID/WCL_CLIENT_SECRET.' });
      const result = await refreshPerformance(token, team.wcl_guild_id, teamId, supabase);
      return jsonResponse(result);
    }

    if (action === 'refreshAttendance') {
      const { data: team, error: teamError } = await supabase
        .from('teams')
        .select('wcl_guild_id')
        .eq('id', teamId)
        .maybeSingle();
      if (teamError) return jsonResponse({ success: false, error: teamError.message });
      if (!team?.wcl_guild_id) {
        return jsonResponse({ success: false, error: 'No WCL guild ID configured for this team' });
      }
      const token = await getAccessToken();
      if (!token) return jsonResponse({ success: false, error: 'Failed to get WCL access token. Check WCL_CLIENT_ID/WCL_CLIENT_SECRET.' });
      const result = await refreshAttendance(token, team.wcl_guild_id, teamId, supabase);
      return jsonResponse(result);
    }

    return jsonResponse({ success: false, error: 'Unknown action: ' + action });
  } catch (err) {
    console.error('wcl-sync error:', err);
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});
