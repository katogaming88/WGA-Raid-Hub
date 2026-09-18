// team_rsvp_answers() (#1102): a team's raid-night answers without their
// notes. Raiders on the team see who is out and who is late; the notes stay
// with officers, who read raid_rsvps directly.
import { describe, it, expect } from 'vitest';
import {
  withTxn,
  seedPlayer,
  RAIDER_T1,
  RAIDER_T2,
  OFFICER_T1,
  OFFICER_T2,
  GUILD_OFFICER,
  SITE_ADMIN
} from './helpers.js';

// Three characters of the test's own: me is RAIDER_T1's (team_members 3) on
// team 1, mate a teammate who has answered for two nights, other on team 2.
async function seedAnswers(q) {
  const me = await seedPlayer(q, { memberId: 3 });
  const mate = await seedPlayer(q, { teamId: 1 });
  const other = await seedPlayer(q, { teamId: 2 });
  await q(
    `insert into public.raid_rsvps (team_id, player_id, raid_date, status, note) values
       (1, $2, '2026-09-17', 'Absent', 'Out of town'),
       (1, $2, '2026-09-22', 'Late', 'Work runs late'),
       (1, $1, '2026-10-20', 'Tentative', 'Maybe'),
       (2, $3, '2026-09-17', 'Absent', 'Other team')`,
    [me, mate, other]
  );
  return { me, mate, other };
}

const read = (asUser, uid, teamId = 1, from = '2026-09-01', to = '2026-09-30') =>
  asUser(uid, 'select * from public.team_rsvp_answers($1, $2, $3)', [teamId, from, to]);

describe('team_rsvp_answers()', () => {
  it('shows a raider their teammates’ answers for the range, without the notes', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { mate } = await seedAnswers(q);
      const res = await read(asUser, RAIDER_T1);
      expect(res.fields.map((f) => f.name)).toEqual(['player_id', 'raid_date', 'status', 'updated_at']);
      expect(res.rows.map((r) => [r.player_id, r.status])).toEqual([
        [mate, 'Absent'],
        [mate, 'Late']
      ]);
      expect(res.rows.every((r) => r.updated_at instanceof Date)).toBe(true);
    });
  });

  it('keeps each team’s answers to that team', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { other } = await seedAnswers(q);
      await expect(read(asUser, RAIDER_T1, 2)).rejects.toThrow(/Not authorized/);
      // Team 2's officer sees team 2 and not team 1.
      expect((await read(asUser, OFFICER_T2, 2)).rows.map((r) => r.player_id)).toEqual([other]);
      await expect(read(asUser, OFFICER_T2, 1)).rejects.toThrow(/Not authorized/);
    });
  });

  it('answers the team’s officers, guild officers and site admins', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedAnswers(q);
      for (const uid of [OFFICER_T1, GUILD_OFFICER, SITE_ADMIN]) {
        expect((await read(asUser, uid)).rows).toHaveLength(2);
      }
    });
  });

  it('refuses someone with no active character on the team', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { me } = await seedAnswers(q);
      // RAIDER_T2 holds no team-1 character.
      await expect(read(asUser, RAIDER_T2)).rejects.toThrow(/Not authorized/);
      // A raider whose only character on the team is archived has left it.
      await q('update public.players set archived_at = now() where id = $1', [me]);
      await expect(read(asUser, RAIDER_T1)).rejects.toThrow(/Not authorized/);
    });
  });

  it('is not callable signed out', async () => {
    await withTxn(async ({ asAnon }) => {
      await expect(
        asAnon('select * from public.team_rsvp_answers($1, $2, $3)', [1, '2026-09-01', '2026-09-30'])
      ).rejects.toThrow(/permission denied/);
    });
  });

  it('reads at most 62 days at a time', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedAnswers(q);
      expect((await read(asUser, RAIDER_T1, 1, '2026-09-01', '2026-11-02')).rows).toHaveLength(3);
      await expect(read(asUser, RAIDER_T1, 1, '2026-09-01', '2026-11-03')).rejects.toThrow(/at most 62 days/);
      await expect(read(asUser, RAIDER_T1, 1, '2026-09-30', '2026-09-01')).rejects.toThrow(/at most 62 days/);
    });
  });
});
