// The calendar widget on the team Home page (#1102): this month's raid nights,
// ported from the current site's computeRaidNights() and _renderCalGrid()
// (js/calendar.js) and recorded against them in tests/behavior/home.js.
//
// Raid nights are not stored one by one. They come from the team's weekly
// schedule (raid_schedule) plus one-off changes (raid_schedule_exceptions): a
// cancelled date drops that day's usual nights, an added one is an extra night.

export type ScheduleRow = { weekday: number; is_optional: boolean };
export type ExceptionRow = { raid_date: string; exception_type: string; is_optional: boolean };
export type RsvpRow = { raid_date: string; status: string };

export type Night = { date: string; optional: boolean };

// A date as YYYY-MM-DD in the reader's own calendar.
export function isoDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function monthRange(year: number, month: number) {
  return { first: isoDate(new Date(year, month, 1)), last: isoDate(new Date(year, month + 1, 0)) };
}

export function raidNights(schedule: ScheduleRow[], exceptions: ExceptionRow[], year: number, month: number): Night[] {
  const cancelled = new Set(exceptions.filter((e) => e.exception_type === 'cancelled').map((e) => e.raid_date));
  const added = new Map(exceptions.filter((e) => e.exception_type === 'added').map((e) => [e.raid_date, e]));
  const nights: Night[] = [];
  const days = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= days; day++) {
    const d = new Date(year, month, day);
    const date = isoDate(d);
    if (!cancelled.has(date)) {
      for (const rule of schedule) {
        if (rule.weekday === d.getDay()) nights.push({ date, optional: rule.is_optional });
      }
    }
    const extra = added.get(date);
    if (extra) nights.push({ date, optional: extra.is_optional });
  }
  return nights;
}

// How a day's marker reads. Absent is its own colour; Attending and
// Rotator-In read as Present; Late, Leaving Early and Tentative share the
// "still coming, but flagged" colour.
export type Tone = 'present' | 'tentative' | 'absent';

const toneOf = (status: string): Tone =>
  status === 'Absent' ? 'absent' : status === 'Attending' || status === 'Rotator-In' ? 'present' : 'tentative';

export type CalendarDay = {
  day: number;
  date: string;
  today: boolean;
  // Only on raid days.
  raid: { status: string; tone: Tone; count: string | null } | null;
};

export type CalendarMonth = {
  label: string;
  // Blank cells before the 1st, so it lands under its weekday.
  offset: number;
  days: CalendarDay[];
  legend: { label: string; tone: Tone | null }[];
};

export type RosterCounts = { roster: number; bench: number };

// One month's grid. Signed out, or with no answer of your own, a normal
// night is Present with how many are expected ("5/6": the roster less the
// bench and rotators), and an optional night is No Response, since nobody is
// expected on it until they say so. With your own answer, the day shows that
// answer instead, without the count.
export function calendarMonth(
  year: number,
  month: number,
  nights: Night[],
  counts: RosterCounts,
  mine: RsvpRow[],
  today: Date
): CalendarMonth {
  const byDate = new Map<string, Night[]>();
  for (const n of nights) byDate.set(n.date, [...(byDate.get(n.date) ?? []), n]);
  const myAnswer = new Map(mine.map((r) => [r.raid_date, r.status]));
  const attending = Math.max(0, counts.roster - counts.bench);
  const todayIso = isoDate(today);
  const used = new Map<string, Tone>();

  const days: CalendarDay[] = [];
  const length = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= length; day++) {
    const date = isoDate(new Date(year, month, day));
    const dayNights = byDate.get(date) ?? [];
    let raid: CalendarDay['raid'] = null;
    if (dayNights.length) {
      const optional = dayNights.some((n) => n.optional);
      const answer = myAnswer.get(date);
      const status = answer ?? (optional ? 'No Response' : 'Present');
      const tone: Tone = answer ? toneOf(answer) : optional ? 'tentative' : 'present';
      const count = counts.roster && !answer && !optional ? `${attending}/${counts.roster}` : null;
      if (!used.has(status)) used.set(status, tone);
      raid = { status, tone, count };
    }
    days.push({ day, date, today: date === todayIso, raid });
  }

  const legend: CalendarMonth['legend'] = [...used].map(([label, tone]) => ({ label, tone }));
  if (counts.bench) legend.push({ label: `${counts.bench} on Bench (excluded from the count above)`, tone: null });

  return {
    label: new Date(year, month, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' }),
    offset: new Date(year, month, 1).getDay(),
    days,
    legend
  };
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
