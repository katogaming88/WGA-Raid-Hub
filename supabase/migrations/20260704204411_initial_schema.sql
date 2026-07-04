


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."check_team_id_matches_player"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.player_id is not null then
    if new.team_id != (select team_id from players where id = new.player_id) then
      raise exception 'team_id % does not match players.team_id for player_id %',
        new.team_id, new.player_id;
    end if;
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."check_team_id_matches_player"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_site_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from site_admins
    where auth_user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_site_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."link_auth_user_to_member"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update team_members
  set auth_user_id = new.id
  where discord_id = new.raw_user_meta_data ->> 'provider_id'
    and auth_user_id is null;
  
  update site_admins
  set auth_user_id = new.id
  where discord_id = new.raw_user_meta_data ->> 'provider_id'
    and auth_user_id is null;
  
  return new;
end;
$$;


ALTER FUNCTION "public"."link_auth_user_to_member"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_team_role"("p_team_id" integer) RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select role
  from team_members
  where team_id = p_team_id
    and auth_user_id = auth.uid()
  limit 1;
  $$;


ALTER FUNCTION "public"."my_team_role"("p_team_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end $$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."attendance" (
    "id" integer NOT NULL,
    "team_id" integer NOT NULL,
    "player_id" integer NOT NULL,
    "raid_date" "date" NOT NULL,
    "status" "text" DEFAULT 'Present'::"text" NOT NULL,
    "report_excluded" boolean DEFAULT false NOT NULL,
    "report_id" "text",
    CONSTRAINT "attendance_status_check" CHECK (("status" = ANY (ARRAY['Present'::"text", 'Bench'::"text", 'Medical Leave'::"text", 'Excused'::"text", 'Extended Leave'::"text", 'No Show'::"text", 'Not on Roster'::"text"])))
);


ALTER TABLE "public"."attendance" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."attendance_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."attendance_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."attendance_id_seq" OWNED BY "public"."attendance"."id";



CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" integer NOT NULL,
    "team_id" integer NOT NULL,
    "actor_id" "uuid",
    "action" "text" NOT NULL,
    "target_type" "text",
    "target_id" integer,
    "detail" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."audit_log_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."audit_log_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."audit_log_id_seq" OWNED BY "public"."audit_log"."id";



