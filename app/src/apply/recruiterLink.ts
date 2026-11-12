import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { useSupabase } from '../data/DataProvider';

// A recruiter's link (#1537) ends in ?from=<code>. The code is kept in this
// browser for 30 days, so it survives the Battle.net sign-in round trip and a
// visit days later, and the most recent click wins (#1546). The application
// form reads it back to fill in "Who sent you?". Per browser, per guild:
// losing it only means nobody is credited.
const DAYS = 30;
const keyFor = (guild: string) => `wga_recruiter:${guild}`;

export function rememberRecruiter(guild: string, code: string, now = Date.now()) {
  try {
    localStorage.setItem(keyFor(guild), JSON.stringify({ code, at: now }));
  } catch {
    // Storage blocked: the form just asks who sent them.
  }
}

// The code from the latest click, or null when none or older than 30 days.
export function savedRecruiter(guild: string, now = Date.now()): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(keyFor(guild)) ?? 'null') as { code?: unknown; at?: unknown } | null;
    if (typeof saved?.code !== 'string' || typeof saved.at !== 'number') return null;
    return now - saved.at <= DAYS * 86_400_000 ? saved.code : null;
  } catch {
    return null;
  }
}

// On either apply page: checks the code in the address and keeps it. An
// unknown or switched-off code is ignored without a word, and leaves an
// earlier good one in place.
export function useCaptureRecruiter(guildKey: string) {
  const client = useSupabase();
  const code = useSearchParams()[0].get('from')?.trim().toLowerCase();
  useEffect(() => {
    if (!code) return;
    let current = true;
    void Promise.resolve(client.rpc('recruiter_for_code', { p_guild_key: guildKey, p_code: code })).then(
      ({ data, error }) => {
        const who = data as { active?: boolean } | null;
        if (current && !error && who?.active) rememberRecruiter(guildKey, code);
      },
      () => undefined
    );
    return () => {
      current = false;
    };
  }, [client, guildKey, code]);
}
