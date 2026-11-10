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
// The recruiting card's and trial message's buttons (#1542) are recruit.ts's.
//
// Commands (#961): /help, /raider me, /raider schedule, /officer
// nudge-missing and /officer invite. The signup sheet's Refresh button (#960)
// and its "Set your status" dropdown and note pop-up (#983) land here too:
// Discord sends a press to the application that posted the message, and
// discord-bot-webhook posts the sheet as this bot.
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
import {
  CLEAR,
  NOTE_PREFIX,
  PASSED_AFTER_MS,
  REFRESH_PREFIX,
  STATUS_PREFIX,
  type DiscordFile,
  type SheetDb,
  WANTS_NOTE,
  refreshSheet,
  startsAt
} from '../_shared/signup-sheet.ts';
import { discordRequestBody } from '../_shared/discord-text.ts';
import { type LineupDb, postLineupNow } from '../_shared/lineup-post.ts';
import {
  MISSING_COOLDOWN,
  REMIND_PREFIX,
  NOT_OPEN,
  type MissingSignups,
  missingEmbed,
  reminderEmbed,
  reminderSummary
} from './missing.ts';
import type { Picture } from '../_shared/sheet-picture.ts';
import { isoDate } from '../_shared/time.ts';
import { type Award, type HelpTeam, type Signup, counted, helpMessage, meMessage, scheduleMessage } from './raider.ts';
import { type RecruitDb, handleRecruit } from './recruit.ts';
import { VERSION } from './version.ts';

export type Team = { id: number; name: string };
// The Raid Hub person behind a Discord account, as seen from one team.
export type Member = {
  personId: number;
  authUserId: string | null;
  // On the team's roster: an unarchived team member, any rank.
  onTeam: boolean;
  // Their characters on the team, archived ones too (items received counts all).
  players: { id: number; nameRealm: string; archived: boolean }[];
};

export interface InteractionsDb {
  // The teams whose Discord server is this one, by name.
  teamsInServer(serverId: string): Promise<Team[]>;
  setupStatus(teamId: number): Promise<WishlistSetupStatusRow[]>;
  // The categories each of these users was nudged about since this time.
  nudgedSince(
    discordIds: string[],
    since: Date
  ): Promise<{ discordId: string; category: NudgeCategory | typeof MISSING_COOLDOWN }[]>;
  recordNudge(discordId: string, categories: (NudgeCategory | typeof MISSING_COOLDOWN)[]): Promise<void>;
  // The team's active roster and who has a live signup for the season open
  // for signups; null when none is open.
  missingSignups(teamId: number): Promise<MissingSignups>;
  // Whether the Raid Hub person with this Discord account holds this team
  // permission on the team, by their rank there (owners hold every one).
  hasTeamPermission(discordId: string, teamId: number, permission: string): Promise<boolean>;
  // The person with this Discord account; null when no profile has it.
  member(discordId: string, teamId: number): Promise<Member | null>;
  // Their signup for the team's season open for signups; null when none is.
  signup(member: Member, teamId: number): Promise<Signup>;
  // These characters' awards this season, and the team's saved response list.
  awards(teamId: number, playerIds: number[]): Promise<{ awards: Award[]; list: unknown }>;
  // discord_set_rsvp(): the raider's own answer for one raid night, null to
  // clear it. Answers null when saved, else the database's refusal.
  setRsvp(
    discordId: string,
    teamId: number,
    raidDate: string,
    status: string | null,
    note: string | null
  ): Promise<string | null>;
  // The team's invite code, when it has one that hasn't run out.
  inviteCode(teamId: number): Promise<string | null>;
  // The kinds of post the team has a channel for.
  posts(teamId: number): Promise<{ kind: string; channelId: string }[]>;
}

export type Env = { get(name: string): string | undefined };

