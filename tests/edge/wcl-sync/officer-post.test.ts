// #1847: the officer-channel post after the hourly attendance run. The
// database is an in-memory set of tables behind just the calls the post
// makes; Discord is a scripted fetch that records every call.
import { assertEquals } from 'jsr:@std/assert@1';
import { ALL_SET, nightLabel, postAttendanceProblems } from '../../../supabase/functions/wcl-sync/officer-post.ts';

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

function fakeDb(tables: Tables, saveError: { code: string; message: string } | null = null) {
  function from(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let write: { kind: 'insert'; row: Row } | { kind: 'update'; set: Row } | null = null;
    let slice: [number, number] = [0, 1000];
    const rows = () => (tables[table] ??= []);
    const run = () => {
      if (write && saveError && table === 'team_attendance_posts') return { data: null, error: saveError };
      if (write?.kind === 'insert') {
        const { row } = write;
        // The primary key (team_id, raid_date).
        if (rows().some((r) => r.team_id === row.team_id && r.raid_date === row.raid_date)) {
          return { data: null, error: { code: '23505', message: 'duplicate key' } };
        }
        rows().push({ ...row });
        return { data: null, error: null };
      }
      if (write?.kind === 'update') {
        for (const r of rows().filter((r) => filters.every((f) => f(r)))) Object.assign(r, write.set);
        return { data: null, error: null };
      }
      return {
        data: rows()
          .filter((r) => filters.every((f) => f(r)))
          .slice(...slice),
        error: null
      };
    };
    const b: any = {
      select: () => b,
      order: () => b,
      range: (f: number, t: number) => ((slice = [f, t + 1]), b),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), b),
      gte: (c: string, v: string) => (filters.push((r) => r[c] >= v), b),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), b),
      is: (c: string, v: null) => (filters.push((r) => (r[c] ?? null) === v), b),
      insert: (row: Row) => ((write = { kind: 'insert', row }), b),
      update: (set: Row) => ((write = { kind: 'update', set }), b),
      maybeSingle: () => Promise.resolve({ data: (run().data as Row[])[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej)
    };
    return b;
  }
  const rpcs: Record<string, (a: any) => unknown> = {
    team_season_start: () => '2026-08-11',
    attendance_rsvps_before_start: ({ p_dates }) =>
      (tables.raid_rsvps || []).filter((r) => p_dates.includes(r.raid_date))
  };
  return { from, rpc: (name: string, args: any) => Promise.resolve({ data: rpcs[name]!(args), error: null }) } as any;
}

type Call = { method: string; path: string; body: any };
function discord({ patchStatus = 200, postStatus = 200, channelGuild = 'G1' } = {}) {
  const calls: Call[] = [];
  let next = 0;
  const fetch = (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input).replace('https://discord.com/api/v10', '');
    const method = init?.method ?? 'GET';
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const reply = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }));
    if (method === 'GET') return reply(200, { id: 'C1', guild_id: channelGuild });
    if (method === 'POST') return postStatus === 200 ? reply(200, { id: 'M' + ++next }) : reply(postStatus, {});
    if (method === 'PATCH') return reply(patchStatus, {});
    return reply(204, null);
  };
  const env = (name: string) =>
    ({
      SUPABASE_URL: 'https://kxgjqnpwfklbgrxdgmmv.supabase.co',
      DISCORD_BOT_TOKEN: 'bot',
      SITE_URL: 'https://hub.test/'
    })[name];
  return { io: { fetch: fetch as typeof globalThis.fetch, env }, calls };
}

const NIGHT = '2026-11-24';
const NOW = new Date('2026-11-25T12:00:00Z');
const flag = (player_id: number, source: string, raid_date = NIGHT) => ({
  team_id: 1,
  player_id,
  raid_date,
  status: null,
  source,
  report_excluded: false
});

