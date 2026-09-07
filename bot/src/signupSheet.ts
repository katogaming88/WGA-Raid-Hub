import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder, TextChannel } from 'discord.js';

// Aggregated Discord signup sheet (WGA-Raid-Hub#900, part of #640) -- one
// message per raid night showing the whole roster's RSVP status at a
// glance, edited in place as people respond. Fully separate from the
// existing per-status-change ping (/rsvp-status, WGA-Raid-Hub#893) -- that
// stays untouched.
//
// All the logic lives here rather than split with a site-side Edge
// Function: the Refresh button and the proactive lead-time sweep both need
// to rebuild the exact same embed independently of any site-triggered
// event, so the grouping/formatting logic has to exist here regardless.
// Read-only display -- no Discord-side status-setting (that's a separate,
// unscoped future issue). Uses the bot's own service-role Supabase client,
// same precedent as wishlistStatus.ts's fetchNudgeCandidates() (already
// used by /nudge-missing).

export interface SignupSheetContext {
  supabaseUrl: string;
  serviceRoleKey: string;
  teamId: number;
  teamName: string;
  // teams.slug, for the "View on Site" link's ?team= param (calendar.html
  // omits it for the default team). Comes straight from team_discord_config's
  // join to teams (#991) -- before that, this file carried its own
  // hardcoded id->slug map, since no other slug source existed bot-side.
  teamSlug: string;
  siteUrl?: string;
  // Already resolved by the caller (index.ts's signupChannelId() helper) --
  // the team's configured signup channel, falling back to its officer
  // channel. Supersedes a team_settings.config.discordSignupChannelId read
  // that used to live in this file (#991) -- never actually set for either
  // team, and now redundant with team_discord_config.
  channelId: string;
}

const EMBED_COLOR = 0xe0c23d;

// Discord only widens an embed beyond its normal narrow max-width when a
// full `image` is set (not `thumbnail` -- confirmed live: a thumbnail made
// no difference at all). The image's own content doesn't matter for this,
// only that one is present and wide enough (~600px+ source width hits the
// ceiling; 900/1200 gained nothing further in testing) -- so each team's
// own site header (captured as a static PNG, WGA-Raid-Hub's
// assets/banners/<slug>-header.png, 900px wide) doubles as both real
// branding and the width trigger, rather than a purpose-built graphic or a
// plain color block. Hosted via raw.githubusercontent.com pointed at
// main (not the GitHub Pages URL used for calendar.html links elsewhere in
// this file) -- available on any commit immediately, no Pages
// publish-and-propagate lag.
const TEAM_BANNER_URLS: Record<number, string> = {
  1: 'https://raw.githubusercontent.com/katogaming88/WGA-Raid-Hub/main/assets/banners/phoenix-header.png',
  2: 'https://raw.githubusercontent.com/katogaming88/WGA-Raid-Hub/main/assets/banners/hellfire-header.png',
};

// The full set of valid roster roles (classes_specs.role) -- purely for
// grouping/validation. Column layout (which roles render together, and in
// what order) is handled separately below by formatColumn(), not by this
// array's order.
const ROLE_SECTIONS = ['Tank', 'Melee', 'Ranged', 'Heal'] as const;
type RoleSection = (typeof ROLE_SECTIONS)[number];

interface PlayerRow {
  id: number;
  name_realm: string;
  nickname: string | null;
  is_bench: boolean;
  classes_specs: { role: RoleSection | null } | null;
}

// nickname if set, else the character's first name -- same fallback
// WGA Raid Hub's own js/common.js already uses everywhere else
// (display_name: player.nickname || firstName).
function displayName(player: PlayerRow): string {
  if (player.nickname) return player.nickname;
  return player.name_realm.split('-')[0].trim();
}

interface RsvpRow {
  player_id: number;
  status: string;
}

interface RaidNightInfoRow {
  exists: boolean;
  start_time: string | null;
  timezone: string | null;
  is_optional: boolean | null;
}

// Standard "format the guess, diff against the wall-clock target, correct
// once" technique for turning a wall-clock date+time in a named zone into a
// UTC instant without a datetime library -- same algorithm already used in
// WGA-Raid-Hub's optional-rsvp-reminders Edge Function's zonedTimeToUtc(),
// ported verbatim (Intl.DateTimeFormat + Date.UTC, runtime-agnostic).
function zonedTimeToUtc(raidDate: string, time: string, timeZone: string): Date {
  const [year, month, day] = raidDate.split('-').map(Number);
  const [hour, minute, second] = time.split(':').map(Number);
  const guessUtcMs = Date.UTC(year, month - 1, day, hour, minute, second || 0);

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(guessUtcMs))) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  const asIfUtcMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  const offsetMs = asIfUtcMs - guessUtcMs;
  return new Date(guessUtcMs - offsetMs);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatField(name: string, names: string[]): { name: string; value: string; inline?: boolean } | null {
  if (names.length === 0) return null;
  return { name: `${name} (${names.length})`, value: names.join('\n') || '*(none)*' };
}

