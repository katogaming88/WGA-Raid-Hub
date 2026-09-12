// A recording fetch (#1006): stores every call and answers from a scripted
// queue, so "posted exactly once with this body" is one assertion and a
// scripted 429 reaches the branch that only a network could otherwise.
export type FetchCall = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
};

export function recordingFetch(queue: Response[] = []) {
  const calls: FetchCall[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    const body = await req.text();
    calls.push({ url: req.url, method: req.method, headers: Object.fromEntries(req.headers), body: body || null });
    const next = queue.shift();
    if (!next) throw new Error('recordingFetch: no scripted response left for ' + req.url);
    return next;
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

// What Discord answers a webhook post with: 204 and no body.
export function discordNoContent(): Response {
  return new Response(null, { status: 204 });
}

export function discordError(status: number, text = ''): Response {
  return new Response(text, { status });
}
