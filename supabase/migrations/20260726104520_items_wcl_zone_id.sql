alter table "public"."items" add column "wcl_zone_id" integer;

update "public"."items" set "wcl_zone_id" = 46 where "is_placeholder" = false and "wcl_zone_id" is null;
