// The Discord calls the sweep makes, as the bot. A rate limit, an outage or no
// answer throws DiscordDown, so the step is tried again next sweep.
export const API = 'https://discord.com/api/v10';
const DEADLINE_MS = 5_000;

export type Fetcher = { fetch: typeof fetch };

export class DiscordDown extends Error {
  override message = 'Discord did not answer';
}
const DMS_CLOSED = 50007;

export type Sent = { ok: boolean; dmsClosed?: boolean };

export async function call(
  deps: Fetcher,
  token: string,
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  let res: Response;
  try {
    res = await deps.fetch(API + path, {
      method,
      headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(DEADLINE_MS)
    });
  } catch {
    throw new DiscordDown();
  }
  if (res.status === 429 || res.status >= 500) throw new DiscordDown();
  return res;
}

export async function postTo(
  deps: Fetcher,
  token: string,
  channelId: string,
  body: Record<string, unknown>
): Promise<Sent> {
  const res = await call(deps, token, 'POST', '/channels/' + channelId + '/messages', {
    allowed_mentions: { parse: [] },
    ...body
  });
  await res.body?.cancel();
  return res.ok ? { ok: true } : { ok: false, dmsClosed: false };
}

export async function dm(deps: Fetcher, token: string, userId: string, body: Record<string, unknown>): Promise<Sent> {
  const open = await call(deps, token, 'POST', '/users/@me/channels', { recipient_id: userId });
  if (!open.ok) return { ok: false, dmsClosed: (await open.json().catch(() => null))?.code === DMS_CLOSED };
  const channel = (await open.json()) as { id: string };
  const res = await call(deps, token, 'POST', '/channels/' + channel.id + '/messages', {
    allowed_mentions: { parse: [] },
    ...body
  });
  if (res.ok) {
    await res.body?.cancel();
    return { ok: true };
  }
  return { ok: false, dmsClosed: (await res.json().catch(() => null))?.code === DMS_CLOSED };
}
