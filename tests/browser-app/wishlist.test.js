import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { launchBrowser, openApp, startApp, storedSession } from './harness.js';
import { VIEWERS } from '../behavior/profile.js';
import {
  EARLIER_SEASON,
  EXPECTED_EDITOR,
  ITEMS,
  NEW_BIS_ROW,
  NEXT_RAID_ZONE,
  NEXT_SEASON,
  NEXT_SEASON_HELM,
  PINNED_ELSEWHERE,
  RAID_ZONES,
  SEASON,
  TIER_TOKEN_MAP,
  TORBJORN,
  WISHLIST
} from '../behavior/wishlist.js';

// The new app's wishlist editor against the behavior recorded from the current
// site (tests/browser/wishlist-recorded.test.js, #868 part 3).

function signedIn(viewerKey) {
  const viewer = VIEWERS[viewerKey];
  const p = viewer.player;
  return {
    session: storedSession({ battlenet: `${p.name_realm}#1`, discord: p.name_realm }),
    person: {
      discordId: viewer.discordId,
      person: {
        site_admin: false,
        guild_officer: false,
        boe_manager: false,
        teams: [
          {
            team_id: 1,
            team_member_id: viewer.teamMember,
            role: viewer.role,
            characters: [{ player_id: p.id, name_realm: p.name_realm, url_code: p.url_code, archived_at: null }]
          }
        ]
      }
    }
  };
}

// A season whose code does not look like MIDn, as a later expansion's will
// not (#1368). On file, and open only where a test opens it.
const ODD_SEASON = { name: 'The Last Titan Season 1', code: 'TLT1', start: '2099-07-01', end: null };

// In start order, the order the app's read asks the database for: the harness
// answers every read whatever its order says.
const SEASONS = [
  {
    code: EARLIER_SEASON.code,
    display_name: EARLIER_SEASON.name,
    starts_at: EARLIER_SEASON.start,
    ends_at: EARLIER_SEASON.end
  },
  { code: SEASON.code, display_name: SEASON.name, starts_at: SEASON.start || '2026-01-01', ends_at: null },
  { code: NEXT_SEASON.code, display_name: NEXT_SEASON.name, starts_at: NEXT_SEASON.start, ends_at: null },
  { code: ODD_SEASON.code, display_name: ODD_SEASON.name, starts_at: ODD_SEASON.start, ends_at: null }
];

function open({
  path = '/g/wga/t/phoenix/me/wishlist',
  viewer = 'torbjorn',
  open = true,
  allowed = false,
  viewport,
  touch = false,
  view = null,
  openSeasons = [SEASON.code],
  seasons = SEASONS
} = {}) {
  return openApp(browser, server.port, {
    path,
    viewport,
    touch,
    sentinel: 'main h1',
    tables: {
      players: [{ ...TORBJORN, wishlist_allowed: allowed }],
      // One row answers both of the page's team_settings reads; the editing
      // switch is the team_seasons row for the season (#939).
      seasons,
      team_settings: [{ view }],
      team_seasons: openSeasons.map((code) => ({ season_code: code, wishlist_open: open })),
      items: [...ITEMS, NEXT_SEASON_HELM],
      raid_zones: [...RAID_ZONES, NEXT_RAID_ZONE],
      item_preferences: WISHLIST,
      tier_token_map: TIER_TOKEN_MAP,
      // The profile's own reads, which the Wishlist tab makes too.
      attendance: [],
      rclc_loot: []
    },
    ...signedIn(viewer)
  });
}

async function showEditor(page) {
  await page.waitForSelector('main .wishlist-slot-tab', { timeout: 20000 });
}

