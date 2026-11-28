-- Function public.import_rclc_loot: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.import_rclc_loot(p_team_id integer, p_season text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_row jsonb;
  v_name_realm text;
  v_player_id integer;
  v_item_id integer;
  v_track text;
  v_track_from_bonus text;
  v_instance text;
  v_item_string text;
  v_string_parts text[];
  v_num_bonus integer;
  v_bonus_ids integer[];
  v_awarded_at timestamptz;
  v_season text;
  v_rclc_id text;
  v_dedupe_key text;
  v_boss text;
  v_item_name text;
  v_response text;
  v_reason text;
  v_new_id integer;
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_before_seasons integer := 0;
  v_not_raid_gear integer := 0;
  v_unresolved_item integer := 0;
  v_skipped_rows jsonb := '[]'::jsonb;
  v_detail text;
  -- Season MID2 raid gear track bonus IDs -- see 20260829200033's header comment.
  c_champion_bonus_ids constant integer[] := array[12833,12834,12835,12836,12837,12838];
  c_hero_bonus_ids constant integer[] := array[12841,12842,12843,12844,12845,12846];
  c_myth_bonus_ids constant integer[] := array[12849,12850,12851,12852,12853,12854,13848];
begin
  if not (public.has_team_permission(p_team_id, 'manage_loot') or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_name_realm := trim(both from coalesce(v_row->>'player', ''));
    v_rclc_id := nullif(trim(both from coalesce(v_row->>'id', '')), '');
    if v_name_realm = '' or v_rclc_id is null then
      continue;
    end if;

    v_item_name := nullif(trim(both from coalesce(v_row->>'itemName', '')), '');
    v_boss := nullif(trim(both from coalesce(v_row->>'boss', '')), '');
    v_reason := null;

    -- awarded_at: RCLC's date/time are the raid's local wall-clock time, same
    -- assumption the rest of the site already makes for this data (see
    -- mapSupabaseLoot()'s America/New_York formatting in js/common.js).
    -- Falls back to the import moment if either field is unparseable rather
    -- than failing the whole row.
    begin
      v_awarded_at := (
        to_date(replace(coalesce(v_row->>'date', ''), '/', '-'), 'YYYY-MM-DD')
        + coalesce(nullif(v_row->>'time', '')::interval, interval '0')
      ) at time zone 'America/New_York';
      -- The award's own season, by its Eastern date (#1579).
      v_season := public.current_season((v_awarded_at at time zone 'America/New_York')::date);
    exception when others then
      -- No date to go by: the season the page or the Sync app passed.
      v_awarded_at := now();
      v_season := nullif(p_season, '');
    end;
    if v_season is null then
      v_reason := 'before_seasons';
    end if;

    -- Item: wow_item_id first (RCLC provides itemID directly and it's
    -- unambiguous), item name as fallback. Left null, not auto-created, when
    -- neither resolves -- a genuinely unresolved item means the season's Item
    -- Lookup needs updating, not something to paper over with a placeholder
    -- row (see docs/database-decisions.md).
    v_item_id := null;
    if v_reason is null then
      if (v_row->>'itemID') is not null and (v_row->>'itemID') ~ '^\d+$' then
        select id into v_item_id from public.items
         where wow_item_id = (v_row->>'itemID')::integer
         order by id limit 1;
      end if;
      if v_item_id is null and v_item_name is not null then
        select id into v_item_id from public.items
         where lower(name) = lower(v_item_name)
         limit 1;
      end if;
      -- An unknown item is kept only from a raid boss (a new boss's loot not
      -- loaded yet); from anywhere else it isn't raid gear (#1579).
      if v_item_id is null and not exists (
        select 1 from public.raid_encounters e
         where lower(e.name) = lower(replace(coalesce(v_boss, ''), chr(8217), ''''))
      ) then
        v_reason := 'not_raid_gear';
      end if;
    end if;

    if v_reason is null then
      -- Player: name_realm match, ignoring case and whitespace. RCLC's
      -- UnitName()-sourced realm strips spaces from multi-word realms
      -- ("Wyrmrest Accord" -> "WyrmrestAccord"); the DB's officer-typed
      -- name_realm keeps them. Comparing with spaces stripped from both sides
      -- makes either shape resolve to the same row. Unknown names still get
      -- an archived stub (same shape as the #320 import's stub rows), never
      -- a null player_id.
      select id into v_player_id from public.players
       where team_id = p_team_id
         and lower(replace(name_realm, ' ', '')) = lower(replace(v_name_realm, ' ', ''));
      if v_player_id is null then
        insert into public.players (team_id, name_realm, archived_at)
        values (p_team_id, v_name_realm, now())
        returning id into v_player_id;
      end if;

      -- The same award from another officer's client has another id, and the
      -- first history import's rows have none: the same character with the
      -- same item within 5 minutes is the same award (#1579).
      if v_item_id is not null and exists (
        select 1 from public.rclc_loot l
         where l.team_id = p_team_id
           and l.player_id = v_player_id
           and l.item_id = v_item_id
           and l.awarded_at between v_awarded_at - interval '5 minutes' and v_awarded_at + interval '5 minutes'
      ) then
        v_reason := 'already_on_file';
      end if;
    end if;

    if v_reason is null then
      if v_item_id is null then
        v_unresolved_item := v_unresolved_item + 1;
      end if;

      -- Track, preferred source: the item's own bonus IDs (see
      -- 20260829200033's header comment). v_bonus_ids/v_num_bonus reset
      -- every row -- a plpgsql variable keeps its value across loop
      -- iterations if not reassigned, and a row with no itemString must not
      -- inherit the previous row's.
      v_track_from_bonus := null;
      v_bonus_ids := null;
      v_item_string := coalesce(v_row->>'itemString', '');
      if v_item_string <> '' then
        v_string_parts := string_to_array(v_item_string, ':');
        if array_length(v_string_parts, 1) >= 14 then
          v_num_bonus := nullif(v_string_parts[14], '')::integer;
          if v_num_bonus is not null and v_num_bonus > 0
             and array_length(v_string_parts, 1) >= 14 + v_num_bonus then
            select array_agg(x::integer) into v_bonus_ids
              from unnest(v_string_parts[15 : 14 + v_num_bonus]) x
             where x ~ '^\d+$';
          end if;
        end if;
      end if;
      if v_bonus_ids is not null then
        v_track_from_bonus := case
          when v_bonus_ids && c_champion_bonus_ids then 'Champion'
          when v_bonus_ids && c_hero_bonus_ids then 'Hero'
          when v_bonus_ids && c_myth_bonus_ids then 'Myth'
          else null
        end;
      end if;

      -- Track, fallback source: a standalone difficulty word anywhere in the
      -- instance string (20260806214054), used only when the bonus IDs
      -- above didn't resolve a track.
      v_instance := coalesce(v_row->>'instance', '');
      v_track := coalesce(v_track_from_bonus, case
        when v_instance ~* '\mmythic\M' then 'Myth'
        when v_instance ~* '\mheroic\M' then 'Hero'
        when v_instance ~* '\mnormal\M' then 'Champion'
        else null
      end);

      v_response := nullif(trim(both from coalesce(v_row->>'response', '')), '');
      v_dedupe_key := 't' || p_team_id || ':rclc:' || v_rclc_id;

      insert into public.rclc_loot
        (team_id, player_id, item_id, track, season, awarded_at, rclc_id, dedupe_key, boss, response)
      values
        (p_team_id, v_player_id, v_item_id, v_track, v_season, v_awarded_at, v_rclc_id, v_dedupe_key, v_boss, v_response)
      on conflict (dedupe_key) do nothing
      returning id into v_new_id;

      if v_new_id is not null then
        v_inserted := v_inserted + 1;
        v_detail := coalesce(v_track || ' - ', '') || coalesce(v_item_name, 'Unknown item');
        perform public.write_audit_log(
          p_team_id, 'Loot Imported (RCLC)', 'players', v_player_id,
          jsonb_build_object('summary', v_detail, 'season', v_season)
        );
      else
        v_reason := 'already_on_file';
      end if;
      v_new_id := null;
    end if;

    if v_reason is not null then
      if v_reason = 'before_seasons' then
        v_before_seasons := v_before_seasons + 1;
      elsif v_reason = 'not_raid_gear' then
        v_not_raid_gear := v_not_raid_gear + 1;
      else
        v_skipped := v_skipped + 1;
      end if;
      v_skipped_rows := v_skipped_rows || jsonb_build_object(
        'item', v_item_name,
        'boss', v_boss,
        'player', v_name_realm,
        'date', (v_awarded_at at time zone 'America/New_York')::date,
        'reason', v_reason
      );
    end if;
  end loop;

  return jsonb_build_object(
    'inserted', v_inserted,
    'skipped_duplicate', v_skipped,
    'skipped_before_seasons', v_before_seasons,
    'skipped_not_raid_gear', v_not_raid_gear,
    'unresolved_item', v_unresolved_item,
    'skipped', v_skipped_rows
  );
end;
$function$;
