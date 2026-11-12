// Recruiting settings (#1548): the draft an officer edits, what changed, why it
// can't save yet, and what each section's heading says. Pure functions; the
// reads and writes are in useRecruiting.ts. The database checks every rule
// again (save_team_recruiting() and its siblings): these only say so before
// the officer presses Save.

export type JoinMethod = 'application' | 'discord_ticket';
export type DiscordMode = 'ticket' | 'officer_thread' | 'officer_post' | 'none';

// What team_recruiting_settings() returns, less the spots.
export type Settings = {
  taking_applications: boolean;
  join_method: JoinMethod;
  ticket_link: string | null;
  listed_on_guild_page: boolean;
  about: string | null;
  schedule_note: string | null;
  extra_night: 'none' | 'first_two_weeks' | 'sometimes';
  raid_languages: string[];
  split_runs: 'none' | 'early_season' | 'weekly';
  alts_expected: number | null;
  ptr_testing: 'none' | 'optional' | 'expected';
  min_item_level: number | null;
  attendance_percent: number | null;
  trial_days: number;
  logs_required: boolean;
  other_requirements: string | null;
  exceptional_line_on: boolean;
  exceptional_line: string;
  discord_mode: DiscordMode;
  officer_thread_with_ticket: boolean;
  add_to_server: boolean;
  ticket_category_id: string | null;
  visible_to_team_officers: boolean;
  visible_to_team_assistants: boolean;
  visible_to_guild_admins: boolean;
  visible_to_role_ids: string[];
  dm_reply_after_minutes: number | null;
  remind_after_hours: number | null;
  close_no_reply_after_hours: number | null;
  ping_officers_after_hours: number | null;
  ping_owner_after_hours: number | null;
  trial_end_notice_hours: number | null;
  delete_closed_after_hours: number | null;
};

export const SETTING_KEYS = [
  'taking_applications',
  'join_method',
  'ticket_link',
  'listed_on_guild_page',
  'about',
  'schedule_note',
  'extra_night',
  'raid_languages',
  'split_runs',
  'alts_expected',
  'ptr_testing',
  'min_item_level',
  'attendance_percent',
  'trial_days',
  'logs_required',
  'other_requirements',
  'exceptional_line_on',
  'exceptional_line',
  'discord_mode',
  'officer_thread_with_ticket',
  'add_to_server',
  'ticket_category_id',
  'visible_to_team_officers',
  'visible_to_team_assistants',
  'visible_to_guild_admins',
  'visible_to_role_ids',
  'dm_reply_after_minutes',
  'remind_after_hours',
  'close_no_reply_after_hours',
  'ping_officers_after_hours',
  'ping_owner_after_hours',
  'trial_end_notice_hours',
  'delete_closed_after_hours'
] as const satisfies readonly (keyof Settings)[];

export type Role = 'tank' | 'healer' | 'melee' | 'ranged';
export type Priority = 'high' | 'medium' | 'low';
export const PRIORITIES: Priority[] = ['high', 'medium', 'low'];
export const PRIORITY_LABELS: Record<Priority, string> = { high: 'High', medium: 'Medium', low: 'Low' };

// A spot is a spec, or no spec for "Any <role>". `key` only identifies a row in
// the editor.
export type Spot = { key: number; role: Role; class_spec_id: number | null; priority: Priority };
export type SpotRow = Omit<Spot, 'key'>;

export type SpecRow = { id: number; class: string; spec: string; role: string | null };

// The three groups of the "Who you're looking for" section: DPS is melee and
// ranged together.
export const SPOT_GROUPS: { id: string; label: string; roles: Role[] }[] = [
  { id: 'tank', label: 'Tanks', roles: ['tank'] },
  { id: 'healer', label: 'Healers', roles: ['healer'] },
  { id: 'dps', label: 'DPS', roles: ['melee', 'ranged'] }
];

const ROLE_OF: Record<string, Role> = { Tank: 'tank', Heal: 'healer', Melee: 'melee', Ranged: 'ranged' };
export const roleOfSpec = (spec: SpecRow): Role | null => ROLE_OF[spec.role ?? ''] ?? null;

export type StarterAnswer = { on: boolean; required: boolean };

// What team_application_questions() returns.
export type Starter = {
  key: string;
  group: string;
  label: string;
  prompt: string;
  answer_type: string;
  max_length: number | null;
  choices: string[] | null;
  on: boolean;
  required: boolean;
};
export type OwnQuestion = {
  id: number;
  label: string;
  prompt: string;
  answer_type: string;
  max_length: number | null;
  choices: string[] | null;
  required: boolean;
};
export type QuestionList = { starters: Starter[]; questions: OwnQuestion[] };