export type Deps = {
  fetch: typeof fetch;
  env: Env;
  db: InteractionsDb;
  sheets: SheetDb;
  // The signup sheet's picture (#983); left out, sheets are text.
  drawPicture?: (picture: Picture) => Promise<Uint8Array>;
  // /officer post lineup (#1709): the lineup reads, and how its grid is drawn.
  lineups?: LineupDb;
  drawSvg?: (svg: string) => Promise<Uint8Array>;
  // The recruiting buttons (#1542): the recruit record's reads and the bot_* actions.
  recruits?: RecruitDb;
  waitUntil(work: Promise<unknown>): void;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

export const API = 'https://discord.com/api/v10';
export const COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Discord's numbers.
const PING = 1;
const COMMAND = 2;
const BUTTON = 3;
const AUTOCOMPLETE = 4;
const MODAL_SUBMIT = 5;
const PONG = 1;
const MESSAGE = 4;
const DEFERRED_MESSAGE = 5;
const DEFERRED_UPDATE = 6;
const CHOICES = 8;
const MODAL = 9;
const EPHEMERAL = 1 << 6;

export const NOT_IN_SERVER = 'This command works in a server channel only.';
export const NO_TEAMS = "No team has set this Discord server on Settings › Discord, so there's nobody to check.";
export const PICK_TEAM = 'This server has more than one team. Pick one in the team box.';
export const UNKNOWN_TEAM = "That team isn't one of this server's teams.";
export const UNKNOWN_COMMAND = "This bot doesn't know that command yet.";
// Who may nudge: the team's Manage loot and View loot permissions, both
// officers' by default; the summary names who is missing loot setup, which
// is a View loot read. Discord's own command setting is only a default a
// server admin can open to any role, so the function checks again
// (CodeRabbit on #1743).
export const NUDGE_PERMISSIONS = ['manage_loot', 'view_loot'];
export const NOT_ALLOWED = (team: string) =>
  `Only people who manage loot for ${team} on Raid Hub can nudge its raiders. If that's you, make sure this Discord account is the one on your Raid Hub profile.`;
export const FAILED = "Couldn't finish the check. Nobody past the ones listed was nudged; try again in a minute.";
export const BROKE = 'Something went wrong reading Raid Hub. Try again in a minute.';
export const NO_PROFILE = (siteUrl?: string) =>
  `This Discord account isn't on a Raid Hub profile yet. Sign in${siteUrl ? ` at ${siteUrl}` : ''} with Discord to claim yours.`;
export const NOT_ON_TEAM = (team: string) =>
  `You're not on ${team}'s roster on Raid Hub. If you should be, ask one of its officers.`;
// /officer missing-signups (#990): whoever manages the team's signups.
export const MISSING_PERMISSION = 'manage_signups';
export const MISSING_NOT_ALLOWED = (team: string) =>
  `Only people who can manage ${team}'s signups on Raid Hub can see who hasn't signed up.`;
// Who may post the invite link: whoever can see it on the site, by the
// team's Edit roster permission (team_invite_links' read rule).
export const INVITE_PERMISSION = 'edit_roster';
export const INVITE_NOT_ALLOWED = (team: string) =>
  `Only people who can edit ${team}'s roster on Raid Hub can post its invite link.`;
export const NO_INVITE = (team: string) =>
  `${team} has no invite link right now. An officer can make one on Settings › Invite link.`;
export const INVITE_POSTED = (team: string) => `Posted ${team}'s invite link in this channel.`;
// The signup sheet's dropdown (#983): what the raider is told.
export const NOTE_MAX = 200;
export const RAID_OVER = "This raid is over, so its answers can't be changed from Discord any more.";
export const NO_RAID = 'There is no raid that night any more.';
export const NO_CHARACTER =
  "You don't have a character on this team's roster on Raid Hub. If you should, ask one of its officers.";
export const BENCH = "You're on the bench, so there's nothing to answer for a normal raid night.";
export const ATTENDING_OPTIONAL = 'Attending is only for optional raid nights.';
export const NOTE_REQUIRED = 'A note is required so officers know why. Pick the answer again and add one.';
export const SAVED = (status: string, day: string) => `Saved: **${status}** for ${day}.`;
export const CLEARED = (day: string, optional: boolean) =>
  `Cleared: you're back to ${optional ? 'no answer' : 'Present'} for ${day}.`;
// /officer post lineup (#1709): whoever manages the team's raid schedule.
export const LINEUP_PERMISSION = 'edit_schedule';
export const LINEUP_NOT_ALLOWED = (team: string) =>
  `Only people who can edit ${team}'s raid schedule on Raid Hub can post its lineup.`;
export const LINEUP_NOT_SET = (team: string) =>
  `${team} has no lineup channel yet. An officer can pick one on Settings › Discord, under Weekly lineup.`;
export const LINEUP_BAD_DATE = 'Give the date as YYYY-MM-DD, for example 2026-11-05.';
export const LINEUP_NO_NIGHT = (team: string) => `${team} has no raid night coming up in the next two weeks.`;
export const LINEUP_NONE = (team: string, day: string) => `${team} has no boss lineup saved for ${day} yet.`;
export const LINEUP_NOT_IN_SERVER =
  "The lineup channel isn't in this team's Discord server any more. Pick it again on Settings › Discord.";
export const LINEUP_POSTED = (team: string, day: string) => `Posted ${team}'s lineup for ${day}.`;
// How far ahead /raider schedule looks.
export const SCHEDULE_DAYS = 14;

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
  member?: { user?: { id: string } };
  data?: {
    name: string;
    custom_id?: string;
    options?: Opt[];
    // A select menu's pick, and a pop-up's text boxes.
    values?: string[];
    components?: { components?: { custom_id?: string; value?: string }[] }[];
  };
};
type Opt = { name: string; type?: number; value?: string; focused?: boolean; options?: Opt[] };

