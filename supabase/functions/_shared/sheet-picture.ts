// The signup sheet's roster drawn as a picture (#983, look C picked by Kat on
// 2026-11-04): each raider who is in, their name in its class colour with the
// spec under it and the spec icon before it, grouped Tanks, Healers, Melee and
// Ranged under a heading with the count, four to a row. A Late raider stays
// in with "Late" after the spec. Anyone out stays in the embed's text list.
//
// Pure: the SVG is built here and turned into a PNG by sheet-picture-draw.ts,
// so tests/edge checks the layout without a renderer.
import type { Night, RosterRow, Rsvp } from './signup-sheet.ts';

export type PictureRaider = { name: string; className: string; spec: string; late: boolean };
export type PictureGroup = { label: string; raiders: PictureRaider[] };
export type Picture = { groups: PictureGroup[] };

const GROUPS: Array<[string, string]> = [
  ['Tank', 'Tanks'],
  ['Heal', 'Healers'],
  ['Melee', 'Melee'],
  ['Ranged', 'Ranged']
];

// The app's class colours (app/src/styles/tokens.css, --class-*).
export const CLASS_COLORS: Record<string, string> = {
  'Death Knight': '#e55870',
  'Demon Hunter': '#bd64da',
  Druid: '#ff7c0a',
  Evoker: '#359984',
  Hunter: '#aad372',
  Mage: '#3fc7eb',
  Monk: '#00ff98',
  Paladin: '#f48cba',
  Priest: '#ffffff',
  Rogue: '#fff468',
  Shaman: '#0c87ff',
  Warlock: '#8788ee',
  Warrior: '#c69b6d'
};

// The app's icon file for a spec: app/public/spec-icons/<class>-<spec>.jpg.
export const specIconKey = (className: string, spec: string) =>
  `${className}-${spec}`.toLowerCase().replace(/\s+/g, '-');

const displayName = (p: RosterRow) => p.nickname || p.nameRealm.split('-')[0].trim();

// Who the picture shows, by the sheet's own rules: in unless answered (none on
// an optional night), Attending counts as in, Late stays in and is marked,
// the bench and anyone with no role are left to the text (Unassigned there).
// Anyone with a role is drawn, a missing class or spec only costing the icon
// and colour, so the picture never drops someone the columns would list
// (CodeRabbit on #1760).
export function pictureOf(roster: RosterRow[], rsvps: Rsvp[], night: Night): Picture {
  const answers = new Map(rsvps.map((r) => [r.playerId, r.status]));
  const groups = GROUPS.map(([role, label]) => ({ role, label, raiders: [] as PictureRaider[] }));
  for (const p of roster) {
    if (p.isBench) continue;
    const status = answers.get(p.id) ?? (night.isOptional ? 'No Response' : 'Present');
    if (status !== 'Present' && status !== 'Attending' && status !== 'Late') continue;
    const group = groups.find((g) => g.role === p.role);
    if (!group) continue;
    group.raiders.push({
      name: displayName(p),
      className: p.className ?? '',
      spec: p.spec ?? '',
      late: status === 'Late'
    });
  }
  return {
    groups: groups
      .filter((g) => g.raiders.length)
      .map(({ label, raiders }) => ({ label, raiders: raiders.sort((a, b) => a.name.localeCompare(b.name)) }))
  };
}

export const pictureCount = (picture: Picture) => picture.groups.reduce((n, g) => n + g.raiders.length, 0);

// "Tanks 2 · Healers 4 · Melee 8 · Ranged 9", for the picture and the text.
export const countsLine = (picture: Picture) => picture.groups.map((g) => `${g.label} ${g.raiders.length}`).join(' · ');

// The picture's alt text: every name it shows, by role, a Late one marked.
// Discord takes up to 1024 characters.
export function pictureAltText(picture: Picture): string {
  const text = picture.groups
    .map((g) => `${g.label}: ${g.raiders.map((r) => (r.late ? `${r.name} (Late)` : r.name)).join(', ')}.`)
    .join(' ');
  return text.length > 1024 ? text.slice(0, 1023) + '…' : text;
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A name too long for its cell is cut with an ellipsis (no text measuring in
// the renderer; 14 characters fit at this size).
const fit = (s: string, max = 14) => (s.length > max ? s.slice(0, max - 1) + '…' : s);

export const WIDTH = 1000;
const PAD = 28;
const COLS = 4;
const CELL = (WIDTH - PAD * 2) / COLS;
const ROW = 60;
const HEADING = 46;
const GAP = 14;

// The picture as SVG. `icons` holds each spec icon as a data: URL, by
// specIconKey(); a missing one leaves its space empty.
export function pictureSvg(picture: Picture, icons: Map<string, string>): string {
  const parts: string[] = [];
  let y = PAD;
  parts.push(
    `<text x="${PAD}" y="${y + 24}" font-size="24" font-weight="700" fill="#e8eaf0">${escape(countsLine(picture))}</text>`
  );
  y += 44;
  for (const group of picture.groups) {
    parts.push(
      `<text x="${PAD}" y="${y + 24}" font-size="22" font-weight="700" fill="#e8eaf0">${escape(group.label)}` +
        `<tspan dx="10" font-size="18" font-weight="400" fill="#9aa3b5">${group.raiders.length}</tspan></text>`,
      `<rect x="${PAD}" y="${y + 36}" width="${WIDTH - PAD * 2}" height="1" fill="#2a3040"/>`
    );
    y += HEADING;
    group.raiders.forEach((r, i) => {
      const x = PAD + (i % COLS) * CELL;
      const top = y + Math.floor(i / COLS) * ROW;
      const icon = icons.get(specIconKey(r.className, r.spec));
      if (icon) parts.push(`<image href="${icon}" x="${x}" y="${top + 6}" width="40" height="40"/>`);
      parts.push(
        `<text x="${x + 50}" y="${top + 26}" font-size="22" font-weight="700" fill="${CLASS_COLORS[r.className] ?? '#e8eaf0'}">${escape(fit(r.name))}</text>`,
        `<text x="${x + 50}" y="${top + 45}" font-size="15" fill="#9aa3b5">${escape(r.spec)}` +
          (r.late ? `<tspan dx="6" fill="#f5b14c" font-weight="700">· Late</tspan>` : '') +
          `</text>`
      );
    });
    y += Math.ceil(group.raiders.length / COLS) * ROW + GAP;
  }
  const height = y + PAD - GAP;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" font-family="Onest">` +
    `<rect width="${WIDTH}" height="${height}" fill="#11141b"/>` +
    parts.join('') +
    `</svg>`
  );
}

// What the picture shows, as a short key: the posted file is named after it,
// so a run can tell an unchanged sheet from a changed one without drawing.
export async function pictureKey(picture: Picture, text: unknown): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify({ picture, text }));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...hash.slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
