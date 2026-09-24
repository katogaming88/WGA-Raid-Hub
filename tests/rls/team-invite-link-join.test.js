// team_invite_link_join() (#1264): a signed-in person opens a live invite link,
// picks a character, and lands in the guild and on the roster with no officer
// in between. The link is the approval.
//
// The character is not the caller's word (#1319): it is named by its Battle.net
// id and resolved from public.characters, which only the battlenet-characters
// Edge Function writes, from the person's own Battle.net token. So the roster
// name comes from a record Blizzard confirmed, the way request_main_swap() takes
// a character id rather than a name.
import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool, withTxn, OFFICER_T1, RLS_DENIED, insertDiscordUser, seedMember, seedPlayer } from './helpers.js';

afterAll(() => pool.end());

const mint = async (asUser, team = 1, expiresAt = null) =>
  (await asUser(OFFICER_T1, 'select code from public.team_invite_link_reset($1, $2)', [team, expiresAt])).rows[0].code;

const join = (asUser, uid, code, blizzardId) =>
  asUser(uid, 'select public.team_invite_link_join($1, $2) as outcome', [code, blizzardId]);

// A signed-in account with a Discord login and no team at all.
async function newcomer(q) {
  const uid = randomUUID();
  await insertDiscordUser(q, uid, `newcomer-${uid}`);
  return uid;
}

const personOf = async (q, uid) => (await q('select id from public.people where auth_user_id = $1', [uid])).rows[0].id;

// What the battlenet-characters function saves after Blizzard confirms the
// account holds it. The blizzard id is the handle the join page passes back.
async function character(q, uid, { name = 'Newbie', realm = 'Stormrage', cls = 'Priest', spec = 'Holy' } = {}) {
  const blizzardId = Math.floor(Math.random() * 1e9);
  await q(
    `insert into public.characters (person_id, blizzard_id, name, realm, realm_slug, class_name, spec_name, level)
     values ($1, $2, $3, $4, lower($4), $5, $6, 90)`,
    [await personOf(q, uid), blizzardId, name, realm, cls, spec]
  );
  return blizzardId;
}

