// set_team_setting/archive_current_season/unarchive_season (#221, Phase 6) --
// season config moved off Script Properties onto team_settings.config. All
// three are SECURITY INVOKER, so the "Team leaders write settings" RLS
// policy is the only gate: an officer (not team_leader) can call the
// function, but the underlying UPDATE touches 0 rows, same shape as the
// existing direct-update assertions in write-policies.test.js.
//
// Every scenario runs on a team the test mints (#1123): archive_current_season
// wipes bis_items and rewrites players for the whole team, so a run on the
// seeded team 1 held rows every other file writes. seedTeam gives the team,
// its settings row and a leader, an officer and a raider of its own; the
// seeded personas appear only as outsiders.
import { describe, it, expect } from 'vitest';
import { withTxn, seedTeam, seedPlayer, SITE_ADMIN, OFFICER_T2 } from './helpers.js';

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

describe('archive_current_season', () => {
  const archive = (teamId) => [
    `select public.archive_current_season($1, '[{"nameRealm":"Test-Realm","role":"Melee"}]'::jsonb) as config`,
    [teamId]
  ];

  it('moves the active season into seasonHistory and clears the active fields', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const leader = (text, params) => asUser(team.leader.uid, text, params);
      await leader(
        ...setting(
          team.teamId,
          '{"seasonName":"Archive Me","seasonStart":"2026-01-01","raidProgression":[{"name":"Test Raid"}]}'
        )
      );
      const res = await leader(...archive(team.teamId));
      const config = res.rows[0].config;
      expect(config.seasonName).toBe('');
      expect(config.raidProgression).toEqual([]);
      expect(config.seasonHistory).toHaveLength(1);
      expect(config.seasonHistory[0]).toMatchObject({
        name: 'Archive Me',
        start: '2026-01-01',
        raids: [{ name: 'Test Raid' }],
        roster: [{ nameRealm: 'Test-Realm', role: 'Melee' }]
      });
    });
  });

  it('raises when there is no active season name to archive', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await asUser(team.leader.uid, ...setting(team.teamId, '{"seasonName":""}'));
      await expect(asUser(team.leader.uid, ...archive(team.teamId))).rejects.toThrow(/no active season/i);
    });
  });

  it('the team officer cannot archive (RLS blocks the underlying update)', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await asUser(team.leader.uid, ...setting(team.teamId, '{"seasonName":"Archive Me"}'));
      await expect(asUser(team.officer.uid, ...archive(team.teamId))).rejects.toThrow(/not authorized/i);
    });
  });

  // #498: a new tier is almost always a different loot table, so bis_items
  // rows are dead weight once archived -- snapshot everything (placeholders
  // included) into history, then wipe the whole table for the active roster.
  // Placeholders (M+/Crafted/Catalyst "Other Sources" tags) are wiped too,
  // not just real items (20260806210047) -- every BiS list/wishlist is
  // per-season, and what a raider wants from M+ or has crafted can change
  // slot/target entirely next tier, so there's no reason to carry those
  // forward either. M+ exclusion means "doesn't need gear right now," which
  // a new tier invalidates, so it resets for the whole active roster too.
  // Bench resets the same way; trial status is deliberately left alone
  // (still a Trial Promotions call). A submitted BiS link is cleared
  // unconditionally too (20260731135713) -- it's effectively per-tier
  // regardless of which site it points to.
  it('snapshots bis_items (placeholders included) into history, wipes all of it plus BiS link, and resets m+ exclusion and bench', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const player = await seedPlayer(q, { teamId: team.teamId, nameRealm: 'Archivetest-Illidan' });
      // items has no authenticated write policy (read-only shared catalog) --
      // seed as the unrestricted connection before dropping to a PostgREST role.
      const placeholder = (
        await q(
          `insert into public.items (wow_item_id, name, slot, armor_type, is_placeholder) values
             (null, 'M+', 'Placeholder', null, true) returning id`
        )
      ).rows[0].id;
      // The seed's real item (1, 'Seed Test Staff') and the placeholder.
      await q(
        `insert into public.bis_items (player_id, item_id, obtained, slot) values
           ($1, 1, false, 'weapon'), ($1, $2, true, 'ring1')`,
        [player, placeholder]
      );
      await q(
        `update public.players set m_plus_excluded = true, m_plus_note = 'needs a break', is_bench = true, is_trial = true, bis_link = 'https://example.com/old-sim' where id = $1`,
        [player]
      );

      await asUser(team.leader.uid, ...setting(team.teamId, '{"seasonName":"Archive Me 2"}'));
      const res = await asUser(team.leader.uid, ...archive(team.teamId));
      const config = res.rows[0].config;
      const entry = config.seasonHistory[config.seasonHistory.length - 1];

      expect(entry.bis).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            nameRealm: 'Archivetest-Illidan',
            item: 'Seed Test Staff',
            obtained: false,
            isPlaceholder: false
          }),
          expect.objectContaining({
            nameRealm: 'Archivetest-Illidan',
            item: 'M+',
            obtained: true,
            isPlaceholder: true
          })
        ])
      );

      // Both the real item and the placeholder are gone.
      const remaining = await q(`select item_id from public.bis_items where player_id = $1 order by item_id`, [player]);
      expect(remaining.rows.map((r) => r.item_id)).toEqual([]);

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
    });
  });

  it('does not touch bis_items, m+ exclusion, bench, or bis_link for a different team', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const outsider = await seedPlayer(q, { teamId: 2 });
      const item = (
        await q(
          `insert into public.items (wow_item_id, name, slot, armor_type, is_placeholder) values
             (null, 'Other Team Item', 'Head', null, false) returning id`
        )
      ).rows[0].id;
      await q(`insert into public.bis_items (player_id, item_id, obtained) values ($1, $2, false)`, [outsider, item]);
      await q(
        `update public.players set m_plus_excluded = true, is_bench = true, bis_link = 'https://example.com/team2-sim' where id = $1`,
        [outsider]
      );

      await asUser(team.leader.uid, ...setting(team.teamId, '{"seasonName":"Archive Me 3"}'));
      await asUser(team.leader.uid, ...archive(team.teamId));

      const remaining = await q(`select item_id from public.bis_items where player_id = $1`, [outsider]);
      expect(remaining.rows.map((r) => r.item_id)).toEqual([item]);

      const after = await q(`select m_plus_excluded, is_bench, bis_link from public.players where id = $1`, [outsider]);
      expect(after.rows[0]).toEqual({
        m_plus_excluded: true,
        is_bench: true,
        bis_link: 'https://example.com/team2-sim'
      });
    });
  });
});

describe('unarchive_season', () => {
  const history =
    '{"seasonName":"","seasonHistory":[{"name":"Old Season","start":"2025-01-01","end":"2025-06-01","raids":[],"roster":[]}]}';

  it('restores the season at the given index and removes it from history', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await asUser(team.leader.uid, ...setting(team.teamId, history));
      const res = await asUser(team.leader.uid, 'select public.unarchive_season($1, 0) as result', [team.teamId]);
      const result = res.rows[0].result;
      expect(result.season.name).toBe('Old Season');
      expect(result.config.seasonName).toBe('Old Season');
      expect(result.config.seasonHistory).toEqual([]);
    });
  });

  it('raises on an out-of-range index', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await asUser(team.leader.uid, ...setting(team.teamId, history));
      await expect(
        asUser(team.leader.uid, 'select public.unarchive_season($1, 5) as result', [team.teamId])
      ).rejects.toThrow(/invalid season index/i);
    });
  });

  it('the team officer cannot unarchive (RLS blocks the underlying update)', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await asUser(team.leader.uid, ...setting(team.teamId, history));
      await expect(
        asUser(team.officer.uid, 'select public.unarchive_season($1, 0) as result', [team.teamId])
      ).rejects.toThrow(/not authorized/i);
    });
  });
});
