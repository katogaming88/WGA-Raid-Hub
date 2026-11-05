// RSVP changes posted in a batch (#1710). A team picks, on Settings › Discord,
// whether each change posts as it happens, once a day, or a set number of
// hours before each raid. No I/O here: handler.ts reads the raid's start and
// hands it over.
//
// When a queued change is due is a pure function of when it was made and the
// team's setting, so the drain can ask again on every pass and a row that was
// held comes up due once its time arrives.
import { EMBED_FIELD_VALUE_MAX, truncate } from '../_shared/discord-text.ts';
import { isoDate, zonedTimeToUtc } from '../_shared/time.ts';
import { type Field, type Message, type Payload, mentions } from './posts.ts';

export type RsvpTiming = { when: 'daily'; time: string; timezone: string } | { when: 'before_raid'; hours: number };

const DAY_MS = 86_400_000;

// The next time after `after` that it is `time` on the clock in `timezone`.
function nextDaily(after: Date, time: string, timezone: string): Date {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(after);
  const first = zonedTimeToUtc(today, time, timezone);
  if (first.getTime() > after.getTime()) return first;
  return zonedTimeToUtc(isoDate(new Date(Date.parse(today + 'T00:00:00Z') + DAY_MS)), time, timezone);
}

// When a change made at `madeAt` for the raid on `raidDate`, starting at
// `raidStart` (null when the night has no start time), posts. At or before
// madeAt means at once: the team posts as it happens, or the raid starts before
// the next batched post.
//
// A night with no start time has nothing to count hours back from, so it posts
// at once. A daily post counts from the first moment of the raid's date: earlier
// days wait for the batch, and a sign-off on the day itself is never held back.
export function dueAt(timing: RsvpTiming | null, madeAt: Date, raidStart: Date | null, raidDate: string): Date {
  if (!timing) return madeAt;
  if (timing.when === 'before_raid') {
    if (!raidStart) return madeAt;
    const due = new Date(raidStart.getTime() - timing.hours * 3_600_000);
    return due.getTime() <= madeAt.getTime() ? madeAt : due;
  }
  const due = nextDaily(madeAt, timing.time, timing.timezone);
  const starts = raidStart ?? zonedTimeToUtc(raidDate, '00:00:00', timing.timezone);
  return starts.getTime() <= due.getTime() ? madeAt : due;
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

// The longest note and name a line shows; the full note is on the site.
const NOTE_MAX = 100;
const NAME_MAX = 64;

// One post for a team's due changes: a field per raid night, a line per
// raider. A raider who changed twice shows their last answer. A night too long
// for one field carries on in another, so nobody is cut.
//
// A claim is at most 25 rows, so at most 25 lines and 25 fields. With the caps
// above the whole post stays under Discord's 6000 characters, which it would
// otherwise refuse on every try, losing the changes.
export function buildRsvpDigest(rows: Payload[], roleId: string | null): Message {
  const nights = new Map<string, Map<string, string>>();
  for (const p of rows) {
    const raidDate = text(p.raidDate);
    const name = text(p.charName);
    if (!raidDate || !name) continue;
    const note = truncate(text(p.note), NOTE_MAX);
    const line = `${truncate(name, NAME_MAX)}: ${text(p.status)}${note ? ` (${note})` : ''}`;
    const night = nights.get(raidDate) ?? new Map<string, string>();
    night.delete(name); // a later answer goes last
    night.set(name, line);
    nights.set(raidDate, night);
  }
  const fields: Field[] = [];
  for (const date of [...nights.keys()].sort()) {
    let value = '';
    let first = true;
    const flush = () => {
      fields.push({ name: first ? date : `${date} (continued)`, value });
      first = false;
    };
    for (const line of nights.get(date)!.values()) {
      if (value && value.length + 1 + line.length > EMBED_FIELD_VALUE_MAX) {
        flush();
        value = '';
      }
      value += (value ? '\n' : '') + line;
    }
    flush();
  }
  const embed = {
    color: 0xe0c23d,
    title: 'Raid RSVP Updates',
    fields,
    footer: { text: 'Raid Calendar' }
  };
  return {
    ...(roleId ? { content: `<@&${roleId}> RSVP changes` } : {}),
    embeds: [embed],
    allowed_mentions: mentions(roleId)
  };
}
