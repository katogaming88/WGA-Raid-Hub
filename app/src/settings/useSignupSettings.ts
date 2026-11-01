import { useSupabaseMutation, useSupabaseQuery } from '../data/query';
import { easternToday } from '../lib/dates';
import { visibleSeasons } from '../profile/profile';
import { signupSeasons, type PromotionPreview, type SignupSeason } from './signups';

const settingsKey = (teamId: number) => ['signup-settings', teamId] as const;

// The seasons a team sees (started ones plus the next, #1714), and which of
// them this team has signups open for (#939: one team_seasons row per season,
// no row means closed).
export function useSignupSettings(teamId: number) {
  return useSupabaseQuery<SignupSeason[]>(settingsKey(teamId), async (client) => {
    const [seasons, rows] = await Promise.all([
      client
        .from('seasons')
        .select('code, display_name, starts_at, ends_at')
        .order('starts_at', { nullsFirst: false })
        .order('position'),
      // team-read-guard: one row per season the team has, a handful
      client.from('team_seasons').select('season_code, signups_open').eq('team_id', teamId)
    ]);
    if (seasons.error) return { data: null, error: seasons.error };
    if (rows.error) return { data: null, error: rows.error };
    const open = new Set((rows.data ?? []).filter((r) => r.signups_open).map((r) => r.season_code));
    const today = easternToday();
    return { data: signupSeasons(visibleSeasons(seasons.data ?? [], today), open, today), error: null };
  });
}

// Everything that changes when signups open or close: this page, the Roster's
// Projected Roster tab and its name, and, on a close, the roster itself.
const refreshes = (teamId: number) => [
  settingsKey(teamId),
  ['signup-seasons', teamId],
  ['incoming-roster', teamId],
  ['signup-flags', teamId]
];

// The team leader opens signups for a season (set_team_season(), which
// writes the audit row).
export function useOpenSignups(teamId: number) {
  return useSupabaseMutation<null, { season: string }>(
    async (client, { season }) => {
      const result = await client.rpc('set_team_season', {
        p_team_id: teamId,
        p_season_code: season,
        p_signups_open: true
      });
      return { data: null, error: result.error };
    },
    { key: ['open-signups', teamId], refreshes: refreshes(teamId) }
  );
}

// What closing signups would do (#1467), read when the close dialog opens.
export function usePromotionPreview(teamId: number, season: string) {
  return useSupabaseQuery<PromotionPreview>(['promotion-preview', teamId, season], async (client) => {
    const result = await client.rpc('preview_signup_promotion', { p_team_id: teamId, p_season: season });
    return { data: (result.data as PromotionPreview | null) ?? null, error: result.error };
  });
}

// Closing signups: everyone in the preview goes on the roster, the ticked
// characters come off it, and signups close, in one step. Refused, with
// nothing changed, if anything moved since the preview was read.
export function useCloseSignups(teamId: number) {
  return useSupabaseMutation<null, { season: string; expected: string; archive: number[] }>(
    async (client, { season, expected, archive }) => {
      const result = await client.rpc('promote_season_signups', {
        p_team_id: teamId,
        p_season: season,
        p_expected: expected,
        p_archive_player_ids: archive
      });
      return { data: null, error: result.error };
    },
    {
      key: ['close-signups', teamId],
      refreshes: [
        ...refreshes(teamId),
        ['roster', teamId],
        ['archived', teamId],
        ['names', teamId],
        ['team-alts', teamId],
        ['promotion-preview', teamId]
      ]
    }
  );
}
