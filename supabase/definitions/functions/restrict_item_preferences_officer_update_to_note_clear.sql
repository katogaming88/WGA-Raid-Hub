-- Function public.restrict_item_preferences_officer_update_to_note_clear: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): public

CREATE OR REPLACE FUNCTION public.restrict_item_preferences_officer_update_to_note_clear()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if public.is_own_player(new.player_id) then
    return new;
  end if;

  if new.note is not null
     or (to_jsonb(new) - 'note' - 'updated_at') is distinct from (to_jsonb(old) - 'note' - 'updated_at')
  then
    raise exception 'Officers may only clear (set to null) the note column on item_preferences';
  end if;
  return new;
end $function$;
