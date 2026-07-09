-- Backfill historical audit_log.detail to the summary-string convention
-- (#377, split from #215).
--
-- The Stage C import (scripts/import/tables/audit.js, #320) wrote the raw
-- {target, from, to, changed_by} shape into detail for every historical row.
-- write_audit_log() (#214) and the upcoming Audit Log tab rewire (#378) both
-- expect detail to be a single human-readable summary string instead.
--
-- Map reconciled against every appendAuditLog() call site in gs/wgaWebApp.gs
-- and the full distinct-action list actually present in production
-- (see #377 for the worked-out reasoning per action). Two corrections made
-- against the map as originally proposed in #215's comments:
--   - Trial/Bench Status Changed store 'to'/'from' as the literal strings
--     "TRUE"/"FALSE" (from the sheet's boolean cell format), not booleans.
--   - Officer Granted/Revoked's 'to' is a raw Discord snowflake id, not a
--     human-readable value -- TARGET (the username) already carries the
--     meaningful part, so these fall into the empty-detail bucket instead
--     of "use TO directly".
--
-- Scoped to jsonb_typeof(detail) = 'object': every row this backfill should
-- touch still has the legacy shape; a row already converted (a plain jsonb
-- string) has typeof 'string' and is left alone, making this safe to rerun.
-- Historical detail.changed_by (a free-text Discord username, not an
-- auth.users link -- actor_id is null on every one of these rows and stays
-- that way) is intentionally dropped: these rows were never going to
-- resolve a CHANGED BY through resolve_actor_name() (#376) either way, and
-- the parent issue's brief was explicit that no schema change should carry
-- it forward.
update public.audit_log
set detail = to_jsonb(
  case
    -- Both FROM and TO drive the summary.
    when action = 'Trial Status Changed' then
      case when upper(detail ->> 'to') = 'TRUE' then 'Trial added' else 'Trial removed' end
    when action = 'Bench Status Changed' then
      case when upper(detail ->> 'to') = 'TRUE' then 'Moved to bench' else 'Removed from bench' end
    when action in ('Spec Changed', 'Class Changed', 'Role Changed', 'Join Date Changed') then
      'Changed to ' || (detail ->> 'to')
    when action = 'Attendance Status Set' then
      (detail ->> 'from') || ' -> ' || (detail ->> 'to')
    when action = 'Player Renamed' then
      'Renamed to ' || (detail ->> 'to')
    when action = 'Officer Note Changed' then
      'Note updated'
    when action = 'BiS Approved' then
      'Approved'
    when action = 'BiS Link Updated' then
      'Link updated'

    -- A literal fallback when the optional note is blank -- the action name
    -- itself is the meaningful summary in that case, not an empty string.
    when action = 'M+ Exclusion Approved' then
      coalesce(nullif(detail ->> 'to', ''), 'Approved')
    when action = 'M+ Exclusion Rejected' then
      coalesce(nullif(detail ->> 'to', ''), 'Rejected')

    -- TO already reads as a natural summary -- use it directly. Priority
    -- Order Saved's difficulty is interpolated into the action name itself,
    -- hence the LIKE.
    when action in (
      'Attendance Refreshed (WCL)', 'Attendance Scores Committed', 'WCL Performance Refreshed',
      'Manual Score Set', 'Performance Scores Committed', 'Season Start Set', 'Season Name Set',
      'Season End Set', 'Trial Thresholds Set', 'Raid Progression Saved', 'Season Archived',
      'Season Unarchived', 'Admin: Bot URL Updated', 'Admin: Bot Secret Updated',
      'Loot Marked Received (self)', 'Loot Marked Received', 'Self-Received Approved',
      'Self-Received Rejected', 'BiS List Updated', 'Player Added',
      'Main Swap: Old Character Removed', 'Discord Claim Created'
    ) or action like 'Priority Order Saved (%' then
      nullif(detail ->> 'to', '')

    -- Nothing meaningful to add beyond ACTION + TARGET: either explicitly
    -- empty in the original design (#215), or found empty of FROM/TO during
    -- the #377 reconciliation against real production rows, or (Officer
    -- Granted/Revoked) reclassified because TO isn't human-readable.
    else null
  end
)
where jsonb_typeof(detail) = 'object';