// The command as typed, "raider me" or "officer post lineup", and the options
// under its subcommand.
function leaf(i: Interaction): { path: string; options: Opt[] } {
  const top = i.data?.options ?? [];
  const group = top.find((o) => o.type === 2);
  const groupSub = group?.options?.find((o) => o.type === 1);
  if (group && groupSub) {
    return { path: `${i.data?.name} ${group.name} ${groupSub.name}`, options: groupSub.options ?? [] };
  }
  const sub = top.find((o) => o.type === 1);
  return sub
    ? { path: `${i.data?.name} ${sub.name}`, options: sub.options ?? [] }
    : { path: i.data?.name ?? '', options: top };
}
const teamPicked = (options: Opt[]) => options.find((o) => o.name === 'team')?.value;

type Run = (deps: Deps, i: Interaction, serverId: string, options: Opt[]) => Promise<void>;

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

  const { path, options } = leaf(interaction);
  if (interaction.type === AUTOCOMPLETE && options.some((o) => o.name === 'team' && o.focused)) {
    const typed = String(teamPicked(options) ?? '').toLowerCase();
    const teams = interaction.guild_id ? await deps.db.teamsInServer(interaction.guild_id) : [];
    const choices = teams
      .filter((t) => t.name.toLowerCase().includes(typed))
      .slice(0, 25)
      .map((t) => ({ name: t.name, value: String(t.id) }));
    return json({ type: CHOICES, data: { choices } });
  }
  if (interaction.type === BUTTON && interaction.data?.custom_id?.startsWith(REFRESH_PREFIX)) {
    // signup-sheet-refresh:<team id>:<raid date>. The press is answered at
    // once with "the message will change"; the edit follows.
    const [teamId, raidDate] = interaction.data.custom_id.slice(REFRESH_PREFIX.length).split(':');
    deps.waitUntil(
      new Promise((r) => setTimeout(r, 0))
        .then(() =>
          refreshSheet(
            {
              db: deps.sheets,
              discord: (method, path, body, files) => discord(deps, method, path, body, files),
              draw: deps.drawPicture,
              siteUrl: deps.env.get('SITE_URL'),
              now: (deps.now ?? (() => new Date()))()
            },
            Number(teamId),
            raidDate
          )
        )
        .catch((err) => console.error('discord-interactions: signup sheet refresh failed:', err))
    );
    return json({ type: DEFERRED_UPDATE });
  }
  const customId = interaction.data?.custom_id ?? '';
  if (interaction.type === BUTTON && customId.startsWith(REMIND_PREFIX)) {
    // missing-signups-remind:<team id>. Answered with "thinking", only the
    // officer's; the DMs follow, after the permission is checked again.
    const teamId = Number(customId.slice(REMIND_PREFIX.length));
    deps.waitUntil(
      new Promise((r) => setTimeout(r, 0))
        .then(() => remind(deps, interaction, teamId))
        .catch(async (err) => {
          console.error('discord-interactions: signup reminders failed:', err);
          await finish(deps, interaction, { content: BROKE }).catch(() => null);
        })
    );
    return json({ type: DEFERRED_MESSAGE, data: { flags: EPHEMERAL } });
  }
  if (interaction.type === BUTTON && customId.startsWith(STATUS_PREFIX)) {
    // signup-sheet-status:<team id>:<raid date>. An answer that wants a note
    // opens the pop-up, which has to be the first answer: no read before it.
    const [teamId, raidDate] = customId.slice(STATUS_PREFIX.length).split(':');
    const picked = interaction.data?.values?.[0] ?? '';
    if (WANTS_NOTE.has(picked)) return json(noteModal(teamId, raidDate, picked));
    if (picked !== CLEAR && picked !== 'Attending') return say(UNKNOWN_COMMAND);
    return setOwn(deps, interaction, Number(teamId), raidDate, picked === CLEAR ? null : picked, null);
  }
  if (interaction.type === MODAL_SUBMIT && customId.startsWith(NOTE_PREFIX)) {
    // signup-sheet-note:<team id>:<raid date>:<status>
    const [teamId, raidDate, status] = customId.slice(NOTE_PREFIX.length).split(':');
    if (!WANTS_NOTE.has(status)) return say(UNKNOWN_COMMAND);
    const note = String(interaction.data?.components?.[0]?.components?.[0]?.value ?? '').trim();
    return setOwn(deps, interaction, Number(teamId), raidDate, status, note || null);
  }
  if (deps.recruits) {
    // The recruiting card and trial message (#1542), and their pop-ups.
    const recruit = handleRecruit(
      {
        db: deps.recruits,
        discord: (method, path, body) => discord(deps, method, path, body),
        waitUntil: (work) => deps.waitUntil(work),
        now: deps.now ?? (() => new Date())
      },
      interaction
    );
    if (recruit) return recruit;
  }
  if (interaction.type !== COMMAND) return say(UNKNOWN_COMMAND);

  const run = RUNS[path];
  if (!run) return say(UNKNOWN_COMMAND);
  const serverId = interaction.guild_id;
  if (!serverId) return say(NOT_IN_SERVER);

  // Started from a timer, so the answer below is out before any read, the
  // server's teams included; a cold supabase-js client could otherwise eat
  // Discord's 3 seconds.
  deps.waitUntil(
    new Promise((r) => setTimeout(r, 0))
      .then(() => run(deps, interaction, serverId, options))
      .catch(async (err) => {
        console.error(`discord-interactions: /${path} failed:`, err);
        await finish(deps, interaction, { content: BROKE }).catch(() => null);
      })
  );
  return json({ type: DEFERRED_MESSAGE, data: { flags: EPHEMERAL } });
}

