// #1536: a team's application questions, changed by its officers through
// functions, read by applicants through one more, and the picture answers'
// Storage bucket.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, OFFICER_T1, OFFICER_T2, RAIDER_T1, TEAM_LEADER_T1, SITE_ADMIN, RLS_DENIED } from './helpers.js';

afterAll(() => pool.end());

const list = async (asUser, uid, team = 1) =>
  (await asUser(uid, 'select public.team_application_questions($1) as l', [team])).rows[0].l;
const form = async (asUser, uid, team = 1) =>
  (await asUser(uid, 'select public.team_application_form($1) as f', [team])).rows[0].f;
const save = (asUser, uid, starters, questions, team = 1) =>
  asUser(uid, 'select public.save_team_application_questions($1, $2, $3)', [
    team,
    JSON.stringify(starters),
    JSON.stringify(questions)
  ]);
const openTeam = (asUser, team = 1) =>
  asUser(OFFICER_T1, 'select public.save_team_recruiting($1, $2)', [team, '{"taking_applications": true}']);
const audits = async (q, team = 1) =>
  (
    await q("select detail from public.audit_log where team_id = $1 and action = 'Recruiting Questions Changed'", [
      team
    ])
  ).rows;
const starter = (l, key) => l.starters.find((s) => s.key === key);
const upload = (asUser, uid, name) =>
  asUser(uid, "insert into storage.objects (bucket_id, name) values ('application-pictures', $1)", [name]);

