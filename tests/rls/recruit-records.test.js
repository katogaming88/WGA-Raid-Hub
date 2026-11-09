// #1539: recruit records. SIGNUP_OWNER_T1 is on no team, so they play the
// applicant; RAIDER_T1 plays a recruiter. GUILD_OFFICER is We Go Again's Admin
// and TEAM_LEADER_T3 its Owner.
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  withTxn,
  OFFICER_T1,
  OFFICER_T2,
  RAIDER_T1,
  TEAM_LEADER_T1,
  SITE_ADMIN,
  GUILD_OFFICER,
  SIGNUP_OWNER_T1,
  RLS_DENIED
} from './helpers.js';

afterAll(() => pool.end());

const APPLICANT = SIGNUP_OWNER_T1;
const personOf = async (q, uid) => (await q('select id from public.people where auth_user_id = $1', [uid])).rows[0].id;

// The applicant's character and an open team 1, taking applications.
async function setup(q) {
  // The team row first, the order the functions lock in, so a test file
  // running beside this one waits instead of deadlocking.
  await q('select 1 from public.teams where id = 1 for update');
  const me = await personOf(q, APPLICANT);
  const char = (
    await q(
      `insert into public.characters (person_id, blizzard_id, name, realm, realm_slug, class_name, spec_name, level, item_level)
       values ($1, 990001, 'Katorrí', 'Stormrage', 'stormrage', 'Warlock', 'Demonology', 90, 720) returning id`,
      [me]
    )
  ).rows[0].id;
  await q('update public.team_recruiting set taking_applications = true where team_id = 1');
  return { me, char };
}

const send = (asUser, uid, char, answers, extra = {}) =>
  asUser(uid, 'select public.send_application($1, $2, $3, $4, $5, $6) as id', [
    extra.team ?? 1,
    char,
    JSON.stringify(answers),
    extra.code ?? null,
    extra.friend ?? null,
    extra.tz ?? 'America/New_York'
  ]).then((r) => r.rows[0].id);

// The three starter questions that start required.
const REQUIRED = { about: 'Demo lock, ten years', experience: 'Mythic since Nathria', nights: 'Every week' };

const record = async (asUser, uid, id) => (await asUser(uid, 'select public.recruit_record($1) as r', [id])).rows[0].r;
const recruits = async (asUser, uid, team = 1) =>
  (await asUser(uid, 'select public.team_recruits($1) as r', [team])).rows[0].r;
const note = (asUser, uid, id, body) => asUser(uid, 'select public.add_recruit_note($1, $2)', [id, body]);

