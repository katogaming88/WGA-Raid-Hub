// Settings > Signups (#1342): which seasons a team can open signups for, and
// when the team leader can close them. Kept apart from the page so the date
// rules are tested without rendering.

export type SignupSeason = {
  code: string;
  name: string;
  startsAt: string;
  endsAt: string | null;
  open: boolean;
};

// Closing signups (#1467) is refused until 14 days before the season starts
// (#648); the page says so instead of offering a Close that fails.
export const CLOSE_WINDOW_DAYS = 14;

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const closeOpensOn = (season: SignupSeason): string => addDays(season.startsAt, -CLOSE_WINDOW_DAYS);

export const canClose = (season: SignupSeason, today: string): boolean => today >= closeOpensOn(season);

// A season that has started takes no new signups (declare_season_signup()),
// so there is nothing to open it for.
export const hasStarted = (season: SignupSeason, today: string): boolean => season.startsAt <= today;

// The seasons worth showing: any not yet started, and any with signups still
// open (Midnight Season 2 is started and still open on two teams). Soonest
// first.
export function signupSeasons(
  seasons: { code: string; display_name: string; starts_at: string | null; ends_at: string | null }[],
  openCodes: ReadonlySet<string>,
  today: string
): SignupSeason[] {
  // A season with no date yet (#1717) is left out until #1714 shows one.
  return seasons
    .filter((s): s is typeof s & { starts_at: string } => s.starts_at !== null)
    .map((s) => ({
      code: s.code,
      name: s.display_name,
      startsAt: s.starts_at,
      endsAt: s.ends_at,
      open: openCodes.has(s.code)
    }))
    .filter((s) => s.open || !hasStarted(s, today))
    .sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
}

// What the page opens on: a season with signups open, else the next one.
export const defaultSeason = (seasons: SignupSeason[]): SignupSeason | null =>
  seasons.find((s) => s.open) ?? seasons[0] ?? null;

// preview_signup_promotion()'s answer, as the close dialog reads it.
export type PromotionEntry = {
  signup_id?: number;
  player_id?: number;
  name_realm: string;
  from_player_id?: number;
  from_name_realm?: string;
  reason?: 'several_characters' | 'character_taken';
};

export type PromotionPreview = {
  expected: string;
  stays: PromotionEntry[];
  joins: PromotionEntry[];
  swaps: PromotionEntry[];
  first_mains: PromotionEntry[];
  archives: PromotionEntry[];
  skipped: PromotionEntry[];
};

export const SKIP_REASONS: Record<NonNullable<PromotionEntry['reason']>, string> = {
  several_characters: 'has more than one character on the roster; pick which one this replaces by hand',
  character_taken: 'another signup uses the same character; settle the two by hand'
};
