-- #272: team_members and team_settings were dropped from the updated_at set
-- in #266 by accident; both are mutable (role changes, config edits). Add the
-- column and trigger to match the other six tables.
--
-- Deliberately nullable with no DEFAULT: these tables have no created-at
-- column, so updated_at stays NULL until the first real UPDATE. That keeps an
-- edited row distinguishable from a fresh insert (see #272 decision 2).

alter table "public"."team_members" add column "updated_at" timestamptz;
alter table "public"."team_settings" add column "updated_at" timestamptz;

create trigger "trg_team_members_updated_at"
    before update on "public"."team_members"
    for each row execute function "public"."set_updated_at"();

create trigger "trg_team_settings_updated_at"
    before update on "public"."team_settings"
    for each row execute function "public"."set_updated_at"();
