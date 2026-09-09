-- #290: per-section "profile last updated" signals.
--
-- self_received_requests gets a generic updated_at (same pattern as every
-- other request table from #266/#272) since it has none today. Fires on
-- insert too, not just update: submit_self_received() auto-approves most
-- requests in the same insert that creates the row (no follow-up officer
-- update at all), and that auto-approved self-mark is exactly the BiS List
-- activity this signal exists to catch -- an update-only trigger would miss
-- the common case entirely and only ever fire on the rarer officer
-- approve/reject of a request that needed review.
--
-- players.bis_link gets its OWN dedicated column rather than reusing the
-- generic players.updated_at, which already bumps on unrelated officer
-- edits (bench/trial toggles, etc.) and would make the signal meaningless.
-- The trigger is scoped to "update of bis_link" for the same reason -- a
-- blanket "before update" would overwrite this column on every player edit.
-- No insert case to worry about here: a bis_link change is always an update
-- against an existing players row, never an insert.

alter table "public"."self_received_requests" add column "updated_at" timestamptz;

create trigger "trg_self_received_requests_updated_at"
    before insert or update on "public"."self_received_requests"
    for each row execute function "public"."set_updated_at"();

alter table "public"."players" add column "bis_link_updated_at" timestamptz;

create trigger "trg_players_bis_link_updated_at"
    before update of "bis_link" on "public"."players"
    for each row execute function "public"."set_updated_at"();
