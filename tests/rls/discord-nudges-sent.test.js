// discord_nudges_sent (#998): /nudge-missing's cooldown, written only by the
// discord-interactions Edge Function with the service role. No raider,
// officer or admin can read or write it, and one row per Discord id and
// category is what makes the 24-hour window hold across every team.
//
// Everything runs inside the shared withTxn and is rolled back (#1021).
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, RAIDER_T1, OFFICER_T1, SITE_ADMIN, GUILD_OFFICER } from './helpers.js';

afterAll(() => pool.end());

const insert = "insert into public.discord_nudges_sent (discord_id, category) values ('100000000000000009', $1)";

describe('discord_nudges_sent', () => {
  for (const [who, role, uid] of [
    ['a raider', 'authenticated', RAIDER_T1],
    ['an officer', 'authenticated', OFFICER_T1],
    ['a site admin', 'authenticated', SITE_ADMIN],
    ['a guild officer', 'authenticated', GUILD_OFFICER],
    ['an anonymous caller', 'anon', null]
  ]) {
    it(`${who} can't read it`, async () => {
      await withTxn(async ({ asRole }) => {
        await expect(asRole(role, uid)('select * from public.discord_nudges_sent')).rejects.toThrow(
          /permission denied/
        );
      });
    });

    it(`${who} can't write it`, async () => {
      await withTxn(async ({ asRole }) => {
        await expect(asRole(role, uid)(insert, ['no-wishlist'])).rejects.toThrow(/permission denied/);
      });
    });
  }

  it('the service role reads and writes it', async () => {
    await withTxn(async ({ asRole }) => {
      const service = asRole('service_role', null);
      await service(insert, ['no-wishlist']);
      expect((await service('select category from public.discord_nudges_sent')).rows).toEqual([
        { category: 'no-wishlist' }
      ]);
    });
  });

  it('keeps one row per Discord id and category, so a second team cannot add another', async () => {
    await withTxn(async ({ q }) => {
      await q(insert, ['no-wishlist']);
      await expect(q(insert, ['no-wishlist'])).rejects.toThrow(/duplicate key/);
    });
  });

  it('holds one row per category for the same user', async () => {
    await withTxn(async ({ q }) => {
      await q(insert, ['no-wishlist']);
      await q(insert, ['no-bis-link']);
      expect((await q('select count(*)::int as n from public.discord_nudges_sent')).rows[0].n).toBe(2);
    });
  });

  it('refuses a category the command does not have', async () => {
    await withTxn(async ({ q }) => {
      await expect(q(insert, ['something-else'])).rejects.toThrow(/check constraint/);
    });
  });
});
