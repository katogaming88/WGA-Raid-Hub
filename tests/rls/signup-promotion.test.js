// Closing signups puts the declared mains on the roster and takes the raiders
// who did not sign up off it (#1467, part of #1342): preview_signup_promotion()
// says by name what would happen, and promote_season_signups() does exactly
// that in one transaction, or refuses. Each case mints its own team and
// season (seedTeam, seedSeason).
import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool, withTxn, seedTeam, seedMember, seedPlayer, seedSeason, rowLockModes, SITE_ADMIN } from './helpers.js';

afterAll(() => pool.end());

const name = (label) => `${label}${randomUUID().slice(0, 6)}-Illidan`;

const personOf = async (q, memberId) =>
  (await q('select person_id from public.team_members where id = $1', [memberId])).rows[0].person_id;

// A signup as declare_season_signup() leaves it: the signer's person and the
// character's name, pending.
async function declared(q, teamId, season, memberId, nameRealm) {
  const { rows } = await q(
    `insert into public.season_signups (team_id, season, person_id, signup_name_realm, class_spec_id, status)
     values ($1, $2, $3, $4, 1, 'pending') returning id`,
    [teamId, season, await personOf(q, memberId), nameRealm]
  );
  return rows[0].id;
}

// One of each group on a fresh team. Returns the ids and names the cases read.
async function scene(q) {
  const team = await seedTeam(q);
  const season = `promo-${randomUUID().slice(0, 8)}`;
  await seedSeason(q, season, `Season ${season}`);
  const t = team.teamId;
  const n = {
    stay: name('Stay'),
    old: name('Old'),
    next: name('Next'),
    first: name('First'),
    outsider: name('Outsider'),
    twoA: name('TwoA'),
    twoB: name('TwoB'),
    third: name('Third'),
    gone: name('Gone'),
    quiet: name('Quiet')
  };
  const swapper = await seedMember(q, { teamId: t });
  const newcomer = await seedMember(q, { teamId: t });
  const twoMains = await seedMember(q, { teamId: t });
  const quiet = await seedMember(q, { teamId: t });

  const stayId = await seedPlayer(q, { memberId: team.raider.memberId, nameRealm: n.stay });
  const oldId = await seedPlayer(q, { memberId: swapper.memberId, nameRealm: n.old });
  const twoAId = await seedPlayer(q, { memberId: twoMains.memberId, nameRealm: n.twoA });
  const twoBId = await seedPlayer(q, { memberId: twoMains.memberId, nameRealm: n.twoB });
  const goneId = await seedPlayer(q, { teamId: t, nameRealm: n.gone });
  const quietId = await seedPlayer(q, { memberId: quiet.memberId, nameRealm: n.quiet });

  const signups = {
    stay: await declared(q, t, season, team.raider.memberId, n.stay),
    swap: await declared(q, t, season, swapper.memberId, n.next),
    first: await declared(q, t, season, newcomer.memberId, n.first),
    skipped: await declared(q, t, season, twoMains.memberId, n.third),
    join: (
      await q(
        `insert into public.season_signups (team_id, season, signup_name_realm, class_spec_id, status)
         values ($1, $2, $3, 1, 'approved') returning id`,
        [t, season, n.outsider]
      )
    ).rows[0].id
  };
  return { team, season, n, signups, ids: { stayId, oldId, twoAId, twoBId, goneId, quietId }, quiet };
}

const preview = async (asUser, uid, s) =>
  (await asUser(uid, 'select public.preview_signup_promotion($1, $2) as p', [s.team.teamId, s.season])).rows[0].p;

const promote = (asUser, uid, s, expected, archive) =>
  asUser(uid, 'select public.promote_season_signups($1, $2, $3, $4)', [s.team.teamId, s.season, expected, archive]);

const player = async (q, nameRealm, teamId) =>
  (await q('select * from public.players where team_id = $1 and name_realm = $2', [teamId, nameRealm])).rows[0];

describe('preview_signup_promotion()', () => {
  it('lists each group by name', async () => {
    await withTxn(async ({ q, asUser }) => {
      const s = await scene(q);
      const p = await preview(asUser, s.team.leader.uid, s);
      expect(p.expected).toMatch(/^[0-9a-f]{32}$/);
      expect(p.stays).toEqual([{ signup_id: s.signups.stay, player_id: s.ids.stayId, name_realm: s.n.stay }]);
      expect(p.swaps).toEqual([
        { signup_id: s.signups.swap, name_realm: s.n.next, from_player_id: s.ids.oldId, from_name_realm: s.n.old }
      ]);
      expect(p.first_mains).toEqual([{ signup_id: s.signups.first, name_realm: s.n.first }]);
      expect(p.joins).toEqual([{ signup_id: s.signups.join, name_realm: s.n.outsider }]);
      expect(p.skipped).toEqual([
        { signup_id: s.signups.skipped, name_realm: s.n.third, reason: 'several_characters' }
      ]);
      expect(p.archives.map((a) => a.player_id).sort()).toEqual([s.ids.goneId, s.ids.quietId].sort());
    });
  });

  it("counts a current-site signup's swap-from character as signed up", async () => {
    await withTxn(async ({ q, asUser }) => {
      const s = await scene(q);
      await q('update public.season_signups set swap_from_name_realm = $1 where id = $2', [s.n.gone, s.signups.join]);
      const p = await preview(asUser, s.team.leader.uid, s);
      expect(p.archives.map((a) => a.player_id)).toEqual([s.ids.quietId]);
      expect(p.swaps.map((x) => x.from_player_id).sort()).toEqual([s.ids.oldId, s.ids.goneId].sort());
    });
  });

  it('is refused to a plain officer and allowed to a site admin', async () => {
    await withTxn(async ({ q, asUser }) => {
      const s = await scene(q);
      await expect(preview(asUser, s.team.officer.uid, s)).rejects.toThrow(/Not authorized/);
      expect((await preview(asUser, SITE_ADMIN, s)).stays).toHaveLength(1);
    });
  });
});

