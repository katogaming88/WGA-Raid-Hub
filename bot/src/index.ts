import 'dotenv/config';
// @supabase/supabase-js's RealtimeClient constructs a WebSocket internally
// even for callers (like this bot, and wishlistStatus.ts before it) that
// never touch realtime -- it expects a native global WebSocket, which only
// exists from Node 22+. This VM runs Node 20 (per DEPLOYMENT.md), so every
// createClient() call throws "native WebSocket not found" without this
// polyfill. `ws` is already a transitive dependency via discord.js; set as
// a global here, once, before any Supabase client is constructed anywhere
// in this process.
import WebSocket from 'ws';
(globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = WebSocket;
import { createClient } from '@supabase/supabase-js';
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  TextChannel,
  REST,
  Routes,
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits
} from 'discord.js';
import express, { Request, Response } from 'express';
import { fetchNudgeCandidates, NudgeCategory, profileDeepLink } from './wishlistStatus';
import { filterAndRecordNudges } from './nudgeLog';
import { runSignupSheetSweep, syncSignupSheet, SignupSheetContext } from './signupSheet';
import {
  TeamConfig,
  TeamConfigCache,
  attendanceChannelId,
  signupChannelId,
  TEAM_CONFIG_REFRESH_INTERVAL_MS
} from './teamConfig';

// #991: one bot process now serves every team, reading each team's guild
// id/channel ids/ping role ids/script URLs from team_discord_config at
// runtime (see teamConfig.ts) instead of one process per team with all of
// that baked in as env vars. What's left as an env var below is genuinely
// process-wide: the one Discord Application's token, the one shared
// webhook secret validating the relay (see checkSecret -- there is exactly
// one trusted caller regardless of which team's payload it carries, so
// per-team secrets added isolation with no real security benefit here),
// Supabase credentials, the one deployed site's URL, and where the nudge
// cooldown log lives (already safe to share across teams unmodified --
// filterAndRecordNudges keys on Discord user id, which is globally unique
// on its own, not per-guild).
//
// WGA's three teams all share ONE Discord server (confirmed after an
// earlier draft of this file wrongly assumed one guild per team) -- so a
// Discord guild id, and in general the channel an interaction fires in,
// cannot tell two teams apart. Every slash command instead takes a required
// `team` choice (see buildCommands()/teamOption()), and every relay route
// resolves `team` from the request body (see resolveTeam()). The one place
// a guild id is still used for its own sake is slash-command *registration*
// (register once per distinct guild, not per team row) -- see
// registerCommands().

const rawToken = process.env.DISCORD_BOT_TOKEN;
const rawSupabaseUrl = process.env.SUPABASE_URL;
const rawServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!rawToken) {
  console.error('Missing required env var: DISCORD_BOT_TOKEN');
  process.exit(1);
}
if (!rawSupabaseUrl || !rawServiceRoleKey) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const BOT_TOKEN: string = rawToken;
const SUPABASE_URL: string = rawSupabaseUrl;
const SUPABASE_SERVICE_ROLE_KEY: string = rawServiceRoleKey;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const PORT = process.env.PORT ?? '3000';
const SITE_URL = process.env.SITE_URL;
const NUDGE_LOG_PATH = process.env.NUDGE_LOG_PATH ?? './data/nudge-log.json';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const teamConfigs = new TeamConfigCache(supabase);

// WGA's three teams all live in the same Discord server -- confirmed after
// initially assuming one guild per team, which #991's first draft got wrong.
// So neither the guild nor (in general) the channel an interaction fires in
// disambiguates which team a command is for; every command below takes a
// required `team` choice instead. Built as a function, not a module-level
// constant, since the choice list depends on teamConfigs -- rebuilt (and
// re-registered) whenever the cache refreshes, so a newly-added team shows
// up as a choice without a bot restart.
function teamOption(opt: import('discord.js').SlashCommandStringOption): import('discord.js').SlashCommandStringOption {
  const choices = teamConfigs.all().map((cfg) => ({ name: cfg.name, value: cfg.slug }));
  return opt
    .setName('team')
    .setDescription('Which team')
    .setRequired(true)
    .addChoices(...choices);
}

