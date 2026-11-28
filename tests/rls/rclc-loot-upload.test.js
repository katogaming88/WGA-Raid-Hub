// upload_rclc_loot() (#1442): the Sync app's loot upload. It hands only the
// entries whose player is on the team's roster to import_rclc_loot(), and
// is refused for anyone who may not import for that team.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedPlayer, OFFICER_T1, OFFICER_T2, RAIDER_T1, TEAM_LEADER_T1 } from './helpers.js';

const ON_ROSTER = 'Fixtureupload-Illidan';
const ARCHIVED = 'Fixtureoldalt-Illidan';

function row(overrides) {
  return {
    player: ON_ROSTER,
    id: 'upload-' + Math.random().toString(36).slice(2),
    itemID: 100001,
    itemName: 'Seed Test Staff',
    instance: 'The Voidspire-Heroic',
    boss: 'Some Boss',
    date: '2026/06/22',
    time: '22:00:00',
    ...overrides
  };
}

const upload = (t, uid, rows) =>
  t
    .asUser(uid, 'select public.upload_rclc_loot(1, $1, $2::jsonb) as result', ['MID1', JSON.stringify(rows)])
    .then((r) => r.rows[0].result);

function withRoster(fn) {
  return withTxn(async (t) => {
    await seedPlayer(t.q, { teamId: 1, nameRealm: ON_ROSTER });
    await seedPlayer(t.q, { teamId: 1, nameRealm: ARCHIVED, archivedAt: '2026-01-01' });
    return fn(t);
  });
}

describe('upload_rclc_loot', () => {
  it('imports roster entries and skips players not on the roster, adding no stub', () =>
    withRoster(async (t) => {
      const res = await upload(t, OFFICER_T1, [
        row({ id: 'up-roster' }),
        // Matched ignoring case, as the import does. Ten minutes on, so it is
        // another award, not the same one twice (#1579).
        row({ id: 'up-roster-case', player: 'fixtureupload-illidan', time: '22:10:00' }),
        row({ id: 'up-archived', player: ARCHIVED }),
        row({ id: 'up-stranger', player: 'Someoneelse-Stormrage' })
      ]);
      expect(res).toMatchObject({ inserted: 2, skipped_duplicate: 0, skipped_not_on_roster: 2 });

      const ids = await t.q(`select rclc_id from public.rclc_loot where rclc_id like 'up-%' order by rclc_id`);
      expect(ids.rows.map((r) => r.rclc_id)).toEqual(['up-roster', 'up-roster-case']);
      const stub = await t.q(`select 1 from public.players where name_realm = 'Someoneelse-Stormrage'`);
      expect(stub.rowCount).toBe(0);
    }));

  it('adds no rows when the same entries are uploaded twice', () =>
    withRoster(async (t) => {
      const rows = [row({ id: 'up-twice-1' }), row({ id: 'up-twice-2', time: '22:10:00' })];
      expect(await upload(t, OFFICER_T1, rows)).toMatchObject({ inserted: 2 });
      expect(await upload(t, OFFICER_T1, rows)).toMatchObject({ inserted: 0, skipped_duplicate: 2 });
      const count = await t.q(`select count(*)::int as n from public.rclc_loot where rclc_id like 'up-twice-%'`);
      expect(count.rows[0].n).toBe(2);
    }));

  it('refuses a raider', () =>
    withRoster(async (t) => {
      await expect(upload(t, RAIDER_T1, [row({})])).rejects.toThrow(/not authorized/i);
    }));

  it('refuses an officer of another team, even with no entry on the roster', () =>
    withRoster(async (t) => {
      await expect(upload(t, OFFICER_T2, [row({})])).rejects.toThrow(/not authorized/i);
      await expect(upload(t, OFFICER_T2, [row({ player: 'Someoneelse-Stormrage' })])).rejects.toThrow(
        /not authorized/i
      );
    }));

  // #1560's "Team leader only" is otherwise checked only when a row is
  // inserted, so an upload with nothing on the roster must still be refused.
  it('follows the team leader only import setting, even with no entry on the roster', () =>
    withRoster(async (t) => {
      await t.q(
        `insert into public.team_settings (team_id, config) values (1, '{"lootImportAccess":"leader"}'::jsonb)
         on conflict (team_id) do update set config = public.team_settings.config || excluded.config`
      );
      await expect(upload(t, OFFICER_T1, [row({})])).rejects.toThrow(/not authorized/i);
      await expect(upload(t, OFFICER_T1, [row({ player: 'Someoneelse-Stormrage' })])).rejects.toThrow(
        /not authorized/i
      );
      expect(await upload(t, TEAM_LEADER_T1, [row({ id: 'up-leader' })])).toMatchObject({ inserted: 1 });
    }));

  it('refuses a signed-out caller', () =>
    withRoster(async (t) => {
      await expect(
        t.asAnon('select public.upload_rclc_loot(1, $1, $2::jsonb)', ['MID1', JSON.stringify([row({})])])
      ).rejects.toMatchObject({ code: '42501' });
    }));
});

afterAll(() => pool.end());
