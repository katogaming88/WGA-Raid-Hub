// The recruiting buttons (#1542): the application card's Start a trial,
// Decline and Add note (recruit-ticket posts the card, #1541), and Joined,
// Extend trial and Not joining on the "trial ends soon" message (#1543 posts
// it). Every press writes the Raid Hub record through the bot_* database
// functions as the person whose Discord account pressed it, and those
// functions refuse anyone the site would refuse, so nothing here trusts
// Discord's roles.
//
// A press answers "thinking", which only the presser sees, then acts and
// says how it went. Done, the card says what happened ("Trial started by
// @Officer, Nov 10") and its used buttons go grey. A second press, or two
// officers at once, gets the database's own refusal the second time
// (recruit_lock() takes them one after the other).
//
// The custom ids:
//   recruit:<action>:<application>            the card's and the trial message's buttons
//   recruit:m-<action>:<application>          their pop-ups
//   recruit:nj-reason:<application>:<message> Not joining's reason list
//   recruit:m-nj:<application>:<reason>:<message>
//   recruit:decline-dm|decline-nodm:<application>   after a decline, only the officer's
//   recruit:extend-post|extend-nopost:<application>:<date>
// Not joining and its pop-up carry the trial message's id, since by then the
// press comes from the reason list, not that message.

export const RECRUIT_PREFIX = 'recruit:';

export type Recruit = {
  teamName: string;
  nameRealm: string;
  status: string;
  trialEndsOn: string | null;
  // The applicant's private ticket, when the team uses tickets.
  ticketChannelId: string | null;
  applicantDiscordId: string | null;
};

// ok with the function's answer, or not ok: refused when the database said no
// on purpose (its message is worded for people), else a failure.
export type ActResult = { ok: boolean; value?: unknown; refused?: boolean; message?: string };

export type RecruitAction = 'trial' | 'decline' | 'note' | 'joined' | 'extend' | 'not_joining';

export interface RecruitDb {
  recruit(applicationId: number): Promise<Recruit | null>;
  // The bot_* function for this action, as the person with this Discord id.
  // refused: the database said no on purpose (its message is for people).
  act(
    action: RecruitAction,
    applicationId: number,
    discordId: string,
    args: { reason?: string; detail?: string }
  ): Promise<ActResult>;
}

export type RecruitDeps = {
  db: RecruitDb;
  // One Discord REST call as the bot.
  discord(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; body: any }>;
  waitUntil(work: Promise<unknown>): void;
  now: () => Date;
};

type Interaction = {
  type: number;
  application_id: string;
  token: string;
  channel_id?: string;
  member?: { user?: { id: string } };
  message?: { id: string };
  data?: {
    custom_id?: string;
    values?: string[];
    components?: { components?: { custom_id?: string; value?: string }[] }[];
  };
};

const BUTTON = 3;
const MODAL_SUBMIT = 5;
const MESSAGE = 4;
const DEFERRED_MESSAGE = 5;
const DEFERRED_UPDATE = 6;
const MODAL = 9;
const EPHEMERAL = 1 << 6;
const REASON_MAX = 500;
const NOTE_MAX = 2000;

// The seven reasons recruit_trial_not_joining() takes, as the site words
// them (ARCHIVE_REASONS in app/src/roster/useNames.ts).
export const NOT_JOINING_REASONS: { value: string; label: string }[] = [
  { value: 'schedule_conflict', label: 'Schedule conflict' },
  { value: 'performance', label: 'Performance' },
  { value: 'drama', label: 'Drama' },
  { value: 'moved_guilds', label: 'Moved guilds' },
  { value: 'switching_mains', label: 'Switching mains' },
  { value: 'no_signup', label: 'Did not sign up' },
  { value: 'other', label: 'Other' }
];

export const ONLY_OFFICERS = (team: string) => `Only ${team}'s officers can do that.`;
export const GONE = "That recruit isn't on Raid Hub any more.";
export const BROKE = 'Something went wrong reading Raid Hub. Try again in a minute.';
export const STARTED = (name: string, team: string, until: string | null) =>
  `Trial started: ${name} is on ${team}'s roster as a Trial${until ? ` until ${until}` : ''}.`;