function buildCommands() {
  return [
    new SlashCommandBuilder()
      .setName('resend')
      .setDescription('Re-send the last N M+ exclusion submissions from the Google Form')
      .addStringOption(teamOption)
      .addIntegerOption((opt) =>
        opt
          .setName('count')
          .setDescription('Number of submissions to resend (1-20)')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(20)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('pending-roster')
      .setDescription('List all current pending signup applicants')
      .addStringOption(teamOption)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('trials')
      .setDescription('List all players currently on trial with how long they have been on the roster')
      .addStringOption(teamOption)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('bench')
      .setDescription('List all benched players')
      .addStringOption(teamOption)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('attendance')
      .setDescription('Show attendance percentage for a specific player')
      .addStringOption(teamOption)
      .addStringOption((opt) =>
        opt.setName('player').setDescription('Player first name (e.g. Katorri)').setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('absences')
      .setDescription('List players currently below the attendance threshold')
      .addStringOption(teamOption)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('mplus-excluded')
      .setDescription('List all players approved for M+ exclusion')
      .addStringOption(teamOption)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('fairness')
      .setDescription('Quick loot distribution summary -- who has received the most vs least items this tier')
      .addStringOption(teamOption)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('officers')
      .setDescription('List current officers and their claimed Discord usernames')
      .addStringOption(teamOption)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('nudge-missing')
      .setDescription('DM raiders missing a wishlist, BiS source link, or a real BiS pick on their wishlist')
      .addStringOption(teamOption)
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .toJSON()
  ];
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function registerCommands(): Promise<void> {
  await teamConfigs.refresh();
  const commands = buildCommands();
  const rest = new REST().setToken(BOT_TOKEN);
  // One registration call per distinct guild, not per team -- multiple teams
  // can (and, for WGA, do) share one guild, so registering once per team row
  // would just repeat the same call for the same guild.
  const guildIds = new Set(teamConfigs.all().map((cfg) => cfg.guildId));
  for (const guildId of guildIds) {
    try {
      await rest.put(Routes.applicationGuildCommands(client.user!.id, guildId), { body: commands });
      console.log(`Slash commands registered for guild ${guildId}.`);
    } catch (err) {
      console.error(`Slash command registration failed for guild ${guildId}:`, err);
    }
  }
}

client.once('clientReady', async () => {
  console.log(`Bot ready: ${client.user?.tag}`);
  await registerCommands();
  // Re-registering also refreshes the config cache first (see
  // registerCommands' teamConfigs.refresh() call) so a team added later
  // shows up both in lookups and as a `team` choice, without a restart.
  setInterval(() => {
    registerCommands().catch((err) => console.error('Periodic command re-registration failed:', err));
  }, TEAM_CONFIG_REFRESH_INTERVAL_MS);
});

client.on('error', (error) => {
  console.error('Discord client error:', error);
});

// ── Roster script fetch helpers ──────────────────────────────────────────────

interface CorePayload {
  roster: RosterPlayer[];
  trialAttend: number;
  trialWeeks: number;
  officerDiscordIds: string[];
  discordClaims: DiscordClaim[];
  seasonName: string;
}

interface HeavyPayload {
  lootCounts: Record<string, LootCount>;
}

interface PendingRosterPayload {
  entries: PendingEntry[];
}

interface RosterPlayer {
  nameRealm: string;
  firstName: string;
  class: string;
  spec: string;
  role: string;
  isTrial: boolean;
  isBench: boolean;
  mPlusExcluded: boolean;
  mPlusNote: string;
  attendance: string;
  joinDate: string;
}

interface LootCount {
  count: number;
  heroicCount: number;
  mythicCount: number;
  items: { name: string; difficulty: string; date: string }[];
}

interface DiscordClaim {
  discordId: string;
  username: string;
  nameRealm: string;
}

interface PendingEntry {
  nameRealm: string;
  className: string;
  mainSpec: string;
  offSpecs: string;
  role: string;
  discord: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchRosterScript(rosterScriptUrl: string, params: Record<string, string>): Promise<any> {
  const url = new URL(rosterScriptUrl);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Roster script returned ${res.status}`);
  return res.json();
}

async function fetchCorePayload(rosterScriptUrl: string): Promise<CorePayload> {
  return fetchRosterScript(rosterScriptUrl, { chunk: 'core' });
}

async function fetchHeavyPayload(rosterScriptUrl: string): Promise<HeavyPayload> {
  return fetchRosterScript(rosterScriptUrl, { chunk: 'heavy' });
}

async function fetchPendingRoster(rosterScriptUrl: string): Promise<PendingRosterPayload> {
  return fetchRosterScript(rosterScriptUrl, { action: 'getPendingRoster' });
}

// Returns how long ago a YYYY-MM-DD date was in a readable form
function daysAgo(dateStr: string): string {
  if (!dateStr) return 'unknown';
  const joined = new Date(dateStr);
  if (isNaN(joined.getTime())) return dateStr;
  const days = Math.floor((Date.now() - joined.getTime()) / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return '1 day';
  if (days < 14) return `${days} days`;
  const weeks = Math.floor(days / 7);
  if (weeks < 8) return `${weeks} wk`;
  const months = Math.floor(days / 30);
  return `${months} mo`;
}

// Truncate a text list to fit within Discord's embed description limit
function truncateLines(lines: string[], limit = 3800): string {
  let out = '';
  let i = 0;
  for (; i < lines.length; i++) {
    const next = out ? out + '\n' + lines[i] : lines[i];
    if (next.length > limit) break;
    out = next;
  }
  const remaining = lines.length - i;
  if (remaining > 0) out += `\n... and ${remaining} more`;
  return out;
}

const NUDGE_MESSAGES: Record<NudgeCategory, string> = {
  'no-wishlist': "You haven't submitted a wishlist yet.",
  'no-bis-link': "You haven't submitted a BiS source link yet.",
  'incomplete-wishlist': 'Your wishlist is missing a real BiS pick for one or more slots.'
};

function buildNudgeEmbed(
  teamName: string,
  nameRealm: string,
  firstName: string,
  categories: NudgeCategory[],
  missingBisRows: string[]
): EmbedBuilder {
  const lines = categories.map((cat) => {
    if (cat === 'incomplete-wishlist' && missingBisRows.length) {
      return `- ${NUDGE_MESSAGES[cat]} Missing: **${missingBisRows.join(', ')}**`;
    }
    return `- ${NUDGE_MESSAGES[cat]}`;
  });
  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(`${teamName} -- Setup Reminder`)
    .setDescription(
      `Hey ${nameRealm}! A quick check found your loot setup is missing something:\n\n${lines.join('\n')}`
    )
    .setFooter({ text: 'This helps officers award loot correctly -- please take a moment to update it.' });
  const link = SITE_URL ? profileDeepLink(SITE_URL, firstName, categories) : null;
  if (link) embed.addFields({ name: 'Update it here', value: link });
  return embed;
}

function signupSheetContext(cfg: TeamConfig): SignupSheetContext {
  return {
    supabaseUrl: SUPABASE_URL,
    serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    teamId: cfg.teamId,
    teamName: cfg.name,
    teamSlug: cfg.slug,
    siteUrl: SITE_URL,
    channelId: signupChannelId(cfg)
  };
}

// ── Slash command interaction handler ────────────────────────────────────────

client.on('interactionCreate', async (interaction) => {
  // Signup-sheet Refresh button (WGA-Raid-Hub#900) -- the only interactive
  // component this bot handles today besides slash commands. Re-syncing
  // just calls the same claim/edit path syncSignupSheet always uses, which
  // naturally becomes "edit the message this button lives on" once a sheet
  // already exists. The button's customId carries the team id directly
  // (`signup-sheet-refresh:{teamId}:{raidDate}`, see signupSheet.ts) rather
  // than inferring it from the interaction's guild -- WGA's three teams
  // share one Discord server, so the guild alone never disambiguates them.
  if (interaction.isButton() && interaction.customId.startsWith('signup-sheet-refresh:')) {
    const [, teamIdStr, raidDate] = interaction.customId.split(':');
    try {
      await interaction.deferUpdate();
    } catch {
      return;
    }
    const cfg = teamConfigs.getByTeamId(Number(teamIdStr));
    if (!cfg) return;
    try {
      // Refresh only ever lives on a message that already exists.
      await syncSignupSheet(client, signupSheetContext(cfg), raidDate, { allowCreate: false });
    } catch (err) {
      console.error('signup-sheet-refresh error:', err);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const cmd = interaction.commandName;

  // Every command has a required `team` choice (see buildCommands()) --
  // WGA's three teams share one Discord server, so neither the guild nor
  // (in general) the channel an interaction fires in can stand in for it.
  const teamSlug = interaction.options.getString('team', true);
  const cfg = teamConfigs.getBySlug(teamSlug);
  if (!cfg) {
    await interaction.reply({ content: `Unknown team: ${teamSlug}`, flags: MessageFlags.Ephemeral }).catch(() => null);
    return;
  }

  // ── /resend ──────────────────────────────────────────────────────────────
  if (cmd === 'resend') {
    if (!cfg.appsScriptUrl) {
      await interaction
        .reply({ content: 'This team has no Apps Script URL configured.', flags: MessageFlags.Ephemeral })
        .catch(() => null);
      return;
    }
    const count = interaction.options.getInteger('count', true);
    try {
      await interaction.deferReply();
    } catch {
      return;
    }
    try {
      const url = new URL(cfg.appsScriptUrl);
      url.searchParams.set('secret', WEBHOOK_SECRET ?? '');
      url.searchParams.set('n', String(count));
      const response = await fetch(url.toString());
      const data = (await response.json()) as { ok?: boolean; error?: string; sent?: number };
      if (data.ok) {
        await interaction.editReply(`Resending the last **${data.sent}** M+ submission(s).`);
      } else {
        await interaction.editReply(`Failed: ${data.error ?? 'Unknown error'}`);
      }
    } catch {
      await interaction.editReply('Failed to contact Apps Script. Check the logs.').catch(() => null);
    }
    return;
  }

  // ── /nudge-missing ───────────────────────────────────────────────────────
  if (cmd === 'nudge-missing') {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch {
      return;
    }
    try {
      const candidates = await fetchNudgeCandidates(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, cfg.teamId);
      const nudged: string[] = [];
      const skipped: string[] = [];
      const failed: string[] = [];

      for (const candidate of candidates) {
        const due = filterAndRecordNudges(NUDGE_LOG_PATH, candidate.discordId, candidate.categories);
        if (due.length === 0) {
          skipped.push(candidate.nameRealm);
          continue;
        }
        try {
          const user = await interaction.client.users.fetch(candidate.discordId);
          await user.send({
            embeds: [buildNudgeEmbed(cfg.name, candidate.nameRealm, candidate.firstName, due, candidate.missingBisRows)]
          });
          nudged.push(candidate.nameRealm);
        } catch {
          failed.push(candidate.nameRealm);
        }
      }

      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('Missing Setup Nudge')
        .addFields(
          { name: `Nudged (${nudged.length})`, value: truncateLines(nudged.length ? nudged : ['None']) },
          {
            name: `Skipped -- nudged in last 24h (${skipped.length})`,
            value: truncateLines(skipped.length ? skipped : ['None'])
          },
          ...(failed.length
            ? [{ name: `Couldn't DM -- DMs closed? (${failed.length})`, value: truncateLines(failed) }]
            : [])
        );
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      await interaction.editReply(`Error: ${msg}`).catch(() => null);
    }
    return;
  }

  // All remaining commands are ephemeral officer queries
  if (!cfg.rosterScriptUrl) {
    await interaction
      .reply({ content: 'This team has no roster script URL configured.', flags: MessageFlags.Ephemeral })
      .catch(() => null);
    return;
  }
  const rosterScriptUrl = cfg.rosterScriptUrl;

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch {
    return;
  }

  try {
    // ── /pending-roster ───────────────────────────────────────────────────
    if (cmd === 'pending-roster') {
      const data = await fetchPendingRoster(rosterScriptUrl);
      const entries = data.entries ?? [];
      if (!entries.length) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder().setColor(0x95a5a6).setTitle('Pending Roster').setDescription('No pending applicants.')
          ]
        });
        return;
      }
      const lines = entries.map((e) => {
        const name = e.nameRealm || '?';
        const cls = [e.className, e.mainSpec].filter(Boolean).join(' ');
        const role = e.role || '';
        const disc = e.discord ? ` | ${e.discord}` : '';
        return `**${name}** — ${cls} (${role})${disc}`;
      });
      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle(`Pending Roster (${entries.length})`)
        .setDescription(truncateLines(lines));
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // ── /trials ───────────────────────────────────────────────────────────
    if (cmd === 'trials') {
      const core = await fetchCorePayload(rosterScriptUrl);
      const trials = (core.roster ?? []).filter((p) => p.isTrial);
      if (!trials.length) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder().setColor(0x95a5a6).setTitle('Trials').setDescription('No players currently on trial.')
          ]
        });
        return;
      }
      const lines = trials.map((p) => {
        const cls = [p.class, p.spec].filter(Boolean).join(' ');
        const dur = daysAgo(p.joinDate);
        const att = p.attendance || 'N/A';
        return `**${p.nameRealm}** — ${cls} (${p.role}) | joined ${dur} ago | ${att}`;
      });
      const embed = new EmbedBuilder()
        .setColor(0xe67e22)
        .setTitle(`Trials (${trials.length})`)
        .setDescription(truncateLines(lines));
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // ── /bench ────────────────────────────────────────────────────────────
    if (cmd === 'bench') {
      const core = await fetchCorePayload(rosterScriptUrl);
      const benched = (core.roster ?? []).filter((p) => p.isBench);
      if (!benched.length) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder().setColor(0x95a5a6).setTitle('Bench').setDescription('No players currently benched.')
          ]
        });
        return;
      }
      const lines = benched.map((p) => {
        const cls = [p.class, p.spec].filter(Boolean).join(' ');
        const att = p.attendance || 'N/A';
        return `**${p.nameRealm}** — ${cls} (${p.role}) | ${att}`;
      });
      const embed = new EmbedBuilder()
        .setColor(0x7f8c8d)
        .setTitle(`Bench (${benched.length})`)
        .setDescription(truncateLines(lines));
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // ── /attendance <player> ──────────────────────────────────────────────
    if (cmd === 'attendance') {
      const query = (interaction.options.getString('player', true) || '').trim().toLowerCase();
      const core = await fetchCorePayload(rosterScriptUrl);
      const match = (core.roster ?? []).find((p) => (p.firstName || p.nameRealm.split('-')[0]).toLowerCase() === query);
      if (!match) {
        await interaction.editReply({
          content: `No roster player found matching **${interaction.options.getString('player', true)}**.`
        });
        return;
      }
      const cls = [match.class, match.spec].filter(Boolean).join(' ');
      const flags = [
        match.isTrial ? 'Trial' : '',
        match.isBench ? 'Bench' : '',
        match.mPlusExcluded ? 'M+ Excluded' : ''
      ]
        .filter(Boolean)
        .join(', ');
      const embed = new EmbedBuilder()
        .setColor(0x1abc9c)
        .setTitle(match.nameRealm)
        .addFields(
          { name: 'Class / Spec', value: cls || 'N/A', inline: true },
          { name: 'Role', value: match.role || 'N/A', inline: true },
          { name: 'Attendance', value: match.attendance || 'N/A', inline: true },
          {
            name: 'Joined',
            value: match.joinDate ? `${match.joinDate} (${daysAgo(match.joinDate)} ago)` : 'N/A',
            inline: true
          },
          ...(flags ? [{ name: 'Status', value: flags, inline: true }] : [])
        );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // ── /absences ─────────────────────────────────────────────────────────
    if (cmd === 'absences') {
      const core = await fetchCorePayload(rosterScriptUrl);
      const threshold = core.trialAttend ?? 75;
      const below = (core.roster ?? [])
        .filter((p) => {
          if (!p.attendance) return false;
          const pct = parseFloat(p.attendance);
          return !isNaN(pct) && pct < threshold;
        })
        .sort((a, b) => parseFloat(a.attendance) - parseFloat(b.attendance));
      if (!below.length) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x2ecc71)
              .setTitle('Absences')
              .setDescription(`No players below ${threshold}% attendance.`)
          ]
        });
        return;
      }
      const lines = below.map((p) => {
        const flags = [p.isTrial ? 'Trial' : '', p.isBench ? 'Bench' : ''].filter(Boolean).join(', ');
        return `**${p.nameRealm}** — ${p.attendance}${flags ? ` (${flags})` : ''}`;
      });
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle(`Below ${threshold}% Attendance (${below.length})`)
        .setDescription(truncateLines(lines));
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // ── /mplus-excluded ───────────────────────────────────────────────────
    if (cmd === 'mplus-excluded') {
      const core = await fetchCorePayload(rosterScriptUrl);
      const excluded = (core.roster ?? []).filter((p) => p.mPlusExcluded);
      if (!excluded.length) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x95a5a6)
              .setTitle('M+ Exclusions')
              .setDescription('No players approved for M+ exclusion.')
          ]
        });
        return;
      }
      const lines = excluded.map((p) => {
        const note = p.mPlusNote ? ` — *${p.mPlusNote}*` : '';
        return `**${p.nameRealm}** (${p.class} ${p.spec})${note}`;
      });
      const embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle(`M+ Excluded (${excluded.length})`)
        .setDescription(truncateLines(lines));
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // ── /fairness ─────────────────────────────────────────────────────────
    if (cmd === 'fairness') {
      const heavy = await fetchHeavyPayload(rosterScriptUrl);
      const counts = heavy.lootCounts ?? {};
      const entries = Object.entries(counts)
        .map(([name, lc]) => ({ name, count: lc.count, heroicCount: lc.heroicCount, mythicCount: lc.mythicCount }))
        .sort((a, b) => b.count - a.count);
      if (!entries.length) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder().setColor(0x95a5a6).setTitle('Loot Fairness').setDescription('No loot data available.')
          ]
        });
        return;
      }
      const total = entries.reduce((s, e) => s + e.count, 0);
      const avg = (total / entries.length).toFixed(1);
      const top5 = entries
        .slice(0, 5)
        .map((e, i) => `${i + 1}. **${e.name}** — ${e.count} (H:${e.heroicCount} M:${e.mythicCount})`);
      const bot5 = entries
        .slice(-5)
        .reverse()
        .map((e, i) => `${i + 1}. **${e.name}** — ${e.count} (H:${e.heroicCount} M:${e.mythicCount})`);
      const embed = new EmbedBuilder()
        .setColor(0xf39c12)
        .setTitle('Loot Fairness')
        .addFields(
          { name: `Most loot (top 5 of ${entries.length})`, value: top5.join('\n') || 'N/A' },
          { name: 'Least loot (bottom 5)', value: bot5.join('\n') || 'N/A' },
          {
            name: 'Stats',
            value: `${entries.length} players tracked | ${total} total items | avg ${avg}/player`,
            inline: false
          }
        );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // ── /officers ─────────────────────────────────────────────────────────
    if (cmd === 'officers') {
      const core = await fetchCorePayload(rosterScriptUrl);
      const officerIds = core.officerDiscordIds ?? [];
      const claims = core.discordClaims ?? [];
      if (!officerIds.length) {
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(0x95a5a6).setTitle('Officers').setDescription('No officers configured.')]
        });
        return;
      }
      const claimById = new Map(claims.map((c) => [c.discordId, c]));
      const lines = officerIds.map((id) => {
        const claim = claimById.get(id);
        const username = claim?.username ? `@${claim.username}` : `<@${id}>`;
        const character = claim?.nameRealm ? ` — ${claim.nameRealm}` : '';
        return `${username}${character}`;
      });
      const embed = new EmbedBuilder()
        .setColor(0x2c3e50)
        .setTitle(`Officers (${officerIds.length})`)
        .setDescription(truncateLines(lines));
      await interaction.editReply({ embeds: [embed] });
      return;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await interaction.editReply(`Error: ${msg}`).catch(() => null);
  }
});