describe('team_invite_link_join()', () => {
  it('adds the person to the team and puts their character on the roster', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q("insert into public.classes_specs (class, spec, role) values ('Priest', 'Holy', 'Heal')");
      const code = await mint(asUser);
      const uid = await newcomer(q);
      const blizzardId = await character(q, uid);
      expect((await join(asUser, uid, code, blizzardId)).rows[0].outcome).toBe('joined');

      const { rows } = await q(
        `select p.name_realm, p.is_trial, p.archived_at, cs.class, cs.spec, tm.role, tm.team_id
           from public.players p
           join public.team_members tm on tm.id = p.team_member_id
           join public.people pe on pe.id = tm.person_id
           left join public.classes_specs cs on cs.id = p.class_spec_id
          where pe.auth_user_id = $1`,
        [uid]
      );
      expect(rows).toEqual([
        {
          name_realm: 'Newbie-Stormrage',
          is_trial: true,
          archived_at: null,
          class: 'Priest',
          spec: 'Holy',
          role: 'raider',
          team_id: 1
        }
      ]);
    });
  });

  it('writes one audit entry naming the character', async () => {
    await withTxn(async ({ q, asUser }) => {
      const code = await mint(asUser);
      const uid = await newcomer(q);
      await join(asUser, uid, code, await character(q, uid));
      const { rows } = await q("select action, detail from public.audit_log where action = 'Joined via Invite Link'");
      expect(rows).toEqual([{ action: 'Joined via Invite Link', detail: 'Newbie-Stormrage' }]);
    });
  });

  it('refuses a character that is not on the caller account', async () => {
    await withTxn(async ({ q, asUser }) => {
      const code = await mint(asUser);
      const uid = await newcomer(q);
      const other = await newcomer(q);
      const theirs = await character(q, other, { name: 'Notyours' });

      await expect(join(asUser, uid, code, theirs)).rejects.toThrow(/not on your account/);
      await expect(join(asUser, uid, code, 999999999999)).rejects.toThrow(/not on your account/);
      expect(
        (await q('select count(*) from public.players where name_realm = $1', ['Notyours-Stormrage'])).rows[0].count
      ).toBe('0');
    });
  });

  it('leaves a departed raider archived character alone when someone else joins', async () => {
    await withTxn(async ({ q, asUser }) => {
      const code = await mint(asUser);
      // A raider left: the character is archived and the membership row is gone,
      // so nothing records whose it was.
      const gone = await seedPlayer(q, {
        teamId: 1,
        nameRealm: 'Departed-Stormrage',
        archivedAt: new Date().toISOString()
      });
      const uid = await newcomer(q);

      await join(asUser, uid, code, await character(q, uid, { name: 'Ownchar' }));

      const { rows } = await q(
        'select name_realm, archived_at is not null as archived from public.players where id = $1',
        [gone]
      );
      expect(rows).toEqual([{ name_realm: 'Departed-Stormrage', archived: true }]);
    });
  });

  it('refuses a reset, an expired and an unknown code', async () => {
    await withTxn(async ({ q, asUser }) => {
      const first = await mint(asUser);
      await mint(asUser);
      const uid = await newcomer(q);
      const blizzardId = await character(q, uid);
      await expect(join(asUser, uid, first, blizzardId)).rejects.toThrow(/does not work/);
      await expect(join(asUser, uid, 'phoenix-nope', blizzardId)).rejects.toThrow(/does not work/);
      const expired = await mint(asUser, 1, new Date(Date.now() + 1000).toISOString());
      await q("update public.team_invite_links set expires_at = now() - interval '1 minute' where team_id = 1");
      await expect(join(asUser, uid, expired, blizzardId)).rejects.toThrow(/does not work/);
      expect((await q("select count(*) from public.players where name_realm = 'Newbie-Stormrage'")).rows[0].count).toBe(
        '0'
      );
    });
  });

  it('refuses a caller with no session or no Discord; anon cannot call it', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const code = await mint(asUser);
      await expect(join(asUser, null, code, 1)).rejects.toThrow(/Not signed in/);
      const bare = randomUUID();
      await q('insert into auth.users (id) values ($1)', [bare]);
      await expect(join(asUser, bare, code, 1)).rejects.toThrow(/Connect Discord/);
      await expect(asAnon("select public.team_invite_link_join('x', 1)")).rejects.toMatchObject({
        code: RLS_DENIED
      });
    });
  });

  it('refuses a character another person holds, on the roster or archived', async () => {
    await withTxn(async ({ q, asUser }) => {
      const code = await mint(asUser);
      const holder = await seedMember(q);
      await seedPlayer(q, { memberId: holder.memberId, nameRealm: 'Taken-Stormrage' });
      await seedPlayer(q, {
        memberId: holder.memberId,
        nameRealm: 'Gone-Stormrage',
        archivedAt: new Date().toISOString()
      });
      // A rename puts the same name on two Battle.net records, so the caller can
      // hold a confirmed character whose roster row belongs to someone else.
      const uid = await newcomer(q);
      await expect(join(asUser, uid, code, await character(q, uid, { name: 'Taken' }))).rejects.toThrow(
        /already claimed/
      );
      await expect(join(asUser, uid, code, await character(q, uid, { name: 'Gone' }))).rejects.toThrow(
        /already claimed/
      );
    });
  });

  it('refuses a name a second person already joined with, rather than a duplicate key error', async () => {
    await withTxn(async ({ q, asUser }) => {
      const code = await mint(asUser);
      const first = await newcomer(q);
      await join(asUser, first, code, await character(q, first, { name: 'Shared' }));

      const second = await newcomer(q);
      const attempt = join(asUser, second, code, await character(q, second, { name: 'Shared' }));
      await expect(attempt).rejects.toThrow(/already claimed/);
      await expect(attempt).rejects.not.toThrow(/duplicate key/);
    });
  });

  it('claims an unclaimed roster character and revives an unlinked archived one', async () => {
    await withTxn(async ({ q, asUser }) => {
      const code = await mint(asUser);
      const uid = await newcomer(q);
      await seedPlayer(q, { teamId: 1, nameRealm: 'Open-Stormrage' });
      const archived = await seedPlayer(q, {
        teamId: 1,
        nameRealm: 'Back-Stormrage',
        archivedAt: new Date().toISOString()
      });
      await join(asUser, uid, code, await character(q, uid, { name: 'Open' }));
      await join(asUser, uid, code, await character(q, uid, { name: 'Back' }));
      const { rows } = await q(
        `select p.name_realm, p.archived_at, p.team_member_id is not null as linked
           from public.players p where p.name_realm in ('Open-Stormrage', 'Back-Stormrage') order by 1`
      );
      expect(rows).toEqual([
        { name_realm: 'Back-Stormrage', archived_at: null, linked: true },
        { name_realm: 'Open-Stormrage', archived_at: null, linked: true }
      ]);
      expect(archived).toBeTruthy();
      // Joining twice adds one membership, not two.
      expect(
        (
          await q(
            'select count(*) from public.team_members tm join public.people pe on pe.id = tm.person_id where pe.auth_user_id = $1',
            [uid]
          )
        ).rows[0].count
      ).toBe('1');
    });
  });

  it('starts a revived character fresh: the flags an officer set for the last holder are cleared', async () => {
    await withTxn(async ({ q, asUser }) => {
      const code = await mint(asUser);
      const id = await seedPlayer(q, {
        teamId: 1,
        nameRealm: 'Flagged-Stormrage',
        archivedAt: new Date().toISOString()
      });
      await q(
        `update public.players
            set is_backup_tank = true, is_backup_healer = true, wishlist_allowed = true, bis_allowed = true
          where id = $1`,
        [id]
      );
      const uid = await newcomer(q);
      await join(asUser, uid, code, await character(q, uid, { name: 'Flagged' }));
      const { rows } = await q(
        `select is_trial, is_backup_tank, is_backup_healer, wishlist_allowed, bis_allowed, archived_at
           from public.players where id = $1`,
        [id]
      );
      expect(rows).toEqual([
        {
          is_trial: true,
          is_backup_tank: false,
          is_backup_healer: false,
          wishlist_allowed: false,
          bis_allowed: false,
          archived_at: null
        }
      ]);
    });
  });
});
