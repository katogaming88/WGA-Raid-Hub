import { describe, it, expect } from 'vitest';
import { PERSONAS, resolveTarget, linkRequest, readLink, login } from '../../scripts/dev/local-login.js';

// The local sign-in script (#1053). It mints a magic link through the local
// auth admin API and prints it; opening it puts a session in the browser,
// because supabase-js defaults to the implicit flow with detectSessionInUrl on,
// so nothing in js/ changes to support this.
//
// Everything here runs with the HTTP call injected. The script is the only
// thing in the repo that talks to the auth admin API, and a test that needed a
// running stack would be skipped on the machine that most needs it to work.
// What is worth pinning is the shape: the request body, where the link is read
// from, and the two ways a target is named.

const STATUS = {
  API_URL: 'http://127.0.0.1:54321',
  SERVICE_ROLE_KEY: 'service-role-key-for-tests'
};

describe('persona table (#1053)', () => {
  it('offers the six named roles', () => {
    expect(Object.keys(PERSONAS).sort()).toEqual(
      ['admin', 'guild-officer', 'leader', 'officer', 'officer2', 'raider'].sort()
    );
  });

  it('names every persona with a wga.local address, which is never a real inbox', () => {
    for (const email of Object.values(PERSONAS)) {
      expect(email).toMatch(/^[a-z0-9-]+@wga\.local$/);
    }
  });
});

describe('resolveTarget (#1053)', () => {
  it('turns a persona name into its seeded email', () => {
    expect(resolveTarget({ persona: 'officer' })).toEqual({ email: PERSONAS.officer });
  });

  it('turns a Discord id into an address of its own, and carries the id', () => {
    // This is the path that composes with a restored production snapshot: the
    // grant rows are real and their auth links are nulled, so a new account
    // whose provider_id matches one of them gets linked by the trigger.
    expect(resolveTarget({ discordId: '123456789012345678' })).toEqual({
      email: '123456789012345678@wga.local',
      discordId: '123456789012345678'
    });
  });

  it('refuses a persona nobody seeded, and names the ones that exist', () => {
    expect(() => resolveTarget({ persona: 'nobody' })).toThrow(/officer/);
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
  const built = linkRequest(STATUS, { email: 'officer@wga.local' });

  it('posts to the admin generate_link endpoint on the local API', () => {
    expect(built.url).toBe('http://127.0.0.1:54321/auth/v1/admin/generate_link');
    expect(built.options.method).toBe('POST');
  });

  it('asks for a magiclink for that address', () => {
    expect(JSON.parse(built.options.body)).toEqual({ type: 'magiclink', email: 'officer@wga.local' });
  });

  it('authorises with the local service role key in both headers the API wants', () => {
    expect(built.options.headers.apikey).toBe(STATUS.SERVICE_ROLE_KEY);
    expect(built.options.headers.Authorization).toBe(`Bearer ${STATUS.SERVICE_ROLE_KEY}`);
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

describe('login (#1053)', () => {
  const ok = { ok: true, status: 200, json: () => Promise.resolve({ action_link: 'http://localhost:3000/#t' }) };

  it('returns the link for a persona', async () => {
    const link = await login({ persona: 'raider' }, { status: () => STATUS, fetch: () => Promise.resolve(ok) });
    expect(link).toBe('http://localhost:3000/#t');
  });

  it('passes the Discord id as user metadata, which is what the link trigger reads', async () => {
    let sent = null;
    await login(
      { discordId: '123456789012345678' },
      {
        status: () => STATUS,
        fetch: (url, options) => {
          sent = JSON.parse(options.body);
          return Promise.resolve(ok);
        }
      }
    );
    expect(sent.data).toEqual({ provider_id: '123456789012345678' });
  });

  it('says the stack is down rather than throwing a connection error', async () => {
    await expect(
      login(
        { persona: 'officer' },
        {
          status: () => {
            throw new Error('spawn supabase ENOENT');
          },
          fetch: () => Promise.resolve(ok)
        }
      )
    ).rejects.toThrow(/supabase start/);
  });

  it('reports what the auth API said when it refuses', async () => {
    await expect(
      login(
        { persona: 'officer' },
        {
          status: () => STATUS,
          fetch: () => Promise.resolve({ ok: false, status: 422, text: () => Promise.resolve('User not found') })
        }
      )
    ).rejects.toThrow(/422|User not found/);
  });
});