const app = express();
app.use(express.json());

app.get('/', (_req: Request, res: Response) => {
  const slugs =
    teamConfigs
      .all()
      .map((c) => c.slug)
      .join(', ') || 'none configured';
  res.send(`Bot is running. Teams: ${slugs}.`);
});

function checkSecret(req: Request, res: Response): boolean {
  const secret = req.headers['x-webhook-secret'];
  if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// Every relay route below carries `team` (a teams.slug string) in its body
// -- the site's discord-bot-webhook Edge Function always sends it, even
// before #991, since it used to pick which BOT_WEBHOOK_URL_<TEAM> to call.
// Resolving it here is what replaces that per-team URL indirection now that
// every team's payload arrives at the same one bot.
function resolveTeam(req: Request, res: Response): TeamConfig | null {
  const team = (req.body as { team?: string }).team;
  const cfg = teamConfigs.getBySlug(team);
  if (!cfg) {
    res.status(400).json({ error: `Unknown or unconfigured team: ${team ?? '(missing)'}` });
    return null;
  }
  return cfg;
}

async function fetchTextChannel(res: Response, channelId: string): Promise<TextChannel | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !(channel instanceof TextChannel)) {
    res.status(500).json({ error: 'Channel not found or not a text channel' });
    return null;
  }
  return channel;
}