describe('promote_season_signups()', () => {
  it('does it all in one go, archiving only the ticked characters, and closes signups', async () => {
    await withTxn(async ({ q, asUser }) => {
      const s = await scene(q);
      await q('insert into public.team_seasons (team_id, season_code, signups_open) values ($1, $2, true)', [
        s.team.teamId,
        s.season
      ]);
      const p = await preview(asUser, s.team.leader.uid, s);
      await promote(asUser, s.team.leader.uid, s, p.expected, [s.ids.goneId]);

      const { rows: statuses } = await q('select id, status from public.season_signups where team_id = $1', [
        s.team.teamId
      ]);
      const status = Object.fromEntries(statuses.map((r) => [r.id, r.status]));
      expect(status[s.signups.stay]).toBe('added');
      expect(status[s.signups.swap]).toBe('added');
      expect(status[s.signups.first]).toBe('added');
      expect(status[s.signups.join]).toBe('added');
      expect(status[s.signups.skipped]).toBe('pending');

      expect((await player(q, s.n.next, s.team.teamId)).archived_at).toBeNull();
      expect((await player(q, s.n.old, s.team.teamId)).archived_at).toBeInstanceOf(Date);
      expect((await player(q, s.n.first, s.team.teamId)).is_trial).toBe(true);
      expect((await player(q, s.n.gone, s.team.teamId)).archived_at).toBeInstanceOf(Date);
      expect((await player(q, s.n.quiet, s.team.teamId)).archived_at).toBeNull();
      expect((await player(q, s.n.twoA, s.team.teamId)).archived_at).toBeNull();

      const { rows: reasons } = await q('select reason, detail from public.removal_reasons where player_id = $1', [
        s.ids.goneId
      ]);
      expect(reasons).toEqual([{ reason: 'no_signup', detail: `Season ${s.season}` }]);

      const { rows: ts } = await q(
        'select signups_open from public.team_seasons where team_id = $1 and season_code = $2',
        [s.team.teamId, s.season]
      );
      expect(ts[0].signups_open).toBe(false);
    });
  });

  it('applies the Trial and backup flags an officer set on the signup', async () => {
    await withTxn(async ({ q, asUser }) => {
      const s = await scene(q);
      await q('update public.season_signups set is_trial = false, is_backup_healer = true where id = $1', [
        s.signups.first
      ]);
      const p = await preview(asUser, s.team.leader.uid, s);
      await promote(asUser, s.team.leader.uid, s, p.expected, []);
      expect(await player(q, s.n.first, s.team.teamId)).toMatchObject({ is_trial: false, is_backup_healer: true });
    });
  });

  it('refuses a stale preview and changes nothing', async () => {
    await withTxn(async ({ q, asUser }) => {
      const s = await scene(q);
      const p = await preview(asUser, s.team.leader.uid, s);
      await declared(q, s.team.teamId, s.season, s.quiet.memberId, s.n.quiet);
      await expect(promote(asUser, s.team.leader.uid, s, p.expected, [s.ids.goneId])).rejects.toThrow(
        /changed since the preview/
      );
      expect((await player(q, s.n.gone, s.team.teamId)).archived_at).toBeNull();
      const { rows } = await q(
        "select count(*)::int as n from public.season_signups where team_id = $1 and status = 'added'",
        [s.team.teamId]
      );
      expect(rows[0].n).toBe(0);
    });
  });

  it('refuses a character to archive that the preview did not list', async () => {
    await withTxn(async ({ q, asUser }) => {
      const s = await scene(q);
      const p = await preview(asUser, s.team.leader.uid, s);
      await expect(promote(asUser, s.team.leader.uid, s, p.expected, [s.ids.stayId])).rejects.toThrow(
        /not one the preview lists/
      );
      expect((await player(q, s.n.stay, s.team.teamId)).archived_at).toBeNull();
    });
  });

  it('is refused to a plain officer', async () => {
    await withTxn(async ({ q, asUser }) => {
      const s = await scene(q);
      const p = await preview(asUser, s.team.leader.uid, s);
      await expect(promote(asUser, s.team.officer.uid, s, p.expected, [])).rejects.toThrow(/Not authorized/);
    });
  });

  it('holds every membership on the team and the signups before it touches a character', async () => {
    await withTxn(async ({ q, asUser }) => {
      const s = await scene(q);
      const p = await preview(asUser, s.team.leader.uid, s);
      await promote(asUser, s.team.leader.uid, s, p.expected, []);
      // The kept non-signer's membership: only step 2 reaches it.
      expect(await rowLockModes(q, 'team_members', s.quiet.memberId)).toContain('For Share');
      expect(await rowLockModes(q, 'season_signups', s.signups.skipped)).toContain('For Update');
    });
  });
});

describe('"Did not sign up" (no_signup)', () => {
  it('is a reason Remove and Archive Member take', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { memberId: team.raider.memberId });
      await asUser(team.officer.uid, 'select public.archive_player($1, $2, $3)', [playerId, 'no_signup', 'MID2']);
      const member = await seedMember(q, { teamId: team.teamId });
      await asUser(team.officer.uid, 'select public.archive_team_member($1, $2, $3, $4)', [
        team.teamId,
        member.memberId,
        'no_signup',
        null
      ]);
      const { rows } = await q(
        "select count(*)::int as n from public.removal_reasons where team_id = $1 and reason = 'no_signup'",
        [team.teamId]
      );
      expect(rows[0].n).toBe(2);
    });
  });
});
