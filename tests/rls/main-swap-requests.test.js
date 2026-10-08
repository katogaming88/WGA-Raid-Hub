// The any-time main swap request (#631, #942 step 5c): a raider asks to make
// one of their alts their roster character, an officer approves, and the swap
// runs the same steps a main swap through a season signup does.
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  withTxn,
  seedPlayer,
  seedTeam,
  seedMember,
  seedSignup,
  rowLockModes,
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

  it('refuses someone archived off the team, even with their character re-added (#1401)', async () => {
    await withTxn(async ({ q, asUser }) => {
      // A team of the case's own: the archive writes the raider's characters,
      // so it never touches a seeded row (#1123).
      const team = await seedTeam(q);
      const { characterId, raiderPlayer } = await fixture(q, { memberId: team.raider.memberId });
      await asUser(team.officer.uid, 'select public.archive_team_member($1, $2, $3, $4)', [
        team.teamId,
        team.raider.memberId,
        'moved_guilds',
        'Joined another guild'
      ]);
      // A direct un-archive brings the character back with its link left on
      // the archived membership (the Roster tab's re-add restores it, #1133).
      await q('update public.players set archived_at = null where id = $1', [raiderPlayer]);
      await expect(ask(asUser, team.raider.uid, characterId, FROST_MAGE, null, team.teamId)).rejects.toThrow(
        /no character on this team/
      );
    });
  });
});

