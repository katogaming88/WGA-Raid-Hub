// Settings › Discord (#994): what each row and dialog says, worked out from the
// team's saved settings (team_discord_settings()) and what the discord-settings
// function read from Discord. No I/O here.

export type PostKind = 'officer_requests' | 'mplus_requests' | 'rsvp_changes' | 'weekly_lineup';

export type DiscordPost = {
  kind: PostKind;
  channel_id: string | null;
  ping_role_id: string | null;
  last_posted_at: string | null;
  // The weekly lineup's day (0 is Sunday), time and zone (#1709).
  post_weekday?: number | null;
  post_time?: string | null;
  post_timezone?: string | null;
};

export type SignupSheet = {
  id: number;
  channel_id: string;
  raid_days: number[];
  keep_raids_posted: number | null;
  hours_before: number | null;
  ping_role_id: string | null;
  last_posted_at: string | null;
};

export type QuietHours = { start: string; end: string; timezone: string };

export type DiscordSettings = {
  server_id: string | null;
  quiet_hours: QuietHours | null;
  posts: DiscordPost[];
  sheets: SignupSheet[];
};

export type ServerChannel = { id: string; name: string; category: string | null; missing: string[] };
export type ServerRole = { id: string; name: string };
export type DiscordServer = {
  id: string;
  name: string | null;
  botIn: boolean;
  channels: ServerChannel[];
  roles: ServerRole[];
};
export type DiscordRead = {
  hasDiscord: boolean;
  servers: { id: string; name: string }[];
  server: DiscordServer | null;
};

export const POST_KINDS: { kind: PostKind; label: string; description: string; dialog: string }[] = [
  {
    kind: 'officer_requests',
    label: 'Officer requests',
    description: 'Applications, season signups and received-item requests',
    dialog: 'A post when someone applies, signs up for the season or asks to mark an item received.'
  },
  {
    kind: 'mplus_requests',
    label: 'M+ requests',
    description: 'Someone asks to skip M+ for a week',
    dialog: 'A post when a raider asks to skip M+ for a week.'
  },
  {
    kind: 'rsvp_changes',
    label: 'RSVP changes',
    description: 'Someone marks themselves late, tentative or out',
    dialog: 'A post each time someone marks themselves late, tentative or out.'
  },
  {
    kind: 'weekly_lineup',
    label: 'Weekly lineup',
    description: 'The boss lineup for the coming raid week, once a week',
    dialog:
      'Once a week, at the day and time below, the boss lineup for the raid nights of the coming week. It updates when an officer changes the lineup, pinging nobody. A week with no lineup posts nothing.'
  }
];

// "Wednesdays at 6:00 PM Eastern time", for the weekly lineup's row.
export function lineupWhen(post: Pick<DiscordPost, 'post_weekday' | 'post_time' | 'post_timezone'>): string | null {
  if (post.post_weekday == null || !post.post_time) return null;
  const [h = 0, m = 0] = post.post_time.split(':').map(Number);
  const clock = `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  const zone = QUIET_ZONES.find((z) => z.id === post.post_timezone)?.label ?? post.post_timezone ?? '';
  return `${DAY_NAMES[post.post_weekday]}s at ${clock} ${zone}`.trim();
}

// Days as the database keeps them (0 is Sunday), listed Monday first.
export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// "Tuesdays", "Thursdays and Sundays", "Mondays, Wednesdays and Fridays";
// "Thursday and Sunday" when not plural.
export function daysLabel(days: number[], plural = true): string {
  const names = DAY_ORDER.filter((d) => days.includes(d)).map((d) => DAY_NAMES[d] + (plural ? 's' : ''));
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

export function sheetTiming(sheet: Pick<SignupSheet, 'keep_raids_posted' | 'hours_before'>): string {
  if (sheet.keep_raids_posted != null) {
    return sheet.keep_raids_posted === 1
      ? '1 raid posted at a time'
      : `${sheet.keep_raids_posted} raids posted at a time`;
  }
  return `${sheet.hours_before} hours before each raid`;
}

const channelOf = (server: DiscordServer, id: string) => server.channels.find((c) => c.id === id);

// The channel's name as Discord has it now, or null when it is gone.
export function channelName(server: DiscordServer, id: string): string | null {
  const channel = channelOf(server, id);
  return channel ? `#${channel.name}` : null;
}

export function roleName(server: DiscordServer, id: string): string | null {
  const role = server.roles.find((r) => r.id === id);
  return role ? `@${role.name}` : null;
}

// What is wrong with a picked channel, in words an officer can act on in
// Discord, or null when the bot can post there.
export function channelProblem(server: DiscordServer, id: string): string | null {
  const channel = channelOf(server, id);
  if (!channel) return 'This channel no longer exists in the server. Pick another.';
  if (channel.missing.length === 0) return null;
  return `The bot can't post here. In Discord, choose Edit Channel, then Permissions, and add the WGA Raid Hub role with ${listOf(channel.missing)} on.`;
}

export function roleProblem(server: DiscordServer, id: string): string | null {
  return server.roles.some((r) => r.id === id) ? null : 'This role no longer exists in the server. Pick another.';
}

function listOf(names: string[]): string {
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

// A row's right-hand summary: where it posts and whom it pings, or Off, or
// the one problem to fix first.
export function postSummary(
  server: DiscordServer,
  post: { channel_id: string | null; ping_role_id: string | null }
): { text: string; problem: boolean } {
  if (!post.channel_id) return { text: 'Off', problem: false };
  const channel = channelName(server, post.channel_id);
  if (!channel) return { text: 'Its channel no longer exists', problem: true };
  if (channelProblem(server, post.channel_id)) return { text: `The bot can't post in ${channel}`, problem: true };
  if (!post.ping_role_id) return { text: channel, problem: false };
  const role = roleName(server, post.ping_role_id);
  if (!role) return { text: `${channel}, its ping role no longer exists`, problem: true };
  return { text: `${channel}, pings ${role}`, problem: false };
}

// Which days are on another sheet than this one, and that sheet's channel.
export function takenDays(sheets: SignupSheet[], ownId: number | null): Map<number, string> {
  const taken = new Map<number, string>();
  for (const sheet of sheets) {
    if (sheet.id === ownId) continue;
    for (const day of sheet.raid_days) taken.set(day, sheet.channel_id);
  }
  return taken;
}

// The team's raid time zones, Eastern first: the ones the schedule offers.
export const QUIET_ZONES: { id: string; label: string }[] = [
  { id: 'America/New_York', label: 'Eastern time' },
  { id: 'America/Chicago', label: 'Central time' },
  { id: 'America/Denver', label: 'Mountain time' },
  { id: 'America/Los_Angeles', label: 'Pacific time' }
];

// The bot's install page with the permissions already ticked (#1706): the
// four it posts with, Mention Everyone so a team's ping roles always notify,
// and what recruiting and later features use (Kat, 2026-10-29, on #963).
export const BOT_INSTALL_URL =
  'https://discord.com/oauth2/authorize?client_id=1546653048972251309&scope=bot%20applications.commands&permissions=581085184912465';
