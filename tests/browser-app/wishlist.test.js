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

function open({ path = '/g/wga/t/phoenix/me/wishlist', viewer = 'torbjorn', open = true, allowed = false } = {}) {
  return openApp(browser, server.port, {
    path,
    sentinel: 'main h1',
    tables: {
      players: [{ ...TORBJORN, wishlist_allowed: allowed }],
      // One row answers both of the page's team_settings reads.
      team_settings: [{ name: SEASON.name, start: SEASON.start, end: SEASON.end, open: String(open), view: null }],
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
  await page.waitForSelector('main .wishlist-slot', { timeout: 20000 });
  await page.evaluate(() => document.querySelectorAll('main .wishlist-slot').forEach((d) => (d.open = true)));
}

// The shape tests/behavior/wishlist.js describes, read from the slot rows.
function readEditor(page) {
  return page.evaluate(() => {
    const text = (el) => (el ? el.textContent.trim() : null);
    return [...document.querySelectorAll('main .wishlist-slot')].map((slot) => {
      const entry = {
        slot: slot.dataset.slot,
        items: [],
        bis: [],
        pass: [],
        taken: [],
        notFromRaid: text(slot.querySelector('.wishlist-not-raid strong'))
      };
      for (const li of slot.querySelectorAll('.wishlist-item')) {
        const name = text(li.querySelector('.wishlist-item-name'));
        entry.items.push(name);
        const taken = text(li.querySelector('.wishlist-taken'));
        if (taken) entry.taken.push({ item: name, by: /^Your (.*) BiS$/.exec(taken)[1] });
        if (li.dataset.mark) entry[li.dataset.mark].push(name);
      }
      entry.items.sort();
      return entry;
    });
  });
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

const itemRow = (page, slot, name) =>
  page.locator(`main .wishlist-slot[data-slot="${slot}"] .wishlist-item`, { hasText: name });

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
      // The slot's pick, shown without opening it.
      await expect(
        opened.page.locator('main .wishlist-slot[data-slot="Neck"] .wishlist-slot-pick').textContent()
      ).resolves.toBe('M+ (not from raid)');
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

describe('Wishlist (new app), marking, checked against the current site', () => {
  it('saves a new BiS pick and unmarks the ring it replaces', async () => {
    const opened = await open();
    try {
      await showEditor(opened.page);
      const writes = recordWrites(opened.page);
      await itemRow(opened.page, 'Finger 1', 'Signet of Coiled Ash').getByRole('button', { name: 'BiS' }).click();
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
      const bis = itemRow(opened.page, 'Head', 'Venom-Etched Greathelm').getByRole('button', { name: 'BiS' });
      await expect(bis.getAttribute('aria-pressed')).resolves.toBe('true');
      await bis.click();
      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0]).toMatchObject({ method: 'DELETE', query: { id: 'in.(1)' } });
    } finally {
      await opened.context.close();
    }
  });
});
