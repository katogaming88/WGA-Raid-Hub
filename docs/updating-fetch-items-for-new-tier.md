# Updating `fetch-items.js` for a new tier

`scripts/fetch-items.js` generates `items.csv` and `item_bosses_raw.csv` for seeding the `items` and `item_bosses` Supabase tables at the start of a new raid tier. It pulls the raid's full loot table -- item id, name, equip slot, and boss source -- in one fetch from the Wowhead zone page, then queries Wowhead once per item for just the icon (via Wowhead's lightweight tooltip JSON endpoint, not the full item page). See [issue #132](https://github.com/katogaming88/WGA-Raid-Hub/issues/132) for the full manual SQL workflow and column reference this feeds into.

This is now the **sole** source for the web app's item catalog (name/slot/armor-type/boss) -- the GAS "Item Lookup" sheet was retired as a data source in [#391](https://github.com/katogaming88/WGA-Raid-Hub/issues/391). There's no second catalog to keep in sync each tier; whatever lands in `items`/`item_bosses` via this workflow is what the site shows.

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

### 2. `ZONE_ID` / `ZONE_IS_PTR`

The script pulls the item ID list and Wowhead type automatically from the raid zone page's embedded loot table (the `drops` Listview), so there's no more hand-pasting a `RAW_DATA` array.

1. Find the new raid's Wowhead zone page, e.g. `wowhead.com/zone=<id>/<zone-slug>` (or `wowhead.com/ptr/zone=<id>/<zone-slug>` while the tier is still on PTR).
2. Set `ZONE_ID` to that numeric id, and `ZONE_IS_PTR` to `true`/`false` depending on whether the raid is live yet.
3. Flip `ZONE_IS_PTR` to `false` once the tier ships and the zone page moves off `/ptr/`.

The script classifies each item's Wowhead type from its `classs`/`subclass` fields on the loot table (see `classifyWowheadType` in the script) -- Decor/Reagent are skipped automatically via `SKIP_TYPES`, and tier tokens are classified as `Junk` so the existing token-keyword/boss-source logic handles them. Slot comes from the loot table's numeric equip-slot code via `INVTYPE_SLOT_NAME`, and boss comes from its `sourcemore` field. You don't need to filter, classify, or look anything up by hand.

### 3. Everything else is stable

`INVTYPE_SLOT_NAME`, `ARMOR_SUBCLASS_NAME`, `SKIP_TYPES`, and the token-armor suffix map are keyed off Wowhead's own numeric item-class codes and general slot names, which don't change tier to tier. Leave them alone unless a new tier introduces an item class/subclass or equip-slot code you haven't seen before (the script will log `slot: ??` for anything it can't resolve, or a `[WARN]` for an unrecognized `classs`/`subclass`, which is your signal to add a mapping).

## Running it

```
node scripts/fetch-items.js
```

Requires Node 18+ (uses native `fetch`). No install step, no dependencies.

## After it runs

- Check the console output for `[FAIL]` and `[SKIP]` lines -- these need manual follow-up. `[FAIL]` now only means the per-item icon lookup failed (the item still gets a row, just with a blank `icon`); `[SKIP]` means a Junk item that didn't match a token keyword and had no boss source.
- Check the end-of-run warning about empty slots in `items.csv` -- fill those in by hand before importing.
- **Treat the `boss` column in `item_bosses_raw.csv` as a rough first pass, not authoritative.** It comes from the zone loot table's own boss attribution, which is generally reliable but has been wrong for a handful of items in the past (multi-boss trinkets, world drops, etc). Use `scripts/item-bosses-sql.js` (paste the zone page's Items-tab table directly, with encounter-name reconciliation via `ENCOUNTER_MAP`) as the more reliable source for the actual `item_bosses` insert -- don't just trust `item_bosses_raw.csv` as-is.

## Importing

`items.csv` columns match the `items` table (`wow_item_id, name, slot, armor_type, sort_id, icon, wcl_zone_id`) -- `sort_id` is left blank and needs manual fill-in per issue #132's guidance. `wcl_zone_id` is filled in automatically from the `ZONE_ID` constant (#535) -- it scopes the item to this tier so old-season loot stops showing up in the Priority tab, BiS grid, and Wishlist once a newer tier's items are imported. Import via the Supabase SQL Editor, not the CLI (per project convention, DB writes are manual). `item_bosses_raw.csv` uses `wow_item_id` as a placeholder key -- swap it for the DB-assigned `id` after `items.csv` is imported, same as noted in the script's header comment.
