-- Placeholder BiS entries (M+, Crafted, Catalyst) have no gear slot of their
-- own -- items.slot is NOT NULL, so those rows store the literal sentinel
-- 'Placeholder' since they name a loot source rather than a slot. The old GAS
-- BiS List sheet carried the real slot per-row instead (a player wrote "M+"
-- into whichever slot's row they meant), but bis_items collapsed to
-- (player_id, item_id) at the #217/#320 migration with no home for that,
-- documented as a known loss in scripts/import/tables/bis.js. This column
-- gives officers somewhere to put it going forward; historical rows stay
-- null (unrecoverable, same acceptance as the audit_log TARGET backfill).
--
-- Not placeholder-only: items.slot alone can't say which of the two Finger
-- or Trinket rows a real ring/trinket is meant for either, so the BiS
-- Manager's slot-grid editor (js/tabs/tab-bis.js, BIS_SLOTS) writes this
-- column for every row it creates, real items included. Null only for
-- legacy rows written before this column existed, which fall back to
-- deriving their slot from items.slot client-side (unambiguous for every
-- catalog slot except Finger/Trinket).
alter table public.bis_items add column slot text;

-- bis_items_no_dupe_item_key previously blocked a second row for the same
-- (player_id, item_id) outright, which also blocked exactly the case this
-- column exists for: two Finger slots or two Trinket slots both aimed at
-- "M+", distinguished only by the chosen slot. coalesce(slot, '') keeps real
-- items (slot always null) deduped exactly as before -- null collapses to the
-- same '' for every row, so a second copy of a real item still conflicts --
-- while two placeholder rows with different chosen slots no longer collide.
alter table public.bis_items drop constraint bis_items_no_dupe_item_key;
create unique index bis_items_no_dupe_item_key
  on public.bis_items (player_id, item_id, coalesce(slot, ''));
