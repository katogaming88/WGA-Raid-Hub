// also_on_teams() (#486): a person raiding on two teams at once. A team's
// officers see the other team's name and nothing else (Kat, 2026-09-14).
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, OFFICER_T1, OFFICER_T2, RAIDER_T1, RAIDER_T2, SITE_ADMIN, GUILD_OFFICER } from './helpers.js';

afterAll(() => pool.end());

// Seeded memberships: 3 is discord-raider-1 on Phoenix (team 1).
const PHOENIX_RAIDER_MEMBER = 3;

const newPlayer = (q, teamId, nameRealm, teamMemberId, archived = false) =>
  q(
    `insert into public.players (team_id, name_realm, team_member_id, archived_at)
     values ($1, $2, $3, case when $4 then now() end) returning id`,
    [teamId, nameRealm, teamMemberId, archived]
  ).then((r) => r.rows[0].id);

// The same person on Hellfire (team 2), with a character there.
async function fixture(q, { archived = false } = {}) {
  const main = await newPlayer(q, 1, 'Alsomain-Illidan', PHOENIX_RAIDER_MEMBER);
  const hellfire = (
    await q(
      `insert into public.team_members (team_id, discord_id, role) values (2, 'discord-raider-1', 'raider') returning id`
    )
  ).rows[0].id;
  await newPlayer(q, 2, 'Alsohellfire-Illidan', hellfire, archived);
  return { main };
}

const call = 'select * from public.also_on_teams(1)';

describe('also_on_teams()', () => {
  it("gives a team's officers the other team's name, and only the name", async () => {
    await withTxn(async ({ q, asUser }) => {
      const { main } = await fixture(q);
      const rows = (await asUser(OFFICER_T1, call)).rows.filter((r) => r.player_id === main);
      expect(rows).toEqual([{ player_id: main, team_name: 'Hellfire Rollers' }]);
    });
  });

  it('leaves out a team where the person has no active character', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { main } = await fixture(q, { archived: true });
      const rows = (await asUser(OFFICER_T1, call)).rows.filter((r) => r.player_id === main);
      expect(rows).toEqual([]);
    });
  });

  it('answers site admins and guild officers, who read every team', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { main } = await fixture(q);
      for (const uid of [SITE_ADMIN, GUILD_OFFICER]) {
        const rows = (await asUser(uid, call)).rows.filter((r) => r.player_id === main);
        expect(rows).toHaveLength(1);
      }
    });
  });

  it('answers no raider, not even the one it is about, and not another team', async () => {
    await withTxn(async ({ q, asUser }) => {
      await fixture(q);
      expect((await asUser(RAIDER_T1, call)).rows).toEqual([]);
      expect((await asUser(RAIDER_T2, call)).rows).toEqual([]);
      expect((await asUser(OFFICER_T2, call)).rows).toEqual([]);
    });
  });

  it('is not callable signed out', async () => {
    await withTxn(async ({ asAnon }) => {
      await expect(asAnon(call)).rejects.toThrow(/permission denied/);
    });
  });
});
