-- #936: the database refuses a raider's wishlist write in a season their team
-- has not opened. The second of #936's two parts.
--
-- Both Wishlist pages already go read-only unless the team's team_seasons row
-- for the season they plan for has wishlist_open on, or the raider has the
-- per-raider override (players.wishlist_allowed). The database took the write
-- anyway, so the switch held only for a page that had read it since it last
-- changed. This asks the same question about the row being written: the
-- switch for the season stamped on it, or the override. A row with no season
-- has no switch, so only the override opens it.
--
-- The page asks about the season it plans for and finds a pick by item and
-- slot in any season, so the two answers agree only while every row a raider
-- holds carries that season. On production that is every row (2026-09-24).
-- They part once a raider holds picks in two seasons, which needs a tier
-- after MID2; #936's season-keyed unique index lands first, and a tripwire in
-- tests/rls/item-preferences.test.js holds that order.
--
-- A trigger, not a change to the raiders' policy. A policy refusal on an
-- update or a delete filters the row out and reports success with nothing
-- changed, where this raises. And the officers' note-clearing policy would
-- still let an officer update their own character's rows, because the
-- note-only trigger below steps aside for a row that is the caller's own.
-- Only the caller's own rows are held, so an officer clearing someone else's
-- note is untouched, and so is anything not running as authenticated, as in
-- restrict_item_preferences_officer_update_to_note_clear().

create or replace function public.restrict_item_preferences_to_open_wishlist()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $$
declare
  v_row public.item_preferences;
begin
  if current_user = 'authenticated' then
    -- An update is checked on both sides, so a row can neither be edited in
    -- a closed season nor moved into one; once when neither side moves.
    foreach v_row in array case
        when tg_op = 'INSERT' then array[new]
        when tg_op = 'DELETE' then array[old]
        when (new.player_id, new.team_id, new.season) is not distinct from (old.player_id, old.team_id, old.season)
          then array[old]
        else array[old, new]
      end
    loop
      if public.is_own_player(v_row.player_id)
         and not exists (
           select 1 from public.team_seasons ts
           where ts.team_id = v_row.team_id and ts.season_code = v_row.season and ts.wishlist_open
         )
         and not exists (
           select 1 from public.players p
           where p.id = v_row.player_id and p.wishlist_allowed
         )
      then
        raise exception 'wishlist editing is not open for that season on this team';
      end if;
    end loop;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

alter function public.restrict_item_preferences_to_open_wishlist() owner to postgres;

create trigger trg_item_preferences_wishlist_open
    before insert or update or delete on public.item_preferences
    for each row execute function public.restrict_item_preferences_to_open_wishlist();
