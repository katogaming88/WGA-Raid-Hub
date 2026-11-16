-- Function public.character_weeks_keep_best_item_level: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.character_weeks_keep_best_item_level()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
$function$;
