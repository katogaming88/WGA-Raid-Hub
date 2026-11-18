-- Function public.same_lineup_picks: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.same_lineup_picks(a jsonb, b jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select coalesce((
           select jsonb_agg(jsonb_build_array(x.player_id, x.character_id, x.class_spec_id)
                            order by x.player_id, x.character_id, x.class_spec_id)
           from jsonb_to_recordset(coalesce(a, '[]'::jsonb)) as x(player_id integer, character_id integer, class_spec_id integer)
         ), '[]'::jsonb)
       = coalesce((
           select jsonb_agg(jsonb_build_array(x.player_id, x.character_id, x.class_spec_id)
                            order by x.player_id, x.character_id, x.class_spec_id)
           from jsonb_to_recordset(coalesce(b, '[]'::jsonb)) as x(player_id integer, character_id integer, class_spec_id integer)
         ), '[]'::jsonb);
$function$;
