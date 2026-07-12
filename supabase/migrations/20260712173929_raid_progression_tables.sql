-- #285: mythic boss pull count + best % on the landing page's progression
-- card. Three new tables: raid_zones/raid_encounters are shared WCL reference
-- data (same category as items/classes_specs -- no team scope, public read,
-- no authenticated write policy since only a service-role sync writes them).
-- team_raid_progress is the per-team progress row, one per encounter, synced
-- by the wcl-progression-sync Edge Function (cron-driven, service role --
-- see .github/workflows/wcl-progression-sync.yml). mythic_report_code/
-- mythic_fight_id let the UI link straight to the WCL report for that kill
-- or current best attempt.

create table "public"."raid_zones" (
    "id" serial primary key,
    "wcl_zone_id" integer not null,
    "name" text not null,
    "season" text not null,
    "is_mini_raid" boolean not null default false,
    "sort_index" integer not null default 0,
    unique ("wcl_zone_id", "season")
);

create table "public"."raid_encounters" (
    "id" serial primary key,
    "zone_id" integer not null references "public"."raid_zones"("id") on delete cascade,
    "wcl_encounter_id" integer not null,
    "name" text not null,
    "sort_index" integer not null default 0,
    unique ("zone_id", "wcl_encounter_id")
);

create table "public"."team_raid_progress" (
    "id" serial primary key,
    "team_id" integer not null references "public"."teams"("id") on delete cascade,
    "encounter_id" integer not null references "public"."raid_encounters"("id") on delete cascade,
    "mythic_date" date,
    "heroic_date" date,
    "mythic_pulls" integer,
    "mythic_best_pct" numeric(5,2),
    "mythic_report_code" text,
    "mythic_fight_id" integer,
    "updated_at" timestamp with time zone,
    unique ("team_id", "encounter_id")
);

alter table "public"."raid_zones" owner to "postgres";
alter table "public"."raid_encounters" owner to "postgres";
alter table "public"."team_raid_progress" owner to "postgres";

alter table "public"."raid_zones" enable row level security;
alter table "public"."raid_encounters" enable row level security;
alter table "public"."team_raid_progress" enable row level security;

create trigger "trg_team_raid_progress_updated_at"
    before update on "public"."team_raid_progress"
    for each row execute function "public"."set_updated_at"();

create policy "Claude readers read raid_zones" on "public"."raid_zones" for select to "claude_readers" using (true);
create policy "Claude readers read raid_encounters" on "public"."raid_encounters" for select to "claude_readers" using (true);
create policy "Claude readers read team_raid_progress" on "public"."team_raid_progress" for select to "claude_readers" using (true);

-- Shared reference data, same as items/classes_specs -- public read only, no
-- authenticated write rule at all (only a service-role sync or a manual SQL
-- Editor edit ever touches these two).
create policy "Public read raid_zones" on "public"."raid_zones" for select using (true);
create policy "Public read raid_encounters" on "public"."raid_encounters" for select using (true);

create policy "Public read team_raid_progress" on "public"."team_raid_progress" for select using (true);

-- Lets an officer manually correct a row the sync got wrong; the sync itself
-- writes via the service role and never hits this rule.
create policy "Officers write team_raid_progress" on "public"."team_raid_progress"
    using (("public"."my_team_role"("team_id") = any (array['officer'::text, 'team_leader'::text])))
    with check (("public"."my_team_role"("team_id") = any (array['officer'::text, 'team_leader'::text])));
