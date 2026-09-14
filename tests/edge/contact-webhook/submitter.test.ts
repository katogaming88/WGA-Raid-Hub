// #1135: the contact form's submitter identity comes from current_discord_id(),
// which reads auth.identities, and no longer from user metadata the caller can
// rewrite. The report renders that id as a <@mention>, so taking it from
// metadata let anyone have their report ping somebody else.
import { assertEquals } from 'jsr:@std/assert@1';
import { resolveSubmitter, type SubmitterClient } from '../../../supabase/functions/contact-webhook/submitter.ts';

// A caller whose metadata claims one Discord id while the RPC, which reads the
// identity row, answers with another or with nothing.
function client(
  user: unknown,
  rpcResult: { data: unknown; error: unknown } = { data: null, error: null }
): SubmitterClient {
  return {
    auth: { getUser: () => Promise.resolve({ data: { user } }) },
    rpc: () => Promise.resolve(rpcResult)
  };
}

const withMeta = (meta: Record<string, unknown>) => ({ user_metadata: meta });

Deno.test('no Authorization header is the anonymous path, not an error', async () => {
  const got = await resolveSubmitter(null, () => {
    throw new Error('should not build a client');
  });
  assertEquals(got, null);
});

Deno.test('a token nobody is behind resolves to nobody', async () => {
  const got = await resolveSubmitter('Bearer x', () => client(null));
  assertEquals(got, null);
});

Deno.test('the Discord id comes from the RPC, not from metadata', async () => {
  const got = await resolveSubmitter('Bearer x', () =>
    client(withMeta({ provider_id: 'discord-someone-else', full_name: 'Rex' }), {
      data: 'discord-really-them',
      error: null
    })
  );
  assertEquals(got, { discordId: 'discord-really-them', username: 'Rex' });
});

Deno.test('metadata alone attributes nothing when the account holds no Discord identity', async () => {
  const got = await resolveSubmitter('Bearer x', () =>
    client(withMeta({ provider_id: 'discord-someone-else', name: 'Rex' }), { data: null, error: null })
  );
  assertEquals(got, { discordId: null, username: 'Rex' });
});

Deno.test('a failed lookup sends the report unattributed rather than dropping it', async () => {
  const got = await resolveSubmitter('Bearer x', () =>
    client(withMeta({ full_name: 'Rex' }), { data: 'discord-x', error: { message: 'boom' } })
  );
  assertEquals(got, { discordId: null, username: 'Rex' });
});
