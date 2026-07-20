-- #515 Phase 1: raider wishlist. One row per player+item(+slot override)
-- holding a self-reported priority tier (bis/good/ok/catalyst/pass), so
-- raiders can flag backups and "don't want" items that bis_items (one
-- officer-curated pick per slot) has no way to express.

create table "public"."item_preferences" (
    "id" serial primary key,
    "team_id" integer not null references "public"."teams"("id") on delete cascade,
    "player_id" integer not null references "public"."players"("id") on delete cascade,
    "item_id" integer not null references "public"."items"("id") on delete cascade,
    "status" text not null check (status = any (array['bis', 'good', 'ok', 'catalyst', 'pass'])),
    "note" text,
    "slot" text,
    "updated_at" timestamp with time zone,
    "created_at" timestamp with time zone not null default now()
);

alter table "public"."item_preferences" owner to "postgres";

-- Mirrors bis_items_slot_override.sql: the M+/Crafted/Catalyst placeholder
-- rows in items are shared across every gear slot, so a raider needs to be
-- able to tag the same placeholder item once per slot (e.g. M+ = BiS for
-- Ring, M+ = Good for Neck) without colliding on (player_id, item_id) alone.
create unique index "item_preferences_no_dupe_item_key"
    on "public"."item_preferences" ("player_id", "item_id", coalesce("slot", ''));

alter table "public"."item_preferences" enable row level security;

create trigger "trg_item_preferences_team_id_check"
    before insert or update on "public"."item_preferences"
    for each row execute function "public"."check_team_id_matches_player"();

create trigger "trg_item_preferences_updated_at"
    before update on "public"."item_preferences"
    for each row execute function "public"."set_updated_at"();

create policy "Claude readers read item_preferences" on "public"."item_preferences"
    for select to "claude_readers" using (true);

-- No "Public read" policy, unlike bis_items/streamers -- wishlist tags are
-- more personal/opinionated (e.g. "Pass" on a guildmate's item), so this
-- deliberately stays team-private: raiders see only their own rows, officers
-- see everyone's, no world-visible read.
create policy "Raiders manage own item_preferences" on "public"."item_preferences"
    using ("public"."is_own_player"("player_id"))
    with check ("public"."is_own_player"("player_id"));

-- 'officer'/'team_leader' only -- team_members.role never holds 'admin'
-- (see streamers.sql's note on the same mistake being caught pre-production).
create policy "Officers read item_preferences" on "public"."item_preferences"
    for select
    using (("public"."my_team_role"("team_id") = any (array['officer'::text, 'team_leader'::text])));

grant select, insert, update, delete on table "public"."item_preferences" to "authenticated";
grant select on table "public"."item_preferences" to "claude_readers";