CREATE TABLE IF NOT EXISTS "public"."bis_items" (
    "id" integer NOT NULL,
    "player_id" integer NOT NULL,
    "item_id" integer NOT NULL,
    "obtained" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."bis_items" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."bis_items_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."bis_items_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."bis_items_id_seq" OWNED BY "public"."bis_items"."id";



CREATE TABLE IF NOT EXISTS "public"."bis_requests" (
    "id" integer NOT NULL,
    "team_id" integer NOT NULL,
    "player_id" integer,
    "bis_req_item_id" integer NOT NULL,
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    CONSTRAINT "bis_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."bis_requests" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."bis_requests_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."bis_requests_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."bis_requests_id_seq" OWNED BY "public"."bis_requests"."id";



CREATE TABLE IF NOT EXISTS "public"."classes_specs" (
    "id" integer NOT NULL,
    "class" "text" NOT NULL,
    "spec" "text" NOT NULL,
    "role" "text",
    CONSTRAINT "classes_specs_role_check" CHECK (("role" = ANY (ARRAY['Tank'::"text", 'Heal'::"text", 'Melee'::"text", 'Ranged'::"text"])))
);


ALTER TABLE "public"."classes_specs" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."classes_specs_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."classes_specs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."classes_specs_id_seq" OWNED BY "public"."classes_specs"."id";



CREATE TABLE IF NOT EXISTS "public"."item_bosses" (
    "item_id" integer NOT NULL,
    "boss" "text" NOT NULL
);


ALTER TABLE "public"."item_bosses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."items" (
    "id" integer NOT NULL,
    "wow_item_id" integer,
    "name" "text" NOT NULL,
    "slot" "text" NOT NULL,
    "armor_type" "text",
    "sort_id" integer,
    "is_placeholder" boolean DEFAULT false NOT NULL,
    CONSTRAINT "items_armor_type_check" CHECK (("armor_type" = ANY (ARRAY['Plate'::"text", 'Mail'::"text", 'Leather'::"text", 'Cloth'::"text"])))
);


ALTER TABLE "public"."items" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."items_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."items_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."items_id_seq" OWNED BY "public"."items"."id";



CREATE TABLE IF NOT EXISTS "public"."rclc_loot" (
    "id" integer NOT NULL,
    "team_id" integer NOT NULL,
    "player_id" integer,
    "item_id" integer,
    "difficulty" "text",
    "season" "text",
    "awarded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "rclc_id" "text",
    "dedupe_key" "text",
    "boss" "text",
    CONSTRAINT "loot_difficulty_check" CHECK (("difficulty" = ANY (ARRAY['Champion'::"text", 'Heroic'::"text", 'Mythic'::"text"])))
);


ALTER TABLE "public"."rclc_loot" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."loot_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."loot_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."loot_id_seq" OWNED BY "public"."rclc_loot"."id";



CREATE TABLE IF NOT EXISTS "public"."mplus_exclusion_requests" (
    "id" integer NOT NULL,
    "team_id" integer NOT NULL,
    "player_id" integer NOT NULL,
    "reason" "text",
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "raiderio_url" "text",
    "officer_notes" "text",
    "updated_at" timestamp with time zone,
    CONSTRAINT "mplus_exclusion_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."mplus_exclusion_requests" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."mplus_exclusion_requests_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."mplus_exclusion_requests_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."mplus_exclusion_requests_id_seq" OWNED BY "public"."mplus_exclusion_requests"."id";



CREATE TABLE IF NOT EXISTS "public"."player_wcl_season_perf" (
    "id" integer NOT NULL,
    "player_id" integer NOT NULL,
    "team_id" integer NOT NULL,
    "season" "text" NOT NULL,
    "best_perf_avg" numeric,
    "median_perf_avg" numeric,
    "fetched_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."player_wcl_season_perf" OWNER TO "postgres";


ALTER TABLE "public"."player_wcl_season_perf" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."player_wcl_season_perf_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."players" (
    "id" integer NOT NULL,
    "team_id" integer NOT NULL,
    "name_realm" "text" NOT NULL,
    "class_spec_id" integer,
    "is_trial" boolean DEFAULT false NOT NULL,
    "is_bench" boolean DEFAULT false NOT NULL,
    "nickname" "text",
    "bis_link" "text",
    "join_date" "date",
    "m_plus_excluded" boolean DEFAULT false NOT NULL,
    "m_plus_note" "text",
    "team_member_id" integer,
    "archived_at" timestamp with time zone,
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."players" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."players_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."players_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."players_id_seq" OWNED BY "public"."players"."id";



CREATE TABLE IF NOT EXISTS "public"."priority_order" (
    "id" integer NOT NULL,
    "team_id" integer NOT NULL,
    "season" "text" NOT NULL,
    "item_id" integer NOT NULL,
    "difficulty" "text" NOT NULL,
    "rank" integer NOT NULL,
    "player_id" integer NOT NULL,
    "updated_at" timestamp with time zone,
    CONSTRAINT "priority_order_difficulty_check" CHECK (("difficulty" = ANY (ARRAY['Heroic'::"text", 'Mythic'::"text"])))
);


ALTER TABLE "public"."priority_order" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."priority_order_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."priority_order_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."priority_order_id_seq" OWNED BY "public"."priority_order"."id";



CREATE TABLE IF NOT EXISTS "public"."scoring" (
    "id" integer NOT NULL,
    "player_id" integer NOT NULL,
    "recent_score" numeric,
    "trend_score" numeric,
    "best_score" numeric,
    "performance_score" numeric,
    "attendance_score" numeric,
    "attendance_pct" numeric,
    "season" "text" NOT NULL,
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."scoring" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."scoring_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."scoring_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."scoring_id_seq" OWNED BY "public"."scoring"."id";



CREATE TABLE IF NOT EXISTS "public"."season_signups" (
    "id" integer NOT NULL,
    "team_id" integer NOT NULL,
    "signup_name_realm" "text" NOT NULL,
    "class_spec_id" integer,
    "off_specs" "text",
    "main_swap" boolean DEFAULT false NOT NULL,
    "player_note" "text",
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "swap_class_spec_id" integer,
    "season" "text",
    "reviewed_at" timestamp with time zone,
    "reviewed_by" integer,
    "signup_officer_note" "text",
    "approved_player_id" integer,
    "updated_at" timestamp with time zone,
    CONSTRAINT "season_signups_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text", 'added'::"text"])))
);


