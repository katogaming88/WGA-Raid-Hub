// The one place the app formats a date or a time. Nothing else under app/src
// may call Intl.DateTimeFormat or toLocale*String; tests/ci/app-date-format-check
// fails if it does. Mirrors #905 on the current site (js/common.js).
//
// Two kinds of value, two rules:
//
// 1. A guild-calendar date: a raid night, an award, a kill, a news entry.
//    It belongs to the guild's calendar, so it reads the same for everyone.
//    Eastern is where the raids happen, so an award late on raid night keeps
//    that night's date wherever the reader is. No zone note is needed.
//    Use easternToday, awardDate, isoDateLong, isoDateShort, calendarDay, monthLabel.
//
// 2. An instant: something that happened at a moment (RSVP changed, listed,
//    link expires). It shows in the viewer's own zone, and the page that shows
//    one must also show localTimeZoneNote() so the reader knows which zone
//    they are reading. Use formatInstant, formatInstantDate, formatInstantShort.

const eastern = { timeZone: 'America/New_York' } as const;

const AWARD = new Intl.DateTimeFormat('en-US', { ...eastern, month: 'short', day: 'numeric', year: 'numeric' });
const EASTERN_ISO = new Intl.DateTimeFormat('en-CA', eastern);
const ISO_LONG = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
const ISO_SHORT = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });

const CALENDAR_DAY = {
  weekday: new Intl.DateTimeFormat('en-US', { weekday: 'long' }),
  long: new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
  short: new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
};
const MONTH = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });

const INSTANT_SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const INSTANT_DATE = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Today's date (YYYY-MM-DD) in Eastern; the same calendar the database's
// current_season() reads.
export const easternToday = (): string => EASTERN_ISO.format(new Date());

// "Aug 27, 2026" for an award or received-at instant, on Eastern time.
export const awardDate = (instant: string): string => AWARD.format(new Date(instant));

// "Apr 2, 2026" for a stored YYYY-MM-DD; anything else (an officer typed it
// by hand) comes back as written.
export const isoDateLong = (value: string): string =>
  ISO_DATE.test(value) ? ISO_LONG.format(new Date(`${value}T00:00:00Z`)) : value;

// "Sep 7", same fallback.
export const isoDateShort = (value: string): string =>
  ISO_DATE.test(value) ? ISO_SHORT.format(new Date(`${value}T00:00:00Z`)) : value;

// A calendar day built from local parts (new Date(y, m, d)), so no zone shift.
export const calendarDay = (day: Date, style: keyof typeof CALENDAR_DAY): string => CALENDAR_DAY[style].format(day);

export const monthLabel = (year: number, month: number): string => MONTH.format(new Date(year, month, 1));

// "Aug 27, 2026, 3:04 PM" in the viewer's own locale and zone; '' for empty or
// unparseable input.
export function formatInstant(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// "Aug 27, 2026" for an instant, in the viewer's own zone.
export const formatInstantDate = (instant: string | Date): string => INSTANT_DATE.format(new Date(instant));

// "Aug 27" for an instant, in the viewer's own zone.
export const formatInstantShort = (instant: string): string => INSTANT_SHORT.format(new Date(instant));

// The line every page that shows an instant carries (#905): the viewer's zone
// by its short name and its IANA name, read from the browser.
export function localTimeZoneNote(): string {
  try {
    const iana = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const short = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value;
    if (iana && short) return `Times are shown in your time zone: ${short} (${iana}).`;
  } catch {
    // An engine without Intl zone support: the note still says the times are local.
  }
  return 'Times are shown in your own time zone.';
}