function tables(extra: Partial<Tables> = {}): Tables {
  return {
    teams: [{ id: 1, slug: 'phoenix', guilds: { slug: 'wga' } }],
    team_discord_config: [{ team_id: 1, guild_id: 'G1', officer_channel_id: 'C1' }],
    players: [
      { id: 1, team_id: 1, name_realm: 'Katorrí-Stormrage', nickname: null, archived_at: null },
      { id: 2, team_id: 1, name_realm: 'Voxle-Stormrage', nickname: null, archived_at: null },
      { id: 3, team_id: 1, name_realm: 'Fxhp-Stormrage', nickname: 'Fix', archived_at: null }
    ],
    attendance: [],
    team_attendance_posts: [],
    raid_night_bosses: [],
    raid_night_lineups: [],
    attendance_log_names: [],
    raid_rsvps: [],
    ...extra
  };
}

const run = (t: Tables, io: ReturnType<typeof discord>['io'], now = NOW, saveError: any = null) =>
  postAttendanceProblems(fakeDb(t, saveError), io, 1, now);
const writes = (calls: Call[]) => calls.filter((c) => c.method !== 'GET');

Deno.test('the night label is the calendar day as written', () => {
  assertEquals(nightLabel(NIGHT), 'Tue Nov 24');
});

Deno.test('a night with items posts once, each line the reason the site shows, no one pinged', async () => {
  const t = tables({
    attendance: [flag(1, 'WCL (Late?)'), flag(2, 'WCL (Absent?)'), flag(3, 'WCL (Absent?)')],
    raid_night_bosses: [
      {
        team_id: 1,
        raid_date: NIGHT,
        encounter_id: 7,
        position: 1,
        skipped: true,
        raid_encounters: { name: 'Skipped' }
      },
      {
        team_id: 1,
        raid_date: NIGHT,
        encounter_id: 8,
        position: 2,
        skipped: false,
        raid_encounters: { name: 'Nexus-King' }
      }
    ],
    raid_night_lineups: [
      { team_id: 1, raid_date: NIGHT, encounter_id: 7, player_id: 1 },
      { team_id: 1, raid_date: NIGHT, encounter_id: 8, player_id: 1 }
    ],
    raid_rsvps: [{ team_id: 1, player_id: 3, raid_date: NIGHT, status: 'Tentative' }],
    attendance_log_names: [{ team_id: 1, raid_date: NIGHT, character_name: 'pugzor' }]
  });
  const d = discord();
  assertEquals(await run(t, d.io), { posted: 1, edited: 0 });
  const posts = writes(d.calls);
  assertEquals(posts.length, 1);
  assertEquals(posts[0]!.path, '/channels/C1/messages');
  const embed = posts[0]!.body.embeds[0];
  assertEquals(embed.title, 'Attendance, Tue Nov 24: 3 need a look');
  assertEquals(
    embed.description,
    [
      '**Fix**: Said Tentative in the Calendar, not in the log.',
      '**Katorrí**: Missed Nexus-King, the first boss they were in the lineup for.',
      '**Voxle**: On the roster, not in the log.',
      'In the log but not on the roster: Pugzor.',
      'Scores are waiting on these.',
      '[Open Attendance](https://hub.test/g/wga/t/phoenix/officer/attendance)'
    ].join('\n')
  );
  assertEquals(posts[0]!.body.allowed_mentions, { parse: [] });
  assertEquals(
    t.team_attendance_posts!.map((p) => [p.raid_date, p.message_id]),
    [[NIGHT, 'M1']]
  );

  // Nothing changed: the next hour asks Discord nothing.
  const again = discord();
  assertEquals(await run(t, again.io), { posted: 0, edited: 0 });
  assertEquals(again.calls, []);
});

Deno.test('a later run with more items edits the same post', async () => {
  const t = tables({ attendance: [flag(2, 'WCL (Absent?)')] });
  await run(t, discord().io);
  t.attendance!.push(flag(1, 'WCL (Late?)'));
  const d = discord();
  assertEquals(await run(t, d.io), { posted: 0, edited: 1 });
  assertEquals(
    writes(d.calls).map((c) => [c.method, c.path]),
    [['PATCH', '/channels/C1/messages/M1']]
  );
  assertEquals(writes(d.calls)[0]!.body.embeds[0].title, 'Attendance, Tue Nov 24: 2 need a look');
  assertEquals(writes(d.calls)[0]!.body.embeds[0].description.split('\n')[0], '**Katorrí**: Missed the first pull.');
});

