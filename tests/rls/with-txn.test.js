// Behavior tests for withTxn's impersonated calls (#1131). withTxn hands a test
// one rolled-back transaction with a postgres-role `q` and asRole/asUser/asAnon
// on the same connection (#1021). The property under test is what an
// impersonated call leaves behind when it returns: nothing. The role, the
// caller's claims and the savepoint the call rode on are all gone, so a `q`
// after it runs as postgres with no caller, on both the success path and the
// error path.
//
// The savepoint checks release one by name: with nothing left behind, Postgres
// refuses with 3B001 (no such savepoint). The controls pin that the reset does
// not reach into the call itself or break the next impersonation.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, RAIDER_T1, OFFICER_T2 } from './helpers.js';

const WHO = 'select auth.uid()::text as uid, current_user as who';
const RELEASE = 'release savepoint impersonated_call';

afterAll(() => pool.end());

describe('withTxn impersonated calls leave nothing behind (#1131)', () => {
  it('control: inside the call, auth.uid() is the caller', async () => {
    await withTxn(async ({ asUser }) => {
      const { rows } = await asUser(RAIDER_T1, WHO);
      expect(rows[0]).toEqual({ uid: RAIDER_T1, who: 'authenticated' });
    });
  });

  it('after a call returns, q runs as postgres with no caller', async () => {
    await withTxn(async ({ q, asUser }) => {
      await asUser(RAIDER_T1, 'select 1');
      const { rows } = await q(WHO);
      expect(rows[0]).toEqual({ uid: null, who: 'postgres' });
    });
  });

  it('after a call returns, its savepoint is gone', async () => {
    await withTxn(async ({ q, asUser }) => {
      await asUser(RAIDER_T1, 'select 1');
      await expect(q(RELEASE)).rejects.toMatchObject({ code: '3B001' });
    });
  });

  it('after a call raises, q runs as postgres with no caller and the savepoint is gone', async () => {
    await withTxn(async ({ q, asUser }) => {
      await expect(asUser(RAIDER_T1, 'select 1/0')).rejects.toMatchObject({ code: '22012' });
      const { rows } = await q(WHO);
      expect(rows[0]).toEqual({ uid: null, who: 'postgres' });
      await expect(q(RELEASE)).rejects.toMatchObject({ code: '3B001' });
    });
  });

  it('control: the next call sees its own caller, not the previous one', async () => {
    await withTxn(async ({ asUser }) => {
      await asUser(RAIDER_T1, 'select 1');
      const { rows } = await asUser(OFFICER_T2, WHO);
      expect(rows[0]).toEqual({ uid: OFFICER_T2, who: 'authenticated' });
    });
  });
});
