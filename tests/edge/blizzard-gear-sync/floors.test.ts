// The tier's floors (#1267): season_track_floors rows for the current tier,
// read once per sync run, become the record deriveTrack() grades against.
import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { floorsFromRows, loadTierFloors } from '../../../supabase/functions/blizzard-gear-sync/floors.ts';

// Midnight Season 2's rows.
const MID2_FLOORS = [
  { track: 'Myth', item_level: 318 },
  { track: 'Hero', item_level: 305 },
  { track: 'Champion', item_level: 292 },
  { track: 'Veteran', item_level: 279 },
  { track: 'Adventurer', item_level: 266 },
  { track: 'Explorer', item_level: 207 }
];

const MID2_RECORD = { Myth: 318, Hero: 305, Champion: 292, Veteran: 279, Adventurer: 266, Explorer: 207 };

Deno.test("the tier's floor rows become the record deriveTrack grades against", () => {
  assertEquals(floorsFromRows(MID2_FLOORS), MID2_RECORD);
});

Deno.test('a tier with only some floors passes those through and fills nothing', () => {
  assertEquals(floorsFromRows(MID2_FLOORS.slice(0, 2)), { Myth: 318, Hero: 305 });
});

Deno.test('a tier with no floors gives none', () => {
  assertEquals(floorsFromRows([]), null);
});

// The fake answers rpc('current_season') and one filtered select on
// season_track_floors, recording the filter; nothing else on the client is
// faked, so any other read throws.
function floorsClient(
  opts: {
    code?: string | null;
    rows?: { track: string; item_level: number }[];
    rpcError?: string;
    rowsError?: string;
  } = {}
) {
  const reads: Array<{ table: string; columns: string; column: string; value: unknown }> = [];
  const client = {
    rpc(name: string) {
      if (name !== 'current_season') throw new Error(`unexpected rpc ${name}`);
      if (opts.rpcError) return Promise.resolve({ data: null, error: { message: opts.rpcError } });
      return Promise.resolve({ data: opts.code ?? null, error: null });
    },
    from(table: string) {
      return {
        select: (columns: string) => ({
          eq: (column: string, value: unknown) => {
            reads.push({ table, columns, column, value });
            return Promise.resolve(
              opts.rowsError
                ? { data: null, error: { message: opts.rowsError } }
                : { data: opts.rows ?? [], error: null }
            );
          }
        })
      };
    }
  };
  return { client: client as any, reads };
}

Deno.test("loadTierFloors: reads the current tier's floors by its code", async () => {
  const { client, reads } = floorsClient({ code: 'MID2', rows: MID2_FLOORS });
  assertEquals(await loadTierFloors(client), MID2_RECORD);
  assertEquals(reads, [
    { table: 'season_track_floors', columns: 'track, item_level', column: 'season', value: 'MID2' }
  ]);
});

Deno.test('loadTierFloors: no current tier means no floors, and no floors read', async () => {
  const { client, reads } = floorsClient({ code: null });
  assertEquals(await loadTierFloors(client), null);
  assertEquals(reads, []);
});

Deno.test('loadTierFloors: a current tier with no floor rows means no floors', async () => {
  const { client } = floorsClient({ code: 'MID3', rows: [] });
  assertEquals(await loadTierFloors(client), null);
});

Deno.test('loadTierFloors: a failed tier read stops the run rather than grading with no floors', async () => {
  const { client, reads } = floorsClient({ rpcError: 'boom' });
  await assertRejects(() => loadTierFloors(client), Error, 'boom');
  assertEquals(reads, []);
});

Deno.test('loadTierFloors: a failed floors read stops the run', async () => {
  const { client } = floorsClient({ code: 'MID2', rowsError: 'down' });
  await assertRejects(() => loadTierFloors(client), Error, 'down');
});
