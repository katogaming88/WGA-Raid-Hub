// What a player profile shows, worked out from its reads (#868 part 1). The
// rules match the current site's renderProfile() and its helpers, so the
// recorded behavior in tests/behavior/profile.js holds on both.

export type SeasonWindow = { name: string; code: string | null; start: string | null; end: string | null };

// Season codes are the stable key (MID2) and teams name seasons for people
// (Midnight Season 2). Same conversion as the current site's
// seasonCodeForDisplay(), and like it, updated at an expansion boundary.
const SEASON_CODE_PREFIX = 'MID';
const SEASON_DISPLAY_PREFIX = 'Midnight Season';

export function seasonCode(displayName: string): string | null {
  const m = new RegExp(`^${SEASON_DISPLAY_PREFIX} (\\d+)$`).exec(displayName.trim());
  return m ? `${SEASON_CODE_PREFIX}${m[1]}` : null;
}

export function seasonName(code: string | null): string {
  const m = new RegExp(`^${SEASON_CODE_PREFIX}(\\d+)$`).exec(code ?? '');
  return m ? `${SEASON_DISPLAY_PREFIX} ${m[1]}` : (code ?? '');
}

// Attendance

export type AttendanceRow = { raid_date: string; status: string | null; report_excluded: boolean };

// How much each status counts toward attendance. Not on Roster, and a night
// with no status yet, do not count at all.
export const ATTENDANCE_WEIGHTS: Record<string, number> = {
  Present: 1,
  Bench: 1,
  'Medical Leave': 1,
  'Extended Leave': 1,
  Excused: 0.8,
  'Late (with notice)': 0.9,
  'Late (no notice)': 0.5,
  'No Show': 0
};

const FLAGGED = new Set(['No Show', 'Excused', 'Late (with notice)', 'Late (no notice)']);

const inWindow = (date: string, start: string | null, end: string | null) =>
  (!start || date >= start) && (!end || date <= end);

export type Attendance = { pct: number; flagged: { date: string; status: string }[] };

export function attendance(rows: AttendanceRow[], season: SeasonWindow, joinDate: string | null): Attendance {
  const nights = rows.filter((r) => !r.report_excluded);
  // The percentage starts at the later of the season start and the join date,
  // so nights before someone joined never count against them.
  const from = joinDate && (!season.start || joinDate > season.start) ? joinDate : season.start;
  const counted = nights.filter(
    (r) => r.status && r.status !== 'Not on Roster' && inWindow(r.raid_date, from, season.end)
  );
  const pct = counted.length
    ? Math.round((counted.reduce((sum, r) => sum + (ATTENDANCE_WEIGHTS[r.status!] ?? 0), 0) / counted.length) * 1000) /
      10
    : 100;
  const flagged = nights
    .filter((r) => r.status && FLAGGED.has(r.status) && inWindow(r.raid_date, season.start, season.end))
    .sort((a, b) => (a.raid_date < b.raid_date ? 1 : a.raid_date > b.raid_date ? -1 : 0))
    .map((r) => ({ date: r.raid_date, status: r.status! }));
  return { pct, flagged };
}

export const formatPct = (pct: number) => `${pct.toFixed(1)}%`;

// Loot

export type LootRow = {
  id: number;
  track: string | null;
  season: string | null;
  awarded_at: string;
  items: { name: string } | null;
  // Where an earlier character received it (#942 step 5b): an old main's name,
  // or the team they left. Null or missing for the character's own loot.
  from?: string | null;
};

export type Difficulty = 'Mythic' | 'Heroic' | 'Normal' | 'Other';
export type Award = {
  key: number;
  name: string;
  difficulty: Difficulty;
  date: string;
  awardedAt: string;
  from: string | null;
};

export const difficultyOf = (track: string | null): Difficulty =>
  track === 'Myth' ? 'Mythic' : track === 'Hero' ? 'Heroic' : track === 'Champion' ? 'Normal' : 'Other';

// Award dates are shown on Eastern time, where the raids happen, so an award
// late on raid night keeps that night's date wherever the reader is.
const AWARD_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'short',
  day: 'numeric',
  year: 'numeric'
});

