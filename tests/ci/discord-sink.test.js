import { describe, it, expect, afterEach } from 'vitest';
import { startSink } from '../../scripts/dev/discord-sink.js';

// The stand-in for Discord (#1055). A rehearsal that needs a real webhook URL
// is a rehearsal that can post into a channel a team operates in, so every
// *_WEBHOOK_URL points here instead and the posts are read from a terminal.
//
// This is the shape the 2026-09-07 boe-webhook proof used as a throwaway,
// tracked now so the next person does not write it again. What the tests pin
// is the part a poster depends on: it always answers, it keeps what it was
// sent, and it can be told to refuse so the error paths get exercised too.
//
// Discord answers 204 with no body to an incoming webhook, so the sink does.
// A poster that treats any 2xx as success would pass against a sink returning
// 200 and fail against the real thing.

let running = null;
afterEach(async () => {
  if (running) await running.close();
  running = null;
});

const post = (port, body, headers) =>
  fetch(`http://127.0.0.1:${port}/webhooks/1234/abcd`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body
  });

describe('the Discord sink (#1055)', () => {
  it('answers a post the way Discord does, 204 with no body', async () => {
    running = await startSink({ port: 0 });
    const response = await post(running.port, JSON.stringify({ content: 'hello' }));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('keeps what it was sent, parsed, so a poster payload can be read back', async () => {
    running = await startSink({ port: 0 });
    await post(running.port, JSON.stringify({ content: '[smoke] BoE found', embeds: [{ title: 'Item' }] }));
    expect(running.received.length).toBe(1);
    expect(running.received[0].method).toBe('POST');
    expect(running.received[0].path).toBe('/webhooks/1234/abcd');
    expect(running.received[0].body).toEqual({ content: '[smoke] BoE found', embeds: [{ title: 'Item' }] });
  });

  it('keeps a body that is not JSON as raw text rather than throwing', async () => {
    // A poster that gets its Content-Type wrong should show up as a readable
    // post here, not as the sink falling over mid-rehearsal.
    running = await startSink({ port: 0 });
    const response = await post(running.port, 'content=hello', { 'Content-Type': 'text/plain' });
    expect(response.status).toBe(204);
    expect(running.received[0].body).toBe('content=hello');
  });

  it('refuses with the status it was given, so the error paths run too', async () => {
    running = await startSink({ port: 0, status: 500 });
    const response = await post(running.port, JSON.stringify({ content: 'hello' }));
    expect(response.status).toBe(500);
    expect(running.received.length).toBe(1);
  });

  it('binds 8899 by default, which is the port the runbook and the env example name', async () => {
    running = await startSink();
    expect(running.port).toBe(8899);
  });
});
