import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCommonJs, quietConsole } from './helpers/common-sandbox.js';

// #1108: tier_token_map carries a season. The site keeps every season's rows
// for display, counts equipped tier pieces against the season being generated
// only, warns officers when that season has no tier tokens, and refuses to
// overwrite everyone's tier count with 0 in that case.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRIORITY_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-priority.js'), 'utf8');

// Two tiers for one class, same slot. Token names differ per tier, as they do in game.
const ROWS = [
  { season: 'MID2', class: 'Mage', token: { name: 'Venomwoven Icon' }, resolved: { name: 'S2 Mage Robe' } },
  { season: 'MID3', class: 'Mage', token: { name: 'Voidwoven Icon' }, resolved: { name: 'S3 Mage Robe' } }
];

function withData(sandbox, { rows = ROWS, seasonView = 'MID3' } = {}) {
  sandbox.DATA = {
    seasonView,
    _tierTokenMapRawRows: rows,
    itemSlots: {
      'Venomwoven Icon': 'Chest',
      'Voidwoven Icon': 'Chest',
      'S2 Mage Robe': 'Chest',
      'S3 Mage Robe': 'Chest'
    },
    itemWowIds: { 'S2 Mage Robe': 2002, 'S3 Mage Robe': 3003 }
  };
  sandbox.DATA.tierTokenMap = sandbox.mapSupabaseTierTokenMap(rows).map;
  return sandbox;
}

describe('mapSupabaseTierTokenMap', () => {
  const common = loadCommonJs(quietConsole);

  it('keeps every season for display, so a past season still shows its resolved piece', () => {
    const { map, resolvedNames } = common.mapSupabaseTierTokenMap(ROWS);
    expect(map['Venomwoven Icon'].Mage).toBe('S2 Mage Robe');
    expect(map['Voidwoven Icon'].Mage).toBe('S3 Mage Robe');
    expect(Object.keys(resolvedNames).sort()).toEqual(['S2 Mage Robe', 'S3 Mage Robe']);
  });

  it('narrows to one season when asked', () => {
    const { map } = common.mapSupabaseTierTokenMap(ROWS, 'MID2');
    expect(Object.keys(map)).toEqual(['Venomwoven Icon']);
  });
});

describe('counting equipped tier pieces', () => {
  it('checks gear against the season being generated, not whichever season was seeded last', () => {
    const common = withData(loadCommonJs(quietConsole), { seasonView: 'MID2' });
    expect(common.classTierResolvedItemsBySlot('Mage')).toEqual({ Chest: 'S2 Mage Robe' });
    const wearingS2 = { chest: { item_id: 2002 } };
    expect(common.countEquippedTierPieces({ class: 'Mage' }, wearingS2)).toBe(1);

    withData(common, { seasonView: 'MID3' });
    expect(common.classTierResolvedItemsBySlot('Mage')).toEqual({ Chest: 'S3 Mage Robe' });
    expect(common.countEquippedTierPieces({ class: 'Mage' }, wearingS2)).toBe(0);
  });
});

describe('tierTokenSetupStatus', () => {
  const common = loadCommonJs(quietConsole);

  it('is ok when the season has rows, missing when it has none, unknown when the read failed', () => {
    withData(common);
    expect(common.tierTokenSetupStatus('MID3')).toBe('ok');
    expect(common.tierTokenSetupStatus('MID4')).toBe('missing');
    withData(common, { rows: null });
    expect(common.tierTokenSetupStatus('MID3')).toBe('unknown');
  });

  it('is unknown with no season code, as when the seasons read failed, rather than missing for a blank name (#938)', () => {
    withData(common);
    expect(common.tierTokenSetupStatus('')).toBe('unknown');
  });
});

function loadPriority() {
  const common = loadCommonJs(quietConsole);
  // escHtml is tab-attendance.js's, loaded before tab-priority.js on officer.html.
  common.escHtml = (s) => String(s);
  vm.runInContext(PRIORITY_JS, common, { filename: 'tab-priority.js' });
  return common;
}

describe('the Priority tab tier setup banner', () => {
  it('names the season and says what is paused when it has no tier tokens', () => {
    const tab = withData(loadPriority(), { seasonView: 'MID4' });
    const html = tab.buildPriorityTierSetupBannerHtml('missing', 'MID4');
    expect(html).toContain('role="alert"');
    expect(html).toContain('No tier tokens are set up for Midnight Season 4');
    expect(html).toContain('Sync Roster Tier Counts is paused');
  });

  it('says it could not check, rather than that nothing is set up, when the read failed', () => {
    const tab = withData(loadPriority(), { rows: null });
    expect(tab.buildPriorityTierSetupBannerHtml('unknown', 'MID3')).toContain('Could not check the tier token setup');
  });

  it('shows nothing when the season is set up, or before the map has loaded', () => {
    const tab = withData(loadPriority());
    expect(tab.buildPriorityTierSetupBannerHtml('ok', 'MID3')).toBe('');
    tab.DATA = {};
    expect(tab.buildPriorityTierSetupBannerHtml('unknown', 'MID3')).toBe('');
  });
});

describe('syncRosterTierCounts', () => {
  function syncWith({ rows, seasonView }) {
    const tab = withData(loadPriority(), { rows, seasonView });
    tab.DATA.roster = [{ firstName: 'Aeglos', realm: 'Area 52', class: 'Mage', nameRealm: 'Aeglos-Area52' }];
    const status = { textContent: '', style: {} };
    const button = { disabled: false, textContent: 'Sync Roster Tier Counts' };
    tab.document.querySelectorAll = (sel) => (sel === '.tier-sync-status' ? [status] : [button]);
    const fetched = [];
    tab.fetchRaiderIoGear = (name) => {
      fetched.push(name);
      return new Promise(() => {});
    };
    tab.syncRosterTierCounts();
    return { status, button, fetched };
  }

  it('refuses, and says why, when the season has no tier tokens, instead of writing 0 for everyone', () => {
    const { status, button, fetched } = syncWith({ rows: ROWS, seasonView: 'MID4' });
    expect(fetched).toEqual([]);
    expect(button.disabled).toBe(false);
    expect(status.textContent).toBe('Not synced: no tier tokens are set up for Midnight Season 4 yet.');
  });

  it('refuses when the setup could not be read', () => {
    const { status, fetched } = syncWith({ rows: null, seasonView: 'MID3' });
    expect(fetched).toEqual([]);
    expect(status.textContent).toContain('could not check the tier token setup');
  });

  it('runs when the season is set up', () => {
    const { fetched, button } = syncWith({ rows: ROWS, seasonView: 'MID3' });
    expect(fetched).toEqual(['Aeglos']);
    expect(button.disabled).toBe(true);
  });
});