Deno.test('officers set every item: the post is edited to all set, then left alone', async () => {
  const t = tables({ attendance: [flag(2, 'WCL (Absent?)')] });
  await run(t, discord().io);
  t.attendance![0]!.status = 'Excused';
  const d = discord();
  assertEquals(await run(t, d.io), { posted: 0, edited: 1 });
  assertEquals(writes(d.calls)[0]!.body.embeds[0].title, 'Attendance, Tue Nov 24: all set');
  assertEquals(t.team_attendance_posts![0]!.content_key, ALL_SET);
  const later = discord();
  await run(t, later.io);
  assertEquals(later.calls, []);
});

Deno.test('a post deleted in Discord is posted again while items are left', async () => {
  const t = tables({ attendance: [flag(2, 'WCL (Absent?)')] });
  await run(t, discord().io);
  t.attendance!.push(flag(1, 'WCL (Absent?)'));
  const d = discord({ patchStatus: 404 });
  assertEquals(await run(t, d.io), { posted: 1, edited: 0 });
  assertEquals(
    writes(d.calls).map((c) => c.method),
    ['PATCH', 'POST']
  );
  assertEquals(t.team_attendance_posts![0]!.message_id, 'M1');
  assertEquals(t.team_attendance_posts!.length, 1);
});

Deno.test('a night with nothing to look at posts nothing', async () => {
  const t = tables({ attendance: [{ ...flag(2, 'WCL (Absent?)'), status: 'Present' }] });
  const d = discord();
  assertEquals(await run(t, d.io), { posted: 0, edited: 0 });
  assertEquals(d.calls, []);
});

Deno.test('a team with no officer channel posts nothing', async () => {
  const t = tables({
    attendance: [flag(2, 'WCL (Absent?)')],
    team_discord_config: [{ team_id: 1, guild_id: 'G1', officer_channel_id: null }]
  });
  const d = discord();
  assertEquals(await run(t, d.io), 'no channel');
  assertEquals(d.calls, []);
});

Deno.test('a night from before the last week never posts: the waiting backlog stays quiet', async () => {
  const t = tables({ attendance: [flag(2, 'WCL (Absent?)', '2026-11-17')] });
  const d = discord();
  assertEquals(await run(t, d.io), { posted: 0, edited: 0 });
  assertEquals(d.calls, []);
});

Deno.test('an officer channel outside the team server is not posted to', async () => {
  const t = tables({ attendance: [flag(2, 'WCL (Absent?)')] });
  const d = discord({ channelGuild: 'OTHER' });
  assertEquals(await run(t, d.io), { posted: 0, edited: 0 });
  assertEquals(writes(d.calls), []);
});

Deno.test('a local stack posts nothing', async () => {
  const t = tables({ attendance: [flag(2, 'WCL (Absent?)')] });
  const d = discord();
  const io = { ...d.io, env: (n: string) => (n === 'SUPABASE_URL' ? 'http://127.0.0.1:54321' : d.io.env(n)) };
  assertEquals(await postAttendanceProblems(fakeDb(t), io, 1, NOW), 'local');
  assertEquals(d.calls, []);
});

Deno.test(
  'a night set all set that needs a look again edits its own post, not a second (CodeRabbit on PR #1862)',
  async () => {
    const t = tables({ attendance: [flag(2, 'WCL (Absent?)')] });
    await run(t, discord().io);
    t.attendance![0]!.status = 'Excused';
    await run(t, discord().io);
    t.attendance![0]!.status = null;
    const d = discord();
    assertEquals(await run(t, d.io), { posted: 0, edited: 1 });
    assertEquals(
      writes(d.calls).map((c) => [c.method, c.path]),
      [['PATCH', '/channels/C1/messages/M1']]
    );
  }
);

Deno.test('a new officer channel gets the post, and the old one is taken down (CodeRabbit on PR #1862)', async () => {
  const t = tables({ attendance: [flag(2, 'WCL (Absent?)')] });
  await run(t, discord().io);
  t.team_discord_config![0]!.officer_channel_id = 'C2';
  const d = discord();
  assertEquals(await run(t, d.io), { posted: 1, edited: 0 });
  assertEquals(
    writes(d.calls).map((c) => [c.method, c.path]),
    [
      ['POST', '/channels/C2/messages'],
      ['DELETE', '/channels/C1/messages/M1']
    ]
  );
  assertEquals(t.team_attendance_posts![0]!.channel_id, 'C2');
  // Settled there: the next hour asks Discord nothing.
  const again = discord();
  await run(t, again.io);
  assertEquals(again.calls, []);
});

