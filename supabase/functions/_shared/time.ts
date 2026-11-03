// Wall-clock times in a named zone, without a date library (#960). The signup
// sheet and the optional-night reminders both turn a raid's date, start time
// and time zone into an instant; this was two verbatim copies before.

// "Format the guess, diff against the wall-clock target, correct once": the
// instant at which `time` on `raidDate` reads on a clock in `timeZone`.
export function zonedTimeToUtc(raidDate: string, time: string, timeZone: string): Date {
  const [year, month, day] = raidDate.split('-').map(Number);
  const [hour, minute, second] = time.split(':').map(Number);
  const guessUtcMs = Date.UTC(year, month - 1, day, hour, minute, second || 0);
  const parts = clockParts(new Date(guessUtcMs), timeZone);
  const asIfUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return new Date(guessUtcMs - (asIfUtcMs - guessUtcMs));
}

// What a clock in `timeZone` reads at `at`, as 'HH:MM:SS' (Postgres's time).
export function clockTime(at: Date, timeZone: string): string {
  const p = clockParts(at, timeZone);
  return [p.hour, p.minute, p.second].map((n) => String(n).padStart(2, '0')).join(':');
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// 0 = Sunday, as raid_schedule.weekday and Postgres's dow count.
export function weekdayOf(raidDate: string): number {
  return new Date(raidDate + 'T00:00:00Z').getUTCDay();
}

function clockParts(at: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const parts: Record<string, number> = {};
  for (const part of dtf.formatToParts(at)) if (part.type !== 'literal') parts[part.type] = Number(part.value);
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    // Some engines print midnight as 24.
    hour: parts.hour === 24 ? 0 : parts.hour,
    minute: parts.minute,
    second: parts.second
  };
}
