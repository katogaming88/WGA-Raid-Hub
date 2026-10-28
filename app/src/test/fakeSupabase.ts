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

// A table write: what was sent, and the filters that pick its rows.
export type Write = {
  table: string;
  method: 'insert' | 'update' | 'upsert' | 'delete';
  values: unknown;
  filters: [string, string, unknown][];
};

// `code` is the Postgres error code PostgREST passes through (23505 for a
// duplicate key).
type Answer = { data?: unknown; error?: { message: string; code?: string } | null; count?: number | null };
type InvokeAnswer = { data?: unknown; error?: { message: string; context?: unknown } | null };

export type FakeHandlers = {
  rpc?: (name: string, args: Record<string, unknown>) => Answer | Promise<Answer>;
  from?: (read: Read) => Answer | Promise<Answer>;
  // Inserts, updates and deletes; none means every write succeeds.
  write?: (write: Write) => Answer | Promise<Answer>;
  // The signed-in session getSession() answers with; none means signed out.
  session?: unknown;
  // `error` may carry `context`, the Response supabase-js attaches to a
  // function's non-2xx answer.
  invoke?: (name: string, args: unknown) => InvokeAnswer | Promise<InvokeAnswer>;
};

// Every auth and function call a test might assert on, in order.
export type AuthCall = [string, unknown];

// `.is(col, null)` and `.not(col, 'is', null)` applied to a handler's rows,
// so one players list answers both the roster read and the archived read.
const nullFilters = (data: unknown, filters: Read['filters']) => {
  if (!Array.isArray(data)) return data;
  return filters.reduce<unknown[]>((rows, [op, column, value]) => {
    if (value !== null || (op !== 'is' && op !== 'not.is')) return rows;
    return rows.filter((row) => ((row as Record<string, unknown>)[column] == null) === (op === 'is'));
  }, data);
};

// What the database's rank grids give, for the tests that describe a person
// the old way (resolve_person: a role per team, the guild_officer flag). The
// default grids from the ranks migration (#1645, #1647): an Officer has every
// team permission, an Assistant the roster, schedule, attendance, signup and
// report ones, and a guild Admin every guild one. A test that is about the
// grid itself answers my_permissions / my_permission_team_ids on its own.
const OFFICER_PERMISSIONS = [
  'own_character',
  'edit_own_wishlist',
  'edit_roster',
  'edit_schedule',
  'see_rsvps',
  'attendance',
  'manage_signups',
  'view_reports',
  'view_loot',
  'manage_loot',
  'pay_boe_cuts',
  'promote_assistants',
  'view_team_audit_log'
];
const ASSISTANT_PERMISSIONS = [
  'own_character',
  'edit_own_wishlist',
  'edit_roster',
  'edit_schedule',
  'see_rsvps',
  'attendance',
  'manage_signups',
  'view_reports',
  'view_loot'
];
const RAIDER_PERMISSIONS = ['own_character', 'edit_own_wishlist'];
const ADMIN_PERMISSIONS = [
  'create_teams',
  'rename_archive_teams',
  'change_team_owner',
  'edit_guild_profile',
  'edit_own_bio',
  'edit_all_bios',
  'record_boe',
  'pay_any_boe',
  'edit_boe_settings',
  'view_guild_audit_log',
  'view_every_team'
];
const EVERY_TEAM_READS = ['see_rsvps', 'view_reports', 'view_loot', 'view_team_audit_log'];

type FakePerson = {
  guild_officer?: boolean | null;
  boe_manager?: boolean | null;
  teams?: { team_id: number; role: string }[];
} | null;

async function derivedPermissions(handlers: FakeHandlers, name: string, args: Record<string, unknown>) {
  const person = ((await handlers.rpc?.('resolve_person', { p_discord_id: 'discord-x' }))?.data ?? null) as FakePerson;
  const teams = person?.teams ?? [];
  const onTeam = (id: unknown) => {
    const role = teams.find((t) => t.team_id === id)?.role;
    if (role === 'officer' || role === 'team_leader') return OFFICER_PERMISSIONS;
    if (role === 'assistant') return ASSISTANT_PERMISSIONS;
    if (role === 'raider') return RAIDER_PERMISSIONS;
    return person?.guild_officer ? EVERY_TEAM_READS : [];
  };
  const guild = [
    ...(person?.guild_officer ? ADMIN_PERMISSIONS : []),
    ...(person?.boe_manager ? ['record_boe', 'pay_any_boe'] : [])
  ];
  if (name === 'my_permission_team_ids') {
    const ids = new Set<number>(teams.map((t) => t.team_id));
    // A guild officer reads every team; the seeded world has teams 1 and 2.
    if (person?.guild_officer) [1, 2].forEach((id) => ids.add(id));
    return [...ids].filter((id) => onTeam(id).includes(String(args['p_permission'])));
  }
  const team = args['p_team_id'] === undefined ? [] : onTeam(args['p_team_id']);
  return { team, guild: args['p_team_id'] === undefined && args['p_guild_id'] === undefined ? [] : guild };
}

