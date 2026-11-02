// discord-interactions (#998): Discord's Interactions Endpoint URL for the
// Raid Hub bot. Discord sends each slash command here as a signed POST, so
// no process has to hold a gateway connection open.
//
// - Every request's Ed25519 signature is checked against DISCORD_PUBLIC_KEY
//   before anything else; a bad or missing one is a 401 with no body and no
//   read. Discord drops an endpoint that accepts a bad signature.
// - PING answers PONG.
// - A command that does work answers "thinking" at once and does the work
//   after, under waitUntil, then edits that answer. Discord gives 3 seconds
//   for the first answer and 15 minutes for the edit.
//
// Commands: /nudge-missing and /about. #961 moves the other nine here, and
// #960 the signup sheet's Refresh button, which has no sheet to refresh until
// that sheet is posted by this bot.
//
// handle() takes its reads, its fetch, its environment and its waitUntil as
// an argument (#1006); deps.ts supplies the real ones and index.ts serves it.
import {
  type NudgeCategory,
  type WishlistSetupStatusRow,
  nudgeCandidatesFromRows,
  nudgeEmbed,
  summaryEmbed
} from './nudge.ts';
import { VERSION } from './version.ts';

export type Team = { id: number; name: string };

export interface InteractionsDb {
  // The teams whose Discord server is this one, by name.
  teamsInServer(serverId: string): Promise<Team[]>;
  setupStatus(teamId: number): Promise<WishlistSetupStatusRow[]>;
  // The categories each of these users was nudged about since this time.
  nudgedSince(discordIds: string[], since: Date): Promise<{ discordId: string; category: NudgeCategory }[]>;
  recordNudge(discordId: string, categories: NudgeCategory[]): Promise<void>;
}

export type Env = { get(name: string): string | undefined };

export type Deps = {
  fetch: typeof fetch;
  env: Env;
  db: InteractionsDb;
  waitUntil(work: Promise<unknown>): void;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

export const API = 'https://discord.com/api/v10';
export const COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Discord's numbers.
const PING = 1;
const COMMAND = 2;
const AUTOCOMPLETE = 4;
const PONG = 1;
const MESSAGE = 4;
const DEFERRED_MESSAGE = 5;
const CHOICES = 8;
const EPHEMERAL = 1 << 6;

export const NOT_IN_SERVER = 'This command works in a server channel only.';
export const NO_TEAMS = "No team has set this Discord server on Settings › Discord, so there's nobody to check.";
export const PICK_TEAM = 'This server has more than one team. Pick one in the team box.';
export const UNKNOWN_TEAM = "That team isn't one of this server's teams.";
export const UNKNOWN_COMMAND = "This bot doesn't know that command yet.";
export const FAILED = "Couldn't finish the check. Nobody past the ones listed was nudged; try again in a minute.";

const CORS_HEADERS = {
  'Access-Control-Expose-Headers': 'X-WGA-Version',
  'X-WGA-Version': VERSION
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
const say = (content: string) => json({ type: MESSAGE, data: { content, flags: EPHEMERAL } });

function hexBytes(hex: string | null): Uint8Array<ArrayBuffer> | null {
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
  return new Uint8Array(hex.match(/../g)!.map((b) => parseInt(b, 16)));
}

// Ed25519 over timestamp + raw body, with WebCrypto, which Deno and the edge
// runtime both have.
export async function verifySignature(
  publicKey: string | undefined,
  signature: string | null,
  timestamp: string | null,
  body: string
): Promise<boolean> {
  const key = hexBytes(publicKey ?? null);
  const sig = hexBytes(signature);
  if (!key || !sig || !timestamp) return false;
  try {
    const imported = await crypto.subtle.importKey('raw', key, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', imported, sig, new TextEncoder().encode(timestamp + body));
  } catch {
    return false;
  }
}

type Interaction = {
  type: number;
  application_id: string;
  token: string;
  guild_id?: string;
  data?: { name: string; options?: { name: string; value: string; focused?: boolean }[] };
};

const option = (i: Interaction, name: string) => i.data?.options?.find((o) => o.name === name);

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: CORS_HEADERS });
  const body = await req.text();
  const ok = await verifySignature(
    deps.env.get('DISCORD_PUBLIC_KEY'),
    req.headers.get('X-Signature-Ed25519'),
    req.headers.get('X-Signature-Timestamp'),
    body
  );
  if (!ok) return new Response(null, { status: 401, headers: CORS_HEADERS });

  const interaction = JSON.parse(body) as Interaction;
  if (interaction.type === PING) return json({ type: PONG });

  const name = interaction.data?.name;
  if (interaction.type === AUTOCOMPLETE && name === 'nudge-missing') {
    const typed = String(option(interaction, 'team')?.value ?? '').toLowerCase();
    const teams = interaction.guild_id ? await deps.db.teamsInServer(interaction.guild_id) : [];
    const choices = teams
      .filter((t) => t.name.toLowerCase().includes(typed))
      .slice(0, 25)
      .map((t) => ({ name: t.name, value: String(t.id) }));
    return json({ type: CHOICES, data: { choices } });
  }
  if (interaction.type !== COMMAND) return say(UNKNOWN_COMMAND);

  if (name === 'about') return say(`Raid Hub bot, version ${VERSION}.`);
  if (name !== 'nudge-missing') return say(UNKNOWN_COMMAND);

  if (!interaction.guild_id) return say(NOT_IN_SERVER);
  const teams = await deps.db.teamsInServer(interaction.guild_id);
  if (teams.length === 0) return say(NO_TEAMS);
  const picked = option(interaction, 'team')?.value;
  // A team picked from another server's list is refused: the choice has to
  // be one of this server's teams, whatever was typed.
  const team =
    picked === undefined ? (teams.length === 1 ? teams[0] : null) : teams.find((t) => String(t.id) === picked);
  if (!team) return say(picked === undefined ? PICK_TEAM : UNKNOWN_TEAM);

  // Started from a timer, so the answer below is out before any read; a cold
  // supabase-js client could otherwise eat Discord's 3 seconds.
  deps.waitUntil(new Promise((r) => setTimeout(r, 0)).then(() => nudge(deps, interaction, team)));
  return json({ type: DEFERRED_MESSAGE, data: { flags: EPHEMERAL } });
}

