// #1434: a character leaves the roster and comes back only through the
// functions built for it, the way a membership already does
// (team_members_archived_at_through_functions, #1355). A direct change to
// players.archived_at from the site is refused in either direction; the
// functions that make the change run as their owner, each with its own check
// of who may call it.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedTeam, seedPlayer, seedSignup, SITE_ADMIN, GUILD_OFFICER } from './helpers.js';

afterAll(() => pool.end());

const archivedAt = (q, playerId) =>
  q('select archived_at from public.players where id = $1', [playerId]).then((r) => r.rows[0].archived_at);

describe('a direct change to players.archived_at', () => {
  for (const [who, pick] of [
    ['an officer', (team) => team.officer.uid],
    ['a guild officer', () => GUILD_OFFICER],
    ['a site admin', () => SITE_ADMIN]
  ]) {
    it(`is refused to ${who}, taking a character off the roster`, async () => {
      await withTxn(async ({ q, asUser }) => {
        const team = await seedTeam(q);
        const playerId = await seedPlayer(q, { teamId: team.teamId, memberId: team.raider.memberId });
        await expect(
          asUser(pick(team), 'update public.players set archived_at = now() where id = $1', [playerId])
        ).rejects.toThrow(/through Remove/);
        expect(await archivedAt(q, playerId)).toBeNull();
      });
    });

    it(`is refused to ${who}, bringing a character back`, async () => {
      await withTxn(async ({ q, asUser }) => {
        const team = await seedTeam(q);
        const playerId = await seedPlayer(q, {
          teamId: team.teamId,
          memberId: team.raider.memberId,
          archivedAt: new Date().toISOString()
        });
        await expect(
          asUser(pick(team), 'update public.players set archived_at = null where id = $1', [playerId])
        ).rejects.toThrow(/through Remove/);
        expect(await archivedAt(q, playerId)).not.toBeNull();
      });
    });
  }

  it("leaves an officer's other edits alone", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { teamId: team.teamId, memberId: team.raider.memberId });
      await asUser(team.officer.uid, "update public.players set nickname = 'Kat' where id = $1", [playerId]);
      expect((await q('select nickname from public.players where id = $1', [playerId])).rows[0].nickname).toBe('Kat');
    });
  });

  it('still passes for the service role (imports, scripts)', async () => {
    await withTxn(async ({ q, asRole }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { teamId: team.teamId });
      await asRole('service_role', null)('update public.players set archived_at = now() where id = $1', [playerId]);
      expect(await archivedAt(q, playerId)).not.toBeNull();
    });
  });
});

describe('the functions still move a character', () => {
  it('archive_player() takes one off, and restore_player() brings it back', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { teamId: team.teamId, memberId: team.raider.memberId });
      await asUser(team.officer.uid, "select public.archive_player($1, 'drama', null)", [playerId]);
      expect(await archivedAt(q, playerId)).not.toBeNull();
      await asUser(team.officer.uid, 'select public.restore_player($1)', [playerId]);
      expect(await archivedAt(q, playerId)).toBeNull();
    });
  });

  it("add_signup_to_roster() brings an archived character back and retires a main swap's old one", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const old = await seedPlayer(q, { teamId: team.teamId, memberId: team.raider.memberId });
      const back = await seedPlayer(q, { teamId: team.teamId, archivedAt: new Date().toISOString() });
      const nameRealm = (await q('select name_realm from public.players where id = $1', [back])).rows[0].name_realm;
      const signupId = await seedSignup(q, { teamId: team.teamId, nameRealm });
      await asUser(team.officer.uid, 'select public.add_signup_to_roster($1, true, $2)', [signupId, old]);
      expect(await archivedAt(q, back)).toBeNull();
      expect(await archivedAt(q, old)).not.toBeNull();
    });
  });

  it('add_signup_to_roster() still runs with nobody signed in (the season-start job)', async () => {
    await withTxn(async ({ q }) => {
      const team = await seedTeam(q);
      const signupId = await seedSignup(q, { teamId: team.teamId });
      const playerId = (await q('select public.add_signup_to_roster($1) as id', [signupId])).rows[0].id;
      expect(await archivedAt(q, playerId)).toBeNull();
    });
  });
});

describe('who may call them', () => {
  it("add_signup_to_roster() refuses a raider, and another team's officer", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const other = await seedTeam(q);
      const signupId = await seedSignup(q, { teamId: team.teamId });
      await expect(asUser(team.raider.uid, 'select public.add_signup_to_roster($1)', [signupId])).rejects.toThrow(
        /Not authorized/
      );
      await expect(asUser(other.officer.uid, 'select public.add_signup_to_roster($1)', [signupId])).rejects.toThrow(
        /Not authorized/
      );
      expect((await q('select status from public.season_signups where id = $1', [signupId])).rows[0].status).toBe(
        'approved'
      );
    });
  });

  it("archive_player() and restore_player() refuse another team's officer", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const other = await seedTeam(q);
      const playerId = await seedPlayer(q, { teamId: team.teamId });
      await expect(
        asUser(other.officer.uid, "select public.archive_player($1, 'drama', null)", [playerId])
      ).rejects.toThrow(/Not authorized/);
      await q('update public.players set archived_at = now() where id = $1', [playerId]);
      await expect(asUser(other.officer.uid, 'select public.restore_player($1)', [playerId])).rejects.toThrow(
        /Not authorized/
      );
    });
  });

  it('anon cannot call any of the three', async () => {
    await withTxn(async ({ q, asAnon }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { teamId: team.teamId });
      const signupId = await seedSignup(q, { teamId: team.teamId });
      await expect(asAnon("select public.archive_player($1, 'drama', null)", [playerId])).rejects.toThrow();
      await expect(asAnon('select public.restore_player($1)', [playerId])).rejects.toThrow();
      await expect(asAnon('select public.add_signup_to_roster($1)', [signupId])).rejects.toThrow();
    });
  });
});
