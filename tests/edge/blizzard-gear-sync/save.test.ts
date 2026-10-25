// Saving a character's gear (#1628): every slot Blizzard returned is
// upserted, then any other slot on file for that character is removed, so an
// off hand dropped for a two-hander stops counting as worn. Nothing is
// removed unless the save worked and Blizzard returned at least one slot.
import { assertEquals } from 'jsr:@std/assert@1';
import { saveGear } from '../../../supabase/functions/blizzard-gear-sync/save.ts';
import type { EquippedRow } from '../../../supabase/functions/blizzard-gear-sync/rows.ts';

type Call = { table: string; op: string; args: unknown[] };

// Records every chained call; each chain resolves to the error named for its
// first op (upsert or delete), if any.
function fakeClient(errors: { upsert?: string; delete?: string } = {}) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      let op = '';
      const b: any = {};
      for (const name of ['upsert', 'delete', 'eq', 'not']) {
        b[name] = (...args: unknown[]) => {
          if (!op) op = name;
          calls.push({ table, op: name, args });
          return b;
        };
      }
      b.then = (ok: (v: unknown) => unknown) => {
        const msg = (errors as Record<string, string | undefined>)[op];
        return Promise.resolve({ error: msg ? { message: msg } : null }).then(ok);
      };
      return b;
    }
  };
  return { client: client as any, calls };
}

function row(slot: string): EquippedRow {
  return {
    player_id: 7,
    team_id: 1,
    equipment_slot: slot,
    wow_item_id: 1,
    item_level: 300,
    track: null,
    bonus_list: []
  };
}

Deno.test('an emptied off hand is removed: every slot not returned goes', async () => {
  const { client, calls } = fakeClient();
  const error = await saveGear(client, 7, [row('HEAD'), row('MAIN_HAND')]);
  assertEquals(error, null);
  assertEquals(
    calls.map((c) => c.op),
    ['upsert', 'delete', 'eq', 'not']
  );
  assertEquals(calls[2].args, ['player_id', 7]);
  assertEquals(calls[3].args, ['equipment_slot', 'in', '("HEAD","MAIN_HAND")']);
});

Deno.test('a failed save removes nothing', async () => {
  const { client, calls } = fakeClient({ upsert: 'boom' });
  const error = await saveGear(client, 7, [row('HEAD')]);
  assertEquals(error, 'boom');
  assertEquals(
    calls.some((c) => c.op === 'delete'),
    false
  );
});

Deno.test('a reply with no slots removes nothing', async () => {
  const { client, calls } = fakeClient();
  assertEquals(await saveGear(client, 7, []), null);
  assertEquals(calls, []);
});

Deno.test('a failed removal is reported', async () => {
  const { client } = fakeClient({ delete: 'nope' });
  assertEquals(await saveGear(client, 7, [row('HEAD')]), 'nope');
});
