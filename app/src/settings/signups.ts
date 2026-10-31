// Settings > Signups (#1342): which seasons a team can open signups for. Kept
// apart from the page so the date rules are tested without rendering. The
// team leader closes signups whenever they choose (#1714).

export type SignupSeason = {
  code: string;
  name: string;
  // Null until Blizzard dates the season (#1714).
  startsAt: string | null;
  endsAt: string | null;
  open: boolean;
};

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// A season that has started takes no new signups (declare_season_signup()),
// so there is nothing to open it for. An undated season has not started.
export const hasStarted = (season: SignupSeason, today: string): boolean =>
  season.startsAt !== null && season.startsAt <= today;

// The seasons worth showing: any not yet started, and any with signups still
// open (Midnight Season 2 is started and still open on two teams), in the
// order given: soonest first, an undated season last.
export function signupSeasons(
  seasons: { code: string; display_name: string; starts_at: string | null; ends_at: string | null }[],
  openCodes: ReadonlySet<string>,
  today: string
): SignupSeason[] {
  return seasons
    .map((s) => ({
      code: s.code,
      name: s.display_name,
      startsAt: s.starts_at,
      endsAt: s.ends_at,
      open: openCodes.has(s.code)
    }))
    .filter((s) => s.open || !hasStarted(s, today));
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
