// #962: each write that posts to Discord queues its notice, built from what it
// saved, and claim_discord_posts() hands each one out once, holding a team's
// in its quiet hours. Each case mints its own team.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedTeam, seedPlayer, seedSeason, OFFICER_T1, RLS_DENIED } from './helpers.js';

afterAll(() => pool.end());

const SERVER = '100000000000000001';
const CHANNEL = '200000000000000001';

// A team with a Discord server and a channel for each kind of post named.
async function teamWithChannels(q, kinds = ['officer_requests', 'mplus_requests', 'rsvp_changes']) {
  const team = await seedTeam(q);
  await q('insert into public.team_discord_config (team_id, guild_id) values ($1, $2)', [team.teamId, SERVER]);
  for (const kind of kinds) {
    await q('insert into public.team_discord_posts (team_id, kind, channel_id) values ($1, $2, $3)', [
      team.teamId,
      kind,
      CHANNEL
    ]);
  }
  await q(
    `update public.team_settings set config = '{"mPlusExclusionsOpen": true, "bisSubmissionsOpen": true}'::jsonb
      where team_id = $1`,
    [team.teamId]
  );
  return team;
}

const queue = async (q, teamId) =>
  (
    await q('select kind, action, payload, status from public.discord_post_queue where team_id = $1 order by id', [
      teamId
    ])
  ).rows;

// The raider's own character on the team.
const ownCharacter = (q, team) => seedPlayer(q, { memberId: team.raider.memberId, nameRealm: 'Katorri-Stormrage' });

