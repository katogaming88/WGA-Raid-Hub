-- Function public.character_weeks_fill_vault: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.character_weeks_fill_vault()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_prev jsonb;
  v_delves jsonb;
begin
  select w.delves into v_prev
    from character_weeks w
   where w.name_realm_key = lower(replace(new.name_realm, ' ', '')) and w.week_of = new.week_of - 7;
  if found then
    select coalesce(jsonb_object_agg(d.key, greatest(d.value::integer - coalesce((v_prev ->> d.key)::integer, 0), 0)), '{}')
      into v_delves
      from jsonb_each_text(new.delves) d;
  end if;
  new.vault := coalesce(season_vault(current_season(new.week_of), new.raid_kills, new.mplus_runs, v_delves), '{}');
  new.vault_at := now();
  return new;
end;
$function$;
