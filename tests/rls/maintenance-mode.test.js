// admin_set_maintenance_mode (#245). SECURITY DEFINER, gated on
// is_site_admin() in the function body (not RLS -- site_settings has no
// write policy at all, same shape as claim_character()/admin_create_team()).
//
// Verifying the write needs the same transaction/connection as the call
// itself (rolled back at the end) -- a separate queryAs() would open a new
// connection that can't see the not-yet-committed change.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, queryAs, withRole, SITE_ADMIN, TEAM_LEADER_T1, OFFICER_T1, RAIDER_T1 } from './helpers.js';

describe('admin_set_maintenance_mode', () => {
  const enableSql = `select public.admin_set_maintenance_mode(true, 'Testing') as result`;

  it('site admin can enable maintenance mode', async () => {
    await withRole('authenticated', SITE_ADMIN, async (q) => {
      await q(enableSql);
      const res = await q('select maintenance_mode, maintenance_message from public.site_settings where id = 1');
      expect(res.rows[0].maintenance_mode).toBe(true);
      expect(res.rows[0].maintenance_message).toBe('Testing');
    });
  });

  it('team leader gets a Not authorized error', async () => {
    await expect(queryAs('authenticated', TEAM_LEADER_T1, enableSql)).rejects.toThrow(/not authorized/i);
  });

  it('officer gets a Not authorized error', async () => {
    await expect(queryAs('authenticated', OFFICER_T1, enableSql)).rejects.toThrow(/not authorized/i);
  });

  it('raider gets a Not authorized error', async () => {
    await expect(queryAs('authenticated', RAIDER_T1, enableSql)).rejects.toThrow(/not authorized/i);
  });

  it('anon cannot execute the function at all', async () => {
    await expect(queryAs('anon', null, enableSql)).rejects.toThrow(/permission denied/i);
  });
});

afterAll(() => pool.end());
