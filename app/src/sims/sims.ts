// Droptimizer sims (#1443): a raider pastes a Raidbots droptimizer or QE Live
// upgrade report link, the page reads the report straight from the site
// (both allow it), and each result is saved by save_character_sim(). Pure
// rules here, so the parsing is tested on real reports without the network.

export type Difficulty = 'lfr' | 'normal' | 'heroic' | 'mythic';
export type SimSource = 'raidbots' | 'qe_live';

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  lfr: 'Raid Finder',
  normal: 'Normal',
  heroic: 'Heroic',
  mythic: 'Mythic'
};
export const DIFFICULTY_ORDER: Difficulty[] = ['mythic', 'heroic', 'normal', 'lfr'];
export const SOURCE_LABELS: Record<SimSource, string> = { raidbots: 'Raidbots', qe_live: 'QE Live' };

export type SimResult = {
  wow_item_id: number;
  item_name: string | null;
  slot: string | null;
  item_level: number;
  pct_gain: number;
  dps_gain: number | null;
  encounter_id: number | null;
  catalyst_from: number | null;
};

// One sim per difficulty in the report, as save_character_sim() takes it.
export type ParsedSim = {
  difficulty: Difficulty;
  results: SimResult[];
};

export type ParsedReport = {
  source: SimSource;
  reportId: string;
  character: { name: string; realm: string };
  simmedAt: string;
  fightStyle: string | null;
  targetCount: number | null;
  sims: ParsedSim[];
};

export type SimLink = { source: SimSource; reportId: string; dataUrl: string };

// The report a pasted link points at, and where its data is read from.
export function parseSimLink(text: string): SimLink | { error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { error: 'Paste a Raidbots droptimizer or QE Live upgrade report link first.' };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { error: 'That isn’t a link. Copy the address of the report page.' };
  }
  const host = url.hostname.replace(/^www\./, '');
  const parts = url.pathname.split('/').filter(Boolean);
  if (host === 'raidbots.com') {
    const at = parts.indexOf('report');
    const id = at >= 0 ? parts[at + 1] : undefined;
    if (parts[0] === 'simbot' && id && /^[A-Za-z0-9]+$/.test(id)) {
      return { source: 'raidbots', reportId: id, dataUrl: `https://www.raidbots.com/reports/${id}/data.json` };
    }
    return { error: 'That Raidbots link isn’t a report. Open the finished droptimizer and copy its address.' };
  }
  if (host === 'questionablyepic.com') {
    const at = parts.indexOf('upgradereport');
    const id = at >= 0 ? parts[at + 1] : undefined;
    if (id && /^[A-Za-z0-9]+$/.test(id)) {
      return {
        source: 'qe_live',
        reportId: id,
        dataUrl: `https://questionablyepic.com/api/getUpgradeReport.php?reportID=${id}`
      };
    }
    return {
      error: 'That QE Live link isn’t an upgrade report. Run the Upgrade Finder and copy the report’s address.'
    };
  }
  return { error: 'Only Raidbots droptimizer and QE Live upgrade report links can be added.' };
}

const DIFFICULTY_BY_WORD: [RegExp, Difficulty][] = [
  [/mythic/, 'mythic'],
  [/heroic/, 'heroic'],
  [/normal/, 'normal'],
  [/lfr|finder/, 'lfr']
];
const difficultyOf = (text: string): Difficulty | null =>
  DIFFICULTY_BY_WORD.find(([re]) => re.test(text.toLowerCase()))?.[1] ?? null;

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;
const positiveInt = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// Keeps one result per item, slot, item level and catalyst source: the best,
// since Raidbots sims some trinkets twice (with and without swapping on-use).
function dedupe(results: SimResult[]): SimResult[] {
  const best = new Map<string, SimResult>();
  for (const r of results) {
    const key = [r.wow_item_id, r.slot, r.item_level, r.catalyst_from].join('|');
    const had = best.get(key);
    if (!had || r.pct_gain > had.pct_gain) best.set(key, r);
  }
  return [...best.values()];
}

function grouped(results: { difficulty: Difficulty; result: SimResult }[]): ParsedSim[] {
  const by = new Map<Difficulty, SimResult[]>();
  for (const { difficulty, result } of results) by.set(difficulty, [...(by.get(difficulty) ?? []), result]);
  return DIFFICULTY_ORDER.filter((d) => by.has(d)).map((d) => ({ difficulty: d, results: dedupe(by.get(d)!) }));
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});

