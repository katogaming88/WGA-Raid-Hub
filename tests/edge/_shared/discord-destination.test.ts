// The destination resolver (#1081). A function decides where a webhook post
// goes from its own SUPABASE_URL: the one production host posts to the live
// name, anything else is a local stack and posts to the test webhook marked
// [local] with nobody pinged. Expectations are the rows decided before the
// module exists; nothing here is a real webhook URL.
import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import {
  DESTINATIONS,
  PRODUCTION_HOST,
  allowedMentions,
  isLocalStack,
  isProductionStack,
  marker,
  resolveDestination
} from '../../../supabase/functions/_shared/discord-destination.ts';
import {
  FINDER_ID,
  FOUND_WEBHOOK_URL,
  LEGACY_WEBHOOK_URL,
  LOCAL_STACK_SUPABASE_URL,
  PRODUCTION_SUPABASE_URL,
  SOLD_WEBHOOK_URL,
  TEST_WEBHOOK_URL,
  envOf
} from '../_support/corpus.ts';

const CONTACT_WEBHOOK_URL = 'https://discord.test/api/webhooks/contact';

const LIVE_NAMES = {
  BOE_SOLD_WEBHOOK_URL: SOLD_WEBHOOK_URL,
  BOE_WEBHOOK_URL: FOUND_WEBHOOK_URL,
  'BOE-Found-Webhook': LEGACY_WEBHOOK_URL,
  CONTACT_WEBHOOK_URL
};

const production = (values: Record<string, string> = {}) => envOf({ SUPABASE_URL: PRODUCTION_SUPABASE_URL, ...values });
const local = (values: Record<string, string> = {}) => envOf({ SUPABASE_URL: LOCAL_STACK_SUPABASE_URL, ...values });

Deno.test('PRODUCTION_HOST is the project host js/common.js publishes', () => {
  assertEquals(PRODUCTION_HOST, 'kxgjqnpwfklbgrxdgmmv.supabase.co');
});

Deno.test('the registry names the three posters and their env chains, sold falling through to found', () => {
  assertEquals(DESTINATIONS, {
    'boe-found': ['BOE_WEBHOOK_URL', 'BOE-Found-Webhook'],
    'boe-sold': ['BOE_SOLD_WEBHOOK_URL', 'BOE_WEBHOOK_URL', 'BOE-Found-Webhook'],
    contact: ['CONTACT_WEBHOOK_URL']
  });
});

Deno.test('only the exact production host is production; scheme, case and port are ignored', () => {
  for (const url of [
    PRODUCTION_SUPABASE_URL,
    'https://KXGJQNPWFKLBGRXDGMMV.supabase.co',
    'https://kxgjqnpwfklbgrxdgmmv.supabase.co:443',
    'http://kxgjqnpwfklbgrxdgmmv.supabase.co'
  ]) {
    assertEquals(isProductionStack(envOf({ SUPABASE_URL: url })), true, url);
    assertEquals(isLocalStack(envOf({ SUPABASE_URL: url })), false, url);
  }
});

Deno.test('any other host, an absent URL or an unparsable one is a local stack', () => {
  const others = [
    LOCAL_STACK_SUPABASE_URL,
    'http://127.0.0.1:54321',
    'https://abc.supabase.co',
    'https://kxgjqnpwfklbgrxdgmmv.supabase.co.evil.test',
    'not a url'
  ];
  for (const url of others) {
    assertEquals(isProductionStack(envOf({ SUPABASE_URL: url })), false, url);
    assertEquals(isLocalStack(envOf({ SUPABASE_URL: url })), true, url);
  }
  assertEquals(isProductionStack(envOf({})), false);
  assertEquals(isLocalStack(envOf({})), true);
});