// Discord's automatic 3-per-row field wrapping makes a field's vertical
// position depend on every OTHER field sharing its row -- there is no way
// to get one column's content to render directly below another's using
// separate fields, regardless of field order (confirmed live: neither
// Tank/Melee/Ranged/Heal nor Tank/Melee/Heal/Ranged put Heal under Tank
// the way Wowaudit's own embed does). The only way to guarantee that is to
// combine multiple sections into ONE field's value -- Wowaudit's Tank and
// Heal are almost certainly one physical field, not two, which is why
// Heal's position there is independent of Melee/Ranged's height. Builds
// one inline field from an ordered list of (label, names) sections; the
// first non-empty section becomes the field's real header (Discord-styled,
// bold+larger), later sections get a markdown-bold sub-header inline in
// the body text instead.
function formatColumn(sections: Array<{ label: string; names: string[] }>): { name: string; value: string } | null {
  const nonEmpty = sections.filter(s => s.names.length > 0);
  if (nonEmpty.length === 0) return null;
  const [first, ...rest] = nonEmpty;
  const parts = [first.names.join('\n')];
  for (const section of rest) {
    parts.push(`\n**${section.label} (${section.names.length})**\n${section.names.join('\n')}`);
  }
  return { name: `${first.label} (${first.names.length})`, value: parts.join('\n') };
}

