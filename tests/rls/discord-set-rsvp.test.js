// discord_set_rsvp() (#983): a raider's own RSVP from the Discord signup
// sheet's dropdown, for the Discord account that pressed it. The service
// role's only, since it takes the Discord id as an argument: no raider,
// officer or anonymous caller may run it, or they could change anyone's
// answer. Its checks are set_own_rsvp()'s.
//
// Everything runs inside the shared withTxn and is rolled back (#1021).
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedMember, seedPlayer, seedTeam, RAIDER_T1, OFFICER_T1 } from './helpers.js';

afterAll(() => pool.end());

const DATE = '2026-11-05';
const call = 'select public.discord_set_rsvp($1, $2, $3, $4, $5)';

// A raider on team 1 with a character, and the Discord id they press with.
async function raider(q, { bench = false, teamId = 1 } = {}) {
  const { memberId, discordId } = await seedMember(q, { teamId });
  const pid = await seedPlayer(q, { memberId });
  if (bench) await q('update public.players set is_bench = true where id = $1', [pid]);
  return { discordId, pid };
}

const rsvp = async (q, pid) =>
  (await q('select status, note from public.raid_rsvps where player_id = $1 and raid_date = $2', [pid, DATE])).rows;

describe('discord_set_rsvp()', () => {
  for (const [who, role, uid] of [
    ['a raider', 'authenticated', RAIDER_T1],
    ['an officer', 'authenticated', OFFICER_T1],
    ['an anonymous caller', 'anon', null]
  ]) {
    it(`${who} can't run it`, async () => {
      await withTxn(async ({ q, asRole }) => {
        const { discordId } = await raider(q);
        await expect(asRole(role, uid)(call, [discordId, 1, DATE, 'Late', 'x'])).rejects.toThrow(/permission denied/);
      });
    });
  }

  it("the service role sets the presser's own answer, and the change is queued for the RSVP channel", async () => {
    await withTxn(async ({ q, asRole }) => {
      const { teamId } = await seedTeam(q);
      await q('insert into public.team_discord_config (team_id, guild_id) values ($1, $2)', [
        teamId,
        '100000000000000001'
      ]);
      await q("insert into public.team_discord_posts (team_id, kind, channel_id) values ($1, 'rsvp_changes', $2)", [
        teamId,
        '200000000000000002'
      ]);
      const { discordId, pid } = await raider(q, { teamId });
      await asRole('service_role', null)(call, [discordId, teamId, DATE, 'Late', 'traffic']);
      expect(await rsvp(q, pid)).toEqual([{ status: 'Late', note: 'traffic' }]);
      const queued = (
        await q("select payload from public.discord_post_queue where team_id = $1 and kind = 'rsvp_changes'", [teamId])
      ).rows;
      expect(queued.map((r) => r.payload.status)).toEqual(['Late']);
    });
  });

  it('a second answer replaces the first, and a null one clears it', async () => {
    await withTxn(async ({ q, asRole }) => {
      const { discordId, pid } = await raider(q);
      const service = asRole('service_role', null);
      await service(call, [discordId, 1, DATE, 'Tentative', 'maybe']);
      await service(call, [discordId, 1, DATE, 'Absent', 'sick']);
      expect(await rsvp(q, pid)).toEqual([{ status: 'Absent', note: 'sick' }]);
      await service(call, [discordId, 1, DATE, null, null]);
      expect(await rsvp(q, pid)).toEqual([]);
    });
  });

  it('refuses a Discord account no profile has', async () => {
    await withTxn(async ({ asRole }) => {
      await expect(asRole('service_role', null)(call, ['999999999999999999', 1, DATE, 'Late', 'x'])).rejects.toThrow(
        /No Raid Hub profile/
      );
    });
  });

  it('refuses someone with no character on that team', async () => {
    await withTxn(async ({ q, asRole }) => {
      const { discordId } = await raider(q);
      await expect(asRole('service_role', null)(call, [discordId, 2, DATE, 'Late', 'x'])).rejects.toThrow(
        /No active roster character/
      );
    });
  });

  it('refuses the bench on a normal night, and Attending on one', async () => {
    await withTxn(async ({ q, asRole }) => {
      const service = asRole('service_role', null);
      const bench = await raider(q, { bench: true });
      await expect(service(call, [bench.discordId, 1, DATE, 'Late', 'x'])).rejects.toThrow(/Bench players/);
      const other = await raider(q);
      await expect(service(call, [other.discordId, 1, DATE, 'Attending', null])).rejects.toThrow(
        /Attending is only valid/
      );
    });
  });
});
