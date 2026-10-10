// The officers' "Needs a look" box above the roster (#1360 part 2): one line
// per raider that wants an officer, by the current site's two checks
// (tab-roster.js buildTrialPromoAlert, #78, and buildOnboardingAlert, #478).
// Main swap requests join the same box, read on their own (#631).

import { easternToday } from '../lib/dates';
import type { OfficerStats, Raider } from './roster';

export type LookLine = {
  key: string;
  playerId: number;
  name: string;
  className: string;
  text: string;
  promote: boolean;
};

const DAY = 86400000;
const daysSince = (date: string, today: string) => Math.floor((Date.parse(today) - Date.parse(date)) / DAY);

// Someone who joined in the last 30 days, after this season's first raid
// night, once that night has passed. A veteran who joined before the season
// is not new, and before the first night nobody is expected to have a
// wishlist yet. Maps each to the days since they joined.
export function newJoiners(
  players: { id: number; join_date?: string | null }[],
  seasonStart: string | null,
  today = easternToday()
): Map<number, number> {
  const out = new Map<number, number>();
  if (!seasonStart || today < seasonStart) return out;
  for (const p of players) {
    if (!p.join_date || p.join_date < seasonStart) continue;
    const days = daysSince(p.join_date, today);
    if (days >= 0 && days <= 30) out.set(p.id, days);
  }
  return out;
}

const joinedAgo = (days: number) =>
  days === 0 ? 'Joined today' : days === 1 ? 'Joined yesterday' : `Joined ${days} days ago`;

// Trials past both thresholds in Settings (weeks on the roster, this
// season's attendance), longest first; then new joiners with no wishlist
// row this season, newest first. A trial whose attendance is not known yet
// is left out rather than guessed at.
export function needsALook(
  raiders: Raider[],
  joinDates: Map<number, string | null>,
  stats: Map<number, OfficerStats> | null,
  trial: { weeks: number; attend: number },
  joiners: Map<number, number>,
  wishlistStarted: ReadonlySet<number> | null,
  today = easternToday()
): LookLine[] {
  const ready: { line: LookLine; days: number }[] = [];
  const noWishlist: { line: LookLine; days: number }[] = [];
  for (const r of raiders) {
    if (r.playerId === null) continue;
    const id = r.playerId;
    const joined = joinDates.get(id);
    const pct = stats?.get(id)?.attendancePct;
    if (r.statuses.includes('Trial') && joined && pct !== undefined) {
      const days = daysSince(joined, today);
      if (days >= trial.weeks * 7 && pct >= trial.attend) {
        const weeks = Math.floor(days / 7);
        ready.push({
          line: {
            key: `promote-${id}`,
            playerId: id,
            name: r.name,
            className: r.className,
            text: `Trial for ${weeks} weeks at ${Math.round(pct)}% attendance: ready to promote.`,
            promote: true
          },
          days
        });
      }
    }
    const days = joiners.get(id);
    if (days !== undefined && wishlistStarted && !wishlistStarted.has(id)) {
      noWishlist.push({
        line: {
          key: `wishlist-${id}`,
          playerId: id,
          name: r.name,
          className: r.className,
          text: `${joinedAgo(days)} and hasn't started a wishlist.`,
          promote: false
        },
        days
      });
    }
  }
  ready.sort((a, b) => b.days - a.days);
  noWishlist.sort((a, b) => a.days - b.days);
  return [...ready, ...noWishlist].map((x) => x.line);
}
