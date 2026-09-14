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
};

type Answer = { data?: unknown; error?: { message: string } | null; count?: number | null };

export type FakeHandlers = {
  rpc?: (name: string, args: Record<string, unknown>) => Answer | Promise<Answer>;
  from?: (read: Read) => Answer | Promise<Answer>;
};

export function fakeClient(handlers: FakeHandlers): Client & { reads: Read[]; rpcs: [string, unknown][] } {
  const reads: Read[] = [];
  const rpcs: [string, unknown][] = [];

  const settle = async (answer: Answer | Promise<Answer>) => {
    const a = await answer;
    return { data: a.data ?? null, error: a.error ?? null, count: a.count ?? null, status: 200, statusText: 'OK' };
  };

  const client = {
    reads,
    rpcs,
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
        order() {
          return builder;
        },
        single() {
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
  return client as unknown as Client & { reads: Read[]; rpcs: [string, unknown][] };
}

export const filterValue = (read: Read, column: string) => read.filters.find(([, c]) => c === column)?.[2];

// The seeded world most tests run in: WGA with Phoenix and Hellfire, an
// archived team, and "old-phoenix" as a retired key for Phoenix.
const TEAMS = [
  { id: 1, name: 'Phoenix', slug: 'phoenix', archived_at: null },
  { id: 2, name: 'Hellfire Rollers', slug: 'hellfire', archived_at: null },
  { id: 9, name: 'Old Team', slug: 'old-team', archived_at: '2026-01-01T00:00:00Z' }
];

export function seededHandlers(overrides: FakeHandlers = {}): FakeHandlers {
  return {
    rpc(name, args) {
      if (name !== 'resolve_address') return { data: null };
      const guildKey = String(args['p_guild_key']);
      const teamKey = args['p_team_key'] === undefined ? null : String(args['p_team_key']);
      if (guildKey.toLowerCase() !== 'wga') return { data: [] };
      const current = teamKey === null ? null : TEAMS.find((t) => t.slug === teamKey.toLowerCase());
      const retired = teamKey?.toLowerCase() === 'old-phoenix' ? TEAMS[0] : undefined;
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
      if (read.table === 'teams') return { data: TEAMS };
      if (read.table === 'players') return { count: filterValue(read, 'team_id') === 1 ? 18 : 12 };
      return { data: null };
    },
    ...overrides
  };
}
