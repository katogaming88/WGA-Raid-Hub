import { describe, it, expect } from 'vitest';
import {
  resolveTarget,
  linkRequest,
  listRequest,
  personaNames,
  readLink,
  login
} from '../../scripts/dev/local-login.js';

// The local sign-in script (#1053, #1065). It mints a magic link through the
// local auth admin API and prints it; opening it puts a session in the browser,
// because supabase-js defaults to the implicit flow with detectSessionInUrl on,
// so nothing in js/ changes to support this.
//
// Everything here runs with the HTTP call injected. The script is the only
// thing in the repo that talks to the auth admin API, and a test that needed a
// running stack would be skipped on the machine that most needs it to work.
// What is worth pinning is the shape: the request bodies, where the link is
// read from, the two ways a target is named, and that a name the stack does
// not hold is refused before anything is minted (#1065).

const STATUS = {
  API_URL: 'http://127.0.0.1:54321',
  SERVICE_ROLE_KEY: 'service-role-key-for-tests'
};

const LINK = 'http://localhost:3000/#t';

/** A fetch that answers the list with these accounts and mints for anything else. */
function stackWith(names, calls = []) {
  return (url, options) => {
    calls.push({ url, options });
    if (url.includes('/admin/users')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ users: names.map((name) => ({ email: `${name}@wga.local` })) })
      });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ action_link: LINK }) });
  };
}

describe('resolveTarget (#1065)', () => {
  it('turns any persona name into its wga.local address, on either stack', () => {
    // The seed and a snapshot name their people the same way, and the list of
    // who exists comes from the running stack rather than from a table here.
    expect(resolveTarget({ persona: 'phoenix-officer' })).toEqual({ email: 'phoenix-officer@wga.local' });
    expect(resolveTarget({ persona: 'admin' })).toEqual({ email: 'admin@wga.local' });
  });

  it('turns a Discord id into an address of its own, and carries the id', () => {
    // This is the path for one specific real person on a restored snapshot:
    // the grant rows are real and their auth links are nulled, so a new
    // account whose provider_id matches one of them gets linked by the trigger.
    expect(resolveTarget({ discordId: '123456789012345678' })).toEqual({
      email: '123456789012345678@wga.local',
      discordId: '123456789012345678'
    });
  });

  it('refuses a name that is not a valid address local part', () => {
    expect(() => resolveTarget({ persona: 'Phoenix Officer' })).toThrow(/persona name/i);
    expect(() => resolveTarget({ persona: 'a@b' })).toThrow(/persona name/i);
  });

  it('refuses being given neither', () => {
    expect(() => resolveTarget({})).toThrow(/persona|discord/i);
  });

  it('refuses a Discord id that is not one', () => {
    // A typo here would mint an account that links to nothing, and the symptom
    // would be a successful sign-in with no access.
    expect(() => resolveTarget({ discordId: 'not-an-id' })).toThrow(/Discord id/);
  });
});

describe('linkRequest (#1053)', () => {
  const built = linkRequest(STATUS, { email: 'phoenix-officer@wga.local' });

  it('posts to the admin generate_link endpoint on the local API', () => {
    expect(built.url).toBe('http://127.0.0.1:54321/auth/v1/admin/generate_link');
    expect(built.options.method).toBe('POST');
  });

  it('asks for a magiclink for that address', () => {
    expect(JSON.parse(built.options.body)).toEqual({ type: 'magiclink', email: 'phoenix-officer@wga.local' });
  });

  it('authorises with the local service role key in both headers the API wants', () => {
    expect(built.options.headers.apikey).toBe(STATUS.SERVICE_ROLE_KEY);
    expect(built.options.headers.Authorization).toBe(`Bearer ${STATUS.SERVICE_ROLE_KEY}`);
  });
});

