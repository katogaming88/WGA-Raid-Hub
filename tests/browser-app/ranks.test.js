import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { launchBrowser, openApp, startApp, storedSession } from './harness.js';

// What someone can do follows their rank's permissions (#1649): an Officer,
// an Assistant and a Raider on the same team see different officer menus,
// and a page their rank has no permission for is closed on its address.

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

const session = storedSession({ battlenet: 'Rank#1', discord: 'Rank' });

const menuOf = async (who, path = '/g/wga/t/phoenix/roster') => {
  const opened = await openApp(browser, server.port, { path, session, who, sentinel: 'main h1' });
  const group = opened.page.getByRole('complementary').getByRole('heading', { name: 'Officer' });
  const shown = (await group.count()) > 0;
  const buttons = await opened.page.locator('aside nav button').allTextContents();
  return { ...opened, shown, buttons: buttons.map((b) => b.trim()) };
};

describe('Officer menu by rank', () => {
  it('shows an Officer every group', async () => {
    const o = await menuOf('officer');
    expect(o.shown).toBe(true);
    expect(o.buttons).toEqual(expect.arrayContaining(['Loot', 'Attendance', 'Reports', 'Settings']));
    await o.context.close();
  });

  it('shows an Assistant the attendance and report tools, with no loot import', async () => {
    // On Priority, the Loot group opens by itself and lists what the rank may open.
    const o = await menuOf('assistant', '/g/wga/t/phoenix/officer/priority');
    expect(o.shown).toBe(true);
    expect(o.buttons).toEqual(expect.arrayContaining(['Attendance', 'Reports']));
    expect(await o.page.locator('#menu-Loot a').allTextContents()).toEqual(['Priority', 'Reviews']);
    await o.context.close();
  });

  it('closes the loot import page to an Assistant on its address', async () => {
    const o = await openApp(browser, server.port, {
      path: '/g/wga/t/phoenix/officer/import',
      session,
      who: 'assistant',
      sentinel: '.placeholder'
    });
    expect(await o.page.locator('.placeholder').textContent()).toContain('This page is for officers of Phoenix.');
    await o.context.close();
  });

  it('shows a Raider no officer menu', async () => {
    const o = await menuOf('member');
    expect(o.shown).toBe(false);
    await o.context.close();
  });
});