Deno.test('a night from before this shipped never posts, even within the week (fresh review on PR #1862)', async () => {
  const t = tables({ attendance: [flag(2, 'WCL (Absent?)', '2026-11-12')] });
  const d = discord();
  assertEquals(await run(t, d.io, new Date('2026-11-18T12:00:00Z')), { posted: 0, edited: 0 });
  assertEquals(d.calls, []);
});

Deno.test('a post that cannot be saved is taken back down, so the next hour does not post a second', async () => {
  const t = tables({ attendance: [flag(2, 'WCL (Absent?)')] });
  const d = discord();
  let failed = false;
  await run(t, d.io, NOW, { code: 'XX000', message: 'save failed' }).catch(() => (failed = true));
  assertEquals(failed, true);
  assertEquals(
    writes(d.calls).map((c) => [c.method, c.path]),
    [
      ['POST', '/channels/C1/messages'],
      ['DELETE', '/channels/C1/messages/M1']
    ]
  );
});

Deno.test('two runs posting the same night at once: the second takes its own message back', async () => {
  const t = tables({ attendance: [flag(2, 'WCL (Absent?)')] });
  const first = discord();
  // Both read no post yet, then both post.
  const second = discord();
  const late = postAttendanceProblems(fakeDb(t), second.io, 1, NOW);
  await run(t, first.io);
  await late;
  assertEquals(t.team_attendance_posts!.length, 1);
  // Whichever run lost the save took its own message back: one post stays up.
  const methods = writes([...first.calls, ...second.calls]).map((c) => c.method);
  assertEquals(methods.filter((m) => m === 'POST').length, 2);
  assertEquals(methods.filter((m) => m === 'DELETE').length, 1);
});

Deno.test('a post out of reach with nothing left is settled as all set', async () => {
  const t = tables({ attendance: [flag(2, 'WCL (Absent?)')] });
  await run(t, discord().io);
  t.attendance![0]!.status = 'Excused';
  const d = discord({ patchStatus: 403 });
  assertEquals(await run(t, d.io), { posted: 0, edited: 1 });
  assertEquals(
    writes(d.calls).map((c) => c.method),
    ['PATCH']
  );
  assertEquals(t.team_attendance_posts![0]!.content_key, ALL_SET);
});

Deno.test(
  'a new officer channel whose post cannot be saved leaves the old post up (CodeRabbit on PR #1862)',
  async () => {
    const t = tables({ attendance: [flag(2, 'WCL (Absent?)')] });
    await run(t, discord().io);
    t.team_discord_config![0]!.officer_channel_id = 'C2';
    const d = discord();
    let failed = false;
    await run(t, d.io, NOW, { code: 'XX000', message: 'save failed' }).catch(() => (failed = true));
    assertEquals(failed, true);
    // Only the new, unsaved post is taken back; the old one stays.
    assertEquals(
      writes(d.calls).map((c) => [c.method, c.path]),
      [
        ['POST', '/channels/C2/messages'],
        ['DELETE', '/channels/C2/messages/M1']
      ]
    );
    assertEquals([t.team_attendance_posts![0]!.channel_id, t.team_attendance_posts![0]!.message_id], ['C1', 'M1']);
  }
);

Deno.test(
  'a new officer channel that refuses the post leaves the old post and its row alone (CodeRabbit on PR #1862)',
  async () => {
    const t = tables({ attendance: [flag(2, 'WCL (Absent?)')] });
    await run(t, discord().io);
    t.team_discord_config![0]!.officer_channel_id = 'C2';
    const before = { ...t.team_attendance_posts![0]! };
    const d = discord({ postStatus: 403 });
    let failed = false;
    await run(t, d.io).catch(() => (failed = true));
    assertEquals(failed, true);
    // The refused post is the only write: the old message is never taken down.
    assertEquals(
      writes(d.calls).map((c) => [c.method, c.path]),
      [['POST', '/channels/C2/messages']]
    );
    assertEquals(t.team_attendance_posts![0], before);
  }
);
