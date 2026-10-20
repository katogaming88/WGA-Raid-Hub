// set_loot_responses() (#1561): the officer-run list of RCLootCouncil buttons
// and what each counts as, saved on team_settings.config -> 'lootResponses'.
// Officers of the team, its leader and site admins; not guild officers, who
// are kept out of loot import too. Every call runs in a rolled-back
// transaction.
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  queryAs,
  withRole,
  OFFICER_T1,
  TEAM_LEADER_T1,
  RAIDER_T1,
  SITE_ADMIN,
  OFFICER_T2,
  GUILD_OFFICER
} from './helpers.js';

afterAll(() => pool.end());

const LIST = {
  buttons: [
    { text: 'Upgrade', countsAs: 'main' },
    { text: 'OS/M+', countsAs: 'off' },
    { text: 'Xmog', countsAs: 'hidden' }
  ],
  groups: [
    {
      name: 'Armor Token',
      buttons: [
        { text: '2/4 Set', countsAs: 'main' },
        { text: 'OS', countsAs: 'off' }
      ]
    }
  ]
};
const save = (list) => [`select public.set_loot_responses(1, $1::jsonb) as config`, [JSON.stringify(list)]];

describe('set_loot_responses: who can save', () => {
  it('a plain team 1 officer saves the list', async () => {
    const res = await queryAs('authenticated', OFFICER_T1, ...save(LIST));
    expect(res.rows[0].config.lootResponses).toEqual(LIST);
  });
  it('the team leader and a site admin can save it', async () => {
    for (const uid of [TEAM_LEADER_T1, SITE_ADMIN]) {
      const res = await queryAs('authenticated', uid, ...save(LIST));
      expect(res.rows[0].config.lootResponses).toEqual(LIST);
    }
  });
  it('a guild officer, a team 2 officer and a raider cannot', async () => {
    for (const uid of [GUILD_OFFICER, OFFICER_T2, RAIDER_T1]) {
      await expect(queryAs('authenticated', uid, ...save(LIST))).rejects.toThrow(/Not authorized/);
    }
  });
  it('anon cannot call it at all', async () => {
    await expect(queryAs('anon', null, ...save(LIST))).rejects.toThrow(/permission denied/);
  });
});

describe('set_loot_responses: what it accepts', () => {
  it('keeps the rest of the team settings', async () => {
    await withRole('authenticated', TEAM_LEADER_T1, async (q) => {
      await q(`select public.set_team_setting(1, '{"trialWeeks": 6}'::jsonb)`);
      const res = await q(...save(LIST));
      expect(res.rows[0].config).toMatchObject({ trialWeeks: 6, lootResponses: LIST });
    });
  });
  it('refuses a list without buttons and groups', async () => {
    await expect(queryAs('authenticated', OFFICER_T1, ...save({ buttons: [] }))).rejects.toThrow(/buttons and groups/);
  });
  it('refuses a button with no text', async () => {
    const list = { buttons: [{ text: '  ', countsAs: 'main' }], groups: [] };
    await expect(queryAs('authenticated', OFFICER_T1, ...save(list))).rejects.toThrow(/its text/);
  });
  it('refuses a counts-as it does not know, in a group too', async () => {
    const list = { buttons: [], groups: [{ name: 'Weapon', buttons: [{ text: 'Need', countsAs: 'maybe' }] }] };
    await expect(queryAs('authenticated', OFFICER_T1, ...save(list))).rejects.toThrow(/"Need" needs what it counts as/);
  });
  it('refuses a group with no name', async () => {
    const list = { buttons: [], groups: [{ name: '', buttons: [] }] };
    await expect(queryAs('authenticated', OFFICER_T1, ...save(list))).rejects.toThrow(/needs a name/);
  });
});
