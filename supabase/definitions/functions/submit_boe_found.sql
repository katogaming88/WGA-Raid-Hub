-- Function public.submit_boe_found: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): anon, authenticated

CREATE OR REPLACE FUNCTION public.submit_boe_found(p_team_id integer, p_name_realm text, p_item_name text, p_track text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_donate boolean DEFAULT false, p_upgrade_rank text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_player_id integer;
  v_item_id integer;
  v_item_name text;
  v_season text;
  v_rank text;
  v_id integer;
begin
  if trim(coalesce(p_name_realm, '')) = '' then
    raise exception 'Character name is required';
  end if;
  if trim(coalesce(p_item_name, '')) = '' then
    raise exception 'Item name is required';
  end if;
  if p_track is null then
    raise exception 'Track is required';
  end if;
  if p_track <> all (array['Champion', 'Hero', 'Myth']) then
    raise exception 'Unknown track: %', p_track;
  end if;
  v_rank := nullif(regexp_replace(coalesce(p_upgrade_rank, ''), '\s', '', 'g'), '');
  if v_rank is null then
    raise exception 'Upgrade rank is required';
  end if;
  if v_rank <> all (array['1/6', '2/6', '3/6', '4/6', '5/6', '6/6']) then
    raise exception 'Upgrade rank must be one of 1/6 to 6/6';
  end if;

  select p.id into v_player_id
  from public.players p
  where p.team_id = p_team_id and p.name_realm = trim(p_name_realm) and p.archived_at is null;

  select i.id, i.name into v_item_id, v_item_name
  from public.items i
  where i.is_boe and lower(i.name) = lower(trim(p_item_name));

  v_season := public.current_season();

  insert into public.boe_items (team_id, player_id, finder_name, finder_discord_id, item_id, item_name, track, upgrade_rank, season, note, payout_donated)
  values (p_team_id, v_player_id, trim(p_name_realm), public.current_discord_id(), v_item_id, coalesce(v_item_name, trim(p_item_name)), p_track, v_rank,
          v_season, nullif(trim(coalesce(p_note, '')), ''), coalesce(p_donate, false))
  returning boe_items.id into v_id;

  return v_id;
end $function$;
