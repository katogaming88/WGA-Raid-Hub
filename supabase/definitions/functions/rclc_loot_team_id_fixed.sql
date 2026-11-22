-- Function public.rclc_loot_team_id_fixed: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.rclc_loot_team_id_fixed()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.team_id is distinct from old.team_id and auth.uid() is not null and not public.is_site_admin() then
    raise exception 'A loot row stays on its team' using errcode = '42501';
  end if;
  return new;
end;
$function$;