export type SeasonLoot = { season: string; awards: Award[]; last: { date: string; awards: Award[] } | null };

export function seasonLoot(rows: LootRow[], season: SeasonWindow): SeasonLoot {
  const awards = rows
    .filter((r) => season.code === null || r.season === season.code)
    .map((r) => ({
      key: r.id,
      name: r.items?.name ?? 'Unknown Item',
      difficulty: difficultyOf(r.track),
      date: AWARD_DATE.format(new Date(r.awarded_at)),
      awardedAt: r.awarded_at,
      from: r.from ?? null
    }))
    .sort((a, b) => (a.awardedAt < b.awardedAt ? 1 : a.awardedAt > b.awardedAt ? -1 : b.key - a.key));
  const newest = awards[0];
  return {
    season: season.name,
    awards,
    last: newest ? { date: newest.date, awards: awards.filter((a) => a.date === newest.date) } : null
  };
}

// Equipped gear

export type GearRow = {
  equipment_slot: string;
  item_id: number | null;
  item_level: number | null;
  track: string | null;
};

// Gear-panel order, and the names shown for Blizzard's slot keys.
export const EQUIPMENT_SLOTS: [string, string][] = [
  ['HEAD', 'Head'],
  ['NECK', 'Neck'],
  ['SHOULDER', 'Shoulder'],
  ['BACK', 'Back'],
  ['CHEST', 'Chest'],
  ['WRIST', 'Wrist'],
  ['HANDS', 'Hands'],
  ['WAIST', 'Waist'],
  ['LEGS', 'Legs'],
  ['FEET', 'Feet'],
  ['FINGER_1', 'Finger 1'],
  ['FINGER_2', 'Finger 2'],
  ['TRINKET_1', 'Trinket 1'],
  ['TRINKET_2', 'Trinket 2'],
  ['MAIN_HAND', 'Main Hand'],
  ['OFF_HAND', 'Off Hand']
];

export type EquippedItem = { slot: string; item: string; itemLevel: number | null; track: string | null };

export function equippedGear(rows: GearRow[], namesByWowId: Map<number, string>): EquippedItem[] {
  const bySlot = new Map(rows.map((r) => [r.equipment_slot, r]));
  const gear: EquippedItem[] = [];
  for (const [key, label] of EQUIPMENT_SLOTS) {
    const row = bySlot.get(key);
    if (!row) continue;
    gear.push({
      slot: label,
      item: (row.item_id != null && namesByWowId.get(row.item_id)) || `Item #${row.item_id}`,
      itemLevel: row.item_level,
      track: row.track
    });
  }
  return gear;
}

// Header

// Realm names as the armory, Raider.IO and Warcraft Logs write them in
// addresses: lower case, apostrophes dropped, spaces as hyphens.
export function realmSlug(realm: string): string {
  return realm.toLowerCase().replace(/'/g, '').replace(/\s+/g, '-');
}

export function characterLinks(nameRealm: string) {
  const dash = nameRealm.indexOf('-');
  if (dash <= 0) return null;
  const name = encodeURIComponent(nameRealm.slice(0, dash).trim());
  const realm = realmSlug(nameRealm.slice(dash + 1).trim());
  return {
    warcraftLogs: `https://www.warcraftlogs.com/character/us/${realm}/${name}`,
    raiderIo: `https://raider.io/characters/us/${realm}/${name}`,
    armory: `https://worldofwarcraft.com/en-us/character/us/${realm}/${name}`
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatJoinDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return date;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export type ProfileTag = 'Trial' | 'Bench' | 'Rotator' | 'Backup Tank' | 'Backup Healer';

export function profileTags(p: {
  is_trial: boolean;
  is_bench: boolean;
  is_rotator: boolean;
  is_backup_tank: boolean;
  is_backup_healer: boolean;
}): ProfileTag[] {
  const tags: ProfileTag[] = [];
  if (p.is_trial) tags.push('Trial');
  if (p.is_bench) tags.push('Bench');
  if (p.is_rotator) tags.push('Rotator');
  if (p.is_backup_tank) tags.push('Backup Tank');
  if (p.is_backup_healer) tags.push('Backup Healer');
  return tags;
}
