-- Function public.check_priority_order_drift: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.check_priority_order_drift(p_team_id integer, p_season text)
 RETURNS TABLE(item_id integer, item_name text, track text, saved_top3 text[], current_top3 text[])
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
begin
  if not (coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  return query
  with combos as (
    select distinct po.item_id, po.track
    from public.priority_order po
    where po.team_id = p_team_id
      and po.season = p_season
  ),
  saved as (
    select
      po.item_id,
      po.track,
      array_agg(p.name_realm order by po.rank) as top3
    from public.priority_order po
    join public.players p on p.id = po.player_id
    where po.team_id = p_team_id
      and po.season = p_season
      and po.rank <= 3
    group by po.item_id, po.track
  ),
  current as (
    select
      c.item_id,
      c.track,
      array_agg(g.name_realm order by g.ord) as top3
    from combos c
    cross join lateral (
      select t.name_realm, t.ord
      from public.generate_priority_order(p_team_id, p_season, c.item_id, c.track)
        with ordinality as t(player_id, name_realm, role, weighted_total, status_label, wishlist_status, ord)
      order by t.ord
      limit 3
    ) g
    group by c.item_id, c.track
  )
  select
    co.item_id,
    i.name,
    co.track,
    coalesce(s.top3, array[]::text[]),
    coalesce(cu.top3, array[]::text[])
  from combos co
  join public.items i on i.id = co.item_id
  left join saved s on s.item_id = co.item_id and s.track = co.track
  left join current cu on cu.item_id = co.item_id and cu.track = co.track
  where coalesce(s.top3, array[]::text[]) is distinct from coalesce(cu.top3, array[]::text[])
  order by i.name, co.track;
end;
$function$;
