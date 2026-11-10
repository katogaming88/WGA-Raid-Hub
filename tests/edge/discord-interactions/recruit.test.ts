// The recruiting buttons (#1542), Discord and the database stubbed: each
// button and its pop-up, the card saying what happened with its used buttons
// grey, the presser's private refusal (Hellfire's officer on a Phoenix card),
// a repeated press, and the follow-ups after a decline or an extension.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  type ActResult,
  BROKE,
  DECLINE_DM,
  DECLINED,
  DM_CLOSED,
  DM_SENT,
  EXTENDED,
  JOINED,
  NOT_JOINING,
  NOT_JOINING_REASONS,
  NOT_SENT,
  NOTE_SAVED,
  ONLY_OFFICERS,
  POSTED,
  type Recruit,
  type RecruitAction,
  type RecruitDeps,
  STARTED,
  handleRecruit
} from '../../../supabase/functions/discord-interactions/recruit.ts';

const APP = '400000000000000004';
const OFFICER = '700000000000000007';
const APPLICANT = '500000000000000005';
const CHANNEL = '800000000000000008';
const CARD = '900000000000000009';
const TICKET = '810000000000000001';
const DM = '820000000000000002';
const NOW = new Date('2026-11-10T18:00:00Z');

const KAT: Recruit = {
  teamName: 'Phoenix',
  nameRealm: 'Katorrí-Stormrage',
  status: 'waiting_on_officers',
  trialEndsOn: null,
  ticketChannelId: TICKET,
  applicantDiscordId: APPLICANT
};

const CARD_MESSAGE = {
  id: CARD,
  content: `<@${APPLICANT}> <@${OFFICER}>`,
  components: [
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: 'Start a trial', custom_id: 'recruit:trial:7' },
        { type: 2, style: 4, label: 'Decline', custom_id: 'recruit:decline:7' },
        { type: 2, style: 2, label: 'Add note', custom_id: 'recruit:note:7' },
        { type: 2, style: 5, label: 'Open in Raid Hub', url: 'https://raidhub.example/recruits/7' }
      ]
    }
  ]
};

type Call = { method: string; path: string; body: any };

function setup(
  opts: {
    recruit?: Recruit | null;
    after?: Partial<Recruit>;
    result?: ActResult;
    dmCode?: number;
  } = {}
) {
  const calls: Call[] = [];
  const acts: Array<{ action: RecruitAction; id: number; discordId: string; args: unknown }> = [];
  const pending: Promise<unknown>[] = [];
  let acted = false;
  const deps: RecruitDeps = {
    db: {
      recruit: () =>
        Promise.resolve(
          opts.recruit === null ? null : { ...(opts.recruit ?? KAT), ...(acted ? (opts.after ?? {}) : {}) }
        ),
      act: (action, id, discordId, args) => {
        acts.push({ action, id, discordId, args });
        acted = true;
        return Promise.resolve(opts.result ?? { ok: true, value: null });
      }
    },
    discord: (method, path, body) => {
      calls.push({ method, path, body });
      if (method === 'GET') return Promise.resolve({ ok: true, status: 200, body: structuredClone(CARD_MESSAGE) });
      if (path === '/users/@me/channels') return Promise.resolve({ ok: true, status: 200, body: { id: DM } });
      if (path === `/channels/${DM}/messages` && opts.dmCode) {
        return Promise.resolve({ ok: false, status: 403, body: { code: opts.dmCode } });
      }
      return Promise.resolve({ ok: true, status: 200, body: { id: '1' } });
    },
    waitUntil: (work) => pending.push(work),
    now: () => NOW
  };
  return { deps, calls, acts, settle: () => Promise.all(pending) };
}

const press = (customId: string, over: Record<string, unknown> = {}) => ({
  type: 3,
  application_id: APP,
  token: 'tok',
  channel_id: CHANNEL,
  member: { user: { id: OFFICER } },
  message: { id: CARD },
  data: { custom_id: customId },
  ...over
});
const submit = (customId: string, text: string) =>
  press(customId, {
    type: 5,
    data: { custom_id: customId, components: [{ components: [{ custom_id: 'text', value: text }] }] }
  });

const ORIGINAL = `/webhooks/${APP}/tok/messages/@original`;
const answered = (calls: Call[]) => calls.filter((c) => c.path === ORIGINAL).map((c) => c.body.content);
const edit = (calls: Call[]) =>
  calls.find((c) => c.method === 'PATCH' && c.path === `/channels/${CHANNEL}/messages/${CARD}`);
const greyed = (call: Call | undefined) =>
  call!.body.components[0].components.filter((c: any) => c.disabled).map((c: any) => c.custom_id);

