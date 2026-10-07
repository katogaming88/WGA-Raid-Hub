import type { OfficerBio } from '../guild/guild';
import type { PlayerRow } from '../roster/roster';

// A class badge reads "Restoration Shaman" from the spec (already the full
// name on the current site's editor) or, with no spec set, just the class.
export function classBadgeLabel(classKey: string, spec: string): string {
  return spec || classKey;
}

// Editing bios in place (#1361), ported from the current site's officer
// Bios editors (js/tabs/tab-bios.js). A card is self-contained: name, class
// and spec are typed in (or copied once from a roster raider), never linked to
// a players row, since a guild officer may not be on the team being viewed.

// The classes the current site's editor offers, in its order (sorted).
export const WOW_CLASSES = [
  'Death Knight',
  'Demon Hunter',
  'Druid',
  'Evoker',
  'Hunter',
  'Mage',
  'Monk',
  'Paladin',
  'Priest',
  'Rogue',
  'Shaman',
  'Warlock',
  'Warrior'
];

// One card while it is being edited. `key` keeps React's place for a card
// as cards move; `kept` is the stored card, so any field this editor does not
// know about survives a save.
export type BioDraft = {
  key: number;
  kept: OfficerBio;
  name: string;
  characterName: string;
  pronouns: string;
  title: string;
  classKey: string;
  spec: string;
  bio: string;
  imagePath: string;
};

export const BIO_FIELDS = [
  'name',
  'characterName',
  'pronouns',
  'title',
  'classKey',
  'spec',
  'bio',
  'imagePath'
] as const;

export function draftsOf(bios: OfficerBio[]): BioDraft[] {
  return bios.map((b, i) => ({
    key: i,
    kept: b,
    name: b.name ?? '',
    characterName: b.characterName ?? '',
    pronouns: b.pronouns ?? '',
    title: b.title ?? '',
    classKey: b.classKey ?? '',
    spec: b.spec ?? '',
    bio: b.bio ?? '',
    imagePath: b.imagePath ?? ''
  }));
}

// What saves: each card's fields trimmed, as the current site's editor does.
export function biosOf(drafts: BioDraft[]): OfficerBio[] {
  return drafts.map((d) => {
    const card: OfficerBio = { ...d.kept };
    for (const field of BIO_FIELDS) card[field] = d[field].trim();
    return card;
  });
}

// Whether anything would change on save: an edited field, a card added,
// removed or moved.
export function biosChanged(saved: OfficerBio[], drafts: BioDraft[]): boolean {
  const now = biosOf(drafts);
  if (now.length !== saved.length) return true;
  return now.some((card, i) => BIO_FIELDS.some((field) => (card[field] ?? '') !== (saved[i]![field] ?? '').trim()));
}

// A new card, optionally started from a roster raider: a one-time copy of
// their name, character, class and spec, not a link.
export function newDraft(key: number, player: PlayerRow | null): BioDraft {
  const character = player ? player.name_realm.split('-')[0]!.trim() : '';
  return {
    key,
    kept: {},
    name: player ? player.nickname?.trim() || character : '',
    characterName: character,
    pronouns: '',
    title: '',
    classKey: player?.classes_specs?.class ?? '',
    spec: player?.classes_specs?.spec ?? '',
    bio: '',
    imagePath: ''
  };
}

// Swaps a card with its neighbour; outside the list it changes nothing.
export function moved<T>(list: T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

// The upload function's own limits, checked first so a wrong file is turned
// away before it is sent.
export const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export function photoProblem(file: { type: string; size: number }): string | null {
  if (!PHOTO_TYPES.includes(file.type)) return 'Photos must be PNG, JPEG or WebP.';
  if (file.size > PHOTO_MAX_BYTES) return 'A photo must be under 5 MB.';
  return null;
}
