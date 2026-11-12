import { roleOfSpec, type Priority, type Role, type SpecRow } from './recruiting';

// The Recruits page (#1549): what team_recruits() and recruit_record() return,
// and the words and rules the page puts on them. Pure functions of those rows.

export type Status =
  | 'waiting_on_officers'
  | 'waiting_on_applicant'
  | 'on_trial'
  | 'joined'
  | 'declined'
  | 'not_joining'
  | 'no_reply'
  | 'withdrawn';

export type Need = {
  role: Role;
  class_spec_id: number | null;
  class: string | null;
  spec: string | null;
  priority: Priority;
};

export type Recruit = {
  id: number;
  name: string | null;
  name_realm: string;
  class_name: string | null;
  spec_name: string | null;
  item_level: number | null;
  mplus_score: number | null;
  logs_best_average: number | null;
  logs_median_average: number | null;
  mythic_bosses_killed: number | null;
  source: 'application' | 'added_by_officer';
  status: Status;
  sent_by: 'recruiter' | 'friend' | 'nobody';
  sent_by_name: string | null;
  applied_at: string;
  closed_at: string | null;
  applicant_last_message_at: string | null;
  officers_last_message_at: string | null;
  trial_starts_on: string | null;
  trial_ends_on: string | null;
  reminded: boolean;
  ticket_url: string | null;
};

export type Access = 'manage' | 'note' | 'read';

export type RecruitList = {
  access: Access;
  min_item_level: number | null;
  needs: Need[];
  recruits: Recruit[];
};

// ---------------------------------------------------------------------------
// Tabs

export const TABS = [
  { id: 'open', label: 'Open', statuses: ['waiting_on_officers', 'waiting_on_applicant'] },
  { id: 'trial', label: 'On trial', statuses: ['on_trial'] },
  { id: 'joined', label: 'Joined', statuses: ['joined'] },
  // Someone who withdrew stopped it themselves: the nearest to Declined.
  { id: 'declined', label: 'Declined', statuses: ['declined', 'not_joining', 'withdrawn'] },
  { id: 'noreply', label: 'No reply', statuses: ['no_reply'] }
] as const;

export type TabId = (typeof TABS)[number]['id'];

export const tabOf = (id: string | null): TabId => TABS.find((t) => t.id === id)?.id ?? 'open';

export const inTab = (r: Recruit, tab: TabId): boolean =>
  (TABS.find((t) => t.id === tab)!.statuses as readonly string[]).includes(r.status);

export const tabCounts = (list: Recruit[]): Record<TabId, number> =>
  Object.fromEntries(TABS.map((t) => [t.id, list.filter((r) => inTab(r, t.id)).length])) as Record<TabId, number>;

// How many are waiting on officers, for the sidebar.
export const waitingOnOfficers = (list: Recruit[]): number =>
  list.filter((r) => r.status === 'waiting_on_officers').length;

// ---------------------------------------------------------------------------
// Words

export const STATUS_WORDS: Record<Status, string> = {
  waiting_on_officers: 'Waiting on officers',
  waiting_on_applicant: 'Waiting on them',
  on_trial: 'On trial',
  joined: 'Joined',
  declined: 'Declined',
  not_joining: 'Not joining',
  no_reply: 'No reply',
  withdrawn: 'Withdrew'
};

// "2 h", "1 d": the largest whole unit, minutes under an hour.
export function age(iso: string | null, now: Date): string {
  if (!iso) return '';
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}

// The wait is counted from the other side's last word: the applicant's when
// the officers owe a reply (else when they applied), the officers' when the
// applicant does.
export function waitingSince(r: Recruit): string | null {
  if (r.status === 'waiting_on_officers') return r.applicant_last_message_at ?? r.applied_at;
  if (r.status === 'waiting_on_applicant') return r.officers_last_message_at ?? r.applied_at;
  return null;
}

const DAY = 86_400_000;
const dayNumber = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!) / DAY;
};

// "Day 12 of 14", counted by the dates the trial was set with (Eastern days).
export function trialDay(r: Recruit, today: string): { day: number; of: number } | null {
  if (!r.trial_starts_on || !r.trial_ends_on) return null;
  const of = dayNumber(r.trial_ends_on) - dayNumber(r.trial_starts_on);
  const day = dayNumber(today) - dayNumber(r.trial_starts_on) + 1;
  return { day: Math.min(Math.max(day, 1), Math.max(of, 1)), of };
}

