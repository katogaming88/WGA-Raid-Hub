// The title rule (#1469): a report is a guild's alt run when its title has
// "Alt" as its own word, the rule attendance has applied since #1246 found
// "Altar" in a boss name excluding a real raid night. Both syncs read it from
// here. Case-sensitive, as wcl-sync has always applied it.
import { assertEquals } from 'jsr:@std/assert@1';
import { isAltRun } from '../../../supabase/functions/_shared/alt-run.ts';

Deno.test('a title with Alt as its own word is an alt run', () => {
  assertEquals(isAltRun('Phoenix Alt run'), true);
  assertEquals(isAltRun('Alt'), true);
  assertEquals(isAltRun('Mythic (Alt)'), true);
});

Deno.test('Alt inside a longer word is not', () => {
  assertEquals(isAltRun('Phoenix Heroic 8/27 - The Coiled Altar (Best 9.63% P3, 17 Pulls)'), false);
  assertEquals(isAltRun('Salt Flats'), false);
});

Deno.test('a lower-case alt is not', () => {
  assertEquals(isAltRun('phoenix alt run'), false);
});

Deno.test('a missing or empty title is not', () => {
  assertEquals(isAltRun(null), false);
  assertEquals(isAltRun(undefined), false);
  assertEquals(isAltRun(''), false);
});
