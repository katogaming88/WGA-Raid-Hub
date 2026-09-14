import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// One schema type for both sites. It lives with the current site until the
// cutover (#1105), so the app reads it from there rather than keeping a copy
// that could drift.
import type { Database } from '../../../js/database.types';

export type { Database };
export type Client = SupabaseClient<Database>;

// Which Supabase this build talks to is decided at build time, per
// environment (#1057): .env.development points at the local stack,
// .env.production at the hosted project. Nothing at runtime (hostname, query
// string, stored flag) can point a deployed build somewhere else, which was
// the concern behind #1052's hostname rule on the current site.
export function readSupabaseConfig(env: Record<string, unknown> = import.meta.env): { url: string; key: string } {
  const url = env['VITE_SUPABASE_URL'];
  const key = env['VITE_SUPABASE_ANON_KEY'];
  if (typeof url !== 'string' || !/^https?:\/\//.test(url) || typeof key !== 'string' || key === '') {
    throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set for this build (see app/.env.example).');
  }
  return { url, key };
}

export function createSupabaseClient(): Client {
  const { url, key } = readSupabaseConfig();
  return createClient<Database>(url, key);
}
