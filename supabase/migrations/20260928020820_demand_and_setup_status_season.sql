-- #1268: the wishlist setup status and the BiS demand report count one tier,
-- not every tier a raider has ever filed a pick under.
--
-- These are the last two readers of item_preferences that took every season;
-- the priority readers took theirs in 20260927174243. Until the unique key
-- carried the season (20260924145125) a raider held one pick per item and
-- slot, so neither had to name a tier. Since #936's picker a raider holds
-- picks in two tiers as a matter of course, and both count wrong from then:
--
--   wishlist_setup_status(), which the bot's /nudge-missing reads, read the
--   table twice, for the wishlist count and in the loop that fills
--   missing_bis_rows, the list the DM prints. A slot filled in one tier read
--   as filled in the other, and the raider was not chased for it.
--
--   bis_demand_vs_awards counted demand across every season while its awards
--   were per season, and the join carried an award's season onto a demand
--   count that had none.
--
-- The status answers for the tiers a raider's own page lets them edit,
-- decided on #1268 from #936's rule: the tiers the team opened from the live
-- one on, plus the live tier for a raider with the per-raider override. One
-- row per raider per tier, naming it, so the return type changes and the
-- function is dropped and created, with the service_role grant its first
-- migration gave it. A team with nothing open gets no rows, and a finished
-- tier left open is not chased, since neither site lets a raider back into it.
--
-- The view groups demand by the pick's season and meets an award only in its
-- own season. An item handed out in a season nobody wants it in is not listed,
-- decided on #1268: the report answers how much of what raiders want has been
-- handed out, and an award nobody ever wanted has never been listed. Its
-- columns are unchanged, and season is now the demand's.
--
-- A pick with no season belongs to no tier, as the write gate and the
-- priority readers already read it: 9 rows on production, all on archived
-- characters, which both reads leave out anyway.

drop function public.wishlist_setup_status(integer);

create function public.wishlist_setup_status(p_team_id integer)
returns table (
  player_id integer,
  name_realm text,
  discord_id text,
  wishlist_count integer,
  bis_link text,
  missing_bis_rows text[],
  season text,
  season_name text
)
language plpgsql
stable
set search_path = public
as $$
declare
  wishlist_slots text[] := array[
    'Head','Neck','Shoulder','Back','Chest','Wrist','Hands','Waist','Legs','Feet',
    'Finger 1','Finger 2','Trinket 1','Trinket 2','Weapon','Off Hand'
  ];
  live_code text := current_season();
  prec record;
  bi record;
  candidates text[];
  bis_rows text[];
  off_hand_required boolean;
  required_rows text[];
  missing text[];
begin
  for prec in
    with tiers as (
      -- The tiers a raider's own page lets them edit (#936): the team's open
      -- switches from the live tier on, and the live tier for a raider with
      -- the per-raider override. A union, so the two meet as one row.
      select tp.id as tier_player_id, s.code, s.display_name, s.starts_at
      from players tp
      join team_seasons ts on ts.team_id = tp.team_id and ts.wishlist_open
      join seasons s on s.code = ts.season_code
      where tp.team_id = p_team_id
        and s.starts_at >= (select ls.starts_at from seasons ls where ls.code = live_code)
      union
      select tp.id, s.code, s.display_name, s.starts_at
      from players tp
      join seasons s on s.code = live_code
      where tp.team_id = p_team_id
        and tp.wishlist_allowed
    )
    select p.id, p.name_realm, p.bis_link, pe.discord_id,
      t.code as tier_code, t.display_name as tier_name,
      (select count(*) from item_preferences ip
        where ip.player_id = p.id and ip.season = t.code) as wishlist_count
    from players p
    join team_members tm on tm.id = p.team_member_id
    join people pe on pe.id = tm.person_id
    join tiers t on t.tier_player_id = p.id
    where p.team_id = p_team_id
      and p.archived_at is null
    order by p.id, t.starts_at
  loop
    -- Raider's tags: wishlistCompleteness()'s bisRows/offHandRequired pass.
    -- item_preferences.slot is present for Finger/Trinket/Weapon/Off Hand
    -- disambiguation and every placeholder row, null (falls back to catalog
    -- slot) everywhere else.
    bis_rows := array[]::text[];
    off_hand_required := false;

    for bi in
      select ip.status, ip.slot as explicit_slot, i.slot as catalog_slot
      from item_preferences ip
      join items i on i.id = ip.item_id
      where ip.player_id = prec.id
        and ip.season = prec.tier_code
    loop
      if bi.explicit_slot is not null then
        candidates := array[bi.explicit_slot];
      else
        candidates := case bi.catalog_slot
          when 'Finger' then array['Finger 1', 'Finger 2']
          when 'Trinket' then array['Trinket 1', 'Trinket 2']
          when 'One-Hand' then array['Weapon']
          when 'Two-Hand' then array['Weapon']
          when 'Ranged' then array['Weapon']
          when 'Off Hand' then array['Off Hand']
          when 'Held In Off-hand' then array['Off Hand']
          when 'Head' then array['Head']
          when 'Neck' then array['Neck']
          when 'Shoulder' then array['Shoulder']
          when 'Back' then array['Back']
          when 'Chest' then array['Chest']
          when 'Wrist' then array['Wrist']
          when 'Hands' then array['Hands']
          when 'Waist' then array['Waist']
          when 'Legs' then array['Legs']
          when 'Feet' then array['Feet']
          else array[]::text[]
        end;
      end if;

      if bi.status = 'bis' then
        bis_rows := bis_rows || candidates;
        if (bi.explicit_slot = 'Weapon' or bi.explicit_slot is null) and bi.catalog_slot = 'One-Hand' then
          off_hand_required := true;
        end if;
      end if;
    end loop;

    required_rows := array(
      select s from unnest(wishlist_slots) s where s <> 'Off Hand' or off_hand_required
    );
    missing := array(
      select r from unnest(required_rows) r
      where not (bis_rows @> array[r])
    );

    player_id := prec.id;
    name_realm := prec.name_realm;
    discord_id := prec.discord_id;
    wishlist_count := prec.wishlist_count;
    bis_link := prec.bis_link;
    missing_bis_rows := missing;
    season := prec.tier_code;
    season_name := prec.tier_name;
    return next;
  end loop;
end;
$$;

grant execute on function public.wishlist_setup_status(integer) to service_role;

create or replace view public.bis_demand_vs_awards
with (security_invoker = on)
as
with demand as (
  select p.team_id, ip.item_id, ip.season, count(distinct ip.player_id) as demand_count
  from public.item_preferences ip
  join public.players p on p.id = ip.player_id
  join public.items i on i.id = ip.item_id
  where p.archived_at is null
    and ip.status = 'bis'
    and ip.season is not null
    and not i.is_placeholder
    and i.source = 'raid'
  group by p.team_id, ip.item_id, ip.season
),
awards as (
  select team_id, item_id, season, count(*) as awarded_count
  from public.rclc_loot
  where item_id is not null
  group by team_id, item_id, season
)
select
  d.team_id,
  d.item_id,
  i.name as item_name,
  i.slot,
  d.demand_count,
  d.season,
  coalesce(a.awarded_count, 0) as awarded_count
from demand d
join public.items i on i.id = d.item_id
left join awards a on a.team_id = d.team_id and a.item_id = d.item_id and a.season = d.season
order by d.team_id, d.demand_count desc, coalesce(a.awarded_count, 0) asc;
