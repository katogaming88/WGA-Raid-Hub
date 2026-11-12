// #1810: what the application form needs from the database. my_applications()
// gives the applicant the link to their own ticket and how the Discord step
// went, and send_application() takes the other specs they play well.
// SIGNUP_OWNER_T1 is on no team, so they play the applicant. Team 3 and a
// class of the file's own, so the suites running beside it that write team 1's
// Discord settings and real specs never wait on these rows.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, SIGNUP_OWNER_T1, RAIDER_T1 } from './helpers.js';

const count = async (q) =>
  (await q('select count(*)::int as n from public.recruit_applications where team_id = 3')).rows[0].n;

afterAll(() => pool.end());

const APPLICANT = SIGNUP_OWNER_T1;
const SERVER = '111111111111111111';
const CHANNEL = '222222222222222222';
const REQUIRED = { about: 'Demo lock, ten years', experience: 'Mythic since Nathria', nights: 'Every week' };

const personOf = async (q, uid) => (await q('select id from public.people where auth_user_id = $1', [uid])).rows[0].id;

async function setup(q) {
  await q('select 1 from public.teams where id = 3 for update');
  const me = await personOf(q, APPLICANT);
  // The seed has one spec; the applicant plays a class of this file's own.
  await q(
    `insert into public.classes_specs (class, spec, role) values
       ('Testlock', 'Affliction', 'Ranged'), ('Testlock', 'Demonology', 'Ranged'), ('Testlock', 'Destruction', 'Ranged')
     on conflict (class, spec) do nothing`
  );
  const char = (
    await q(
      `insert into public.characters (person_id, blizzard_id, name, realm, realm_slug, class_name, spec_name, level, item_level)
       values ($1, 990011, 'Katorrí', 'Stormrage', 'stormrage', 'Testlock', 'Demonology', 90, 720) returning id`,
      [me]
    )
  ).rows[0].id;
  await q('update public.team_recruiting set taking_applications = true, add_to_server = true where team_id = 3');
  await q(
    `insert into public.team_discord_config (team_id, guild_id) values (3, $1)
     on conflict (team_id) do update set guild_id = excluded.guild_id`,
    [SERVER]
  );
  return { me, char };
}

const send = (asUser, char, specs) =>
  asUser(APPLICANT, 'select public.send_application(3, $1, $2, null, null, $3, $4) as id', [
    char,
    JSON.stringify(REQUIRED),
    'America/New_York',
    specs
  ]).then((r) => r.rows[0].id);

const mine = async (asUser, uid = APPLICANT) => (await asUser(uid, 'select public.my_applications() as m')).rows[0].m;