export const DECLINED = (name: string) => `Declined ${name}. Send them a short message saying so?`;
export const DECLINE_DM = (team: string) =>
  `Thanks for applying to ${team}. The officers have decided not to go ahead this time. Good luck with your search!`;
export const NOTE_SAVED = 'Note saved on their Raid Hub record. The applicant never sees it.';
export const JOINED = (name: string, team: string) => `${name} joined ${team}. Their Trial flag is off.`;
export const EXTENDED = (until: string) => `Trial extended to ${until}. Also post this in the ticket?`;
export const NOT_JOINING = (name: string) => `${name} is marked as not joining.`;
export const DM_SENT = 'Sent them the message.';
export const DM_CLOSED = "Couldn't message them: their Discord DMs are closed.";
export const NOT_SENT = 'Nothing sent.';
export const POSTED = 'Posted in the ticket.';
export const NO_TICKET = 'There is no ticket to post in.';

// What the card says happened, by action.
const DONE: Record<RecruitAction, string | null> = {
  trial: 'Trial started',
  decline: 'Declined',
  note: null,
  joined: 'Joined',
  extend: 'Trial extended',
  not_joining: 'Not joining'
};
// The buttons a done action greys out: none for a note or an extension,
// every status button once the recruit has moved on.
const GREYS: Record<RecruitAction, string[]> = {
  trial: ['trial', 'decline'],
  decline: ['trial', 'decline'],
  note: [],
  joined: ['joined', 'extend', 'notjoining'],
  extend: [],
  not_joining: ['joined', 'extend', 'notjoining']
};

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const thinking = () => json({ type: DEFERRED_MESSAGE, data: { flags: EPHEMERAL } });
const say = (content: string) => json({ type: MESSAGE, data: { content, flags: EPHEMERAL } });

const shortDate = (d: Date) =>
  d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
const dateOnly = (iso: string) =>
  new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

const textValue = (i: Interaction, id: string) =>
  String(
    (i.data?.components ?? []).flatMap((r) => r.components ?? []).find((c) => c.custom_id === id)?.value ?? ''
  ).trim();

const modal = (customId: string, title: string, label: string, required: boolean, max: number) => ({
  type: MODAL,
  data: {
    custom_id: customId,
    title,
    components: [{ type: 1, components: [{ type: 4, custom_id: 'text', style: 2, label, required, max_length: max }] }]
  }
});

const choice = (label: string, customId: string, style = 2) => ({ type: 2, style, label, custom_id: customId });

