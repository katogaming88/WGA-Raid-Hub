-- Attendance row provenance + friendly report title (#223, stage 3).
--
-- GAS's Attendance sheet distinguished WCL-populated rows from officer edits
-- via a "Source" column (WCL / Officer / Auto (Bench)) so a refresh could
-- overwrite auto-generated rows without clobbering an officer's manual
-- status. attendance has no equivalent yet -- source is what lets the new
-- refreshAttendance Edge Function action know which existing rows it's safe
-- to overwrite. Auto (Bench) rows are always recomputed fresh on refresh,
-- same as GAS never preserved them either.
--
-- report_title is a nullable per-row echo of the WCL report's title (same
-- denormalization style report_excluded/report_id already use on this
-- table), purely so the Attendance tab's night-selector can show something
-- more useful than a bare date -- it stays null for rows that predate this
-- migration or were never WCL-sourced (manual officer entries, Not on
-- Roster backfills), and the frontend falls back to the date in that case.
--
-- No new access rule needed: both columns live on attendance, already
-- covered by the existing "Officers write attendance"/"Public read
-- attendance" policies.

alter table public.attendance add column if not exists source text not null default 'Officer'
  check (source in ('WCL', 'Officer', 'Auto (Bench)'));
alter table public.attendance add column if not exists report_title text;
