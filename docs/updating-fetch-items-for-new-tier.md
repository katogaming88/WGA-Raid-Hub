# Updating `fetch-items.js` for a new tier

`scripts/fetch-items.js` generates `items.csv` and `item_bosses_raw.csv` for seeding the `items` and `item_bosses` Supabase tables at the start of a new raid tier. It reads a hand-curated list of item IDs, then queries Wowhead per item for the name, slot, and boss source. See [issue #132](https://github.com/katogaming88/WGA-Raid-Hub/issues/132) for the full manual SQL workflow and column reference this feeds into.

## What to update each tier

### 1. `TOKEN_SLOT_KEYWORDS` (top of the file)

Tier set tokens are typed `Junk` on Wowhead, so the script can't get their slot from the type. Instead it matches a keyword in the item name to a slot. Update the keyword list and the comment above it with the new tier's name and token prefix:

```js
// Current tier: The Venomous Abyss (12.1)
// Token prefix: Venom (e.g. Venomforged Effigy)
const TOKEN_SLOT_KEYWORDS = {
  effigy:  'Head',
  icon:    'Chest',
  idol:    'Hands',
  relic:   'Legs',
  remnant: 'Shoulder',
};
```

Look up the new tier's token names on Wowhead (search the tier's tokens, e.g. "Voidwoven") and map each token noun to its slot.

`TOKEN_ARMOR_SUFFIXES` (cast/cured/forged/woven -> Mail/Leather/Plate/Cloth) has held steady across tiers so far -- only touch it if a new tier breaks that naming pattern.

### 2. `RAW_DATA`

Replace the entire array with the new tier's items, pulled from Wowhead:

1. Go to the Wowhead zone page for the new raid (e.g. `wowhead.com/zone=<id>/<zone-slug>`) and open the **Items** tab. This is already scoped to just that raid's loot table.
2. Use the table's column toggle (the columns/gear icon on the table, usually top-right) to make sure **ID** and **Type** are both enabled as visible columns -- Type often isn't shown by default.
3. Copy the **ID** column: click into the column and select all rows (drag-select or click first row, shift+click last row), then copy. Do the same for the **Type** column. This is the same table/column-copy technique `item-bosses-sql.js` uses for the ID and Source columns -- see that script's header comment if the exact clicks below drift as Wowhead's UI changes.
4. Zip the two copied lists together into `[id, 'Type'],` pairs and paste over the existing `RAW_DATA` array.

Don't bother filtering out Decor/Reagent/Cosmetic by hand -- `SKIP_TYPES` does that automatically. Junk-typed rows (tier tokens) should stay in the list; the script special-cases them.

Note: this only gets you name/slot/armor-type inputs. The boss/Source column is pulled separately -- see `item-bosses-sql.js`, which copies the ID and Source columns from this same Items tab table.

### 3. Everything else is stable

`SLOT_FROM_TYPE`, `ARMOR_SLOTS`, `SKIP_TYPES`, and the token-armor suffix map are all keyed off Wowhead's item *type* strings and general slot names, which don't change tier to tier. Leave them alone unless a new tier introduces an item type you haven't seen before (the script will log `slot: ??` for anything it can't resolve, which is your signal to add a mapping).

## Running it

```
node scripts/fetch-items.js
```

Requires Node 18+ (uses native `fetch`). No install step, no dependencies.

## After it runs

- Check the console output for `[FAIL]` and `[SKIP]` lines -- these need manual follow-up (failed fetch, or a Junk item that didn't match a token keyword and had no boss source).
- Check the end-of-run warning about empty slots in `items.csv` -- fill those in by hand before importing.
- **Treat the `boss` column in `item_bosses_raw.csv` as a rough first pass, not authoritative.** It's scraped from the item page's embedded "dropped-by" data, which is where Wowhead's accuracy has been unreliable in the past. Use `scripts/item-bosses-sql.js` (paste the zone page's Items-tab table directly, with encounter-name reconciliation via `ENCOUNTER_MAP`) as the more reliable source for the actual `item_bosses` insert -- don't just trust `item_bosses_raw.csv` as-is.

## Importing

`items.csv` columns match the `items` table (`wow_item_id, name, slot, armor_type, sort_id`) -- `sort_id` is left blank and needs manual fill-in per issue #132's guidance. Import via the Supabase SQL Editor, not the CLI (per project convention, DB writes are manual). `item_bosses_raw.csv` uses `wow_item_id` as a placeholder key -- swap it for the DB-assigned `id` after `items.csv` is imported, same as noted in the script's header comment.
