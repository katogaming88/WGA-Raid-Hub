-- #937: boe_items.season holds the season code, and a BoE find is stamped
-- with the current tier. Closes #922.
--
-- submit_boe_found() stamped the reporting team's config->>'seasonName' and
-- nothing else, so a team that never ran Start New Season filed every find
-- with no season at all (#922: eleven rows on production, all live
-- submissions from the two teams with no seasonName). The picker on boe.html
-- answered the same question another way (that team's seasonView or
-- seasonName, else the first listed team's), so what a raider was offered
-- and what got stored disagreed.
--
-- Since #1189 (2026-09-20) the season is app-wide and no team has a cycle,
-- and #933 gave the current tier a definition, current_season(). A find is
-- that tier's whatever the team's settings say: the function stamps
-- current_season() and the picker reads the same function, so the two
-- answer alike. From 00:00 Eastern on a tier's start every find is the new
-- tier's; the picker offers the whole catalog until the sync files the new
-- raid, the fail-open rule it already had for a tier with no zones.
--
-- The rows convert from display names ("Midnight Season 2") to codes
-- ("MID2") and the foreign key moves from seasons(display_name) to
-- seasons(code), the #933 shape. A row with no season takes the tier that
-- was current on the day it was found. The column stays nullable: the
-- function no longer produces a null on any day with a tier row, and nothing
-- else writes the column.
--
-- submit_boe_found() body otherwise verbatim from 20260903214907; create or
-- replace keeps the anon and authenticated grants.

alter table public.boe_items drop constraint boe_items_season_fkey;

update public.boe_items b
set season = s.code
from public.seasons s
where s.display_name = b.season;

update public.boe_items
set season = public.current_season((found_at at time zone 'America/New_York')::date)
where season is null;

alter table public.boe_items
  add constraint boe_items_season_fkey foreign key (season) references public.seasons (code);

create or replace function public.submit_boe_found(
  p_team_id integer,
  p_name_realm text,
  p_item_name text,
  p_track text default null,
  p_note text default null,
  p_donate boolean default false,
  p_upgrade_rank text default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id integer;
  v_item_id integer;
  v_item_name text;
  v_season text;
  v_rank text;
  v_id integer;
begin
  if trim(coalesce(p_name_realm, '')) = '' then
    raise exception 'Character name is required';
  end if;
  if trim(coalesce(p_item_name, '')) = '' then
    raise exception 'Item name is required';
  end if;
  if p_track is null then
    raise exception 'Track is required';
  end if;
  if p_track <> all (array['Champion', 'Hero', 'Myth']) then
    raise exception 'Unknown track: %', p_track;
  end if;
  v_rank := nullif(regexp_replace(coalesce(p_upgrade_rank, ''), '\s', '', 'g'), '');
  if v_rank is null then
    raise exception 'Upgrade rank is required';
  end if;
  if v_rank <> all (array['1/6', '2/6', '3/6', '4/6', '5/6', '6/6']) then
    raise exception 'Upgrade rank must be one of 1/6 to 6/6';
  end if;

  select p.id into v_player_id
  from public.players p
  where p.team_id = p_team_id and p.name_realm = trim(p_name_realm) and p.archived_at is null;

  select i.id, i.name into v_item_id, v_item_name
  from public.items i
  where i.is_boe and lower(i.name) = lower(trim(p_item_name));

  v_season := public.current_season();

  insert into public.boe_items (team_id, player_id, finder_name, finder_discord_id, item_id, item_name, track, upgrade_rank, season, note, payout_donated)
  values (p_team_id, v_player_id, trim(p_name_realm), public.current_discord_id(), v_item_id, coalesce(v_item_name, trim(p_item_name)), p_track, v_rank,
          v_season, nullif(trim(coalesce(p_note, '')), ''), coalesce(p_donate, false))
  returning boe_items.id into v_id;

  return v_id;
end $$;