// The shape tests/behavior/wishlist.js describes, read one slot tab at a time.
async function readEditor(page) {
  const slots = await page.locator('main .wishlist-slot-tab').evaluateAll((tabs) => tabs.map((t) => t.dataset.slot));
  const editor = [];
  for (const slot of slots) {
    await page.click(`main .wishlist-slot-tab[data-slot="${slot}"]`);
    await page.waitForSelector(`main .wishlist-slot[data-slot="${slot}"]`);
    editor.push(
      await page.evaluate(() => {
        const text = (el) => (el ? el.textContent.trim() : null);
        const panel = document.querySelector('main .wishlist-slot');
        const entry = {
          slot: panel.dataset.slot,
          items: [],
          bis: [],
          pass: [],
          taken: [],
          notFromRaid: text(panel.querySelector('.wishlist-not-raid strong'))
        };
        for (const li of panel.querySelectorAll('.wishlist-item')) {
          const name = text(li.querySelector('.wishlist-item-name'));
          entry.items.push(name);
          const taken = text(li.querySelector('.wishlist-taken'));
          if (taken) entry.taken.push({ item: name, by: /^Your (.*) BiS$/.exec(taken)[1] });
          if (li.dataset.mark) entry[li.dataset.mark].push(name);
        }
        entry.items.sort();
        return entry;
      })
    );
  }
  return editor;
}

function recordWrites(page) {
  const writes = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!url.pathname.endsWith('/rest/v1/item_preferences') || request.method() === 'GET') return;
    writes.push({
      method: request.method(),
      query: Object.fromEntries(url.searchParams),
      body: request.postData() ? JSON.parse(request.postData()) : null
    });
  });
  return writes;
}

// Opens a slot's tab and finds an item in it.
const itemRow = async (page, slot, name) => {
  await page.click(`main .wishlist-slot-tab[data-slot="${slot}"]`);
  return page.locator(`main .wishlist-slot[data-slot="${slot}"] .wishlist-item`, { hasText: name });
};

const enabledMarks = (page) => page.locator('main .mark-button:not([disabled])').count();

let server;
let browser;

beforeAll(async () => {
  server = await startApp();
  browser = await launchBrowser();
});

afterAll(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
});

describe('Wishlist (new app), what each slot offers and shows, checked against the current site', () => {
  it('offers the raid items the raider can use, with their BiS and Pass marks', async () => {
    const opened = await open();
    try {
      await showEditor(opened.page);
      expect(await readEditor(opened.page)).toEqual(EXPECTED_EDITOR);
      // Which slots have a BiS pick, shown on the tabs themselves.
      const picked = await opened.page
        .locator('main .wishlist-slot-tab[data-picked]')
        .evaluateAll((tabs) => tabs.map((t) => t.dataset.slot));
      expect(picked).toEqual(['Head', 'Neck', 'Finger 1', 'Trinket 1', 'Weapon', 'Off Hand']);
      await opened.page.click('main .wishlist-slot-tab[data-slot="Neck"]');
      await expect(opened.page.locator('main .wishlist-slot-pick').textContent()).resolves.toBe('M+ (not from raid)');
      expect(opened.unexpected).toEqual([]);
      expect(opened.pageErrors).toEqual([]);
    } finally {
      await opened.context.close();
    }
  });
});

describe('Wishlist (new app), when editing is closed, checked against the current site', () => {
  it('shows the marks read-only', async () => {
    const opened = await open({ open: false });
    try {
      await showEditor(opened.page);
      expect(await readEditor(opened.page)).toEqual(EXPECTED_EDITOR);
      await opened.page.waitForSelector('main .wishlist-closed');
      expect(await enabledMarks(opened.page)).toBe(0);
    } finally {
      await opened.context.close();
    }
  });

  it('stays editable for a raider an officer allowed', async () => {
    const opened = await open({ open: false, allowed: true });
    try {
      await showEditor(opened.page);
      expect(await enabledMarks(opened.page)).toBeGreaterThan(0);
    } finally {
      await opened.context.close();
    }
  });

  it('is read-only for an officer opening someone else’s', async () => {
    const opened = await open({ path: `/g/wga/t/phoenix/p/${TORBJORN.url_code}/wishlist`, viewer: 'officer' });
    try {
      await showEditor(opened.page);
      expect(await readEditor(opened.page)).toEqual(EXPECTED_EDITOR);
      expect(await enabledMarks(opened.page)).toBe(0);
    } finally {
      await opened.context.close();
    }
  });
});

