-- #936: a raider's wishlist pick is one per item, slot and season, not one per
-- item and slot for all time. The third of #936's parts.
--
-- item_preferences_no_dupe_item_key has been (player_id, item_id,
-- coalesce(slot, '')) since #515 Phase 1, when there was one tier of picks and
-- the season column did not exist. The column arrived later and now holds a
-- code (#1326), and the write gate added with it reads the season on the row
-- (#1331), so the row's season is already what says which tier a pick belongs
-- to everywhere except here.
--
-- Left as it is, a raider's first pick for an item blocks their pick for the
-- same item in the next tier, and the page works around that by finding a pick
-- by item and slot in whichever season it lands in. That worked while every
-- row a raider held sat in one tier, which on production is true today and
-- stops being true the moment a tier starts after MID2: the page would then
-- re-tag, demote or remove a row from a closed tier and the gate would refuse
-- it part-way through, leaving a slot with two BiS picks or losing picks
-- already deleted. #1330 brings that forward, since an M+ or crafted item is
-- offered in more than one tier by design.
--
-- The key only widens, so no existing row can fail it: every pair it used to
-- separate it still separates. A missing season reads as one value, so the two
-- rows a raider cannot tell apart (same item, same slot, neither stamped) stay
-- a duplicate. The column stays nullable, and the 9 rows on production with no
-- season, all on archived characters, belong to #945.
drop index if exists "public"."item_preferences_no_dupe_item_key";

create unique index "item_preferences_no_dupe_item_key"
    on "public"."item_preferences" ("player_id", "item_id", coalesce("slot", ''), coalesce("season", ''));