describe('discord_post_queue', () => {
  it('an RSVP change queues one notice from what set_own_rsvp() saved; clearing one queues nothing', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await teamWithChannels(q);
      await ownCharacter(q, team);
      await asUser(team.raider.uid, "select public.set_own_rsvp($1, '2026-11-04', 'Late', '@everyone traffic')", [
        team.teamId
      ]);
      await asUser(team.raider.uid, "select public.set_own_rsvp($1, '2026-11-04', null)", [team.teamId]);
      expect(await queue(q, team.teamId)).toEqual([
        {
          kind: 'rsvp_changes',
          action: 'rsvp',
          payload: { charName: 'Katorri-Stormrage', raidDate: '2026-11-04', status: 'Late', note: '@everyone traffic' },
          status: 'queued'
        }
      ]);
    });
  });

  it('a kind of post with no channel queues nothing', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await teamWithChannels(q, ['officer_requests']);
      await ownCharacter(q, team);
      await asUser(team.raider.uid, "select public.set_own_rsvp($1, '2026-11-04', 'Absent', 'sick')", [team.teamId]);
      expect(await queue(q, team.teamId)).toEqual([]);
    });
  });

  it('the signed-out request forms queue their notices', async () => {
    await withTxn(async ({ q, asAnon }) => {
      const team = await teamWithChannels(q);
      await ownCharacter(q, team);
      await asAnon("select public.submit_mplus_exclusion($1, 'Katorri-Stormrage', 'https://raider.io/x', 'keys')", [
        team.teamId
      ]);
      await asAnon("select public.submit_bis_link($1, 'Katorri-Stormrage', ' https://example.com/bis ', '')", [
        team.teamId
      ]);
      await asAnon(
        "select * from public.submit_self_received($1, 'Katorri-Stormrage', 'Seed Test Staff', 'Hero', 'Other', 'pug')",
        [team.teamId]
      );
      expect(await queue(q, team.teamId)).toEqual([
        {
          kind: 'mplus_requests',
          action: 'mplus',
          payload: { nameRealm: 'Katorri-Stormrage', raiderioUrl: 'https://raider.io/x', notes: 'keys' },
          status: 'queued'
        },
        {
          kind: 'officer_requests',
          action: 'bis',
          payload: { nameRealm: 'Katorri-Stormrage', bisLink: 'https://example.com/bis', notes: null, sameLink: false },
          status: 'queued'
        },
        {
          kind: 'officer_requests',
          action: 'selfreceived',
          payload: { player: 'Katorri-Stormrage', item: 'Seed Test Staff', slot: null, source: 'Other', notes: 'pug' },
          status: 'queued'
        }
      ]);
    });
  });

  it('a report saved at once queues nothing, and a second "list changed" click no longer pings', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const team = await teamWithChannels(q);
      const player = await ownCharacter(q, team);
      await q("update public.players set bis_link = 'https://example.com/bis' where id = $1", [player]);
      await asUser(
        team.raider.uid,
        "select * from public.submit_self_received($1, 'Katorri-Stormrage', 'Seed Test Staff', 'Hero', 'Great Vault', '')",
        [team.teamId]
      );
      for (let i = 0; i < 2; i++) {
        await asAnon("select public.flag_bis_list_changed($1, 'Katorri-Stormrage', 'new items')", [team.teamId]);
      }
      expect(await queue(q, team.teamId)).toEqual([
        {
          kind: 'officer_requests',
          action: 'bis',
          payload: {
            nameRealm: 'Katorri-Stormrage',
            bisLink: 'https://example.com/bis',
            notes: 'new items',
            sameLink: true
          },
          status: 'queued'
        }
      ]);
    });
  });

  it('a signup and an added character queue their notices', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await teamWithChannels(q);
      await seedSeason(q, 'QUEUE1');
      await q("insert into public.team_seasons (team_id, season_code, signups_open) values ($1, 'QUEUE1', true)", [
        team.teamId
      ]);
      await asUser(
        team.leader.uid,
        "select public.submit_season_signup($1, 'Signer-Illidan', 'Mage', 'Frost', 'Fire', false, 'hi', null, 'QUEUE1')",
        [team.teamId]
      );
      const person = await q('select person_id from public.team_members where id = $1', [team.raider.memberId]);
      const character = await q(
        `insert into public.characters (person_id, blizzard_id, name, realm, realm_slug, class_name, spec_name, level)
         values ($1, $2, 'Newmain', 'Illidan', 'illidan', 'Mage', 'Frost', 90) returning id`,
        [person.rows[0].person_id, Math.floor(Math.random() * 1e9)]
      );
      await asUser(team.raider.uid, 'select public.add_own_character($1, $2, 1)', [team.teamId, character.rows[0].id]);
      const [signup, add] = await queue(q, team.teamId);
      expect(signup).toMatchObject({
        kind: 'officer_requests',
        action: 'signup',
        payload: {
          charName: 'Signer-Illidan',
          className: 'Mage',
          mainSpec: 'Frost',
          offSpecs: 'Fire',
          mainSwap: false,
          swapFromNameRealm: null,
          notes: 'hi'
        }
      });
      expect(signup.payload.role).toBeTruthy();
      expect(add).toMatchObject({
        kind: 'officer_requests',
        action: 'addCharacter',
        payload: { nameRealm: 'Newmain-Illidan' }
      });
      expect(add.payload.member).toBeTruthy();
      expect(add.payload.classSpec).toMatch(/^Mage Frost/);
    });
  });

  it('a signup with a blank character is refused, so nothing unpostable is queued', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await teamWithChannels(q);
      await seedSeason(q, 'QUEUE2');
      await q("insert into public.team_seasons (team_id, season_code, signups_open) values ($1, 'QUEUE2', true)", [
        team.teamId
      ]);
      await expect(
        asUser(
          team.leader.uid,
          "select public.submit_season_signup($1, '  ', 'Mage', 'Frost', '', false, null, null, 'QUEUE2')",
          [team.teamId]
        )
      ).rejects.toThrow('Character name is required');
      expect(await queue(q, team.teamId)).toEqual([]);
    });
  });

  it('claim_discord_posts() hands each notice out once, and holds a team in its quiet hours', async () => {
    await withTxn(async ({ q, asRole }) => {
      const quiet = await teamWithChannels(q);
      const open = await teamWithChannels(q);
      for (const team of [quiet, open]) {
        await q(
          "insert into public.discord_post_queue (team_id, kind, action, payload) values ($1, 'rsvp_changes', 'rsvp', '{}')",
          [team.teamId]
        );
      }
      // Quiet hours from an hour ago to an hour from now, in UTC.
      await q(
        `update public.team_discord_config
            set quiet_hours_start = (now() at time zone 'UTC')::time - interval '1 hour',
                quiet_hours_end = (now() at time zone 'UTC')::time + interval '1 hour',
                quiet_hours_timezone = 'UTC'
          where team_id = $1`,
        [quiet.teamId]
      );
      const claim = asRole('service_role', null);
      const mine = (rows) => rows.filter((r) => [quiet.teamId, open.teamId].includes(r.team_id));
      const first = mine((await claim('select * from public.claim_discord_posts(1000)')).rows);
      expect(first.map((r) => [r.team_id, r.attempts])).toEqual([[open.teamId, 1]]);
      expect(mine((await claim('select * from public.claim_discord_posts(1000)')).rows)).toEqual([]);
    });
  });

  it('nobody on the site reads the queue, adds to it or claims from it', async () => {
    await withTxn(async ({ asUser, asAnon }) => {
      for (const call of [(sql) => asAnon(sql), (sql) => asUser(OFFICER_T1, sql)]) {
        for (const sql of [
          'select * from public.discord_post_queue',
          "select public.queue_discord_post(1, 'rsvp_changes', 'rsvp', '{}')",
          'select * from public.claim_discord_posts()'
        ]) {
          await expect(call(sql)).rejects.toMatchObject({ code: RLS_DENIED });
        }
      }
    });
  });
});
