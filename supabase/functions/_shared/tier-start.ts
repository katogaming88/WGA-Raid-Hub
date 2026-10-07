// The reports query's window (#1269, shared since #1469): a tier's start date
// as Eastern midnight, the instant Warcraft Logs' reports(startTime:) takes.
// One read of the offset is exact at midnight because both US transitions
// happen at 2 AM local, after it. A report starting between midnight and the
// 6 a.m. cutoff on launch day is still fetched and dated the night before.
const TIER_TIME_ZONE = 'America/New_York';

export function tierStartTimeMs(startsAt: string | null): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startsAt || '');
  if (!match) return null;
  const guessUtcMs = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const parts: Record<string, string> = {};
  const fields = new Intl.DateTimeFormat('en-US', {
    timeZone: TIER_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(new Date(guessUtcMs));
  for (const part of fields) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  const wallClockAsUtcMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return guessUtcMs - (wallClockAsUtcMs - guessUtcMs);
}
