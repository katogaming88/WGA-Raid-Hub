// Signups still open when the season starts close by themselves (#1608), the
// way promote_season_signups() closes them with every tick left on: the
// signups go on the roster, the characters nobody signed up for are archived,
// and the audit rows read "Automatic". Each case mints its own team and
// season; seedSeason() dates are all in the past, so each has started.
import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool, withTxn, seedTeam, seedMember, seedPlayer, seedSeason, SITE_ADMIN } from './helpers.js';

afterAll(() => pool.end());

const name = (label) => `${label}${randomUUID().slice(0, 6)}-Illidan`;

async function declared(q, teamId, season, memberId, nameRealm) {
  const { rows } = await q(
    `insert into public.season_signups (team_id, season, person_id, signup_name_realm, class_spec_id, status)
     select $1, $2, person_id, $4, 1, 'pending' from public.team_members where id = $3 returning id`,
    [teamId, season, memberId, nameRealm]
  );
  return rows[0].id;
}

// A team with signups open for a started season: one raider staying, one
// swapping, one with two characters (skipped), and one who did not sign up.
async function scene(q, { open = true } = {}) {
  const team = await seedTeam(q);
  const t = team.teamId;
  const season = `auto-${randomUUID().slice(0, 8)}`;
  await seedSeason(q, season, `Season ${season}`);
  const n = { stay: name('Stay'), old: name('Old'), next: name('Next'), quiet: name('Quiet'), third: name('Third') };
  const swapper = await seedMember(q, { teamId: t });
  const twoMains = await seedMember(q, { teamId: t });
  const quiet = await seedMember(q, { teamId: t });
  const ids = {
    stay: await seedPlayer(q, { memberId: team.raider.memberId, nameRealm: n.stay }),
    old: await seedPlayer(q, { memberId: swapper.memberId, nameRealm: n.old }),
    quiet: await seedPlayer(q, { memberId: quiet.memberId, nameRealm: n.quiet })
  };
  await seedPlayer(q, { memberId: twoMains.memberId, nameRealm: name('TwoA') });
  await seedPlayer(q, { memberId: twoMains.memberId, nameRealm: name('TwoB') });
  const signups = {
    stay: await declared(q, t, season, team.raider.memberId, n.stay),
    swap: await declared(q, t, season, swapper.memberId, n.next),
    skipped: await declared(q, t, season, twoMains.memberId, n.third)
  };
  const ts = await q(
    'insert into public.team_seasons (team_id, season_code, signups_open) values ($1, $2, $3) returning id',
    [t, season, open]
  );
  return { team, season, n, ids, signups, teamSeasonId: ts.rows[0].id };
}

// The running season ends the day before, as the migration adding the next
// one sets it (the seed leaves it open-ended).
const startIn = async (q, season, days) => {
  await q(
    `update public.seasons set ends_at = (now() at time zone 'America/New_York')::date + $1::int - 1
      where ends_at is null`,
    [days]
  );
  await q(
    `update public.seasons set starts_at = (now() at time zone 'America/New_York')::date + $2::int,
                               ends_at = (now() at time zone 'America/New_York')::date + $2::int
      where code = $1`,
    [season, days]
  );
};

const run = (q) => q('select public.close_started_season_signups()');

const player = async (q, teamId, nameRealm) =>
  (await q('select * from public.players where team_id = $1 and name_realm = $2', [teamId, nameRealm])).rows[0];

const audit = async (q, teamId) =>
  (
    await q(
      'select actor_id, automatic, action, target_id, detail from public.audit_log where team_id = $1 order by id',
      [teamId]
    )
  ).rows;