describe('listRequest and personaNames (#1065)', () => {
  const built = listRequest(STATUS);

  it('reads the admin user list on the local API, with both auth headers', () => {
    expect(built.url).toMatch(/^http:\/\/127\.0\.0\.1:54321\/auth\/v1\/admin\/users(\?|$)/);
    expect(built.options.headers.apikey).toBe(STATUS.SERVICE_ROLE_KEY);
    expect(built.options.headers.Authorization).toBe(`Bearer ${STATUS.SERVICE_ROLE_KEY}`);
  });

  it('keeps only the wga.local accounts, as bare names, sorted', () => {
    // A real Discord id signed in through --discord-id also lives at
    // <id>@wga.local, so it is listed too: it is an account on this stack.
    // Anything else in auth.users is not a persona.
    const names = personaNames({
      users: [
        { email: 'phoenix-raider@wga.local' },
        { email: 'someone@example.com' },
        { email: 'admin@wga.local' },
        { email: null }
      ]
    });
    expect(names).toEqual(['admin', 'phoenix-raider']);
  });

  it('reads an empty stack as no names rather than failing', () => {
    expect(personaNames({ users: [] })).toEqual([]);
    expect(personaNames({})).toEqual([]);
  });
});

describe('readLink (#1053)', () => {
  it('takes the action link out of the response', () => {
    expect(readLink({ action_link: 'http://localhost:3000/#access_token=x' })).toBe(
      'http://localhost:3000/#access_token=x'
    );
  });

  it('takes it from the nested properties shape too', () => {
    expect(readLink({ properties: { action_link: 'http://localhost:3000/#b' } })).toBe('http://localhost:3000/#b');
  });

  it('refuses a response with no link rather than printing undefined', () => {
    expect(() => readLink({ msg: 'nope' })).toThrow(/link/i);
  });
});

describe('login (#1053, #1065)', () => {
  it('returns the link for a persona the stack holds', async () => {
    const calls = [];
    const link = await login(
      { persona: 'phoenix-officer' },
      { status: () => STATUS, fetch: stackWith(['phoenix-officer', 'admin'], calls) }
    );
    expect(link).toBe(LINK);
    const mint = calls.find((c) => c.url.endsWith('/generate_link'));
    expect(JSON.parse(mint.options.body)).toEqual({ type: 'magiclink', email: 'phoenix-officer@wga.local' });
  });

  it('refuses a persona the stack does not hold, names the ones it does, and mints nothing', async () => {
    // This is the failure #1065 exists for. On a restored snapshot the seeded
    // people are gone, and generate_link for an unknown address creates the
    // account: a successful sign-in with no grant row, which reads as broken
    // policies. The list is read first, and an absent name stops here.
    const calls = [];
    await expect(
      login({ persona: 'officer' }, { status: () => STATUS, fetch: stackWith(['phoenix-officer', 'admin'], calls) })
    ).rejects.toThrow(/Nothing was created/);
    await expect(
      login({ persona: 'officer' }, { status: () => STATUS, fetch: stackWith(['phoenix-officer', 'admin'], []) })
    ).rejects.toThrow(/admin, phoenix-officer/);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toContain('/admin/users');
  });

  it('lists what the stack holds when given no name at all', async () => {
    await expect(login({}, { status: () => STATUS, fetch: stackWith(['hellfire-leader', 'admin']) })).rejects.toThrow(
      /admin, hellfire-leader/
    );
  });

  it('passes the Discord id as user metadata, and never consults the list for it', async () => {
    // --discord-id is the deliberate mint-or-reuse route, so the existence
    // check does not apply to it.
    const calls = [];
    await login({ discordId: '123456789012345678' }, { status: () => STATUS, fetch: stackWith([], calls) });
    expect(calls.length).toBe(1);
    expect(calls[0].url).toContain('/generate_link');
    expect(JSON.parse(calls[0].options.body).data).toEqual({ provider_id: '123456789012345678' });
  });

  it('says the stack is down rather than throwing a connection error', async () => {
    await expect(
      login(
        { persona: 'phoenix-officer' },
        {
          status: () => {
            throw new Error('spawn supabase ENOENT');
          },
          fetch: stackWith(['phoenix-officer'])
        }
      )
    ).rejects.toThrow(/supabase start/);
  });

  it('reports what the auth API said when it refuses to mint', async () => {
    const fetch = (url) =>
      url.includes('/admin/users')
        ? stackWith(['phoenix-officer'])(url)
        : Promise.resolve({ ok: false, status: 422, text: () => Promise.resolve('User not found') });
    await expect(login({ persona: 'phoenix-officer' }, { status: () => STATUS, fetch })).rejects.toThrow(
      /422|User not found/
    );
  });
});
