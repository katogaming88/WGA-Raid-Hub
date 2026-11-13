import { easternDate, easternToday } from '../lib/dates';
import { STATUS_WORDS, age, type Status } from './recruits';

// My recruits (#1550): what my_recruits() returns, and the words and links the
// page puts on it. Pure functions of those rows.

export type MyRecruitNote = { id: number; body: string; created_at: string };

export type MyRecruit = {
  id: number;
  team_id: number;
  guild_id: number;
  team_name: string;
  name: string | null;
  name_realm: string;
  class_name: string | null;
  spec_name: string | null;
  status: Status;
  applied_at: string;
  closed_at: string | null;
  trial_starts_on: string | null;
  trial_ends_on: string | null;
  // Only the recruiter's own, never an officer's.
  notes: MyRecruitNote[];
};

// Where it's at, in the words the Recruits page uses, with "Waiting on
// officers" for the one that needs attention.
export const statusWord = (r: MyRecruit): string => STATUS_WORDS[r.status];
export const needsOfficers = (r: MyRecruit): boolean => r.status === 'waiting_on_officers';

// The character's name for a heading: the Name an officer or the person gave
// when they have one, else the character without its realm.
export const heading = (r: MyRecruit): string => r.name ?? r.name_realm.split('-')[0]!;

// "Demonology Warlock · Phoenix · applied 2 h ago".
export function subline(r: MyRecruit, now: Date): string {
  const spec = [r.spec_name, r.class_name].filter(Boolean).join(' ');
  return [spec, r.team_name, `applied ${age(r.applied_at, now)} ago`].filter(Boolean).join(' \u00b7 ');
}

// "3 this month, 1 joined": applied in the current Eastern month, and joined
// ever (the count a recruiter is proud of does not reset on the 1st).
export function summary(list: MyRecruit[], today = easternToday()): string {
  const month = today.slice(0, 7);
  const thisMonth = list.filter((r) => easternDate(r.applied_at).startsWith(month)).length;
  const joined = list.filter((r) => r.status === 'joined').length;
  return `${thisMonth} this month \u00b7 ${joined} joined`;
}

// A recruiter's links: one per team, then the guild's page ("Not sure yet").
// The code rides in ?from=, the same one on every link.
export type Link = { label: string; url: string };

export function links(origin: string, guildKey: string, code: string, teams: { name: string; slug: string }[]): Link[] {
  const from = `?from=${code}`;
  return [
    ...teams.map((t) => ({ label: t.name, url: `${origin}/g/${guildKey}/apply/${t.slug}${from}` })),
    { label: 'Not sure yet', url: `${origin}/g/${guildKey}/apply${from}` }
  ];
}
