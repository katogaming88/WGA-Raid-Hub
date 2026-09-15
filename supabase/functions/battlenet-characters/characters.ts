// The pure half of battlenet-characters (#942 step 5, #1162): reading
// Blizzard's answers and deciding which characters a raider is shown. No
// network and no database, so tests/edge runs it on captured shapes.

// Midnight's level cap. The picker lists only characters at it: a raider's
// account holds dozens of characters (47 on the one tested on 2026-09-14) and
// the low-level ones are not alts anyone raids on.
export const MAX_LEVEL = 90;

export type AccountCharacter = {
  blizzard_id: number;
  name: string;
  realm: string;
  realm_slug: string;
  class_name: string | null;
  level: number;
};

export type CharacterDetail = { spec_name: string | null; item_level: number | null };

export type ShownCharacter = AccountCharacter & CharacterDetail;

type Named = { name?: unknown } | null | undefined;

const nameOf = (value: Named): string | null => (value && typeof value.name === 'string' ? value.name : null);

// The Battle.net account id Blizzard's userinfo answers with. `sub` is the
// account id as a string; `id` is the same number, kept as a fallback.
export function battlenetAccountIdOf(userinfo: unknown): string | null {
  const body = userinfo as { sub?: unknown; id?: unknown } | null;
  if (body && typeof body.sub === 'string' && body.sub !== '') return body.sub;
  if (body && typeof body.id === 'number') return String(body.id);
  return null;
}

// Every character on every WoW account under the login, from
// /profile/user/wow. Entries missing a name, realm or id are dropped rather
// than guessed at.
export function charactersOf(profile: unknown): AccountCharacter[] {
  const accounts = (profile as { wow_accounts?: unknown } | null)?.wow_accounts;
  if (!Array.isArray(accounts)) return [];
  const out: AccountCharacter[] = [];
  for (const account of accounts) {
    const characters = (account as { characters?: unknown })?.characters;
    if (!Array.isArray(characters)) continue;
    for (const c of characters) {
      const realm = (c as { realm?: { name?: unknown; slug?: unknown } })?.realm;
      const id = (c as { id?: unknown })?.id;
      const name = (c as { name?: unknown })?.name;
      if (typeof id !== 'number' || typeof name !== 'string' || !realm) continue;
      if (typeof realm.name !== 'string' || typeof realm.slug !== 'string') continue;
      const level = (c as { level?: unknown })?.level;
      out.push({
        blizzard_id: id,
        name,
        realm: realm.name,
        realm_slug: realm.slug,
        class_name: nameOf((c as { playable_class?: Named })?.playable_class),
        level: typeof level === 'number' ? level : 0
      });
    }
  }
  return out;
}

export const atMaxLevel = (characters: AccountCharacter[]) => characters.filter((c) => c.level >= MAX_LEVEL);

// Spec and item level from a character's profile summary. A locked or missing
// profile answers with nothing, which is still a character worth listing.
export function detailOf(summary: unknown): CharacterDetail {
  const body = summary as { active_spec?: Named; equipped_item_level?: unknown } | null;
  return {
    spec_name: nameOf(body?.active_spec),
    item_level: typeof body?.equipped_item_level === 'number' ? body.equipped_item_level : null
  };
}

// The picked ids, kept only when they name a character the raider was shown.
// An id from the request that is not on their own list is ignored, so a body
// cannot save somebody else's character.
export function pickedFrom(shown: ShownCharacter[], save: unknown): ShownCharacter[] | null {
  if (save === undefined) return null;
  const ids = new Set(Array.isArray(save) ? save.filter((x) => typeof x === 'number') : []);
  return shown.filter((c) => ids.has(c.blizzard_id));
}

export const summaryPath = (c: AccountCharacter) =>
  '/profile/wow/character/' + encodeURIComponent(c.realm_slug) + '/' + encodeURIComponent(c.name.toLowerCase());