// The note pop-up for an answer that wants a reason. The site asks for one
// too, so officers know why.
const noteModal = (teamId: string, raidDate: string, status: string) => ({
  type: MODAL,
  data: {
    custom_id: `${NOTE_PREFIX}${teamId}:${raidDate}:${status}`,
    title: `${status}: add a note`,
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: 'note',
            style: 2,
            label: 'Why? Officers see this',
            required: true,
            max_length: NOTE_MAX
          }
        ]
      }
    ]
  }
});

const dayName = (raidDate: string) =>
  new Date(raidDate + 'T00:00:00Z').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC'
  });

// What the raider is told when the database refuses; null for an error that
// isn't a refusal.
function refusal(message: string, siteUrl?: string): string | null {
  if (message.includes('No Raid Hub profile')) return NO_PROFILE(siteUrl);
  if (message.includes('No active roster character')) return NO_CHARACTER;
  if (message.includes('Bench players')) return BENCH;
  if (message.includes('Attending is only valid')) return ATTENDING_OPTIONAL;
  if (message.includes('A note is required')) return NOTE_REQUIRED;
  return null;
}

// The raider's own answer from the sheet (#983): "thinking" at once, which
// only they see; then saved for the Discord account that pressed it, told how
// it went, and the sheet brought up to date. A raid that has passed is
// refused: its sheet stays up but no longer changes.
function setOwn(
  deps: Deps,
  i: Interaction,
  teamId: number,
  raidDate: string,
  status: string | null,
  note: string | null
): Response {
  const caller = i.member?.user?.id;
  if (!caller) return say(NOT_IN_SERVER);
  deps.waitUntil(
    new Promise((r) => setTimeout(r, 0))
      .then(async () => {
        const now = (deps.now ?? (() => new Date()))();
        const night = await deps.sheets.night(teamId, raidDate);
        if (!night.exists) return finish(deps, i, { content: NO_RAID });
        const at = startsAt(raidDate, night);
        if (at && now.getTime() >= at.getTime() + PASSED_AFTER_MS) return finish(deps, i, { content: RAID_OVER });
        const refused = await deps.db.setRsvp(caller, teamId, raidDate, status, note);
        if (refused !== null) {
          const told = refusal(refused, deps.env.get('SITE_URL'));
          if (!told) console.error('discord-interactions: discord_set_rsvp failed:', refused);
          return finish(deps, i, { content: told ?? BROKE });
        }
        const day = dayName(raidDate);
        await finish(deps, i, { content: status ? SAVED(status, day) : CLEARED(day, night.isOptional) });
        // The answer is saved and the raider told so: a failed refresh is
        // only logged, or "try again" would send a second notice to the RSVP
        // channel (CodeRabbit on #1758). The 15-minute run catches the sheet up.
        await refreshSheet(
          {
            db: deps.sheets,
            discord: (method, path, body, files) => discord(deps, method, path, body, files),
            draw: deps.drawPicture,
            siteUrl: deps.env.get('SITE_URL'),
            now
          },
          teamId,
          raidDate
        ).catch((err) => console.error('discord-interactions: signup sheet refresh failed:', err));
      })
      .catch(async (err) => {
        console.error('discord-interactions: signup sheet answer failed:', err);
        await finish(deps, i, { content: BROKE }).catch(() => null);
      })
  );
  return json({ type: DEFERRED_MESSAGE, data: { flags: EPHEMERAL } });
}

