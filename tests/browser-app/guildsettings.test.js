import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { launchBrowser, openApp, startApp, storedSession } from './harness.js';

// Guild settings and New team (#1644) by keyboard, in a real browser. The
// accessibility scan of each state lives in app.test.js.

const STATE = {
  path: '/g/wga/t/phoenix',
  sentinel: 'main h1',
  session: storedSession({ battlenet: 'Kato#1499', discord: 'Phoenix Officer' }),
  person: {
    discordId: 'discord-officer-1',
    person: { site_admin: false, guild_officer: true, boe_manager: false, teams: [] }
  },
  teams: [
    { id: 1, name: 'Phoenix', slug: 'phoenix', archived_at: null, unlisted: false },
    { id: 3, name: 'Sandbox', slug: 'sandbox', archived_at: null, unlisted: true }
  ]
};

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

describe('New team in the team picker', () => {
  it('is the last entry: reached with the arrow keys, opened with Enter, closed with Escape', async () => {
    const { context, page } = await openApp(browser, server.port, STATE);
    try {
      const picker = page.getByRole('button', { name: /switch team/ });
      await picker.focus();
      await page.keyboard.press('ArrowUp');
      await expect.poll(() => page.evaluate(() => document.activeElement?.textContent?.trim())).toBe('New team');
      // The unlisted team is not in the list for someone who is not on it.
      expect(await page.locator('.team-list a').allTextContents()).toEqual(['Phoenix']);
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'New team' });
      await dialog.waitFor();
      expect(await dialog.getByRole('textbox').count()).toBe(1);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
    } finally {
      await context.close();
    }
  });
});

describe('Guild settings > Rank permissions', () => {
  const GRID = {
    path: '/g/wga/settings/rank-permissions',
    sentinel: 'main .rank-grid input',
    session: STATE.session,
    person: STATE.person,
    teams: STATE.teams,
    rpc: {
      guild_members: [
        {
          person_id: 1,
          display_name: 'Katorri',
          rank: 'owner',
          is_you: true,
          teams: [],
          last_sign_in: null,
          characters: []
        }
      ],
      set_guild_rank_permissions: null
    },
    tables: {
      guild_rank_permissions: [{ rank: 'admin', permission: 'record_boe' }],
      rank_permissions: [{ permission: 'record_boe', default_ranks: ['admin'] }]
    }
  };

  it('a switch ticks from the keyboard and Save is reached by Tab', async () => {
    const { context, page } = await openApp(browser, server.port, GRID);
    try {
      const box = page.getByRole('checkbox', { name: 'Member: Create teams' });
      await box.focus();
      await page.keyboard.press('Space');
      expect(await box.isChecked()).toBe(true);
      await page.getByText('1 change not saved.').waitFor();
      await page.getByRole('button', { name: 'Reset to defaults' }).focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe('Save');
    } finally {
      await context.close();
    }
  });

  it('fits a phone without scrolling sideways', async () => {
    const { context, page } = await openApp(browser, server.port, { ...GRID, viewport: { width: 360, height: 740 } });
    try {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const size = await page.locator('.rank-grid-check').first().boundingBox();
      expect(size.height).toBeGreaterThanOrEqual(44);
    } finally {
      await context.close();
    }
  });
});

describe('Settings > Ranks', () => {
  it('asks before making someone an Officer, from the keyboard, and Escape changes nothing', async () => {
    const { context, page } = await openApp(browser, server.port, {
      path: '/g/wga/t/phoenix/officer/settings/ranks',
      sentinel: 'main .ranks-select',
      session: STATE.session,
      who: 'officer',
      rpc: {
        team_member_ranks: [
          { team_member_id: 1, display_name: 'Olive', rank: 'owner', signed_in: true, is_you: true },
          { team_member_id: 2, display_name: 'Raz', rank: 'raider', signed_in: true, is_you: false }
        ]
      }
    });
    try {
      const box = page.getByRole('combobox', { name: 'Team rank for Raz' });
      await box.focus();
      await box.selectOption({ label: 'Officer' });
      const dialog = page.getByRole('dialog', { name: 'Make Raz an Officer?' });
      await dialog.waitFor();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      expect(await box.inputValue()).toBe('raider');
    } finally {
      await context.close();
    }
  });
});

