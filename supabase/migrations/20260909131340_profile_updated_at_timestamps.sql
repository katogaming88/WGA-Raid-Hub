-- #290: per-section "profile last updated" signals.
--
-- self_received_requests gets a generic updated_at (same pattern as every
-- other request table from #266/#272) since it has none today.
--
-- players.bis_link gets its OWN dedicated column rather than reusing the
-- generic players.updated_at, which already bumps on unrelated officer
-- edits (bench/trial toggles, etc.) and would make the signal meaningless.
-- The trigger is scoped to "update of bis_link" for the same reason -- a
-- blanket "before update" would overwrite this column on every player edit.

alter table "public"."self_received_requests" add column "updated_at" timestamptz;

create trigger "trg_self_received_requests_updated_at"
    before update on "public"."self_received_requests"
    for each row execute function "public"."set_updated_at"();

alter table "public"."players" add column "bis_link_updated_at" timestamptz;

create trigger "trg_players_bis_link_updated_at"
    before update of "bis_link" on "public"."players"
    for each row execute function "public"."set_updated_at"();
