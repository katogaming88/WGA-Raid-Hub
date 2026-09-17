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

// Where "/" lands: the default guild's home, until a site front page that
// belongs to no guild exists (#1226).
export function defaultGuildPath(): string {
  return /^\/g\/[^/]+/.exec(defaultPath())?.[0] ?? '/';
}
