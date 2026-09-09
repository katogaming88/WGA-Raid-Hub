-- #290 follow-up: 20260909131340's trg_self_received_requests_updated_at
-- only fired "before update", already applied to prod before the gap was
-- caught. submit_self_received() auto-approves most requests in the same
-- insert that creates the row -- no follow-up officer update at all -- and
-- that auto-approved self-mark is exactly the BiS List activity the signal
-- exists to catch. An update-only trigger silently missed the common case
-- and would only ever fire on the rarer officer approve/reject of a request
-- that needed review.
--
-- Rows self-marked and auto-approved before this migration runs keep
-- updated_at null (never touched by this trigger); this only changes
-- behavior for rows created or updated from here on, matching #266's
-- "never touched stays distinguishable from touched at time X" rule rather
-- than backfilling a value nothing observed at insert time.

drop trigger "trg_self_received_requests_updated_at" on "public"."self_received_requests";

create trigger "trg_self_received_requests_updated_at"
    before insert or update on "public"."self_received_requests"
    for each row execute function "public"."set_updated_at"();
