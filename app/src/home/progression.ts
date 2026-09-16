// Raid progression on the team Home page (#1102), ported rule for rule from
// the current site's buildProgression() (js/roster.js) and recorded against it
// in tests/behavior/home.js.

// A raid as officers list it in Season Settings (team_settings.config.raidProgression).
export type SettingsRaid = {
  name?: string | null;
  aotcDate?: string | null;
  isMiniRaid?: boolean | null;
  wclZoneId?: number | string | null;
  bosses?: { name?: string | null; mythicDate?: string | null; wclEncounterId?: number | null }[] | null;
};

// One boss's synced progress (team_raid_progress), with its encounter and zone.
export type ProgressRow = {
  mythic_date: string | null;
  mythic_pulls: number | null;
  mythic_best_pct: number | null;
  mythic_report_code: string | null;
  mythic_fight_id: number | null;
  heroic_date: string | null;
  heroic_pulls: number | null;
  heroic_best_pct: number | null;
  heroic_report_code: string | null;
  heroic_fight_id: number | null;
  raid_encounters: {
    name: string | null;
    wcl_encounter_id: number | null;
    raid_zones: { wcl_zone_id: number | null } | null;
  } | null;
};

// What one difficulty's line under a boss says. `best` is only set while the
// boss is still up.
export type DifficultyLine = { date: string | null; pulls: number | null; best: number | null; link: string | null };

export type BossCard = { number: number; name: string; mythic: DifficultyLine | null; heroic: DifficultyLine | null };

export type RaidCard = {
  name: string;
  score: { heroic: number | null; mythic: number | null; total: number };
  bar: { pct: number; difficulty: 'heroic' | 'mythic' } | null;
  bosses: BossCard[];
  aotc: string | null;
};

const normalise = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

// Synced rows keyed two ways: by zone and encounter id, and by zone and boss
// name. A boss with an encounter id in Season Settings is found by it, so
// renaming the boss there does not lose its progress; one without is found by
// name.
function indexProgress(rows: ProgressRow[]) {
  const map = new Map<string, ProgressRow>();
  for (const row of rows) {
    const zone = row.raid_encounters?.raid_zones?.wcl_zone_id;
    if (!zone) continue;
    const encounter = row.raid_encounters!;
    if (encounter.wcl_encounter_id != null) map.set(`${zone}|id|${encounter.wcl_encounter_id}`, row);
    const name = normalise(encounter.name ?? '');
    if (name) map.set(`${zone}|${name}`, row);
  }
  return map;
}

export const reportUrl = (code: string | null, fight: number | null): string | null =>
  code
    ? `https://www.warcraftlogs.com/reports/${encodeURIComponent(code)}${fight ? `#fight=${encodeURIComponent(fight)}` : ''}`
    : null;

export function raidCards(raids: SettingsRaid[], rows: ProgressRow[]): RaidCard[] {
  const progress = indexProgress(rows);
  const find = (zone: SettingsRaid['wclZoneId'], boss: NonNullable<SettingsRaid['bosses']>[number]) => {
    if (!zone) return null;
    if (boss.wclEncounterId != null) {
      const byId = progress.get(`${zone}|id|${boss.wclEncounterId}`);
      if (byId) return byId;
    }
    return boss.name ? (progress.get(`${zone}|${normalise(boss.name)}`) ?? null) : null;
  };

  return raids.map((raid) => {
    const bosses = (raid.bosses ?? []).map((boss, i) => {
      const p = find(raid.wclZoneId, boss);
      // The sync's Mythic kill date first, then the one an officer typed.
      const mythicDate = p?.mythic_date || boss.mythicDate || null;
      return { number: i + 1, name: boss.name || 'Unknown', p, mythicDate, heroicDate: p?.heroic_date || null };
    });
    const total = bosses.length;
    const heroicKilled = bosses.filter((b) => b.heroicDate).length;
    const mythicKilled = bosses.filter((b) => b.mythicDate).length;
    // AOTC is the last boss's synced Heroic kill, or the date an officer typed.
    const aotc = raid.isMiniRaid ? null : bosses.at(-1)?.heroicDate || raid.aotcDate || null;
    // Until AOTC the card follows Heroic, which is what the team is working on,
    // with Mythic beside it once a Mythic boss is down. After AOTC, and always
    // for a mini-raid, it is Mythic only.
    const showHeroic = !raid.isMiniRaid && !aotc;
    const barKilled = showHeroic ? heroicKilled : mythicKilled;

    return {
      name: raid.name || 'Unnamed Raid',
      score: {
        heroic: showHeroic ? heroicKilled : null,
        mythic: !showHeroic || mythicKilled > 0 ? mythicKilled : null,
        total
      },
      bar: total ? { pct: Math.round((barKilled / total) * 100), difficulty: showHeroic ? 'heroic' : 'mythic' } : null,
      bosses: bosses.map(({ number, name, p, mythicDate, heroicDate }) => ({
        number,
        name,
        mythic: mythicLine(p, mythicDate),
        heroic: heroicLine(p, heroicDate)
      })),
      aotc
    };
  });
}

// The Mythic line: the kill date, and the pulls once there are any. A boss
// with no Mythic pulls and no kill says nothing, so the line does not read as
// a stray "0 pulls" next to the real Heroic count.
function mythicLine(p: ProgressRow | null, date: string | null): DifficultyLine | null {
  const killed = date !== null;
  const hasPulls = p?.mythic_pulls != null && (killed || p.mythic_pulls > 0);
  if (!killed && !hasPulls) return null;
  if (!hasPulls) return { date, pulls: null, best: null, link: null };
  return {
    date,
    pulls: p!.mythic_pulls,
    best: killed ? null : p!.mythic_best_pct,
    link: reportUrl(p!.mythic_report_code, p!.mythic_fight_id)
  };
}

function heroicLine(p: ProgressRow | null, date: string | null): DifficultyLine | null {
  if (!p || (p.heroic_pulls == null && !date)) return null;
  const hasPulls = p.heroic_pulls != null;
  return {
    date,
    pulls: p.heroic_pulls,
    best: hasPulls && !date ? p.heroic_best_pct : null,
    link: hasPulls ? reportUrl(p.heroic_report_code, p.heroic_fight_id) : null
  };
}

// Kill dates are stored as YYYY-MM-DD, or typed by hand by an officer. A date
// is shown as "Apr 2, 2026"; anything else is shown as typed.
const KILL_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric'
});

export function killDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? KILL_DATE.format(new Date(`${value}T00:00:00Z`)) : value;
}

export const pullsText = (line: DifficultyLine): string =>
  line.pulls === null ? '' : `${line.pulls} ${line.pulls === 1 ? 'pull' : 'pulls'}`;
