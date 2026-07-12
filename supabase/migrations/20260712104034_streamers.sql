-- #286: guild-wide Twitch streams. One streamer row per raider (player_id),
-- self-service from their own profile, guild-wide by default with opt-out.

create table "public"."streamers" (
    "id" serial primary key,
    "team_id" integer not null references "public"."teams"("id") on delete cascade,
    "player_id" integer not null references "public"."players"("id") on delete cascade,
    "twitch_channel" text not null,
    "schedule_note" text,
    "guild_wide_opt_out" boolean not null default false,
    "is_live" boolean not null default false,
    "last_checked_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "created_at" timestamp with time zone not null default now(),
    unique ("player_id")
);

alter table "public"."streamers" owner to "postgres";

alter table "public"."streamers" enable row level security;

create trigger "trg_streamers_team_id_check"
    before insert or update on "public"."streamers"
    for each row execute function "public"."check_team_id_matches_player"();

create trigger "trg_streamers_updated_at"
    before update on "public"."streamers"
    for each row execute function "public"."set_updated_at"();

-- First "raider owns this row" check in the schema -- every other write policy
-- so far is officer/admin-gated. Mirrors the my_team_role()/is_site_admin()
-- style so it can be reused by future self-service features (e.g. bis_link).
create or replace function "public"."is_own_player"("p_player_id" integer) returns boolean
    language "sql" stable security definer
    set "search_path" to 'public'
    as $$
  select exists (
    select 1
    from players p
    join team_members tm on tm.id = p.team_member_id
    where p.id = p_player_id
      and tm.auth_user_id = auth.uid()
  );
$$;

alter function "public"."is_own_player"(integer) owner to "postgres";

create policy "Claude readers read streamers" on "public"."streamers" for select to "claude_readers" using (true);

create policy "Public read streamers" on "public"."streamers" for select using (true);

create policy "Raiders manage own streamer" on "public"."streamers"
    using ("public"."is_own_player"("player_id"))
    with check ("public"."is_own_player"("player_id"));

create policy "Officers write streamers" on "public"."streamers"
    using (("public"."my_team_role"("team_id") = any (array['officer'::text, 'admin'::text])))
    with check (("public"."my_team_role"("team_id") = any (array['officer'::text, 'admin'::text])));
