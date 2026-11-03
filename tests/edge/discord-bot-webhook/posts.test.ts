// What discord-bot-webhook posts (#959): each notice as the bot process posted
// it, and every one naming whom it may ping. The bot holds Mention Everyone
// (Kat, 2026-10-29), so `parse: []` is the only thing keeping an "@everyone"
// typed into a note from pinging the whole server.
import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import {
  MissingFields,
  QUEUED_ACTIONS,
  buildPost,
  buildReminder
} from '../../../supabase/functions/discord-bot-webhook/posts.ts';

const ROLE = '300000000000000003';
const AT = '2026-11-01T14:00:00.000Z';

// One payload per channel post, with "@everyone" in every free-text field.
export const PAYLOADS: Record<string, Record<string, unknown>> = {
  signup: {
    charName: '@everyone',
    realm: 'Stormrage',
    className: 'Warlock',
    mainSpec: 'Demonology',
    offSpecs: '@here',
    role: 'DPS',
    notes: '@everyone hi'
  },
  addCharacter: { member: '@everyone', nameRealm: 'Katorrí-Stormrage', classSpec: 'Warlock Demonology DPS' },
  selfreceived: { player: 'Katorrí-Stormrage', item: '@everyone', slot: 'Trinket', source: 'Vault', notes: '@here' },
  bis: { nameRealm: 'Katorrí-Stormrage', bisLink: 'https://example.com/bis', notes: '@everyone' },
  mplus: { nameRealm: 'Katorrí-Stormrage', raiderioUrl: 'https://raider.io/x', notes: '@everyone' },
  rsvp: { charName: '@everyone', raidDate: '2026-11-04', status: 'Late', note: '@here' },
  mainswap: { fromNameRealm: '@everyone', toNameRealm: 'Katalt-Stormrage', spec: 'Demonology Warlock', notes: '@here' }
};

const CHANNEL_POSTS = [...QUEUED_ACTIONS];

Deno.test('every queued channel post has a payload here, so the checks below cover all of them', () => {
  assertEquals(CHANNEL_POSTS.sort(), Object.keys(PAYLOADS).sort());
});

Deno.test('every channel post parses no mentions and allows only the team role', () => {
  for (const action of CHANNEL_POSTS) {
    const withRole = buildPost(action, PAYLOADS[action], ROLE, AT);
    const noRole = buildPost(action, PAYLOADS[action], null, AT);
    assertEquals(noRole.allowed_mentions, { parse: [], roles: [], users: [] }, action);
    assertEquals(noRole.content, undefined, action);
    // addCharacter never pings, even with a role set (officers hear of adds).
    assertEquals(
      withRole.allowed_mentions,
      { parse: [], roles: action === 'addCharacter' ? [] : [ROLE], users: [] },
      action
    );
  }
});

Deno.test('the reminder DM parses no mentions', () => {
  const dm = buildReminder({ discordId: '400000000000000004', checkpoint: '24h', raidDate: '2026-11-04' });
  assertEquals(dm.allowed_mentions, { parse: [], roles: [], users: [] });
});

Deno.test('the ping goes in front of the line the bot used to post', () => {
  assertEquals(buildPost('mplus', PAYLOADS.mplus, ROLE, AT).content, `<@&${ROLE}> New M+ exclusion request received!`);
  assertEquals(
    buildPost('rsvp', PAYLOADS.rsvp, ROLE, AT).content,
    `<@&${ROLE}> @everyone marked themselves Late for 2026-11-04`
  );
  assertEquals(
    buildPost('bis', { ...PAYLOADS.bis, sameLink: true }, ROLE, AT).content,
    `<@&${ROLE}> BiS Source items changed (same link) -- please recheck!`
  );
});

Deno.test('the signup embed carries the fields the bot posted', () => {
  const embed = buildPost(
    'signup',
    { ...PAYLOADS.signup, charName: 'Katorrí', mainSwap: true, swapFromNameRealm: 'Old-Stormrage', notes: '' },
    null,
    AT
  ).embeds[0];
  assertEquals(embed.title, 'New Raid Signup');
  assertEquals(
    embed.fields?.map((f) => [f.name, f.value]),
    [
      ['Character', 'Katorrí-Stormrage'],
      ['Class / Main Spec', 'Warlock — Demonology'],
      ['Role', 'DPS'],
      ['Off Specs', '@here'],
      ['Discord', '*(not provided)*'],
      ['Main Swap', 'Yes, from Old-Stormrage'],
      ['Submitted At', '<t:1793541600:f>'],
      ['Notes', '*(none)*']
    ]
  );
});

Deno.test('a field longer than Discord allows is cut, not refused', () => {
  const embed = buildPost('bis', { ...PAYLOADS.bis, notes: 'x'.repeat(5000) }, null, AT).embeds[0];
  assertEquals(embed.fields?.find((f) => f.name === 'Notes')?.value.length, 1024);
});

Deno.test('an M+ request with no Raider.io link still posts, saying so', () => {
  const embed = buildPost('mplus', { nameRealm: 'Katorrí-Stormrage', raiderioUrl: null }, null, AT).embeds[0];
  assertEquals(embed.fields[2], { name: 'Raider.io / Profile', value: '*(none)*' });
});

Deno.test('a main swap request names both characters, the spec and the note', () => {
  const message = buildPost(
    'mainswap',
    { fromNameRealm: 'Katorrí-Stormrage', toNameRealm: 'Katalt-Stormrage', spec: 'Demonology Warlock', notes: null },
    ROLE,
    AT
  );
  assertEquals(message.content, `<@&${ROLE}> New main swap request received!`);
  assertEquals(
    message.embeds[0].fields?.map((f) => [f.name, f.value]),
    [
      ['Raider', 'Katorrí-Stormrage'],
      ['Swapping To', 'Katalt-Stormrage, Demonology Warlock'],
      ['Submitted At', '<t:1793541600:f>'],
      ['Notes', '*(none)*']
    ]
  );
});

Deno.test('a post missing what it needs is refused', () => {
  assertThrows(() => buildPost('rsvp', { charName: 'Katorrí-Stormrage' }, null, AT), MissingFields);
  assertThrows(() => buildPost('mplus', { raiderioUrl: 'https://raider.io/x' }, null, AT), MissingFields);
  assertThrows(() => buildPost('mainswap', { fromNameRealm: 'Katorrí-Stormrage' }, null, AT), MissingFields);
  assertThrows(() => buildReminder({ checkpoint: '2h' }), MissingFields);
});
