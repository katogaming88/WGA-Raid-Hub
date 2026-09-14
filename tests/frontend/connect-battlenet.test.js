import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Connect Battle.net on the current site (#1157). js/discord.js is a plain
// browser script, so it loads into a vm sandbox the same way
// tests/frontend/claim-supabase.test.js does, with only the globals these paths
// touch. The database half, team_battlenet_connections(), is covered by
// tests/rls/battlenet-connections.test.js.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DISCORD_JS = readFileSync(path.join(HERE, '../../js/discord.js'), 'utf8');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function memoryStorage(store = {}) {
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
    store
  };
}

function makeNode(tag) {
  const node = {
    tag,
    children: [],
    attrs: {},
    style: {},
    textContent: '',
    parentNode: null,
    appendChild(child) {
      child.parentNode = node;
      node.children.push(child);
      return child;
    },
    insertBefore(child) {
      child.parentNode = node;
      node.children.unshift(child);
      return child;
    },
    removeChild(child) {
      node.children = node.children.filter((c) => c !== child);
      child.parentNode = null;
    },
    setAttribute(name, value) {
      node.attrs[name] = value;
    }
  };
  return node;
}

function load({ client = null, location = { hash: '', search: '', origin: 'http://x', pathname: '/' }, session } = {}) {
  const body = makeNode('body');
  const byId = {};
  const sandbox = {
    TEAM_SLUG: 'phoenix',
    _teamCfg: { supabaseTeamId: 1 },
    TEAMS: {},
    console: { ...console, warn: vi.fn() },
    URLSearchParams,
    Promise,
    setTimeout,
    clearTimeout,
    window: { location },
    sessionStorage: memoryStorage(),
    localStorage: memoryStorage(session ? { wga_discord_phoenix: JSON.stringify(session) } : {}),
    supabaseClient: client,
    document: {
      body,
      getElementById: (id) => byId[id] || body.children.find((c) => c.id === id) || null,
      createElement: (tag) => makeNode(tag),
      addEventListener: () => {},
      removeEventListener: () => {}
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(DISCORD_JS, sandbox, { filename: 'discord.js' });
  return { sandbox, body, byId };
}

const bnetIdentity = (battletag) => ({
  provider: 'custom:battlenet',
  identity_data: { custom_claims: battletag ? { battletag } : {} }
});

describe('battlenetTag', () => {
  const { sandbox } = load();

  it('reads the BattleTag off the Battle.net identity', () => {
    const user = { identities: [{ provider: 'discord', identity_data: {} }, bnetIdentity('Kato#1499')] };
    expect(sandbox.battlenetTag(user)).toBe('Kato#1499');
  });

  it('is null for a Discord-only account', () => {
    expect(sandbox.battlenetTag({ identities: [{ provider: 'discord', identity_data: {} }] })).toBeNull();
    expect(sandbox.battlenetTag({})).toBeNull();
  });

  it('still counts an identity with no BattleTag as connected', () => {
    expect(sandbox.battlenetTag({ identities: [bnetIdentity(null)] })).toBe('connected');
  });
});

describe('readAuthRedirectError and the refusal message', () => {
  const { sandbox } = load();

  it('reads a refused link from the hash', () => {
    const err = sandbox.readAuthRedirectError({
      hash: '#error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked+to+another+user',
      search: ''
    });
    expect(err.code).toBe('identity_already_exists');
    expect(err.description).toBe('Identity is already linked to another user');
  });

  it('reads it from the query too, and is null for a normal address', () => {
    expect(sandbox.readAuthRedirectError({ hash: '', search: '?error_description=nope' }).description).toBe('nope');
    expect(sandbox.readAuthRedirectError({ hash: '#access_token=abc', search: '?team=hellfire' })).toBeNull();
  });

  it('explains an already-linked Battle.net login in plain words', () => {
    const msg = sandbox.battlenetErrorMessage('Identity is already linked to another user');
    expect(msg).toMatch(/already connected to a different login/);
  });
});

describe('connectBattlenet', () => {
  it('links Battle.net to the signed-in account and returns to this page', async () => {
    const linkIdentity = vi.fn(() => Promise.resolve({ data: {}, error: null }));
    const { sandbox } = load({
      client: { auth: { linkIdentity } },
      location: { hash: '', search: '?team=hellfire', origin: 'http://localhost:3000', pathname: '/officer' }
    });
    sandbox.connectBattlenet();
    await flush();
    expect(linkIdentity).toHaveBeenCalledWith({
      provider: 'custom:battlenet',
      options: { redirectTo: 'http://localhost:3000/officer?team=hellfire' }
    });
    expect(sandbox.sessionStorage.getItem('wga_linking_battlenet')).toBe('1');
  });

  it('shows an alert when the link cannot start', async () => {
    const linkIdentity = () => Promise.resolve({ data: null, error: { message: 'Manual linking is disabled' } });
    const { sandbox, body } = load({ client: { auth: { linkIdentity } } });
    sandbox.connectBattlenet();
    await flush();
    const notice = body.children[0];
    expect(notice.attrs.role).toBe('alert');
    expect(notice.children[0].textContent).toMatch(/Manual linking is disabled/);
  });
});

describe('reportBattlenetLinkResult', () => {
  it('confirms a connection this tab started, once', () => {
    const { sandbox, body } = load();
    sandbox.sessionStorage.setItem('wga_linking_battlenet', '1');
    sandbox.reportBattlenetLinkResult({ battleTag: 'Kato#1499' });
    expect(body.children[0].attrs.role).toBe('status');
    expect(body.children[0].children[0].textContent).toBe('Battle.net connected (Kato#1499).');
    expect(sandbox.sessionStorage.getItem('wga_linking_battlenet')).toBeNull();
  });

  it('reports the refusal from the address when the link was refused', () => {
    const { sandbox, body } = load({
      location: { hash: '#error_description=Identity+is+already+linked+to+another+user', search: '' }
    });
    sandbox.sessionStorage.setItem('wga_linking_battlenet', '1');
    sandbox.reportBattlenetLinkResult({ battleTag: null });
    expect(body.children[0].attrs.role).toBe('alert');
  });

  it('says nothing on an ordinary page load', () => {
    const { sandbox, body } = load();
    sandbox.reportBattlenetLinkResult({ battleTag: 'Kato#1499' });
    expect(body.children).toHaveLength(0);
  });
});

describe('fetchBattlenetConnections', () => {
  it('asks for this team and returns the connected member ids as a set', async () => {
    const rpc = vi.fn(() => Promise.resolve({ data: [{ team_member_id: 3 }, { team_member_id: 12 }], error: null }));
    const { sandbox } = load({ client: { rpc } });
    const connected = await sandbox.fetchBattlenetConnections();
    expect(rpc).toHaveBeenCalledWith('team_battlenet_connections', { p_team_id: 1 });
    expect(connected).toEqual({ 3: true, 12: true });
  });

  it('is null, not empty, when the read fails, so nobody shows as "Not yet" by mistake', async () => {
    const rpc = () => Promise.resolve({ data: null, error: { message: 'Not authorized' } });
    const { sandbox } = load({ client: { rpc } });
    expect(await sandbox.fetchBattlenetConnections()).toBeNull();
    expect(sandbox.console.warn).toHaveBeenCalled();
  });
});
