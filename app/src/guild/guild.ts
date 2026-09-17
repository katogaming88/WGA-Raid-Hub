// Guild home's rules (#1102): what each team card, the live streams, the news
// teaser, the officer list and the officers' panel show. Pure functions of rows
// already read, recorded against the current site's guild.html in
// tests/behavior/guild.js.

import {
  nightsBetween,
  shortDay,
  startTime,
  timeRange,
  type ScheduleChange,
  type ScheduleRule
} from '../calendar/calendar';
import { isoDate } from '../calendar/nights';
import { raidCards, type ProgressRow, type SettingsRaid } from '../home/progression';
import type { StreamerRow } from '../streams/streams';

// ---------------------------------------------------------------------------
// The guild's links

export type GuildRow = { name: string; region: string | null; realm: string | null };

// Blizzard's realm slug: lower case, apostrophes dropped, spaces as hyphens
// ("Mal'Ganis" -> "malganis", "Aerie Peak" -> "aerie-peak").
export const realmSlug = (realm: string) => realm.trim().toLowerCase().replace(/'/g, '').replace(/\s+/g, '-');

const guildSlug = (name: string) => name.trim().toLowerCase().replace(/'/g, '').replace(/\s+/g, '-');

// Raider.IO and the Armory, from the region and realm on the guild row. None
// when either is unset.
export function guildLinks(guild: GuildRow): { raiderIo: string; armory: string } | null {
  if (!guild.region || !guild.realm) return null;
  const region = guild.region.toLowerCase();
  const realm = realmSlug(guild.realm);
  return {
    raiderIo: `https://raider.io/guilds/${region}/${realm}/${encodeURIComponent(guild.name)}`,
    armory: `https://worldofwarcraft.com/en-${region}/guild/${region}/${realm}/${guildSlug(guild.name)}`
  };
}

const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

// "Three raid teams on Tichondrius. Pick yours, or find one to join."
export function guildIntro(teamCount: number, realm: string | null): string {
  const count = COUNT_WORDS[teamCount] ?? String(teamCount);
  const teams = `${count} raid ${teamCount === 1 ? 'team' : 'teams'}`;
  return `${teams}${realm ? ` on ${realm}` : ''}. Pick yours, or find one to join.`;
}

// ---------------------------------------------------------------------------
// Team cards

// What Guild home reads from each team's settings.
export type TeamSettingsRow = {
  team_id: number;
  signups_open: boolean | null;
  logs: string | null;
  raids: SettingsRaid[] | null;
};

export type Pip = 'mythic' | 'heroic' | 'none';

export type TeamCard = {
  id: number;
  key: string;
  name: string;
  mine: boolean;
  signup: boolean;
  logs: string | null;
  schedule: string;
  next: string | null;
  progress: { text: string; pips: { name: string; kill: Pip }[] } | null;
  raiders: number;
};

export type TeamInput = { id: number; key: string; name: string };

export type TeamData = {
  settings: TeamSettingsRow[];
  progress: (ProgressRow & { team_id: number })[];
  schedule: (ScheduleRule & { team_id: number })[];
  changes: (ScheduleChange & { team_id: number })[];
  roles: { team_id: number; classes_specs: { role: string | null } | null }[];
};

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// "Tue and Thu, 8:00 PM to 11:00 PM Eastern". Nights at different times are
// listed each with its own start: "Tue 8:00 PM, Sun 7:00 PM".
export function scheduleLine(rules: ScheduleRule[]): string {
  const regular = rules.filter((r) => !r.is_optional);
  const shown = regular.length ? regular : rules;
  if (!shown.length) return 'No raid nights set';
  const sorted = [...shown].sort((a, b) => a.weekday - b.weekday);
  const first = sorted[0]!;
  const sameTime = sorted.every(
    (r) => r.start_time === first.start_time && r.duration_minutes === first.duration_minutes
  );
  if (sameTime) {
    const days = sorted.map((r) => WEEKDAY[r.weekday]);
    const dayText = days.length > 1 ? `${days.slice(0, -1).join(', ')} and ${days.at(-1)}` : days[0];
    return `${dayText}, ${timeRange({ start: first.start_time, durationMinutes: first.duration_minutes })}`;
  }
  return sorted.map((r) => `${WEEKDAY[r.weekday]} ${startTime({ start: r.start_time })}`).join(', ');
}

// The next raid night from today, counting today, within two weeks.
export function nextRaid(rules: ScheduleRule[], changes: ScheduleChange[], today: Date): string | null {
  const from = isoDate(today);
  const until = new Date(today);
  until.setDate(until.getDate() + 14);
  const { nights } = nightsBetween(rules, changes, from, isoDate(until));
  const next = nights[0];
  return next ? `${shortDay(next.date)} ${startTime(next)}` : null;
}

// The season's first full raid, as "8/8 Heroic, 6/8 Mythic" and one pip per
// boss: Mythic kill, Heroic kill, or not yet.
export function teamProgress(raids: SettingsRaid[], rows: ProgressRow[]): TeamCard['progress'] {
  const cards = raidCards(raids, rows);
  const index = raids.findIndex((r) => !r.isMiniRaid);
  const card = cards[index >= 0 ? index : 0];
  if (!card || !card.bosses.length) return null;
  const total = card.bosses.length;
  const heroic = card.bosses.filter((b) => b.heroic?.date || b.mythic?.date).length;
  const mythic = card.bosses.filter((b) => b.mythic?.date).length;
  const parts = [`${heroic}/${total} Heroic`];
  if (mythic > 0) parts.push(`${mythic}/${total} Mythic`);
  return {
    text: parts.join(', '),
    pips: card.bosses.map((b) => ({
      name: b.name,
      kill: b.mythic?.date ? 'mythic' : b.heroic?.date ? 'heroic' : 'none'
    }))
  };
}

export function teamCards(teams: TeamInput[], data: TeamData, myTeamIds: Set<number>, today: Date): TeamCard[] {
  return teams.map((team) => {
    const own = <T extends { team_id: number }>(rows: T[]) => rows.filter((r) => r.team_id === team.id);
    const settings = own(data.settings)[0];
    const rules = own(data.schedule);
    return {
      id: team.id,
      key: team.key,
      name: team.name,
      mine: myTeamIds.has(team.id),
      // Signups fail closed: a Sign up link into a closed form is worse than
      // none (js/guild.js).
      signup: settings?.signups_open === true,
      logs: settings?.logs || null,
      schedule: scheduleLine(rules),
      next: nextRaid(rules, own(data.changes), today),
      progress: teamProgress(Array.isArray(settings?.raids) ? settings.raids : [], own(data.progress)),
      // The same count as the team Home page: roster rows with a role.
      raiders: own(data.roles).filter((p) => p.classes_specs?.role).length
    };
  });
}

// ---------------------------------------------------------------------------
// Live streams

export type GuildStream = { id: number; name: string; channel: string; team: string; note: string };

// Everyone live, from every team, except those who asked to be shown only on
// their own team's pages: on Guild home every reader counts as another team.
export function guildLive(rows: StreamerRow[], teamNames: Map<number, string>): GuildStream[] {
  return rows.flatMap((r) => {
    const nameRealm = (r.players?.name_realm ?? '').trim();
    if (!r.is_live || r.guild_wide_opt_out || !nameRealm) return [];
    const name = r.players?.nickname?.trim() || (nameRealm.split('-')[0] ?? '').trim();
    return [
      { id: r.id, name, channel: r.twitch_channel, team: teamNames.get(r.team_id) ?? '', note: r.schedule_note ?? '' }
    ];
  });
}

// ---------------------------------------------------------------------------
// Guild officers

// site_settings.guild_officer_bios, as the site admin editor writes it.
export type OfficerBio = {
  name?: string | null;
  title?: string | null;
  imagePath?: string | null;
  classKey?: string | null;
  pronouns?: string | null;
};

export type Officer = { name: string; title: string; photo: string | null; initials: string; classKey: string | null };

export function officers(bios: OfficerBio[] | null | undefined): Officer[] {
  return (bios ?? []).map((b) => {
    const name = b.name?.trim() || 'Unnamed';
    return {
      name,
      title: b.title?.trim() ?? '',
      photo: b.imagePath || null,
      initials: name.slice(0, 2).toUpperCase(),
      classKey: b.classKey || null
    };
  });
}

// ---------------------------------------------------------------------------
// Needs your attention

export type AttentionCounts = { team_id: number; reviews: number; signups: number; boe: number }[];

export type AttentionRow = {
  kind: 'reviews' | 'signups' | 'boe';
  label: string;
  total: number;
  teams: { key: string; name: string; count: number }[];
};

const ATTENTION: { kind: AttentionRow['kind']; label: string }[] = [
  { kind: 'reviews', label: 'Received-item reviews' },
  { kind: 'signups', label: 'New signups' },
  { kind: 'boe', label: 'BoE finds to price' }
];

// One row per kind of waiting task that has anything waiting, with the teams
// it is waiting on.
export function attentionRows(counts: AttentionCounts, teams: TeamInput[]): AttentionRow[] {
  return ATTENTION.flatMap(({ kind, label }) => {
    const perTeam = teams.flatMap((team) => {
      const count = counts.find((c) => c.team_id === team.id)?.[kind] ?? 0;
      return count > 0 ? [{ key: team.key, name: team.name, count }] : [];
    });
    const total = perTeam.reduce((sum, t) => sum + t.count, 0);
    return total > 0 ? [{ kind, label, total, teams: perTeam }] : [];
  });
}
