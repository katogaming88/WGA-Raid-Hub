// wcl-sync (#223): ports WarcraftLogs API access out of Apps Script
// (gs/WCL.gs, gs/Attendance.gs, gs/wgaWebApp.gs) into a Supabase Edge
// Function. Stage 1 only: the two read-only WCL proxies that power Season
// Settings' raid progression picker (getWclZoneEncounters, fetchWclProgression
// in the GAS source). Stages 2/3 (WCL performance scoring, attendance sync)
// add more actions to this same dispatcher later.
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
    return new Date(ms).toISOString().slice(0, 10);
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

    return jsonResponse({ success: false, error: 'Unknown action: ' + action });
  } catch (err) {
    console.error('wcl-sync error:', err);
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});
