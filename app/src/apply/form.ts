// The application form's rules (#1547): the questions a team's form asks, what
// counts as answered, and the notes about the picked character. Pure functions
// of what team_application_form() and the character list return.

import type { Spot } from './apply';

export type AnswerType = 'short_text' | 'paragraph' | 'link' | 'choice' | 'yes_no' | 'picture' | 'recruiter';

// What team_application_form() returns: the starter questions that are on, and
// the team's own, in order.
export type FormStarter = {
  key: string;
  group: string;
  label: string;
  prompt: string;
  answer_type: AnswerType;
  max_length: number | null;
  choices: string[] | null;
  required: boolean;
};
export type FormOwn = Omit<FormStarter, 'key' | 'group'> & { id: number };
export type ApplicationForm = { starters: FormStarter[]; questions: FormOwn[] };

// One question as the page asks it. `key` is what send_application() reads the
// answer under: a starter's key, or the id of the team's own question.
export type Question = {
  key: string;
  prompt: string;
  type: AnswerType;
  max: number | null;
  choices: string[];
  required: boolean;
};

export type Answer = string | boolean;
export type Answers = Record<string, Answer | undefined>;

export function formQuestions(form: ApplicationForm): Question[] {
  return [
    ...form.starters.map((s) => ({ ...s, id: s.key })),
    ...form.questions.map((q) => ({ ...q, id: String(q.id) }))
  ].map((q) => ({
    key: q.id,
    prompt: q.prompt,
    type: q.answer_type,
    max: q.max_length,
    choices: q.choices ?? [],
    required: q.required
  }));
}

// A question's wording leaves {team} and {raid nights} for the page to fill
// (#1536), the nights in the applicant's own zone.
export const fillPrompt = (prompt: string, team: string, nights: string) =>
  prompt.replace(/\{team\}/g, team).replace(/\{raid nights\}/g, nights);

const LINK = /^https?:\/\/\S+$/;

const isBlank = (a: Answer | undefined) => a === undefined || (typeof a === 'string' && a.trim() === '');

// Why an answer can't be sent yet, or null. A blank optional answer is fine.
export function problemWith(q: Question, answer: Answer | undefined): string | null {
  if (isBlank(answer)) return q.required ? 'Please answer this.' : null;
  if (typeof answer === 'boolean') return null;
  const text = (answer as string).trim();
  if ((q.type === 'short_text' || q.type === 'paragraph') && q.max !== null && text.length > q.max) {
    return `That is over ${q.max} characters.`;
  }
  if (q.type === 'link' && (!LINK.test(text) || text.length > 500))
    return 'That needs to be a link, starting with http.';
  if (q.type === 'choice' && !q.choices.includes(text)) return 'Pick one of the choices.';
  return null;
}

// Every question's problem, keyed by question; empty when the form can go.
export function problems(questions: Question[], answers: Answers): Record<string, string> {
  const found: Record<string, string> = {};
  for (const q of questions) {
    if (q.type === 'recruiter') continue;
    const why = problemWith(q, answers[q.key]);
    if (why) found[q.key] = why;
  }
  return found;
}

// What goes to send_application(): answered questions only, text trimmed.
// "Who sent you?" travels as its own two arguments, not an answer.
export function sendableAnswers(questions: Question[], answers: Answers): Record<string, Answer> {
  const sent: Record<string, Answer> = {};
  for (const q of questions) {
    const a = answers[q.key];
    if (q.type === 'recruiter' || isBlank(a)) continue;
    sent[q.key] = typeof a === 'string' ? a.trim() : (a as boolean);
  }
  return sent;
}

// ---------------------------------------------------------------------------
// Who sent you?

export type Recruiter = { name: string; code: string };
export type SentBy = { kind: 'recruiter'; code: string } | { kind: 'friend'; name: string } | { kind: 'nobody' };

export const SENT_FRIEND = 'friend';
export const SENT_NOBODY = 'nobody';

// The choice a select holds: a recruiter's code, 'friend' or 'nobody'. A saved
// recruiter link that is still on the list is picked for them.
export function startingSentBy(recruiters: Recruiter[], saved: string | null): string {
  return saved && recruiters.some((r) => r.code === saved) ? saved : SENT_NOBODY;
}

export function sentByOf(choice: string, friend: string): SentBy {
  if (choice === SENT_FRIEND) return { kind: 'friend', name: friend.trim() };
  if (choice === SENT_NOBODY) return { kind: 'nobody' };
  return { kind: 'recruiter', code: choice };
}

// A friend is named when picked; blank would only be refused by the database.
export const friendProblem = (choice: string, friend: string) =>
  choice === SENT_FRIEND && friend.trim() === '' ? 'Name your friend, or pick another answer.' : null;

// ---------------------------------------------------------------------------
// The picked character

export type Role = 'tank' | 'healer' | 'melee' | 'ranged';
export type SpecRow = { spec: string; role: string | null };

const ROLE_OF: Record<string, Role> = { Tank: 'tank', Heal: 'healer', Melee: 'melee', Ranged: 'ranged' };

// Whether one of the team's open spots is the character's class, or the
// whole role of its spec ("Any healer").
export function onTheList(spots: Spot[], className: string, spec: string | null, specs: SpecRow[]): boolean {
  const role = ROLE_OF[specs.find((s) => s.spec === spec)?.role ?? ''];
  return spots.some((s) => (s.class ? s.class === className : s.role === role));
}

// The line under the numbers when the class isn't wanted. They can still apply.
export function classNote(team: string, className: string, exceptionalOn: boolean): string {
  const plain = `${className} isn’t on ${team}’s list right now`;
  return exceptionalOn ? `${plain}, but they welcome exceptional players of any class or spec.` : `${plain}.`;
}

// Below the team's item level is allowed; officers see a warning.
export const belowItemLevel = (min: number | null, itemLevel: number | null) =>
  min !== null && itemLevel !== null && itemLevel < min;

// The other specs offered: the character's own class, minus the one it plays.
export const otherSpecs = (specs: SpecRow[], current: string | null) =>
  specs.map((s) => s.spec).filter((s) => s !== current);
