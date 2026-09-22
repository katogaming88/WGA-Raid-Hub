import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { launchBrowser, openApp, startApp, storedSession } from './harness.js';
import { VIEWERS } from '../behavior/profile.js';
import {
  EXPECTED_EDITOR,
  ITEMS,
  NEW_BIS_ROW,
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

function open({
  path = '/g/wga/t/phoenix/me/wishlist',
  viewer = 'torbjorn',
  open = true,
  allowed = false,
  viewport,
  touch = false
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
      seasons: [
        { code: SEASON.code, display_name: SEASON.name, starts_at: SEASON.start || '2026-01-01', ends_at: null }
      ],
      team_settings: [{ name: SEASON.name, start: SEASON.start, end: SEASON.end, view: null }],
      team_seasons: [{ season_code: SEASON.code, wishlist_open: open }],
      items: ITEMS,
      raid_zones: RAID_ZONES,
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
