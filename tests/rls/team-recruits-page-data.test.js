// #1817: what team_recruits() adds for the Recruits page (#1549): the team's
// minimum item level and open spots for every access level, whether this
// turn's reply reminder went, and the ticket's Discord link while it exists.
// Team 3, so the suites beside it that write team 1 never wait on these rows.
// SIGNUP_OWNER_T1 is on no team, so they play the applicant.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, OFFICER_T3, RAIDER_T3, RAIDER_T1, GUILD_OFFICER, SIGNUP_OWNER_T1 } from './helpers.js';

afterAll(() => pool.end());

const APPLICANT = SIGNUP_OWNER_T1;
const SERVER = '111111111111111111';
const CHANNEL = '222222222222222222';
const REQUIRED = { about: 'Demo lock, ten years', experience: 'Mythic since Nathria', nights: 'Every week' };

const personOf = async (q, uid) => (await q('select id from public.people where auth_user_id = $1', [uid])).rows[0].id;

async function setup(q) {
  await q('select 1 from public.teams where id = 3 for update');
  const me = await personOf(q, APPLICANT);
  const char = (
    await q(
      `insert into public.characters (person_id, blizzard_id, name, realm, realm_slug, class_name, spec_name, level, item_level)
       values ($1, 990021, 'Katorrí', 'Stormrage', 'stormrage', 'Warlock', 'Demonology', 90, 720) returning id`,
      [me]
    )
  ).rows[0].id;
  await q('update public.team_recruiting set taking_applications = true, min_item_level = 265 where team_id = 3');
  return { char };
}

const send = (asUser, char) =>
  asUser(APPLICANT, "select public.send_application(3, $1, $2, null, null, 'America/New_York') as id", [
    char,
    JSON.stringify(REQUIRED)
  ]).then((r) => r.rows[0].id);

const recruits = async (asUser, uid) => (await asUser(uid, 'select public.team_recruits(3) as r', [])).rows[0].r;
const row = async (asUser, uid, id) => (await recruits(asUser, uid)).recruits.find((x) => x.id === id);

describe('team_recruits() for the Recruits page', () => {
  it('gives every access level the minimum item level and open spots, and nothing else of the settings', async () => {
    await withTxn(async ({ q, asUser }) => {
      await setup(q);
      await q(
        `insert into public.team_recruiting_spots (team_id, role, class_spec_id, priority, sort_order)
         values (3, 'ranged', null, 'high', 1)`
      );
      const want = {
        min_item_level: 265,
        needs: [{ role: 'ranged', class_spec_id: null, class: null, spec: null, priority: 'high' }]
      };

      // manage
      const officer = await recruits(asUser, OFFICER_T3);
      expect(officer).toMatchObject({ access: 'manage', ...want });
      expect(Object.keys(officer).sort()).toEqual(['access', 'min_item_level', 'needs', 'recruits']);

      // note: an assistant, once the team lets them see tickets
      await q("update public.team_members set rank = 'assistant' where team_id = 3 and person_id = $1", [
        await personOf(q, RAIDER_T3)
      ]);
      await q('update public.team_recruiting set visible_to_team_assistants = true where team_id = 3');
      expect(await recruits(asUser, RAIDER_T3)).toMatchObject({ access: 'note', ...want });

      // read: the guild's Admin, who sees every team
      expect(await recruits(asUser, GUILD_OFFICER)).toMatchObject({ access: 'read', ...want });

      // No minimum, no spots.
      await q('update public.team_recruiting set min_item_level = null where team_id = 3');
      await q('delete from public.team_recruiting_spots where team_id = 3');
      expect(await recruits(asUser, OFFICER_T3)).toMatchObject({ min_item_level: null, needs: [] });
    });
  });

  it('still refuses a raider of another team and a signed-out caller', async () => {
    await withTxn(async ({ q, asUser }) => {
      await setup(q);
      await expect(recruits(asUser, RAIDER_T1)).rejects.toThrow('Not authorized');
      await expect(q('select public.team_recruits(3)')).rejects.toThrow('Not signed in');
    });
  });

  it('reminded: on once this turn’s reply reminder went, off when they answer or it is the officers’ turn', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { char } = await setup(q);
      const id = await send(asUser, char);
      // due_for is copied in SQL: a JS Date would drop the microseconds.
      const claim = (reminder) =>
        q(
          `insert into public.recruit_reminders_sent (application_id, reminder, due_for)
           select id, $2, applied_at from public.recruit_applications where id = $1`,
          [id, reminder]
        );
      expect((await row(asUser, OFFICER_T3, id)).reminded).toBe(false);

      // The officers wrote last: the applicant's turn, which starts at applied_at.
      await q(
        "update public.recruit_applications set officers_last_message_at = now() + interval '1 minute' where id = $1",
        [id]
      );
      // Only the DM that the officers replied: not a reminder.
      await claim('reply_dm');
      expect((await row(asUser, OFFICER_T3, id)).reminded).toBe(false);
      await claim('reply_reminder');
      expect(await row(asUser, OFFICER_T3, id)).toMatchObject({ status: 'waiting_on_applicant', reminded: true });

      // They answer: the officers' turn, so not reminded.
      await q(
        "update public.recruit_applications set applicant_last_message_at = now() + interval '2 minutes' where id = $1",
        [id]
      );
      expect(await row(asUser, OFFICER_T3, id)).toMatchObject({ status: 'waiting_on_officers', reminded: false });

      // The officers reply again: a new turn, its reminder not yet sent.
      await q(
        "update public.recruit_applications set officers_last_message_at = now() + interval '3 minutes' where id = $1",
        [id]
      );
      expect(await row(asUser, OFFICER_T3, id)).toMatchObject({ status: 'waiting_on_applicant', reminded: false });
    });
  });

  it('ticket_url: only with a channel and the team’s server, until the ticket is deleted', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { char } = await setup(q);
      const id = await send(asUser, char);
      await q('delete from public.team_discord_config where team_id = 3');
      expect((await row(asUser, OFFICER_T3, id)).ticket_url).toBeNull();

      // A channel, but no server set.
      await q('update public.recruit_applications set discord_channel_id = $2 where id = $1', [id, CHANNEL]);
      expect((await row(asUser, OFFICER_T3, id)).ticket_url).toBeNull();

      await q('insert into public.team_discord_config (team_id, guild_id) values (3, $1)', [SERVER]);
      const url = `https://discord.com/channels/${SERVER}/${CHANNEL}`;
      expect((await row(asUser, OFFICER_T3, id)).ticket_url).toBe(url);
      expect((await row(asUser, GUILD_OFFICER, id)).ticket_url).toBe(url);

      // Closed, the ticket stays (locked) until the bot deletes it.
      await asUser(OFFICER_T3, "select public.close_recruit($1, 'declined', null)", [id]);
      expect((await row(asUser, OFFICER_T3, id)).ticket_url).toBe(url);
      await q('update public.recruit_applications set ticket_deleted_at = now() where id = $1', [id]);
      expect((await row(asUser, OFFICER_T3, id)).ticket_url).toBeNull();
    });
  });
});
