-- Function public.restrict_players_self_update_to_bonus_roll: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): public

CREATE OR REPLACE FUNCTION public.restrict_players_self_update_to_bonus_roll()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if public.has_team_permission(new.team_id, 'edit_roster')
     or public.is_site_admin()
  then
    return new;
  end if;

  if (to_jsonb(new) - 'bonus_roll_encounter_id' - 'updated_at' - 'name_realm_key')
     is distinct from (to_jsonb(old) - 'bonus_roll_encounter_id' - 'updated_at' - 'name_realm_key') then
    raise exception 'Raiders may only update bonus_roll_encounter_id on their own player row';
  end if;
  return new;
end $function$;
