// The any-time main swap request (#631, #942 step 5c): a raider asks to make
// one of their alts their roster character, an officer approves, and the swap
// runs the same steps a main swap through a season signup does.
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  withTxn,
  seedPlayer,
  seedTeam,
  OFFICER_T1,
  OFFICER_T2,
  RAIDER_T1,
  TEAM_LEADER_T1,
  GUILD_OFFICER
} from './helpers.js';

afterAll(() => pool.end());

// Seeded: membership 3 is discord-raider-1 on Phoenix (team 1), and
// classes_specs 1 is Mage Frost. Their roster character is minted per case,
// and the one case that sets a team's live season runs on a team it mints.
const PHOENIX_RAIDER_MEMBER = 3;
const FROST_MAGE = 1;

const personOf = async (q, memberId) =>
  (await q('select person_id from public.team_members where id = $1', [memberId])).rows[0].person_id;

// The raider's roster character, and an alt of theirs from Battle.net.
async function fixture(q, { characterClass = 'Mage', name = 'Swapalt', memberId = PHOENIX_RAIDER_MEMBER } = {}) {
  const raiderPlayer = await seedPlayer(q, { memberId });
  await q('update public.players set join_date = $1 where id = $2', ['2026-02-01', raiderPlayer]);
  const personId = await personOf(q, memberId);
  const character = await q(
    `insert into public.characters (person_id, blizzard_id, name, realm, realm_slug, class_name, spec_name, level)
     values ($1, $2, $3, 'Illidan', 'illidan', $4, 'Frost', 90) returning id`,
    [personId, Math.floor(Math.random() * 1e9), name, characterClass]
  );
  return { personId, raiderPlayer, characterId: character.rows[0].id, nameRealm: `${name}-Illidan` };
}

const ask = (asUser, uid, characterId, specId = FROST_MAGE, note = null, teamId = 1) =>
  asUser(uid, 'select public.request_main_swap($4, $1, $2, $3) as id', [characterId, specId, note, teamId]);

const review = (asUser, uid, requestId, approve, note = null) =>
  asUser(uid, 'select public.review_main_swap_request($1, $2, $3) as player_id', [requestId, approve, note]);

const statusOf = async (q, id) =>
  (await q('select status, approved_player_id from public.main_swap_requests where id = $1', [id])).rows[0];

describe('request_main_swap()', () => {
  it('records the ask against the raider and their roster character', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { characterId, nameRealm, personId, raiderPlayer } = await fixture(q);
      const id = (await ask(asUser, RAIDER_T1, characterId)).rows[0].id;
      const row = (await q('select * from public.main_swap_requests where id = $1', [id])).rows[0];
      expect(row).toMatchObject({
        team_id: 1,
        person_id: personId,
        from_player_id: raiderPlayer,
        name_realm: nameRealm,
        status: 'pending'
      });
    });
  });

  it('refuses a character that is not on their account', async () => {
    await withTxn(async ({ q, asUser }) => {
      const other = await q('select person_id from public.team_members where id = 1');
      const character = await q(
        `insert into public.characters (person_id, blizzard_id, name, realm, realm_slug, class_name, level)
         values ($1, 991, 'Notyours', 'Illidan', 'illidan', 'Mage', 90) returning id`,
        [other.rows[0].person_id]
      );
      await expect(ask(asUser, RAIDER_T1, character.rows[0].id)).rejects.toThrow(/not on your account/);
    });
  });

  it('refuses a spec of another class', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { characterId } = await fixture(q, { characterClass: 'Evoker' });
      await expect(ask(asUser, RAIDER_T1, characterId)).rejects.toThrow(/is a Evoker, not a Mage/);
    });
  });

  it('refuses a second ask while one is waiting, and allows one after a cancel', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { characterId } = await fixture(q);
      const id = (await ask(asUser, RAIDER_T1, characterId)).rows[0].id;
      await expect(ask(asUser, RAIDER_T1, characterId)).rejects.toThrow(/already have a main swap waiting/);
      await asUser(RAIDER_T1, 'select public.cancel_main_swap_request($1)', [id]);
      expect((await statusOf(q, id)).status).toBe('cancelled');
      await expect(ask(asUser, RAIDER_T1, characterId)).resolves.toBeTruthy();
    });
  });

  it('refuses a character already on the roster', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { characterId, nameRealm } = await fixture(q);
      await q('insert into public.players (team_id, name_realm, class_spec_id) values (1, $1, 1)', [nameRealm]);
      await expect(ask(asUser, RAIDER_T1, characterId)).rejects.toThrow(/already on this roster/);
    });
  });

  it('refuses someone with no character on the team', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { characterId, raiderPlayer } = await fixture(q);
      await q('update public.players set team_member_id = null where id = $1', [raiderPlayer]);
      await expect(ask(asUser, RAIDER_T1, characterId)).rejects.toThrow(/no character on this team/);
    });
  });
});