export const OWN_TYPES: { id: string; label: string }[] = [
  { id: 'short_text', label: 'Short answer' },
  { id: 'paragraph', label: 'Paragraph' },
  { id: 'link', label: 'Link' },
  { id: 'choice', label: 'Pick one' },
  { id: 'yes_no', label: 'Yes / No' },
  { id: 'picture', label: 'Picture' }
];

// A team's own question as the editor holds it: `id` is null until it saves,
// `choices` one option a line, `max` the text limit as typed. `key` identifies
// the row while editing.
export type OwnDraft = {
  key: number;
  id: number | null;
  label: string;
  prompt: string;
  answer_type: string;
  max: string;
  choices: string;
  required: boolean;
};

export type Draft = {
  settings: Settings;
  spots: Spot[];
  starters: Record<string, StarterAnswer>;
  questions: OwnDraft[];
};

// ---------------------------------------------------------------------------
// Building and comparing drafts

export function settingsOf(row: Record<string, unknown>): Settings {
  const out: Record<string, unknown> = {};
  for (const k of SETTING_KEYS) out[k] = row[k];
  return out as Settings;
}

let nextKey = 1;
export const newKey = () => nextKey++;

export function startersOf(list: Starter[]): Record<string, StarterAnswer> {
  return Object.fromEntries(list.map((s) => [s.key, { on: s.on, required: s.required }]));
}

export function ownDraftOf(q: OwnQuestion): OwnDraft {
  return {
    key: newKey(),
    id: q.id,
    label: q.label,
    prompt: q.prompt,
    answer_type: q.answer_type,
    max: q.max_length === null ? '' : String(q.max_length),
    choices: (q.choices ?? []).join('\n'),
    required: q.required
  };
}

export function blankQuestion(): OwnDraft {
  return {
    key: newKey(),
    id: null,
    label: '',
    prompt: '',
    answer_type: 'short_text',
    max: '100',
    choices: '',
    required: false
  };
}

export const spotsOf = (rows: SpotRow[]): Spot[] => rows.map((r) => ({ ...r, key: newKey() }));

// The settings that differ from what was saved: exactly what save_team_recruiting() is sent.
export function changes(saved: Settings, draft: Settings): Partial<Settings> {
  const diff: Record<string, unknown> = {};
  for (const k of SETTING_KEYS) {
    if (JSON.stringify(saved[k]) !== JSON.stringify(draft[k])) diff[k] = draft[k];
  }
  return diff as Partial<Settings>;
}

export const spotRows = (spots: Spot[]): SpotRow[] =>
  spots.map(({ role, class_spec_id, priority }) => ({ role, class_spec_id, priority }));

export const sameSpots = (a: Spot[], b: Spot[]) => JSON.stringify(spotRows(a)) === JSON.stringify(spotRows(b));

export const sameStarters = (a: Record<string, StarterAnswer>, b: Record<string, StarterAnswer>) =>
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

const draftQuestion = (q: OwnDraft) => {
  const choices =
    q.answer_type === 'choice'
      ? q.choices
          .split('\n')
          .map((c) => c.trim())
          .filter(Boolean)
      : null;
  const max = q.answer_type === 'short_text' || q.answer_type === 'paragraph' ? Number(q.max) : null;
  return {
    ...(q.id === null ? {} : { id: q.id }),
    label: q.label.trim(),
    prompt: q.prompt.trim(),
    answer_type: q.answer_type,
    max_length: max,
    choices,
    required: q.required
  };
};

// What save_team_application_questions() is sent for the team's own questions,
// in order.
export const questionPayload = (list: OwnDraft[]) =>
  list.map((q) => {
    const d = draftQuestion(q);
    const { max_length, ...rest } = d;
    return { ...rest, ...(max_length === null ? {} : { max_length }) };
  });

export const sameQuestions = (a: OwnDraft[], b: OwnDraft[]) =>
  JSON.stringify(questionPayload(a)) === JSON.stringify(questionPayload(b));

// ---------------------------------------------------------------------------
// Why it can't save yet

const SHORT_LINE = /[\r\n]/;