// The answer to a press, or null when the custom id isn't a recruiting one.
export function handleRecruit(deps: RecruitDeps, i: Interaction): Response | null {
  const customId = i.data?.custom_id ?? '';
  if (!customId.startsWith(RECRUIT_PREFIX)) return null;
  const [kind, idText, a, b] = customId.slice(RECRUIT_PREFIX.length).split(':');
  const id = Number(idText);
  const presser = i.member?.user?.id;
  if (!Number.isInteger(id) || id <= 0 || !presser) return say(BROKE);
  const later = (work: () => Promise<unknown>) => {
    deps.waitUntil(
      new Promise((r) => setTimeout(r, 0)).then(work).catch(async (err) => {
        console.error('discord-interactions: recruiting button failed:', err);
        await finish(deps, i, { content: BROKE }).catch(() => null);
      })
    );
  };
  const card = i.message?.id;

  if (i.type === BUTTON) {
    switch (kind) {
      case 'trial':
        later(() => act(deps, i, id, presser, 'trial', {}, card));
        return thinking();
      case 'joined':
        later(() => act(deps, i, id, presser, 'joined', {}, card));
        return thinking();
      // A pop-up has to be the first answer, so these ask before any read;
      // the database checks the presser when it's sent.
      case 'decline':
        return json(
          modal(`${RECRUIT_PREFIX}m-decline:${id}`, 'Decline', 'Why? Saved to their record', true, REASON_MAX)
        );
      case 'note':
        return json(modal(`${RECRUIT_PREFIX}m-note:${id}`, 'Add a note', 'Note (officers only)', true, NOTE_MAX));
      case 'extend':
        return json(modal(`${RECRUIT_PREFIX}m-extend:${id}`, 'Extend trial', 'Reason', true, REASON_MAX));
      case 'notjoining':
        // A pop-up holds only text boxes, so the reason is picked first.
        return json({
          type: MESSAGE,
          data: {
            flags: EPHEMERAL,
            content: 'Why are they not joining?',
            components: [
              {
                type: 1,
                components: [
                  {
                    type: 3,
                    custom_id: `${RECRUIT_PREFIX}nj-reason:${id}:${card ?? ''}`,
                    placeholder: 'Pick a reason',
                    options: NOT_JOINING_REASONS
                  }
                ]
              }
            ]
          }
        });
      case 'nj-reason': {
        const reason = i.data?.values?.[0] ?? '';
        if (!NOT_JOINING_REASONS.some((r) => r.value === reason)) return say(BROKE);
        return json(
          modal(
            `${RECRUIT_PREFIX}m-nj:${id}:${reason}:${a ?? ''}`,
            'Not joining',
            'Anything to add? (optional)',
            false,
            REASON_MAX
          )
        );
      }
      case 'decline-dm':
      case 'decline-nodm':
        later(() => afterDecline(deps, i, id, kind === 'decline-dm'));
        return json({ type: DEFERRED_UPDATE });
      case 'extend-post':
      case 'extend-nopost':
        later(() => afterExtend(deps, i, id, kind === 'extend-post' ? a : null));
        return json({ type: DEFERRED_UPDATE });
    }
    return say(BROKE);
  }

  if (i.type === MODAL_SUBMIT) {
    const text = textValue(i, 'text');
    switch (kind) {
      case 'm-decline':
        later(() => act(deps, i, id, presser, 'decline', { reason: text }, card));
        return thinking();
      case 'm-note':
        later(() => act(deps, i, id, presser, 'note', { reason: text }, card));
        return thinking();
      case 'm-extend':
        later(() => act(deps, i, id, presser, 'extend', { reason: text }, card));
        return thinking();
      case 'm-nj':
        later(() => act(deps, i, id, presser, 'not_joining', { reason: a, detail: text }, b || undefined));
        return thinking();
    }
  }
  return say(BROKE);
}

// Edits the "thinking" answer, which only the presser sees.
const finish = (deps: RecruitDeps, i: Interaction, data: Record<string, unknown>) =>
  deps.discord('PATCH', `/webhooks/${i.application_id}/${i.token}/messages/@original`, {
    ...data,
    allowed_mentions: { parse: [] }
  });

async function act(
  deps: RecruitDeps,
  i: Interaction,
  id: number,
  presser: string,
  action: RecruitAction,
  args: { reason?: string; detail?: string },
  messageId: string | undefined
) {
  const before = await deps.db.recruit(id);
  if (!before) return finish(deps, i, { content: GONE });
  const result = await deps.db.act(action, id, presser, args);
  if (!result.ok) {
    if (!result.refused) {
      console.error(`discord-interactions: bot ${action} failed:`, result.message);
      return finish(deps, i, { content: BROKE });
    }
    const who = /Not authorized|Nobody on Raid Hub has that Discord id/.test(result.message ?? '');
    return finish(deps, i, { content: who ? ONLY_OFFICERS(before.teamName) : (result.message ?? BROKE) });
  }

  const after = (await deps.db.recruit(id)) ?? before;
  if (messageId && i.channel_id && DONE[action]) {
    await markDone(deps, i.channel_id, messageId, action, presser).catch((err) =>
      console.error('discord-interactions: recruiting card edit failed:', err)
    );
  }

  switch (action) {
    case 'trial': {
      const until = after.trialEndsOn ? dateOnly(after.trialEndsOn) : null;
      await post(deps, after.ticketChannelId, STARTED(after.nameRealm, after.teamName, until));
      return finish(deps, i, { content: STARTED(after.nameRealm, after.teamName, until) });
    }
    case 'decline':
      return finish(deps, i, {
        content: DECLINED(after.nameRealm),
        components: [
          {
            type: 1,
            components: [
              choice('Send message', `${RECRUIT_PREFIX}decline-dm:${id}`, 1),
              choice("Don't send", `${RECRUIT_PREFIX}decline-nodm:${id}`)
            ]
          }
        ]
      });
    case 'note':
      return finish(deps, i, { content: NOTE_SAVED });
    case 'joined':
      await post(deps, after.ticketChannelId, `Welcome to ${after.teamName}, ${after.nameRealm.split('-')[0]}!`);
      return finish(deps, i, { content: JOINED(after.nameRealm, after.teamName) });
    case 'extend': {
      const until = typeof result.value === 'string' ? result.value : after.trialEndsOn;
      return finish(deps, i, {
        content: EXTENDED(until ? dateOnly(until) : 'a later date'),
        components: [
          {
            type: 1,
            components: [
              choice('Post in the ticket', `${RECRUIT_PREFIX}extend-post:${id}:${until ?? ''}`, 1),
              choice("Don't post", `${RECRUIT_PREFIX}extend-nopost:${id}`)
            ]
          }
        ]
      });
    }
    case 'not_joining':
      return finish(deps, i, { content: NOT_JOINING(after.nameRealm) });
  }
}

