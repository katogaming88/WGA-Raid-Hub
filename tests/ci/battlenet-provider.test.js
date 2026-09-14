import { describe, it, expect } from 'vitest';
import {
  CLIENT_ID,
  IDENTIFIER,
  SECRET_KEY,
  ensureProvider,
  parseEnv,
  providerBody
} from '../../scripts/dev/battlenet-provider.js';

// The local Battle.net provider setup (#1157). Custom providers live in the
// auth database, so a reset can drop one; the script puts it back. The HTTP
// calls are injected, the same way tests/ci/local-login.test.js does it, so
// nothing here needs a running stack.

const STATUS = { API_URL: 'http://127.0.0.1:54321', SERVICE_ROLE_KEY: 'service-role-key-for-tests' };

function stackWith(providers, calls = []) {
  return (url, options) => {
    calls.push({ url, options });
    if (options.method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ providers }) });
    }
    return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({}) });
  };
}

describe('providerBody', () => {
  it('is an oauth2 provider, because Blizzard signing keys break the oidc route', () => {
    const body = providerBody('s3cret');
    expect(body.provider_type).toBe('oauth2');
    expect(body.issuer).toBeUndefined();
    expect(body.userinfo_url).toBe('https://oauth.battle.net/userinfo');
  });

  it('carries the custom: prefix, the character-list scope, and no email requirement', () => {
    const body = providerBody('s3cret');
    expect(body.identifier).toBe('custom:battlenet');
    expect(body.client_id).toBe(CLIENT_ID);
    expect(body.scopes).toContain('wow.profile');
    expect(body.email_optional).toBe(true);
    expect(body.custom_claims_allowlist).toContain('battletag');
  });
});

describe('parseEnv', () => {
  it('reads KEY=value lines and skips comments and blanks', () => {
    const env = parseEnv(
      '# local secrets\r\n\r\nSUPABASE_AUTH_EXTERNAL_DISCORD_ENABLED=true\nBATTLENET_SIGNIN_CLIENT_SECRET=a=b\n'
    );
    expect(env).toEqual({ SUPABASE_AUTH_EXTERNAL_DISCORD_ENABLED: 'true', BATTLENET_SIGNIN_CLIENT_SECRET: 'a=b' });
  });
});

describe('ensureProvider', () => {
  it('does nothing when the provider is already there, and never reads the secret', async () => {
    const calls = [];
    const result = await ensureProvider({
      status: () => STATUS,
      fetch: stackWith([{ identifier: IDENTIFIER }], calls),
      readEnv: () => {
        throw new Error('should not read the env file');
      }
    });
    expect(result).toBe('exists');
    expect(calls).toHaveLength(1);
  });

  it('creates it from the secret in supabase/.env', async () => {
    const calls = [];
    const result = await ensureProvider({
      status: () => STATUS,
      fetch: stackWith([], calls),
      readEnv: () => `${SECRET_KEY}=s3cret\n`
    });
    expect(result).toBe('created');
    const post = calls[1];
    expect(post.url).toBe('http://127.0.0.1:54321/auth/v1/admin/custom-providers');
    expect(post.options.method).toBe('POST');
    expect(JSON.parse(post.options.body).client_secret).toBe('s3cret');
    expect(post.options.headers.Authorization).toBe('Bearer service-role-key-for-tests');
  });

  it('refuses with the key to add when the secret is missing, before creating anything', async () => {
    const calls = [];
    await expect(
      ensureProvider({ status: () => STATUS, fetch: stackWith([], calls), readEnv: () => '' })
    ).rejects.toThrow(SECRET_KEY);
    expect(calls).toHaveLength(1);
  });
});
