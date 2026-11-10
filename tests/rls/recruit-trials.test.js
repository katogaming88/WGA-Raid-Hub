// #1793: the trial actions on a recruit record. SIGNUP_OWNER_T1 is on no team,
// so they play the applicant, as in recruit-records.test.js.
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  withTxn,
  OFFICER_T1,
  OFFICER_T2,
  RAIDER_T1,
  TEAM_LEADER_T1,
  SIGNUP_OWNER_T1,
  RLS_DENIED
} from './helpers.js';

afterAll(() => pool.end());

const APPLICANT = SIGNUP_OWNER_T1;
const REQUIRED = { about: 'Demo lock, ten years', experience: 'Mythic since Nathria', nights: 'Every week' };
const personOf = async (q, uid) => (await q('select id from public.people where auth_user_id = $1', [uid])).rows[0].id;

// An application from the applicant to team 1, as recruit-records.test.js sends one.
async function applied(q, asUser) {
  await q('select 1 from public.teams where id = 1 for update');
  const me = await personOf(q, APPLICANT);
  const char = (
    await q(
      `insert into public.characters (person_id, blizzard_id, name, realm, realm_slug, class_name, spec_name, level, item_level)
       values ($1, 990101, 'Katorrí', 'Stormrage', 'stormrage', 'Warlock', 'Demonology', 90, 720) returning id`,
      [me]
    )
  ).rows[0].id;
  await q('update public.team_recruiting set taking_applications = true where team_id = 1');
  await q("insert into public.classes_specs (class, spec, role) values ('Warlock', 'Demonology', 'Ranged')");
  const id = (
    await asUser(APPLICANT, "select public.send_application(1, $1, $2, null, null, 'America/New_York') as id", [
      char,
      JSON.stringify(REQUIRED)
    ])
  ).rows[0].id;
  return { me, id };
}

const app = async (q, id) =>
  (
    await q(
      `select status, closed_at is not null as closed, trial_player_id,
              trial_ends_on - trial_starts_on as days,
              trial_starts_on = (now() at time zone 'America/New_York')::date as starts_today
         from public.recruit_applications where id = $1`,
      [id]
    )
  ).rows[0];
const player = async (q, id) =>
  (
    await q(
      `select p.team_id, p.name_realm, p.is_trial, p.archived_at is not null as archived, p.team_member_id,
              p.wishlist_allowed, p.is_backup_tank, p.is_bench, p.is_rotator, cs.class, cs.spec
         from public.players p left join public.classes_specs cs on cs.id = p.class_spec_id where p.id = $1`,
      [id]
    )
  ).rows[0];
const membership = async (q, me) =>
  (
    await q(
      `select id, rank, archived_at is not null as archived from public.team_members where team_id = 1 and person_id = $1`,
      [me]
    )
  ).rows[0];
const events = async (q, id) =>
  (await q('select kind, detail from public.recruit_events where application_id = $1 order by id', [id])).rows;
const audit = async (q, id) =>
  (
    await q(
      "select action, actor_id, detail from public.audit_log where target_type = 'recruit_applications' and target_id = $1 order by id",
      [id]
    )
  ).rows;

