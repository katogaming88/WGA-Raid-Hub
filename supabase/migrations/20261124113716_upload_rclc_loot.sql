-- #1442: the Sync app's loot upload. The Sync app (#1445, linked by #1452)
-- reads RCLootCouncil's saved loot history after the raid and sends the
-- entries here, in place of an officer pasting the JSON export.
--
-- Same entries and same import as the paste: this hands them to
-- import_rclc_loot(), so the officer check, the team's import setting
-- (lootImportAccess, #1560), the track parsing and the duplicate skip all
-- stay in one place. Sending the same night twice adds nothing.
--
-- The one difference: RCLootCouncil's history also holds raids from the
-- officer's alts and other teams, so an entry whose player isn't on this
-- team's roster (no unarchived character with that name) is left out,
-- where the paste would add an archived stub for it. The match is the
-- import's own: name_realm ignoring case and spaces.
--
-- Security invoker like import_rclc_loot(): the caller's own access decides.
-- A caller who may not import is refused even when no entry matches.
create function public.upload_rclc_loot(p_team_id integer, p_season text, p_rows jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_rows jsonb := coalesce(p_rows, '[]'::jsonb);
  v_on_roster jsonb;
begin
  if jsonb_typeof(v_rows) <> 'array' then
    raise exception 'Expected a list of loot entries';
  end if;

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_on_roster
    from jsonb_array_elements(v_rows) r
   where exists (
           select 1 from public.players p
            where p.team_id = p_team_id
              and p.archived_at is null
              and lower(replace(p.name_realm, ' ', ''))
                = lower(replace(trim(both from coalesce(r ->> 'player', '')), ' ', ''))
         );

  return public.import_rclc_loot(p_team_id, p_season, v_on_roster)
      || jsonb_build_object(
           'skipped_not_on_roster',
           jsonb_array_length(v_rows) - jsonb_array_length(v_on_roster)
         );
end;
$$;

comment on function public.upload_rclc_loot(integer, text, jsonb) is
  'The Sync app''s loot upload (#1442): import_rclc_loot() for only the entries whose player is on the team''s roster. Returns the import''s counts plus skipped_not_on_roster.';

revoke all on function public.upload_rclc_loot(integer, text, jsonb) from public, anon;
grant execute on function public.upload_rclc_loot(integer, text, jsonb) to authenticated, service_role;
