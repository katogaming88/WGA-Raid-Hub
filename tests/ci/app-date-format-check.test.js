import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The new app's half of #905 (#1184): every date and time under app/src is
// formatted by app/src/lib/dates.ts, which also holds the rule for guild
// calendar dates versus instants. A bare Intl.DateTimeFormat or a date-shaped
// toLocale*() anywhere else fails here. Number formatting (toLocaleString on a
// gold amount) is not a date and is allowed.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '../..');
const SRC = path.join(ROOT, 'app/src');
const HELPER = 'app/src/lib/dates.ts';

function list(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) list(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const BARE = [
  /\bIntl\.DateTimeFormat\b/,
  /\.toLocale(?:Date|Time)String\(/,
  /\.toLocaleString\([^)]*\b(?:dateStyle|timeStyle|weekday|month|year|day|hour)\b/
];

export function findBareDateFormats(src, file) {
  const findings = [];
  src.split('\n').forEach((line, i) => {
    if (BARE.some((rx) => rx.test(line))) findings.push({ file, line: i + 1, text: line.trim() });
  });
  return findings;
}

describe('app date-format-check (#1184)', () => {
  const files = list(SRC).map((p) => ({
    file: path.relative(ROOT, p).split(path.sep).join('/'),
    src: readFileSync(p, 'utf8')
  }));

  it('formats every date and time through app/src/lib/dates.ts', () => {
    const findings = files
      .filter(({ file }) => file !== HELPER && !file.endsWith('.test.ts') && !file.endsWith('.test.tsx'))
      .flatMap(({ file, src }) => findBareDateFormats(src, file));
    expect(
      findings.map((f) => `${f.file}:${f.line} ${f.text}`),
      'bare date formatting; use a helper from app/src/lib/dates.ts (read the rule at its top)'
    ).toEqual([]);
  });

  it('flags the shapes it exists to catch', () => {
    expect(findBareDateFormats("new Intl.DateTimeFormat('en-US')", 'x')).toHaveLength(1);
    expect(findBareDateFormats('d.toLocaleDateString()', 'x')).toHaveLength(1);
    expect(findBareDateFormats("d.toLocaleString(undefined, { dateStyle: 'medium' })", 'x')).toHaveLength(1);
    expect(findBareDateFormats("n.toLocaleString('en-US')", 'x')).toEqual([]);
  });
});