type Answer = { ok: boolean; status: number; body: any };

// One Discord REST call as the bot, waiting out one 429.
async function discord(
  deps: Deps,
  method: string,
  path: string,
  body?: unknown,
  files?: DiscordFile[]
): Promise<Answer> {
  const call = () => {
    const request = discordRequestBody(body, files);
    return deps.fetch(API + path, {
      method,
      headers: { Authorization: 'Bot ' + (deps.env.get('DISCORD_BOT_TOKEN') ?? ''), ...request.headers },
      body: request.body
    });
  };
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

// The team the command is for: the one picked, which has to be one of this
// server's teams whatever was typed, or the server's only team.
function pickTeam(teams: Team[], picked: string | undefined): Team | string {
  if (teams.length === 0) return NO_TEAMS;
  if (picked === undefined) return teams.length === 1 ? teams[0] : PICK_TEAM;
  return teams.find((t) => String(t.id) === picked) ?? UNKNOWN_TEAM;
}

// The team picked, or null once the refusal is sent.
async function teamFor(deps: Deps, i: Interaction, serverId: string, options: Opt[]): Promise<Team | null> {
  const team = pickTeam(await deps.db.teamsInServer(serverId), teamPicked(options));
  if (typeof team !== 'string') return team;
  await finish(deps, i, { content: team });
  return null;
}

// A raider command's team and caller: on the team's roster, by their Raid Hub
// profile. Null once the refusal is sent.
async function raiderOn(
  deps: Deps,
  i: Interaction,
  serverId: string,
  options: Opt[]
): Promise<{ team: Team; member: Member } | null> {
  const team = await teamFor(deps, i, serverId, options);
  if (!team) return null;
  const caller = i.member?.user?.id;
  const member = caller ? await deps.db.member(caller, team.id) : null;
  if (!member) {
    await finish(deps, i, { content: NO_PROFILE(deps.env.get('SITE_URL')) });
    return null;
  }
  if (!member.onTeam) {
    await finish(deps, i, { content: NOT_ON_TEAM(team.name) });
    return null;
  }
  return { team, member };
}

const firstName = (nameRealm: string) => nameRealm.split('-')[0].trim();

const me: Run = async (deps, i, serverId, options) => {
  const on = await raiderOn(deps, i, serverId, options);
  if (!on) return;
  const { team, member } = on;
  const ids = new Set(member.players.map((p) => p.id));
  const [status, signup, loot] = await Promise.all([
    deps.db.setupStatus(team.id),
    deps.db.signup(member, team.id),
    deps.db.awards(team.id, [...ids])
  ]);
  const main = member.players.find((p) => !p.archived);
  await finish(
    deps,
    i,
    meMessage({
      teamName: team.name,
      firstName: main ? firstName(main.nameRealm) : null,
      wishlist: status.filter((r) => ids.has(r.player_id)),
      signup,
      received: counted(loot.awards, loot.list),
      siteUrl: deps.env.get('SITE_URL')
    })
  );
};

const schedule: Run = async (deps, i, serverId, options) => {
  const on = await raiderOn(deps, i, serverId, options);
  if (!on) return;
  const { team, member } = on;
  const now = (deps.now ?? (() => new Date()))();
  // From yesterday by UTC date: an evening raid in the Americas is already
  // the next day in UTC. Nights that have started are dropped below.
  const dates = Array.from({ length: SCHEDULE_DAYS + 1 }, (_, n) => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + n - 1);
    return isoDate(d);
  });
  const nights = (
    await Promise.all(dates.map(async (raidDate) => ({ raidDate, night: await deps.sheets.night(team.id, raidDate) })))
  ).filter(({ raidDate, night }) => {
    if (!night.exists) return false;
    const at = startsAt(raidDate, night);
    return at ? at > now : raidDate >= isoDate(now);
  });
  const mine = new Set(member.players.filter((p) => !p.archived).map((p) => p.id));
  const answered = await Promise.all(
    nights.map(async (n) => {
      const rsvps = await deps.sheets.rsvps(team.id, n.raidDate);
      return { ...n, status: rsvps.find((r) => mine.has(r.playerId))?.status ?? null };
    })
  );
  await finish(deps, i, scheduleMessage(team.name, answered));
};