// --- M+ Exclusion submissions ---

interface MplusBody {
  characterName?: string;
  nameRealm?: string;
  mplusLink?: string;
  raiderioUrl?: string;
  raidLink?: string;
  notes?: string;
  submittedAt?: string;
}

app.post('/mplus', async (req: Request, res: Response): Promise<void> => {
  if (!checkSecret(req, res)) return;
  const cfg = resolveTeam(req, res);
  if (!cfg) return;

  const { characterName, nameRealm, mplusLink, raiderioUrl, raidLink, notes, submittedAt } = req.body as MplusBody;

  const playerName = nameRealm || characterName;
  const profileUrl = raiderioUrl || mplusLink;

  if (!playerName || !profileUrl) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  const channel = await fetchTextChannel(res, cfg.officerChannelId);
  if (!channel) return;

  const unixTs = submittedAt ? Math.floor(new Date(submittedAt).getTime() / 1000) : Math.floor(Date.now() / 1000);

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('New M+ Exclusion Request')
    .addFields(
      { name: 'Player', value: playerName },
      { name: 'Submitted At', value: `<t:${unixTs}:f>` },
      { name: 'Raider.io / Profile', value: profileUrl },
      ...(raidLink ? [{ name: 'Raid Droptimizer', value: raidLink }] : []),
      { name: 'Notes', value: notes ?? '*(none)*' }
    )
    .setFooter({ text: 'M+ Exclusion Request System' });

  if (cfg.mplusPingRoleId) {
    await channel.send({
      content: `<@&${cfg.mplusPingRoleId}> New M+ exclusion request received!`,
      embeds: [embed]
    });
  } else {
    await channel.send({ embeds: [embed] });
  }

  res.json({ ok: true });
});

