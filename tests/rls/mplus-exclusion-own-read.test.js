// A raider reads their own M+ exclusion requests, and nobody else's (#868).
// Kat decided on 2026-09-14 that a raider sees their own rejected request and
// the officer's note on their profile.
//
// Seed: mplus_exclusion_requests id 1 belongs to player 1 on team 1, which has
// no team_member_id. Linking it to team_members id 3 (RAIDER_T1's row) inside
// a transaction makes it that raider's own character, and rolls back after.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, RAIDER_T1 } from './helpers.js';

async function countAsRaider(link) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (link) await client.query('update public.players set team_member_id = 3 where id = 1');
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: RAIDER_T1, role: 'authenticated' })
    ]);
    await client.query('set local role authenticated');
    const res = await client.query('select count(*)::int as n from public.mplus_exclusion_requests');
    return res.rows[0].n;
  } finally {
    await client.query('rollback');
    client.release();
  }
}

describe('mplus_exclusion_requests: raiders read their own', () => {
  it('shows a raider the request for their own character', async () => {
    expect(await countAsRaider(true)).toBe(1);
  });

  it('hides a request for a character that is not theirs', async () => {
    expect(await countAsRaider(false)).toBe(0);
  });
});

afterAll(() => pool.end());
