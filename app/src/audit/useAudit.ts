import { readAll, useSupabaseQuery } from '../data/query';
import { asEnchantCheck, asVaultRule } from '../settings/settings';
import {
  weekBefore,
  weekOf,
  type AuditData,
  type AuditPlayer,
  type GearItem,
  type SeasonWeek,
  type WeekRow
} from './audit';

const GEAR_COLUMNS =
  'player_id, equipment_slot, item_level, wow_item_id, track, enchantment_id, gem_wow_item_ids, embellished, crafted, upgrade_rank, upgrade_max, synced_at';
const WEEK_COLUMNS =
  'name_realm_key, week_of, raid_kills, raids_at, mplus_runs, mplus_rating, mplus_at, crests, crests_at, vault, vault_at, item_level, best_item_level, gear_at';

// Everyone's audit read for a team (#1639), or for these players only (the
// raider's own card). Current gear, this and last week's rows, the season's
// reference rows and the team's rules, in one go so the page loads once and
// the week switch never reads again.
export function useAuditData(teamId: number, seasonCode: string | null, playerIds?: number[]) {
  return useSupabaseQuery<AuditData>(
    ['audit', teamId, seasonCode, playerIds ?? null],
    async (client) => {
      const fail = (error: { message: string }) => ({ data: null, error });
      let query = client
        .from('players')
        // team-read-guard: the team's active roster, 80 on the largest team
        .select('id, name_realm, name_realm_key, url_code, classes_specs(class, spec, role)')
        .eq('team_id', teamId)
        .is('archived_at', null)
        .order('name_realm');
      if (playerIds) query = query.in('id', playerIds);
      const playersRead = await query;
      if (playersRead.error) return fail(playersRead.error);
      const players = (playersRead.data ?? []) as unknown as AuditPlayer[];
      const ids = new Set(players.map((p) => p.id));
      const keys = players.map((p) => p.name_realm_key).filter((k): k is string => !!k);
      const lastWeek = weekBefore(weekOf(new Date()));
      const season = seasonCode ?? '';

      const [gear, weeks, slots, enchants, gems, settings, tokens] = await Promise.all([
        readAll<GearItem>((from, to) =>
          client.from('player_equipped_gear').select(GEAR_COLUMNS).eq('team_id', teamId).order('id').range(from, to)
        ),
        keys.length
          ? readAll<WeekRow>(
              (from, to) =>
                // The json columns come back as Json; their shapes are WeekRow's.
                client
                  .from('character_weeks')
                  .select(WEEK_COLUMNS)
                  .in('name_realm_key', keys)
                  .gte('week_of', lastWeek)
                  .order('name_realm_key')
                  .order('week_of')
                  .range(from, to) as unknown as ReturnType<Parameters<typeof readAll<WeekRow>>[0]>
            )
          : Promise.resolve({ data: [] as WeekRow[], error: null }),
        client.from('season_enchant_slots').select('slot, counts_from').eq('season', season),
        readAll<{ enchantment_id: number; name: string; top_rank: boolean; tertiary: boolean }>((from, to) =>
          client
            .from('season_enchants')
            .select('enchantment_id, name, top_rank, tertiary')
            .eq('season', season)
            .order('enchantment_id')
            .range(from, to)
        ),
        readAll<{ wow_item_id: number; name: string; top_rank: boolean; epic: boolean }>((from, to) =>
          client
            .from('season_gems')
            .select('wow_item_id, name, top_rank, epic')
            .eq('season', season)
            .order('wow_item_id')
            .range(from, to)
        ),
        client
          .from('team_settings')
          .select('enchantCheck:config->enchantCheck, vaultRule:config->vaultRule')
          .eq('team_id', teamId)
          .maybeSingle(),
        readAll<{ class: string; resolved_item_id: number }>((from, to) =>
          client
            .from('tier_token_map')
            .select('class, resolved_item_id')
            .eq('season', season)
            .order('id')
            .range(from, to)
        )
      ]);
      for (const r of [gear, weeks, slots, enchants, gems, settings, tokens]) if (r.error) return fail(r.error);

      const rows = (gear.data ?? []).filter((g) => ids.has(g.player_id));
      // Items: the tier pieces' wow ids, and which off-hand items are weapons.
      const tierIds = [...new Set((tokens.data ?? []).map((t) => t.resolved_item_id))];
      const offHands = [
        ...new Set(rows.filter((g) => g.equipment_slot === 'OFF_HAND').map((g) => g.wow_item_id))
      ].filter((id): id is number => id != null);
      const [tierItems, weapons] = await Promise.all([
        tierIds.length
          ? // team-read-guard: this season's tier pieces, a few dozen
            client.from('items').select('id, wow_item_id').in('id', tierIds)
          : Promise.resolve({ data: [] as { id: number; wow_item_id: number | null }[], error: null }),
        offHands.length
          ? // team-read-guard: only the off-hand items worn on this team, a few dozen
            client.from('items').select('wow_item_id').in('wow_item_id', offHands).neq('slot', 'Off Hand')
          : Promise.resolve({ data: [] as { wow_item_id: number | null }[], error: null })
      ]);
      if (tierItems.error) return fail(tierItems.error);
      if (weapons.error) return fail(weapons.error);

      const wowOf = new Map((tierItems.data ?? []).map((i) => [i.id, i.wow_item_id]));
      const tierByClass = new Map<string, Set<number>>();
      for (const t of tokens.data ?? []) {
        const wow = wowOf.get(t.resolved_item_id);
        if (wow != null) tierByClass.set(t.class, (tierByClass.get(t.class) ?? new Set()).add(wow));
      }
      const cfg = settings.data as { enchantCheck: unknown; vaultRule: unknown } | null;
      return {
        data: {
          players,
          gear: rows,
          weeks: weeks.data ?? [],
          refs: {
            slots: (slots.data ?? []) as { slot: string; counts_from: string | null }[],
            enchants: new Map((enchants.data ?? []).map((e) => [e.enchantment_id, e])),
            gems: new Map((gems.data ?? []).map((g) => [g.wow_item_id, g]))
          },
          rule: asEnchantCheck(cfg?.enchantCheck),
          vaultRule: asVaultRule(cfg?.vaultRule),
          tierByClass,
          weaponIds: new Set((weapons.data ?? []).map((w) => w.wow_item_id).filter((id): id is number => id != null))
        },
        error: null
      };
    },
    { enabled: seasonCode !== null }
  );
}

