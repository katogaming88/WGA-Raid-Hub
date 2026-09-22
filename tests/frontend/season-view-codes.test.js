import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCommonJs, quietConsole } from './helpers/common-sandbox.js';

// Season View holds a season code (#933, #923). raid_zones.season is a code
// column, so the dropdown populateSeasonViewOptions() fills from it stores a
// code and shows the tier's name; resolveSeasonViewCode() returns a code on
// both of its branches, where before the explicit branch returned whatever
// the dropdown had stored; resolveSeasonView() keeps returning a name,
// because it stamps item_preferences.season, which is still keyed to
// seasons(display_name) until #936; and the scope
// check compares zones by code whether or not a Season View is set. Before
// this, a team with no Season View compared its season name against coded
// zones, matched nothing, and every raid item fell open into scope. Since
// #938 the fallback is the live tier from the seasons read, not a key on the
// team's settings.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEASON_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-season.js'), 'utf8');

// Two tiers, MID2 current; a fixture that names no tier gets these.
const TIERS = [
  { code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2026-08-11', ends_at: null },
  { code: 'MID1', display_name: 'Midnight Season 1', starts_at: '2026-03-17', ends_at: '2026-08-10' }
];

function withData(data) {
  const sandbox = loadCommonJs(quietConsole);
  sandbox.DATA = Object.assign({ seasons: TIERS }, data);
  return sandbox;
}

describe('resolveSeasonViewCode returns a code on both branches (#923)', () => {
  it('returns the stored code when Season View is set', () => {
    expect(withData({ seasonView: 'MID1' }).resolveSeasonViewCode()).toBe('MID1');
  });

  it('normalises a Season View stored as a name before the conversion', () => {
    expect(withData({ seasonView: 'Midnight Season 1' }).resolveSeasonViewCode()).toBe('MID1');
  });

  it('falls back to the live tier (#938)', () => {
    expect(withData({ seasonView: null }).resolveSeasonViewCode()).toBe('MID2');
  });

  it('is empty before the first tier has started', () => {
    expect(withData({ seasonView: null, seasons: [] }).resolveSeasonViewCode()).toBe('');
  });
});

describe('resolveSeasonView returns a name on both branches', () => {
  it('shows the tier name for a Season View stored as a code', () => {
    expect(withData({ seasonView: 'MID1' }).resolveSeasonView()).toBe('Midnight Season 1');
  });

  it("falls back to the live tier's name (#938)", () => {
    expect(withData({ seasonView: null }).resolveSeasonView()).toBe('Midnight Season 2');
  });

  it('names a Season View the seasons read does not hold by the pattern', () => {
    expect(withData({ seasonView: 'MID9', seasons: [] }).resolveSeasonView()).toBe('Midnight Season 9');
  });
});

describe('isItemInSeasonScope compares zones by code', () => {
  const zones = [
    { wclZoneId: 46, season: 'MID1' },
    { wclZoneId: 53, season: 'MID2' }
  ];

  it('scopes to the live season with no Season View set', () => {
    const sandbox = withData({
      itemPlaceholders: {},
      itemZones: { 'Old Helm': 46, 'New Helm': 53 },
      raidZones: zones
    });
    expect(sandbox.isItemInSeasonScope('New Helm')).toBe(true);
    expect(sandbox.isItemInSeasonScope('Old Helm')).toBe(false);
  });

  it('scopes to a Season View stored as a code', () => {
    const sandbox = withData({
      itemPlaceholders: {},
      itemZones: { 'Old Helm': 46, 'New Helm': 53 },
      raidZones: zones,
      seasonView: 'MID1'
    });
    expect(sandbox.isItemInSeasonScope('Old Helm')).toBe(true);
    expect(sandbox.isItemInSeasonScope('New Helm')).toBe(false);
  });

  it('still compares a placeholder row by the name stamped on it', () => {
    const sandbox = withData({
      itemPlaceholders: { 'M+': true },
      raidZones: zones,
      seasonView: 'MID2'
    });
    expect(sandbox.isItemInSeasonScope('M+', 'Midnight Season 2')).toBe(true);
    expect(sandbox.isItemInSeasonScope('M+', 'Midnight Season 1')).toBe(false);
  });
});

describe('populateSeasonViewOptions stores the code and shows the name', () => {
  function seasonTab(data) {
    const select = { innerHTML: '', value: '' };
    const sandbox = loadCommonJs(quietConsole);
    sandbox.document = {
      getElementById: (id) => (id === 'seasonViewInput' ? select : null),
      querySelectorAll: () => []
    };
    sandbox.DATA = data;
    vm.runInContext(SEASON_JS, sandbox, { filename: 'tab-season.js' });
    return { sandbox, select };
  }

  it('offers each season once, valued by code and labelled by name, in tier order', () => {
    const { sandbox, select } = seasonTab({
      raidZones: [
        { wclZoneId: 53, season: 'MID2' },
        { wclZoneId: 46, season: 'MID1' },
        { wclZoneId: 47, season: 'MID1' }
      ],
      seasonView: null
    });
    sandbox.populateSeasonViewOptions();
    expect(select.innerHTML).toBe(
      '<option value="">Live season (current)</option>' +
        '<option value="MID1">Midnight Season 1</option>' +
        '<option value="MID2">Midnight Season 2</option>'
    );
    expect(select.value).toBe('');
  });

  it('keeps the stored code selected, even when its zones are gone', () => {
    const { sandbox, select } = seasonTab({
      raidZones: [{ wclZoneId: 53, season: 'MID2' }],
      seasonView: 'MID3'
    });
    sandbox.populateSeasonViewOptions();
    expect(select.innerHTML).toContain('<option value="MID3">Midnight Season 3</option>');
    expect(select.value).toBe('MID3');
  });
});
