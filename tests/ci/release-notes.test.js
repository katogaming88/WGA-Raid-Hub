import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { headingCount, releaseBlock } from '../../scripts/ci/release-notes.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'ci', 'release-notes.js');

// The body of a GitHub Release is that version's CHANGELOG block and nothing
// else (#968). The heading itself is dropped: the release is already named by
// its tag, so repeating the number reads as a mistake.
const changelog = [
  '# Changelog',
  '',
  'All notable changes will be documented here.',
  '',
  '---',
  '',
  '## [3.92.0] - 2026-09-07',
  '',
  '### Frontend',
  '',
  '- The site publishes what version it is.',
  '- Nothing visible changes anywhere else.',
  '',
  '## [3.91.3] - 2026-09-05',
  '',
  '### Backend',
  '',
  '- Officer notes move to their own table.',
  '',
  '---',
  '',
  '## [3.91.2] - 2026-09-05',
  '',
  '### Frontend',
  '',
  '- The report form sits centred.',
  ''
].join('\n');

describe('headingCount', () => {
  it('counts the one heading a version normally has', () => {
    expect(headingCount(changelog, '3.92.0')).toBe(1);
    expect(headingCount(changelog, '3.91.2')).toBe(1);
  });

  it('counts nothing for a version with no block', () => {
    expect(headingCount(changelog, '9.9.9')).toBe(0);
  });

  // Three numbers on main are used twice (3.77.23, 3.60.32, 3.60.6) because
  // nothing checked uniqueness until #966. A tag names one commit, so a
  // duplicate has to stop the release rather than pick a block at random.
  it('counts both blocks when a number was issued twice', () => {
    const twice = changelog.replace(
      '## [3.91.3] - 2026-09-05',
      '## [3.92.0] - 2026-09-06\n\n### Backend\n\n- A second block, same number.\n\n## [3.91.3] - 2026-09-05'
    );
    expect(headingCount(twice, '3.92.0')).toBe(2);
  });

  it('does not match a version that merely starts the same', () => {
    expect(headingCount(changelog, '3.9')).toBe(0);
    expect(headingCount(changelog, '3.91')).toBe(0);
  });
});

describe('releaseBlock', () => {
  it('returns the block below the heading, without the heading', () => {
    expect(releaseBlock(changelog, '3.92.0')).toBe(
      ['### Frontend', '', '- The site publishes what version it is.', '- Nothing visible changes anywhere else.'].join(
        '\n'
      )
    );
  });

  it('stops at the next version heading', () => {
    expect(releaseBlock(changelog, '3.91.3')).toBe(
      ['### Backend', '', '- Officer notes move to their own table.'].join('\n')
    );
  });

  // The file separates some blocks with a --- rule and others with nothing.
  // Either way the rule belongs to the layout, not to the release notes.
  it('drops a trailing horizontal rule and the blank lines around it', () => {
    expect(releaseBlock(changelog, '3.91.3')).not.toContain('---');
  });

  it('reads the last block in the file, which no heading follows', () => {
    expect(releaseBlock(changelog, '3.91.2')).toBe(['### Frontend', '', '- The report form sits centred.'].join('\n'));
  });

  it('returns null for a version with no block', () => {
    expect(releaseBlock(changelog, '9.9.9')).toBe(null);
  });
});

describe('the real CHANGELOG', () => {
  const real = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');

  it('yields a non-empty block for the version this repo is at', () => {
    const version = JSON.parse(readFileSync(join(ROOT, 'version.json'), 'utf8')).version;
    expect(headingCount(real, version)).toBe(1);
    const block = releaseBlock(real, version);
    expect(block).toBeTruthy();
    expect(block.startsWith('###')).toBe(true);
  });

  // Named so the three known collisions stay visible rather than becoming a
  // surprise the first time one of them is re-released.
  it('still carries the three numbers that were issued twice', () => {
    for (const version of ['3.77.23', '3.60.32', '3.60.6']) {
      expect(headingCount(real, version)).toBe(2);
    }
  });
});

describe('the CLI', () => {
  function run(args) {
    try {
      return { code: 0, out: execFileSync('node', [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' }) };
    } catch (err) {
      return { code: err.status, out: err.stdout ?? '', err: err.stderr ?? '' };
    }
  }

  it('prints the block for a version that has exactly one', () => {
    const result = run(['3.91.2']);
    expect(result.code).toBe(0);
    expect(result.out).toContain('###');
  });

  it('refuses a version whose number was issued twice', () => {
    const result = run(['3.60.6']);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/twice|duplicate/i);
  });

  it('refuses a version with no block at all', () => {
    const result = run(['9.9.9']);
    expect(result.code).toBe(1);
  });
});