describe('close_started_season_signups()', () => {
  it('closes a started season as a leader closing it with every tick on would', async () => {
    await withTxn(async ({ q }) => {
      const s = await scene(q);
      await run(q);

      const { rows } = await q('select id, status from public.season_signups where team_id = $1', [s.team.teamId]);
      const status = Object.fromEntries(rows.map((r) => [r.id, r.status]));
      expect(status[s.signups.stay]).toBe('added');
      expect(status[s.signups.swap]).toBe('added');
      expect(status[s.signups.skipped]).toBe('pending');

      const t = s.team.teamId;
      expect((await player(q, t, s.n.next)).archived_at).toBeNull();
      expect((await player(q, t, s.n.old)).archived_at).toBeInstanceOf(Date);
      expect((await player(q, t, s.n.stay)).archived_at).toBeNull();
      expect((await player(q, t, s.n.quiet)).archived_at).toBeInstanceOf(Date);
      const { rows: reasons } = await q('select reason, detail from public.removal_reasons where player_id = $1', [
        s.ids.quiet
      ]);
      expect(reasons).toEqual([{ reason: 'no_signup', detail: `Season ${s.season}` }]);

      const ts = await q('select signups_open from public.team_seasons where id = $1', [s.teamSeasonId]);
      expect(ts.rows[0].signups_open).toBe(false);
    });
  });

  it('writes its audit rows as Automatic, with no actor', async () => {
    await withTxn(async ({ q }) => {
      const s = await scene(q);
      await run(q);
      const rows = await audit(q, s.team.teamId);
      expect(rows.every((r) => r.automatic && r.actor_id === null)).toBe(true);
      expect(rows.map((r) => r.action).sort()).toEqual(
        ['Main Swap: Old Character Removed', 'Player Added', 'Player Added', 'Player Removed', 'Signups Closed'].sort()
      );
      expect(rows.find((r) => r.action === 'Player Removed')).toMatchObject({
        target_id: s.ids.quiet,
        detail: `no_signup: Season ${s.season}`
      });
      expect(rows.find((r) => r.action === 'Main Swap: Old Character Removed')).toMatchObject({
        target_id: s.ids.old,
        detail: `Replaced by ${s.n.next}`
      });
    });
  });

  it('does nothing the second time', async () => {
    await withTxn(async ({ q }) => {
      const s = await scene(q);
      await run(q);
      const before = await audit(q, s.team.teamId);
      await run(q);
      expect(await audit(q, s.team.teamId)).toEqual(before);
    });
  });

  it('leaves a season that has not started, and signups already closed, alone', async () => {
    await withTxn(async ({ q }) => {
      const later = await scene(q);
      await startIn(q, later.season, 1);
      const closed = await scene(q, { open: false });
      await run(q);
      for (const s of [later, closed]) {
        expect((await player(q, s.team.teamId, s.n.quiet)).archived_at).toBeNull();
        expect(await audit(q, s.team.teamId)).toEqual([]);
      }
      const ts = await q('select signups_open from public.team_seasons where id = $1', [later.teamSeasonId]);
      expect(ts.rows[0].signups_open).toBe(true);
    });
  });

  it('closes a season starting today', async () => {
    await withTxn(async ({ q }) => {
      const s = await scene(q);
      await startIn(q, s.season, 0);
      await run(q);
      const ts = await q('select signups_open from public.team_seasons where id = $1', [s.teamSeasonId]);
      expect(ts.rows[0].signups_open).toBe(false);
    });
  });

  it('brings an archived signer back as a raider', async () => {
    await withTxn(async ({ q }) => {
      const s = await scene(q);
      const back = await seedMember(q, { teamId: s.team.teamId });
      await q(`update public.team_members set archived_at = now(), role = 'officer' where id = $1`, [back.memberId]);
      const nameRealm = name('Back');
      await declared(q, s.team.teamId, s.season, back.memberId, nameRealm);
      await run(q);

      const m = await q('select archived_at, role from public.team_members where id = $1', [back.memberId]);
      expect(m.rows[0]).toEqual({ archived_at: null, role: 'raider' });
      const added = await player(q, s.team.teamId, nameRealm);
      expect(added.archived_at).toBeNull();
      const rows = await audit(q, s.team.teamId);
      expect(rows.find((r) => r.action === 'team_member_restored')).toMatchObject({
        automatic: true,
        target_id: back.memberId
      });
      expect(rows.find((r) => r.action === 'Player Added' && r.target_id === added.id).detail).toMatch(
        /membership restored$/
      );
    });
  });

  it('nobody can call it from the site', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const s = await scene(q);
      for (const call of [
        () => asAnon('select public.close_started_season_signups()'),
        () => asUser(s.team.leader.uid, 'select public.close_started_season_signups()'),
        () => asUser(SITE_ADMIN, 'select public.close_started_season_signups()')
      ]) {
        await expect(call()).rejects.toThrow(/permission denied/);
      }
    });
  });

  it('is scheduled hourly', async () => {
    await withTxn(async ({ q }) => {
      const job = await q("select schedule, command from cron.job where jobname = 'close-started-season-signups'");
      expect(job.rows).toEqual([
        { schedule: '20 * * * *', command: ' select public.close_started_season_signups(); ' }
      ]);
    });
  });
});
