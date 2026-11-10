// #1542: discord_find_ticket, Find my ticket's channel and message per
// Discord server. Only the Edge Functions' service role reads or writes it;
// an officer, a site admin and anyone signed out are all refused outright.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, OFFICER_T1, SITE_ADMIN, RLS_DENIED } from './helpers.js';

afterAll(() => pool.end());

const SERVER = '100000000000000001';
const CHANNEL = '300000000000000003';

describe('discord_find_ticket (#1542)', () => {
  it('nobody on the site reads or writes it directly', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      await q('insert into public.discord_find_ticket (server_id, channel_id, guild_id) values ($1, $2, 1)', [SERVER, CHANNEL]);
      for (const uid of [OFFICER_T1, SITE_ADMIN]) {
        await expect(asUser(uid, 'select * from public.discord_find_ticket')).rejects.toMatchObject({
          code: RLS_DENIED
        });
        await expect(
          asUser(uid, "update public.discord_find_ticket set channel_id = '300000000000000004'")
        ).rejects.toMatchObject({ code: RLS_DENIED });
      }
      await expect(asAnon('select * from public.discord_find_ticket')).rejects.toMatchObject({ code: RLS_DENIED });
    });
  });

  it('holds only Discord ids', async () => {
    await withTxn(async ({ q }) => {
      await expect(
        q("insert into public.discord_find_ticket (server_id, channel_id, guild_id) values ($1, 'general', 1)", [SERVER])
      ).rejects.toThrow(/discord_find_ticket_channel_id/);
    });
  });
});
