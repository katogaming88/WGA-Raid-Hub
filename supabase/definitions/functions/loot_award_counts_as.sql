-- Function public.loot_award_counts_as: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): anon, authenticated

CREATE OR REPLACE FUNCTION public.loot_award_counts_as(p_team_id integer, p_response text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- Keep in step with todaysCountsAs() and awardCountsAs() in
  -- app/src/settings/lootResponses.ts.
  select coalesce(
    public.loot_response_counts_as(p_team_id, p_response),
    case
      when p_response is null or btrim(p_response) = '' then 'main'
      when lower(btrim(p_response)) in ('xmog', 'pet') then 'hidden'
      when lower(btrim(p_response)) in ('bonus loot', 'personal loot - non tradeable', 'disenchant') then 'none'
      when p_response ~* '\mos\M' or p_response ~* 'm\+' then 'off'
      else 'main'
    end
  )
$function$;