Deno.test('Start a trial: thinking first, then the record, the card greyed and the ticket told', async () => {
  const { deps, calls, acts, settle } = setup({ after: { status: 'on_trial', trialEndsOn: '2026-11-24' } });
  const res = handleRecruit(deps, press('recruit:trial:7'))!;
  assertEquals(await res.json(), { type: 5, data: { flags: 64 } });
  assertEquals(calls, []);
  await settle();
  assertEquals(acts, [{ action: 'trial', id: 7, discordId: OFFICER, args: {} }]);
  const card = edit(calls);
  assertEquals(greyed(card), ['recruit:trial:7', 'recruit:decline:7']);
  assert(card!.body.content.endsWith(`**Trial started** by <@${OFFICER}>, Nov 10`));
  assertEquals(card!.body.allowed_mentions, { parse: [] });
  const ticket = calls.find((c) => c.path === `/channels/${TICKET}/messages`);
  assertEquals(ticket!.body.content, STARTED('Katorrí-Stormrage', 'Phoenix', 'Nov 24'));
  assertEquals(answered(calls), [STARTED('Katorrí-Stormrage', 'Phoenix', 'Nov 24')]);
});

Deno.test("Hellfire's officer pressing a Phoenix card is told privately, and nothing changes", async () => {
  const { deps, calls, settle } = setup({ result: { ok: false, refused: true, message: 'Not authorized' } });
  handleRecruit(deps, press('recruit:trial:7'));
  await settle();
  assertEquals(answered(calls), [ONLY_OFFICERS('Phoenix')]);
  assertEquals(edit(calls), undefined);
  assert(!calls.some((c) => c.path.startsWith(`/channels/${TICKET}`)));
});

Deno.test("a Discord account on nobody's profile gets the same refusal", async () => {
  const { deps, calls, settle } = setup({
    result: { ok: false, refused: true, message: 'Nobody on Raid Hub has that Discord id' }
  });
  handleRecruit(deps, press('recruit:joined:7'));
  await settle();
  assertEquals(answered(calls), [ONLY_OFFICERS('Phoenix')]);
});

Deno.test("a second press gets the database's own refusal and changes nothing", async () => {
  const message = "Only an open recruit who isn't on trial can start one";
  const { deps, calls, settle } = setup({ result: { ok: false, refused: true, message } });
  handleRecruit(deps, press('recruit:trial:7'));
  await settle();
  assertEquals(answered(calls), [message]);
  assertEquals(edit(calls), undefined);
});

Deno.test('a failure that is not a refusal says try again, without the database error', async () => {
  const { deps, calls, settle } = setup({ result: { ok: false, refused: false, message: 'connection reset' } });
  handleRecruit(deps, press('recruit:trial:7'));
  await settle();
  assertEquals(answered(calls), [BROKE]);
});

Deno.test('Decline opens a pop-up before any read; sending it declines and offers the message', async () => {
  const { deps, calls, acts, settle } = setup({ after: { status: 'declined' } });
  const pop = await handleRecruit(deps, press('recruit:decline:7'))!.json();
  assertEquals(pop.type, 9);
  assertEquals(pop.data.custom_id, 'recruit:m-decline:7');
  assertEquals(pop.data.components[0].components[0].required, true);
  assertEquals(acts, []);

  handleRecruit(deps, submit('recruit:m-decline:7', 'Not the spec we need'));
  await settle();
  assertEquals(acts, [{ action: 'decline', id: 7, discordId: OFFICER, args: { reason: 'Not the spec we need' } }]);
  assertEquals(greyed(edit(calls)), ['recruit:trial:7', 'recruit:decline:7']);
  const offer = calls.filter((c) => c.path === ORIGINAL).at(-1)!.body;
  assertEquals(offer.content, DECLINED('Katorrí-Stormrage'));
  assertEquals(
    offer.components[0].components.map((c: any) => c.custom_id),
    ['recruit:decline-dm:7', 'recruit:decline-nodm:7']
  );
});

Deno.test("after a decline: Send message DMs the applicant, closed DMs say so, Don't send sends nothing", async () => {
  let r = setup({ recruit: { ...KAT, status: 'declined' } });
  assertEquals((await handleRecruit(r.deps, press('recruit:decline-dm:7'))!.json()).type, 6);
  await r.settle();
  const dm = r.calls.find((c) => c.path === `/channels/${DM}/messages`);
  assertEquals(dm!.body.content, DECLINE_DM('Phoenix'));
  assertEquals(r.calls.find((c) => c.path === '/users/@me/channels')!.body, { recipient_id: APPLICANT });
  assertEquals(answered(r.calls), [DM_SENT]);

  r = setup({ recruit: { ...KAT, status: 'declined' }, dmCode: 50007 });
  handleRecruit(r.deps, press('recruit:decline-dm:7'));
  await r.settle();
  assertEquals(answered(r.calls), [DM_CLOSED]);

  r = setup({ recruit: { ...KAT, status: 'declined' } });
  handleRecruit(r.deps, press('recruit:decline-nodm:7'));
  await r.settle();
  assertEquals(answered(r.calls), [NOT_SENT]);
  assert(!r.calls.some((c) => c.path === '/users/@me/channels'));
});

Deno.test('Send message after the record moved on (reopened) sends nothing', async () => {
  const { deps, calls, settle } = setup({ recruit: { ...KAT, status: 'waiting_on_officers' } });
  handleRecruit(deps, press('recruit:decline-dm:7'));
  await settle();
  assertEquals(answered(calls), [NOT_SENT]);
  assert(!calls.some((c) => c.path === '/users/@me/channels'));
});

