-- Function public.sim_setup_label: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): public

CREATE OR REPLACE FUNCTION public.sim_setup_label(p_fight_style text, p_target_count integer, p_fight_length integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case when p_fight_style is null then '' else
    ' (' || case p_fight_style
              when 'CastingPatchwerk' then 'Casting Patchwerk'
              when 'LightMovement' then 'Light movement'
              when 'HeavyMovement' then 'Heavy movement'
              when 'HecticAddCleave' then 'Hectic add cleave'
              when 'DungeonSlice' then 'Dungeon slice'
              else p_fight_style
            end
    || coalesce(', ' || p_target_count || case p_target_count when 1 then ' target' else ' targets' end, '')
    || coalesce(', ' || case when p_fight_length % 60 = 0 then (p_fight_length / 60) || ' min'
                             else (p_fight_length / 60) || ' min ' || (p_fight_length % 60) || ' s' end, '')
    || ')'
  end
$function$;
