import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// validateCharName() used to test the first letter against [A-Z], so a name
// starting with an accented capital (Éleanor) was rejected as "must start
// with a capital letter" on both the signup form and Add Player.

const COMMON_JS = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../js/common.js'), 'utf8');

function loadCommonJs() {
  const sandbox = {
    window: {},
    location: { search: '', pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { getElementById: () => null, createElement: () => ({}), head: { appendChild: () => {} } },
    console,
    Intl,
    setTimeout,
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  return sandbox;
}

describe('validateCharName', () => {
  const { validateCharName } = loadCommonJs();

  it('accepts a plain capitalized name', () => {
    expect(validateCharName('Katorri')).toBeNull();
  });

  it('accepts a name starting with an accented capital', () => {
    expect(validateCharName('Éleanor')).toBeNull();
    expect(validateCharName('Ølaf')).toBeNull();
  });

  it('accepts accented lowercase letters after the first', () => {
    expect(validateCharName('Zoë')).toBeNull();
  });

  it('rejects a lowercase or accented lowercase first letter', () => {
    expect(validateCharName('katorri')).toMatch(/must start with a capital/);
    expect(validateCharName('éleanor')).toMatch(/must start with a capital/);
  });

  it('rejects an accented capital after the first letter', () => {
    expect(validateCharName('KatÉrri')).toMatch(/only have one capital/);
  });
});
