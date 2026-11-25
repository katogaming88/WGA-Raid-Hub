// The team's sim settings (#1888 part 1): Settings > Loot > Sims. Each is a key
// in team_settings.config, saved by set_team_setting() like the other loot
// settings; a key the team never set takes its default here.
import type { Difficulty, ParsedReport } from './sims';

export type GainMode = 'percent' | 'raw';
export type UpgradeMode = 'max' | 'drop';
export type EquippedMode = 'asIs' | 'upgraded';
export type CheckKey = 'buffs' | 'noPowerInfusion' | 'defaultRotation' | 'sockets' | 'latestSimc' | 'highPrecision';

// A named setup (Kat, 2026-10-18): a fight style, number of targets and fight
// length, and its weight in the gain officers see.
export type SimSetup = {
  id: string;
  name: string;
  fightStyle: string;
  targets: number;
  minutes: number;
  weight: number;
};

export type SimSettings = {
  gainMode: GainMode;
  // The difficulties a raider needs a sim at, for Missing sims.
  difficulties: Difficulty[];
  // The upgrade level each difficulty's items are shown at (Kat, 2026-11-25).
  upgrade: Record<Difficulty, UpgradeMode>;
  // The raider's equipped gear: simmed as it is, or fully upgraded (Kat,
  // 2026-11-25). Raidbots only; QE Live has no such choice.
  equipped: EquippedMode;
  setups: SimSetup[];
  checks: Record<CheckKey, boolean>;
  staleDays: number;
};

// Raidbots' fight styles, by the value its report keeps.
export const FIGHT_STYLES: Record<string, string> = {
  Patchwerk: 'Patchwerk',
  CastingPatchwerk: 'Casting Patchwerk',
  LightMovement: 'Light movement',
  HeavyMovement: 'Heavy movement',
  HecticAddCleave: 'Hectic add cleave',
  DungeonSlice: 'Dungeon slice'
};
export const fightStyleLabel = (style: string) => FIGHT_STYLES[style] ?? style;

export const CHECKS: { key: CheckKey; label: string; hint: string }[] = [
  { key: 'buffs', label: 'Raid buffs on', hint: 'Simmed with the usual raid buffs, Bloodlust included.' },
  {
    key: 'noPowerInfusion',
    label: 'No Power Infusion',
    hint: 'A priest buff only some raiders get; it inflates gains.'
  },
  { key: 'defaultRotation', label: 'Default rotation', hint: 'No hand-edited rotation and no expert settings.' },
  { key: 'sockets', label: 'Add sockets', hint: 'Items are simmed with the extra socket they can get.' },
  {
    key: 'latestSimc',
    label: 'Latest SimulationCraft',
    hint: 'Simmed on the nightly SimulationCraft, not an older one.'
  },
  { key: 'highPrecision', label: 'High precision', hint: 'Enough iterations that the gain is not just noise.' }
];

export const DEFAULT_SETUP: SimSetup = {
  id: 'single',
  name: 'Single target',
  fightStyle: 'Patchwerk',
  targets: 1,
  minutes: 5,
  weight: 1
};

export const DEFAULT_SIM_SETTINGS: SimSettings = {
  gainMode: 'percent',
  difficulties: ['heroic', 'mythic'],
  upgrade: { lfr: 'max', normal: 'max', heroic: 'max', mythic: 'max' },
  equipped: 'asIs',
  setups: [DEFAULT_SETUP],
  // On by default (the issue): raid buffs, no Power Infusion, default rotation.
  checks: {
    buffs: true,
    noPowerInfusion: true,
    defaultRotation: true,
    sockets: false,
    latestSimc: false,
    highPrecision: false
  },
  staleDays: 14
};

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const DIFFS: Difficulty[] = ['lfr', 'normal', 'heroic', 'mythic'];

function asSetup(v: unknown, i: number): SimSetup | null {
  const s = obj(v);
  const targets = Number(s.targets);
  const minutes = Number(s.minutes);
  const weight = Number(s.weight);
  if (typeof s.fightStyle !== 'string' || !Number.isInteger(targets) || targets < 1 || targets > 100) return null;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) return null;
  return {
    id: typeof s.id === 'string' && s.id ? s.id : `setup${i}`,
    name: typeof s.name === 'string' && s.name.trim() ? s.name.trim() : `Setup ${i + 1}`,
    fightStyle: s.fightStyle,
    targets,
    minutes,
    weight: Number.isFinite(weight) && weight >= 0 ? weight : 1
  };
}

