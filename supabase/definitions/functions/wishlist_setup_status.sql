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
  c text;
  officer_buckets jsonb;
  tagged_rows text[];
  bis_rows text[];
  off_hand_required boolean;
  required_rows text[];
  missing text[];
begin
  for prec in
    select p.id, p.name_realm, p.bis_link, tm.discord_id,
      (select count(*) from item_preferences ip where ip.player_id = p.id) as wishlist_count
    from players p
    join team_members tm on tm.id = p.team_member_id
    where p.team_id = p_team_id
      and p.archived_at is null
  loop
    -- Own copy of wishlistOfficerRowBuckets' greedy row-assignment: explicit
    -- bis_items.slot rows claim their row first (pass 1), then legacy rows
    -- with no slot override fall back to their item's catalog-slot
    -- candidates in id order, first open row wins (pass 2). Stored as
    -- row -> catalog_slot so the off-hand check below can read the
    -- assigned Weapon pick's catalog slot without a second lookup.
    officer_buckets := '{}'::jsonb;

    for bi in
      select b.id, i.slot as catalog_slot, b.slot as explicit_slot
      from bis_items b
      join items i on i.id = b.item_id
      where b.player_id = prec.id
        and b.slot = any(wishlist_slots)
      order by b.id
    loop
      if not (officer_buckets ? bi.explicit_slot) then
        officer_buckets := jsonb_set(officer_buckets, array[bi.explicit_slot], to_jsonb(bi.catalog_slot));
      end if;
    end loop;

    for bi in
      select b.id, i.slot as catalog_slot
      from bis_items b
      join items i on i.id = b.item_id
      where b.player_id = prec.id
        and (b.slot is null or not (b.slot = any(wishlist_slots)))
      order by b.id
    loop
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
      foreach c in array candidates
      loop
        if not (officer_buckets ? c) then
          officer_buckets := jsonb_set(officer_buckets, array[c], to_jsonb(bi.catalog_slot));
          exit;
        end if;
      end loop;
    end loop;

    -- Raider's own tags: wishlistCompleteness()'s taggedRows/bisRows/
    -- offHandRequired pass. item_preferences.slot mirrors bis_items.slot --
    -- present for Finger/Trinket/Weapon/Off Hand disambiguation and every
    -- placeholder row, null (falls back to catalog slot) everywhere else.
    tagged_rows := array[]::text[];
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

      tagged_rows := tagged_rows || candidates;
      if bi.status = 'bis' then
        bis_rows := bis_rows || candidates;
        if (bi.explicit_slot = 'Weapon' or bi.explicit_slot is null) and bi.catalog_slot = 'One-Hand' then
          off_hand_required := true;
        end if;
      end if;
    end loop;

    if not (tagged_rows @> array['Weapon'])
      and officer_buckets ? 'Weapon'
      and officer_buckets ->> 'Weapon' = 'One-Hand'
    then
      off_hand_required := true;
    end if;

    required_rows := array(
      select s from unnest(wishlist_slots) s where s <> 'Off Hand' or off_hand_required
    );
    missing := array(
      select r from unnest(required_rows) r
      where not (bis_rows @> array[r]) and not (officer_buckets ? r)
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