export function problems(d: Draft): string[] {
  const s = d.settings;
  const found: string[] = [];
  if (s.taking_applications && s.join_method === 'discord_ticket' && !s.ticket_link?.trim()) {
    found.push('Add the link to your Discord ticket, or turn off "Taking applications".');
  }
  if (s.ticket_link && !/^https:\/\/\S+$/.test(s.ticket_link.trim())) {
    found.push('The ticket link needs to start with https://.');
  }
  if ((s.about ?? '').length > 2000) found.push('About the team is over 2,000 characters.');
  if ((s.schedule_note ?? '').length > 100 || SHORT_LINE.test(s.schedule_note ?? '')) {
    found.push('The schedule note is one line of at most 100 characters.');
  }
  if (s.raid_languages.length > 5) found.push('Pick at most 5 raid languages.');
  if (s.min_item_level !== null && (s.min_item_level < 1 || s.min_item_level > 1000)) {
    found.push('Lowest item level is between 1 and 1,000.');
  }
  if (s.attendance_percent !== null && (s.attendance_percent < 1 || s.attendance_percent > 100)) {
    found.push('Attendance is between 1 and 100 percent.');
  }
  if (s.alts_expected !== null && (s.alts_expected < 0 || s.alts_expected > 10))
    found.push('Alts expected is 0 to 10.');
  if (!Number.isInteger(s.trial_days) || s.trial_days < 1 || s.trial_days > 90) {
    found.push('Trial length is between 1 and 90 days.');
  }
  if ((s.other_requirements ?? '').length > 200 || SHORT_LINE.test(s.other_requirements ?? '')) {
    found.push('"Anything else" is one line of at most 200 characters.');
  }
  if (s.exceptional_line_on && (!s.exceptional_line.trim() || s.exceptional_line.length > 200)) {
    found.push('The exceptional-players line is 1 to 200 characters.');
  }
  if (s.discord_mode === 'ticket' && !s.add_to_server) {
    found.push('A private ticket needs "Add them to the Discord server".');
  }
  if (s.discord_mode === 'ticket' && !s.ticket_category_id) found.push('Pick the category tickets are made in.');
  if (
    s.remind_after_hours !== null &&
    s.close_no_reply_after_hours !== null &&
    s.remind_after_hours >= s.close_no_reply_after_hours
  ) {
    found.push('The reminder has to come before the ticket closes as "No reply".');
  }
  if (
    s.ping_officers_after_hours !== null &&
    s.ping_owner_after_hours !== null &&
    s.ping_officers_after_hours >= s.ping_owner_after_hours
  ) {
    found.push('The officer ping has to come before the Team Owner ping.');
  }
  found.push(...spotProblems(d.spots), ...questionProblems(d.questions));
  return found;
}

function spotProblems(spots: Spot[]): string[] {
  if (spots.length > 40) return ['A team has at most 40 open spots.'];
  const seen = new Set<string>();
  for (const sp of spots) {
    const id = `${sp.role}:${sp.class_spec_id ?? 'any'}`;
    if (seen.has(id)) return ['A spot is on the list twice.'];
    seen.add(id);
  }
  return [];
}

function questionProblems(list: OwnDraft[]): string[] {
  const found: string[] = [];
  if (list.length > 20) found.push('A team has at most 20 questions of its own.');
  list.forEach((q, i) => {
    const n = `Question ${i + 1}`;
    if (!q.label.trim() || q.label.length > 40) found.push(`${n}: a short name of 1 to 40 characters.`);
    if (!q.prompt.trim() || q.prompt.length > 300) found.push(`${n}: the wording is 1 to 300 characters.`);
    if (q.answer_type === 'short_text' && !(Number(q.max) >= 1 && Number(q.max) <= 200)) {
      found.push(`${n}: a short answer's limit is 1 to 200.`);
    }
    if (q.answer_type === 'paragraph' && !(Number(q.max) >= 1 && Number(q.max) <= 4000)) {
      found.push(`${n}: a paragraph's limit is 1 to 4,000.`);
    }
    if (q.answer_type === 'choice') {
      const n2 = q.choices
        .split('\n')
        .map((c) => c.trim())
        .filter(Boolean).length;
      if (n2 < 2 || n2 > 10) found.push(`${n}: give 2 to 10 choices, one a line.`);
    }
  });
  return found;
}

// ---------------------------------------------------------------------------
// Section headings

export const SECTIONS = ['recruiting', 'about', 'raid', 'ask', 'questions', 'looking', 'discord'] as const;
export type SectionId = (typeof SECTIONS)[number];

export type Heading = { status: string; done: boolean };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// How many of the seven "How you raid" facts are filled in: the raid nights,
// the note, an extra night, the languages, split runs, alts and PTR testing.
export function raidFilled(s: Settings, nights: number): number {
  return [
    nights > 0,
    !!s.schedule_note?.trim(),
    s.extra_night !== 'none',
    s.raid_languages.length > 0,
    s.split_runs !== 'none',
    s.alts_expected !== null,
    s.ptr_testing !== 'none'
  ].filter(Boolean).length;
}

export function askSummary(s: Settings): string {
  const parts = [
    s.min_item_level !== null ? `${s.min_item_level} item level` : null,
    s.attendance_percent !== null ? `${s.attendance_percent}% attendance` : null,
    s.trial_days ? `${s.trial_days}-day trial` : 'no trial',
    s.logs_required ? 'logs' : null
  ].filter(Boolean);
  return parts.join(', ');
}

export function questionCount(starters: Record<string, StarterAnswer>, own: OwnDraft[]): number {
  return Object.values(starters).filter((s) => s.on).length + own.length;
}