describe('recruit records', () => {
  it('an applicant sends one: the character copied, answers with their wording, logged', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { me, char } = await setup(q);
      const id = await send(asUser, APPLICANT, char, {
        ...REQUIRED,
        voice: true,
        log: 'https://www.warcraftlogs.com/x'
      });
      const a = (await q('select * from public.recruit_applications where id = $1', [id])).rows[0];
      expect(a).toMatchObject({
        person_id: me,
        source: 'application',
        status: 'waiting_on_officers',
        name_realm: 'Katorrí-Stormrage',
        class_name: 'Warlock',
        spec_name: 'Demonology',
        item_level: 720,
        sent_by: 'nobody',
        time_zone: 'America/New_York'
      });
      expect(a.answers.map((x) => x.key)).toEqual(['about', 'experience', 'log', 'nights', 'voice']);
      expect(a.answers[0]).toEqual({
        key: 'about',
        label: 'A line about themselves',
        prompt: 'Tell the team about yourself.',
        answer_type: 'short_text',
        answer: 'Demo lock, ten years'
      });
      // A later gear change doesn't rewrite the copy.
      await q('update public.characters set item_level = 730 where id = $1', [char]);
      expect((await record(asUser, OFFICER_T1, id)).item_level).toBe(720);
      expect((await q('select kind from public.recruit_events where application_id = $1', [id])).rows).toEqual([
        { kind: 'applied' }
      ]);
      expect(
        (
          await q(
            "select count(*)::int as n from public.audit_log where action = 'Application Sent' and target_id = $1",
            [id]
          )
        ).rows[0].n
      ).toBe(1);

      // One open at a time; withdrawn, they can send again.
      await expect(send(asUser, APPLICANT, char, REQUIRED)).rejects.toThrow('already have an open application');
      await asUser(APPLICANT, 'select public.withdraw_application($1)', [id]);
      const mine = (await asUser(APPLICANT, 'select public.my_applications() as m')).rows[0].m;
      expect(mine[0]).toMatchObject({ id, status: 'withdrawn', team_name: 'Team Phoenix' });
      expect(mine[0]).not.toHaveProperty('notes');
      await send(asUser, APPLICANT, char, REQUIRED);
    });
  });

  it('refuses a send the team, the character or the answers don’t allow', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { char } = await setup(q);
      const bad = (answers, msg, extra) => expect(send(asUser, APPLICANT, char, answers, extra)).rejects.toThrow(msg);
      await bad({ about: 'x', experience: 'x' }, 'Please answer');
      await bad({ ...REQUIRED, nights: 'Sometimes' }, 'not one of the choices');
      await bad({ ...REQUIRED, about: 'x'.repeat(101) }, 'over 100 characters');
      await bad({ ...REQUIRED, log: 'warcraftlogs.com' }, 'must be a link');
      await bad({ ...REQUIRED, voice: 'yes' }, 'yes or no');
      await bad({ ...REQUIRED, goals: 'Cutting Edge' }, 'not on this form'); // goals starts off
      await bad({ ...REQUIRED, 999: 'x' }, 'not on this form');
      await bad(REQUIRED, 'not a time zone', { tz: 'Mars/Olympus' });
      await bad(REQUIRED, 'not both', { code: 'abcdefgh', friend: 'Bob' });
      await bad(REQUIRED, "isn't active", { code: 'abcdefgh' });
      await expect(send(asUser, RAIDER_T1, char, REQUIRED)).rejects.toThrow('not one of yours');
      await expect(send(asUser, null, char, REQUIRED)).rejects.toThrow('Not signed in');

      // A picture only from the applicant's own folder, and only one uploaded.
      await q("insert into public.team_application_starters values (1, 'ui', true, false)");
      const uid = APPLICANT;
      await bad({ ...REQUIRED, ui: `1/${uid}/ui.png` }, 'not one you uploaded');
      await q(`insert into storage.objects (bucket_id, name) values ('application-pictures', $1)`, [
        `1/${RAIDER_T1}/ui.png`
      ]);
      await bad({ ...REQUIRED, ui: `1/${RAIDER_T1}/ui.png` }, 'not one you uploaded');

      await q(
        "update public.team_recruiting set join_method = 'discord_ticket', ticket_link = 'https://discord.gg/x' where team_id = 1"
      );
      await bad(REQUIRED, "isn't taking applications");
      await q(
        "update public.team_recruiting set join_method = 'application', taking_applications = false where team_id = 1"
      );
      await bad(REQUIRED, "isn't taking applications");
      await q('update public.team_recruiting set taking_applications = true where team_id = 1');
      await q('update public.teams set archived_at = now() where id = 1');
      await bad(REQUIRED, "isn't taking applications");
    });
  });

  it('credits a recruiter by a code the server checks, keeping the code and name; or a friend', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { char } = await setup(q);
      const raider = await personOf(q, RAIDER_T1);
      await q(
        "insert into public.names (team_id, label, team_member_id) select 1, 'Katorri', id from public.team_members where team_id = 1 and person_id = $1",
        [raider]
      );
      const code = (
        await q('insert into public.guild_recruiters (guild_id, person_id) values (1, $1) returning code', [raider])
      ).rows[0].code;
      const id = await send(asUser, APPLICANT, char, REQUIRED, { code: code.toUpperCase() });
      expect(
        (
          await q(
            'select sent_by, recruiter_person_id, recruiter_code, sent_by_name from public.recruit_applications where id = $1',
            [id]
          )
        ).rows[0]
      ).toEqual({ sent_by: 'recruiter', recruiter_person_id: raider, recruiter_code: code, sent_by_name: 'Katorri' });

      // The recruiter's view: the short record and only their own notes.
      await note(asUser, OFFICER_T1, id, 'Officer only');
      await note(asUser, RAIDER_T1, id, 'Good player, I raided with them');
      const r = await record(asUser, RAIDER_T1, id);
      expect(r).toMatchObject({ access: 'recruiter', status: 'waiting_on_officers', team_name: 'Team Phoenix' });
      expect(r.notes.map((n) => n.body)).toEqual(['Good player, I raided with them']);
      expect(r).not.toHaveProperty('answers');
      expect((await asUser(RAIDER_T1, 'select public.my_recruits() as m')).rows[0].m).toHaveLength(1);
      await expect(recruits(asUser, RAIDER_T1)).rejects.toThrow('Not authorized');

      // Switched off: the link no longer credits anyone.
      await q('update public.guild_recruiters set active = false where person_id = $1', [raider]);
      await asUser(APPLICANT, 'select public.withdraw_application($1)', [id]);
      await expect(send(asUser, APPLICANT, char, REQUIRED, { code })).rejects.toThrow("isn't active");
      const friend = await send(asUser, APPLICANT, char, REQUIRED, { friend: '  Bob  ' });
      expect(
        (await q('select sent_by, sent_by_name from public.recruit_applications where id = $1', [friend])).rows[0]
      ).toEqual({
        sent_by: 'friend',
        sent_by_name: 'Bob'
      });
    });
  });

  it('only the team’s people read its records; the applicant never reads notes', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { char } = await setup(q);
      const id = await send(asUser, APPLICANT, char, REQUIRED);
      await note(asUser, OFFICER_T1, id, 'Strong logs');

      const full = await record(asUser, TEAM_LEADER_T1, id);
      expect(full).toMatchObject({ access: 'manage', name_realm: 'Katorrí-Stormrage' });
      expect(full.notes).toMatchObject([{ body: 'Strong logs', source: 'site', mine: false }]);
      expect(full.events.map((e) => e.kind)).toEqual(['applied', 'note_added']);
      expect((await recruits(asUser, OFFICER_T1)).recruits.map((x) => x.id)).toEqual([id]);
      expect((await record(asUser, SITE_ADMIN, id)).access).toBe('manage');

      // The applicant, a raider and another team's officer: nothing.
      for (const uid of [APPLICANT, RAIDER_T1, OFFICER_T2]) {
        await expect(record(asUser, uid, id)).rejects.toThrow('Not authorized');
        await expect(recruits(asUser, uid)).rejects.toThrow('Not authorized');
        await expect(note(asUser, uid, id, 'x')).rejects.toThrow('Not authorized');
      }
      await expect(record(asUser, null, id)).rejects.toThrow('Not signed in');
      await expect(record(asUser, SITE_ADMIN, 999999)).rejects.toThrow('does not exist');

      // Nobody reads the tables directly.
      for (const t of [
        'recruit_applications',
        'recruit_notes',
        'recruit_events',
        'recruit_messages',
        'recruit_reminders_sent'
      ]) {
        await expect(asUser(OFFICER_T1, `select * from public.${t}`)).rejects.toMatchObject({ code: RLS_DENIED });
      }
    });
  });

  it('assistants add notes and Admins read, each only when the team’s settings let them', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { char } = await setup(q);
      const id = await send(asUser, APPLICANT, char, REQUIRED);
      await q("update public.team_members set rank = 'assistant' where team_id = 1 and person_id = $1", [
        await personOf(q, RAIDER_T1)
      ]);
      await expect(record(asUser, RAIDER_T1, id)).rejects.toThrow('Not authorized');
      await q('update public.team_recruiting set visible_to_team_assistants = true where team_id = 1');
      expect((await record(asUser, RAIDER_T1, id)).access).toBe('note');
      await note(asUser, RAIDER_T1, id, 'Seen them in keys');
      await expect(asUser(RAIDER_T1, "select public.close_recruit($1, 'declined', null)", [id])).rejects.toThrow(
        'Not authorized'
      );

      // The Admin reads every team by "see every team"; without it, only when
      // the team lets the Owner and Admins see.
      expect((await recruits(asUser, GUILD_OFFICER)).access).toBe('read');
      await q(
        "delete from public.guild_rank_permissions where guild_id = 1 and rank = 'admin' and permission = 'view_every_team'"
      );
      await expect(recruits(asUser, GUILD_OFFICER)).rejects.toThrow('Not authorized');
      await q('update public.team_recruiting set visible_to_guild_admins = true where team_id = 1');
      expect((await record(asUser, GUILD_OFFICER, id)).access).toBe('read');
      await expect(note(asUser, GUILD_OFFICER, id, 'x')).rejects.toThrow('Not authorized');
    });
  });

  it('whose turn follows the last message; officers decline and reopen; trials and other open ones are refused', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { char } = await setup(q);
      const id = await send(asUser, APPLICANT, char, REQUIRED);
      const status = async () =>
        (await q('select status from public.recruit_applications where id = $1', [id])).rows[0].status;
      await q('update public.recruit_applications set officers_last_message_at = now() where id = $1', [id]);
      expect(await status()).toBe('waiting_on_applicant');
      await q(
        "update public.recruit_applications set applicant_last_message_at = now() + interval '1 minute' where id = $1",
        [id]
      );
      expect(await status()).toBe('waiting_on_officers');

      await asUser(OFFICER_T1, "select public.close_recruit($1, 'declined', 'Full on locks')", [id]);
      expect(await status()).toBe('declined');
      expect((await record(asUser, OFFICER_T1, id)).events.at(-1)).toMatchObject({
        kind: 'declined',
        detail: 'Full on locks'
      });
      await expect(asUser(OFFICER_T1, "select public.close_recruit($1, 'no_reply', null)", [id])).rejects.toThrow(
        'already closed'
      );
      await expect(asUser(APPLICANT, 'select public.withdraw_application($1)', [id])).rejects.toThrow('already closed');

      // The applicant's own view after a decline: no reason, no notes.
      const mine = (await asUser(APPLICANT, 'select public.my_applications() as m')).rows[0].m[0];
      expect(Object.keys(mine)).not.toContain('events');

      await asUser(OFFICER_T1, 'select public.reopen_recruit($1)', [id]);
      expect(await status()).toBe('waiting_on_officers');
      await asUser(OFFICER_T1, "select public.close_recruit($1, 'no_reply', null)", [id]);
      const again = await send(asUser, APPLICANT, char, REQUIRED);
      await expect(asUser(OFFICER_T1, 'select public.reopen_recruit($1)', [id])).rejects.toThrow(
        'another open application'
      );
      expect((await record(asUser, OFFICER_T1, again)).applied_before).toMatchObject([
        { status: 'no_reply', team_name: 'Team Phoenix' }
      ]);

      await q(
        "update public.recruit_applications set status = 'on_trial', trial_starts_on = current_date, trial_ends_on = current_date + 14 where id = $1",
        [again]
      );
      await expect(asUser(OFFICER_T1, "select public.close_recruit($1, 'declined', null)", [again])).rejects.toThrow(
        'on trial'
      );
      await expect(asUser(APPLICANT, 'select public.withdraw_application($1)', [again])).rejects.toThrow('on trial');
      await expect(asUser(OFFICER_T1, "select public.close_recruit($1, 'joined', null)", [again])).rejects.toThrow(
        'declined or no_reply'
      );
    });
  });

  it('an officer adds a ticket-only recruit by character, tied to a Discord id when given', async () => {
    await withTxn(async ({ q, asUser }) => {
      const id = (
        await asUser(OFFICER_T1, "select public.add_recruit(1, 'Thrall-Stormrage', '123456789012345678') as id")
      ).rows[0].id;
      const r = await record(asUser, OFFICER_T1, id);
      expect(r).toMatchObject({
        source: 'added_by_officer',
        status: 'waiting_on_officers',
        name_realm: 'Thrall-Stormrage'
      });
      await expect(
        asUser(OFFICER_T1, "select public.add_recruit(1, 'Thrall-Stormrage', '123456789012345678')")
      ).rejects.toThrow('already has an open application');
      await asUser(OFFICER_T1, "select public.add_recruit(1, 'Jaina-Stormrage', null)");
      await expect(asUser(OFFICER_T1, "select public.add_recruit(1, 'Jaina', null)")).rejects.toThrow('name_realm');
      await expect(asUser(OFFICER_T2, "select public.add_recruit(1, 'Jaina-Stormrage', null)")).rejects.toThrow(
        'Not authorized'
      );
      expect(
        (await q("select count(*)::int as n from public.audit_log where action = 'Recruit Added'")).rows[0].n
      ).toBe(2);
    });
  });

  it('the bot acts as the Discord user who pressed the button, with the service key only', async () => {
    await withTxn(async ({ q, asUser, asRole }) => {
      const { char } = await setup(q);
      const id = await send(asUser, APPLICANT, char, REQUIRED);
      const bot = asRole('service_role', null);
      await bot("select public.bot_add_recruit_note($1, 'discord-officer-1', 'From the ticket')", [id]);
      await bot("select public.bot_close_recruit($1, 'discord-officer-1', 'declined', 'Not a fit')", [id]);
      await bot("select public.bot_reopen_recruit($1, 'discord-officer-1')", [id]);
      const r = await record(asUser, OFFICER_T1, id);
      expect(r.notes).toMatchObject([{ body: 'From the ticket', source: 'discord' }]);
      expect(r.events.map((e) => [e.kind, e.actor])).toEqual([
        ['applied', expect.anything()],
        ['note_added', expect.anything()],
        ['declined', expect.anything()],
        ['reopened', expect.anything()]
      ]);
      expect(
        (await q("select actor_id from public.audit_log where action = 'Recruit Declined' and target_id = $1", [id]))
          .rows
      ).toEqual([{ actor_id: OFFICER_T1 }]);
      await expect(bot("select public.bot_add_recruit_note($1, 'nobody-here', 'x')", [id])).rejects.toThrow(
        'Discord id'
      );

      // The bot's own bookkeeping goes straight into the tables.
      await bot(
        `insert into public.recruit_messages (application_id, discord_message_id, author_discord_id, author_name, body, attachments, sent_at)
         values ($1, '111111111111111111', null, 'Katorrí', 'Hi!', '[{"name": "ui.png", "content_type": "image/png"}]', now())`,
        [id]
      );
      await bot(
        "insert into public.recruit_reminders_sent (application_id, reminder, due_for) values ($1, 'ping_officers', now())",
        [id]
      );
      expect((await record(asUser, OFFICER_T1, id)).messages).toMatchObject([
        { author_name: 'Katorrí', body: 'Hi!', attachments: [{ name: 'ui.png' }] }
      ]);

      // Nobody signed in calls the bot's versions.
      await expect(
        asUser(OFFICER_T1, "select public.bot_add_recruit_note($1, 'discord-officer-1', 'x')", [id])
      ).rejects.toMatchObject({ code: RLS_DENIED });
    });
  });

  it('application pictures follow the records: an assistant sees them once the team lets them', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q(`insert into storage.objects (bucket_id, name) values ('application-pictures', $1)`, [
        `1/${APPLICANT}/ui.png`
      ]);
      const sees = async (uid) =>
        (await asUser(uid, "select name from storage.objects where bucket_id = 'application-pictures'")).rows.length;
      expect(await sees(APPLICANT)).toBe(1);
      expect(await sees(OFFICER_T1)).toBe(1);
      expect(await sees(OFFICER_T2)).toBe(0);
      await q("update public.team_members set rank = 'assistant' where team_id = 1 and person_id = $1", [
        await personOf(q, RAIDER_T1)
      ]);
      expect(await sees(RAIDER_T1)).toBe(0);
      await q('update public.team_recruiting set visible_to_team_assistants = true where team_id = 1');
      expect(await sees(RAIDER_T1)).toBe(1);
    });
  });
});
