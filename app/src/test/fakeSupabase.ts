import type { Client } from '../lib/supabase';

// A stand-in for the Supabase client in unit tests. It records each read and
// answers it from a handler, so a test controls exactly what the page gets,
// errors included. The browser tests against a real local stack come later
// (#1101 part 4).

export type Read = {
  table: string;
  columns: string | undefined;
  options: unknown;
  filters: [string, string, unknown][];
  single: boolean;
  order?: string;
};

type Answer = { data?: unknown; error?: { message: string } | null; count?: number | null };

export type FakeHandlers = {
  rpc?: (name: string, args: Record<string, unknown>) => Answer | Promise<Answer>;
  from?: (read: Read) => Answer | Promise<Answer>;
  // The signed-in session getSession() answers with; none means signed out.
  session?: unknown;
  invoke?: (name: string) => Answer | Promise<Answer>;
};

// Every auth and function call a test might assert on, in order.
export type AuthCall = [string, unknown];

export function fakeClient(
  handlers: FakeHandlers
): Client & { reads: Read[]; rpcs: [string, unknown][]; authCalls: AuthCall[] } {
  const reads: Read[] = [];
  const rpcs: [string, unknown][] = [];
  const authCalls: AuthCall[] = [];

  const settle = async (answer: Answer | Promise<Answer>) => {
    const a = await answer;
    return { data: a.data ?? null, error: a.error ?? null, count: a.count ?? null, status: 200, statusText: 'OK' };
  };

  const client = {
    reads,
    rpcs,
    authCalls,
    auth: {
      getSession: () => Promise.resolve({ data: { session: handlers.session ?? null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signInWithOAuth: (args: unknown) => {
        authCalls.push(['signInWithOAuth', args]);
        return Promise.resolve({ data: {}, error: null });
      },
      linkIdentity: (args: unknown) => {
        authCalls.push(['linkIdentity', args]);
        return Promise.resolve({ data: {}, error: null });
      },
      signOut: (args?: unknown) => {
        authCalls.push(['signOut', args]);
        return Promise.resolve({ error: null });
      }
    },
    functions: {
      invoke: async (name: string, args: unknown) => {
        authCalls.push(['invoke', [name, args]]);
        const a = await (handlers.invoke ? handlers.invoke(name) : { data: { success: true } });
        return { data: a.data ?? null, error: a.error ?? null };
      }
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcs.push([name, args]);
      return settle(handlers.rpc ? handlers.rpc(name, args) : { data: null });
    },
    from(table: string) {
      const read: Read = { table, columns: undefined, options: undefined, filters: [], single: false };
      const builder = {
        select(columns?: string, options?: unknown) {
          read.columns = columns;
          read.options = options;
          return builder;
        },
        eq(column: string, value: unknown) {
          read.filters.push(['eq', column, value]);
          return builder;
        },
        is(column: string, value: unknown) {
          read.filters.push(['is', column, value]);
          return builder;
        },
        in(column: string, values: unknown[]) {
          read.filters.push(['in', column, values]);
          return builder;
        },
        gte(column: string, value: unknown) {
          read.filters.push(['gte', column, value]);
          return builder;
        },
        range(from: number, to: number) {
          read.filters.push(['range', String(from), to]);
          return builder;
        },
        order(column: string) {
          read.order = column;
          return builder;
        },
        limit() {
          return builder;
        },
        single() {
          read.single = true;
          return builder;
        },
        maybeSingle() {
          read.single = true;
          return builder;
        },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          reads.push(read);
          return settle(handlers.from ? handlers.from(read) : { data: null }).then(resolve, reject);
        }
      };
      return builder;
    }
  };
  return client as unknown as Client & { reads: Read[]; rpcs: [string, unknown][]; authCalls: AuthCall[] };
}

// A session as supabase-js stores one, with the logins the account holds.
export function fakeSession(logins: { battlenet?: string; discord?: { id: string; name: string } }, userId = 'user-1') {
  const identities = [];
  if (logins.battlenet) {
    identities.push({
      provider: 'custom:battlenet',
      identity_data: { custom_claims: { battletag: logins.battlenet } }
    });
  }
  if (logins.discord) {
    identities.push({
      provider: 'discord',
      identity_data: { full_name: logins.discord.name, custom_claims: { global_name: logins.discord.name } }
    });
  }
  return { access_token: 't', user: { id: userId, identities, user_metadata: {} } };
}

export const filterValue = (read: Read, column: string) => read.filters.find(([, c]) => c === column)?.[2];

// The seeded world most tests run in: WGA with Phoenix and Hellfire, an
// archived team, and "old-phoenix" as a retired key for Phoenix. Stored
// alphabetically on purpose, so a read that forgets to order by id shows the
// wrong order.
const TEAMS = [
  { id: 2, name: 'Hellfire Rollers', slug: 'hellfire', archived_at: null },
  { id: 9, name: 'Old Team', slug: 'old-team', archived_at: '2026-01-01T00:00:00Z' },
  { id: 1, name: 'Phoenix', slug: 'phoenix', archived_at: null }
];

const byColumn = (rows: Record<string, unknown>[], column: string | undefined) =>
  column ? [...rows].sort((a, b) => (a[column]! < b[column]! ? -1 : a[column]! > b[column]! ? 1 : 0)) : rows;

export function seededHandlers(overrides: FakeHandlers = {}): FakeHandlers {
  return {
    rpc(name, args) {
      if (name !== 'resolve_address') return { data: null };
      const guildKey = String(args['p_guild_key']);
      const teamKey = args['p_team_key'] === undefined ? null : String(args['p_team_key']);
      if (guildKey.toLowerCase() !== 'wga') return { data: [] };
      const current = teamKey === null ? null : TEAMS.find((t) => t.slug === teamKey.toLowerCase());
      const retired = teamKey?.toLowerCase() === 'old-phoenix' ? TEAMS.find((t) => t.id === 1) : undefined;
      const team = current ?? retired ?? null;
      if (teamKey !== null && !team) return { data: [] };
      return {
        data: [
          {
            guild_id: 1,
            guild_key: 'wga',
            team_id: team?.id ?? null,
            team_key: team?.slug ?? null,
            player_id: null,
            player_code: null,
            is_canonical: guildKey === 'wga' && (teamKey === null || teamKey === team?.slug)
          }
        ]
      };
    },
    from(read) {
      if (read.table === 'guilds') return { data: { id: 1, name: 'We Go Again', url_key: 'wga' } };
      if (read.table === 'teams') return { data: byColumn(TEAMS, read.order) };
      if (read.table === 'players' && (read.options as { head?: boolean } | undefined)?.head) {
        return { count: filterValue(read, 'team_id') === 1 ? 18 : 12 };
      }
      // A list read with nothing seeded is an empty list, as PostgREST answers.
      return { data: read.single ? null : [] };
    },
    ...overrides
  };
}
