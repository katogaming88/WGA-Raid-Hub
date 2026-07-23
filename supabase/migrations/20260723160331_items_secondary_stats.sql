-- Which secondary stat types (Crit/Haste/Mastery/Vers) an item rolls, e.g.
-- '["CRIT_RATING","VERSATILITY"]'. Nullable: trinkets/weapons legitimately
-- have none, and every item imported before this ships has no value until
-- backfilled by scripts/fetch-item-stats.js (#560).
alter table "public"."items" add column "secondary_stats" jsonb;