describe('recruit trials', () => {
  it('start, extend and joined from the site: on the roster as a Trial, dated, then a raider', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { me, id } = await applied(q, asUser);
      const pid = (await asUser(OFFICER_T1, 'select public.start_recruit_trial($1) as p', [id])).rows[0].p;

      const m = await membership(q, me);
      expect(m).toMatchObject({ rank: 'raider', archived: false });
      expect(await player(q, pid)).toMatchObject({
        team_id: 1,
        name_realm: 'Katorrí-Stormrage',
        is_trial: true,
        archived: false,
        team_member_id: m.id,
        class: 'Warlock',
        spec: 'Demonology'
      });
      expect(await app(q, id)).toMatchObject({
        status: 'on_trial',
        trial_player_id: pid,
        days: 14,
        starts_today: true
      });
      await expect(asUser(OFFICER_T1, 'select public.start_recruit_trial($1)', [id])).rejects.toThrow("isn't on trial");

      // An extension needs a reason, and adds the team's trial length.
      await q('update public.team_recruiting set trial_days = 7 where team_id = 1');
      for (const reason of [null, '  ', 'x'.repeat(501)]) {
        await expect(asUser(OFFICER_T1, 'select public.extend_recruit_trial($1, $2)', [id, reason])).rejects.toThrow(
          reason?.length > 500 ? 'at most 500' : 'Say why'
        );
      }
      await asUser(OFFICER_T1, 'select public.extend_recruit_trial($1, $2)', [id, 'Missed two raids']);
      expect((await app(q, id)).days).toBe(21);

      await asUser(OFFICER_T1, 'select public.mark_recruit_joined($1)', [id]);
      expect(await app(q, id)).toMatchObject({ status: 'joined', closed: true });
      expect(await player(q, pid)).toMatchObject({ is_trial: false, archived: false });
      expect(await membership(q, me)).toMatchObject({ archived: false });

      expect((await events(q, id)).map((e) => e.kind)).toEqual([
        'applied',
        'trial_started',
        'trial_extended',
        'joined'
      ]);
      expect((await events(q, id))[2].detail).toMatch(/: Missed two raids$/);
      const log = await audit(q, id);
      expect(log.map((a) => [a.action, a.actor_id])).toEqual([
        ['Application Sent', APPLICANT],
        ['Recruit Trial Started', OFFICER_T1],
        ['Recruit Trial Extended', OFFICER_T1],
        ['Recruit Joined', OFFICER_T1]
      ]);
      expect(log[1].detail).toMatchObject({ player_id: pid, membership_restored: false });

      // A joined record takes no more trial actions.
      await expect(asUser(OFFICER_T1, 'select public.mark_recruit_joined($1)', [id])).rejects.toThrow('not on trial');
    });
  });

  it('a person who was on the team before comes back on the same membership and character, flags cleared', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { me, id } = await applied(q, asUser);
      const member = (
        await q(
          `insert into public.team_members (team_id, discord_id, role, archived_at)
           values (1, 'discord-signup-owner', 'raider', now() - interval '1 year') returning id`
        )
      ).rows[0].id;
      const old = (
        await q(
          `insert into public.players (team_id, name_realm, team_member_id, archived_at, wishlist_allowed, is_backup_tank, is_bench, is_rotator)
           values (1, 'Katorrí-Stormrage', $1, now() - interval '1 year', true, true, true, true) returning id`,
          [member]
        )
      ).rows[0].id;

      const pid = (await asUser(OFFICER_T1, 'select public.start_recruit_trial($1) as p', [id])).rows[0].p;
      expect(pid).toBe(old);
      expect(await membership(q, me)).toMatchObject({ id: member, rank: 'raider', archived: false });
      expect(await player(q, pid)).toMatchObject({
        is_trial: true,
        archived: false,
        team_member_id: member,
        wishlist_allowed: false,
        is_backup_tank: false,
        is_bench: false,
        is_rotator: false
      });
      expect((await audit(q, id))[1].detail).toMatchObject({ membership_restored: true });

      // Not joining: the character comes off with the reason in the officer's
      // name, and the membership, left with no character, goes too.
      await expect(
        asUser(OFFICER_T1, "select public.mark_recruit_not_joining($1, 'bored', null)", [id])
      ).rejects.toThrow('not one of the removal reasons');
      await asUser(OFFICER_T1, "select public.mark_recruit_not_joining($1, 'schedule_conflict', 'Works nights')", [id]);
      expect(await app(q, id)).toMatchObject({ status: 'not_joining', closed: true });
      expect(await player(q, pid)).toMatchObject({ archived: true });
      expect(await membership(q, me)).toMatchObject({ archived: true });
      const officer = await personOf(q, OFFICER_T1);
      expect(
        (
          await q(
            `select player_id, team_member_id, reason, detail, removed_by from public.removal_reasons
              where team_member_id = $1 order by player_id nulls last`,
            [member]
          )
        ).rows
      ).toEqual([
        {
          player_id: pid,
          team_member_id: member,
          reason: 'schedule_conflict',
          detail: 'Works nights',
          removed_by: officer
        },
        {
          player_id: null,
          team_member_id: member,
          reason: 'schedule_conflict',
          detail: 'Works nights',
          removed_by: officer
        }
      ]);
      expect((await events(q, id)).at(-1)).toEqual({ kind: 'not_joining', detail: 'Schedule conflict: Works nights' });
      expect((await audit(q, id)).at(-1)).toMatchObject({
        action: 'Recruit Not Joining',
        detail: { reason: 'schedule_conflict', membership_archived: true }
      });
    });
  });

  it('not joining keeps a membership that has another character on the team', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { me, id } = await applied(q, asUser);
      const member = (
        await q(
          `insert into public.team_members (team_id, discord_id, role) values (1, 'discord-signup-owner', 'raider') returning id`
        )
      ).rows[0].id;
      await q(`insert into public.players (team_id, name_realm, team_member_id) values (1, 'Altorrí-Stormrage', $1)`, [
        member
      ]);
      const pid = (await asUser(OFFICER_T1, 'select public.start_recruit_trial($1) as p', [id])).rows[0].p;
      expect((await player(q, pid)).team_member_id).toBe(member);
      await asUser(OFFICER_T1, "select public.mark_recruit_not_joining($1, 'performance', null)", [id]);
      expect(await player(q, pid)).toMatchObject({ archived: true });
      expect(await membership(q, me)).toMatchObject({ archived: false });
    });
  });

  it('refuses a character on the roster now or held by someone else, and a trial action off trial', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { id } = await applied(q, asUser);
      for (const sql of [
        "select public.extend_recruit_trial($1, 'x')",
        'select public.mark_recruit_joined($1)',
        "select public.mark_recruit_not_joining($1, 'other', null)"
      ]) {
        await expect(asUser(OFFICER_T1, sql, [id])).rejects.toThrow('not on trial');
      }

      const pid = (
        await q(`insert into public.players (team_id, name_realm) values (1, 'Katorrí-Stormrage') returning id`)
      ).rows[0].id;
      await expect(asUser(OFFICER_T1, 'select public.start_recruit_trial($1)', [id])).rejects.toThrow(
        'already on the roster'
      );
      const raider = (
        await q("select id from public.team_members where team_id = 1 and discord_id = 'discord-raider-1'")
      ).rows[0].id;
      await q('update public.players set archived_at = now(), team_member_id = $2 where id = $1', [pid, raider]);
      await expect(asUser(OFFICER_T1, 'select public.start_recruit_trial($1)', [id])).rejects.toThrow(
        "someone else's character"
      );
      expect((await app(q, id)).status).toBe('waiting_on_officers');

      // Taken off the roster by hand during the trial: not Joined, but Not
      // joining still closes it.
      await q('update public.players set team_member_id = null where id = $1', [pid]);
      await asUser(OFFICER_T1, 'select public.start_recruit_trial($1)', [id]);
      await q('update public.players set archived_at = now() where id = $1', [pid]);
      await expect(asUser(OFFICER_T1, 'select public.mark_recruit_joined($1)', [id])).rejects.toThrow(
        'no longer on the roster'
      );
      await asUser(OFFICER_T1, "select public.mark_recruit_not_joining($1, 'other', null)", [id]);
      expect((await app(q, id)).status).toBe('not_joining');
    });
  });

  it('not joining ends the membership before the character, so a waiting main swap reads Membership ended', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { me, id } = await applied(q, asUser);
      const pid = (await asUser(OFFICER_T1, 'select public.start_recruit_trial($1) as p', [id])).rows[0].p;
      const swap = (
        await q(
          `insert into public.main_swap_requests (team_id, person_id, from_player_id, name_realm)
           values (1, $1, $2, 'Altorrí-Stormrage') returning id`,
          [me, pid]
        )
      ).rows[0].id;
      await asUser(OFFICER_T1, "select public.mark_recruit_not_joining($1, 'other', null)", [id]);
      expect(
        (await q('select status, officer_note from public.main_swap_requests where id = $1', [swap])).rows[0]
      ).toEqual({ status: 'cancelled', officer_note: 'Membership ended' });
    });
  });

  it('asks Edit recruiting and Edit roster, on the site and through the bot', async () => {
    await withTxn(async ({ q, asUser, asRole }) => {
      const { id } = await applied(q, asUser);
      const bot = asRole('service_role', null);

      // Every action refuses a raider, another team's officer and the
      // applicant on their own record, on the site and through the bot, and
      // a signed-out caller on the site.
      const site = [
        'select public.start_recruit_trial($1)',
        "select public.extend_recruit_trial($1, 'x')",
        'select public.mark_recruit_joined($1)',
        "select public.mark_recruit_not_joining($1, 'other', null)"
      ];
      const viaBot = (who) => [
        `select public.bot_start_recruit_trial($1, '${who}')`,
        `select public.bot_extend_recruit_trial($1, '${who}', 'x')`,
        `select public.bot_mark_recruit_joined($1, '${who}')`,
        `select public.bot_mark_recruit_not_joining($1, '${who}', 'other', null)`
      ];
      for (const sql of site) {
        for (const uid of [RAIDER_T1, OFFICER_T2, APPLICANT]) {
          await expect(asUser(uid, sql, [id])).rejects.toThrow('Not authorized');
        }
        await expect(asUser(null, sql, [id])).rejects.toThrow('Not signed in');
      }
      for (const who of ['discord-raider-1', 'discord-officer-2', 'discord-signup-owner']) {
        for (const sql of viaBot(who)) {
          await expect(bot(sql, [id])).rejects.toThrow('Not authorized');
        }
      }
      await expect(asUser(RAIDER_T1, 'select public.start_recruit_trial($1)', [id])).rejects.toThrow('Not authorized');
      await expect(asUser(null, 'select public.start_recruit_trial($1)', [id])).rejects.toThrow('Not signed in');
      await expect(bot("select public.bot_start_recruit_trial($1, 'discord-raider-1')", [id])).rejects.toThrow(
        'Not authorized'
      );

      await q(
        "delete from public.team_rank_permissions where team_id = 1 and rank = 'officer' and permission = 'edit_roster'"
      );
      await expect(asUser(OFFICER_T1, 'select public.start_recruit_trial($1)', [id])).rejects.toThrow('Not authorized');
      await expect(bot("select public.bot_start_recruit_trial($1, 'discord-officer-1')", [id])).rejects.toThrow(
        'Not authorized'
      );

      // The Team Owner holds both whatever the grid says.
      await bot("select public.bot_start_recruit_trial($1, 'discord-leader-1')", [id]);
      await asUser(TEAM_LEADER_T1, "select public.extend_recruit_trial($1, 'One more week')", [id]);
      expect((await app(q, id)).status).toBe('on_trial');
    });
  });

  it('the bot runs all four as the Discord user who pressed the button', async () => {
    await withTxn(async ({ q, asUser, asRole }) => {
      const { me, id } = await applied(q, asUser);
      const bot = asRole('service_role', null);
      const pid = (await bot("select public.bot_start_recruit_trial($1, 'discord-officer-1') as p", [id])).rows[0].p;
      expect((await player(q, pid)).is_trial).toBe(true);
      expect(
        (await bot("select public.bot_extend_recruit_trial($1, 'discord-officer-1', 'Needs a week') as d", [id]))
          .rows[0].d
      ).toBeTruthy();
      await expect(bot("select public.bot_extend_recruit_trial($1, 'nobody-here', 'x')", [id])).rejects.toThrow(
        'Discord id'
      );
      await bot("select public.bot_mark_recruit_not_joining($1, 'discord-officer-1', 'moved_guilds', null)", [id]);
      expect(await membership(q, me)).toMatchObject({ archived: true });
      expect((await q('select removed_by from public.removal_reasons where player_id = $1', [pid])).rows).toEqual([
        { removed_by: await personOf(q, OFFICER_T1) }
      ]);
      expect((await audit(q, id)).slice(1).map((a) => [a.action, a.actor_id])).toEqual([
        ['Recruit Trial Started', OFFICER_T1],
        ['Recruit Trial Extended', OFFICER_T1],
        ['Recruit Not Joining', OFFICER_T1]
      ]);

      // Reopened as a fresh application, the bot's Joined.
      const again = (
        await q(
          `insert into public.recruit_applications (team_id, person_id, source, name_realm) values (1, $1, 'added_by_officer', 'Katorrí-Stormrage') returning id`,
          [me]
        )
      ).rows[0].id;
      await bot("select public.bot_start_recruit_trial($1, 'discord-officer-1')", [again]);
      await bot("select public.bot_mark_recruit_joined($1, 'discord-officer-1')", [again]);
      expect(await app(q, again)).toMatchObject({ status: 'joined' });
      expect(await membership(q, me)).toMatchObject({ archived: false });

      // Nobody signed in calls the bot's versions.
      for (const sql of [
        "select public.bot_start_recruit_trial($1, 'discord-officer-1')",
        "select public.bot_extend_recruit_trial($1, 'discord-officer-1', 'x')",
        "select public.bot_mark_recruit_joined($1, 'discord-officer-1')",
        "select public.bot_mark_recruit_not_joining($1, 'discord-officer-1', 'other', null)"
      ]) {
        await expect(asUser(OFFICER_T1, sql, [id])).rejects.toMatchObject({ code: RLS_DENIED });
      }
    });
  });
});
