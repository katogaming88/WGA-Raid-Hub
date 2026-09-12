// The corpus every Edge Function test draws from (#1006). One role, one
// value: distinct roles get distinct names and distinct values, so a test
// reads as a sentence and a copy-paste between roles fails rather than
// passing by coincidence. Nothing here is a real Discord id or a real key.
import type { Env, SaleRow } from '../../../supabase/functions/boe-sold-webhook/handler.ts';

// Discord snowflakes. Eighteen digits like the real thing, leading with the
// role's own digit so a wrong one is visible in a failure message.
export const FINDER_ID = '100000000000000001';
export const MANAGER_ID = '200000000000000002';
export const SECOND_MANAGER_ID = '200000000000000003';

// auth.users ids and the Authorization headers a caller would send.
export const MANAGER_USER_ID = 'b0e00000-0000-4000-8000-000000000001';
export const MANAGER_AUTH = 'Bearer manager-session';

// Webhook URLs, one per env name the sold poster reads.
export const SOLD_WEBHOOK_URL = 'https://discord.test/api/webhooks/sold';
export const FOUND_WEBHOOK_URL = 'https://discord.test/api/webhooks/found';
export const LEGACY_WEBHOOK_URL = 'https://discord.test/api/webhooks/legacy';

// The sale from boe-sold-webhook's own header comment: the numbers add up
// (fee off the top, guild cut net of it) and the finder is resolved.
export const SOLD_ROW: SaleRow = {
  id: 41,
  team_id: 1,
  finder_name: 'Aeryn',
  item_name: 'Voidglass Cloak',
  track: 'Hero',
  upgrade_rank: '2/6',
  status: 'sold',
  sale_price: 52800,
  ah_fee: 2640,
  guild_cut: 30160,
  finder_payout: 20000,
  payout_donated: false
};

// An Env over a plain record, the shape Deno.env has in production.
export function envOf(values: Record<string, string>): Env {
  return { get: (name) => values[name] };
}
