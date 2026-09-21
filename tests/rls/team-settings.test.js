// set_team_setting (#221, Phase 6) and close_season (#938): season config
// lives on team_settings.config. Both are SECURITY INVOKER, so the "Team
// leaders write settings" RLS policy is the only gate: an officer (not
// team_leader) can call the function, but the underlying UPDATE touches 0
// rows, same shape as the existing direct-update assertions in
// write-policies.test.js.
//
// Every scenario runs on a team the test mints (#1123): close_season
// rewrites players for the whole team, so a run on the seeded team 1 held
// rows every other file writes. seedTeam gives the team,
// its settings row and a leader, an officer and a raider of its own; the
// seeded personas appear only as outsiders.
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withTxn, seedTeam, seedPlayer, seedSeason, SITE_ADMIN, OFFICER_T2 } from './helpers.js';

const setting = (teamId, json) => [`select public.set_team_setting($1, $2::jsonb) as config`, [teamId, json]];

describe('set_team_setting', () => {
  const json = '{"seasonName":"Test Season"}';

  it('the team leader merges the update into config', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const res = await asUser(team.leader.uid, ...setting(team.teamId, json));
      expect(res.rows[0].config.seasonName).toBe('Test Season');
    });
  });

  it('site admin merges the update into config', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const res = await asUser(SITE_ADMIN, ...setting(team.teamId, json));
      expect(res.rows[0].config.seasonName).toBe('Test Season');
    });
  });

  it('the team officer gets a Not authorized error (RLS blocks the underlying update)', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await expect(asUser(team.officer.uid, ...setting(team.teamId, json))).rejects.toThrow(/not authorized/i);
    });
  });

  it('a raider gets a Not authorized error', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await expect(asUser(team.raider.uid, ...setting(team.teamId, json))).rejects.toThrow(/not authorized/i);
    });
  });

  it("another team's officer cannot affect the settings", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await expect(asUser(OFFICER_T2, ...setting(team.teamId, json))).rejects.toThrow(/not authorized/i);
    });
  });

  it('anon cannot execute the function at all', async () => {
    await withTxn(async ({ q, asAnon }) => {
      const team = await seedTeam(q);
      await expect(asAnon(...setting(team.teamId, json))).rejects.toThrow(/permission denied/i);
    });
  });
});

