import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #1268: the Reports tab's BiS demand table. bis_demand_vs_awards hands back
// one row per item and season, demand and awards both from that season, so
// the table is the picked season's rows and nothing from any other season.
//
// First test over js/tabs/tab-reports.js. The file runs nothing at load, so a
// bare context with the two elements the table reads is enough.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-reports.js'), 'utf8');
const NAMES = { MID1: 'Midnight Season 1', MID2: 'Midnight Season 2' };

function renderFor(season, rows) {
  const els = { reportsBisSeasonFilter: { value: season }, reportsBisDemandContent: { innerHTML: '' } };
  const sandbox = {
    document: { getElementById: (id) => els[id] },
    seasonDisplayName: (code) => NAMES[code] || null
  };
  vm.createContext(sandbox);
  vm.runInContext(REPORTS_JS, sandbox);
  sandbox.REPORTS_STATE.bisDemandRows = rows;
  sandbox.renderBisDemandTable();
  return els.reportsBisDemandContent.innerHTML;
}

const row = (item_id, item_name, season, demand_count, awarded_count) => ({
  team_id: 1,
  item_id,
  item_name,
  slot: 'Back',
  season,
  demand_count,
  awarded_count
});

const ROWS = [
  row(10, 'Silken Voodoo Drape', 'MID2', 22, 5),
  row(10, 'Silken Voodoo Drape', 'MID1', 1, 0),
  row(11, 'Vile Alchemist Band', 'MID2', 16, 3),
  row(12, 'Old Tier Cloak', 'MID1', 4, 2)
];

const cells = (name, demand, awarded) => `<td>${name}</td><td>Back</td><td>${demand}</td><td>${awarded}</td>`;

describe('the BiS demand table reads the season picked (#1268)', () => {
  it("shows the picked season's demand and awards and no other season's items", () => {
    const html = renderFor('MID1', ROWS);
    expect(html).toContain(cells('Silken Voodoo Drape', 1, 0));
    expect(html).toContain(cells('Old Tier Cloak', 4, 2));
    expect(html).not.toContain('Vile Alchemist Band');
  });

  it('reads the live season the same way', () => {
    const html = renderFor('MID2', ROWS);
    expect(html).toContain(cells('Silken Voodoo Drape', 22, 5));
    expect(html).toContain(cells('Vile Alchemist Band', 16, 3));
    expect(html).not.toContain('Old Tier Cloak');
  });

  it('names the season when nobody on the roster wants anything in it', () => {
    const html = renderFor(
      'MID1',
      ROWS.filter((r) => r.season === 'MID2')
    );
    expect(html).toContain('No BiS demand recorded for Midnight Season 1 on the active roster.');
    expect(html).not.toContain('Silken Voodoo Drape');
  });
});