describe('who reads a main swap request', () => {
  const read = 'select id from public.main_swap_requests';

  it("is the raider, their team's officers and a guild officer, not another team's officer", async () => {
    await withTxn(async ({ q, asUser }) => {
      const { characterId } = await fixture(q);
      const id = (await ask(asUser, RAIDER_T1, characterId)).rows[0].id;
      for (const uid of [RAIDER_T1, OFFICER_T1, TEAM_LEADER_T1, GUILD_OFFICER]) {
        expect((await asUser(uid, read)).rows.map((r) => r.id)).toContain(id);
      }
      expect((await asUser(OFFICER_T2, read)).rows.map((r) => r.id)).not.toContain(id);
    });
  });
});

describe('review_main_swap_request()', () => {
  it('moves the raider onto the new character, keeping the join date and attendance', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { characterId, nameRealm, raiderPlayer } = await fixture(q);
      await q(
        `insert into public.attendance (team_id, player_id, raid_date, status)
         values (1, $1, '2026-03-04', 'Present')`,
        [raiderPlayer]
      );
      const id = (await ask(asUser, RAIDER_T1, characterId)).rows[0].id;
      const playerId = (await review(asUser, OFFICER_T1, id, true)).rows[0].player_id;

      const added = (await q('select * from public.players where id = $1', [playerId])).rows[0];
      expect(added).toMatchObject({
        team_id: 1,
        name_realm: nameRealm,
        class_spec_id: FROST_MAGE,
        team_member_id: PHOENIX_RAIDER_MEMBER,
        archived_at: null
      });
      expect(added.join_date.toISOString().slice(0, 10)).toBe('2026-02-01');

      const old = (await q('select * from public.players where id = $1', [raiderPlayer])).rows[0];
      expect(old.archived_at).not.toBeNull();
      // The link stays on the archived character (#941), so its loot still
      // counts toward the raider's season total (step 5b).
      expect(old.team_member_id).toBe(PHOENIX_RAIDER_MEMBER);

      const attendance = (await q('select player_id from public.attendance where raid_date = $1', ['2026-03-04'])).rows;
      expect(attendance.map((r) => r.player_id)).toEqual([playerId]);
      expect(await statusOf(q, id)).toEqual({ status: 'approved', approved_player_id: playerId });
    });
  });

  it('brings back a character they played before, keeping its loot history', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { characterId, nameRealm } = await fixture(q);
      const before = await q(
        `insert into public.players (team_id, name_realm, class_spec_id, team_member_id, archived_at)
         values (1, $1, 1, $2, now()) returning id`,
        [nameRealm, PHOENIX_RAIDER_MEMBER]
      );
      const oldCharacter = before.rows[0].id;
      await q(
        `insert into public.rclc_loot (team_id, player_id, item_id, track, season)
         values (1, $1, 1, 'Myth', 'seed-season')`,
        [oldCharacter]
      );

      const id = (await ask(asUser, RAIDER_T1, characterId)).rows[0].id;
      const playerId = (await review(asUser, OFFICER_T1, id, true)).rows[0].player_id;

      expect(playerId).toBe(oldCharacter);
      const loot = await q('select count(*)::int as n from public.rclc_loot where player_id = $1', [oldCharacter]);
      expect(loot.rows[0].n).toBe(1);
    });
  });

  it("clears the old character's standing priority rows for the live season", async () => {
    await withTxn(async ({ q, asUser }) => {
      // A team of its own, since the live season is a team_settings write.
      const team = await seedTeam(q);
      const { characterId, raiderPlayer } = await fixture(q, { memberId: team.raider.memberId });
      await q(
        `update public.team_settings set config = config || '{"seasonName":"Midnight Season 2"}' where team_id = $1`,
        [team.teamId]
      );
      await q(
        `insert into public.priority_order (team_id, season, item_id, track, rank, player_id)
         values ($1, 'seed-season', 1, 'Myth', 2, $2), ($1, 'MID2', 1, 'Myth', 1, $2)`,
        [team.teamId, raiderPlayer]
      );
      const id = (await ask(asUser, team.raider.uid, characterId, FROST_MAGE, null, team.teamId)).rows[0].id;
      await review(asUser, team.officer.uid, id, true);
      // Only the live season goes. The row on an older season stays, the
      // same as removing a player from the roster leaves it.
      const left = await q('select season from public.priority_order where player_id = $1', [raiderPlayer]);
      expect(left.rows.map((r) => r.season)).toEqual(['seed-season']);
    });
  });

  it('writes the two audit lines and tells the raider', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { characterId, nameRealm, raiderPlayer } = await fixture(q);
      const id = (await ask(asUser, RAIDER_T1, characterId)).rows[0].id;
      const playerId = (await review(asUser, OFFICER_T1, id, true)).rows[0].player_id;

      const actions = (
        await q("select action, target_id from public.audit_log where action <> 'seed_test_action' order by id")
      ).rows;
      expect(actions).toEqual([
        { action: 'Player Added', target_id: playerId },
        { action: 'Main Swap: Old Character Removed', target_id: raiderPlayer }
      ]);

      const notice = (await q('select player_id, message from public.notifications order by id desc limit 1')).rows[0];
      expect(notice.player_id).toBe(playerId);
      expect(notice.message).toContain(`main swap to ${nameRealm} was approved`);
    });
  });

  it('declining leaves the roster alone and passes on the officer note', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { characterId, raiderPlayer } = await fixture(q);
      const id = (await ask(asUser, RAIDER_T1, characterId)).rows[0].id;
      const answer = await review(asUser, OFFICER_T1, id, false, 'Finish the tier on your Mage first.');
      expect(answer.rows[0].player_id).toBeNull();

      const old = (await q('select archived_at from public.players where id = $1', [raiderPlayer])).rows[0];
      expect(old.archived_at).toBeNull();
      expect((await statusOf(q, id)).status).toBe('declined');

      const notice = (await q('select player_id, message from public.notifications order by id desc limit 1')).rows[0];
      expect(notice.player_id).toBe(raiderPlayer);
      expect(notice.message).toContain('Finish the tier on your Mage first.');
    });
  });

  it("refuses another team's officer and the raider themselves", async () => {
    await withTxn(async ({ q, asUser }) => {
      const { characterId } = await fixture(q);
      const id = (await ask(asUser, RAIDER_T1, characterId)).rows[0].id;
      await expect(review(asUser, OFFICER_T2, id, true)).rejects.toThrow(/Not authorized/);
      await expect(review(asUser, RAIDER_T1, id, true)).rejects.toThrow(/Not authorized/);
      expect((await statusOf(q, id)).status).toBe('pending');
    });
  });

  it('refuses a second review of the same request', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { characterId } = await fixture(q);
      const id = (await ask(asUser, RAIDER_T1, characterId)).rows[0].id;
      await review(asUser, OFFICER_T1, id, false);
      await expect(review(asUser, OFFICER_T1, id, true)).rejects.toThrow(/already declined/);
    });
  });

  it('refuses a swap away from a character that has since left the roster', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { characterId, raiderPlayer } = await fixture(q);
      const id = (await ask(asUser, RAIDER_T1, characterId)).rows[0].id;
      await q('update public.players set archived_at = now() where id = $1', [raiderPlayer]);
      await expect(review(asUser, OFFICER_T1, id, true)).rejects.toThrow(/no longer on the roster/);
    });
  });
});