Deno.test('on production the sold post takes the first set name in its chain', () => {
  const rows: [Record<string, string>, string, string][] = [
    [LIVE_NAMES, SOLD_WEBHOOK_URL, 'BOE_SOLD_WEBHOOK_URL'],
    [
      { BOE_WEBHOOK_URL: FOUND_WEBHOOK_URL, 'BOE-Found-Webhook': LEGACY_WEBHOOK_URL },
      FOUND_WEBHOOK_URL,
      'BOE_WEBHOOK_URL'
    ],
    [{ 'BOE-Found-Webhook': LEGACY_WEBHOOK_URL }, LEGACY_WEBHOOK_URL, 'BOE-Found-Webhook']
  ];
  for (const [values, url, via] of rows) {
    assertEquals(resolveDestination(production(values), { destination: 'boe-sold' }), {
      kind: 'post',
      url,
      source: 'production',
      via
    });
  }
});

Deno.test('on production the found post reads the documented name, then the dashboard one', () => {
  assertEquals(resolveDestination(production(LIVE_NAMES), { destination: 'boe-found' }), {
    kind: 'post',
    url: FOUND_WEBHOOK_URL,
    source: 'production',
    via: 'BOE_WEBHOOK_URL'
  });
  assertEquals(
    resolveDestination(production({ 'BOE-Found-Webhook': LEGACY_WEBHOOK_URL }), { destination: 'boe-found' }),
    {
      kind: 'post',
      url: LEGACY_WEBHOOK_URL,
      source: 'production',
      via: 'BOE-Found-Webhook'
    }
  );
});

Deno.test('on production the contact post reads its one name', () => {
  assertEquals(resolveDestination(production(LIVE_NAMES), { destination: 'contact' }), {
    kind: 'post',
    url: CONTACT_WEBHOOK_URL,
    source: 'production',
    via: 'CONTACT_WEBHOOK_URL'
  });
});

Deno.test('on production with nothing set the post is skipped with no reason, as today', () => {
  for (const destination of ['boe-found', 'boe-sold', 'contact']) {
    assertEquals(resolveDestination(production(), { destination }), { kind: 'skip' }, destination);
  }
});

Deno.test('on production the test webhook is never the destination, even when it is the only name set', () => {
  assertEquals(
    resolveDestination(production({ DISCORD_TEST_WEBHOOK_URL: TEST_WEBHOOK_URL }), { destination: 'boe-found' }),
    {
      kind: 'skip'
    }
  );
});

Deno.test('on a local stack every post goes to the test webhook, whatever live names are set', () => {
  const env = local({ ...LIVE_NAMES, DISCORD_TEST_WEBHOOK_URL: TEST_WEBHOOK_URL });
  for (const destination of ['boe-found', 'boe-sold', 'contact']) {
    assertEquals(
      resolveDestination(env, { destination }),
      { kind: 'post', url: TEST_WEBHOOK_URL, source: 'local', via: 'DISCORD_TEST_WEBHOOK_URL' },
      destination
    );
  }
});

Deno.test('on a local stack with no test webhook the post is skipped naming the variable, never a live name', () => {
  const env = local(LIVE_NAMES);
  for (const destination of ['boe-found', 'boe-sold', 'contact']) {
    assertEquals(
      resolveDestination(env, { destination }),
      { kind: 'skip', reason: 'DISCORD_TEST_WEBHOOK_URL is not set on this local stack' },
      destination
    );
  }
});

Deno.test('an unknown destination key throws rather than skipping quietly', () => {
  assertThrows(() => resolveDestination(production(LIVE_NAMES), { destination: 'boe-fond' }), Error, 'boe-fond');
});

Deno.test('the marker names a local post and is absent on production', () => {
  assertEquals(marker('local'), '[local]');
  assertEquals(marker('production'), null);
});

Deno.test('allowed mentions keep the users on production and nobody on a local stack, parse empty on both', () => {
  assertEquals(allowedMentions('production', [FINDER_ID]), { parse: [], users: [FINDER_ID] });
  assertEquals(allowedMentions('local', [FINDER_ID]), { parse: [], users: [] });
  assertEquals(allowedMentions('production', []), { parse: [], users: [] });
});