const invite: Run = async (deps, i, serverId, options) => {
  const team = await teamFor(deps, i, serverId, options);
  if (!team) return;
  const caller = i.member?.user?.id;
  if (!caller || !(await deps.db.hasTeamPermission(caller, team.id, INVITE_PERMISSION))) {
    await finish(deps, i, { content: INVITE_NOT_ALLOWED(team.name) });
    return;
  }
  const code = await deps.db.inviteCode(team.id);
  const site = deps.env.get('SITE_URL')?.replace(/\/$/, '');
  if (!code || !site) {
    await finish(deps, i, { content: NO_INVITE(team.name) });
    return;
  }
  // The "thinking" answer is settled first: Discord takes the first follow-up
  // after it as an edit of it, still "only you" (CodeRabbit on #1751). The
  // next follow-up is a message of its own, which the channel sees.
  await finish(deps, i, { content: INVITE_POSTED(team.name) });
  const posted = await discord(deps, 'POST', `/webhooks/${i.application_id}/${i.token}`, {
    content: `Join **${team.name}** on Raid Hub: ${site}/join/${code}`,
    allowed_mentions: { parse: [] }
  });
  if (!posted.ok) await finish(deps, i, { content: BROKE });
};

// What /help lists, and who may use each: anyone on the team for /raider,
// the matching permissions for /officer.
const HELP_COMMANDS: {
  line: string;
  may: (perm: (p: string) => Promise<boolean>, onTeam: boolean) => Promise<boolean>;
}[] = [
  { line: '`/raider me` -- your wishlist, season signup and items received', may: (_p, on) => Promise.resolve(on) },
  { line: '`/raider schedule` -- your next raid nights and your RSVP for each', may: (_p, on) => Promise.resolve(on) },
  {
    line: '`/officer nudge-missing` -- DM raiders whose loot setup is missing something',
    may: async (perm) => (await Promise.all(NUDGE_PERMISSIONS.map(perm))).every(Boolean)
  },
  {
    line: "`/officer missing-signups` -- who hasn't signed up for the coming season",
    may: (perm) => perm(MISSING_PERMISSION)
  },
  { line: "`/officer invite` -- post the team's invite link", may: (perm) => perm(INVITE_PERMISSION) },
  { line: "`/officer post lineup` -- post a raid night's boss lineup now", may: (perm) => perm(LINEUP_PERMISSION) }
];

const POST_LABELS: Record<string, string> = {
  officer_requests: 'Officer requests',
  mplus_requests: 'M+ requests',
  rsvp_changes: 'RSVP changes',
  weekly_lineup: 'Weekly lineup'
};

