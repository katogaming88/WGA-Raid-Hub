// The injected side of a function (#1006): an in-memory db over the named
// interface the handler reads, with a call log so a test can assert a later
// step ran and not only the step under test. A fake that omits a method
// turns a throw into silent truncation; the log is what catches that.
import type { Deps, SaleDb, SaleRow } from '../../../supabase/functions/boe-sold-webhook/handler.ts';
import { MANAGER_USER_ID, SOLD_WEBHOOK_URL, envOf } from './corpus.ts';
import { recordingFetch } from './fetch.ts';

export type FakeDbState = {
  // undefined means a signed-in user; null means no session behind the header.
  user?: { id: string } | null;
  boeManager?: boolean;
  siteAdmin?: boolean;
  rows?: SaleRow[];
  // When set, readSale throws with this message, the way a failed read does.
  readFails?: string;
  finderId?: string | null;
  managerIds?: string[];
};

export type DbCall = { method: keyof SaleDb; args: unknown[] };

export type FakeDb = SaleDb & { calls: DbCall[] };

export function fakeDb(state: FakeDbState = {}): FakeDb {
  const calls: DbCall[] = [];
  const record = (method: keyof SaleDb, ...args: unknown[]) => calls.push({ method, args });
  return {
    calls,
    async getUser(authHeader) {
      record('getUser', authHeader);
      return state.user === undefined ? { id: MANAGER_USER_ID } : state.user;
    },
    async isBoeManager(authHeader) {
      record('isBoeManager', authHeader);
      return state.boeManager ?? true;
    },
    async isSiteAdmin(authHeader) {
      record('isSiteAdmin', authHeader);
      return state.siteAdmin ?? false;
    },
    async readSale(id) {
      record('readSale', id);
      if (state.readFails) throw new Error(state.readFails);
      return (state.rows ?? []).find((row) => row.id === id) ?? null;
    },
    async resolveFinderDiscordId(authHeader, id) {
      record('resolveFinderDiscordId', authHeader, id);
      return state.finderId ?? null;
    },
    async managerDiscordIds() {
      record('managerDiscordIds');
      return state.managerIds ?? [];
    }
  };
}

export function testDeps(opts: { db?: FakeDb; env?: Record<string, string>; responses?: Response[] } = {}) {
  const { fetch, calls } = recordingFetch(opts.responses ?? []);
  const db: FakeDb = opts.db ?? fakeDb();
  const env = envOf(opts.env ?? { BOE_SOLD_WEBHOOK_URL: SOLD_WEBHOOK_URL });
  const deps: Deps = { fetch, env, db };
  return { deps, calls, db };
}
