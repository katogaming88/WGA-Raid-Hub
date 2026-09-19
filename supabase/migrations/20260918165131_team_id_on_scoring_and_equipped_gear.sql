-- #944: team_id on scoring and player_equipped_gear, and the guard trigger on
-- every table that carries team_id beside player_id.
--
-- The two tables were the last ones keyed by player alone, so a team-wide
-- read of either had to join through players, the shape the #694 row-cap
-- sweep came from, and the static check on team-wide reads cannot see such a
-- join at all. With the column backfilled from players and not null, a read
-- filters on the row and pages like every other team table. Three two-key
-- tables (player_wcl_season_perf, raid_rsvps, raid_rsvp_reminders_sent) had
-- both columns and no check_team_id_matches_player() trigger; now all twenty
-- carry it, so a row filed under the wrong team is refused where it is
-- written. players.team_id is not null, so the backfill leaves no gap.

alter table public.scoring
  add column team_id integer references public.teams(id) on delete cascade;
update public.scoring s set team_id = p.team_id from public.players p where p.id = s.player_id;
alter table public.scoring alter column team_id set not null;

alter table public.player_equipped_gear
  add column team_id integer references public.teams(id) on delete cascade;
update public.player_equipped_gear g set team_id = p.team_id from public.players p where p.id = g.player_id;
alter table public.player_equipped_gear alter column team_id set not null;

create trigger trg_scoring_team_id_check
  before insert or update on public.scoring
  for each row execute function public.check_team_id_matches_player();

create trigger trg_player_equipped_gear_team_id_check
  before insert or update on public.player_equipped_gear
  for each row execute function public.check_team_id_matches_player();

create trigger trg_player_wcl_season_perf_team_id_check
  before insert or update on public.player_wcl_season_perf
  for each row execute function public.check_team_id_matches_player();

create trigger trg_raid_rsvps_team_id_check
  before insert or update on public.raid_rsvps
  for each row execute function public.check_team_id_matches_player();

create trigger trg_raid_rsvp_reminders_sent_team_id_check
  before insert or update on public.raid_rsvp_reminders_sent
  for each row execute function public.check_team_id_matches_player();
