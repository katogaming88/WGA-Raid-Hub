// Spec icons, bundled with the app (Kat, 2026-09-14): Blizzard's own icon for
// each of the 40 specs, from Wowhead's icon server, saved as
// public/spec-icons/<class>-<spec>.jpg. Devourer uses classicon_demonhunter_void,
// Midnight's Void spec. They are served as files rather than built into the
// code, so a page loads only the icons it shows. A new spec needs its icon
// saved there and its name added here.

export const SPEC_ICON_KEYS = new Set([
  'death-knight-blood',
  'death-knight-frost',
  'death-knight-unholy',
  'demon-hunter-devourer',
  'demon-hunter-havoc',
  'demon-hunter-vengeance',
  'druid-balance',
  'druid-feral',
  'druid-guardian',
  'druid-restoration',
  'evoker-augmentation',
  'evoker-devastation',
  'evoker-preservation',
  'hunter-beast-mastery',
  'hunter-marksmanship',
  'hunter-survival',
  'mage-arcane',
  'mage-fire',
  'mage-frost',
  'monk-brewmaster',
  'monk-mistweaver',
  'monk-windwalker',
  'paladin-holy',
  'paladin-protection',
  'paladin-retribution',
  'priest-discipline',
  'priest-holy',
  'priest-shadow',
  'rogue-assassination',
  'rogue-outlaw',
  'rogue-subtlety',
  'shaman-elemental',
  'shaman-enhancement',
  'shaman-restoration',
  'warlock-affliction',
  'warlock-demonology',
  'warlock-destruction',
  'warrior-arms',
  'warrior-fury',
  'warrior-protection'
]);

const slug = (text: string) => text.trim().toLowerCase().replace(/\s+/g, '-');

export function specIcon(className: string | null, spec: string | null): string | null {
  if (!className || !spec) return null;
  const key = `${slug(className)}-${slug(spec)}`;
  return SPEC_ICON_KEYS.has(key) ? `${import.meta.env.BASE_URL}spec-icons/${key}.jpg` : null;
}