describe('Settings > Ranks, the team grid (#1653)', () => {
  const TEAM_GRID = {
    path: '/g/wga/t/phoenix/officer/settings/ranks',
    sentinel: 'main .rank-grid input',
    session: STATE.session,
    who: 'officer',
    rpc: {
      team_member_ranks: [{ team_member_id: 1, display_name: 'Olive', rank: 'owner', signed_in: true, is_you: true }],
      set_team_rank_permissions: null
    },
    tables: {
      team_rank_permissions: [{ rank: 'raider', permission: 'edit_own_wishlist' }],
      rank_permissions: [{ permission: 'edit_own_wishlist', default_ranks: ['raider'] }]
    }
  };

  it('a switch ticks from the keyboard and Save is reached by Tab', async () => {
    const { context, page } = await openApp(browser, server.port, TEAM_GRID);
    try {
      const box = page.getByRole('checkbox', { name: 'Raider: Edit own wishlist' });
      await box.focus();
      await page.keyboard.press('Space');
      expect(await box.isChecked()).toBe(false);
      await page.getByText('1 change not saved.').waitFor();
      await page.getByRole('button', { name: 'Reset to defaults' }).focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe('Save');
    } finally {
      await context.close();
    }
  });

  it('fits a phone without scrolling sideways', async () => {
    const { context, page } = await openApp(browser, server.port, {
      ...TEAM_GRID,
      viewport: { width: 360, height: 740 }
    });
    try {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const size = await page.locator('.rank-grid-check').first().boundingBox();
      expect(size.height).toBeGreaterThanOrEqual(44);
    } finally {
      await context.close();
    }
  });
});

describe('Change Team Owner', () => {
  it('opens from the keyboard and has nothing to save until someone is picked', async () => {
    const { context, page } = await openApp(browser, server.port, {
      ...STATE,
      path: '/g/wga/settings/teams',
      sentinel: 'main .guildsettings-row',
      rpc: {
        team_member_ranks: [
          { team_member_id: 1, display_name: 'Olive', rank: 'owner', signed_in: true },
          { team_member_id: 2, display_name: 'Raz', rank: 'officer', signed_in: true }
        ]
      }
    });
    try {
      const open = page.getByRole('button', { name: 'Change Team Owner of Phoenix' });
      await open.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Change Team Owner of Phoenix' });
      await dialog.waitFor();
      const box = dialog.getByRole('combobox', { name: 'New Team Owner' });
      await box.waitFor();
      const save = dialog.getByRole('button', { name: 'Change Team Owner' });
      expect(await save.isDisabled()).toBe(true);
      await box.selectOption({ label: 'Raz' });
      expect(await save.isDisabled()).toBe(false);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
    } finally {
      await context.close();
    }
  });
});

describe('the Teams list', () => {
  it('opens the archive dialog from the keyboard and keeps Archive off until the name is typed', async () => {
    const { context, page } = await openApp(browser, server.port, {
      ...STATE,
      path: '/g/wga/settings/teams',
      sentinel: 'main .guildsettings-row'
    });
    try {
      // Unlisted teams still show here, marked.
      expect(await page.locator('.guildsettings-row', { hasText: 'Sandbox' }).textContent()).toContain('Unlisted');
      const archive = page.getByRole('button', { name: 'Archive Phoenix' });
      await archive.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Archive Phoenix' });
      await dialog.waitFor();
      const confirm = dialog.getByRole('button', { name: 'Archive team' });
      expect(await confirm.isDisabled()).toBe(true);
      await page.keyboard.type('Phoenix');
      expect(await confirm.isDisabled()).toBe(false);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      await expect.poll(() => archive.evaluate((el) => el === document.activeElement)).toBe(true);
    } finally {
      await context.close();
    }
  });
});