// Item names for the gear to fix, by Blizzard item id.
export function useItemNames(wowIds: number[]) {
  const ids = [...new Set(wowIds)].sort((a, b) => a - b);
  return useSupabaseQuery<Map<number, string>>(
    ['audit-item-names', ids],
    async (client) => {
      // team-read-guard: only the item ids of one raider's gear, 16 at most
      const { data, error } = await client.from('items').select('wow_item_id, name').in('wow_item_id', ids);
      if (error) return { data: null, error };
      return {
        data: new Map(
          (data ?? []).filter((i) => i.wow_item_id != null).map((i) => [i.wow_item_id as number, i.name as string])
        ),
        error: null
      };
    },
    { enabled: ids.length > 0 }
  );
}

export const CREST_TRACKS = ['Myth', 'Hero', 'Champion', 'Veteran', 'Adventurer'] as const;

// Each crest's total cap for the week, from season_crest_cap() so the page
// and the database never disagree; null is "no cap".
export function useCrestCaps(seasonCode: string | null, week: string) {
  return useSupabaseQuery<{ track: string; cap: number | null }[]>(
    ['crest-caps', seasonCode, week],
    async (client) => {
      const answers = await Promise.all(
        CREST_TRACKS.map((track) =>
          client.rpc('season_crest_cap', { p_season: seasonCode!, p_track: track, p_week: week })
        )
      );
      const failed = answers.find((a) => a.error);
      if (failed?.error) return { data: null, error: failed.error };
      return {
        data: CREST_TRACKS.map((track, i) => ({ track, cap: (answers[i]?.data ?? null) as number | null })),
        error: null
      };
    },
    { enabled: seasonCode !== null }
  );
}

export type RaidBoss = { instance_id: number; encounter_id: number; name: string; sort_order: number };

// The season's counted raids' bosses, in the game's order (the Raids tab's columns).
export function useRaidBosses(seasonCode: string | null) {
  return useSupabaseQuery<RaidBoss[]>(
    ['audit-raid-bosses', seasonCode],
    (client) =>
      // team-read-guard: a season's raid bosses, a dozen at most
      client
        .from('season_raid_bosses')
        .select('instance_id, encounter_id, name, sort_order')
        .eq('season', seasonCode ?? '')
        .order('sort_order'),
    { enabled: seasonCode !== null }
  );
}

// Dungeon names by the id a run carries.
export function useDungeonNames() {
  return useSupabaseQuery<Map<number, string>>(['audit-dungeon-names'], async (client) => {
    const { data, error } = await readAll<{ dungeon_id: number; name: string }>((from, to) =>
      client.from('mplus_dungeons').select('dungeon_id, name').order('dungeon_id').range(from, to)
    );
    if (error) return { data: null, error };
    return { data: new Map((data ?? []).map((d) => [d.dungeon_id, d.name])), error: null };
  });
}

// Every week of the season for these characters: the Raids tab's Whole season
// and the Dungeons tab's best key per dungeon.
export function useSeasonWeeks(keys: string[], seasonStart: string | null) {
  return useSupabaseQuery<SeasonWeek[]>(
    ['audit-season-weeks', keys, seasonStart],
    (client) =>
      readAll<SeasonWeek>(
        (from, to) =>
          // The json columns come back as Json; their shapes are SeasonWeek's.
          client
            .from('character_weeks')
            .select('name_realm_key, week_of, raid_kills, mplus_runs')
            .in('name_realm_key', keys)
            .gte('week_of', seasonStart ?? '2000-01-01')
            .order('name_realm_key')
            .order('week_of')
            .range(from, to) as unknown as ReturnType<Parameters<typeof readAll<SeasonWeek>>[0]>
      ),
    { enabled: keys.length > 0 }
  );
}
