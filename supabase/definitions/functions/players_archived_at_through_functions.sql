-- Function public.players_archived_at_through_functions: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): public

CREATE OR REPLACE FUNCTION public.players_archived_at_through_functions()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if new.archived_at is distinct from old.archived_at then
    raise exception 'A character leaves the roster through Remove or Archive Member and comes back when an officer re-adds it, not by editing it';
  end if;
  return new;
end;
$function$;