async function buildEmbedAndComponents(
  supabase: SupabaseClient,
  ctx: SignupSheetContext,
  raidDate: string,
  night: RaidNightInfoRow
): Promise<{ embed: EmbedBuilder; components: ActionRowBuilder<ButtonBuilder>[] }> {
  const [{ data: rosterData, error: rosterErr }, { data: rsvpData, error: rsvpErr }] = await Promise.all([
    supabase
      .from('players')
      .select('id, name_realm, nickname, is_bench, classes_specs(role)')
      .eq('team_id', ctx.teamId)
      .is('archived_at', null),
    supabase.from('raid_rsvps').select('player_id, status').eq('team_id', ctx.teamId).eq('raid_date', raidDate),
  ]);
  if (rosterErr) throw new Error(`players query failed: ${rosterErr.message}`);
  if (rsvpErr) throw new Error(`raid_rsvps query failed: ${rsvpErr.message}`);

  const roster = (rosterData ?? []) as unknown as PlayerRow[];
  const rsvpByPlayer = new Map<number, string>();
  for (const row of (rsvpData ?? []) as RsvpRow[]) rsvpByPlayer.set(row.player_id, row.status);

  const roleGroups: Record<RoleSection, string[]> = { Tank: [], Melee: [], Ranged: [], Heal: [] };
  const statusGroups: Record<string, string[]> = {
    Unassigned: [],
    Late: [],
    'Leaving Early': [],
    Tentative: [],
    Absent: [],
    'No Response': [],
    Bench: [],
  };
  let inCount = 0;

  for (const player of roster) {
    const override = rsvpByPlayer.get(player.id);
    const effectiveStatus = override ?? (night.is_optional ? 'No Response' : 'Present');

    const name = displayName(player);

    if (player.is_bench) {
      statusGroups.Bench.push(name);
      continue;
    }
    if (effectiveStatus === 'Present' || effectiveStatus === 'Attending') {
      const role = player.classes_specs?.role;
      if (role && ROLE_SECTIONS.includes(role)) {
        roleGroups[role].push(name);
      } else {
        statusGroups.Unassigned.push(name);
      }
      inCount++;
      continue;
    }
    if (statusGroups[effectiveStatus]) {
      statusGroups[effectiveStatus].push(name);
    } else {
      statusGroups.Unassigned.push(name);
    }
  }

  const totalCount = roster.length;

  // Discord's <t:unix:F> timestamp markup renders the full weekday, date,
  // AND time in each viewer's own local timezone on one line -- both
  // halves adjust per viewer, unlike splitting a plain-JS-formatted date
  // (title) from a separate time string (description), which only ever
  // reflected the bot server's own locale for the date half. Same <t:...>
  // format already used for "Submitted At" fields elsewhere in this bot
  // (src/index.ts), just the :F variant instead of :f/:t.
  const description = night.start_time
    ? `<t:${Math.round(
        zonedTimeToUtc(raidDate, night.start_time, night.timezone || 'America/New_York').getTime() / 1000
      )}:F>${night.is_optional ? ' — Optional Night' : ''}`
    : night.is_optional
      ? 'Optional Night'
      : '';

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`${ctx.teamName} — Signup Sheet`)
    .setDescription(description)
    .setFooter({ text: `${inCount}/${totalCount} available -- Use Refresh to update` });
  const bannerUrl = TEAM_BANNER_URLS[ctx.teamId];
  if (bannerUrl) embed.setImage(bannerUrl);

  // Tank+Heal share one column (one field), matching Wowaudit's own
  // layout -- see formatColumn's comment for why this has to be a single
  // field rather than two separate ones. Melee and Ranged each get their
  // own column/field.
  const columns = [
    formatColumn([
      { label: 'Tank', names: roleGroups.Tank },
      { label: 'Heal', names: roleGroups.Heal },
    ]),
    formatColumn([{ label: 'Melee', names: roleGroups.Melee }]),
    formatColumn([{ label: 'Ranged', names: roleGroups.Ranged }]),
  ];
  let roleFieldCount = 0;
  for (const column of columns) {
    if (column) {
      embed.addFields({ ...column, inline: true });
      roleFieldCount++;
    }
  }
  // A real blank field (its own full-width, non-inline row) puts clear
  // vertical space between the role columns and the status/Bench sections
  // below -- otherwise whichever column happens to be shortest reads as
  // running directly into Bench with no visual break.
  if (roleFieldCount > 0) {
    embed.addFields({ name: '​', value: '​', inline: false });
  }

  for (const key of ['Unassigned', 'Late', 'Leaving Early', 'Tentative', 'Absent', 'No Response', 'Bench']) {
    if (key === 'No Response' && !night.is_optional) continue;
    const field = formatField(key, statusGroups[key]);
    if (field) embed.addFields(field);
  }

  const row = new ActionRowBuilder<ButtonBuilder>();
  if (ctx.siteUrl) {
    const teamParam = ctx.teamSlug && ctx.teamSlug !== 'phoenix' ? `&team=${ctx.teamSlug}` : '';
    row.addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('View on Site')
        .setURL(`${ctx.siteUrl.replace(/\/$/, '')}/calendar.html?date=${raidDate}${teamParam}`)
    );
  }
  // Carries the team id directly (#991) rather than leaving the refresh
  // handler to infer it from the interaction's guild/channel -- WGA's three
  // teams share one Discord server, so neither would disambiguate them.
  row.addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Secondary).setLabel('Refresh').setCustomId(`signup-sheet-refresh:${ctx.teamId}:${raidDate}`)
  );

  return { embed, components: row.components.length ? [row] : [] };
}

export interface SyncSignupSheetOptions {
  // Only runSignupSheetSweep's proactive lead-time post should ever create
  // a brand-new message -- an RSVP change or a Refresh click must only
  // ever update a sheet that's already out there. Without this, a raider
  // RSVPing well before the configured lead time would force the sheet to
  // appear early, defeating the whole point of a configurable lead time.
  allowCreate?: boolean;
}