type Answer = { ok: boolean; status: number; body: any };

// One Discord REST call as the bot, waiting out one 429.
async function discord(deps: Deps, method: string, path: string, body: unknown): Promise<Answer> {
  const call = () =>
    deps.fetch(API + path, {
      method,
      headers: {
        Authorization: 'Bot ' + (deps.env.get('DISCORD_BOT_TOKEN') ?? ''),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  let res = await call();
  if (res.status === 429) {
    const wait = Number((await res.json().catch(() => ({})))?.retry_after ?? 1) * 1000;
    await (deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(Math.min(wait, 5_000));
    res = await call();
  }
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
}

// Edits the "thinking" answer. The interaction token, not the bot token, is
// what lets this through, but Discord takes the header either way.
const finish = (deps: Deps, i: Interaction, data: unknown) =>
  discord(deps, 'PATCH', `/webhooks/${i.application_id}/${i.token}/messages/@original`, {
    ...(data as object),
    allowed_mentions: { parse: [] }
  });

async function nudge(deps: Deps, interaction: Interaction, team: Team): Promise<void> {
  const nudged: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  try {
    const candidates = nudgeCandidatesFromRows(await deps.db.setupStatus(team.id));
    const since = new Date((deps.now ?? (() => new Date()))().getTime() - COOLDOWN_MS);
    const recent = await deps.db.nudgedSince(
      candidates.map((c) => c.discordId),
      since
    );
    const already = new Set(recent.map((r) => `${r.discordId}:${r.category}`));
    for (const candidate of candidates) {
      const due = candidate.categories.filter((cat) => !already.has(`${candidate.discordId}:${cat}`));
      if (due.length === 0) {
        skipped.push(candidate.nameRealm);
        continue;
      }
      const dm = await discord(deps, 'POST', '/users/@me/channels', { recipient_id: candidate.discordId });
      const sent =
        dm.ok &&
        (
          await discord(deps, 'POST', `/channels/${dm.body?.id}/messages`, {
            embeds: [nudgeEmbed(team.name, candidate, due, deps.env.get('SITE_URL'))],
            allowed_mentions: { parse: [] }
          })
        ).ok;
      if (!sent) {
        failed.push(candidate.nameRealm);
        continue;
      }
      // Only after the DM went out, so a failed one doesn't use up the day.
      await deps.db.recordNudge(candidate.discordId, due);
      nudged.push(candidate.nameRealm);
    }
    await finish(deps, interaction, { embeds: [summaryEmbed(nudged, skipped, failed)] });
  } catch (err) {
    console.error('discord-interactions: /nudge-missing failed:', err);
    await finish(deps, interaction, { content: FAILED, embeds: [summaryEmbed(nudged, skipped, failed)] }).catch(
      () => null
    );
  }
}
