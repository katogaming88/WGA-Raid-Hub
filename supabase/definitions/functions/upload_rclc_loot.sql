-- Function public.upload_rclc_loot: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.upload_rclc_loot(p_team_id integer, p_season text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_rows jsonb := coalesce(p_rows, '[]'::jsonb);
  v_on_roster jsonb;
begin
  if jsonb_typeof(v_rows) <> 'array' then
    raise exception 'Expected a list of loot entries';
  end if;

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_on_roster
    from jsonb_array_elements(v_rows) r
   where exists (
           select 1 from public.players p
            where p.team_id = p_team_id
              and p.archived_at is null
              and lower(replace(p.name_realm, ' ', ''))
                = lower(replace(trim(both from coalesce(r ->> 'player', '')), ' ', ''))
         );

  return public.import_rclc_loot(p_team_id, p_season, v_on_roster)
      || jsonb_build_object(
           'skipped_not_on_roster',
           jsonb_array_length(v_rows) - jsonb_array_length(v_on_roster)
         );
end;
$function$;
