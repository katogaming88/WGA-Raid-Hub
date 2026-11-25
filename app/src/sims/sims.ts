import {
  setupOf,
  simIsStale,
  type StaleShape,
  type GainMode,
  type SetupShape,
  type SimSettings,
  type SimSetup,
  type UpgradeMode
} from './simSettings';

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
  // The spec as the report names it (#1916): "affliction warlock" from a
  // Raidbots profile, "Restoration Shaman" from QE Live. matchSpec() finds it.
  spec: string;
  simmedAt: string;
  fightStyle: string | null;
  targetCount: number | null;
  // In seconds (#1888); null for QE Live.
  fightLength: number | null;
  // The settings a Raidbots report was run with, for the team's checks
  // (#1888); null for QE Live, which keeps none.
  raidbots: RaidbotsSettings | null;
  sims: ParsedSim[];
};

export type RaidbotsSettings = {
  missingBuffs: string[];
  powerInfusion: boolean;
  customRotation: boolean;
  sockets: boolean;
  latestSimc: boolean;
  highPrecision: boolean;
  // Whether the character's equipped gear was simmed fully upgraded (Kat,
  // 2026-11-25), rather than as it is.
  upgradedEquipped: boolean;
  // The upgrade step from the report's title ("... Myth 6/6"); null if none.
  upgrade: { step: number; of: number } | null;
};

// The raid buffs a Raidbots report switches on or off, by its own names.
const RAID_BUFFS: [string, string][] = [
  ['bloodlust', 'Bloodlust'],
  ['arcaneIntellect', 'Arcane Intellect'],
  ['fortitude', 'Power Word: Fortitude'],
  ['battleShout', 'Battle Shout'],
  ['mysticTouch', 'Mystic Touch'],
  ['chaosBrand', 'Chaos Brand'],
  ['skyfury', 'Skyfury'],
  ['markOfTheWild', 'Mark of the Wild'],
  ['huntersMark', 'Hunter’s Mark']
];

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
  // The realm, class and spec are the SimulationCraft profile's server=,
  // <class>="name" and spec= lines.
  const text = String(obj(meta.rawFormData).text ?? '');
  const realm = /^server=(.+)$/m.exec(text)?.[1]?.trim() ?? '';
  const specLine = /^spec=(\w+)/m.exec(text)?.[1];
  const classLine = /^([a-z]+)="/m.exec(text)?.[1];
  const spec = specLine && classLine ? `${specLine} ${classLine}` : String(player.specialization ?? '');
  if (!spec.trim()) return { error: NO_SPEC };
  const stamp = Number(root.timestamp);
  const raw = obj(meta.rawFormData);
  const fightLength = positiveInt(meta.fightLength ?? raw.fightLength);
  if (typeof meta.fightStyle !== 'string' || !meta.fightStyle || !positiveInt(meta.enemyCount) || !fightLength) {
    return { error: 'That Raidbots report doesn’t say its fight style, targets and length, so it can’t be checked.' };
  }
  const options = obj(sim.options);
  const title = String(raw.reportName ?? simbot.title ?? '');
  const step = /(\d+)\/(\d+)\s*$/.exec(title);
  const targetError = Number(options.target_error);
  const raidbots: RaidbotsSettings = {
    missingBuffs: RAID_BUFFS.filter(([key]) => meta[key] === false).map(([, name]) => name),
    powerInfusion: meta.powerInfusion === true,
    customRotation: !!meta.customApl || meta.expertMode === true || !!String(raw.apl ?? '').trim(),
    sockets: obj(raw.droptimizer).gem != null,
    latestSimc: String(meta.simcVersion ?? raw.simcVersion ?? '') === 'nightly',
    // Smart high precision stops at 0.05% error; a fixed count of 10,000 or
    // more iterations is as good.
    highPrecision:
      (targetError > 0 && targetError <= 0.05) || (!(targetError > 0) && Number(options.iterations) >= 10000),
    upgradedEquipped: obj(raw.droptimizer).upgradeEquipped === true,
    upgrade: step ? { step: Number(step[1]), of: Number(step[2]) } : null
  };
  return {
    source: 'raidbots',
    reportId,
    character: { name: String(meta.player ?? simbot.player ?? ''), realm },
    spec,
    simmedAt: new Date(Number.isFinite(stamp) && stamp > 0 ? stamp * 1000 : Date.now()).toISOString(),
    fightStyle: typeof meta.fightStyle === 'string' ? meta.fightStyle : null,
    targetCount: positiveInt(meta.enemyCount),
    fightLength,
    raidbots,
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
  if (typeof r.spec !== 'string' || !r.spec.trim()) return { error: NO_SPEC };
  const made = Date.parse(String(r.timeCreated ?? ''));
  return {
    source: 'qe_live',
    reportId,
    character: { name: String(r.playername ?? ''), realm: String(r.realm ?? '') },
    spec: r.spec,
    simmedAt: new Date(Number.isFinite(made) ? made : Date.now()).toISOString(),
    fightStyle: null,
    targetCount: null,
    fightLength: null,
    raidbots: null,
    sims: grouped(rows)
  };
}