ALTER TABLE "public"."season_signups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."season_snapshots" (
    "id" integer NOT NULL,
    "team_id" integer NOT NULL,
    "season" "text" NOT NULL,
    "snapped_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "data" "jsonb" NOT NULL
);


ALTER TABLE "public"."season_snapshots" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."season_snapshots_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."season_snapshots_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."season_snapshots_id_seq" OWNED BY "public"."season_snapshots"."id";



CREATE TABLE IF NOT EXISTS "public"."self_received_requests" (
    "id" integer NOT NULL,
    "team_id" integer NOT NULL,
    "player_id" integer,
    "self_item_id" integer NOT NULL,
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    CONSTRAINT "self_received_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."self_received_requests" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."self_received_requests_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."self_received_requests_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."self_received_requests_id_seq" OWNED BY "public"."self_received_requests"."id";



CREATE SEQUENCE IF NOT EXISTS "public"."signups_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."signups_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."signups_id_seq" OWNED BY "public"."season_signups"."id";



CREATE TABLE IF NOT EXISTS "public"."site_admins" (
    "id" integer NOT NULL,
    "discord_id" "text" NOT NULL,
    "auth_user_id" "uuid"
);


ALTER TABLE "public"."site_admins" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."site_admins_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."site_admins_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."site_admins_id_seq" OWNED BY "public"."site_admins"."id";



CREATE TABLE IF NOT EXISTS "public"."team_members" (
    "id" integer NOT NULL,
    "team_id" integer NOT NULL,
    "discord_id" "text" NOT NULL,
    "auth_user_id" "uuid",
    "role" "text" NOT NULL,
    "name_realm" "text",
    CONSTRAINT "team_members_role_check" CHECK (("role" = ANY (ARRAY['raider'::"text", 'officer'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."team_members" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."team_members_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."team_members_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."team_members_id_seq" OWNED BY "public"."team_members"."id";



CREATE TABLE IF NOT EXISTS "public"."team_settings" (
    "team_id" integer NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."team_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."teams" (
    "id" integer NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL
);


ALTER TABLE "public"."teams" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."teams_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."teams_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."teams_id_seq" OWNED BY "public"."teams"."id";



ALTER TABLE ONLY "public"."attendance" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."attendance_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."audit_log" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."audit_log_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."bis_items" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."bis_items_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."bis_requests" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."bis_requests_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."classes_specs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."classes_specs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."items" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."items_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."mplus_exclusion_requests" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."mplus_exclusion_requests_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."players" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."players_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."priority_order" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."priority_order_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."rclc_loot" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."loot_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."scoring" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."scoring_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."season_signups" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."signups_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."season_snapshots" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."season_snapshots_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."self_received_requests" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."self_received_requests_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."site_admins" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."site_admins_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."team_members" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."team_members_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."teams" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."teams_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_team_id_player_id_raid_date_key" UNIQUE ("team_id", "player_id", "raid_date");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bis_items"
    ADD CONSTRAINT "bis_items_no_dupe_item_key" UNIQUE ("player_id", "item_id");



ALTER TABLE ONLY "public"."bis_items"
    ADD CONSTRAINT "bis_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bis_requests"
    ADD CONSTRAINT "bis_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."classes_specs"
    ADD CONSTRAINT "classes_specs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."item_bosses"
    ADD CONSTRAINT "item_bosses_pkey" PRIMARY KEY ("item_id", "boss");



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rclc_loot"
    ADD CONSTRAINT "loot_dedupe_key_key" UNIQUE ("dedupe_key");



ALTER TABLE ONLY "public"."rclc_loot"
    ADD CONSTRAINT "loot_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mplus_exclusion_requests"
    ADD CONSTRAINT "mplus_exclusion_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."player_wcl_season_perf"
    ADD CONSTRAINT "player_wcl_season_perf_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."player_wcl_season_perf"
    ADD CONSTRAINT "player_wcl_season_perf_player_id_season_key" UNIQUE ("player_id", "season");



ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "players_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "players_team_id_name_realm_key" UNIQUE ("team_id", "name_realm");



ALTER TABLE ONLY "public"."priority_order"
    ADD CONSTRAINT "priority_order_no_dupe_player_key" UNIQUE ("team_id", "season", "item_id", "difficulty", "player_id");



ALTER TABLE ONLY "public"."priority_order"
    ADD CONSTRAINT "priority_order_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."priority_order"
    ADD CONSTRAINT "priority_order_team_id_season_item_difficulty_rank_key" UNIQUE ("team_id", "season", "item_id", "difficulty", "rank");



ALTER TABLE ONLY "public"."scoring"
    ADD CONSTRAINT "scoring_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scoring"
    ADD CONSTRAINT "scoring_player_id_season_key" UNIQUE ("player_id", "season");



ALTER TABLE ONLY "public"."season_snapshots"
    ADD CONSTRAINT "season_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."season_snapshots"
    ADD CONSTRAINT "season_snapshots_team_id_season_key" UNIQUE ("team_id", "season");



ALTER TABLE ONLY "public"."self_received_requests"
    ADD CONSTRAINT "self_received_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_settings"
    ADD CONSTRAINT "settings_pkey" PRIMARY KEY ("team_id");



ALTER TABLE ONLY "public"."season_signups"
    ADD CONSTRAINT "signups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."site_admins"
    ADD CONSTRAINT "site_admins_discord_id_key" UNIQUE ("discord_id");



ALTER TABLE ONLY "public"."site_admins"
    ADD CONSTRAINT "site_admins_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_team_id_discord_id_key" UNIQUE ("team_id", "discord_id");



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."classes_specs"
    ADD CONSTRAINT "unique_spec_key" UNIQUE ("class", "spec");



CREATE UNIQUE INDEX "mplus_excl_one_pending_per_player" ON "public"."mplus_exclusion_requests" USING "btree" ("player_id") WHERE ("status" = 'pending'::"text");



CREATE OR REPLACE TRIGGER "trg_attendance_team_id_check" BEFORE INSERT OR UPDATE ON "public"."attendance" FOR EACH ROW EXECUTE FUNCTION "public"."check_team_id_matches_player"();



CREATE OR REPLACE TRIGGER "trg_bis_items_updated_at" BEFORE UPDATE ON "public"."bis_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_bis_requests_team_id_check" BEFORE INSERT OR UPDATE ON "public"."bis_requests" FOR EACH ROW EXECUTE FUNCTION "public"."check_team_id_matches_player"();



CREATE OR REPLACE TRIGGER "trg_mplus_exclusion_requests_team_id_check" BEFORE INSERT OR UPDATE ON "public"."mplus_exclusion_requests" FOR EACH ROW EXECUTE FUNCTION "public"."check_team_id_matches_player"();



CREATE OR REPLACE TRIGGER "trg_mplus_exclusion_requests_updated_at" BEFORE UPDATE ON "public"."mplus_exclusion_requests" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_players_updated_at" BEFORE UPDATE ON "public"."players" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_priority_order_updated_at" BEFORE UPDATE ON "public"."priority_order" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_rclc_loot_team_id_check" BEFORE INSERT OR UPDATE ON "public"."rclc_loot" FOR EACH ROW EXECUTE FUNCTION "public"."check_team_id_matches_player"();



CREATE OR REPLACE TRIGGER "trg_scoring_updated_at" BEFORE UPDATE ON "public"."scoring" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_season_signups_updated_at" BEFORE UPDATE ON "public"."season_signups" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_self_received_requests_team_id_check" BEFORE INSERT OR UPDATE ON "public"."self_received_requests" FOR EACH ROW EXECUTE FUNCTION "public"."check_team_id_matches_player"();



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bis_items"
    ADD CONSTRAINT "bis_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bis_items"
    ADD CONSTRAINT "bis_items_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bis_requests"
    ADD CONSTRAINT "bis_requests_bis_req_item_id_fkey" FOREIGN KEY ("bis_req_item_id") REFERENCES "public"."items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bis_requests"
    ADD CONSTRAINT "bis_requests_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bis_requests"
    ADD CONSTRAINT "bis_requests_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."item_bosses"
    ADD CONSTRAINT "item_bosses_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rclc_loot"
    ADD CONSTRAINT "loot_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."rclc_loot"
    ADD CONSTRAINT "loot_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."rclc_loot"
    ADD CONSTRAINT "loot_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mplus_exclusion_requests"
    ADD CONSTRAINT "mplus_exclusion_requests_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mplus_exclusion_requests"
    ADD CONSTRAINT "mplus_exclusion_requests_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_wcl_season_perf"
    ADD CONSTRAINT "player_wcl_season_perf_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_wcl_season_perf"
    ADD CONSTRAINT "player_wcl_season_perf_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "players_class_spec_id_fkey" FOREIGN KEY ("class_spec_id") REFERENCES "public"."classes_specs"("id") ON UPDATE CASCADE;



ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "players_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "players_team_member_id_fkey" FOREIGN KEY ("team_member_id") REFERENCES "public"."team_members"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."priority_order"
    ADD CONSTRAINT "priority_order_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id");



ALTER TABLE ONLY "public"."priority_order"
    ADD CONSTRAINT "priority_order_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."priority_order"
    ADD CONSTRAINT "priority_order_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."scoring"
    ADD CONSTRAINT "scoring_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."season_signups"
    ADD CONSTRAINT "season_signups_approved_player_id_fkey" FOREIGN KEY ("approved_player_id") REFERENCES "public"."players"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."season_signups"
    ADD CONSTRAINT "season_signups_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."team_members"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."season_signups"
    ADD CONSTRAINT "season_signups_swap_class_spec_id_fkey" FOREIGN KEY ("swap_class_spec_id") REFERENCES "public"."classes_specs"("id") ON UPDATE CASCADE;



ALTER TABLE ONLY "public"."season_snapshots"
    ADD CONSTRAINT "season_snapshots_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."self_received_requests"
    ADD CONSTRAINT "self_received_requests_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."self_received_requests"
    ADD CONSTRAINT "self_received_requests_self_item_id_fkey" FOREIGN KEY ("self_item_id") REFERENCES "public"."items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."self_received_requests"
    ADD CONSTRAINT "self_received_requests_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_settings"
    ADD CONSTRAINT "settings_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."season_signups"
    ADD CONSTRAINT "signups_class_spec_id_fkey" FOREIGN KEY ("class_spec_id") REFERENCES "public"."classes_specs"("id") ON UPDATE CASCADE;



ALTER TABLE ONLY "public"."season_signups"
    ADD CONSTRAINT "signups_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."site_admins"
    ADD CONSTRAINT "site_admins_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



CREATE POLICY "Admins write season_snapshots" ON "public"."season_snapshots" USING ((("public"."my_team_role"("team_id") = 'admin'::"text") OR "public"."is_site_admin"())) WITH CHECK ((("public"."my_team_role"("team_id") = 'admin'::"text") OR "public"."is_site_admin"()));



CREATE POLICY "Admins write settings" ON "public"."team_settings" USING ((("public"."my_team_role"("team_id") = 'admin'::"text") OR "public"."is_site_admin"())) WITH CHECK ((("public"."my_team_role"("team_id") = 'admin'::"text") OR "public"."is_site_admin"()));



CREATE POLICY "Admins write team_members" ON "public"."team_members" USING ((("public"."my_team_role"("team_id") = 'admin'::"text") OR "public"."is_site_admin"())) WITH CHECK ((("public"."my_team_role"("team_id") = 'admin'::"text") OR "public"."is_site_admin"()));



CREATE POLICY "Claude readers read attendance" ON "public"."attendance" FOR SELECT TO "claude_readers" USING (true);



CREATE POLICY "Claude readers read audit_log" ON "public"."audit_log" FOR SELECT TO "claude_readers" USING (true);



CREATE POLICY "Claude readers read bis_items" ON "public"."bis_items" FOR SELECT TO "claude_readers" USING (true);



CREATE POLICY "Claude readers read bis_requests" ON "public"."bis_requests" FOR SELECT TO "claude_readers" USING (true);



CREATE POLICY "Claude readers read classes_specs" ON "public"."classes_specs" FOR SELECT TO "claude_readers" USING (true);



CREATE POLICY "Claude readers read item_bosses" ON "public"."item_bosses" FOR SELECT TO "claude_readers" USING (true);



CREATE POLICY "Claude readers read items" ON "public"."items" FOR SELECT TO "claude_readers" USING (true);



CREATE POLICY "Claude readers read mplus_exclusion_requests" ON "public"."mplus_exclusion_requests" FOR SELECT TO "claude_readers" USING (true);



CREATE POLICY "Claude readers read player_wcl_season_perf" ON "public"."player_wcl_season_perf" FOR SELECT TO "claude_readers" USING (true);



CREATE POLICY "Claude readers read players" ON "public"."players" FOR SELECT TO "claude_readers" USING (true);



CREATE POLICY "Claude readers read priority_order" ON "public"."priority_order" FOR SELECT TO "claude_readers" USING (true);



CREATE POLICY "Claude readers read rclc_loot" ON "public"."rclc_loot" FOR SELECT TO "claude_readers" USING (true);



CREATE POLICY "Claude readers read scoring" ON "public"."scoring" FOR SELECT TO "claude_readers" USING (true);



CREATE POLICY "Claude readers read season_signups" ON "public"."season_signups" FOR SELECT TO "claude_readers" USING (true);



CREATE POLICY "Claude readers read season_snapshots" ON "public"."season_snapshots" FOR SELECT TO "claude_readers" USING (true);



CREATE POLICY "Claude readers read self_received_requests" ON "public"."self_received_requests" FOR SELECT TO "claude_readers" USING (true);



CREATE POLICY "Claude readers read site_admins" ON "public"."site_admins" FOR SELECT TO "claude_readers" USING (true);



CREATE POLICY "Claude readers read team_members" ON "public"."team_members" FOR SELECT TO "claude_readers" USING (true);



CREATE POLICY "Claude readers read team_settings" ON "public"."team_settings" FOR SELECT TO "claude_readers" USING (true);



CREATE POLICY "Claude readers read teams" ON "public"."teams" FOR SELECT TO "claude_readers" USING (true);



CREATE POLICY "Officer write loot" ON "public"."rclc_loot" USING (("public"."my_team_role"("team_id") = ANY (ARRAY['officer'::"text", 'admin'::"text"]))) WITH CHECK (("public"."my_team_role"("team_id") = ANY (ARRAY['officer'::"text", 'admin'::"text"])));



CREATE POLICY "Officers read audit_log" ON "public"."audit_log" FOR SELECT USING ((("public"."my_team_role"("team_id") = ANY (ARRAY['officer'::"text", 'admin'::"text"])) OR "public"."is_site_admin"()));



CREATE POLICY "Officers read bis_requests" ON "public"."bis_requests" FOR SELECT USING (("public"."my_team_role"("team_id") = ANY (ARRAY['officer'::"text", 'admin'::"text"])));



CREATE POLICY "Officers read mplus_exclusion_requests" ON "public"."mplus_exclusion_requests" FOR SELECT USING (("public"."my_team_role"("team_id") = ANY (ARRAY['officer'::"text", 'admin'::"text"])));



CREATE POLICY "Officers read own team_members" ON "public"."team_members" FOR SELECT USING ((("public"."my_team_role"("team_id") = ANY (ARRAY['officer'::"text", 'admin'::"text"])) OR "public"."is_site_admin"()));



CREATE POLICY "Officers read self_received_requests" ON "public"."self_received_requests" FOR SELECT USING (("public"."my_team_role"("team_id") = ANY (ARRAY['officer'::"text", 'admin'::"text"])));



CREATE POLICY "Officers read signups" ON "public"."season_signups" FOR SELECT USING (("public"."my_team_role"("team_id") = ANY (ARRAY['officer'::"text", 'admin'::"text"])));



CREATE POLICY "Officers update bis_requests" ON "public"."bis_requests" FOR UPDATE USING (("public"."my_team_role"("team_id") = ANY (ARRAY['officer'::"text", 'admin'::"text"]))) WITH CHECK (("public"."my_team_role"("team_id") = ANY (ARRAY['officer'::"text", 'admin'::"text"])));



CREATE POLICY "Officers update mplus_exclusion_requests" ON "public"."mplus_exclusion_requests" FOR UPDATE USING (("public"."my_team_role"("team_id") = ANY (ARRAY['officer'::"text", 'admin'::"text"]))) WITH CHECK (("public"."my_team_role"("team_id") = ANY (ARRAY['officer'::"text", 'admin'::"text"])));



CREATE POLICY "Officers update self_received_requests" ON "public"."self_received_requests" FOR UPDATE USING (("public"."my_team_role"("team_id") = ANY (ARRAY['officer'::"text", 'admin'::"text"]))) WITH CHECK (("public"."my_team_role"("team_id") = ANY (ARRAY['officer'::"text", 'admin'::"text"])));



CREATE POLICY "Officers update signups" ON "public"."season_signups" FOR UPDATE USING (("public"."my_team_role"("team_id") = ANY (ARRAY['officer'::"text", 'admin'::"text"]))) WITH CHECK (("public"."my_team_role"("team_id") = ANY (ARRAY['officer'::"text", 'admin'::"text"])));



CREATE POLICY "Officers write attendance" ON "public"."attendance" USING (("public"."my_team_role"("team_id") = ANY (ARRAY['officer'::"text", 'admin'::"text"]))) WITH CHECK (("public"."my_team_role"("team_id") = ANY (ARRAY['officer'::"text", 'admin'::"text"])));



CREATE POLICY "Officers write bis_items" ON "public"."bis_items" USING (("public"."my_team_role"(( SELECT "players"."team_id"
   FROM "public"."players"
  WHERE ("players"."id" = "bis_items"."player_id"))) = ANY (ARRAY['officer'::"text", 'admin'::"text"]))) WITH CHECK (("public"."my_team_role"(( SELECT "players"."team_id"
   FROM "public"."players"
  WHERE ("players"."id" = "bis_items"."player_id"))) = ANY (ARRAY['officer'::"text", 'admin'::"text"])));



CREATE POLICY "Officers write player_wcl_season_perf" ON "public"."player_wcl_season_perf" USING (("public"."my_team_role"("team_id") = ANY (ARRAY['officer'::"text", 'admin'::"text"]))) WITH CHECK (("public"."my_team_role"("team_id") = ANY (ARRAY['officer'::"text"])));



CREATE POLICY "Officers write players" ON "public"."players" USING (("public"."my_team_role"("team_id") = ANY (ARRAY['officer'::"text", 'admin'::"text"]))) WITH CHECK (("public"."my_team_role"("team_id") = ANY (ARRAY['officer'::"text", 'admin'::"text"])));



CREATE POLICY "Officers write priority_order" ON "public"."priority_order" USING (("public"."my_team_role"("team_id") = ANY (ARRAY['officer'::"text", 'admin'::"text"]))) WITH CHECK (("public"."my_team_role"("team_id") = ANY (ARRAY['officer'::"text", 'admin'::"text"])));



CREATE POLICY "Officers write scoring" ON "public"."scoring" USING (("public"."my_team_role"(( SELECT "players"."team_id"
   FROM "public"."players"
  WHERE ("players"."id" = "scoring"."player_id"))) = ANY (ARRAY['officer'::"text", 'admin'::"text"]))) WITH CHECK (("public"."my_team_role"(( SELECT "players"."team_id"
   FROM "public"."players"
  WHERE ("players"."id" = "scoring"."player_id"))) = ANY (ARRAY['officer'::"text", 'admin'::"text"])));



CREATE POLICY "Public read attendance" ON "public"."attendance" FOR SELECT USING (true);



CREATE POLICY "Public read bis_items" ON "public"."bis_items" FOR SELECT USING (true);



CREATE POLICY "Public read classes_specs" ON "public"."classes_specs" FOR SELECT USING (true);



CREATE POLICY "Public read item_bosses" ON "public"."item_bosses" FOR SELECT USING (true);



CREATE POLICY "Public read items" ON "public"."items" FOR SELECT USING (true);



CREATE POLICY "Public read loot" ON "public"."rclc_loot" FOR SELECT USING (true);



CREATE POLICY "Public read players" ON "public"."players" FOR SELECT USING (true);



CREATE POLICY "Public read priority_order" ON "public"."priority_order" FOR SELECT USING (true);



CREATE POLICY "Public read scoring" ON "public"."scoring" FOR SELECT USING (true);



CREATE POLICY "Public read season_snapshots" ON "public"."season_snapshots" FOR SELECT USING (true);



CREATE POLICY "Public read settings" ON "public"."team_settings" FOR SELECT USING (true);



CREATE POLICY "Public read teams" ON "public"."teams" FOR SELECT USING (true);



CREATE POLICY "Public reas player_wcl_season_perf" ON "public"."player_wcl_season_perf" FOR SELECT USING (true);



CREATE POLICY "Site Admins read site_admins" ON "public"."site_admins" FOR SELECT USING ("public"."is_site_admin"());



CREATE POLICY "Site Admins write site_admins" ON "public"."site_admins" USING ("public"."is_site_admin"()) WITH CHECK ("public"."is_site_admin"());



ALTER TABLE "public"."attendance" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bis_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bis_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."classes_specs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."item_bosses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mplus_exclusion_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_wcl_season_perf" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."players" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."priority_order" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rclc_loot" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."scoring" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."season_signups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."season_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."self_received_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."site_admins" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."teams" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
GRANT USAGE ON SCHEMA "public" TO "claude_readers";






















































































































































REVOKE ALL ON FUNCTION "public"."is_site_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_site_admin"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."link_auth_user_to_member"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."link_auth_user_to_member"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."my_team_role"("p_team_id" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_team_role"("p_team_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."my_team_role"("p_team_id" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."rls_auto_enable"() FROM PUBLIC;


















GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."attendance" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."attendance" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."attendance" TO "service_role";
GRANT SELECT ON TABLE "public"."attendance" TO "claude_readers";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_log" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_log" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_log" TO "service_role";
GRANT SELECT ON TABLE "public"."audit_log" TO "claude_readers";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bis_items" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bis_items" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bis_items" TO "service_role";
GRANT SELECT ON TABLE "public"."bis_items" TO "claude_readers";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bis_requests" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bis_requests" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bis_requests" TO "service_role";
GRANT SELECT ON TABLE "public"."bis_requests" TO "claude_readers";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."classes_specs" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."classes_specs" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."classes_specs" TO "service_role";
GRANT SELECT ON TABLE "public"."classes_specs" TO "claude_readers";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."item_bosses" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."item_bosses" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."item_bosses" TO "service_role";
GRANT SELECT ON TABLE "public"."item_bosses" TO "claude_readers";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."items" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."items" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."items" TO "service_role";
GRANT SELECT ON TABLE "public"."items" TO "claude_readers";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."rclc_loot" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."rclc_loot" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."rclc_loot" TO "service_role";
GRANT SELECT ON TABLE "public"."rclc_loot" TO "claude_readers";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."mplus_exclusion_requests" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."mplus_exclusion_requests" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."mplus_exclusion_requests" TO "service_role";
GRANT SELECT ON TABLE "public"."mplus_exclusion_requests" TO "claude_readers";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."player_wcl_season_perf" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."player_wcl_season_perf" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."player_wcl_season_perf" TO "service_role";
GRANT SELECT ON TABLE "public"."player_wcl_season_perf" TO "claude_readers";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."players" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."players" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."players" TO "service_role";
GRANT SELECT ON TABLE "public"."players" TO "claude_readers";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."priority_order" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."priority_order" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."priority_order" TO "service_role";
GRANT SELECT ON TABLE "public"."priority_order" TO "claude_readers";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."scoring" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."scoring" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."scoring" TO "service_role";
GRANT SELECT ON TABLE "public"."scoring" TO "claude_readers";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."season_signups" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."season_signups" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."season_signups" TO "service_role";
GRANT SELECT ON TABLE "public"."season_signups" TO "claude_readers";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."season_snapshots" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."season_snapshots" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."season_snapshots" TO "service_role";
GRANT SELECT ON TABLE "public"."season_snapshots" TO "claude_readers";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."self_received_requests" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."self_received_requests" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."self_received_requests" TO "service_role";
GRANT SELECT ON TABLE "public"."self_received_requests" TO "claude_readers";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."site_admins" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."site_admins" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."site_admins" TO "service_role";
GRANT SELECT ON TABLE "public"."site_admins" TO "claude_readers";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."team_members" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."team_members" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."team_members" TO "service_role";
GRANT SELECT ON TABLE "public"."team_members" TO "claude_readers";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."team_settings" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."team_settings" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."team_settings" TO "service_role";
GRANT SELECT ON TABLE "public"."team_settings" TO "claude_readers";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."teams" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."teams" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."teams" TO "service_role";
GRANT SELECT ON TABLE "public"."teams" TO "claude_readers";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT ON TABLES TO "claude_readers";



































