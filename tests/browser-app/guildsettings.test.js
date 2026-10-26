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
