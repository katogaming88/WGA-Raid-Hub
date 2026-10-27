// my_recent_own_add() (#1674): the officers' "Character Added to Roster"
// notice is built from this, called as the member, so it must hand back only
// the caller's own Add character row on the named team from the last five
// minutes. Each case mints its own team.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedTeam } from './helpers.js';

afterAll(() => pool.end());

// classes_specs 1 is Mage Frost.
const FROST_MAGE = 1;

const recent = (as, slug) => as('select * from public.my_recent_own_add($1)', [slug]);

// The raider adds a character of their own, the way the page does.
async function ownAdd(q, asUser, team, name = 'Newmain') {
  const person = await q('select person_id from public.team_members where id = $1', [team.raider.memberId]);
  const { rows } = await q(
    `insert into public.characters (person_id, blizzard_id, name, realm, realm_slug, class_name, spec_name, level)
     values ($1, $2, $3, 'Illidan', 'illidan', 'Mage', 'Frost', 90) returning id`,
    [person.rows[0].person_id, Math.floor(Math.random() * 1e9), name]
  );
  const added = await asUser(team.raider.uid, 'select public.add_own_character($1, $2, $3) as id', [
    team.teamId,
    rows[0].id,
    FROST_MAGE
  ]);
  return added.rows[0].id;
}

const slugOf = async (q, teamId) => (await q('select slug from public.teams where id = $1', [teamId])).rows[0].slug;

describe('my_recent_own_add()', () => {
  it("returns the caller's own add with what the notice shows", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await q('insert into public.names (team_id, label, team_member_id) values ($1, $2, $3)', [
        team.teamId,
        'Kat',
        team.raider.memberId
      ]);
      const playerId = await ownAdd(q, asUser, team);
      const slug = await slugOf(q, team.teamId);
      const audit = await q("select id from public.audit_log where target_type = 'players' and target_id = $1", [
        playerId
      ]);

      const { rows } = await recent((text, params) => asUser(team.raider.uid, text, params), slug);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        audit_id: audit.rows[0].id,
        team_slug: slug,
        member: 'Kat',
        name_realm: 'Newmain-Illidan',
        class_spec: 'Mage Frost Ranged'
      });
    });
  });

  it('returns nothing to someone else, an officer of the team included', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await ownAdd(q, asUser, team);
      const slug = await slugOf(q, team.teamId);
      const { rows } = await recent((text, params) => asUser(team.officer.uid, text, params), slug);
      expect(rows).toEqual([]);
    });
  });

  it('is refused to the signed-out', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const team = await seedTeam(q);
      await ownAdd(q, asUser, team);
      const slug = await slugOf(q, team.teamId);
      await expect(recent(asAnon, slug)).rejects.toThrow(/permission denied/);
    });
  });

  it('returns nothing for another team', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const other = await seedTeam(q);
      await ownAdd(q, asUser, team);
      const { rows } = await recent(
        (text, params) => asUser(team.raider.uid, text, params),
        await slugOf(q, other.teamId)
      );
      expect(rows).toEqual([]);
    });
  });

  it("returns nothing for an officer's add of someone else", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await q(
        `insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
         values ($1, $2, 'Player Added', 'players', 1, to_jsonb('Mage Frost DPS'::text))`,
        [team.teamId, team.officer.uid]
      );
      const { rows } = await recent(
        (text, params) => asUser(team.officer.uid, text, params),
        await slugOf(q, team.teamId)
      );
      expect(rows).toEqual([]);
    });
  });

  // An officer can write any audit row, wording included (CodeRabbit on
  // #1677), so the row has to be about the caller's own character too.
  it("returns nothing for an officer's own-add-worded row about someone else's character", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await ownAdd(q, asUser, team);
      await asUser(team.officer.uid, 'select public.write_audit_log($1, $2, $3, $4, $5)', [
        team.teamId,
        'Player Added',
        'players',
        playerId,
        JSON.stringify('Mage Frost Ranged, added by the member')
      ]);
      const { rows } = await recent(
        (text, params) => asUser(team.officer.uid, text, params),
        await slugOf(q, team.teamId)
      );
      expect(rows).toEqual([]);
    });
  });

  // A guild officer can write audit rows on any team (fresh review on #1677),
  // so a row about their own character on another team must not count.
  it('returns nothing for an own-add-worded row on a team the character is not on', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const other = await seedTeam(q);
      const playerId = await ownAdd(q, asUser, team);
      await q(
        `insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
         values ($1, $2, 'Player Added', 'players', $3, to_jsonb('Anything, added by the member'::text))`,
        [other.teamId, team.raider.uid, playerId]
      );
      const { rows } = await recent(
        (text, params) => asUser(team.raider.uid, text, params),
        await slugOf(q, other.teamId)
      );
      expect(rows).toEqual([]);
    });
  });

  it('returns nothing once the character is taken off the roster', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await ownAdd(q, asUser, team);
      await q('update public.players set archived_at = now() where id = $1', [playerId]);
      const { rows } = await recent(
        (text, params) => asUser(team.raider.uid, text, params),
        await slugOf(q, team.teamId)
      );
      expect(rows).toEqual([]);
    });
  });

  it('returns nothing for an add older than five minutes', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await ownAdd(q, asUser, team);
      await q(
        `update public.audit_log set created_at = now() - interval '6 minutes'
          where target_type = 'players' and target_id = $1`,
        [playerId]
      );
      const { rows } = await recent(
        (text, params) => asUser(team.raider.uid, text, params),
        await slugOf(q, team.teamId)
      );
      expect(rows).toEqual([]);
    });
  });
});