const NO_SPEC = 'That report doesn’t say which spec it was run as, so it can’t be added.';

// Whether the report is for this character: name and realm, ignoring case,
// spaces, dashes, underscores and apostrophes ("wyrmrest_accord" and
// "Wyrmrest Accord" are the same realm).
const squash = (s: string) => s.toLowerCase().replace(/[\s_'’-]/g, '');
export function isCharacter(nameRealm: string, character: { name: string; realm: string }): boolean {
  const at = nameRealm.indexOf('-');
  const name = at < 0 ? nameRealm : nameRealm.slice(0, at);
  const realm = at < 0 ? '' : nameRealm.slice(at + 1);
  // A report with no realm is turned away (Kat, 2026-11-25): the name alone
  // could be another realm's character.
  return squash(name) === squash(character.name) && !!squash(realm) && squash(realm) === squash(character.realm);
}

// The hub's spec for the report's (#1916): "affliction warlock",
// "beast_mastery hunter" and "Restoration Shaman" all match, ignoring case,
// spaces and underscores.
export type ClassSpec = { id: number; class: string; spec: string };
export function matchSpec(text: string, specs: ClassSpec[]): ClassSpec | null {
  const want = squash(text);
  return specs.find((s) => squash(s.spec + s.class) === want) ?? null;
}

// A saved sim's results, one row per item at the team's upgrade level for
// that difficulty (#1888): fully upgraded is the highest item level saved
// (Kat, 2026-11-24), as it drops the lowest. A Raidbots sim has one level;
// QE Live keeps both. Then each item's best slot.
export type SavedResult = SimResult & { id: number };
export function bestPerItem(results: SavedResult[], upgrade: UpgradeMode = 'max'): SavedResult[] {
  const better = (r: SavedResult, had: SavedResult) =>
    upgrade === 'max' ? r.item_level > had.item_level : r.item_level < had.item_level;
  const best = new Map<number, SavedResult>();
  for (const r of results) {
    const had = best.get(r.wow_item_id);
    if (!had || better(r, had) || (r.item_level === had.item_level && Number(r.pct_gain) > Number(had.pct_gain))) {
      best.set(r.wow_item_id, r);
    }
  }
  return [...best.values()].sort((a, b) => Number(b.pct_gain) - Number(a.pct_gain));
}

// How old a sim is, in whole days. Whether it is out of date is the team's
// rule, simIsStale() in simSettings.ts (#1888 part 2).
const DAY = 24 * 60 * 60 * 1000;
export const simAgeDays = (simmedAt: string, now = Date.now()) =>
  Math.max(0, Math.floor((now - Date.parse(simmedAt)) / DAY));

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
export const formatDps = (dps: number) => `${dps > 0 ? '+' : ''}${Math.round(dps).toLocaleString('en-US')} DPS`;
// A gain as the team shows it (#1888): raw numbers where the sim has them
// (Raidbots), else the percent (QE Live gives only a percent).
export const showGain = (g: { pct: number; dps: number | null }, mode: GainMode) =>
  mode === 'raw' && g.dps !== null ? formatDps(g.dps) : formatGain(g.pct);

// -- Gains, weighted by the team's setups (#1888) ---------------------------

// A sim as the gains read it: its setup shape, date and results.
export type GainSim = SetupShape & StaleShape & { simmed_at: string; character_sim_results: SavedResult[] };
export type Gain = { pct: number; dps: number | null; stale: boolean };

// One character's sims at one difficulty and spec, read as the team's setups
// say (Kat, 2026-10-18 and 2026-11-25). Each setup takes the Raidbots sim run
// as it, else a QE Live sim, which stands in for every setup. The gain is the
// weighted average over the setups, a setup with no up-to-date sim counting
// as no gain: Single target +1.0% at 70 and Several targets +2.0% at 30 is
// +1.3%, and +0.7% with no Several targets sim. With no up-to-date sim at
// all, the out-of-date ones give the gain, greyed.
export function setupGains(all: GainSim[], settings: SimSettings, difficulty: Difficulty, now = Date.now()) {
  // A team that hides out-of-date sims (#1888 part 2) counts them as gone.
  const sims = settings.staleThen === 'hide' ? all.filter((x) => !simIsStale(x, settings, now)) : all;
  const newest = (xs: GainSim[]) => [...xs].sort((a, b) => b.simmed_at.localeCompare(a.simmed_at))[0];
  const everySetup = newest(sims.filter((x) => setupOf(x, settings.setups) === 'all'));
  const picks = settings.setups.map((setup) => {
    const sim = newest(sims.filter((x) => setupOf(x, settings.setups) === setup)) ?? everySetup;
    if (!sim) return { setup, sim: null, fresh: false, values: new Map<number, { pct: number; dps: number | null }>() };
    return {
      setup,
      sim,
      fresh: !simIsStale(sim, settings, now),
      values: new Map(
        bestPerItem(sim.character_sim_results, settings.upgrade[difficulty]).map((r) => [
          r.wow_item_id,
          { pct: Number(r.pct_gain), dps: r.dps_gain === null ? null : Number(r.dps_gain) }
        ])
      )
    };
  });
  const weights = picks.map((p) => p.setup.weight);
  const total = weights.reduce((a, b) => a + b, 0);
  const weight = (i: number) => (total > 0 ? weights[i]! / total : 1 / picks.length);
  const anyFresh = picks.some((p) => p.fresh);
  const used = picks.map((p) => (anyFresh ? p.fresh : p.sim !== null));
  const dated = picks.filter((p) => p.sim).map((p) => p.sim!.simmed_at);
  return {
    // Whether there is any sim, whether every one counted is out of date,
    // and when the newest was run.
    has: dated.length > 0,
    stale: !anyFresh,
    simmedAt: dated.sort().at(-1) ?? null,
    // The setups with no up-to-date sim, for Missing sims: none at all, or
    // one that is out of date.
    missing: picks.filter((p) => !p.fresh).map((p) => ({ setup: p.setup, stale: p.sim !== null })),
    gainOf(wowId: number): Gain | null {
      if (!picks.some((p, i) => used[i] && p.values.has(wowId))) return null;
      let pct = 0;
      let dps: number | null = 0;
      picks.forEach((p, i) => {
        if (!used[i]) return;
        const v = p.values.get(wowId);
        pct += weight(i) * (v?.pct ?? 0);
        dps = dps === null || (v && v.dps === null) ? null : dps + weight(i) * (v?.dps ?? 0);
      });
      return { pct: Math.round(pct * 1000) / 1000, dps, stale: !anyFresh };
    },
    // Every item any counted sim has.
    items(): number[] {
      return [...new Set(picks.flatMap((p, i) => (used[i] ? [...p.values.keys()] : [])))];
    }
  };
}

// The Wishlist tab's gains (Kat, 2026-11-24): for each item, by Wowhead id,
// its gain at each difficulty and spec, highest difficulty first, the roster
// spec's first (#1916), each weighted over the team's setups (#1888). A tier
// token's row asks for the piece it becomes, so it shows that piece's gain.
export type ItemGain = Gain & { difficulty: Difficulty; spec: string; className: string; roster: boolean };
type CharacterSim = GainSim & SimSpec & { difficulty: Difficulty };
export function gainsByItem(
  sims: CharacterSim[],
  rosterSpec: RosterSpec | null,
  settings: SimSettings,
  now = Date.now()
): Map<number, ItemGain[]> {
  const gains = new Map<number, ItemGain[]>();
  const groups = new Map<string, CharacterSim[]>();
  for (const sim of simOrder(sims, rosterSpec)) {
    const key = `${sim.className}|${sim.spec}|${sim.difficulty}`;
    groups.set(key, [...(groups.get(key) ?? []), sim]);
  }
  for (const group of groups.values()) {
    const { difficulty, spec, className } = group[0]!;
    const read = setupGains(group, settings, difficulty, now);
    const roster = isRosterSim(group[0]!, rosterSpec);
    for (const wow of read.items()) {
      const gain = read.gainOf(wow);
      if (gain) gains.set(wow, [...(gains.get(wow) ?? []), { ...gain, difficulty, spec, className, roster }]);
    }
  }
  return gains;
}

// A character's sims in the order the page lists them (#1916): the roster
// spec's first, highest difficulty first, then the other specs by name.
export function simOrder<T extends SimSpec & { difficulty: Difficulty }>(
  sims: T[],
  rosterSpec: RosterSpec | null
): T[] {
  const rank = (s: T) =>
    (isRosterSim(s, rosterSpec) ? '0' : `1${s.spec}|${s.className}`) + DIFFICULTY_ORDER.indexOf(s.difficulty);
  return [...sims].sort((a, b) => rank(a).localeCompare(rank(b)));
}

// A sim's spec, with its class: spec names repeat across classes (Frost is a
// Mage's and a Death Knight's), so the roster spec is matched on both
// (the fresh-agent review on PR #1920).
export type SimSpec = { spec: string; className: string };
export type RosterSpec = { className: string; spec: string };
export const isRosterSim = (sim: SimSpec, roster: RosterSpec | null) =>
  !!roster && sim.spec === roster.spec && sim.className === roster.className;

export const DIFFICULTY_SHORT: Record<Difficulty, string> = { lfr: 'LFR', normal: 'N', heroic: 'H', mythic: 'M' };

// -- The Priority page (#1443 part 2) -------------------------------------

// The difficulty each loot track is simmed at.
export const TRACK_DIFFICULTY: Record<'Hero' | 'Myth', Difficulty> = { Hero: 'heroic', Myth: 'mythic' };

export type TeamSim = CharacterSim & { player_id: number };

// A raider's gain for an item on a track: no sim for their roster spec at that
// difficulty, or its gain over the team's setups (pct null when no sim had the
// item), whether it is out of date, and the setups it has no up-to-date sim
// for. Their other specs' gains (#1916) are only shown, never sorted by: loot
// follows the roster spec (Kat, 2026-11-24). `roster` is the raider's class
// and roster spec, for the spec icons.
export type OtherSpecGain = Gain & { spec: string; className: string };
export type TrackGain = { roster: RosterSpec | null; others: OtherSpecGain[]; mode: GainMode } & (
  | { sim: false }
  | {
      sim: true;
      pct: number | null;
      dps: number | null;
      stale: boolean;
      simmedAt: string;
      missing: { setup: SimSetup; stale: boolean }[];
    }
);

// Looks up any raider's gain for any item on a track. `wowIdFor` gives the
// item's Wowhead id for that raider: a tier token's is the piece it becomes
// for their class, so a token shows the value of what it turns into.
export function trackGains(
  sims: TeamSim[],
  settings: SimSettings,
  rosterSpecOf: (playerId: number) => RosterSpec | null,
  wowIdFor: (playerId: number, itemId: number) => number | null,
  now = Date.now()
) {
  const groups = new Map<string, TeamSim[]>();
  for (const sim of sims) {
    const key = `${sim.player_id}|${sim.difficulty}`;
    groups.set(key, [...(groups.get(key) ?? []), sim]);
  }
  const reads = new Map<string, (SimSpec & { read: ReturnType<typeof setupGains> })[]>();
  for (const [key, group] of groups) {
    const bySpec = new Map<string, TeamSim[]>();
    for (const sim of group) {
      const k = `${sim.className}|${sim.spec}`;
      bySpec.set(k, [...(bySpec.get(k) ?? []), sim]);
    }
    reads.set(
      key,
      [...bySpec.values()].map((specSims) => ({
        spec: specSims[0]!.spec,
        className: specSims[0]!.className,
        read: setupGains(specSims, settings, specSims[0]!.difficulty, now)
      }))
    );
  }
  return (playerId: number, itemId: number, track: 'Hero' | 'Myth'): TrackGain => {
    const all = reads.get(`${playerId}|${TRACK_DIFFICULTY[track]}`) ?? [];
    const roster = rosterSpecOf(playerId);
    const wow = wowIdFor(playerId, itemId);
    const others = all
      .filter((s) => !isRosterSim(s, roster))
      .flatMap((s) => {
        const gain = wow === null ? null : s.read.gainOf(wow);
        return gain ? [{ ...gain, spec: s.spec, className: s.className }] : [];
      })
      .sort((a, b) => a.spec.localeCompare(b.spec));
    const mine = all.find((s) => isRosterSim(s, roster));
    const mode = settings.gainMode;
    if (!mine || !mine.read.has) return { sim: false, roster, others, mode };
    const gain = wow === null ? null : mine.read.gainOf(wow);
    return {
      sim: true,
      pct: gain?.pct ?? null,
      dps: gain?.dps ?? null,
      stale: mine.read.stale,
      simmedAt: mine.read.simmedAt!,
      missing: mine.read.missing,
      roster,
      others,
      mode
    };
  };
}

// For sorting: an up-to-date gain, else below every real gain. Always the
// percent, which compares raiders fairly whatever the team shows.
export const sortGain = (g: TrackGain) => (g.sim && !g.stale && g.pct !== null ? g.pct : -Infinity);