// Posts in the applicant's ticket, when there is one. Best effort: the
// record is already saved.
async function post(deps: RecruitDeps, channelId: string | null, content: string) {
  if (!channelId) return;
  await deps
    .discord('POST', `/channels/${channelId}/messages`, { content, allowed_mentions: { parse: [] } })
    .catch(() => null);
}

// The card (or trial message) says what happened and greys the used buttons.
// The note button stays: notes go on after a decision too.
async function markDone(
  deps: RecruitDeps,
  channelId: string,
  messageId: string,
  action: RecruitAction,
  presser: string
) {
  const got = await deps.discord('GET', `/channels/${channelId}/messages/${messageId}`);
  if (!got.ok) return;
  const message = got.body ?? {};
  const grey = new Set(GREYS[action]);
  const components = (message.components ?? []).map((row: any) => ({
    ...row,
    components: (row.components ?? []).map((c: any) => {
      const what = typeof c.custom_id === 'string' ? c.custom_id.split(':')[1] : null;
      return what && grey.has(what) ? { ...c, disabled: true } : c;
    })
  }));
  const line = `**${DONE[action]}** by <@${presser}>, ${shortDate(deps.now())}`;
  await deps.discord('PATCH', `/channels/${channelId}/messages/${messageId}`, {
    content: [message.content, line].filter(Boolean).join('\n'),
    components,
    allowed_mentions: { parse: [] }
  });
}

// The officer's follow-up after a decline: a short DM to the applicant, or
// not. Only while the record is still declined.
async function afterDecline(deps: RecruitDeps, i: Interaction, id: number, send: boolean) {
  const r = await deps.db.recruit(id);
  if (!r) return finish(deps, i, { content: GONE, components: [] });
  if (!send || r.status !== 'declined' || !r.applicantDiscordId) {
    return finish(deps, i, { content: NOT_SENT, components: [] });
  }
  const dm = await deps.discord('POST', '/users/@me/channels', { recipient_id: r.applicantDiscordId });
  const sent = dm.ok
    ? await deps.discord('POST', `/channels/${dm.body?.id}/messages`, {
        content: DECLINE_DM(r.teamName),
        allowed_mentions: { parse: [] }
      })
    : dm;
  return finish(deps, i, {
    content: sent.ok ? DM_SENT : sent.body?.code === 50007 ? DM_CLOSED : BROKE,
    components: []
  });
}

// After an extension: post the new end date in the ticket, or not. Only
// while they're still on trial.
async function afterExtend(deps: RecruitDeps, i: Interaction, id: number, until: string | null) {
  const r = await deps.db.recruit(id);
  if (!r) return finish(deps, i, { content: GONE, components: [] });
  if (!until || !/^\d{4}-\d{2}-\d{2}$/.test(until) || r.status !== 'on_trial') {
    return finish(deps, i, { content: NOT_SENT, components: [] });
  }
  if (!r.ticketChannelId) return finish(deps, i, { content: NO_TICKET, components: [] });
  await post(deps, r.ticketChannelId, `Your trial with ${r.teamName} is extended to ${dateOnly(until)}.`);
  return finish(deps, i, { content: POSTED, components: [] });
}
