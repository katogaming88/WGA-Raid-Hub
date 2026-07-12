// wcl-progression-sync (#285): keeps team_raid_progress current with each
// team's live mythic pull count / best % remaining on the boss they're
// currently working, plus total pulls for already-killed bosses -- shown on
// the public landing page's progression card.
//
// Unlike wcl-sync, there is no logged-in officer to forward a JWT from --
// this runs on a GitHub Actions cron schedule (.github/workflows/
// wcl-progression-sync.yml), not a button click, same reasoning as
// twitch-live-check. It writes progress for every team at once, which no
// per-team RLS policy grants to an unauthenticated caller, so this uses the
// service-role key (auto-injected into every Edge Function's environment).
//
// What needs configuring (Project Settings > Edge Functions > Secrets):
//   WCL_CLIENT_ID / WCL_CLIENT_SECRET -- already set for wcl-sync, reused here.
//   WCL_PROGRESS_SYNC_SECRET -- an arbitrary shared secret checked against the
//     x-cron-secret header, same pattern as twitch-live-check's
//     TWITCH_LIVE_CHECK_SECRET. The same value also has to be set as the
//     WCL_PROGRESS_SYNC_SECRET repo secret (Settings > Secrets and variables >
//     Actions) for the GitHub Actions workflow that calls this on a schedule.
//
// Also needs deploying with --no-verify-jwt (bare curl from GitHub Actions,
// no Supabase session/JWT at all) -- see twitch-live-check's header comment
// for why this differs from wcl-sync (verify_jwt: true).
//   supabase functions deploy wcl-progression-sync --no-verify-jwt
//
// Source of the "which zone/bosses" question: a team's raidProgression entry
// in team_settings.config (the same officer-curated list Season Settings'
// "Refresh from WCL" button writes, see js/tabs/tab-season.js). That array's
// bosses only carry {name, mythicDate} though -- tab-season.js's
// fetchWclForRaid() discards the encounterID WCL returned when saving, so it
// can't be trusted as the encounter-ID source here. Instead this re-queries
// WCL's own zone(id).encounters for the canonical id list every run, same
// query wcl-sync's getZoneEncounters action already uses.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

// Ported from wcl-sync's REPORT_TIME_ZONE/formatReportDate -- same
// America/New_York + early-morning-cutoff logic, kept in sync manually since
// these two functions don't share a module (matches the rest of this repo's
// one-file-per-Edge-Function style, see twitch-live-check).
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

const REPORT_LIMIT = 100;
const MYTHIC_DIFF = 5;

type RaidConfigEntry = {
  wclZoneId?: string | number;
  name?: string;
  isMiniRaid?: boolean;
};

type EncounterAgg = {
  pulls: number;
  killed: boolean;
  mythicMs: number | null;
  // Best (lowest) % remaining seen on a non-kill attempt so far.
  bestPct: number | null;
  bestReportCode: string | null;
  bestFightId: number | null;
  // The kill attempt's report/fight, once one is found.
  killReportCode: string | null;
  killFightId: number | null;
};

