import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// js/admin.js is standalone on purpose: admin.html loads neither common.js nor
// discord.js, because both are built around a single active team and that page
// is not scoped to one. The cost is a second copy of the Supabase client setup,
// and #1052 turned that copy from two literals into a rule.
//
// Two copies of a rule drift, and this one drifts silently: the admin dashboard
// would keep talking to production from a page served locally, which reads as
// "the local stack is broken" rather than as a stale copy. So the block is
// fenced by markers in both files and asserted identical here, rather than
// asserting the resolved values twice.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const START = '// supabase-target:start';
const END = '// supabase-target:end';

function block(file) {
  const source = readFileSync(join(ROOT, file), 'utf8');
  const from = source.indexOf(START);
  const to = source.indexOf(END);
  if (from === -1 || to === -1) {
    throw new Error(`${file} is missing the ${START} / ${END} markers around the Supabase target block`);
  }
  if (to < from) throw new Error(`${file} has the target markers in the wrong order`);
  return source
    .slice(from + START.length, to)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

describe('the Supabase target block is one rule in two files (#1052)', () => {
  it('is present in both entry points', () => {
    expect(block('js/common.js').length).toBeGreaterThan(0);
    expect(block('js/admin.js').length).toBeGreaterThan(0);
  });

  it('is textually identical between them', () => {
    expect(block('js/admin.js')).toBe(block('js/common.js'));
  });

  it('names both local spellings and neither key inline twice', () => {
    // A guard on the guard: an empty or trivial block would satisfy the
    // equality above while resolving nothing.
    const text = block('js/common.js');
    expect(text).toContain("'localhost'");
    expect(text).toContain("'127.0.0.1'");
    expect(text).toContain('54321');
  });
});
