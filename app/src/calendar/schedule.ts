// The officer's raid schedule (#1361), ported from the current site's Schedule
// tab (js/tabs/tab-schedule.js): the team default difficulty, the weekly
// nights, and one-off changes made from a night's own page. Pure helpers here;
// the reads and writes are in useSchedule.ts.

export const DIFFICULTIES = ['heroic', 'mythic', 'heroic_into_mythic'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  heroic: 'Heroic',
  mythic: 'Mythic',
  heroic_into_mythic: 'Heroic into Mythic'
};

export const asDifficulty = (value: string | null | undefined): Difficulty | null =>
  DIFFICULTIES.includes(value as Difficulty) ? (value as Difficulty) : null;

// What "Team default" means right now, shown in every weekly night's choice so
// a night set to something else stands out.
export const defaultLabel = (teamDefault: Difficulty | null) =>
  `Team default (${teamDefault ? DIFFICULTY_LABELS[teamDefault] : 'not set'})`;

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Every team raids on Eastern today; the others are here so a team elsewhere
// can say so. A row saved with another zone keeps it as an extra choice.
export const TIMEZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'];

// One weekly night as the editor reads it.
export type WeeklyNight = {
  id: number;
  weekday: number;
  start_time: string;
  timezone: string;
  duration_minutes: number;
  active: boolean;
  is_optional: boolean;
  difficulty: string | null;
};

// The editable copy of a weekly night. `id` is null until a new night saves.
export type NightDraft = {
  id: number | null;
  weekday: number;
  start: string;
  duration: string;
  timezone: string;
  optional: boolean;
  active: boolean;
  difficulty: Difficulty | null;
};

// Postgres hands a time back as "HH:MM:SS"; a time input wants "HH:MM".
export const timeInput = (time: string | null) => (time ?? '').slice(0, 5);

export const draftOf = (n: WeeklyNight): NightDraft => ({
  id: n.id,
  weekday: n.weekday,
  start: timeInput(n.start_time),
  duration: String(n.duration_minutes),
  timezone: n.timezone,
  optional: n.is_optional,
  active: n.active,
  difficulty: asDifficulty(n.difficulty)
});

// A new weekly night starts where the current site's did: 8 PM Eastern, three
// hours, following the team default.
export const NEW_NIGHT: NightDraft = {
  id: null,
  weekday: 2,
  start: '20:00',
  duration: '180',
  timezone: 'America/New_York',
  optional: false,
  active: true,
  difficulty: null
};

export const sameDraft = (a: NightDraft, b: NightDraft) =>
  a.weekday === b.weekday &&
  a.start === b.start &&
  a.duration === b.duration &&
  a.timezone === b.timezone &&
  a.optional === b.optional &&
  a.active === b.active &&
  a.difficulty === b.difficulty;

// Why a weekly night cannot save yet, or null when it can.
export function draftProblem(d: NightDraft): string | null {
  const minutes = Number(d.duration);
  if (!d.start) return 'Give the night a start time.';
  if (!Number.isInteger(minutes) || minutes < 15) return 'A night is at least 15 minutes long.';
  if (!d.timezone.trim()) return 'Choose a timezone.';
  return null;
}

// The row a weekly night saves as.
export const nightRow = (d: NightDraft) => ({
  weekday: d.weekday,
  start_time: d.start,
  duration_minutes: Number(d.duration),
  timezone: d.timezone.trim(),
  is_optional: d.optional,
  active: d.active,
  difficulty: d.difficulty
});

// The audit log line the current site writes for a weekly night, word for
// word, so the Audit log reads the same whichever site made the change.
export const nightAuditDetail = (d: NightDraft) =>
  `${WEEKDAY_NAMES[d.weekday]} ${d.start}${d.optional ? ' (optional)' : ''}${
    d.difficulty ? ` (${DIFFICULTY_LABELS[d.difficulty]})` : ''
  }${d.active ? '' : ' (inactive)'}`;

// A one-off extra night added from an empty day. It must name its difficulty:
// an extra night is often not what the team usually runs, such as a Monday
// Heroic reclear or extra Mythic progression (Kat, 2026-10-06).
export type ExtraNight = {
  start: string;
  duration: string;
  difficulty: Difficulty | null;
  optional: boolean;
  note: string;
};

export const NEW_EXTRA_NIGHT: ExtraNight = {
  start: '20:00',
  duration: '180',
  difficulty: null,
  optional: false,
  note: ''
};

export function extraNightProblem(n: ExtraNight): string | null {
  if (!n.difficulty) return 'Choose what this night is for: Heroic, Mythic, or Heroic into Mythic.';
  const minutes = Number(n.duration);
  if (!n.start) return 'Give the night a start time.';
  if (!Number.isInteger(minutes) || minutes < 15) return 'A night is at least 15 minutes long.';
  return null;
}