// close_season (#938): the archive closes a team's books for a tier that has
// ended, any time after, and starts nothing. SECURITY INVOKER like the
// function it replaces, so the "Team leaders write settings" policy is the
// gate. Every tier a case closes is minted by seedSeason (a single day in the
// years 1000 to 2018, so ended by construction); the current tier is read
// from current_season() rather than named.
describe('close_season', () => {
  const close = (teamId, season) => [
    `select public.close_season($1, $2, '[{"nameRealm":"Test-Realm","role":"Melee"}]'::jsonb) as config`,
    [teamId, season]
  ];
  const tier = () => `T${randomUUID().replace(/-/g, '').slice(0, 6)}`;

  // The tier's raids: a zone with two bosses the team has progress rows for,
  // and a zone the team never entered, which the fold leaves out.
  async function seedTierRaids(q, teamId, season) {
    const zone = await q(
      `insert into public.raid_zones (wcl_zone_id, name, season, sort_index) values (nextval('public.raid_zones_id_seq') + 100000, 'Closed Zone', $1, 1) returning id, wcl_zone_id`,
      [season]
    );
    const zoneId = zone.rows[0].id;
    const skipped = await q(
      `insert into public.raid_zones (wcl_zone_id, name, season, is_mini_raid, sort_index) values (nextval('public.raid_zones_id_seq') + 100000, 'Skipped Zone', $1, true, 2) returning id`,
      [season]
    );
    const bosses = await q(
      `insert into public.raid_encounters (zone_id, wcl_encounter_id, name, sort_index)
       values ($1, nextval('public.raid_encounters_id_seq') + 100000, 'Second Boss', 2),
              ($1, nextval('public.raid_encounters_id_seq') + 100000, 'First Boss', 1)
       returning id, name, wcl_encounter_id`,
      [zoneId]
    );
    await q(
      `insert into public.raid_encounters (zone_id, wcl_encounter_id, name, sort_index)
       values ($1, nextval('public.raid_encounters_id_seq') + 100000, 'Skipped Boss', 1)`,
      [skipped.rows[0].id]
    );
    const first = bosses.rows.find((b) => b.name === 'First Boss');
    const second = bosses.rows.find((b) => b.name === 'Second Boss');
    await q(
      `insert into public.team_raid_progress (team_id, encounter_id, mythic_date, mythic_pulls, mythic_best_pct)
       values ($1, $2, '2020-02-02', 12, null), ($1, $3, null, 40, 12.5)`,
      [teamId, first.id, second.id]
    );
    return { zone: zone.rows[0], first, second };
  }

  it('the team leader closes an ended tier: the entry, the flags, one audit row', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const season = tier();
      const day = await seedSeason(q, season, 'Closed Tier');
      const raids = await seedTierRaids(q, team.teamId, season);
      const player = await seedPlayer(q, { teamId: team.teamId, nameRealm: 'Closetest-Illidan' });
      await q(
        `update public.players set m_plus_excluded = true, m_plus_note = 'needs a break', is_bench = true, is_trial = true, bis_link = 'https://example.com/old-sim' where id = $1`,
        [player]
      );
      await asUser(
        team.leader.uid,
        ...setting(team.teamId, '{"raidProgression":[{"name":"Next Tier Raid"}],"seasonView":null}')
      );

      const res = await asUser(team.leader.uid, ...close(team.teamId, season));
      const config = res.rows[0].config;
      expect(config.seasonHistory).toHaveLength(1);
      expect(config.seasonHistory[0]).toEqual({
        code: season,
        name: 'Closed Tier',
        start: day,
        end: day,
        raids: [
          {
            name: 'Closed Zone',
            wclZoneId: raids.zone.wcl_zone_id,
            isMiniRaid: false,
            bosses: [
              {
                name: 'First Boss',
                wclEncounterId: raids.first.wcl_encounter_id,
                mythicDate: '2020-02-02',
                mythicPulls: 12,
                mythicBestPct: null
              },
              {
                name: 'Second Boss',
                wclEncounterId: raids.second.wcl_encounter_id,
                mythicDate: null,
                mythicPulls: 40,
                mythicBestPct: 12.5
              }
            ]
          }
        ],
        roster: [{ nameRealm: 'Test-Realm', role: 'Melee' }]
      });
      // The raid list is the next tier's business and is left alone.
      expect(config.raidProgression).toEqual([{ name: 'Next Tier Raid' }]);
      expect(config).not.toHaveProperty('seasonName');

      const after = await q(
        `select m_plus_excluded, m_plus_note, is_bench, is_trial, bis_link from public.players where id = $1`,
        [player]
      );
      expect(after.rows[0]).toEqual({
        m_plus_excluded: false,
        m_plus_note: null,
        is_bench: false,
        is_trial: true,
        bis_link: null
      });

      const audit = await q(
        `select action, target_type, detail from public.audit_log where team_id = $1 and action = 'Season Closed'`,
        [team.teamId]
      );
      expect(audit.rows).toEqual([{ action: 'Season Closed', target_type: 'team_settings', detail: { season } }]);
    });
  });

  it('a tier the team has no progress rows for closes with no raids', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const season = tier();
      await seedSeason(q, season);
      const res = await asUser(team.leader.uid, ...close(team.teamId, season));
      expect(res.rows[0].config.seasonHistory[0]).toMatchObject({ code: season, raids: [] });
    });
  });

  it('refuses a tier the team has already closed', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const season = tier();
      await seedSeason(q, season);
      await asUser(team.leader.uid, ...close(team.teamId, season));
      await expect(asUser(team.leader.uid, ...close(team.teamId, season))).rejects.toThrow(/already closed/i);
    });
  });

  it('refuses the current tier, which has not ended', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const current = (await q('select public.current_season() as code')).rows[0].code;
      await expect(asUser(team.leader.uid, ...close(team.teamId, current))).rejects.toThrow(/has not ended/i);
    });
  });

  it('refuses a tier the seasons table does not hold', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await expect(asUser(team.leader.uid, ...close(team.teamId, 'MID9'))).rejects.toThrow(
        /not a season this site knows/i
      );
    });
  });

  it('the team officer cannot close (RLS blocks the underlying update)', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const season = tier();
      await seedSeason(q, season);
      await expect(asUser(team.officer.uid, ...close(team.teamId, season))).rejects.toThrow(/not authorized/i);
    });
  });

  it('does not touch m+ exclusion, bench, or bis_link for a different team', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const outsider = await seedPlayer(q, { teamId: 2 });
      await q(
        `update public.players set m_plus_excluded = true, is_bench = true, bis_link = 'https://example.com/team2-sim' where id = $1`,
        [outsider]
      );
      const season = tier();
      await seedSeason(q, season);
      await asUser(team.leader.uid, ...close(team.teamId, season));

      const after = await q(`select m_plus_excluded, is_bench, bis_link from public.players where id = $1`, [outsider]);
      expect(after.rows[0]).toEqual({
        m_plus_excluded: true,
        is_bench: true,
        bis_link: 'https://example.com/team2-sim'
      });
    });
  });
});
