-- Function public.lineup_picks_norm: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.lineup_picks_norm(p_team_id integer, p_picks jsonb)
 RETURNS TABLE(player_id integer, character_id integer, class_spec_id integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select n.player_id, n.character_id, n.class_spec_id
  from (
    select x.player_id, a.character_id,
           case
             when x.class_spec_id is null then null
             when a.character_id is null and x.class_spec_id = p.class_spec_id then null
             else x.class_spec_id
           end as class_spec_id
    from jsonb_to_recordset(coalesce(p_picks, '[]'::jsonb)) as x(player_id integer, character_id integer, class_spec_id integer)
    join players p on p.id = x.player_id and p.team_id = p_team_id
    left join characters c on c.id = x.character_id
    cross join lateral (
      select case
               when c.id is null or c.name_realm_key = lower(replace(p.name_realm, ' ', '')) then null
               else c.id
             end as character_id
    ) a
  ) n
  where n.character_id is not null or n.class_spec_id is not null;
$function$;