describe('Wishlist (new app), slot tabs', () => {
  it('move with the arrow keys and show the chosen slot', async () => {
    const opened = await open();
    try {
      await showEditor(opened.page);
      const tab = (slot) => opened.page.locator(`main .wishlist-slot-tab[data-slot="${slot}"]`);
      await expect(tab('Head').getAttribute('aria-selected')).resolves.toBe('true');
      await expect(tab('Hands').textContent()).resolves.toBe('Hands, no BiS pick');
      await tab('Head').focus();
      await opened.page.keyboard.press('ArrowRight');
      await expect(tab('Neck').evaluate((el) => el === document.activeElement)).resolves.toBe(true);
      await expect(opened.page.locator('#wishlist-slot-panel').getAttribute('data-slot')).resolves.toBe('Neck');
      await opened.page.keyboard.press('End');
      await expect(opened.page.locator('#wishlist-slot-panel').getAttribute('data-slot')).resolves.toBe('Off Hand');
    } finally {
      await opened.context.close();
    }
  });
});

describe('Wishlist (new app), slot row on a phone', () => {
  it('stays on one line and scrolls sideways inside its row, not the page', async () => {
    const opened = await open({ viewport: { width: 400, height: 860 } });
    try {
      await showEditor(opened.page);
      const row = await opened.page.evaluate(() => {
        const tabs = document.querySelector('main .wishlist-slot-tabs');
        const tops = new Set([...tabs.children].map((t) => t.offsetTop));
        return {
          lines: tops.size,
          scrolls: tabs.scrollWidth > tabs.clientWidth,
          pageOverflow: document.documentElement.scrollWidth - window.innerWidth
        };
      });
      expect(row).toEqual({ lines: 1, scrolls: true, pageOverflow: 0 });
      // A narrow window on a computer, not a touch screen, can still edit.
      expect(await enabledMarks(opened.page)).toBeGreaterThan(0);
      // A slot off the edge scrolls into view when the keyboard reaches it.
      await opened.page.locator('main .wishlist-slot-tab[data-slot="Head"]').focus();
      await opened.page.keyboard.press('End');
      const visible = await opened.page.evaluate(() => {
        const tabs = document.querySelector('main .wishlist-slot-tabs').getBoundingClientRect();
        const last = document.querySelector('main .wishlist-slot-tab[data-slot="Off Hand"]').getBoundingClientRect();
        return last.right <= tabs.right + 1 && last.left >= tabs.left - 1;
      });
      expect(visible).toBe(true);
    } finally {
      await opened.context.close();
    }
  });
});

describe('Wishlist (new app), on a touch screen', () => {
  it('shows the marks read-only, with a note that editing works on a computer', async () => {
    const opened = await open({ viewport: { width: 400, height: 860 }, touch: true });
    try {
      await showEditor(opened.page);
      expect(await readEditor(opened.page)).toEqual(EXPECTED_EDITOR);
      await opened.page.waitForSelector('main .wishlist-touch');
      expect(await enabledMarks(opened.page)).toBe(0);
    } finally {
      await opened.context.close();
    }
  });
});

describe('Wishlist (new app), marking, checked against the current site', () => {
  it('saves a new BiS pick and unmarks the ring it replaces', async () => {
    const opened = await open();
    try {
      await showEditor(opened.page);
      const writes = recordWrites(opened.page);
      await (
        await itemRow(opened.page, 'Finger 1', 'Signet of Coiled Ash')
      )
        .getByRole('button', { name: 'BiS' })
        .click();
      await expect.poll(() => writes.filter((w) => w.method === 'POST').length).toBe(1);

      expect(writes.find((w) => w.method === 'POST').body).toMatchObject(NEW_BIS_ROW);
      // The new app's rule (#1032): the old ring and the current site's copy of
      // it in Finger 2 are unmarked, as is the Pass on the new ring in Finger 2.
      const deleted = writes.find((w) => w.method === 'DELETE');
      expect(deleted.query.id).toBe('in.(3,4,5)');
      expect(writes.some((w) => w.method === 'PATCH')).toBe(false);
    } finally {
      await opened.context.close();
    }
  });

  it('clears a mark when it is clicked again', async () => {
    const opened = await open();
    try {
      await showEditor(opened.page);
      const writes = recordWrites(opened.page);
      const bis = (await itemRow(opened.page, 'Head', 'Venom-Etched Greathelm')).getByRole('button', { name: 'BiS' });
      await expect(bis.getAttribute('aria-pressed')).resolves.toBe('true');
      await bis.click();
      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0]).toMatchObject({ method: 'DELETE', query: { id: 'in.(1)' } });
    } finally {
      await opened.context.close();
    }
  });
});

