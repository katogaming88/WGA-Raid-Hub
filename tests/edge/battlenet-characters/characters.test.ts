// battlenet-characters' pure half: reading Blizzard's answers and choosing
// what a raider is shown and what may be saved.
import { assertEquals } from 'jsr:@std/assert@1';
import {
  MAX_LEVEL,
  atMaxLevel,
  battlenetAccountIdOf,
  charactersOf,
  detailOf,
  pickedFrom,
  summaryPath
} from '../../../supabase/functions/battlenet-characters/characters.ts';

// The shape /profile/user/wow answers with, trimmed to the fields read.
export const PROFILE = {
  wow_accounts: [
    {
      id: 1,
      characters: [
        {
          id: 101,
          name: 'Grihz',
          realm: { name: 'Illidan', slug: 'illidan' },
          playable_class: { name: 'Shaman' },
          level: 90
        },
        {
          id: 102,
          name: 'Lowbie',
          realm: { name: 'Area 52', slug: 'area-52' },
          playable_class: { name: 'Mage' },
          level: 12
        }
      ]
    },
    {
      id: 2,
      characters: [
        {
          id: 201,
          name: 'Ëlune',
          realm: { name: "Kel'Thuzad", slug: 'kelthuzad' },
          playable_class: { name: 'Priest' },
          level: 90
        },
        { id: 202, realm: { name: 'Illidan', slug: 'illidan' }, level: 90 }
      ]
    }
  ]
};

Deno.test('the account id is the userinfo sub, falling back to the numeric id', () => {
  assertEquals(battlenetAccountIdOf({ sub: '123', id: 123, battletag: 'Kat#1' }), '123');
  assertEquals(battlenetAccountIdOf({ id: 456 }), '456');
  assertEquals(battlenetAccountIdOf({}), null);
  assertEquals(battlenetAccountIdOf(null), null);
});

Deno.test('reads every character on every WoW account, dropping entries with no name', () => {
  assertEquals(charactersOf(PROFILE), [
    { blizzard_id: 101, name: 'Grihz', realm: 'Illidan', realm_slug: 'illidan', class_name: 'Shaman', level: 90 },
    { blizzard_id: 102, name: 'Lowbie', realm: 'Area 52', realm_slug: 'area-52', class_name: 'Mage', level: 12 },
    { blizzard_id: 201, name: 'Ëlune', realm: "Kel'Thuzad", realm_slug: 'kelthuzad', class_name: 'Priest', level: 90 }
  ]);
  assertEquals(charactersOf({}), []);
  assertEquals(charactersOf(null), []);
});

Deno.test('only max-level characters are shown', () => {
  assertEquals(MAX_LEVEL, 90);
  assertEquals(
    atMaxLevel(charactersOf(PROFILE)).map((c) => c.blizzard_id),
    [101, 201]
  );
});

Deno.test('spec and item level come from the summary, and a locked profile gives nulls', () => {
  assertEquals(detailOf({ active_spec: { name: 'Restoration' }, equipped_item_level: 704 }), {
    spec_name: 'Restoration',
    item_level: 704
  });
  assertEquals(detailOf(null), { spec_name: null, item_level: null });
});

Deno.test('a pick keeps only ids the raider was shown; no save field means no save', () => {
  const shown = atMaxLevel(charactersOf(PROFILE)).map((c) => ({ ...c, spec_name: null, item_level: null }));
  assertEquals(
    pickedFrom(shown, [201, 102, 999, '101']).map((c) => c.blizzard_id),
    [201]
  );
  assertEquals(pickedFrom(shown, []), []);
  assertEquals(pickedFrom(shown, 'nonsense'), []);
  assertEquals(pickedFrom(shown, undefined), null);
});

Deno.test('the summary path lower-cases and encodes the name', () => {
  assertEquals(
    summaryPath({
      blizzard_id: 201,
      name: 'Ëlune',
      realm: "Kel'Thuzad",
      realm_slug: 'kelthuzad',
      class_name: null,
      level: 90
    }),
    '/profile/wow/character/kelthuzad/%C3%ABlune'
  );
});
