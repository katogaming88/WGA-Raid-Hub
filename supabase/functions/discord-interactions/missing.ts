// /officer missing-signups's words (#990): who hasn't signed up for the
// coming season, grouped by role, and the reminder DM.

// One active roster character, and whether a live signup covers it.
export interface RosterEntry {
  nameRealm: string;
  // class_specs.role: Tank, Heal, Melee or Ranged; null when no spec is set.
  role: string | null;
  // The Discord account on the character's Raid Hub profile, if any.
  discordId: string | null;
  signedUp: boolean;
}

// The coming season's signups for one team; null when none is open.
export type MissingSignups = { seasonName: string; roster: RosterEntry[] } | null;

export const MISSING_COOLDOWN = 'signup-reminder' as const;
export const REMIND_PREFIX = 'missing-signups-remind:';

const RED = 0xe74c3c;

export type Group = { label: 'Tanks' | 'Healers' | 'DPS'; names: string[] };

// Anyone not a tank or healer is DPS, a character with no spec yet included.
export function groupMissing(roster: RosterEntry[]): Group[] {
  const groups: Group[] = [
    { label: 'Tanks', names: [] },
    { label: 'Healers', names: [] },
    { label: 'DPS', names: [] }
  ];
  for (const r of roster) {
    if (r.signedUp) continue;
    groups[r.role === 'Tank' ? 0 : r.role === 'Heal' ? 1 : 2].names.push(r.nameRealm);
  }
  return groups;
}

// A list of names cut to fit an embed field, with a count of the rest.
function fit(names: string[], limit = 1000): string {
  let out = '';
  let i = 0;
  for (; i < names.length; i++) {
    const next = out ? out + '\n' + names[i] : names[i];
    if (next.length > limit) break;
    out = next;
  }
  return i < names.length ? `${out}\n... and ${names.length - i} more` : out;
}

export const NOT_OPEN = (team: string) =>
  `${team}'s signups for the next season aren't open, so nobody is missing one.`;

export function missingEmbed(teamName: string, open: NonNullable<MissingSignups>, siteUrl?: string) {
  const groups = groupMissing(open.roster);
  const missing = groups.reduce((n, g) => n + g.names.length, 0);
  const total = open.roster.length;
  const link = siteUrl ? `${siteUrl.replace(/\/$/, '')}/officer.html?tab=signups` : null;
  return {
    color: RED,
    title:
      missing === 0
        ? `${teamName}: everyone has signed up for ${open.seasonName}`
        : `${teamName}: ${missing} not signed up for ${open.seasonName}`,
    description: `${total - missing} of ${total} signed up${link ? `\n[Roster › Signups](${link})` : ''}`,
    fields: groups
      .filter((g) => g.names.length > 0)
      .map((g) => ({ name: `${g.label} (${g.names.length})`, value: fit(g.names) }))
  };
}

// The DM a raider gets.
export function reminderEmbed(teamName: string, seasonName: string, nameRealm: string, siteUrl?: string) {
  return {
    color: RED,
    title: `${teamName} -- Signup Reminder`,
    description: `Hey ${nameRealm}! You haven't signed up for ${seasonName} yet.`,
    footer: { text: 'Officers use signups to plan the next season -- please take a moment to sign up.' },
    ...(siteUrl ? { fields: [{ name: 'Sign up here', value: `${siteUrl.replace(/\/$/, '')}/#signup` }] } : {})
  };
}

// What the officer sees once the reminders went out.
export function reminderSummary(reminded: string[], skipped: string[], closed: string[], noDiscord: string[]) {
  const section = (name: string, names: string[]) => ({
    name: `${name} (${names.length})`,
    value: fit(names) || 'None'
  });
  return {
    color: RED,
    title: 'Signup Reminders',
    fields: [
      section('Reminded', reminded),
      section('Skipped -- reminded in last 24h', skipped),
      ...(closed.length ? [section("Couldn't DM -- DMs closed?", closed)] : []),
      ...(noDiscord.length ? [section('No Discord account on Raid Hub', noDiscord)] : [])
    ]
  };
}