// PINNED_ELSEWHERE in tests/behavior/wishlist.js, checked against the current
// site. The earlier tier's switch is on too, and the raider is not offered it.
describe('Wishlist (new app), with an officer’s Season View on another season, checked against the current site', () => {
  it('is the live tier’s editor, and saves a new BiS pick there', async () => {
    const opened = await open({ view: PINNED_ELSEWHERE.seasonView, openSeasons: PINNED_ELSEWHERE.open });
    try {
      await showEditor(opened.page);
      expect(await readEditor(opened.page)).toEqual(EXPECTED_EDITOR);
      expect(await opened.page.locator('main select#wishlist-season').count()).toBe(0);
      await expect(opened.page.locator('main .wishlist-season-name').textContent()).resolves.toBe(
        `Wishlist for ${SEASON.name}`
      );
      const writes = recordWrites(opened.page);
      await (
        await itemRow(opened.page, 'Finger 1', 'Signet of Coiled Ash')
      )
        .getByRole('button', { name: 'BiS' })
        .click();
      await expect.poll(() => writes.filter((w) => w.method === 'POST').length).toBe(1);
      expect(writes.find((w) => w.method === 'POST').body).toMatchObject(NEW_BIS_ROW);
      expect(opened.pageErrors).toEqual([]);
    } finally {
      await opened.context.close();
    }
  });
});

