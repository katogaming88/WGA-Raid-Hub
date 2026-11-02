import { defaultGuildPath } from '../config';

// The site pages (News, About, Help, Site admin, #1482) have no guild in their
// address, so the frame around them shows the guild this browser was last on,
// or the default guild before any. A per-browser convenience: losing it only
// means the default guild's frame.
const KEY = 'wga_last_guild';

export function defaultGuildKey(): string {
  return defaultGuildPath().split('/')[2] ?? '';
}

export function lastGuildKey(): string {
  try {
    return localStorage.getItem(KEY) || defaultGuildKey();
  } catch {
    return defaultGuildKey();
  }
}

export function rememberGuild(key: string) {
  try {
    localStorage.setItem(KEY, key);
  } catch {
    // Storage blocked: the site pages fall back to the default guild.
  }
}

export function forgetGuild() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored to forget.
  }
}

// The sidebar's team links on a guild or site page go to the team this browser
// was last on in that guild (#1725). Per guild; losing it only means the
// first team the person is on.
const teamKeyFor = (guild: string) => `wga_last_team:${guild}`;

export function lastTeamKey(guild: string): string | null {
  try {
    return localStorage.getItem(teamKeyFor(guild));
  } catch {
    return null;
  }
}

export function rememberTeam(guild: string, team: string) {
  try {
    localStorage.setItem(teamKeyFor(guild), team);
  } catch {
    // Storage blocked: the team links fall back to the first team.
  }
}
