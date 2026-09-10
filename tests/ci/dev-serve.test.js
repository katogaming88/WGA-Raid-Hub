import { describe, it, expect, afterEach } from 'vitest';
import { startServer } from '../browser/static-server.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The static server grew a port so a person can open the site (#1052). It was
// written for the accessibility suite, which binds port 0 because a fixed port
// collides with a dev server or with a second vitest worker; the rehearsal
// needs the opposite, a port the runbook can name and the auth redirect list
// can hold.
//
// Both behaviours are asserted, because the default is what every browser test
// depends on and it would be easy to make 3000 the default while making it
// available.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let running = null;
afterEach(async () => {
  if (running) await running.close();
  running = null;
});

describe('the static server takes a port (#1052)', () => {
  it('binds the port it is given', async () => {
    running = await startServer(ROOT, { port: 3999 });
    expect(running.port).toBe(3999);
  });

  it('serves the site from that port', async () => {
    running = await startServer(ROOT, { port: 3998 });
    const response = await fetch(`http://127.0.0.1:3998/index.html`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<html');
  });

  it('still picks its own port when given none, which is what the browser suite needs', async () => {
    running = await startServer(ROOT);
    expect(running.port).toBeGreaterThan(0);
    expect(running.port).not.toBe(3999);
  });
});