// "ends Thursday" within a week, else the date.
export function trialEnds(r: Recruit, today: string): string {
  if (!r.trial_ends_on) return '';
  const left = dayNumber(r.trial_ends_on) - dayNumber(today);
  if (left < 0) return 'ended';
  if (left === 0) return 'ends today';
  const [y, m, d] = r.trial_ends_on.split('-').map(Number);
  const date = new Date(y!, m! - 1, d!);
  return left < 7
    ? `ends ${date.toLocaleDateString('en-US', { weekday: 'long' })}`
    : `ends ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

export function whereItsAt(r: Recruit, now: Date, today: string): { label: string; detail: string } {
  if (r.status === 'on_trial') {
    const t = trialDay(r, today);
    return { label: t ? `Day ${t.day} of ${t.of}` : 'On trial', detail: trialEnds(r, today) };
  }
  const since = waitingSince(r);
  if (since) {
    const detail = [age(since, now), r.status === 'waiting_on_applicant' && r.reminded ? 'reminded' : '']
      .filter(Boolean)
      .join(' · ');
    return { label: STATUS_WORDS[r.status], detail };
  }
  return { label: STATUS_WORDS[r.status], detail: r.closed_at ? `${age(r.closed_at, now)} ago` : '' };
}

export function sentBy(r: Recruit): string {
  if (r.source === 'added_by_officer') return 'Added by officers';
  if (r.sent_by === 'recruiter') return r.sent_by_name ?? 'A recruiter';
  if (r.sent_by === 'friend') return r.sent_by_name ? `Friend of ${r.sent_by_name}` : 'A friend';
  return 'Found us';
}

// "Demonology Warlock", "Warlock" when only the class is known.
export const specClass = (r: Pick<Recruit, 'spec_name' | 'class_name'>): string =>
  [r.spec_name, r.class_name].filter(Boolean).join(' ');

// "Katorri-Stormrage" as the name and the realm apart.
export function splitName(nameRealm: string): { name: string; realm: string } {
  const dash = nameRealm.indexOf('-');
  return dash < 0
    ? { name: nameRealm, realm: '' }
    : { name: nameRealm.slice(0, dash), realm: nameRealm.slice(dash + 1) };
}

// ---------------------------------------------------------------------------
// Warnings

export const underMinimum = (r: Pick<Recruit, 'item_level'>, min: number | null): boolean =>
  min !== null && r.item_level !== null && r.item_level < min;

// A class the team's spots don't ask for: no spot names one of its specs, and
// no "any <role>" spot is a role one of its specs plays. A team with no spots
// asks for everyone, and with the spec list not read yet nothing is said.
export function notOnNeeds(r: Pick<Recruit, 'class_name'>, needs: Need[], specs: SpecRow[] | undefined): boolean {
  if (!r.class_name || !needs.length || !specs?.length) return false;
  return !needs.some((n) =>
    n.class_spec_id !== null
      ? n.class === r.class_name
      : specs.some((s) => s.class === r.class_name && roleOfSpec(s) === n.role)
  );
}

// ---------------------------------------------------------------------------
// One recruit (recruit_record)

export type Answer = {
  key?: string;
  question_id?: number;
  label: string;
  prompt: string;
  answer_type: string;
  answer: unknown;
};

export type Note = {
  id: number;
  author: string | null;
  mine: boolean;
  body: string;
  source: string;
  created_at: string;
};
export type RecruitEvent = { kind: string; actor: string | null; detail: string | null; created_at: string };
export type Message = {
  author_name: string;
  by_applicant: boolean;
  body: string;
  attachments: { name: string; content_type: string }[];
  sent_at: string;
  in_officer_thread: boolean;
};
export type Before = { id: number; team_name: string; applied_at: string; status: Status };

export type RecruitRecord = {
  access: Access;
  id: number;
  team_name: string;
  name: string | null;
  name_realm: string;
  class_name: string | null;
  spec_name: string | null;
  other_specs: string[];
  status: Status;
  answers: Answer[];
  notes: Note[];
  events: RecruitEvent[];
  messages: Message[];
  applied_before: Before[];
  ticket_deleted_at: string | null;
};

const EVENT_WORDS: Record<string, string> = {
  applied: 'Applied',
  added_by_officer: 'Added by an officer',
  withdrawn: 'Withdrew the application',
  joined_discord: 'Joined the Discord',
  ticket_opened: 'Ticket opened',
  officer_replied: 'An officer replied',
  reminder_sent: 'Reminder sent',
  trial_started: 'Trial started',
  trial_extended: 'Trial extended',
  declined: 'Declined',
  joined: 'Joined the team',
  not_joining: 'Not joining',
  closed: 'Closed',
  reopened: 'Reopened',
  note_added: 'Added a note'
};

// "Dana declined: not a fit", newest first on the page.
export function eventText(e: RecruitEvent): string {
  const what = EVENT_WORDS[e.kind] ?? e.kind;
  const who = e.actor ? `${e.actor}: ` : '';
  return `${who}${what}${e.detail ? ` (${e.detail})` : ''}`;
}

// How an answer reads: yes/no as words, a list joined, anything else as typed.
export function answerText(a: Answer): string {
  const v = a.answer;
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  if (Array.isArray(v)) return v.join(', ');
  return v == null ? '' : String(v);
}

export const isLink = (text: string) => /^https?:\/\/\S+$/.test(text);

// Notes the recruiter who sent them wrote, by name: the record says who wrote
// each but not by id, so an officer with the same name would read as theirs.
export const recruiterNotes = (r: Recruit, notes: Note[]): Note[] =>
  r.sent_by === 'recruiter' && r.sent_by_name ? notes.filter((n) => n.author === r.sent_by_name) : [];

export const NAME_REALM = /^[^\s-][^-]*-\S/;