// The team's settings from team_settings.config, defaults for anything unset
// or unreadable.
export function asSimSettings(config: unknown): SimSettings {
  const c = obj(config);
  const d = DEFAULT_SIM_SETTINGS;
  const days = Number(c.simStaleDays);
  const difficulties = Array.isArray(c.simDifficulties)
    ? DIFFS.filter((x) => (c.simDifficulties as unknown[]).includes(x))
    : d.difficulties;
  const upgrade = obj(c.simUpgrade);
  const setups = Array.isArray(c.simSetups) ? c.simSetups.map(asSetup).filter((s): s is SimSetup => s !== null) : [];
  const checks = obj(c.simChecks);
  return {
    gainMode: c.simGainMode === 'raw' ? 'raw' : 'percent',
    difficulties,
    upgrade: Object.fromEntries(
      DIFFS.map((x) => [x, upgrade[x] === 'drop' ? 'drop' : upgrade[x] === 'max' ? 'max' : d.upgrade[x]])
    ) as Record<Difficulty, UpgradeMode>,
    equipped: c.simEquipped === 'upgraded' ? 'upgraded' : 'asIs',
    setups: setups.length ? setups : d.setups,
    checks: Object.fromEntries(
      CHECKS.map(({ key }) => [key, typeof checks[key] === 'boolean' ? checks[key] : d.checks[key]])
    ) as Record<CheckKey, boolean>,
    staleDays: Number.isInteger(days) && days >= 1 && days <= 365 ? days : d.staleDays
  };
}

// The same settings as the config keys set_team_setting() saves.
export const simSettingsConfig = (s: SimSettings) => ({
  simGainMode: s.gainMode,
  simDifficulties: s.difficulties,
  simUpgrade: s.upgrade,
  simEquipped: s.equipped,
  simSetups: s.setups,
  simChecks: s.checks,
  simStaleDays: s.staleDays
});

// The setup a saved sim was run as (Kat, 2026-11-25): a sim with no fight
// style (QE Live) counts as every setup; a Raidbots sim matches the setup
// with its fight style, targets and length. A sim saved before lengths were
// kept matches on style and targets alone. Null: it matches no setup now.
export type SetupShape = { fight_style?: string | null; target_count?: number | null; fight_length?: number | null };
export function setupOf(sim: SetupShape, setups: SimSetup[]): SimSetup | 'all' | null {
  if (!sim.fight_style) return 'all';
  return (
    setups.find(
      (s) =>
        s.fightStyle.toLowerCase() === sim.fight_style!.toLowerCase() &&
        s.targets === sim.target_count &&
        (sim.fight_length == null || s.minutes * 60 === sim.fight_length)
    ) ?? null
  );
}

export const describeSetup = (s: { fightStyle: string; targets: number; minutes: number }) =>
  `${fightStyleLabel(s.fightStyle)}, ${s.targets} ${s.targets === 1 ? 'target' : 'targets'}, ${s.minutes} min`;

const DIFFICULTY_NAMES: Record<Difficulty, string> = {
  lfr: 'Raid Finder',
  normal: 'Normal',
  heroic: 'Heroic',
  mythic: 'Mythic'
};
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

// Why the team turns a report away, in plain words; none: it passes. Only a
// Raidbots report carries its settings, so a QE Live one always passes (Kat,
// 2026-11-25).
export function simProblems(report: ParsedReport, settings: SimSettings): string[] {
  const rb = report.raidbots;
  if (report.source !== 'raidbots' || !rb) return [];
  const problems: string[] = [];
  const shape = { fight_style: report.fightStyle, target_count: report.targetCount, fight_length: report.fightLength };
  if (setupOf(shape, settings.setups) === null) {
    const ran = describeSetup({
      fightStyle: report.fightStyle ?? '',
      targets: report.targetCount ?? 1,
      minutes: Math.round((report.fightLength ?? 0) / 60)
    });
    const want = settings.setups.map((s) => `${s.name} (${describeSetup(s)})`);
    problems.push(`It was run as ${ran}, which isn’t one of the team’s setups: ${list(want)}.`);
  }
  if (rb.upgrade) {
    for (const sim of report.sims) {
      const want = settings.upgrade[sim.difficulty];
      const ok = want === 'max' ? rb.upgrade.step === rb.upgrade.of : rb.upgrade.step === 1;
      if (!ok) {
        problems.push(
          `${DIFFICULTY_NAMES[sim.difficulty]} items must be simmed ${want === 'max' ? 'fully upgraded' : 'as they drop'} (${want === 'max' ? `${rb.upgrade.of}/${rb.upgrade.of}` : `1/${rb.upgrade.of}`}); this one is at ${rb.upgrade.step}/${rb.upgrade.of}.`
        );
      }
    }
  }
  if ((settings.equipped === 'upgraded') !== rb.upgradedEquipped) {
    problems.push(
      settings.equipped === 'upgraded'
        ? 'Equipped gear must be simmed fully upgraded.'
        : 'Equipped gear must be simmed as it is, not upgraded.'
    );
  }
  const c = settings.checks;
  if (c.buffs && rb.missingBuffs.length)
    problems.push(
      `Raid buffs must be on: ${list(rb.missingBuffs)} ${rb.missingBuffs.length === 1 ? 'is' : 'are'} off.`
    );
  if (c.noPowerInfusion && rb.powerInfusion) problems.push('Power Infusion must be off.');
  if (c.defaultRotation && rb.customRotation)
    problems.push('It must use the default rotation, with no custom rotation or expert settings.');
  if (c.sockets && !rb.sockets) problems.push('Items must be simmed with sockets added.');
  if (c.latestSimc && !rb.latestSimc) problems.push('It must be run on the latest (nightly) SimulationCraft.');
  if (c.highPrecision && !rb.highPrecision) problems.push('It must be run at high precision.');
  return problems;
}
