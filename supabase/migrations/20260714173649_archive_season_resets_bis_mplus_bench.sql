-- Archiving a season only ever reset team_settings.config (season name/
-- dates/raid progression) -- nothing about bis_items, players.m_plus_excluded,
-- or players.is_bench has any season concept in the schema at all, so all
-- three persisted forever across every archive. Decided in conversation with
-- Kat (2026-07-14):
--
-- - bis_items: a new tier is almost always a different loot table entirely,
--   so last tier's real-item BiS rows are dead weight once the new one is
--   pointing at gear that no longer exists as a valid target. Snapshot every
--   row (including placeholders, for a complete historical record) onto the
--   season-history entry so "View BiS" can still show what a player's list
--   and completion looked like at archive time -- then wipe the live real-item
--   rows. Placeholder rows (M+/Crafted/Catalyst, items.is_placeholder) aren't
--   tied to specific gear and usually apply every tier regardless of the loot
--   table, so those survive the wipe untouched.
-- - players.m_plus_excluded: this flag means "this player doesn't need gear
--   from M+ right now" -- a new tier means everyone needs gear again, so it
--   resets to false (and m_plus_note, the reason, clears with it) for the
--   whole active roster rather than silently carrying a stale exclusion into
--   a tier it was never decided for.
-- - players.is_bench: reset to false for the whole active roster too, unlike
--   is_trial (deliberately left alone -- a trial's status doesn't
--   automatically change just because a new tier started; that's still a
--   deliberate Trial Promotions call).
--
-- rclc_loot (actual loot-award history from RCLC imports) is untouched by
-- any of this -- it's an independent child of the shared items catalog, not
-- of bis_items, so nothing here can turn a past loot assignment into an
-- unresolved link.
create or replace function public.archive_current_season(
  p_team_id integer,
  p_roster_snapshot jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_config jsonb;
  v_entry jsonb;
  v_bis_snapshot jsonb;
begin
  -- SELECT ... FOR UPDATE is filtered by both the SELECT and UPDATE RLS
  -- rules on this table (Postgres locks rows against the write rule too),
  -- so a caller without team_leader/site_admin gets 0 rows here -- same
  -- "Not authorized" outcome as failing the later UPDATE, just caught
  -- earlier and with one message instead of two.
  select config into v_config from public.team_settings where team_id = p_team_id for update;
  if v_config is null then
    raise exception 'Not authorized';
  end if;
  if coalesce(v_config->>'seasonName', '') = '' then
    raise exception 'No active season to archive';
  end if;

  -- Snapshot before the wipe below -- every row, placeholders included, so
  -- the historical record matches what officers actually saw at the time.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'nameRealm', p.name_realm,
        'item', i.name,
        'slot', coalesce(bi.slot, i.slot),
        'obtained', bi.obtained,
        'isPlaceholder', i.is_placeholder
      )
      order by p.name_realm, i.name
    ),
    '[]'::jsonb
  )
  into v_bis_snapshot
  from public.bis_items bi
  join public.players p on p.id = bi.player_id
  join public.items i on i.id = bi.item_id
  where p.team_id = p_team_id
    and p.archived_at is null;

  v_entry := jsonb_build_object(
    'name', coalesce(v_config->'seasonName', '""'::jsonb),
    'start', coalesce(v_config->'seasonStart', '""'::jsonb),
    'end', coalesce(v_config->'seasonEnd', '""'::jsonb),
    'raids', coalesce(v_config->'raidProgression', '[]'::jsonb),
    'roster', coalesce(p_roster_snapshot, '[]'::jsonb),
    'bis', v_bis_snapshot
  );

  update public.team_settings
  set config = config || jsonb_build_object(
    'seasonName', '""'::jsonb,
    'seasonStart', '""'::jsonb,
    'seasonEnd', '""'::jsonb,
    'raidProgression', '[]'::jsonb,
    'seasonHistory', coalesce(v_config->'seasonHistory', '[]'::jsonb) || jsonb_build_array(v_entry)
  )
  where team_id = p_team_id
  returning config into v_config;

  if not found then
    raise exception 'Not authorized';
  end if;

  -- Fresh tier, fresh BiS -- real gear entries only; placeholders survive.
  delete from public.bis_items bi
  using public.players p, public.items i
  where bi.player_id = p.id
    and bi.item_id = i.id
    and p.team_id = p_team_id
    and p.archived_at is null
    and not i.is_placeholder;

  -- Everyone needs gear again in a new tier.
  update public.players
  set m_plus_excluded = false, m_plus_note = null
  where team_id = p_team_id
    and archived_at is null
    and m_plus_excluded = true;

  -- Bench resets fresh each tier; trial status is left alone (see header).
  update public.players
  set is_bench = false
  where team_id = p_team_id
    and archived_at is null
    and is_bench = true;

  return v_config;
end;
$$;

revoke all on function public.archive_current_season(integer, jsonb) from public;
revoke execute on function public.archive_current_season(integer, jsonb) from anon;
grant execute on function public.archive_current_season(integer, jsonb) to authenticated;
