// team_raid_reports (#1469): one row per team and Warcraft Logs report,
// written by the progression sync with the title rule's verdict as `kind`.
// An officer's override (#1472) wins over the verdict in `effective_kind`.
// The team's raiders and officers read it; only the sync's service role
// writes, and nobody deletes, so the table stays the record of a report the
// sync no longer fetches.
//
// Each case mints its own team (seedTeam), so it never writes a seeded row.
// Each test runs in one rolled-back transaction (helpers.js withTxn).
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedTeam, seedPlayer, GUILD_OFFICER, SITE_ADMIN, RLS_DENIED } from './helpers.js';

afterAll(() => pool.end());

// A report as the sync writes it: the columns it sends, no override.
const COLUMNS = 'team_id, report_code, title, started_at, raid_date, wcl_zone_id, boss_pulls, boss_kills, kind';
const VALUES = "$1, $2, $3, '2026-10-07 00:00+00', '2026-10-06', 53, 12, 3, $4";

const report = (q, teamId, code, { title = `Night ${code}`, kind = 'main' } = {}) =>
  q(`insert into public.team_raid_reports (${COLUMNS}) values (${VALUES})`, [teamId, code, title, kind]);

// The sync's rewrite: PostgREST's upsert sets every column it sent and no other.
const UPSERT = `insert into public.team_raid_reports (${COLUMNS}) values (${VALUES})
  on conflict (team_id, report_code) do update set
    title = excluded.title, started_at = excluded.started_at, raid_date = excluded.raid_date,
    wcl_zone_id = excluded.wcl_zone_id, boss_pulls = excluded.boss_pulls,
    boss_kills = excluded.boss_kills, kind = excluded.kind`;

const ROW = `select title, kind, kind_override, effective_kind
               from public.team_raid_reports where team_id = $1 and report_code = $2`;

const seen = async (asUser, uid) =>
  (await asUser(uid, 'select team_id, report_code from public.team_raid_reports order by team_id, report_code')).rows;

// A refused statement aborts the transaction, so a case that tries two rides
// each on its own savepoint and the second is refused for its own reason.
const attempt = (q) => async (text, params) => {
  await q('savepoint attempted_write');
  try {
    return await q(text, params);
  } finally {
    await q('rollback to savepoint attempted_write');
  }
};

describe('who reads team_raid_reports', () => {
  it('shows a team’s reports to its own raiders and officers, and every team’s to guild officers and site admins', async () => {
    await withTxn(async ({ q, asUser }) => {
      const a = await seedTeam(q);
      const b = await seedTeam(q);
      await seedPlayer(q, { memberId: a.raider.memberId });
      await report(q, a.teamId, 'ra');
      await report(q, b.teamId, 'rb');
      const mine = [{ team_id: a.teamId, report_code: 'ra' }];
      const both = [...mine, { team_id: b.teamId, report_code: 'rb' }];
      expect(await seen(asUser, a.raider.uid)).toEqual(mine);
      expect(await seen(asUser, a.officer.uid)).toEqual(mine);
      expect(await seen(asUser, a.leader.uid)).toEqual(mine);
      expect(await seen(asUser, GUILD_OFFICER)).toEqual(both);
      expect(await seen(asUser, SITE_ADMIN)).toEqual(both);
    });
  });

  it('hides them from a raider who has left the team, and from signed-out visitors', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const a = await seedTeam(q);
      const player = await seedPlayer(q, { memberId: a.raider.memberId });
      await report(q, a.teamId, 'ra');
      await q('update public.players set archived_at = now() where id = $1', [player]);
      expect(await seen(asUser, a.raider.uid)).toEqual([]);
      expect((await asAnon('select * from public.team_raid_reports')).rows).toEqual([]);
    });
  });
});

