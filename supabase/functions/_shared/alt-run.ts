// Which Warcraft Logs reports are a guild's alt runs rather than a team's raid,
// by title (#1469): "Alt" as its own word, since "Altar" in a boss name once
// excluded a real raid night ("Phoenix Heroic 8/27 - The Coiled Altar (...)").
// Case-sensitive, as attendance has always applied it. wcl-progression-sync
// stores it as team_raid_reports.kind; wcl-sync reads that table's
// effective_kind and uses this only for a report the table does not hold yet
// (#1471).
const ALT_RUN_PATTERN = /\bAlt\b/;

export function isAltRun(title: unknown): boolean {
  return ALT_RUN_PATTERN.test(String(title ?? ''));
}
