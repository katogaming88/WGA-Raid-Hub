// boss_lineup_sitouts and set_boss_lineup() (#1216): officers pick which
// raiders sit out each boss on a raid night. The team's raiders read the
// lineup; nobody writes the table except through the function.
import { describe, it, expect } from 'vitest';
import { withTxn, RAIDER_T1, RAIDER_T2, OFFICER_T1, OFFICER_T2, GUILD_OFFICER, SITE_ADMIN } from './helpers.js';

const RAID = 'The Venomous Abyss';

// RAIDER_T1's membership (team_members 3) holds player 1 on team 1. Players 1
// and 2 are on team 1; player 3 is on team 2.
async function seed(q) {
  await q('update public.players set team_member_id = 3 where id = 1');
}

const save = (asUser, uid, sitouts, teamId = 1, raid = RAID, date = '2026-09-17') =>
  asUser(uid, 'select public.set_boss_lineup($1, $2, $3, $4::jsonb) as n', [
    teamId,
    date,
    raid,
    JSON.stringify(sitouts)
  ]);

const rows = (asUser, uid) =>
  asUser(uid, 'select raid_date::text, raid_name, boss_name, player_id from public.boss_lineup_sitouts order by id');

describe('set_boss_lineup()', () => {
  it('saves an officer’s sit-outs and replaces them on the next save', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      const first = await save(asUser, OFFICER_T1, [
        { boss: 'Sszorak', player_id: 1 },
        { boss: 'Sszorak', player_id: 2 },
        { boss: "Ula'tek", player_id: 2 }
      ]);
      expect(first.rows[0].n).toBe(3);

      await save(asUser, OFFICER_T1, [{ boss: "Ula'tek", player_id: 1 }]);
      expect((await rows(asUser, OFFICER_T1)).rows).toEqual([
        { raid_date: '2026-09-17', raid_name: RAID, boss_name: "Ula'tek", player_id: 1 }
      ]);

      // An empty list puts everyone back in.
      expect((await save(asUser, OFFICER_T1, [])).rows[0].n).toBe(0);
      expect((await rows(asUser, OFFICER_T1)).rows).toEqual([]);
    });
  });

  it('only replaces the raid and night it was given', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await save(asUser, OFFICER_T1, [{ boss: 'Sszorak', player_id: 1 }]);
      await save(asUser, OFFICER_T1, [{ boss: 'Nymrissa', player_id: 1 }], 1, 'Tidebound Grotto');
      await save(asUser, OFFICER_T1, [{ boss: 'Sszorak', player_id: 2 }], 1, RAID, '2026-09-22');
      expect((await rows(asUser, OFFICER_T1)).rows.map((r) => [r.raid_date, r.boss_name, r.player_id])).toEqual([
        ['2026-09-17', 'Sszorak', 1],
        ['2026-09-17', 'Nymrissa', 1],
        ['2026-09-22', 'Sszorak', 2]
      ]);
    });
  });

  it('writes one audit entry per save', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await save(asUser, OFFICER_T1, [{ boss: 'Sszorak', player_id: 1 }]);
      const log = await q("select team_id, detail from public.audit_log where action = 'Set Boss Lineup'");
      expect(log.rows).toEqual([{ team_id: 1, detail: { raid_date: '2026-09-17', raid_name: RAID, sitouts: 1 } }]);
    });
  });

  it('lets guild officers and site admins save, and nobody else', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      for (const uid of [GUILD_OFFICER, SITE_ADMIN]) {
        expect((await save(asUser, uid, [{ boss: 'Sszorak', player_id: 1 }])).rows[0].n).toBe(1);
      }
    });
    for (const uid of [RAIDER_T1, OFFICER_T2]) {
      await withTxn(async ({ q, asUser }) => {
        await seed(q);
        await expect(save(asUser, uid, [])).rejects.toThrow(/Not authorized/);
      });
    }
  });

  it('refuses a raider from another team', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(save(asUser, OFFICER_T1, [{ boss: 'Sszorak', player_id: 3 }])).rejects.toThrow(
        /must be on this team/
      );
    });
  });

  it('refuses a sit-out without a boss, and a missing raid', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(save(asUser, OFFICER_T1, [{ boss: ' ', player_id: 1 }])).rejects.toThrow(/needs a boss/);
    });
    await withTxn(async ({ asUser }) => {
      await expect(save(asUser, OFFICER_T1, [], 1, ' ')).rejects.toThrow(/Choose a raid night/);
    });
  });

  it('is not callable signed out', async () => {
    await withTxn(async ({ asAnon }) => {
      await expect(
        asAnon('select public.set_boss_lineup($1, $2, $3, $4::jsonb)', [1, '2026-09-17', RAID, '[]'])
      ).rejects.toThrow(/permission denied/);
    });
  });
});

describe('boss_lineup_sitouts reads', () => {
  it('shows the lineup to the team’s raiders and officers, not to other teams', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await save(asUser, OFFICER_T1, [{ boss: 'Sszorak', player_id: 2 }]);
      for (const uid of [RAIDER_T1, OFFICER_T1, GUILD_OFFICER, SITE_ADMIN]) {
        expect((await rows(asUser, uid)).rows).toHaveLength(1);
      }
      for (const uid of [RAIDER_T2, OFFICER_T2]) {
        expect((await rows(asUser, uid)).rows).toHaveLength(0);
      }
    });
  });

  it('hides the lineup from a raider who has left the team, and from signed-out visitors', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      await seed(q);
      await save(asUser, OFFICER_T1, [{ boss: 'Sszorak', player_id: 2 }]);
      expect((await asAnon('select * from public.boss_lineup_sitouts')).rows).toHaveLength(0);
      await q('update public.players set archived_at = now() where id = 1');
      expect((await rows(asUser, RAIDER_T1)).rows).toHaveLength(0);
    });
  });

  it('refuses direct writes, officers included', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await expect(
        asUser(
          OFFICER_T1,
          "insert into public.boss_lineup_sitouts (team_id, raid_date, raid_name, boss_name, player_id) values (1, '2026-09-17', 'X', 'Y', 1)"
        )
      ).rejects.toThrow(/row-level security|permission denied/);
    });
  });
});