// --- Roster submissions ---

interface RosterBody {
  characterName?: string;
  classSpec?: string;
  notes?: string;
  submittedAt?: string;
}

app.post('/roster', async (req: Request, res: Response): Promise<void> => {
  if (!checkSecret(req, res)) return;
  const cfg = resolveTeam(req, res);
  if (!cfg) return;

  const { characterName, classSpec, notes, submittedAt } = req.body as RosterBody;

  if (!characterName || !classSpec) {
    res.status(400).json({ error: 'Missing required fields: characterName, classSpec' });
    return;
  }

  const channel = await fetchTextChannel(res, cfg.officerChannelId);
  if (!channel) return;

  const unixTs = submittedAt ? Math.floor(new Date(submittedAt).getTime() / 1000) : Math.floor(Date.now() / 1000);

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('New Roster Application')
    .addFields(
      { name: 'Character Name', value: characterName },
      { name: 'Class / Spec', value: classSpec },
      { name: 'Submitted At', value: `<t:${unixTs}:f>` },
      { name: 'Notes', value: notes ?? '*(none)*' }
    )
    .setFooter({ text: 'Roster Application System' });

  if (cfg.rosterPingRoleId) {
    await channel.send({
      content: `<@&${cfg.rosterPingRoleId}> New roster application received!`,
      embeds: [embed]
    });
  } else {
    await channel.send({ embeds: [embed] });
  }

  res.json({ ok: true });
});