describe('the applicant’s ticket link and Discord step', () => {
  it('has no link until the ticket exists, then the jump link while it is open', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { char } = await setup(q);
      const id = await send(asUser, char, []);
      expect((await mine(asUser))[0]).toMatchObject({
        id,
        ticket_url: null,
        joined_discord: false,
        join_failed: false,
        add_to_server: true
      });

      await q("insert into public.recruit_events (application_id, kind, detail) values ($1, 'joined_discord', null)", [
        id
      ]);
      await q('update public.recruit_applications set discord_channel_id = $2 where id = $1', [id, CHANNEL]);
      expect((await mine(asUser))[0]).toMatchObject({
        ticket_url: `https://discord.com/channels/${SERVER}/${CHANNEL}`,
        joined_discord: true,
        join_failed: false
      });

      // Closed, the link goes: the ticket is locked, then deleted.
      await asUser(APPLICANT, 'select public.withdraw_application($1)', [id]);
      expect((await mine(asUser))[0].ticket_url).toBeNull();
    });
  });

  it('follows the latest Discord step: failed, then joined after all', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { char } = await setup(q);
      const id = await send(asUser, char, []);
      await q(
        "insert into public.recruit_events (application_id, kind, detail, created_at) values ($1, 'discord_join_failed', 'Banned', now() - interval '1 minute')",
        [id]
      );
      expect((await mine(asUser))[0]).toMatchObject({ joined_discord: false, join_failed: true });
      await q("insert into public.recruit_events (application_id, kind, detail) values ($1, 'joined_discord', null)", [
        id
      ]);
      expect((await mine(asUser))[0]).toMatchObject({ joined_discord: true, join_failed: false });
    });
  });

  it('gives no link for a deleted ticket, and nothing to anyone else', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { char } = await setup(q);
      const id = await send(asUser, char, []);
      await q(
        'update public.recruit_applications set discord_channel_id = $2, ticket_deleted_at = now() where id = $1',
        [id, CHANNEL]
      );
      expect((await mine(asUser))[0].ticket_url).toBeNull();
      expect((await mine(asUser, RAIDER_T1)).some((a) => a.id === id)).toBe(false);
    });
  });

  it('gives no link while the team doesn’t add applicants to its server', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { char } = await setup(q);
      const id = await send(asUser, char, []);
      await q('update public.recruit_applications set discord_channel_id = $2 where id = $1', [id, CHANNEL]);
      await q("update public.team_recruiting set add_to_server = false, discord_mode = 'none' where team_id = 3");
      expect((await mine(asUser))[0].ticket_url).toBeNull();
    });
  });

  it('refuses a signed-out caller', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(asUser(null, 'select public.my_applications()')).rejects.toThrow('Not signed in');
    });
  });

  it('says when the team doesn’t add applicants to its server', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { char } = await setup(q);
      await q("update public.team_recruiting set add_to_server = false, discord_mode = 'none' where team_id = 3");
      await send(asUser, char, []);
      expect((await mine(asUser))[0].add_to_server).toBe(false);
    });
  });
});

describe('other specs on an application', () => {
  it('keeps other specs of the character’s class', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { char } = await setup(q);
      const id = await send(asUser, char, ['Destruction', 'Affliction']);
      const row = (await q('select other_specs from public.recruit_applications where id = $1', [id])).rows[0];
      expect(row.other_specs).toEqual(['Destruction', 'Affliction']);
    });
  });

  it('still takes the six arguments it took before, with no other specs', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { char } = await setup(q);
      const id = (
        await asUser(APPLICANT, "select public.send_application(3, $1, $2, null, null, 'America/New_York') as id", [
          char,
          JSON.stringify(REQUIRED)
        ])
      ).rows[0].id;
      expect(
        (await q('select other_specs from public.recruit_applications where id = $1', [id])).rows[0].other_specs
      ).toEqual([]);
    });
  });

  it('refuses a signed-out caller and someone else’s character, and makes no application', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { char } = await setup(q);
      const before = await count(q);
      await expect(
        asUser(null, "select public.send_application(3, $1, $2, null, null, 'America/New_York', '{}')", [
          char,
          JSON.stringify(REQUIRED)
        ])
      ).rejects.toThrow('Not signed in');
      await expect(
        asUser(RAIDER_T1, "select public.send_application(3, $1, $2, null, null, 'America/New_York', '{}')", [
          char,
          JSON.stringify(REQUIRED)
        ])
      ).rejects.toThrow(/not one of yours|Link your Discord/);
      expect(await count(q)).toBe(before);
    });
  });

  it.each([
    [['Frost'], 'other specs of your character'],
    [['Demonology'], 'other specs of your character'],
    [['Destruction', 'Destruction'], 'each other spec once'],
    [['Affliction', 'Destruction', 'Affliction', 'Destruction', 'Affliction'], 'up to 4']
  ])('refuses %j', async (specs, message) => {
    await withTxn(async ({ q, asUser }) => {
      const { char } = await setup(q);
      const before = await count(q);
      await expect(send(asUser, char, specs)).rejects.toThrow(message);
      expect(await count(q)).toBe(before);
    });
  });
});
