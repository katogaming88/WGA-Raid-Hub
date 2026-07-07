import { describe, it, expect } from 'vitest';

// Regression for #301: scripts/ is an ES module package ("type": "module"),
// and a stray require() made `node scripts/fetch-items.js` throw before doing
// anything. Importing the module reproduces that crash. The direct-run guard
// keeps this import from kicking off the Wowhead fetches.
describe('fetch-items module', () => {
  it('loads under ESM without executing main()', async () => {
    await expect(import('../../scripts/fetch-items.js')).resolves.toBeDefined();
  });
});