// --- Raid signups ---

interface SignupBody {
  charName?: string;
  realm?: string;
  className?: string;
  mainSpec?: string;
  offSpecs?: string;
  role?: string;
  discord?: string;
  mainSwap?: boolean;
  swapFromNameRealm?: string;
  notes?: string;
  submittedAt?: string;
}

app.post('/signup', async (req: Request, res: Response): Promise<void> => {
  if (!checkSecret(req, res)) return;
  const cfg = resolveTeam(req, res);
  if (!cfg) return;

  const {
    charName,
    realm,
    className,
    mainSpec,
    offSpecs,
    role,
    discord,
    mainSwap,
    swapFromNameRealm,
    notes,
    submittedAt
  } = req.body as SignupBody;

  if (!charName || !className || !mainSpec) {
    res.status(400).json({ error: 'Missing required fields: charName, className, mainSpec' });
    return;
  }

  const channel = await fetchTextChannel(res, cfg.officerChannelId);
  if (!channel) return;

  const unixTs = submittedAt ? Math.floor(new Date(submittedAt).getTime() / 1000) : Math.floor(Date.now() / 1000);

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('New Raid Signup')
    .addFields(
      { name: 'Character', value: realm ? `${charName}-${realm}` : charName },
      { name: 'Class / Main Spec', value: `${className} — ${mainSpec}` },
      { name: 'Role', value: role ?? 'N/A', inline: true },
      { name: 'Off Specs', value: offSpecs || '*(none)*', inline: true },
      { name: 'Discord', value: discord || '*(not provided)*', inline: true },
      {
        name: 'Main Swap',
        value: mainSwap ? `Yes, from ${swapFromNameRealm || 'unknown character'}` : 'No',
        inline: true
      },
      { name: 'Submitted At', value: `<t:${unixTs}:f>` },
      { name: 'Notes', value: notes || '*(none)*' }
    )
    .setFooter({ text: 'Raid Signup System' });

  if (cfg.rosterPingRoleId) {
    await channel.send({
      content: `<@&${cfg.rosterPingRoleId}> New raid signup received!`,
      embeds: [embed]
    });
  } else {
    await channel.send({ embeds: [embed] });
  }

  res.json({ ok: true });
});