export async function syncSignupSheet(
  client: Client,
  ctx: SignupSheetContext,
  raidDate: string,
  options: SyncSignupSheetOptions = {}
): Promise<void> {
  const allowCreate = options.allowCreate ?? true;
  const supabase = createClient(ctx.supabaseUrl, ctx.serviceRoleKey);

  const { data: nightRows, error: nightErr } = await supabase.rpc('raid_night_info', {
    p_team_id: ctx.teamId,
    p_raid_date: raidDate,
  });
  if (nightErr) throw new Error(`raid_night_info failed: ${nightErr.message}`);
  const night = (nightRows as RaidNightInfoRow[] | null)?.[0];
  if (!night || !night.exists) return;

  if (!allowCreate) {
    // Read-only check, no claim_raid_signup_sheet call (that function has
    // an insert side effect) -- if nothing has been posted yet, this call
    // has no business creating it, and must leave zero trace so the sweep
    // still sees "nothing exists yet" and creates it at the right time.
    const { data: existingRow } = await supabase
      .from('raid_signup_sheets')
      .select('message_id')
      .eq('team_id', ctx.teamId)
      .eq('raid_date', raidDate)
      .maybeSingle();
    if (!existingRow || !existingRow.message_id) return;
  }

  const { embed, components } = await buildEmbedAndComponents(supabase, ctx, raidDate, night);

  const channelId = ctx.channelId;

  const { data: claimRows, error: claimErr } = await supabase.rpc('claim_raid_signup_sheet', {
    p_team_id: ctx.teamId,
    p_raid_date: raidDate,
    p_channel_id: channelId,
  });
  if (claimErr) throw new Error(`claim_raid_signup_sheet failed: ${claimErr.message}`);
  const existingMessageId = (claimRows as { message_id: string | null }[] | null)?.[0]?.message_id ?? null;

  const fetchedChannel = await client.channels.fetch(channelId).catch(() => null);
  if (!fetchedChannel || !(fetchedChannel instanceof TextChannel)) {
    throw new Error(`Channel ${channelId} not found or not a text channel`);
  }
  const channel: TextChannel = fetchedChannel;

  async function createFresh(): Promise<void> {
    const sent = await channel.send({ embeds: [embed], components });
    // Guarded on message_id still null -- avoids clobbering a value a
    // genuinely concurrent second call might have set in the rare race
    // window claim_raid_signup_sheet's own comment documents.
    await supabase
      .from('raid_signup_sheets')
      .update({ message_id: sent.id, updated_at: new Date().toISOString() })
      .eq('team_id', ctx.teamId)
      .eq('raid_date', raidDate)
      .is('message_id', null);
  }

  if (!existingMessageId) {
    await createFresh();
    return;
  }

  try {
    const existing = await channel.messages.fetch(existingMessageId);
    await existing.edit({ embeds: [embed], components });
  } catch {
    // Message was deleted out from under us (or otherwise unfetchable) --
    // fall back to posting a fresh one, same as the create path.
    await createFresh();
  }
}

// Proactive lead-time sweep: sheets must exist a configurable number of
// hours before the raid starts, not just after the first RSVP (per Kat --
// default 48h, e.g. a Tuesday 9pm ET raid posts the preceding Sunday 9pm
// ET). The "sync on RSVP change" trigger (POST /signup-sheet-sync) still
// keeps a sheet current once it exists -- this only handles the initial
// proactive post. Call on a ~15-minute interval (mirrors
// optional-rsvp-reminders' checkpoint-window cadence: tight enough to hit
// the threshold reliably, matching tolerance window avoids double-firing
// or missing a tick).
const SWEEP_TOLERANCE_MS = 15 * 60 * 1000;
const DEFAULT_LEAD_HOURS = 48;
const MAX_SWEEP_DAYS = 14;

export async function runSignupSheetSweep(client: Client, ctx: SignupSheetContext): Promise<void> {
  const supabase = createClient(ctx.supabaseUrl, ctx.serviceRoleKey);

  const { data: settingsRow } = await supabase
    .from('team_settings')
    .select('config')
    .eq('team_id', ctx.teamId)
    .maybeSingle();
  const config = (settingsRow?.config ?? {}) as Record<string, unknown>;
  const leadHours = (config.signupSheetLeadHours as number | null) || DEFAULT_LEAD_HOURS;

  const windowDays = Math.min(Math.ceil(leadHours / 24) + 1, MAX_SWEEP_DAYS);
  const now = new Date();

  for (let offset = 0; offset <= windowDays; offset++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + offset);
    const raidDate = isoDate(d);

    const { data: nightRows, error: nightErr } = await supabase.rpc('raid_night_info', {
      p_team_id: ctx.teamId,
      p_raid_date: raidDate,
    });
    if (nightErr) {
      console.error('runSignupSheetSweep raid_night_info error:', nightErr);
      continue;
    }
    const night = (nightRows as RaidNightInfoRow[] | null)?.[0];
    if (!night || !night.exists || !night.start_time) continue;

    const startsAt = zonedTimeToUtc(raidDate, night.start_time, night.timezone || 'America/New_York');
    const thresholdMs = startsAt.getTime() - leadHours * 60 * 60 * 1000;
    if (now.getTime() < thresholdMs || now.getTime() >= thresholdMs + SWEEP_TOLERANCE_MS) continue;

    const { data: existingSheet } = await supabase
      .from('raid_signup_sheets')
      .select('id')
      .eq('team_id', ctx.teamId)
      .eq('raid_date', raidDate)
      .maybeSingle();
    if (existingSheet) continue;

    try {
      await syncSignupSheet(client, ctx, raidDate);
    } catch (err) {
      console.error('runSignupSheetSweep syncSignupSheet error:', err);
    }
  }
}
