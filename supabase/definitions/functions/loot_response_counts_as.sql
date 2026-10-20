-- Function public.loot_response_counts_as: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.loot_response_counts_as(p_team_id integer, p_response text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select case
    when ts.list is null then null
    when p_response is null or btrim(p_response) = '' then 'main'
    when lower(btrim(p_response)) in ('personal loot - non tradeable', 'disenchant') then 'none'
    else coalesce(
      (
        select b ->> 'countsAs'
        from (
          select b from jsonb_array_elements(coalesce(ts.list -> 'buttons', '[]'::jsonb)) as b
          union all
          select b
          from jsonb_array_elements(coalesce(ts.list -> 'groups', '[]'::jsonb)) as g,
            jsonb_array_elements(coalesce(g -> 'buttons', '[]'::jsonb)) as b
        ) buttons
        where lower(btrim(b ->> 'text')) = lower(btrim(p_response))
        limit 1
      ),
      'hidden'
    )
  end
  from (
    select (select config -> 'lootResponses' from public.team_settings where team_id = p_team_id) as list
  ) ts
$function$;