const help: Run = async (deps, i, serverId) => {
  const caller = i.member?.user?.id;
  const teams = await deps.db.teamsInServer(serverId);
  const allowed = new Set<string>();
  const shown: HelpTeam[] = [];
  for (const team of teams) {
    const member = caller ? await deps.db.member(caller, team.id) : null;
    // A team's channels only to the people on it (CodeRabbit on #1751); its
    // name to everyone in the server.
    if (!member?.onTeam) {
      shown.push({ name: team.name, posts: null });
    } else {
      const [sheets, posts] = await Promise.all([deps.sheets.teamSheets(team.id), deps.db.posts(team.id)]);
      shown.push({
        name: team.name,
        posts: [
          ...[...new Set((sheets?.sheets ?? []).map((s) => s.channelId))].map((channelId) => ({
            label: 'Signup sheets',
            channelId
          })),
          ...posts.map((p) => ({ label: POST_LABELS[p.kind] ?? p.kind, channelId: p.channelId }))
        ]
      });
    }
    if (!caller || !member) continue;
    const perm = (p: string) => deps.db.hasTeamPermission(caller, team.id, p);
    for (const c of HELP_COMMANDS) if (!allowed.has(c.line) && (await c.may(perm, member.onTeam))) allowed.add(c.line);
  }
  const commands = HELP_COMMANDS.filter((c) => allowed.has(c.line)).map((c) => c.line);
  await finish(
    deps,
    i,
    helpMessage({ teams: shown, commands: ['`/help` -- this message', ...commands], version: VERSION })
  );
};

const nudge: Run = async (deps, interaction, serverId, options) => {
  const nudged: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  try {
    const team = pickTeam(await deps.db.teamsInServer(serverId), teamPicked(options));
    if (typeof team === 'string') {
      await finish(deps, interaction, { content: team });
      return;
    }
    const caller = interaction.member?.user?.id;
    const allowed =
      !!caller &&
      (await Promise.all(NUDGE_PERMISSIONS.map((p) => deps.db.hasTeamPermission(caller, team.id, p)))).every(Boolean);
    if (!allowed) {
      await finish(deps, interaction, { content: NOT_ALLOWED(team.name) });
      return;
    }
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
    console.error('discord-interactions: /officer nudge-missing failed:', err);
    await finish(deps, interaction, { content: FAILED, embeds: [summaryEmbed(nudged, skipped, failed)] }).catch(
      () => null
    );
  }
};

// The officer's check, run again on the button: the team's Manage signups.
async function mayManageSignups(deps: Deps, i: Interaction, team: Team): Promise<boolean> {
  const caller = i.member?.user?.id;
  if (caller && (await deps.db.hasTeamPermission(caller, team.id, MISSING_PERMISSION))) return true;
  await finish(deps, i, { content: MISSING_NOT_ALLOWED(team.name) });
  return false;
}

const missingSignups: Run = async (deps, i, serverId, options) => {
  const team = await teamFor(deps, i, serverId, options);
  if (!team || !(await mayManageSignups(deps, i, team))) return;
  const open = await deps.db.missingSignups(team.id);
  if (!open) {
    await finish(deps, i, { content: NOT_OPEN(team.name) });
    return;
  }
  const button = { type: 2, style: 1, label: 'DM them a reminder', custom_id: REMIND_PREFIX + team.id };
  await finish(deps, i, {
    embeds: [missingEmbed(team.name, open, deps.env.get('SITE_URL'))],
    components: open.roster.some((r) => !r.signedUp) ? [{ type: 1, components: [button] }] : []
  });
};