// Once an officer declines a swap, the raider cannot ask for that alt again on
// that team (#1430). The alt is matched by name, whatever spec they ask for and
// whichever Battle.net row it comes from.
describe('a declined main swap stays declined', () => {
  const DECLINED = /An officer declined your main swap to/;
  const decline = async (asUser, uid, characterId, { teamId = 1, officer = OFFICER_T1 } = {}) => {
    const id = (await ask(asUser, uid, characterId, FROST_MAGE, null, teamId)).rows[0].id;
    await review(asUser, officer, id, false, 'Not this tier.');
    return id;
  };
  const altOf = async (q, personId, name, realm = 'Illidan') =>
    (
      await q(
        `insert into public.characters (person_id, blizzard_id, name, realm, realm_slug, class_name, spec_name, level)
         values ($1, $2, $3, $4, $5, 'Mage', 'Frost', 90) returning id`,
        [personId, Math.floor(Math.random() * 1e9), name, realm, realm.toLowerCase().replace(/ /g, '-')]
      )
    ).rows[0].id;

  it('refuses the same alt again, whatever spec they ask for', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { characterId } = await fixture(q);
      await decline(asUser, RAIDER_T1, characterId);
      const fire = (
        await q("insert into public.classes_specs (class, spec, role) values ('Mage', $1, 'Ranged') returning id", [
          `Fire ${Math.random().toString(36).slice(2, 10)}`
        ])
      ).rows[0].id;
      await expect(ask(asUser, RAIDER_T1, characterId, fire)).rejects.toThrow(
        /^An officer declined your main swap to Swapalt-Illidan\. Ask one of this team's officers if that should change\.$/
      );
    });
  });

  it('still refuses it when the alt comes back from Battle.net as a new row', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { characterId, personId } = await fixture(q);
      const id = await decline(asUser, RAIDER_T1, characterId);
      // Choosing alts again replaces the row; the request keeps the name.
      await q('delete from public.characters where id = $1', [characterId]);
      expect((await q('select character_id from public.main_swap_requests where id = $1', [id])).rows[0]).toEqual({
        character_id: null
      });
      const again = await altOf(q, personId, 'SWAPALT');
      await expect(ask(asUser, RAIDER_T1, again)).rejects.toThrow(DECLINED);
    });
  });

  it('matches an alt on a realm with a space in its name', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { personId } = await fixture(q);
      const alt = await altOf(q, personId, 'Spacealt', 'Area 52');
      await decline(asUser, RAIDER_T1, alt);
      await expect(ask(asUser, RAIDER_T1, alt)).rejects.toThrow(/declined your main swap to Spacealt-Area 52\./);
    });
  });

  it('says the alt is on the roster, not declined, once an officer has added it', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { characterId, nameRealm } = await fixture(q);
      await decline(asUser, RAIDER_T1, characterId);
      await q('insert into public.players (team_id, name_realm, class_spec_id) values (1, $1, 1)', [nameRealm]);
      await expect(ask(asUser, RAIDER_T1, characterId)).rejects.toThrow(/already on this roster/);
    });
  });

  it('still refuses it a year later', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { characterId } = await fixture(q);
      const id = await decline(asUser, RAIDER_T1, characterId);
      await q(
        `update public.main_swap_requests
            set requested_at = now() - interval '1 year', reviewed_at = now() - interval '1 year'
          where id = $1`,
        [id]
      );
      await expect(ask(asUser, RAIDER_T1, characterId)).rejects.toThrow(DECLINED);
    });
  });

  it('says it was declined, not that another swap is waiting, while one is', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { characterId, personId } = await fixture(q);
      await decline(asUser, RAIDER_T1, characterId);
      await ask(asUser, RAIDER_T1, await altOf(q, personId, 'Otheralt'));
      await expect(ask(asUser, RAIDER_T1, characterId)).rejects.toThrow(DECLINED);
    });
  });

  it('does not stop the same alt on another team of theirs', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { characterId, personId } = await fixture(q);
      await decline(asUser, RAIDER_T1, characterId);
      const team = await seedTeam(q);
      const discordId = (await q('select discord_id from public.team_members where id = $1', [PHOENIX_RAIDER_MEMBER]))
        .rows[0].discord_id;
      const there = (
        await q("insert into public.team_members (team_id, discord_id, role) values ($1, $2, 'raider') returning id", [
          team.teamId,
          discordId
        ])
      ).rows[0].id;
      expect(await personOf(q, there)).toBe(personId);
      await seedPlayer(q, { memberId: there });
      await expect(ask(asUser, RAIDER_T1, characterId, FROST_MAGE, null, team.teamId)).resolves.toBeTruthy();
    });
  });

  it('does not stop a swap to another alt', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { characterId, personId } = await fixture(q);
      await decline(asUser, RAIDER_T1, characterId);
      await expect(ask(asUser, RAIDER_T1, await altOf(q, personId, 'Otheralt'))).resolves.toBeTruthy();
    });
  });

  it('does not stop another raider asking for an alt of the same name', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const mine = await fixture(q, { memberId: team.raider.memberId });
      const other = await seedMember(q, { teamId: team.teamId });
      const theirs = await fixture(q, { memberId: other.memberId });
      await decline(asUser, other.uid, theirs.characterId, { teamId: team.teamId, officer: team.officer.uid });
      await expect(ask(asUser, team.raider.uid, mine.characterId, FROST_MAGE, null, team.teamId)).resolves.toBeTruthy();
    });
  });

  it('does not count a swap to that alt that was approved', async () => {
    await withTxn(async ({ q, asUser }) => {
      // Approved once, and the alt has since left the roster again.
      const { characterId, personId, raiderPlayer, nameRealm } = await fixture(q);
      await q(
        `insert into public.main_swap_requests
           (team_id, person_id, from_player_id, character_id, name_realm, class_spec_id, status, reviewed_at)
         values (1, $1, $2, $3, $4, $5, 'approved', now() - interval '1 month')`,
        [personId, raiderPlayer, characterId, nameRealm, FROST_MAGE]
      );
      await expect(ask(asUser, RAIDER_T1, characterId)).resolves.toBeTruthy();
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

  // The Characters card shows the raider a declined swap and why (#1430).
  it('lets the raider read a declined request and the officer note on it', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { characterId } = await fixture(q);
      const id = (await ask(asUser, RAIDER_T1, characterId)).rows[0].id;
      await review(asUser, OFFICER_T1, id, false, 'Finish the tier on your Mage first.');
      const row = await asUser(RAIDER_T1, 'select status, officer_note from public.main_swap_requests where id = $1', [
        id
      ]);
      expect(row.rows).toEqual([{ status: 'declined', officer_note: 'Finish the tier on your Mage first.' }]);
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
      const link = await q('select team_member_id from public.players where id = $1', [oldCharacter]);
      expect(link.rows[0].team_member_id).toBe(PHOENIX_RAIDER_MEMBER);
    });
  });

  it("clears the old character's standing priority rows for the live season", async () => {
    await withTxn(async ({ q, asUser }) => {
      // The live season is current_season() (#938); the team's settings row
      // carries no season key.
      const team = await seedTeam(q);
      const { characterId, raiderPlayer } = await fixture(q, { memberId: team.raider.memberId });
      const live = (await q('select public.current_season() as code')).rows[0].code;
      await q(
        `insert into public.priority_order (team_id, season, item_id, track, rank, player_id)
         values ($1, 'seed-season', 1, 'Myth', 2, $2), ($1, $3, 1, 'Myth', 1, $2)`,
        [team.teamId, raiderPlayer, live]
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

  // The old character leaving the roster cancels the swap (#1428), so there is
  // nothing left to approve.
  it('refuses a swap away from a character that has since left the roster', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { characterId, raiderPlayer } = await fixture(q);
      const id = (await ask(asUser, RAIDER_T1, characterId)).rows[0].id;
      await q('update public.players set archived_at = now() where id = $1', [raiderPlayer]);
      await expect(review(asUser, OFFICER_T1, id, true)).rejects.toThrow(/already cancelled/);
    });
  });
});

// #1428: once the character a swap is from leaves the roster, an approval can
// never go through, so every way off the roster cancels the swaps waiting from
// it. Each case runs on a team of its own: the archives write the raider's
// characters, never a seeded row (#1123).
describe('a waiting main swap is cancelled when its character leaves the roster', () => {
  const swapOnOwnTeam = async (q, asUser) => {
    const team = await seedTeam(q);
    const swap = await fixture(q, { memberId: team.raider.memberId });
    const id = (await ask(asUser, team.raider.uid, swap.characterId, FROST_MAGE, null, team.teamId)).rows[0].id;
    return { team, ...swap, id };
  };
  const requestOf = async (q, id) =>
    (
      await q('select status, reviewed_at, reviewed_by, officer_note from public.main_swap_requests where id = $1', [
        id
      ])
    ).rows[0];
  const noticesOn = async (q, playerIds) =>
    (
      await q('select message from public.notifications where player_id = any ($1::int[]) order by id', [playerIds])
    ).rows.map((r) => r.message);
  const nameOf = async (q, playerId) =>
    (await q('select name_realm from public.players where id = $1', [playerId])).rows[0].name_realm;
  const removePlayer = (asUser, uid, playerId) =>
    asUser(uid, 'select public.archive_player($1, $2, $3)', [playerId, 'switching_mains', 'Swapped mains']);
  const archiveMember = (asUser, team, reason = 'moved_guilds', detail = 'Joined another guild') =>
    asUser(team.officer.uid, 'select public.archive_team_member($1, $2, $3, $4)', [
      team.teamId,
      team.raider.memberId,
      reason,
      detail
    ]);

  it('Archive Member cancels it as the archiving officer, saying the membership ended, with no notification', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team, raiderPlayer, id } = await swapOnOwnTeam(q, asUser);
      await archiveMember(asUser, team);
      const request = await requestOf(q, id);
      expect(request).toMatchObject({
        status: 'cancelled',
        reviewed_by: await personOf(q, team.officer.memberId),
        officer_note: 'Membership ended'
      });
      expect(request.reviewed_at).not.toBeNull();
      expect(await noticesOn(q, [raiderPlayer])).toEqual([]);
    });
  });

  it('removing the character cancels it and tells the raider', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team, raiderPlayer, nameRealm, id } = await swapOnOwnTeam(q, asUser);
      const oldName = await nameOf(q, raiderPlayer);
      await removePlayer(asUser, team.officer.uid, raiderPlayer);
      expect(await requestOf(q, id)).toMatchObject({
        status: 'cancelled',
        reviewed_by: await personOf(q, team.officer.memberId),
        officer_note: 'Character removed'
      });
      expect(await noticesOn(q, [raiderPlayer])).toEqual([
        `Your main swap to ${nameRealm} was cancelled: ${oldName} is no longer on the roster.`
      ]);
    });
  });

  it("an officer setting the character's archived date directly cancels it", async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team, raiderPlayer, id } = await swapOnOwnTeam(q, asUser);
      await asUser(team.officer.uid, 'update public.players set archived_at = now() where id = $1', [raiderPlayer]);
      expect(await requestOf(q, id)).toMatchObject({ status: 'cancelled', officer_note: 'Character removed' });
    });
  });

  it('a main swap through a season signup that retires the character cancels it', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team, raiderPlayer, id } = await swapOnOwnTeam(q, asUser);
      const signupId = await seedSignup(q, { teamId: team.teamId, nameRealm: 'Signupswap-Illidan' });
      await asUser(team.officer.uid, 'select public.add_signup_to_roster($1, $2, $3)', [signupId, false, raiderPlayer]);
      expect(await requestOf(q, id)).toMatchObject({ status: 'cancelled', officer_note: 'Character removed' });
    });
  });

  it('a signup main swap to the alt they asked for closes it as approved, with no note to the raider', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team, raiderPlayer, nameRealm, id } = await swapOnOwnTeam(q, asUser);
      const signupId = await seedSignup(q, { teamId: team.teamId, nameRealm });
      const playerId = (
        await asUser(team.officer.uid, 'select public.add_signup_to_roster($1, $2, $3) as player_id', [
          signupId,
          false,
          raiderPlayer
        ])
      ).rows[0].player_id;
      expect(await requestOf(q, id)).toMatchObject({
        status: 'approved',
        reviewed_by: await personOf(q, team.officer.memberId),
        officer_note: 'Already on the roster'
      });
      expect(await statusOf(q, id)).toEqual({ status: 'approved', approved_player_id: playerId });
      expect(await noticesOn(q, [raiderPlayer, playerId])).toEqual([]);
    });
  });

  it('an alt they played before, still off the roster, does not count as already on it', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team, raiderPlayer, nameRealm, id } = await swapOnOwnTeam(q, asUser);
      await seedPlayer(q, { teamId: team.teamId, nameRealm, archivedAt: '2026-01-01T00:00:00Z' });
      await removePlayer(asUser, team.officer.uid, raiderPlayer);
      expect(await requestOf(q, id)).toMatchObject({ status: 'cancelled', officer_note: 'Character removed' });
    });
  });

  it('removing a character nobody holds any more cancels its swap without a note', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team, raiderPlayer, id } = await swapOnOwnTeam(q, asUser);
      await q('update public.players set team_member_id = null where id = $1', [raiderPlayer]);
      await removePlayer(asUser, team.officer.uid, raiderPlayer);
      expect(await requestOf(q, id)).toMatchObject({ status: 'cancelled', officer_note: 'Character removed' });
      expect(await noticesOn(q, [raiderPlayer])).toEqual([]);
    });
  });

  it('approving it archives the old character without cancelling it, and sends only the approval', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team, raiderPlayer, id } = await swapOnOwnTeam(q, asUser);
      const playerId = (await review(asUser, team.officer.uid, id, true, 'See you on the Paladin.')).rows[0].player_id;
      expect(await statusOf(q, id)).toEqual({ status: 'approved', approved_player_id: playerId });
      expect((await requestOf(q, id)).officer_note).toBe('See you on the Paladin.');
      const notices = await noticesOn(q, [raiderPlayer, playerId]);
      expect(notices).toHaveLength(1);
      expect(notices[0]).toContain('was approved');
    });
  });

  it("leaves a swap from the raider's other character, and another raider's swap, waiting", async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team, id } = await swapOnOwnTeam(q, asUser);
      const second = await seedPlayer(q, { memberId: team.raider.memberId });
      const other = await seedMember(q, { teamId: team.teamId });
      const otherSwap = await fixture(q, { memberId: other.memberId, name: 'Otheralt' });
      const otherId = (await ask(asUser, other.uid, otherSwap.characterId, FROST_MAGE, null, team.teamId)).rows[0].id;
      // The other raider's alt is on the roster by now, added by hand; their
      // swap still waits for their own old character to leave.
      await seedPlayer(q, { teamId: team.teamId, nameRealm: otherSwap.nameRealm });

      await removePlayer(asUser, team.officer.uid, second);
      expect((await requestOf(q, id)).status).toBe('pending');
      expect((await requestOf(q, otherId)).status).toBe('pending');
    });
  });

  it('leaves a declined or cancelled request exactly as it was', async () => {
    await withTxn(async ({ q, asUser }) => {
      const declined = await swapOnOwnTeam(q, asUser);
      await review(asUser, declined.team.officer.uid, declined.id, false, 'Not this tier.');
      const before = await requestOf(q, declined.id);
      await removePlayer(asUser, declined.team.officer.uid, declined.raiderPlayer);
      expect(await requestOf(q, declined.id)).toEqual(before);
      expect(await noticesOn(q, [declined.raiderPlayer])).toHaveLength(1);

      const withdrawn = await swapOnOwnTeam(q, asUser);
      await asUser(withdrawn.team.raider.uid, 'select public.cancel_main_swap_request($1)', [withdrawn.id]);
      const kept = await requestOf(q, withdrawn.id);
      await removePlayer(asUser, withdrawn.team.officer.uid, withdrawn.raiderPlayer);
      expect(await requestOf(q, withdrawn.id)).toEqual(kept);
    });
  });

  // Re-adding a character already on the roster writes archived_at = null
  // over null; only a character going from on the roster to off it counts.
  it("a signup that brings in the raider's current character leaves the swap waiting", async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team, raiderPlayer, id } = await swapOnOwnTeam(q, asUser);
      const signupId = await seedSignup(q, { teamId: team.teamId, nameRealm: await nameOf(q, raiderPlayer) });
      await asUser(team.officer.uid, 'select public.add_signup_to_roster($1, $2)', [signupId, false]);
      expect((await requestOf(q, id)).status).toBe('pending');
    });
  });

  it('bringing the member back leaves it cancelled', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team, id } = await swapOnOwnTeam(q, asUser);
      await archiveMember(asUser, team, 'other', 'Took a break');
      await asUser(team.officer.uid, 'select public.restore_team_member($1, $2)', [team.teamId, team.raider.memberId]);
      expect((await requestOf(q, id)).status).toBe('cancelled');
    });
  });

  it('Archive Member cancels it even when the alt they asked for is on the roster unlinked', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team, nameRealm, id } = await swapOnOwnTeam(q, asUser);
      // A season signup for the alt, added without a main swap, leaves it on
      // the roster with no membership.
      await seedPlayer(q, { teamId: team.teamId, nameRealm });
      await archiveMember(asUser, team);
      expect(await requestOf(q, id)).toMatchObject({ status: 'cancelled', officer_note: 'Membership ended' });
    });
  });

  it("an alt on the roster as someone else's character does not count as already on it", async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team, raiderPlayer, nameRealm, id } = await swapOnOwnTeam(q, asUser);
      const someoneElse = await seedMember(q, { teamId: team.teamId });
      await seedPlayer(q, { memberId: someoneElse.memberId, nameRealm });
      await removePlayer(asUser, team.officer.uid, raiderPlayer);
      expect(await requestOf(q, id)).toMatchObject({ status: 'cancelled', officer_note: 'Character removed' });
    });
  });

  // Asked of the review directly: a swap can be waiting from a character
  // already off the roster only if it got there without the trigger (a
  // restore with triggers off), so the review still refuses one.
  it('approving a swap still waiting from a character already off the roster is refused', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const { personId, raiderPlayer } = await fixture(q, { memberId: team.raider.memberId });
      await q('update public.players set archived_at = now() where id = $1', [raiderPlayer]);
      const id = (
        await q(
          `insert into public.main_swap_requests (team_id, person_id, from_player_id, name_realm, class_spec_id)
           values ($1, $2, $3, 'Restored-Illidan', $4) returning id`,
          [team.teamId, personId, raiderPlayer, FROST_MAGE]
        )
      ).rows[0].id;
      await expect(review(asUser, team.officer.uid, id, true)).rejects.toThrow(/no longer on the roster/);
    });
  });

  it('approving a swap the old character was already renamed into is refused, and keeps that character', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team, raiderPlayer, nameRealm, id } = await swapOnOwnTeam(q, asUser);
      // The Roster tab's rename keeps the row and its history under the new name.
      await q('update public.players set name_realm = $1 where id = $2', [nameRealm, raiderPlayer]);
      await expect(review(asUser, team.officer.uid, id, true)).rejects.toThrow(/already on the roster/);
      const old = (await q('select archived_at from public.players where id = $1', [raiderPlayer])).rows[0];
      expect(old.archived_at).toBeNull();
    });
  });

  // The locks that keep a removal from slipping between a check and a write.
  // Only which rows a call holds is asked here; the order the review takes
  // them in (membership, new roster row, old character, request) is in its
  // comment and the decisions log.
  it('an ask holds the character it swaps from until it commits', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { raiderPlayer } = await swapOnOwnTeam(q, asUser);
      expect(await rowLockModes(q, 'players', raiderPlayer)).toContain('For Share');
    });
  });

  it('a review holds the membership and the old character until it commits', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team, raiderPlayer, id } = await swapOnOwnTeam(q, asUser);
      await review(asUser, team.officer.uid, id, false);
      expect(await rowLockModes(q, 'team_members', team.raider.memberId)).toContain('For Share');
      expect(await rowLockModes(q, 'players', raiderPlayer)).toContain('For No Key Update');
    });
  });
});