// Raidbots' report data. Each profileset is named
// instance/encounter/difficulty/item/item level/bonus/slot//// with, for a
// catalyst piece, the item it is made from last; its gain is its mean against
// the character's own (the sim's player).
export function parseRaidbots(data: unknown, reportId: string): ParsedReport | { error: string } {
  const root = obj(data);
  const simbot = obj(root.simbot);
  const meta = obj(simbot.meta);
  const sim = obj(root.sim);
  if ((meta.type ?? simbot.simType) !== 'droptimizer') {
    return { error: 'That Raidbots report isn’t a droptimizer. Only droptimizer reports have per-item gains.' };
  }
  const player = obj((sim.players as unknown[] | undefined)?.[0]);
  const metric = typeof obj(sim.profilesets).metric === 'string' ? (obj(sim.profilesets).metric as string) : 'dps';
  const baseline = Number(obj(obj(player.collected_data)[metric]).mean ?? obj(obj(player.collected_data).dps).mean);
  const results = obj(sim.profilesets).results;
  if (!Array.isArray(results) || !results.length || !(baseline > 0)) {
    return { error: 'That Raidbots report has no results yet. Wait for it to finish, then paste it again.' };
  }
  const names = new Map<number, string>();
  for (const item of (meta.itemLibrary as unknown[] | undefined) ?? []) {
    const i = obj(item);
    if (positiveInt(i.id) && typeof i.name === 'string') names.set(Number(i.id), i.name);
  }
  const rows: { difficulty: Difficulty; result: SimResult }[] = [];
  for (const entry of results) {
    const e = obj(entry);
    const f = String(e.name ?? '').split('/');
    const difficulty = difficultyOf(f[2] ?? '');
    const itemId = positiveInt(f[3]);
    const level = positiveInt(f[4]);
    const mean = Number(e.mean);
    if (!difficulty || !itemId || !level || !Number.isFinite(mean)) continue;
    rows.push({
      difficulty,
      result: {
        wow_item_id: itemId,
        item_name: names.get(itemId) ?? null,
        slot: f[6] || null,
        item_level: level,
        pct_gain: round(((mean - baseline) / baseline) * 100, 3),
        dps_gain: Math.round(mean - baseline),
        encounter_id: Number.isInteger(Number(f[1])) && f[1] !== '' ? Number(f[1]) : null,
        catalyst_from: positiveInt(f[f.length - 1])
      }
    });
  }
  if (!rows.length) return { error: 'That Raidbots droptimizer has no raid items in it.' };
  // The realm is the SimulationCraft profile's server= line.
  const text = String(obj(meta.rawFormData).text ?? '');
  const realm = /^server=(.+)$/m.exec(text)?.[1]?.trim() ?? '';
  const stamp = Number(root.timestamp);
  return {
    source: 'raidbots',
    reportId,
    character: { name: String(meta.player ?? simbot.player ?? ''), realm },
    simmedAt: new Date(Number.isFinite(stamp) && stamp > 0 ? stamp * 1000 : Date.now()).toISOString(),
    fightStyle: typeof meta.fightStyle === 'string' ? meta.fightStyle : null,
    targetCount: positiveInt(meta.enemyCount),
    sims: grouped(rows)
  };
}

// QE Live's upgrade report. Raid results come as dropped ("drop"), fully
// upgraded ("max") and bonus roll ("bonus", the same as max); its difficulty
// code counts Raid Finder, Raid Finder max, Normal, Normal max and so on.
const QE_DIFFICULTIES: Difficulty[] = ['lfr', 'normal', 'heroic', 'mythic'];
export function parseQeLive(data: unknown, reportId: string): ParsedReport | { error: string } {
  let root = data;
  if (typeof root === 'string') {
    try {
      root = JSON.parse(root);
    } catch {
      return { error: 'QE Live sent back something unreadable. Try again in a minute.' };
    }
  }
  const r = obj(root);
  if (r.status === 'Report not found') return { error: 'QE Live has no report with that link.' };
  const rows: { difficulty: Difficulty; result: SimResult }[] = [];
  for (const entry of Array.isArray(r.results) ? r.results : []) {
    const e = obj(entry);
    if (e.dropLoc !== 'Raid' || (e.dropType !== 'drop' && e.dropType !== 'max')) continue;
    const difficulty = QE_DIFFICULTIES[Math.floor(Number(e.dropDifficulty) / 2)];
    const itemId = positiveInt(e.item);
    const level = positiveInt(e.level);
    const pct = Number(e.percDiff);
    if (!difficulty || !itemId || !level || !Number.isFinite(pct)) continue;
    rows.push({
      difficulty,
      result: {
        wow_item_id: itemId,
        item_name: null,
        slot: null,
        item_level: level,
        pct_gain: pct,
        dps_gain: null,
        encounter_id: null,
        catalyst_from: null
      }
    });
  }
  if (!rows.length)
    return { error: 'That QE Live report has no raid items. Run the Upgrade Finder with a raid difficulty.' };
  const made = Date.parse(String(r.timeCreated ?? ''));
  return {
    source: 'qe_live',
    reportId,
    character: { name: String(r.playername ?? ''), realm: String(r.realm ?? '') },
    simmedAt: new Date(Number.isFinite(made) ? made : Date.now()).toISOString(),
    fightStyle: null,
    targetCount: null,
    sims: grouped(rows)
  };
}

