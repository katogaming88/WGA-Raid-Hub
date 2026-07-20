-- #515 follow-up: store each item's real Wowhead icon slug so the raider
-- wishlist can render an <img> that always shows, rather than depending on
-- the Wowhead tooltip widget's external script actually loading (ad-blockers
-- commonly block wow.zamimg.com, so that alone isn't reliable). Nullable --
-- backfilled by re-running scripts/fetch-items.js (updated in the same PR to
-- capture the icon slug), imported through the SQL Editor as usual.
alter table "public"."items" add column "icon" text;
