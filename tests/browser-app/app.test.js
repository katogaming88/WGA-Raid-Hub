import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AxeBuilder } from '@axe-core/playwright';
import { launchBrowser, openApp, startApp, storedSession, NARROW } from './harness.js';
import { SCENARIO } from '../behavior/roster.js';
import {
  ATTENDANCE,
  GEAR,
  LOOT,
  MPLUS_REJECTIONS,
  PRIORITY_ITEMS,
  PRIORITY_ORDER,
  RAID_ZONES,
  SEASON,
  SELF_RECEIVED,
  TIER_TOKEN_MAP,
  VIEWERS,
  WISHLIST
} from '../behavior/profile.js';

// The new app in a real browser (#1101 part 4): the shell's accessibility
// checklist, measured rather than trusted. Unlike tests/browser/, there is no
// baseline. The app starts clean and a violation is a failure, full stop.

const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// The Roster page's reads: the recorded scenario plus synced gear, so item
// level, tier pips and tags are all on the page axe measures.
const GEAR_SLOTS = ['HEAD', 'NECK', 'SHOULDER', 'BACK', 'CHEST', 'WRIST', 'HANDS', 'WAIST'];
const ROSTER = {
  players: SCENARIO.players.map((p, i) => ({ ...p, tier_pieces_equipped: i % 6 })),
  player_equipped_gear: SCENARIO.players.flatMap((p) =>
    GEAR_SLOTS.map((equipment_slot) => ({ player_id: p.id, equipment_slot, item_level: 318 + p.id }))
  ),
  incoming_roster: SCENARIO.incoming,
  team_settings: [{ signupSeason: SCENARIO.activeSignupSeason }]
};

// A profile's reads (tests/behavior/profile.js), seen by a viewer.
function profileState(label, viewerKey, profileKey, extra = {}) {
  const viewer = VIEWERS[viewerKey];
  const shown = VIEWERS[profileKey].player;
  return {
    label,
    path: viewerKey === profileKey ? '/g/wga/t/phoenix/me' : `/g/wga/t/phoenix/p/${shown.url_code}`,
    sentinel: 'main .profile-name',
    session: storedSession({ battlenet: `${viewer.player.name_realm}#1`, discord: viewer.player.name_realm }),
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
            characters: [
              {
                player_id: viewer.player.id,
                name_realm: viewer.player.name_realm,
                url_code: viewer.player.url_code,
                archived_at: null
              }
            ]
          }
        ]
      }
    },
    tables: {
      players: [shown],
      team_settings: [{ name: SEASON.name, start: SEASON.start, end: SEASON.end }],
      attendance: ATTENDANCE.filter((r) => r.player_id === shown.id),
      rclc_loot: LOOT.filter((r) => r.player_id === shown.id),
      player_equipped_gear: GEAR.filter((r) => r.player_id === shown.id),
      items: PRIORITY_ITEMS,
      raid_zones: RAID_ZONES,
      item_preferences: WISHLIST.filter((r) => r.player_id === shown.id),
      priority_order: PRIORITY_ORDER.filter((r) => r.season === SEASON.code),
      tier_token_map: TIER_TOKEN_MAP.filter((r) => r.class === shown.classes_specs.class),
      self_received_requests: SELF_RECEIVED.filter((r) => r.player_id === shown.id),
      mplus_exclusion_requests:
        viewer.role === 'officer' ? MPLUS_REJECTIONS.filter((r) => r.player_id === shown.id) : []
    },
    ...extra
  };
}

const OFFICER = storedSession({ battlenet: 'Kato#1499', discord: 'Phoenix Officer' });
const BATTLENET_ONLY = storedSession({ battlenet: 'Aeglos#1234' });

// Every screen the shell has today, in both themes where color matters.
const STATES = [
  { label: 'home, signed out', path: '/g/wga/t/phoenix', sentinel: 'text=active raiders' },
  { label: 'home, signed out, light', path: '/g/wga/t/phoenix', sentinel: 'text=active raiders', colorScheme: 'light' },
  {
    label: 'officer page, signed out',
    path: '/g/wga/t/phoenix/officer/priority',
    sentinel: 'text=Sign in to see this page'
  },
  {
    label: 'officer page, officer',
    path: '/g/wga/t/phoenix/officer/priority',
    session: OFFICER,
    who: 'officer',
    sentinel: 'text=Not built yet'
  },
  {
    label: 'officer page, officer, light',
    path: '/g/wga/t/phoenix/officer/priority',
    session: OFFICER,
    who: 'officer',
    sentinel: 'text=Not built yet',
    colorScheme: 'light'
  },
  {
    label: 'Battle.net only, connect Discord',
    path: '/g/wga/t/phoenix',
    session: BATTLENET_ONLY,
    who: 'battlenetOnly',
    sentinel: 'text=Connect your Discord'
  },
  { label: 'page not found', path: '/g/wga/t/phoenix/nope', sentinel: 'text=Page not found' },
  { label: 'roster', path: '/g/wga/t/phoenix/roster', sentinel: 'table.roster-table', tables: ROSTER },
  {
    label: 'roster, light',
    path: '/g/wga/t/phoenix/roster',
    sentinel: 'table.roster-table',
    tables: ROSTER,
    colorScheme: 'light'
  },
  {
    label: 'roster, next season tab',
    path: '/g/wga/t/phoenix/roster',
    sentinel: 'table.roster-table',
    tables: ROSTER,
    click: 'role=tab[name="Season 4 Roster (Tentative)"]'
  },
  profileState('my profile', 'torbjorn', 'torbjorn'),
  profileState('my profile, light', 'torbjorn', 'torbjorn', { colorScheme: 'light' }),
  profileState('officer opening a profile with a refused M+ request', 'officer', 'dodgey', {
    sentinel: 'main .mplus-status'
  }),
  { label: 'my profile, signed out', path: '/g/wga/t/phoenix/me', sentinel: 'text=Sign in to see your profile' }
];

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

