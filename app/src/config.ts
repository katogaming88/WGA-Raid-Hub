// Build-time settings, one set per environment (#1057). Vite inlines
// import.meta.env.VITE_* values when it builds.
const FALLBACK_PATH = '/g/wga/t/phoenix';

// The default team's address, for team links on a page that has no team.
export function defaultPath(): string {
  const path: unknown = import.meta.env.VITE_DEFAULT_PATH;
  return typeof path === 'string' && path.startsWith('/') ? path : FALLBACK_PATH;
}

export function defaultTeamKey(): string {
  return /\/t\/([^/]+)/.exec(defaultPath())?.[1] ?? '';
}

// The teams the preview shows to anyone but a site admin (#1676), by address
// key, comma-separated. Unset shows every team; at cutover the line in
// .env.production goes.
export function previewTeamKeys(): string[] | null {
  const keys: unknown = import.meta.env.VITE_PREVIEW_TEAMS;
  if (typeof keys !== 'string') return null;
  const list = keys
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  return list.length ? list : null;
}

// The default guild's home.
export function defaultGuildPath(): string {
  return /^\/g\/[^/]+/.exec(defaultPath())?.[0] ?? '/';
}

// The support Discord, where people ask for help instead of messaging Kat or Rex
// (Help, and the link at the bottom of the sidebar).
export const SUPPORT_DISCORD_URL = 'https://discord.gg/ATBC8B4UYz';

// Our RCLootCouncil addon, linked from the front page's "Works with" row.
export const ADDON_URL = 'https://www.curseforge.com/wow/addons/wga-priority-loot';