describe('who writes team_raid_reports', () => {
  // Every write privilege is revoked from the site roles, so a write fails
  // loudly rather than being filtered to no row.
  it('refuses an officer’s insert, update and delete outright', async () => {
    await withTxn(async ({ q, asUser }) => {
      const a = await seedTeam(q);
      await report(q, a.teamId, 'ra');
      await expect(
        asUser(a.officer.uid, `insert into public.team_raid_reports (${COLUMNS}) values (${VALUES})`, [
          a.teamId,
          'forged',
          'Forged',
          'main'
        ])
      ).rejects.toMatchObject({ code: RLS_DENIED });
      await expect(
        asUser(a.officer.uid, "update public.team_raid_reports set kind_override = 'alt', kind_override_at = now()")
      ).rejects.toMatchObject({ code: RLS_DENIED });
      await expect(asUser(a.officer.uid, 'delete from public.team_raid_reports')).rejects.toMatchObject({
        code: RLS_DENIED
      });
      expect((await q(ROW, [a.teamId, 'ra'])).rows).toEqual([
        { title: 'Night ra', kind: 'main', kind_override: null, effective_kind: 'main' }
      ]);
    });
  });

  it('lets the sync write and rewrite a report, and the rewrite leaves an override alone', async () => {
    await withTxn(async ({ q, asRole }) => {
      const a = await seedTeam(q);
      const asService = asRole('service_role', null);
      await asService(UPSERT, [a.teamId, 'r1', 'Phoenix Heroic', 'main']);
      // #1472's path: an officer keeps the report as the team's raid.
      await q(
        "update public.team_raid_reports set kind_override = 'main', kind_override_at = now() where team_id = $1",
        [a.teamId]
      );
      await asService(UPSERT, [a.teamId, 'r1', 'Phoenix Alt run', 'alt']);
      expect((await q(ROW, [a.teamId, 'r1'])).rows).toEqual([
        { title: 'Phoenix Alt run', kind: 'alt', kind_override: 'main', effective_kind: 'main' }
      ]);
    });
  });

  it('refuses the sync a delete or a truncate: a report it no longer fetches stays on record', async () => {
    await withTxn(async ({ q, asRole }) => {
      const a = await seedTeam(q);
      await report(q, a.teamId, 'ra');
      const asService = asRole('service_role', null);
      await expect(
        asService('delete from public.team_raid_reports where team_id = $1', [a.teamId])
      ).rejects.toMatchObject({ code: RLS_DENIED });
      await expect(asService('truncate public.team_raid_reports')).rejects.toMatchObject({ code: RLS_DENIED });
      expect((await q(ROW, [a.teamId, 'ra'])).rows).toHaveLength(1);
    });
  });
});

describe('team_raid_reports keeps its rows whole', () => {
  it('holds one row per team and report', async () => {
    await withTxn(async ({ q }) => {
      const a = await seedTeam(q);
      const b = await seedTeam(q);
      await report(q, a.teamId, 'shared');
      await report(q, b.teamId, 'shared');
      await expect(report(q, a.teamId, 'shared')).rejects.toMatchObject({ constraint: 'team_raid_reports_pkey' });
    });
  });

  it('refuses a report for a team that does not exist', async () => {
    await withTxn(async ({ q }) => {
      await expect(report(q, -1, 'orphan')).rejects.toMatchObject({ constraint: 'team_raid_reports_team_id_fkey' });
    });
  });

  it('refuses a kind or an override other than main and alt', async () => {
    await withTxn(async ({ q }) => {
      const a = await seedTeam(q);
      await expect(report(attempt(q), a.teamId, 'r1', { kind: 'mythic' })).rejects.toMatchObject({
        constraint: 'team_raid_reports_kind_check'
      });
      await report(q, a.teamId, 'r2');
      await expect(
        attempt(q)(
          "update public.team_raid_reports set kind_override = 'both', kind_override_at = now() where team_id = $1",
          [a.teamId]
        )
      ).rejects.toMatchObject({ constraint: 'team_raid_reports_kind_override_check' });
    });
  });

  it('refuses an override with no time, and a time with no override', async () => {
    await withTxn(async ({ q }) => {
      const a = await seedTeam(q);
      await report(q, a.teamId, 'r1');
      await expect(
        attempt(q)("update public.team_raid_reports set kind_override = 'alt' where team_id = $1", [a.teamId])
      ).rejects.toMatchObject({ constraint: 'team_raid_reports_override_has_time' });
      await expect(
        attempt(q)('update public.team_raid_reports set kind_override_at = now() where team_id = $1', [a.teamId])
      ).rejects.toMatchObject({ constraint: 'team_raid_reports_override_has_time' });
    });
  });

  it('effective_kind is the override while one is set, and the verdict once it is cleared', async () => {
    await withTxn(async ({ q }) => {
      const a = await seedTeam(q);
      await report(q, a.teamId, 'r1', { title: 'Phoenix Alt run', kind: 'alt' });
      await q(
        "update public.team_raid_reports set kind_override = 'main', kind_override_at = now() where team_id = $1",
        [a.teamId]
      );
      expect((await q(ROW, [a.teamId, 'r1'])).rows[0].effective_kind).toBe('main');
      await q('update public.team_raid_reports set kind_override = null, kind_override_at = null where team_id = $1', [
        a.teamId
      ]);
      expect((await q(ROW, [a.teamId, 'r1'])).rows[0].effective_kind).toBe('alt');
    });
  });

  it('stamps updated_at on every rewrite', async () => {
    await withTxn(async ({ q }) => {
      const a = await seedTeam(q);
      await report(q, a.teamId, 'r1');
      await q("update public.team_raid_reports set updated_at = '2000-01-01', title = 'Renamed' where team_id = $1", [
        a.teamId
      ]);
      const { rows } = await q(
        'select updated_at = now() as stamped from public.team_raid_reports where team_id = $1',
        [a.teamId]
      );
      expect(rows).toEqual([{ stamped: true }]);
    });
  });
});