// A raider picks the season their own wishlist is on, from the seasons the
// team opened (#936, decision 13 on #1189).
describe('Wishlist (new app), the season picker', () => {
  const picker = (page) => page.locator('main select#wishlist-season');
  const bisCount = (page) => page.locator('main .wishlist-summary .wishlist-bis').textContent();

  const seasonName = (page) => page.locator('main .wishlist-season-name').textContent();

  it('is not there with one season open, and the page names that season', async () => {
    const opened = await open();
    try {
      await showEditor(opened.page);
      expect(await picker(opened.page).count()).toBe(0);
      await expect(seasonName(opened.page)).resolves.toBe(`Wishlist for ${SEASON.name}`);
    } finally {
      await opened.context.close();
    }
  });

  // A switch left on for a finished tier, which nothing turns off.
  it('does not offer a season before the live tier, even while it is open', async () => {
    const opened = await open({ openSeasons: [SEASON.code, EARLIER_SEASON.code] });
    try {
      await showEditor(opened.page);
      expect(await picker(opened.page).count()).toBe(0);
      await expect(seasonName(opened.page)).resolves.toBe(`Wishlist for ${SEASON.name}`);
    } finally {
      await opened.context.close();
    }
  });

  it('stays on the live tier, read-only, when only a season before it is open', async () => {
    const opened = await open({ openSeasons: [EARLIER_SEASON.code] });
    try {
      await showEditor(opened.page);
      await expect(seasonName(opened.page)).resolves.toBe(`Wishlist for ${SEASON.name}`);
      expect(await readEditor(opened.page)).toEqual(EXPECTED_EDITOR);
      await opened.page.waitForSelector('main .wishlist-closed');
      expect(await enabledMarks(opened.page)).toBe(0);
    } finally {
      await opened.context.close();
    }
  });

  // The name on file, whatever the code looks like (#1368).
  it('names a season by its stored name, not one worked out from its code', async () => {
    const opened = await open({ openSeasons: [ODD_SEASON.code] });
    try {
      await expect(seasonName(opened.page)).resolves.toBe(`Wishlist for ${ODD_SEASON.name}`);
      await expect(opened.page.locator('main .wishlist-summary').textContent()).resolves.toMatch(
        new RegExp(`^${ODD_SEASON.name}: 0 of \\d+ slots`)
      );
      expect(opened.pageErrors).toEqual([]);
    } finally {
      await opened.context.close();
    }
  });

  it('lists a season by its stored name, and the count follows the pick', async () => {
    const opened = await open({ openSeasons: [SEASON.code, ODD_SEASON.code] });
    try {
      await showEditor(opened.page);
      const options = await picker(opened.page)
        .locator('option')
        .evaluateAll((els) => els.map((o) => [o.value, o.textContent]));
      expect(options).toEqual([
        [ODD_SEASON.code, ODD_SEASON.name],
        [SEASON.code, SEASON.name]
      ]);
      await picker(opened.page).selectOption(ODD_SEASON.code);
      await expect
        .poll(() => opened.page.locator('main .wishlist-summary').textContent())
        .toMatch(new RegExp(`^${ODD_SEASON.name}: 0 of \\d+ slots`));
    } finally {
      await opened.context.close();
    }
  });

  it('names the next season when it is the only one open', async () => {
    const opened = await open({ openSeasons: [NEXT_SEASON.code] });
    try {
      await showEditor(opened.page);
      expect(await picker(opened.page).count()).toBe(0);
      await expect(seasonName(opened.page)).resolves.toBe(`Wishlist for ${NEXT_SEASON.name}`);
      await expect(opened.page.locator('main .wishlist-summary').textContent()).resolves.toMatch(
        new RegExp(`^${NEXT_SEASON.name}: 0 of 16 slots`)
      );
    } finally {
      await opened.context.close();
    }
  });

  it('lists the open seasons newest first, starting on the live tier', async () => {
    const opened = await open({ openSeasons: [SEASON.code, NEXT_SEASON.code] });
    try {
      await showEditor(opened.page);
      const options = await picker(opened.page)
        .locator('option')
        .evaluateAll((els) => els.map((o) => [o.value, o.textContent]));
      expect(options).toEqual([
        [NEXT_SEASON.code, NEXT_SEASON.name],
        [SEASON.code, SEASON.name]
      ]);
      await expect(picker(opened.page).inputValue()).resolves.toBe(SEASON.code);
      await expect(opened.page.getByRole('combobox', { name: 'Wishlist for' }).evaluate((el) => el.id)).resolves.toBe(
        'wishlist-season'
      );
    } finally {
      await opened.context.close();
    }
  });

  it('moves the editor and the count to the season picked, and saves picks there', async () => {
    const opened = await open({ openSeasons: [SEASON.code, NEXT_SEASON.code] });
    try {
      await showEditor(opened.page);
      expect(Number(await bisCount(opened.page))).toBeGreaterThan(0);

      await picker(opened.page).selectOption(NEXT_SEASON.code);
      // Next season's raid, and none of this season's picks.
      await expect.poll(() => bisCount(opened.page)).toBe('0');
      const helm = await itemRow(opened.page, 'Head', NEXT_SEASON_HELM.name);
      await expect(helm.count()).resolves.toBe(1);
      expect(await (await itemRow(opened.page, 'Head', 'Venom-Etched Greathelm')).count()).toBe(0);

      const writes = recordWrites(opened.page);
      await helm.getByRole('button', { name: 'BiS' }).click();
      await expect.poll(() => writes.filter((w) => w.method === 'POST').length).toBe(1);
      expect(writes.find((w) => w.method === 'POST').body).toMatchObject({
        item_id: NEXT_SEASON_HELM.id,
        slot: null,
        status: 'bis',
        season: NEXT_SEASON.code
      });
    } finally {
      await opened.context.close();
    }
  });

  it('keeps the season picked across the profile’s tabs and a reload', async () => {
    const opened = await open({ openSeasons: [SEASON.code, NEXT_SEASON.code] });
    try {
      await showEditor(opened.page);
      await picker(opened.page).selectOption(NEXT_SEASON.code);

      await opened.page.click('#profile-tab-overview');
      await opened.page.waitForSelector('main .wishlist-summary');
      await opened.page.click('#profile-tab-wishlist');
      await showEditor(opened.page);
      await expect(picker(opened.page).inputValue()).resolves.toBe(NEXT_SEASON.code);

      await opened.page.reload();
      await showEditor(opened.page);
      await expect(picker(opened.page).inputValue()).resolves.toBe(NEXT_SEASON.code);
    } finally {
      await opened.context.close();
    }
  });

  // An officer reading someone else's wishlist reads the season on screen,
  // like every other officer view since #1351, and is told which it is.
  it('is not offered to an officer, who reads the season they pinned', async () => {
    const opened = await open({
      path: `/g/wga/t/phoenix/p/${TORBJORN.url_code}/wishlist`,
      viewer: 'officer',
      view: EARLIER_SEASON.code,
      openSeasons: [SEASON.code, EARLIER_SEASON.code]
    });
    try {
      await showEditor(opened.page);
      expect(await picker(opened.page).count()).toBe(0);
      await expect(seasonName(opened.page)).resolves.toBe(`Wishlist for ${EARLIER_SEASON.name}`);
      expect(await (await itemRow(opened.page, 'Head', 'Helm of the Fallen Sun')).count()).toBe(1);
    } finally {
      await opened.context.close();
    }
  });
});