export function spotsSummary(spots: Spot[]): string {
  if (spots.length === 0) return 'Full, not listed';
  const high = spots.filter((s) => s.priority === 'high').length;
  return `${plural(spots.length, 'spot')}, ${high} high`;
}

export function discordSummary(s: Settings): string {
  const mode: Record<DiscordMode, string> = {
    ticket: 'Private ticket',
    officer_thread: 'Officer thread',
    officer_post: 'Officer post',
    none: 'Nothing in Discord'
  };
  return mode[s.discord_mode];
}

export function headings(d: Draft, nights: number): Record<SectionId, Heading> {
  const s = d.settings;
  const filled = raidFilled(s, nights);
  const about = (s.about ?? '').trim();
  return {
    recruiting: { status: s.taking_applications ? 'Taking applications' : 'Not taking applications', done: true },
    about: {
      status: about ? `${about.length.toLocaleString('en-US')} / 2,000` : 'Not written yet',
      done: about.length > 0
    },
    raid: { status: `${filled} of 7 filled in`, done: filled === 7 },
    ask: { status: askSummary(s), done: true },
    questions: { status: plural(questionCount(d.starters, d.questions), 'question'), done: true },
    looking: { status: spotsSummary(d.spots), done: d.spots.length > 0 },
    discord: { status: discordSummary(s), done: true }
  };
}

// ---------------------------------------------------------------------------
// "Start from a draft"

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// A first About text from the raid nights and open spots, for an officer who
// would rather edit than start blank. The nights are Eastern: the page shows
// each applicant their own time.
export function draftAbout(
  team: string,
  nights: { weekday: number; is_optional: boolean }[],
  spots: Spot[],
  specs: SpecRow[]
): string {
  const days = [...new Set(nights.filter((n) => !n.is_optional).map((n) => WEEKDAYS[n.weekday] ?? ''))];
  const raid = days.length ? `We raid ${list(days)}.` : '';
  const needs = [...new Set(spots.filter((s) => s.priority === 'high').map((s) => spotName(s, specs)))];
  const looking = needs.length ? `Right now we're looking for ${list(needs)}.` : '';
  return [
    `# ${team}`,
    '',
    `[What ${team} is chasing this season, and what a good raid night looks like.]`,
    '',
    [raid, looking].filter(Boolean).join(' ')
  ]
    .join('\n')
    .trim();
}

export function spotName(s: Pick<Spot, 'role' | 'class_spec_id'>, specs: SpecRow[]): string {
  const spec = specs.find((x) => x.id === s.class_spec_id);
  return spec ? `${spec.spec} ${spec.class}` : `Any ${s.role}`;
}

function list(items: string[]): string {
  if (items.length < 2) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

// ---------------------------------------------------------------------------
// Options for the timing pickers, as the mockup lists them

export type Choice = { value: number | null; label: string };

export const DM_REPLY: Choice[] = [
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 240, label: '4 hours' },
  { value: null, label: 'Never' }
];
export const REMIND: Choice[] = [
  { value: 48, label: '2 days' },
  { value: 72, label: '3 days' },
  { value: null, label: 'Never' }
];
export const CLOSE_NO_REPLY: Choice[] = [
  { value: 120, label: '5 days' },
  { value: 168, label: '7 days' },
  { value: null, label: 'Never' }
];
export const PING_OFFICERS: Choice[] = [
  { value: 12, label: '12 hours' },
  { value: 24, label: '24 hours' },
  { value: null, label: 'Never' }
];
export const PING_OWNER: Choice[] = [
  { value: 48, label: '2 days' },
  { value: 72, label: '3 days' },
  { value: null, label: 'Never' }
];
export const TRIAL_NOTICE: Choice[] = [
  { value: 24, label: '1 day before' },
  { value: 48, label: '2 days before' },
  { value: null, label: 'Off' }
];
export const DELETE_CLOSED: Choice[] = [
  { value: 12, label: '12 hours' },
  { value: 24, label: '24 hours' },
  { value: 72, label: '3 days' }
];

// A saved value the list doesn't offer (set by hand, or an older default)
// still shows, as its own option.
export function withCurrent(choices: Choice[], value: number | null, unit: 'minutes' | 'hours'): Choice[] {
  if (choices.some((c) => c.value === value)) return choices;
  const label =
    unit === 'minutes'
      ? value! % 60 === 0
        ? plural(value! / 60, 'hour')
        : `${value} minutes`
      : value! % 24 === 0
        ? plural(value! / 24, 'day')
        : plural(value!, 'hour');
  return [{ value, label }, ...choices];
}

export const LANGUAGES = ['English', 'Spanish', 'Portuguese', 'French', 'German', 'Russian', 'Korean', 'Chinese'];