// The button: DMs each raider still missing a signup, at most once a day.
async function remind(deps: Deps, i: Interaction, teamId: number): Promise<void> {
  // The team has to be one of this server's, whatever the button says.
  const team = i.guild_id ? (await deps.db.teamsInServer(i.guild_id)).find((t) => t.id === teamId) : undefined;
  if (!team) {
    await finish(deps, i, { content: UNKNOWN_TEAM });
    return;
  }
  if (!(await mayManageSignups(deps, i, team))) return;
  const open = await deps.db.missingSignups(team.id);
  if (!open) {
    await finish(deps, i, { content: NOT_OPEN(team.name) });
    return;
  }
  const reminded: string[] = [];
  const skipped: string[] = [];
  const closed: string[] = [];
  const noDiscord: string[] = [];
  try {
    // One DM per Discord account, however many of its characters are missing.
    const byPerson = new Map<string, string[]>();
    for (const r of open.roster) {
      if (r.signedUp) continue;
      if (!r.discordId) noDiscord.push(r.nameRealm);
      else byPerson.set(r.discordId, [...(byPerson.get(r.discordId) ?? []), r.nameRealm]);
    }
    const since = new Date((deps.now ?? (() => new Date()))().getTime() - COOLDOWN_MS);
    const recent = new Set(
      (await deps.db.nudgedSince([...byPerson.keys()], since))
        .filter((r) => r.category === MISSING_COOLDOWN)
        .map((r) => r.discordId)
    );
    for (const [discordId, names] of byPerson) {
      const label = names.join(', ');
      if (recent.has(discordId)) {
        skipped.push(label);
        continue;
      }
      const dm = await discord(deps, 'POST', '/users/@me/channels', { recipient_id: discordId });
      const sent =
        dm.ok &&
        (
          await discord(deps, 'POST', `/channels/${dm.body?.id}/messages`, {
            embeds: [reminderEmbed(team.name, open.seasonName, names[0], deps.env.get('SITE_URL'))],
            allowed_mentions: { parse: [] }
          })
        ).ok;
      if (!sent) {
        closed.push(label);
        continue;
      }
      // Only after the DM went out, so a failed one doesn't use up the day.
      await deps.db.recordNudge(discordId, [MISSING_COOLDOWN]);
      reminded.push(label);
    }
    await finish(deps, i, { embeds: [reminderSummary(reminded, skipped, closed, noDiscord)] });
  } catch (err) {
    console.error('discord-interactions: signup reminders failed:', err);
    await finish(deps, i, { content: FAILED, embeds: [reminderSummary(reminded, skipped, closed, noDiscord)] }).catch(
      () => null
    );
  }
}

const postLineup: Run = async (deps, i, serverId, options) => {
  const team = await teamFor(deps, i, serverId, options);
  if (!team) return;
  const caller = i.member?.user?.id;
  if (!caller || !(await deps.db.hasTeamPermission(caller, team.id, LINEUP_PERMISSION))) {
    await finish(deps, i, { content: LINEUP_NOT_ALLOWED(team.name) });
    return;
  }
  const now = (deps.now ?? (() => new Date()))();
  const given = options.find((o) => o.name === 'date')?.value;
  let raidDate: string | null = null;
  if (given !== undefined) {
    const ms = /^\d{4}-\d{2}-\d{2}$/.test(given) ? Date.parse(given + 'T00:00:00Z') : NaN;
    if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== given) {
      await finish(deps, i, { content: LINEUP_BAD_DATE });
      return;
    }
    raidDate = given;
  } else {
    // The next raid night not yet started, looking as far as /raider schedule.
    for (let n = -1; n <= SCHEDULE_DAYS && !raidDate; n++) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() + n);
      const date = isoDate(d);
      const night = await deps.sheets.night(team.id, date);
      const at = night.exists ? startsAt(date, night) : null;
      if (night.exists && (at ? at > now : date >= isoDate(now))) raidDate = date;
    }
    if (!raidDate) {
      await finish(deps, i, { content: LINEUP_NO_NIGHT(team.name) });
      return;
    }
  }
  if (!deps.lineups) {
    await finish(deps, i, { content: LINEUP_NOT_SET(team.name) });
    return;
  }
  const day = dayName(raidDate);
  const result = await postLineupNow(
    {
      db: deps.lineups,
      discord: (method, path, body, files) => discord(deps, method, path, body, files),
      siteUrl: deps.env.get('SITE_URL'),
      now,
      draw: deps.drawSvg
    },
    team.id,
    raidDate
  );
  const said: Record<typeof result, string> = {
    posted: LINEUP_POSTED(team.name, day),
    'no lineup': LINEUP_NONE(team.name, day),
    'not set': LINEUP_NOT_SET(team.name),
    'not in server': LINEUP_NOT_IN_SERVER
  };
  await finish(deps, i, { content: said[result] });
};

// Each command as Discord sends it: the group, then the subcommand.
const RUNS: Record<string, Run> = {
  help,
  'raider me': me,
  'raider schedule': schedule,
  'officer nudge-missing': nudge,
  'officer missing-signups': missingSignups,
  'officer invite': invite,
  'officer post lineup': postLineup
};