// --- Self-received item requests ---

interface SelfReceivedBody {
  player?: string;
  item?: string;
  slot?: string;
  source?: string;
  notes?: string;
  submittedAt?: string;
}

app.post('/selfreceived', async (req: Request, res: Response): Promise<void> => {
  if (!checkSecret(req, res)) return;
  const cfg = resolveTeam(req, res);
  if (!cfg) return;

  const { player, item, slot, source, notes, submittedAt } = req.body as SelfReceivedBody;

  if (!player || !item) {
    res.status(400).json({ error: 'Missing required fields: player, item' });
    return;
  }

  const channel = await fetchTextChannel(res, cfg.officerChannelId);
  if (!channel) return;

  const unixTs = submittedAt ? Math.floor(new Date(submittedAt).getTime() / 1000) : Math.floor(Date.now() / 1000);

  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle('New Self-Received Request')
    .addFields(
      { name: 'Player', value: player },
      { name: 'Item', value: item },
      { name: 'Slot', value: slot || 'N/A', inline: true },
      { name: 'Source', value: source || 'N/A', inline: true },
      { name: 'Submitted At', value: `<t:${unixTs}:f>` },
      { name: 'Notes', value: notes || '*(none)*' }
    )
    .setFooter({ text: 'Self-Received Request System' });

  if (cfg.rosterPingRoleId) {
    await channel.send({
      content: `<@&${cfg.rosterPingRoleId}> New self-received request received!`,
      embeds: [embed]
    });
  } else {
    await channel.send({ embeds: [embed] });
  }

  res.json({ ok: true });
});

// --- BiS list submissions ---

interface BiSBody {
  nameRealm?: string;
  bisLink?: string;
  notes?: string;
  submittedAt?: string;
  // #278: raider flagged that the list behind an unchanged link needs a
  // recheck, rather than submitting a new link -- same queue, different embed.
  sameLink?: boolean;
}

app.post('/bis', async (req: Request, res: Response): Promise<void> => {
  if (!checkSecret(req, res)) return;
  const cfg = resolveTeam(req, res);
  if (!cfg) return;

  const { nameRealm, bisLink, notes, submittedAt, sameLink } = req.body as BiSBody;

  if (!nameRealm || !bisLink) {
    res.status(400).json({ error: 'Missing required fields: nameRealm, bisLink' });
    return;
  }

  const channel = await fetchTextChannel(res, cfg.officerChannelId);
  if (!channel) return;

  const unixTs = submittedAt ? Math.floor(new Date(submittedAt).getTime() / 1000) : Math.floor(Date.now() / 1000);

  const embed = new EmbedBuilder()
    .setColor(0x1abc9c)
    .setTitle(sameLink ? 'BiS Source Flagged -- Items Changed' : 'New BiS Source Submission')
    .addFields(
      { name: 'Player', value: nameRealm },
      { name: 'Submitted At', value: `<t:${unixTs}:f>` },
      { name: 'BiS Source', value: bisLink },
      { name: 'Notes', value: notes || '*(none)*' }
    )
    .setFooter({ text: 'BiS Source System' });

  const pingText = sameLink
    ? 'BiS Source items changed (same link) -- please recheck!'
    : 'New BiS Source submission received!';

  if (cfg.rosterPingRoleId) {
    await channel.send({
      content: `<@&${cfg.rosterPingRoleId}> ${pingText}`,
      embeds: [embed]
    });
  } else {
    await channel.send({ embeds: [embed] });
  }

  res.json({ ok: true });
});

// --- Raid calendar RSVP notifications (WGA-Raid-Hub#893) ---

interface RsvpBody {
  charName?: string;
  raidDate?: string;
  status?: string;
  note?: string;
  submittedAt?: string;
}

app.post('/rsvp-status', async (req: Request, res: Response): Promise<void> => {
  if (!checkSecret(req, res)) return;
  const cfg = resolveTeam(req, res);
  if (!cfg) return;

  const { charName, raidDate, status, note } = req.body as RsvpBody;

  if (!charName || !raidDate || !status) {
    res.status(400).json({ error: 'Missing required fields: charName, raidDate, status' });
    return;
  }

  const channel = await fetchTextChannel(res, attendanceChannelId(cfg));
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(0xe0c23d)
    .setTitle('Raid RSVP Update')
    .addFields(
      { name: 'Player', value: charName },
      { name: 'Raid Date', value: raidDate },
      { name: 'Status', value: status },
      { name: 'Note', value: note || '*(none)*' }
    )
    .setFooter({ text: 'Raid Calendar' });

  if (cfg.rsvpPingRoleId) {
    await channel.send({
      content: `<@&${cfg.rsvpPingRoleId}> ${charName} marked themselves ${status} for ${raidDate}`,
      embeds: [embed]
    });
  } else {
    await channel.send({ embeds: [embed] });
  }

  res.json({ ok: true });
});

