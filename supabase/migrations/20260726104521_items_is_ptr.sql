-- Whether this item's raid tier is still on PTR (#561 follow-up) -- the
-- Wowhead hover-tooltip widget (window.whTooltips, loaded on index.html/
-- officer.html) resolves "live" data from a bare wowhead.com/item=<id> link
-- and only sees PTR data from a wowhead.com/ptr/item=<id> link, so
-- itemNameBlockHtml() (js/common.js) needs to know per item which URL to
-- build. Mirrors fetch-items.js's own ZONE_IS_PTR constant for the same
-- tier; flip to false (see docs/updating-fetch-items-for-new-tier.md) once
-- the tier ships live, same time WCL_ZONE_ID goes into raid_zones.
alter table "public"."items" add column "is_ptr" boolean not null default false;

update "public"."items" set "is_ptr" = true where "wcl_zone_id" = 53;
