import { describe, it, expect } from 'vitest';
import { loadCommonJs, quietConsole } from './helpers/common-sandbox.js';
import { keysetClient, failingClient } from './helpers/supabase-mock.js';

// fetchSupabaseEquippedGear filters on the table's own team_id and pages
// through the shared helper (#944).
//
// player_equipped_gear carries team_id since #944, so the read no longer
// joins through players to find the team. That join was also what kept the
// read out of scripts/ci/team-wide-read-check.js, which recognises a
// team-wide read by .eq('team_id', ...): a table of sixteen slots per player
// crosses the 1000-row cap at 63 players, and the unpaged read truncated
// there with no error, same as every other member of the #694 family.

const TEAM_ID = 3;

function gearRows(total, startId = 1) {
  const rows = [];
  for (let i = 0; i < total; i++) {
    rows.push({
      id: startId + i,
      player_id: Math.floor(i / 16) + 1,
      equipment_slot: 'SLOT_' + (i % 16),
      item_id: 200000 + i,
      item_level: 300,
      track: 'Hero'
    });
  }
  return rows;
}

// The shared keyset client honours .eq() without recording it, and which
// column the read filters on is the point here, so the wrapper records it.
function load(client) {
  const sandbox = loadCommonJs(quietConsole);
  const eqs = [];
  sandbox.supabaseClient = {
    from(table) {
      const inner = client.from(table);
      return {
        select(...args) {
          const b = inner.select(...args);
          const eq = b.eq;
          b.eq = (col, val) => {
            eqs.push([col, val]);
            return eq.call(b, col, val);
          };
          return b;
        }
      };
    }
  };
  sandbox._teamCfg = { supabaseTeamId: TEAM_ID };
  return { sandbox, eqs };
}

describe('fetchSupabaseEquippedGear (#944)', () => {
  it('resolves null when the CDN script never loaded', async () => {
    const sandbox = loadCommonJs(quietConsole);
    await expect(sandbox.fetchSupabaseEquippedGear()).resolves.toBeNull();
  });

  it('filters on the table team column rather than joining through players', async () => {
    const { client, calls } = keysetClient(gearRows(5));
    const { sandbox, eqs } = load(client);
    await sandbox.fetchSupabaseEquippedGear();
    expect(eqs).toEqual([['team_id', TEAM_ID]]);
    expect(calls.selects[0].select).not.toContain('players');
  });

  it('selects id, which the keyset cursor needs, alongside the mapped columns', async () => {
    const { client, calls } = keysetClient(gearRows(5));
    const { sandbox } = load(client);
    await sandbox.fetchSupabaseEquippedGear();
    const cols = calls.selects[0].select;
    ['id', 'player_id', 'equipment_slot', 'item_id', 'item_level', 'track'].forEach((col) => {
      expect(cols).toContain(col);
    });
  });

  it('collects every row across pages, each exactly once', async () => {
    const { client, calls } = keysetClient(gearRows(2400));
    const { sandbox } = load(client);
    const rows = await sandbox.fetchSupabaseEquippedGear();
    expect(rows).toHaveLength(2400);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2400);
    expect(calls.gts).toEqual([
      ['id', 1000],
      ['id', 2000]
    ]);
    expect(calls.orders.every((col) => col === 'id')).toBe(true);
  });

  it('resolves an empty array for a team with no synced gear, distinct from a failed read', async () => {
    const { client } = keysetClient([]);
    const { sandbox } = load(client);
    await expect(sandbox.fetchSupabaseEquippedGear()).resolves.toEqual([]);
  });

  it('resolves null when the read fails', async () => {
    const { client } = failingClient('gear boom');
    const { sandbox } = load(client);
    await expect(sandbox.fetchSupabaseEquippedGear()).resolves.toBeNull();
  });
});
