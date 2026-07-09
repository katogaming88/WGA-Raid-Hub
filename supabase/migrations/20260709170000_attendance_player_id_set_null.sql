-- Reconcile attendance.player_id's FK to ON DELETE SET NULL (#218).
--
-- #250 decided this exact change ("Changed attendance.player_id to ON DELETE
-- SET NULL (was CASCADE), matching rclc_loot") but the baseline schema dump
-- still shows ON DELETE CASCADE here -- it was never carried into a
-- migration. Soft-delete via players.archived_at (#258) is the only path
-- roster removal takes today (#216 ported "remove player" to an archive,
-- not a hard delete), so this FK only matters if a players row is ever
-- hard-deleted directly (e.g. manual SQL Editor cleanup): without this fix,
-- that would silently cascade-delete the player's entire attendance history
-- instead of leaving it attributable-to-nobody, the way rclc_loot already
-- behaves. check_team_id_matches_player() already guards on
-- "new.player_id is not null", so making the column nullable doesn't
-- break that trigger.
alter table public.attendance alter column player_id drop not null;

alter table public.attendance
  drop constraint attendance_player_id_fkey,
  add constraint attendance_player_id_fkey
    foreign key (player_id) references public.players(id) on delete set null;
