// earlier_characters() (#942 step 5b): a raider's archived characters whose
// season loot counts toward their total on a team. Kat, 2026-09-15: an old
// main on the team counts, and so does a character on a team they left; a
// team they are still on keeps its own total.
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

// The same person on Hellfire (team 2).
const hellfireMembership = (q) =>
  q(
    `insert into public.team_members (team_id, discord_id, role) values (2, 'discord-raider-1', 'raider') returning id`
  ).then((r) => r.rows[0].id);

const pairs = (rows) => rows.map((r) => [r.player_id, r.earlier_player_id]).sort((a, b) => a[1] - b[1]);

// Phoenix's current main, an old Phoenix main, and a character on Hellfire.
async function fixture(q, { stillOnHellfire = false } = {}) {
  const main = await newPlayer(q, 1, 'Earlymain-Illidan', PHOENIX_RAIDER_MEMBER);
  const oldMain = await newPlayer(q, 1, 'Earlyold-Illidan', PHOENIX_RAIDER_MEMBER, true);
  const hellfire = await hellfireMembership(q);
  const leftTeam = await newPlayer(q, 2, 'Earlyhellfire-Illidan', hellfire, true);
  if (stillOnHellfire) await newPlayer(q, 2, 'Earlystill-Illidan', hellfire);
  return { main, oldMain, leftTeam };
}

const call = 'select * from public.earlier_characters(1)';

describe('earlier_characters()', () => {
  it("gives a team's officers the old main and the character on a team the raider left", async () => {
    await withTxn(async ({ q, asUser }) => {
      const { main, oldMain, leftTeam } = await fixture(q);
      const rows = (await asUser(OFFICER_T1, call)).rows.filter((r) => r.player_id === main);
      expect(pairs(rows)).toEqual(
        pairs([
          { player_id: main, earlier_player_id: oldMain },
          { player_id: main, earlier_player_id: leftTeam }
        ])
      );
    });
  });

  it('leaves out a team the raider is still on, which keeps its own total', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { main, oldMain } = await fixture(q, { stillOnHellfire: true });
      const rows = (await asUser(OFFICER_T1, call)).rows.filter((r) => r.player_id === main);
      expect(pairs(rows)).toEqual([[main, oldMain]]);
    });
  });

  it('never lists a character still on a roster', async () => {
    await withTxn(async ({ q, asUser }) => {
      await fixture(q);
      const rows = (await asUser(OFFICER_T1, call)).rows;
      const archived = (await q('select id from public.players where archived_at is not null')).rows.map((r) => r.id);
      for (const r of rows) expect(archived).toContain(r.earlier_player_id);
    });
  });

  it('answers the raider for their own rows', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { main, oldMain, leftTeam } = await fixture(q);
      const rows = (await asUser(RAIDER_T1, call)).rows;
      expect(pairs(rows)).toEqual(
        pairs([
          { player_id: main, earlier_player_id: oldMain },
          { player_id: main, earlier_player_id: leftTeam }
        ])
      );
    });
  });

  it('answers site admins and guild officers, who read every team', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { main } = await fixture(q);
      for (const uid of [SITE_ADMIN, GUILD_OFFICER]) {
        const rows = (await asUser(uid, call)).rows.filter((r) => r.player_id === main);
        expect(rows).toHaveLength(2);
      }
    });
  });

  it("answers nothing to another team's officer or another raider", async () => {
    await withTxn(async ({ q, asUser }) => {
      await fixture(q);
      expect((await asUser(OFFICER_T2, call)).rows).toEqual([]);
      expect((await asUser(RAIDER_T2, call)).rows).toEqual([]);
    });
  });

  it('is not callable signed out', async () => {
    await withTxn(async ({ asAnon }) => {
      await expect(asAnon(call)).rejects.toThrow(/permission denied/);
    });
  });
});