// The Wishlist tab's count is for the season its editor shows, so it waits for
// the read that decides that season, and a failed read shows as one rather than
// as another season's count.
describe('Wishlist (new app), the count', () => {
  const summary = (page) => page.locator('main .wishlist-summary');

  it('names the live tier on the Overview', async () => {
    const opened = await open({ path: '/g/wga/t/phoenix/me', openSeasons: [NEXT_SEASON.code] });
    try {
      await opened.page.waitForSelector('main .wishlist-summary');
      await expect(summary(opened.page).textContent()).resolves.toMatch(
        new RegExp(`^${SEASON.name}: \\d+ of 16 slots`)
      );
    } finally {
      await opened.context.close();
    }
  });

  it('names a live tier by its stored name on the Overview', async () => {
    // The TLT1 season, started: the tier being raided.
    const seasons = SEASONS.map((s) => (s.code === ODD_SEASON.code ? { ...s, starts_at: '2026-09-01' } : s)).sort(
      (a, b) => (a.starts_at < b.starts_at ? -1 : 1)
    );
    const opened = await open({ path: '/g/wga/t/phoenix/me', seasons });
    try {
      await opened.page.waitForSelector('main .wishlist-summary');
      await expect(summary(opened.page).textContent()).resolves.toMatch(
        new RegExp(`^${ODD_SEASON.name}: \\d+ of \\d+ slots`)
      );
    } finally {
      await opened.context.close();
    }
  });

  // The season list decides the tab's season and its name, so its failure
  // shows the same way.
  it('shows the season list failing on the Wishlist tab, not a count', async () => {
    const opened = await open({ path: '/g/wga/t/phoenix/me', openSeasons: [NEXT_SEASON.code] });
    try {
      await opened.page.waitForSelector('main .wishlist-summary');
      await opened.page.route('**/rest/v1/seasons*', (route) =>
        route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'down' }) })
      );
      await opened.page.click('#profile-tab-wishlist');
      await opened.page.waitForSelector('main .profile-wishlist .data-error', { timeout: 20000 });
      await expect.poll(() => opened.page.locator('main .profile-wishlist .data-error').count()).toBe(2);
      expect(await summary(opened.page).count()).toBe(0);
    } finally {
      await opened.context.close();
    }
  });

  it('shows the season read failing on the Wishlist tab, not the live tier’s count', async () => {
    const opened = await open({ path: '/g/wga/t/phoenix/me', openSeasons: [NEXT_SEASON.code] });
    try {
      await opened.page.waitForSelector('main .wishlist-summary');
      await opened.page.route('**/rest/v1/team_seasons*', (route) =>
        route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'down' }) })
      );
      await opened.page.click('#profile-tab-wishlist');
      await opened.page.waitForSelector('main .profile-wishlist .data-error', { timeout: 20000 });
      await expect.poll(() => opened.page.locator('main .profile-wishlist .data-error').count()).toBe(2);
      expect(await summary(opened.page).count()).toBe(0);
    } finally {
      await opened.context.close();
    }
  });
});