// --- Optional raid night RSVP reminders (WGA-Raid-Hub#895) ---
//
// DM, not a channel ping (per Kat) -- unlike /rsvp-status above, this isn't
// guild-wide news, it's a personal nudge that a specific player hasn't
// responded yet. Called from the optional-rsvp-reminders Edge Function via
// discord-bot-webhook's relay, one call per due player/checkpoint; the
// dedup that stops repeat DMs lives on that side (raid_rsvp_reminders_sent),
// not here -- this route has no memory of its own, same as every other
// route in this file. No team resolution needed -- a DM by discord user id
// doesn't depend on which team's config anything comes from.

interface OptionalReminderBody {
  discordId?: string;
  charName?: string;
  checkpoint?: '24h' | '2h';
  raidDate?: string;
  startTime?: string;
  timezone?: string;
}

app.post('/optional-reminder', async (req: Request, res: Response): Promise<void> => {
  if (!checkSecret(req, res)) return;

  const { discordId, checkpoint, raidDate, startTime, timezone } = req.body as OptionalReminderBody;

  if (!discordId || !checkpoint || !raidDate) {
    res.status(400).json({ error: 'Missing required fields: discordId, checkpoint, raidDate' });
    return;
  }

  const user = await client.users.fetch(discordId).catch(() => null);
  if (!user) {
    res.status(500).json({ error: 'Could not resolve Discord user' });
    return;
  }

  const when = checkpoint === '24h' ? '24 hours' : '2 hours';
  const embed = new EmbedBuilder()
    .setColor(0xe0c23d)
    .setTitle('Raid RSVP Needed')
    .setDescription(
      `This is an optional raid night in ${when} (${raidDate}${startTime ? ', ' + startTime : ''}${timezone ? ' ' + timezone : ''}). You haven't set a status yet -- please RSVP on the calendar.`
    );

  // DMs can fail silently (closed DMs, bot blocked, left the server) --
  // still report ok so the caller marks the reminder sent rather than
  // retrying forever against a player who can never receive it.
  await user.send({ embeds: [embed] }).catch(() => null);

  res.json({ ok: true });
});

// --- Aggregated Discord signup sheet (WGA-Raid-Hub#900, part of #640) ---
//
// Read-only display, edited in place per raid night -- fully separate from
// /rsvp-status above (WGA-Raid-Hub#893), which stays untouched. All the
// actual logic (roster/RSVP queries, grouping, embed building, message-ID
// bookkeeping) lives in signupSheet.ts using the bot's own service-role
// Supabase client -- same precedent as wishlistStatus.ts's
// fetchNudgeCandidates(), already used by /nudge-missing.

interface SignupSheetSyncBody {
  raidDate?: string;
}

app.post('/signup-sheet-sync', async (req: Request, res: Response): Promise<void> => {
  if (!checkSecret(req, res)) return;
  const cfg = resolveTeam(req, res);
  if (!cfg) return;

  const { raidDate } = req.body as SignupSheetSyncBody;
  if (!raidDate) {
    res.status(400).json({ error: 'Missing required field: raidDate' });
    return;
  }

  try {
    // An RSVP change must never force the sheet to appear before its
    // configured lead time -- only the proactive sweep creates it.
    await syncSignupSheet(client, signupSheetContext(cfg), raidDate, { allowCreate: false });
    res.json({ ok: true });
  } catch (err) {
    console.error('signup-sheet-sync error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

interface VerifyChannelBody {
  channelId?: string;
}

app.post('/verify-channel', async (req: Request, res: Response): Promise<void> => {
  if (!checkSecret(req, res)) return;

  const { channelId } = req.body as VerifyChannelBody;
  if (!channelId) {
    res.status(400).json({ ok: false, error: 'Missing required field: channelId' });
    return;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !(channel instanceof TextChannel)) {
    res.json({ ok: false, error: 'Channel not found or not a text channel' });
    return;
  }

  res.json({ ok: true, name: channel.name });
});

// Every ~15 minutes: proactively post any upcoming raid night's signup
// sheet, for every configured team, once its configured lead time (default
// 48h) has been reached. Started once the client is ready (same
// 'clientReady' event the login flow above uses, discord.js v14's renamed
// 'ready').
const SIGNUP_SHEET_SWEEP_INTERVAL_MS = 15 * 60 * 1000;
client.once('clientReady', () => {
  setInterval(() => {
    for (const cfg of teamConfigs.all()) {
      runSignupSheetSweep(client, signupSheetContext(cfg)).catch((err) =>
        console.error(`signup sheet sweep error (${cfg.slug}):`, err)
      );
    }
  }, SIGNUP_SHEET_SWEEP_INTERVAL_MS);
});

async function main(): Promise<void> {
  // Load every team's config before logging in or accepting traffic -- the
  // first relay call needs it immediately, not eventually. clientReady's own
  // registerCommands() call refreshes again (and keeps refreshing on its
  // periodic re-registration), so this is just to cover the brief window
  // before that fires.
  await teamConfigs.refresh();

  await client.login(BOT_TOKEN);

  app.listen(Number(PORT), () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
