// Build-time settings, one set per environment (#1057). Vite inlines
// import.meta.env.VITE_* values when it builds.
const FALLBACK_PATH = '/g/wga/t/phoenix';

// Where "/" lands until sign-in can pick the person's own team.
export function defaultPath(): string {
  const path: unknown = import.meta.env.VITE_DEFAULT_PATH;
  return typeof path === 'string' && path.startsWith('/') ? path : FALLBACK_PATH;
}

export function defaultTeamKey(): string {
  return /\/t\/([^/]+)/.exec(defaultPath())?.[1] ?? '';
}
