// Behavior tests for app_version() (#969), the schema's own version as a fact
// a client may read. The schema's version is its migration ledger head, and
// nothing exposed it, so a page could not ask what schema it was talking to.
// #970 is what consumes this.
//
// The interesting property is the one the function does NOT give away. The
// ledger lives in supabase_migrations, owned by postgres with no grants to any
// API role, and it stays that way: the function is SECURITY DEFINER and so
// reads it as its owner, while a direct select as the same caller is still
// refused. Both halves are asserted below, because the first without the
// second would describe a function that had simply opened the table up.
//
// Uses the shared withTxn from helpers.js: one rolled-back transaction, the
// ledger read as postgres for the expected value, the RPC called as the
// impersonated role on that same connection.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, RAIDER_T1, RLS_DENIED } from './helpers.js';
import { readNewestMigration } from '../../scripts/ci/stamp-version.js';

const LEDGER = 'select max(version) as head, count(*)::int as count from supabase_migrations.schema_migrations';
const CALL = 'select public.app_version() as v';

afterAll(() => pool.end());

describe('app_version (#969)', () => {
  it('control: the ledger this reports on is readable as postgres and is not empty', async () => {
    await withTxn(async ({ q }) => {
      const { rows } = await q(LEDGER);
      expect(rows[0].head).toMatch(/^\d{14}$/);
      // The denominator. A ledger of one row would satisfy every equality
      // below while proving nothing about which fact was returned.
      expect(rows[0].count).toBeGreaterThan(150);
    });
  });

  it('anon gets the ledger head and the version count', async () => {
    await withTxn(async ({ q, asAnon }) => {
      const expected = (await q(LEDGER)).rows[0];
      const { rows } = await asAnon(CALL);
      expect(rows[0].v).toEqual({ head: expected.head, count: expected.count });
    });
  });

  it('authenticated gets the same answer', async () => {
    await withTxn(async ({ q, asUser }) => {
      const expected = (await q(LEDGER)).rows[0];
      const { rows } = await asUser(RAIDER_T1, CALL);
      expect(rows[0].v).toEqual({ head: expected.head, count: expected.count });
    });
  });

  it('exposes one derived fact, not the table: a direct select is still refused', async () => {
    await withTxn(async ({ asAnon, asUser }) => {
      const direct = 'select version from supabase_migrations.schema_migrations limit 1';
      await expect(asAnon(direct)).rejects.toMatchObject({ code: RLS_DENIED });
      await expect(asUser(RAIDER_T1, direct)).rejects.toMatchObject({ code: RLS_DENIED });
    });
  });

  it('reports the newest migration in the tree, which is what REQUIRED_SCHEMA is stamped from', async () => {
    const newest = readNewestMigration();
    await withTxn(async ({ asAnon }) => {
      const { rows } = await asAnon(CALL);
      // Same source the version stamp writes into js/common.js, so #970 can
      // compare the two. A mismatch here is usually a stale local stack:
      // run `supabase db reset` and try again.
      expect(rows[0].v.head).toBe(newest);
    });
  });
});