async function syncTeamZone(
  token: string,
  teamId: number,
  guildId: number,
  season: string,
  raid: RaidConfigEntry,
  sortIndex: number,
  supabase: ReturnType<typeof createClient>
): Promise<{ zoneName: string; encounters: number } | null> {
  const zoneId = parseInt(String(raid.wclZoneId || ''), 10);
  if (!zoneId || Number.isNaN(zoneId)) return null;

  const query = `
    query {
      worldData {
        zone(id: ${zoneId}) { name encounters { id name } }
      }
      reportData {
        reports(guildID: ${guildId}, zoneID: ${zoneId}, limit: ${REPORT_LIMIT}) {
          data {
            code
            startTime
            fights(difficulty: ${MYTHIC_DIFF}) {
              id
              encounterID
              kill
              bossPercentage
            }
          }
        }
      }
    }
  `;
  const result = await wclQuery(token, query);
  const zone = result?.data?.worldData?.zone;
  if (!zone) return null;
  const encounters: Array<{ id: number; name: string }> = zone.encounters || [];
  if (encounters.length === 0) return { zoneName: zone.name, encounters: 0 };

  const { data: zoneRow, error: zoneError } = await supabase
    .from('raid_zones')
    .upsert(
      {
        wcl_zone_id: zoneId,
        name: raid.name || zone.name || 'Unnamed Raid',
        season,
        is_mini_raid: !!raid.isMiniRaid,
        sort_index: sortIndex
      },
      { onConflict: 'wcl_zone_id,season' }
    )
    .select('id')
    .single();
  if (zoneError || !zoneRow) throw new Error(zoneError?.message || 'Failed to upsert raid_zones');

  const encounterRows = encounters.map((e, i) => ({
    zone_id: zoneRow.id,
    wcl_encounter_id: e.id,
    name: e.name,
    sort_index: i
  }));
  const { data: savedEncounters, error: encError } = await supabase
    .from('raid_encounters')
    .upsert(encounterRows, { onConflict: 'zone_id,wcl_encounter_id' })
    .select('id, wcl_encounter_id');
  if (encError) throw new Error(encError.message);

  const encounterIdByWcl = new Map<number, number>();
  for (const row of savedEncounters || []) encounterIdByWcl.set(row.wcl_encounter_id as number, row.id as number);

  const reports: Array<{ code: string; startTime: number; fights: any[] }> =
    result?.data?.reportData?.reports?.data || [];
  const agg = new Map<number, EncounterAgg>();
  function entryFor(encId: number): EncounterAgg {
    if (!agg.has(encId)) {
      agg.set(encId, {
        pulls: 0,
        killed: false,
        mythicMs: null,
        bestPct: null,
        bestReportCode: null,
        bestFightId: null,
        killReportCode: null,
        killFightId: null
      });
    }
    return agg.get(encId)!;
  }

  for (const report of reports) {
    for (const fight of report.fights || []) {
      const encId = fight.encounterID;
      if (encId == null) continue;
      const e = entryFor(encId);
      e.pulls++;
      if (fight.kill) {
        // Track the earliest kill across every report returned, not just
        // the last one iterated -- a farmed boss has many kill fights, and
        // mythic_date should be the *first* one, matching fetchProgression's
        // own "min timestamp among kills" logic in wcl-sync.
        e.killed = true;
        if (e.mythicMs === null || report.startTime < e.mythicMs) {
          e.mythicMs = report.startTime;
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

  const rows: any[] = [];
  const now = new Date().toISOString();
  for (const [wclEncId, data] of agg) {
    const encounterId = encounterIdByWcl.get(wclEncId);
    if (!encounterId) continue;
    rows.push({
      team_id: teamId,
      encounter_id: encounterId,
      mythic_date: data.killed ? data.mythicMs && formatReportDate(data.mythicMs) : null,
      mythic_pulls: data.pulls,
      mythic_best_pct: data.killed ? null : data.bestPct,
      mythic_report_code: data.killed ? data.killReportCode : data.bestReportCode,
      mythic_fight_id: data.killed ? data.killFightId : data.bestFightId,
      updated_at: now
    });
  }
  if (rows.length > 0) {
    const { error: upsertError } = await supabase
      .from('team_raid_progress')
      .upsert(rows, { onConflict: 'team_id,encounter_id' });
    if (upsertError) throw new Error(upsertError.message);
  }

  return { zoneName: zone.name, encounters: encounters.length };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const cronSecret = Deno.env.get('WCL_PROGRESS_SYNC_SECRET');
    if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
      return jsonResponse({ success: false, error: 'Not authorized' }, 401);
    }

    const clientId = Deno.env.get('WCL_CLIENT_ID');
    const clientSecret = Deno.env.get('WCL_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      return jsonResponse({ success: false, error: 'WCL credentials not configured' }, 500);
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: teams, error: teamsError } = await supabase
      .from('teams')
      .select('id, wcl_guild_id')
      .not('wcl_guild_id', 'is', null);
    if (teamsError) return jsonResponse({ success: false, error: teamsError.message }, 500);
    if (!teams || teams.length === 0) return jsonResponse({ success: true, teams: 0, synced: 0 });

    const token = await getAccessToken();
    if (!token) return jsonResponse({ success: false, error: 'Failed to get WCL access token' }, 500);

    let synced = 0;
    const errors: Array<{ teamId: number; error: string }> = [];

    for (const team of teams) {
      try {
        const { data: settingsRow } = await supabase
          .from('team_settings')
          .select('config')
          .eq('team_id', team.id)
          .maybeSingle();
        const config: any = (settingsRow as any)?.config || {};
        const raids: RaidConfigEntry[] = Array.isArray(config.raidProgression) ? config.raidProgression : [];
        if (raids.length === 0) continue;
        const season = config.seasonName || 'Unknown';

        for (let i = 0; i < raids.length; i++) {
          const outcome = await syncTeamZone(
            token,
            team.id as number,
            team.wcl_guild_id as number,
            season,
            raids[i],
            i,
            supabase
          );
          if (outcome) synced++;
        }
      } catch (err) {
        errors.push({ teamId: team.id as number, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    return jsonResponse({ success: true, teams: teams.length, synced, errors });
  } catch (err) {
    console.error('wcl-progression-sync error:', err);
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});
