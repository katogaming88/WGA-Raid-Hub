-- #1639: the audit page's item level (#1261). Some raiders log out in PvP
-- gear, so the page shows the highest item level a character ever had, with
-- what they wear now underneath when it is lower.
--
-- * item_level: the equipped item level at the week's last read.
-- * best_item_level: the highest item_level over the weeks of the character in
--   the same season, kept by the trigger below on every write, so a sync only
--   sends what it read and the mark never goes down within a season. It starts
--   over with each season (Kat, 2026-11-15): an item level squish at a new
--   expansion would otherwise leave every raider's mark stuck at the old scale.
--
-- Both are null until the first read after this lands; the page shows a dash.
-- Written only by the syncs; read by the rule character_weeks already has.

alter table public.character_weeks
  add column item_level smallint check (item_level > 0),
  add column best_item_level smallint check (best_item_level > 0);

comment on column public.character_weeks.item_level is
  'The equipped item level at the week''s last read (#1639).';
comment on column public.character_weeks.best_item_level is
  'The highest item_level the character has had in any week (#1639), kept by character_weeks_keep_best_item_level() on every write; never goes down within a season and starts over with the next.';

create function public.character_weeks_keep_best_item_level()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- greatest() ignores nulls: the new read, the mark this row already had,
  -- and the best of the character's other weeks in the same season.
  new.best_item_level := greatest(
    new.item_level,
    new.best_item_level,
    (select max(w.best_item_level)
       from character_weeks w
      where w.name_realm_key = lower(replace(new.name_realm, ' ', ''))
        and w.week_of <> new.week_of
        and current_season(w.week_of) is not distinct from current_season(new.week_of))
  );
  return new;
end;
$$;

comment on function public.character_weeks_keep_best_item_level() is
  'Trigger: keeps character_weeks.best_item_level (#1639) as the highest item_level across the character''s weeks in the same season.';

revoke all on function public.character_weeks_keep_best_item_level() from public, anon, authenticated;

create trigger character_weeks_keep_best_item_level
  before insert or update on public.character_weeks
  for each row execute function public.character_weeks_keep_best_item_level();