export function fakeClient(
  handlers: FakeHandlers
): Client & { reads: Read[]; writes: Write[]; rpcs: [string, unknown][]; authCalls: AuthCall[] } {
  const reads: Read[] = [];
  const writes: Write[] = [];
  const rpcs: [string, unknown][] = [];
  const authCalls: AuthCall[] = [];

  const settle = async (answer: Answer | Promise<Answer>) => {
    const a = await answer;
    return { data: a.data ?? null, error: a.error ?? null, count: a.count ?? null, status: 200, statusText: 'OK' };
  };

  const client = {
    reads,
    writes,
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
        const a = await (handlers.invoke ? handlers.invoke(name, args) : { data: { success: true } });
        return { data: a.data ?? null, error: a.error ?? null };
      }
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcs.push([name, args]);
      if (name === 'my_permissions' || name === 'my_permission_team_ids') {
        const grid = async (): Promise<Answer> => {
          const given = await (handlers.rpc ? handlers.rpc(name, args) : { data: null });
          return given.data != null || given.error ? given : { data: await derivedPermissions(handlers, name, args) };
        };
        return settle(grid());
      }
      return settle(handlers.rpc ? handlers.rpc(name, args) : { data: null });
    },
    from(table: string) {
      const read: Read = { table, columns: undefined, options: undefined, filters: [], single: false };
      let write: Write | null = null;
      const writing = (method: Write['method'], values: unknown) => {
        write = { table, method, values, filters: read.filters };
        return builder;
      };
      const builder = {
        insert: (values: unknown) => writing('insert', values),
        update: (values: unknown) => writing('update', values),
        upsert: (values: unknown) => writing('upsert', values),
        delete: () => writing('delete', undefined),
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
        not(column: string, operator: string, value: unknown) {
          read.filters.push([`not.${operator}`, column, value]);
          return builder;
        },
        or(expression: string) {
          read.filters.push(['or', '', expression]);
          return builder;
        },
        ilike(column: string, pattern: string) {
          read.filters.push(['ilike', column, pattern]);
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
        lte(column: string, value: unknown) {
          read.filters.push(['lte', column, value]);
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
          if (write) {
            writes.push(write);
            return settle(handlers.write ? handlers.write(write) : { data: null }).then(resolve, reject);
          }
          reads.push(read);
          return settle(handlers.from ? handlers.from(read) : { data: null })
            .then((r) => ({ ...r, data: nullFilters(r.data, read.filters) }))
            .then(resolve, reject);
        }
      };
      return builder;
    }
  };
  return client as unknown as Client & {
    reads: Read[];
    writes: Write[];
    rpcs: [string, unknown][];
    authCalls: AuthCall[];
  };
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

// Signed in as a raider on a team, since a guild's pages are only for its
// members and send everyone else to the front page (#1264). The test's own rpc
// handler answers everything else.
export function asMember(handlers: FakeHandlers = seededHandlers(), teamId = 1): FakeHandlers {
  return {
    ...handlers,
    session:
      handlers.session ?? fakeSession({ battlenet: 'Member#1', discord: { id: 'discord-member', name: 'Member' } }),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: 'discord-member' };
      if (name === 'resolve_person') {
        return {
          data: {
            site_admin: false,
            guild_officer: false,
            boe_manager: false,
            teams: [
              {
                team_id: teamId,
                team_member_id: 900,
                role: 'raider',
                characters: [{ player_id: 900, name_realm: 'Member-Illidan', url_code: 'member00', archived_at: null }]
              }
            ]
          }
        };
      }
      return handlers.rpc ? handlers.rpc(name, args) : { data: null };
    }
  };
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
