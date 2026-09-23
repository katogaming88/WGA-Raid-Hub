// team_invite_link_join() (#1264): a signed-in person opens a live invite link,
// picks a character, and lands in the guild and on the roster with no officer
// in between. The link is the approval.
import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool, withTxn, OFFICER_T1, RLS_DENIED, insertDiscordUser, seedMember, seedPlayer } from './helpers.js';

afterAll(() => pool.end());

const mint = async (asUser, team = 1, expiresAt = null) =>
  (await asUser(OFFICER_T1, 'select code from public.team_invite_link_reset($1, $2)', [team, expiresAt])).rows[0].code;

const join = (asUser, uid, code, name = 'Newbie', realm = 'Stormrage', cls = 'Priest', spec = 'Holy') =>
  asUser(uid, 'select public.team_invite_link_join($1, $2, $3, $4, $5) as outcome', [code, name, realm, cls, spec]);

// A signed-in account with a Discord login and no team at all.
async function newcomer(q) {
  const uid = randomUUID();
  await insertDiscordUser(q, uid, `newcomer-${uid}`);
  return uid;
}

describe('team_invite_link_join()', () => {
  it('adds the person to the team and puts their character on the roster', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q("insert into public.classes_specs (class, spec, role) values ('Priest', 'Holy', 'Heal')");
      const code = await mint(asUser);
      const uid = await newcomer(q);
      expect((await join(asUser, uid, code)).rows[0].outcome).toBe('joined');

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
      await join(asUser, await newcomer(q), code);
      const { rows } = await q("select action, detail from public.audit_log where action = 'Joined via Invite Link'");
      expect(rows).toEqual([{ action: 'Joined via Invite Link', detail: 'Newbie-Stormrage' }]);
    });
  });

  it('refuses a reset, an expired and an unknown code', async () => {
    await withTxn(async ({ q, asUser }) => {
      const first = await mint(asUser);
      await mint(asUser);
      const uid = await newcomer(q);
      await expect(join(asUser, uid, first)).rejects.toThrow(/does not work/);
      await expect(join(asUser, uid, 'phoenix-nope')).rejects.toThrow(/does not work/);
      const expired = await mint(asUser, 1, new Date(Date.now() + 1000).toISOString());
      await q("update public.team_invite_links set expires_at = now() - interval '1 minute' where team_id = 1");
      await expect(join(asUser, uid, expired)).rejects.toThrow(/does not work/);
      expect((await q("select count(*) from public.players where name_realm = 'Newbie-Stormrage'")).rows[0].count).toBe(
        '0'
      );
    });
  });

  it('refuses a caller with no session, no Discord, or a blank character; anon cannot call it', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const code = await mint(asUser);
      await expect(join(asUser, null, code)).rejects.toThrow(/Not signed in/);
      await expect(join(asUser, await newcomer(q), code, '  ', 'Stormrage')).rejects.toThrow(/Pick a character/);
      const bare = randomUUID();
      await q('insert into auth.users (id) values ($1)', [bare]);
      await expect(join(asUser, bare, code)).rejects.toThrow(/Connect Discord/);
      await expect(asAnon("select public.team_invite_link_join('x', 'A', 'B')")).rejects.toMatchObject({
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
      const uid = await newcomer(q);
      await expect(join(asUser, uid, code, 'Taken')).rejects.toThrow(/already claimed/);
      await expect(join(asUser, uid, code, 'Gone')).rejects.toThrow(/already claimed/);
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
      await join(asUser, uid, code, 'Open');
      await join(asUser, uid, code, 'Back');
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
});