Deno.test('Add note: a pop-up, then saved as a note, the card left as it was', async () => {
  const { deps, calls, acts, settle } = setup();
  const pop = await handleRecruit(deps, press('recruit:note:7'))!.json();
  assertEquals(pop.data.custom_id, 'recruit:m-note:7');
  handleRecruit(deps, submit('recruit:m-note:7', 'Great in voice'));
  await settle();
  assertEquals(acts, [{ action: 'note', id: 7, discordId: OFFICER, args: { reason: 'Great in voice' } }]);
  assertEquals(edit(calls), undefined);
  assertEquals(answered(calls), [NOTE_SAVED]);
});

Deno.test('Extend trial: a required reason, the new date, and posting it in the ticket only if asked', async () => {
  const { deps, calls, acts, settle } = setup({
    recruit: { ...KAT, status: 'on_trial', trialEndsOn: '2026-11-24' },
    result: { ok: true, value: '2026-12-08' }
  });
  const pop = await handleRecruit(deps, press('recruit:extend:7'))!.json();
  assertEquals(pop.data.custom_id, 'recruit:m-extend:7');
  assertEquals(pop.data.components[0].components[0].required, true);
  handleRecruit(deps, submit('recruit:m-extend:7', 'Missed a week for travel'));
  await settle();
  assertEquals(acts[0].args, { reason: 'Missed a week for travel' });
  const offer = calls.filter((c) => c.path === ORIGINAL).at(-1)!.body;
  assertEquals(offer.content, EXTENDED('Dec 8'));
  assertEquals(offer.components[0].components[0].custom_id, 'recruit:extend-post:7:2026-12-08');
  // The trial message keeps its buttons: the trial goes on.
  assertEquals(greyed(edit(calls)), []);
  assert(!calls.some((c) => c.path === `/channels/${TICKET}/messages`));

  handleRecruit(deps, press('recruit:extend-post:7:2026-12-08'));
  await settle();
  const posted = calls.find((c) => c.path === `/channels/${TICKET}/messages`);
  assertEquals(posted!.body.content, 'Your trial with Phoenix is extended to Dec 8.');
  assertEquals(answered(calls).at(-1), POSTED);
});

Deno.test('Not joining: the reason list, then an optional pop-up, then the record and the trial message', async () => {
  const { deps, calls, acts, settle } = setup({ recruit: { ...KAT, status: 'on_trial' } });
  const list = await handleRecruit(deps, press('recruit:notjoining:7'))!.json();
  assertEquals(list.data.flags, 64);
  const menu = list.data.components[0].components[0];
  assertEquals(menu.custom_id, `recruit:nj-reason:7:${CARD}`);
  assertEquals(menu.options, NOT_JOINING_REASONS);

  // The pick comes from the reason list, which is another message.
  const pop = await handleRecruit(
    deps,
    press(`recruit:nj-reason:7:${CARD}`, {
      message: { id: 'list' },
      data: { custom_id: `recruit:nj-reason:7:${CARD}`, values: ['schedule_conflict'] }
    })
  )!.json();
  assertEquals(pop.data.custom_id, `recruit:m-nj:7:schedule_conflict:${CARD}`);
  assertEquals(pop.data.components[0].components[0].required, false);

  handleRecruit(deps, { ...submit(`recruit:m-nj:7:schedule_conflict:${CARD}`, ''), message: { id: 'list' } });
  await settle();
  assertEquals(acts, [
    { action: 'not_joining', id: 7, discordId: OFFICER, args: { reason: 'schedule_conflict', detail: '' } }
  ]);
  assertEquals(calls.find((c) => c.method === 'GET')!.path, `/channels/${CHANNEL}/messages/${CARD}`);
  assertEquals(answered(calls), [NOT_JOINING('Katorrí-Stormrage')]);
});

Deno.test('a made-up reason never reaches the database', async () => {
  const { deps, acts } = setup();
  const res = await handleRecruit(
    deps,
    press('recruit:nj-reason:7:1', { data: { custom_id: 'recruit:nj-reason:7:1', values: ['just_because'] } })
  )!.json();
  assertEquals(res.data.content, BROKE);
  assertEquals(acts, []);
});

Deno.test('Joined: the record, the trial message greyed, a welcome in the ticket', async () => {
  const { deps, calls, acts, settle } = setup({ recruit: { ...KAT, status: 'on_trial' } });
  handleRecruit(deps, press('recruit:joined:7'));
  await settle();
  assertEquals(acts[0].action, 'joined');
  assertEquals(
    calls.find((c) => c.path === `/channels/${TICKET}/messages`)!.body.content,
    'Welcome to Phoenix, Katorrí!'
  );
  assertEquals(answered(calls), [JOINED('Katorrí-Stormrage', 'Phoenix')]);
});

Deno.test('a press that is not a recruiting one is left to the rest of the handler', () => {
  const { deps } = setup();
  assertEquals(handleRecruit(deps, press('signup-sheet-refresh:1:2026-11-12')), null);
});