describe('application questions', () => {
  it('every team starts with the starter questions at their defaults and none of its own', async () => {
    await withTxn(async ({ asUser }) => {
      const l = await list(asUser, OFFICER_T1);
      expect(l.starters.map((s) => s.key)).toEqual([
        'about',
        'why',
        'other',
        'experience',
        'guild',
        'goals',
        'log',
        'nights',
        'voice',
        'ui',
        'computer',
        'sent_by'
      ]);
      expect(starter(l, 'about')).toMatchObject({ on: true, required: true, answer_type: 'short_text', max_length: 100 });
      expect(starter(l, 'goals')).toMatchObject({ on: false, required: false });
      expect(starter(l, 'nights')).toMatchObject({
        prompt: 'Can you make {raid nights}?',
        choices: ['Every week', 'Most weeks', 'Not really']
      });
      expect(l.questions).toEqual([]);
    });
  });

  it('an Officer switches starters and keeps its own questions, ids fixed, logged once', async () => {
    await withTxn(async ({ q, asUser }) => {
      await save(
        asUser,
        OFFICER_T1,
        { goals: { on: true, required: true }, voice: { on: false, required: false } },
        [
          { label: 'Off-spec', prompt: 'OK swapping to an off-spec for some fights?', answer_type: 'yes_no' },
          { label: 'Main', prompt: 'Your main spec?', answer_type: 'short_text', max_length: 50, required: true }
        ]
      );
      let l = await list(asUser, OFFICER_T1);
      expect(starter(l, 'goals')).toMatchObject({ on: true, required: true });
      expect(starter(l, 'voice')).toMatchObject({ on: false });
      expect(starter(l, 'about')).toMatchObject({ on: true, required: true });
      const [offspec, main] = l.questions;
      expect(main).toMatchObject({ label: 'Main', max_length: 50, required: true });

      // Reorder, reword one, drop none: ids stay. The Team Owner can too.
      await save(asUser, TEAM_LEADER_T1, {}, [
        { id: main.id, label: 'Main', prompt: 'Your main spec?', answer_type: 'short_text', max_length: 50, required: true },
        { id: offspec.id, label: 'Off-spec', prompt: 'Happy on an off-spec?', answer_type: 'yes_no' }
      ]);
      l = await list(asUser, OFFICER_T1);
      expect(l.questions.map((x) => x.id)).toEqual([main.id, offspec.id]);
      expect(l.questions[1].prompt).toBe('Happy on an off-spec?');
      expect(starter(l, 'goals')).toMatchObject({ on: true, required: true });

      // Back to a default keeps no row; the same save again logs nothing.
      await save(asUser, OFFICER_T1, { goals: { on: false, required: false } }, [{ ...l.questions[0] }]);
      expect((await q('select count(*)::int as n from public.team_application_starters where team_id = 1')).rows[0].n).toBe(
        1
      );
      await save(asUser, OFFICER_T1, { goals: { on: false, required: false } }, [{ ...l.questions[0] }]);
      expect(await audits(q)).toHaveLength(3);
    });
  });

  it('only the team’s officers read or save its questions', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(list(asUser, RAIDER_T1)).rejects.toThrow('Not authorized');
      await expect(list(asUser, OFFICER_T2)).rejects.toThrow('Not authorized');
      await expect(save(asUser, RAIDER_T1, {}, [])).rejects.toThrow('Not authorized');
      await expect(save(asUser, OFFICER_T2, {}, [])).rejects.toThrow('Not authorized');
      await expect(list(asUser, null)).rejects.toThrow();
      expect((await list(asUser, SITE_ADMIN, 2)).starters).toHaveLength(12);
    });
  });

  it('refuses what the limits and types don’t allow', async () => {
    await withTxn(async ({ asUser }) => {
      const bad = async (starters, questions, msg) =>
        expect(save(asUser, OFFICER_T1, starters, questions)).rejects.toThrow(msg);
      await bad({ nope: { on: true, required: false } }, [], 'not a starter question');
      await bad({ goals: { on: false, required: true } }, [], "can't be required");
      await bad({ goals: { on: 'yes', required: false } }, [], 'true or false');
      const q = { label: 'Q', prompt: 'Q?' };
      await bad({}, [{ ...q, answer_type: 'recruiter' }], 'answer_type');
      await bad({}, [{ ...q, answer_type: 'choice', choices: ['Only one'] }], 'choices');
      await bad({}, [{ ...q, answer_type: 'short_text' }], 'max_length');
      await bad({}, [{ ...q, answer_type: 'short_text', max_length: 201 }], 'max_length');
      await bad({}, [{ ...q, answer_type: 'yes_no', max_length: 10 }], 'max_length');
      await bad({}, [{ ...q, label: 'x'.repeat(41), answer_type: 'link' }], 'label');
      await bad({}, [{ ...q, answer_type: 'link', colour: 'red' }], 'has only');
      await bad({}, Array.from({ length: 21 }, () => ({ ...q, answer_type: 'link' })), 'at most 20');
      // Another team's question id is not this team's to change.
      await save(asUser, OFFICER_T2, {}, [{ ...q, answer_type: 'link' }], 2);
      const other = (await list(asUser, OFFICER_T2, 2)).questions[0].id;
      await bad({}, [{ ...q, id: other, answer_type: 'link' }], "not one of this team's");
    });
  });

  it('anyone signed in reads the form only while the team takes applications, and only what is on', async () => {
    await withTxn(async ({ asUser }) => {
      await save(asUser, OFFICER_T1, { voice: { on: false, required: false } }, [
        { label: 'Off-spec', prompt: 'Off-spec at {team}?', answer_type: 'yes_no' }
      ]);
      await expect(form(asUser, OFFICER_T2)).rejects.toThrow("isn't taking applications");
      // Its own officers can look at it any time.
      expect((await form(asUser, OFFICER_T1)).questions).toHaveLength(1);

      await openTeam(asUser);
      const f = await form(asUser, OFFICER_T2);
      expect(f.starters.map((s) => s.key)).toEqual(['about', 'why', 'other', 'experience', 'guild', 'log', 'nights', 'sent_by']);
      expect(f.starters[0]).not.toHaveProperty('on');
      expect(f.questions[0]).toMatchObject({ prompt: 'Off-spec at {team}?' });
      await expect(form(asUser, null)).rejects.toThrow();
    });
  });

  it('a picture goes only into the applicant’s own folder of a team taking applications', async () => {
    await withTxn(async ({ q, asUser }) => {
      const mine = `1/${OFFICER_T2}/ui.png`;
      await expect(upload(asUser, OFFICER_T2, mine)).rejects.toMatchObject({ code: RLS_DENIED });
      await openTeam(asUser);
      await upload(asUser, OFFICER_T2, mine);
      await expect(upload(asUser, OFFICER_T2, `1/${RAIDER_T1}/ui.png`)).rejects.toMatchObject({ code: RLS_DENIED });
      await expect(upload(asUser, OFFICER_T2, `x/${OFFICER_T2}/ui.png`)).rejects.toMatchObject({ code: RLS_DENIED });

      const sees = async (uid) =>
        (await asUser(uid, "select name from storage.objects where bucket_id = 'application-pictures'")).rows.length;
      expect(await sees(OFFICER_T2)).toBe(1); // the uploader
      expect(await sees(OFFICER_T1)).toBe(1); // team 1's officer
      expect(await sees(RAIDER_T1)).toBe(0);
      expect(await sees(SITE_ADMIN)).toBe(1);
      expect((await q("select public from storage.buckets where id = 'application-pictures'")).rows[0].public).toBe(false);
    });
  });
});