// Whether the report is for this character: name and realm, ignoring case,
// spaces, dashes, underscores and apostrophes ("wyrmrest_accord" and
// "Wyrmrest Accord" are the same realm).
const squash = (s: string) => s.toLowerCase().replace(/[\s_'’-]/g, '');
export function isCharacter(nameRealm: string, character: { name: string; realm: string }): boolean {
  const at = nameRealm.indexOf('-');
  const name = at < 0 ? nameRealm : nameRealm.slice(0, at);
  const realm = at < 0 ? '' : nameRealm.slice(at + 1);
  return squash(name) === squash(character.name) && (!character.realm || squash(realm) === squash(character.realm));
}

// A saved sim's results, one row per item: its fully upgraded level (the
// highest item level saved, Kat 2026-11-24) and its best slot.
export type SavedResult = SimResult & { id: number };
export function bestPerItem(results: SavedResult[]): SavedResult[] {
  const best = new Map<number, SavedResult>();
  for (const r of results) {
    const had = best.get(r.wow_item_id);
    if (
      !had ||
      r.item_level > had.item_level ||
      (r.item_level === had.item_level && Number(r.pct_gain) > Number(had.pct_gain))
    ) {
      best.set(r.wow_item_id, r);
    }
  }
  return [...best.values()].sort((a, b) => Number(b.pct_gain) - Number(a.pct_gain));
}

// How long a sim stays up to date: the team's setting, 14 days until set.
export const DEFAULT_SIM_STALE_DAYS = 14;
export const asStaleDays = (v: unknown): number => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : DEFAULT_SIM_STALE_DAYS;
};
const DAY = 24 * 60 * 60 * 1000;
export const simAgeDays = (simmedAt: string, now = Date.now()) =>
  Math.max(0, Math.floor((now - Date.parse(simmedAt)) / DAY));
export const isStale = (simmedAt: string, staleDays: number, now = Date.now()) =>
  now - Date.parse(simmedAt) > staleDays * DAY;

// "Raidbots slot names" for the table: finger1 -> Ring 1, main_hand -> Main hand.
const SLOT_LABELS: Record<string, string> = {
  head: 'Head',
  neck: 'Neck',
  shoulder: 'Shoulder',
  back: 'Back',
  chest: 'Chest',
  wrist: 'Wrist',
  hands: 'Hands',
  waist: 'Waist',
  legs: 'Legs',
  feet: 'Feet',
  finger1: 'Ring 1',
  finger2: 'Ring 2',
  trinket1: 'Trinket 1',
  trinket2: 'Trinket 2',
  main_hand: 'Main hand',
  off_hand: 'Off hand'
};
export const slotLabel = (slot: string | null) => (slot ? (SLOT_LABELS[slot] ?? slot) : '');
export const formatGain = (pct: number) => `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;

// The Wishlist tab's gains (Kat, 2026-11-24): for each item, by Wowhead id,
// its gain in each saved sim, highest difficulty first, each at its fully
// upgraded level and best slot. A tier token's row asks for the piece it
// becomes, so it shows that piece's gain.
export type ItemGain = { difficulty: Difficulty; pct: number; stale: boolean };
export function gainsByItem(
  sims: { difficulty: Difficulty; simmed_at: string; character_sim_results: SavedResult[] }[],
  staleDays: number | null,
  now = Date.now()
): Map<number, ItemGain[]> {
  const gains = new Map<number, ItemGain[]>();
  for (const difficulty of DIFFICULTY_ORDER) {
    for (const sim of sims.filter((s) => s.difficulty === difficulty)) {
      const stale = staleDays !== null && isStale(sim.simmed_at, staleDays, now);
      for (const r of bestPerItem(sim.character_sim_results)) {
        gains.set(r.wow_item_id, [...(gains.get(r.wow_item_id) ?? []), { difficulty, pct: Number(r.pct_gain), stale }]);
      }
    }
  }
  return gains;
}

export const DIFFICULTY_SHORT: Record<Difficulty, string> = { lfr: 'LFR', normal: 'N', heroic: 'H', mythic: 'M' };
