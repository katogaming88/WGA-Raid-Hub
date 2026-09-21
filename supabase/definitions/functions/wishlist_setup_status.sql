-- Function public.wishlist_setup_status: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): public

CREATE OR REPLACE FUNCTION public.wishlist_setup_status(p_team_id integer)
 RETURNS TABLE(player_id integer, name_realm text, discord_id text, wishlist_count integer, bis_link text, missing_bis_rows text[])
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  wishlist_slots text[] := array[
    'Head','Neck','Shoulder','Back','Chest','Wrist','Hands','Waist','Legs','Feet',
    'Finger 1','Finger 2','Trinket 1','Trinket 2','Weapon','Off Hand'
  ];
  prec record;
  bi record;
  candidates text[];
  bis_rows text[];
  off_hand_required boolean;
  required_rows text[];
  missing text[];
begin
  for prec in
    select p.id, p.name_realm, p.bis_link, pe.discord_id,
      (select count(*) from item_preferences ip where ip.player_id = p.id) as wishlist_count
    from players p
    join team_members tm on tm.id = p.team_member_id
    join people pe on pe.id = tm.person_id
    where p.team_id = p_team_id
      and p.archived_at is null
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
    return next;
  end loop;
end;
$function$;
