// #1544: the sweep's No reply close and the ticket's saved conversation.
// SIGNUP_OWNER_T1 plays the applicant, as in recruit-records.test.js.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, OFFICER_T1, SIGNUP_OWNER_T1, RLS_DENIED } from './helpers.js';

afterAll(() => pool.end());

const APPLICANT = SIGNUP_OWNER_T1;

async function sent(q, asUser) {
  await q('select 1 from public.teams where id = 1 for update');
  const me = (await q('select id from public.people where auth_user_id = $1', [APPLICANT])).rows[0].id;
  const char = (
    await q(
      `insert into public.characters (person_id, blizzard_id, name, realm, realm_slug, class_name, spec_name, level, item_level)
       values ($1, 990011, 'Katorrí', 'Stormrage', 'stormrage', 'Warlock', 'Demonology', 90, 720) returning id`,
      [me]
    )
  ).rows[0].id;
  await q('update public.team_recruiting set taking_applications = true where team_id = 1');
  const answers = { about: 'Demo lock', experience: 'Mythic', nights: 'Every week' };
  return (
    await asUser(APPLICANT, 'select public.send_application(1, $1, $2, null, null, $3) as id', [
      char,
      JSON.stringify(answers),
      'America/New_York'
    ])
  ).rows[0].id;
}

describe('closing a recruit ticket (#1544)', () => {
  it('closes as No reply only while it is the applicant’s turn, with no actor', async () => {
    await withTxn(async ({ q, asUser, asRole }) => {
      const id = await sent(q, asUser);
      const bot = asRole('service_role', null);
      const close = async () => (await bot('select public.bot_close_no_reply($1) as ok', [id])).rows[0].ok;

      // The officers' turn: not closed.
      expect(await close()).toBe(false);

      await bot(
        "update public.recruit_applications set officers_last_message_at = now() - interval '6 days' where id = $1",
        [id]
      );
      expect(await close()).toBe(true);
      const a = (await q('select status, closed_at from public.recruit_applications where id = $1', [id])).rows[0];
      expect(a.status).toBe('no_reply');
      expect(a.closed_at).not.toBeNull();
      expect(
        (
          await q(
            "select kind, actor_person_id, detail from public.recruit_events where application_id = $1 and kind = 'closed'",
            [id]
          )
        ).rows
      ).toEqual([{ kind: 'closed', actor_person_id: null, detail: 'No reply' }]);
      expect(
        (await q("select actor_id from public.audit_log where action = 'Recruit Closed' and target_id = $1", [id])).rows
      ).toEqual([{ actor_id: null }]);

      // Already closed: nothing again.
      expect(await close()).toBe(false);
      expect(await bot('select public.bot_close_no_reply(999999) as ok').then((r) => r.rows[0].ok)).toBe(false);
    });
  });

  it('keeps the bot’s progress on the record and the thread’s messages apart', async () => {
    await withTxn(async ({ q, asUser, asRole }) => {
      const id = await sent(q, asUser);
      const bot = asRole('service_role', null);
      await bot(
        `update public.recruit_applications
            set ticket_closed_at = now(), ticket_saved_at = now(), ticket_save_failures = 2 where id = $1`,
        [id]
      );
      await bot(
        `insert into public.recruit_messages (application_id, discord_message_id, author_name, body, sent_at, in_officer_thread)
         values ($1, '111111111111111111', 'Katorrí', 'In the ticket', now() - interval '1 minute', false),
                ($1, '111111111111111112', 'Officer', 'Officers only', now(), true)`,
        [id]
      );
      const r = (await asUser(OFFICER_T1, 'select public.recruit_record($1) as r', [id])).rows[0].r;
      expect(r.messages.map((m) => [m.body, m.in_officer_thread])).toEqual([
        ['In the ticket', false],
        ['Officers only', true]
      ]);
      expect(r.ticket_save_failures).toBe(2);
      expect(r.ticket_closed_at).not.toBeNull();
      await expect(
        bot('update public.recruit_applications set ticket_save_failures = -1 where id = $1', [id])
      ).rejects.toThrow('recruit_applications_ticket_save_failures');
    });
  });

  it('nobody signed in can close a record as No reply', async () => {
    await withTxn(async ({ q, asUser }) => {
      const id = await sent(q, asUser);
      for (const uid of [OFFICER_T1, APPLICANT]) {
        await expect(asUser(uid, 'select public.bot_close_no_reply($1)', [id])).rejects.toMatchObject({
          code: RLS_DENIED
        });
      }
    });
  });
});
