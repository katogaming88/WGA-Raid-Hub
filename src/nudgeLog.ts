import * as fs from 'fs';
import * as path from 'path';
import { NudgeCategory } from './wishlistStatus';

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

type NudgeLog = Record<string, number>;

function logKey(discordId: string, category: NudgeCategory): string {
  return `${discordId}:${category}`;
}

function readLog(logPath: string): NudgeLog {
  try {
    return JSON.parse(fs.readFileSync(logPath, 'utf8'));
  } catch {
    return {};
  }
}

function writeLog(logPath: string, log: NudgeLog): void {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, JSON.stringify(log));
}

// Filters out (discordId, category) pairs nudged within the last 24h, then
// records the categories actually sent. A raider can be re-nudged sooner for
// a category not covered by their last nudge (e.g. they just fixed their BiS
// link but are still missing a wishlist).
export function filterAndRecordNudges(
  logPath: string,
  discordId: string,
  categories: NudgeCategory[]
): NudgeCategory[] {
  const log = readLog(logPath);
  const now = Date.now();
  const due = categories.filter(cat => {
    const last = log[logKey(discordId, cat)];
    return !last || now - last >= COOLDOWN_MS;
  });
  due.forEach(cat => {
    log[logKey(discordId, cat)] = now;
  });
  if (due.length > 0) writeLog(logPath, log);
  return due;
}
