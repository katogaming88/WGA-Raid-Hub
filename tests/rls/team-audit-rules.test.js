// set_team_audit_rules() (#1638): how strict the roster audit's enchant and
// gem check is, and an optional weekly vault minimum, saved on
// team_settings.config. Whoever has promote_assistants on the team (its
// officers and owner) or a site admin. Every call runs in a rolled-back
// transaction.
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  queryAs,
  withTxn,
  OFFICER_T1,
  TEAM_LEADER_T1,
  RAIDER_T1,
  SITE_ADMIN,
  OFFICER_T2,
  GUILD_OFFICER
} from './helpers.js';

afterAll(() => pool.end());

const save = (check, rule) => [
  `select public.set_team_audit_rules(1, $1, $2::jsonb) as config`,
  [check, rule === undefined ? null : JSON.stringify(rule)]
];

describe('set_team_audit_rules: who can save', () => {
  it('a team 1 officer, its leader and a site admin can', async () => {
    for (const uid of [OFFICER_T1, TEAM_LEADER_T1, SITE_ADMIN]) {
      const res = await queryAs('authenticated', uid, ...save('strict', { dungeon: 1 }));
      expect(res.rows[0].config).toMatchObject({
        enchantCheck: 'strict',
        vaultRule: { raid: 0, dungeon: 1, world: 0 }
      });
    }
  });
  it('a team 2 officer, a guild officer and a raider cannot', async () => {
    for (const uid of [OFFICER_T2, GUILD_OFFICER, RAIDER_T1]) {
      await expect(queryAs('authenticated', uid, ...save('casual'))).rejects.toThrow(/Not authorized/);
    }
  });
  it('anon cannot call it at all', async () => {
    await expect(queryAs('anon', null, ...save('casual'))).rejects.toThrow(/permission denied/);
  });
  it('the team reads it back: team_settings is public to read', async () => {
    await withTxn(async ({ asRole }) => {
      await asRole('authenticated', OFFICER_T1)(...save('casual', { raid: 2 }));
      const res = await asRole(
        'authenticated',
        RAIDER_T1
      )(`select config -> 'enchantCheck' as c, config -> 'vaultRule' as v from team_settings where team_id = 1`);
      expect(res.rows[0]).toEqual({ c: 'casual', v: { raid: 2, dungeon: 0, world: 0 } });
    });
  });
});

describe('set_team_audit_rules: what it accepts', () => {
  it('keeps the rest of the team settings and writes an audit entry', async () => {
    await withTxn(async ({ q, asRole }) => {
      const leader = asRole('authenticated', TEAM_LEADER_T1);
      await leader(`select public.set_team_setting(1, '{"trialWeeks": 6}'::jsonb)`);
      const res = await leader(...save('lenient'));
      expect(res.rows[0].config).toMatchObject({ trialWeeks: 6, enchantCheck: 'lenient', vaultRule: null });
      const log = await q(`select detail from audit_log where team_id = 1 and action = 'Audit Rules Saved'`);
      expect(log.rows).toEqual([{ detail: { enchantCheck: 'lenient', vaultRule: null } }]);
    });
  });
  it('no vault rule, or every row at 0, is stored as no rule', async () => {
    for (const rule of [undefined, null, { raid: 0, dungeon: 0, world: 0 }, {}]) {
      const res = await queryAs('authenticated', OFFICER_T1, ...save('lenient', rule));
      expect(res.rows[0].config.vaultRule).toBeNull();
    }
  });
  it('drops keys it does not know', async () => {
    const res = await queryAs('authenticated', OFFICER_T1, ...save('lenient', { world: 3, pvp: 2 }));
    expect(res.rows[0].config.vaultRule).toEqual({ raid: 0, dungeon: 0, world: 3 });
  });
  it('refuses a check it does not know', async () => {
    for (const check of ['loose', null]) {
      await expect(queryAs('authenticated', OFFICER_T1, ...save(check))).rejects.toThrow(/strict, lenient or casual/);
    }
  });
  it('refuses slots outside 0 to 3, or not whole numbers', async () => {
    for (const rule of [{ raid: 4 }, { dungeon: -1 }, { world: 1.5 }, { raid: '1' }]) {
      await expect(queryAs('authenticated', OFFICER_T1, ...save('lenient', rule))).rejects.toThrow(/0 to 3/);
    }
  });
  it('refuses a vault rule that is not an object', async () => {
    await expect(queryAs('authenticated', OFFICER_T1, ...save('lenient', [1, 0, 0]))).rejects.toThrow(
      /raid, dungeon and world/
    );
  });
});