// Measured after any entrance animation has finished: mid-fade, a button's
// colors are partly transparent and read as a contrast failure that no one
// ever sees at rest.
async function axe(page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const results = await new AxeBuilder({ page }).withTags(WCAG_21_AA).analyze();
  return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

describe.each(STATES)('$label', (state) => {
  it('has no WCAG 2.1 AA violations, makes no unexpected requests, and throws nothing', async () => {
    const { context, page, unexpected, pageErrors } = await openApp(browser, server.port, state);
    try {
      expect(await axe(page)).toEqual([]);
      expect(unexpected).toEqual([]);
      expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it('does not scroll sideways at 480px', async () => {
    const { context, page } = await openApp(browser, server.port, { ...state, viewport: NARROW });
    try {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    } finally {
      await context.close();
    }
  });
});

describe('narrow-screen drawer', () => {
  it('opens as a dialog-like panel with no violations and returns focus on Escape', async () => {
    const { context, page } = await openApp(browser, server.port, {
      path: '/g/wga/t/phoenix',
      sentinel: 'text=active raiders',
      viewport: NARROW
    });
    try {
      const menu = page.getByRole('button', { name: 'Open menu' });
      await menu.click();
      expect(await page.evaluate(() => document.getElementById('sidebar')?.contains(document.activeElement))).toBe(
        true
      );
      expect(await axe(page)).toEqual([]);
      await page.keyboard.press('Escape');
      await expect.poll(() => menu.evaluate((el) => el === document.activeElement)).toBe(true);
    } finally {
      await context.close();
    }
  });
});

describe('keyboard', () => {
  it('shows the skip link on the first Tab and a visible focus ring on every control after it', async () => {
    const { context, page } = await openApp(browser, server.port, {
      path: '/g/wga/t/phoenix',
      session: OFFICER,
      who: 'officer',
      sentinel: 'text=Officer · Seedofficer'
    });
    try {
      await page.keyboard.press('Tab');
      const skip = await page.evaluate(() => {
        const el = document.activeElement;
        const box = el?.getBoundingClientRect();
        return { text: el?.textContent, visible: !!box && box.top >= 0 && box.height > 0 };
      });
      expect(skip).toEqual({ text: 'Skip to content', visible: true });

      // Every stop until focus has been through the sidebar and top bar.
      const missing = [];
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press('Tab');
        const ring = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const style = getComputedStyle(el);
          const label = el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 30) || el.tagName;
          return { label, ok: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2 };
        });
        if (ring && !ring.ok) missing.push(ring.label);
      }
      expect(missing).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it('keeps Tab inside the switch dialog and returns focus when Escape closes it', async () => {
    const { context, page } = await openApp(browser, server.port, {
      path: '/g/wga/t/phoenix',
      session: BATTLENET_ONLY,
      who: 'battlenetOnly',
      sentinel: 'text=Connect your Discord'
    });
    try {
      const trigger = page.getByRole('button', { name: 'Already use WGA Raid Hub with Discord?' });
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: 'Use your Discord account' });
      await dialog.waitFor();
      expect(await axe(page)).toEqual([]);
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab');
        expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
      }
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      expect(await trigger.evaluate((el) => el === document.activeElement)).toBe(true);
    } finally {
      await context.close();
    }
  });
});

describe('reduced motion', () => {
  // A pair, like tests/browser/reduced-motion.test.js: "nothing moves" is as
  // true of a page with no motion at all as of a working media query, so the
  // default setting has to show motion for the reduced one to mean anything.
  async function movingElements(reducedMotion) {
    const { context, page } = await openApp(browser, server.port, {
      path: '/g/wga/t/phoenix',
      session: BATTLENET_ONLY,
      who: 'battlenetOnly',
      sentinel: 'text=Connect your Discord',
      reducedMotion
    });
    try {
      await page.getByRole('button', { name: 'Already use WGA Raid Hub with Discord?' }).click();
      await page.getByRole('dialog').waitFor();
      return await page.evaluate(() => {
        const seconds = (value) =>
          Math.max(
            ...value.split(',').map((part) => (part.trim().endsWith('ms') ? parseFloat(part) / 1000 : parseFloat(part)))
          );
        return Array.from(document.querySelectorAll('*'))
          .map((el) => {
            const style = getComputedStyle(el);
            return {
              el: String(el.className || el.tagName),
              t: seconds(style.transitionDuration),
              a: seconds(style.animationDuration)
            };
          })
          .filter(({ t, a }) => t > 0.02 || a > 0.02)
          .map(({ el }) => el);
      });
    } finally {
      await context.close();
    }
  }

  it('animates the dialog and nav by default', async () => {
    const moving = await movingElements('no-preference');
    expect(moving).toContain('dialog');
    expect(moving.some((el) => el.includes('nav-item'))).toBe(true);
  });

  it('runs no transition or animation longer than a frame when the system asks for less motion', async () => {
    expect(await movingElements('reduce')).toEqual([]);
  });
});