// #1433: the alt's roster row may already be someone else's. Archived, it comes
// back as the raider's; on the roster, the approval is refused. Each case runs
// on a team of its own, with a second member as the other person.
describe('an approved swap and a row someone else held (#1433)', () => {
  const swapWithOther = async (q, asUser) => {
    const team = await seedTeam(q);
    const swap = await fixture(q, { memberId: team.raider.memberId });
    const other = await seedMember(q, { teamId: team.teamId });
    const id = (await ask(asUser, team.raider.uid, swap.characterId, FROST_MAGE, null, team.teamId)).rows[0].id;
    return { team, other, ...swap, id };
  };
  const rowOf = async (q, playerId) =>
    (await q('select team_member_id, class_spec_id, archived_at from public.players where id = $1', [playerId]))
      .rows[0];
  const approvalsReadBy = async (asUser, uid) =>
    (await asUser(uid, "select message from public.notifications where message like '%was approved%'")).rows;
  const SOMEONE_ELSES = /^Swapalt-Illidan is on the roster as someone else's character$/;

  it("brings back an alt that was someone else's as the raider's, and tells only the raider", async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team, other, raiderPlayer, nameRealm, id } = await swapWithOther(q, asUser);
      const revived = await seedPlayer(q, { memberId: other.memberId, nameRealm, archivedAt: '2026-01-01T00:00:00Z' });
      const playerId = (await review(asUser, team.officer.uid, id, true)).rows[0].player_id;

      expect(playerId).toBe(revived);
      expect(await rowOf(q, revived)).toMatchObject({ team_member_id: team.raider.memberId, archived_at: null });
      expect((await rowOf(q, raiderPlayer)).team_member_id).toBe(team.raider.memberId);
      expect(await approvalsReadBy(asUser, team.raider.uid)).toHaveLength(1);
      expect(await approvalsReadBy(asUser, other.uid)).toEqual([]);
    });
  });

  it('links a revived alt to nobody when the raider has since lost the link to their character', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team, other, raiderPlayer, nameRealm, id } = await swapWithOther(q, asUser);
      const revived = await seedPlayer(q, { memberId: other.memberId, nameRealm, archivedAt: '2026-01-01T00:00:00Z' });
      await q('update public.players set team_member_id = null where id = $1', [raiderPlayer]);
      await review(asUser, team.officer.uid, id, true);
      expect(await rowOf(q, revived)).toMatchObject({ team_member_id: null, archived_at: null });
    });
  });

  it("refuses an alt on the roster as someone else's character, and changes nothing", async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team, other, raiderPlayer, id } = await swapWithOther(q, asUser);
      // Their own, added while the swap waited, under the same name in another case.
      const theirs = await seedPlayer(q, { memberId: other.memberId, nameRealm: 'SWAPALT-Illidan' });
      const whole = async () => (await q('select * from public.players where id = $1', [theirs])).rows[0];
      const before = await whole();
      await expect(review(asUser, team.officer.uid, id, true)).rejects.toThrow(SOMEONE_ELSES);
      expect(await whole()).toEqual(before);
      expect((await rowOf(q, raiderPlayer)).archived_at).toBeNull();
      expect((await statusOf(q, id)).status).toBe('pending');
    });
  });

  it('refuses it when that membership has ended, and when the raider has lost their own link', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team, other, raiderPlayer, nameRealm, id } = await swapWithOther(q, asUser);
      const theirs = await seedPlayer(q, { memberId: other.memberId, nameRealm });
      await asUser(team.officer.uid, 'select public.archive_team_member($1, $2, $3, $4)', [
        team.teamId,
        other.memberId,
        'moved_guilds',
        'Joined another guild'
      ]);
      // A direct un-archive leaves the row linked to the ended membership (#1434).
      await q('update public.players set archived_at = null where id = $1', [theirs]);
      await expect(review(asUser, team.officer.uid, id, true)).rejects.toThrow(SOMEONE_ELSES);

      await q('update public.players set team_member_id = null where id = $1', [raiderPlayer]);
      await expect(review(asUser, team.officer.uid, id, true)).rejects.toThrow(SOMEONE_ELSES);
    });
  });

  it('approves onto an alt on the roster with no one linked, as the raider', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team, raiderPlayer, nameRealm, id } = await swapWithOther(q, asUser);
      const unlinked = await seedPlayer(q, { teamId: team.teamId, nameRealm });
      const playerId = (await review(asUser, team.officer.uid, id, true)).rows[0].player_id;
      expect(playerId).toBe(unlinked);
      expect((await rowOf(q, unlinked)).team_member_id).toBe(team.raider.memberId);
      expect((await rowOf(q, raiderPlayer)).archived_at).not.toBeNull();
    });
  });

  it("approves onto an alt already on the roster as the raider's own", async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team, nameRealm, id } = await swapWithOther(q, asUser);
      const own = await seedPlayer(q, { memberId: team.raider.memberId, nameRealm });
      const playerId = (await review(asUser, team.officer.uid, id, true)).rows[0].player_id;
      expect(playerId).toBe(own);
      expect((await rowOf(q, own)).team_member_id).toBe(team.raider.memberId);
    });
  });
});
