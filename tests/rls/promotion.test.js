// Behavior tests for add_signup_to_roster(): the three upsert cases (new
// character, returning archived character, already-active member), main
// swaps, status guards, and the season_signups_player_only_when_added
// CHECK. Lives in the RLS suite because it needs the live local stack and
// the function's authorization is RLS-driven.
//
// Each test runs in one rolled-back transaction: fixture writes happen as
// postgres (bypasses RLS), the function call happens as the team 1 officer,
// assertions happen back as postgres. Every case mints the signup it
// promotes and any character it swaps out (#1123); the seeded signups and
// players are never written.
import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool, withTxn as withSharedTxn, seedPlayer, seedSeason, seedSignup, seedTeam, OFFICER_T1 } from './helpers.js';

// The signup every case promotes: approved, class_spec 1, minted per case
// under a name this file alone uses, so the upsert cases can plant a
// same-name character first.
const APPROVED_NAME = 'Promoted-Illidan';
const approvedSignup = (q, teamId = 1) => seedSignup(q, { teamId, nameRealm: APPROVED_NAME });

// Wraps the shared harness: asOfficer runs one statement as the team 1
// officer, then restores postgres. asUser is the shared caller, for the one
// case that acts on a minted team as that team's officer.
async function withTxn(fn) {
  return withSharedTxn(({ q, asUser }) => fn(q, (text, params) => asUser(OFFICER_T1, text, params), asUser));
}

const promote = (asOfficer, signupId, isTrial = true, archiveId = null) =>
  asOfficer('select public.add_signup_to_roster($1, $2, $3) as player_id', [signupId, isTrial, archiveId]);

describe('promotion of an approved signup', () => {
  it('creates the player and completes the signup', async () => {
    await withTxn(async (q, asOfficer) => {
      const signupId = await approvedSignup(q);
      const res = await promote(asOfficer, signupId);
      const playerId = res.rows[0].player_id;

      const player = (await q('select * from public.players where id = $1', [playerId])).rows[0];
      expect(player.name_realm).toBe(APPROVED_NAME);
      expect(player.team_id).toBe(1);
      expect(player.is_trial).toBe(true);
      expect(player.class_spec_id).toBe(1);
      expect(player.archived_at).toBeNull();

      const signup = (await q('select * from public.season_signups where id = $1', [signupId])).rows[0];
      expect(signup.status).toBe('added');
      expect(signup.approved_player_id).toBe(playerId);
    });
  });

  it("sets a new character's join_date to today in America/New_York, not the session's UTC current_date (20260806230556)", async () => {
    await withTxn(async (q, asOfficer) => {
      const signupId = await approvedSignup(q);
      const res = await promote(asOfficer, signupId);
      const playerId = res.rows[0].player_id;

      const player = (await q('select join_date::text as join_date_text from public.players where id = $1', [playerId]))
        .rows[0];
      const expected = (await q(`select (now() at time zone 'America/New_York')::date::text as today`)).rows[0].today;
      expect(player.join_date_text).toBe(expected);
    });
  });

  it('removes the signup from pending_roster and incoming_roster', async () => {
    await withTxn(async (q, asOfficer) => {
      const signupId = await approvedSignup(q);
      // incoming_roster lists the tiers the team has signups open for (#934).
      await q("insert into public.team_seasons (team_id, season_code, signups_open) values (1, 'seed-season', true)");
      const before = await asOfficer('select count(*)::int as n from public.pending_roster where signup_id = $1', [
        signupId
      ]);
      expect(before.rows[0].n).toBe(1);
      const beforeIncoming = await q('select count(*)::int as n from public.incoming_roster where signup_id = $1', [
        signupId
      ]);
      expect(beforeIncoming.rows[0].n).toBe(1);

      await promote(asOfficer, signupId);

      const after = await asOfficer('select count(*)::int as n from public.pending_roster where signup_id = $1', [
        signupId
      ]);
      expect(after.rows[0].n).toBe(0);
      const afterIncoming = await q('select count(*)::int as n from public.incoming_roster where signup_id = $1', [
        signupId
      ]);
      expect(afterIncoming.rows[0].n).toBe(0);
    });
  });

  it('rejects signups that are not approved', async () => {
    await withTxn(async (q, asOfficer) => {
      const pending = await seedSignup(q, { teamId: 1, nameRealm: 'Stillpending-Illidan', status: 'pending' });
      await expect(promote(asOfficer, pending)).rejects.toThrow(/not in approved status/);
    });
  });

  it('rejects a second promotion of the same signup', async () => {
    await withTxn(async (q, asOfficer) => {
      const signupId = await approvedSignup(q);
      await promote(asOfficer, signupId);
      await expect(promote(asOfficer, signupId)).rejects.toThrow(/not in approved status/);
    });
  });
});

describe('upsert cases on (team_id, name_realm)', () => {
  it('returning archived character: unarchives and refreshes trial/join_date', async () => {
    await withTxn(async (q, asOfficer) => {
      const signupId = await approvedSignup(q);
      const old = await q(
        `insert into public.players (team_id, name_realm, class_spec_id, is_trial, join_date, archived_at)
         values (1, $1, 1, false, '2025-01-01', now()) returning id`,
        [APPROVED_NAME]
      );
      const oldId = old.rows[0].id;

      const res = await promote(asOfficer, signupId);
      expect(res.rows[0].player_id).toBe(oldId);

      const player = (await q('select *, join_date::text as join_date_text from public.players where id = $1', [oldId]))
        .rows[0];
      expect(player.archived_at).toBeNull();
      expect(player.is_trial).toBe(true);
      expect(player.join_date_text).not.toBe('2025-01-01');
    });
  });

  it('already-active member: links without resetting trial or join_date', async () => {
    await withTxn(async (q, asOfficer) => {
      const signupId = await approvedSignup(q);
      const active = await q(
        `insert into public.players (team_id, name_realm, class_spec_id, is_trial, join_date)
         values (1, $1, 1, false, '2025-01-01') returning id`,
        [APPROVED_NAME]
      );
      const activeId = active.rows[0].id;

      const res = await promote(asOfficer, signupId);
      expect(res.rows[0].player_id).toBe(activeId);

      const player = (
        await q('select *, join_date::text as join_date_text from public.players where id = $1', [activeId])
      ).rows[0];
      expect(player.is_trial).toBe(false);
      expect(player.join_date_text).toBe('2025-01-01');
      expect(player.archived_at).toBeNull();

      const signup = (await q('select approved_player_id from public.season_signups where id = $1', [signupId]))
        .rows[0];
      expect(signup.approved_player_id).toBe(activeId);
    });
  });
});

describe('main swap archiving', () => {
  it('archives the old character on the same team', async () => {
    await withTxn(async (q, asOfficer) => {
      const signupId = await approvedSignup(q);
      const oldId = await seedPlayer(q, { teamId: 1 });
      await promote(asOfficer, signupId, true, oldId);
      const old = (await q('select archived_at from public.players where id = $1', [oldId])).rows[0];
      expect(old.archived_at).not.toBeNull();
    });
  });

  it("cannot archive another team's player", async () => {
    await withTxn(async (q, asOfficer) => {
      const signupId = await approvedSignup(q);
      const otherId = await seedPlayer(q, { teamId: 2 });
      await promote(asOfficer, signupId, true, otherId);
      const other = (await q('select archived_at from public.players where id = $1', [otherId])).rows[0];
      expect(other.archived_at).toBeNull();
    });
  });

  it("carries the old character's join_date to the new one instead of resetting to today", async () => {
    await withTxn(async (q, asOfficer) => {
      const signupId = await approvedSignup(q);
      const old = await q(
        `insert into public.players (team_id, name_realm, class_spec_id, join_date)
         values (1, 'Oldmain-Illidan', 1, '2024-03-15') returning id`
      );
      const oldId = old.rows[0].id;

      const res = await promote(asOfficer, signupId, true, oldId);
      const newId = res.rows[0].player_id;

      const newPlayer = (await q('select join_date::text as join_date_text from public.players where id = $1', [newId]))
        .rows[0];
      expect(newPlayer.join_date_text).toBe('2024-03-15');
    });
  });

  it("swap onto a reactivated same-name-realm alt still carries the swapped-from join_date, not the alt's own pre-archive date", async () => {
    // The on-conflict reactivation path (see 'returning archived character'
    // above) already refreshes join_date to today on its own, discarding
    // whatever the alt's own original date was -- so there's no "restore the
    // alt's own history" behavior to preserve here. The swap-carry logic then
    // overwrites that today's-date with the swapped-from character's date,
    // same as the plain-insert case, keeping "main swap = continuation of
    // tenure" true even when the destination happens to be a known alt.
    await withTxn(async (q, asOfficer) => {
      const signupId = await approvedSignup(q);
      const old = await q(
        `insert into public.players (team_id, name_realm, class_spec_id, join_date)
         values (1, 'Oldmain2-Illidan', 1, '2024-03-15') returning id`
      );
      const oldId = old.rows[0].id;
      await q(
        `insert into public.players (team_id, name_realm, class_spec_id, join_date, archived_at)
         values (1, $1, 1, '2023-06-01', now())`,
        [APPROVED_NAME]
      );

      const res = await promote(asOfficer, signupId, true, oldId);
      const newId = res.rows[0].player_id;

      const newPlayer = (await q('select join_date::text as join_date_text from public.players where id = $1', [newId]))
        .rows[0];
      expect(newPlayer.join_date_text).toBe('2024-03-15');
    });
  });

  it("carries the old character's attendance rows to the new one (20260828122750)", async () => {
    await withTxn(async (q, asOfficer) => {
      const signupId = await approvedSignup(q);
      const old = await q(
        `insert into public.players (team_id, name_realm, class_spec_id, join_date)
         values (1, 'Oldmain3-Illidan', 1, '2024-03-15') returning id`
      );
      const oldId = old.rows[0].id;
      await q(
        `insert into public.attendance (team_id, player_id, raid_date, status)
         values (1, $1, '2026-08-01', 'Present'), (1, $1, '2026-08-08', 'Present')`,
        [oldId]
      );

      const res = await promote(asOfficer, signupId, true, oldId);
      const newId = res.rows[0].player_id;

      const oldRows = await q('select count(*)::int as n from public.attendance where player_id = $1', [oldId]);
      expect(oldRows.rows[0].n).toBe(0);
      const newRows = await q(
        'select raid_date::text as raid_date from public.attendance where player_id = $1 order by raid_date',
        [newId]
      );
      expect(newRows.rows.map((r) => r.raid_date)).toEqual(['2026-08-01', '2026-08-08']);
    });
  });

  it('swap onto a reactivated alt with its own attendance keeps the alt row on colliding raid dates', async () => {
    await withTxn(async (q, asOfficer) => {
      const signupId = await approvedSignup(q);
      const old = await q(
        `insert into public.players (team_id, name_realm, class_spec_id, join_date)
         values (1, 'Oldmain4-Illidan', 1, '2024-03-15') returning id`
      );
      const oldId = old.rows[0].id;
      const alt = await q(
        `insert into public.players (team_id, name_realm, class_spec_id, join_date, archived_at)
         values (1, $1, 1, '2023-06-01', now()) returning id`,
        [APPROVED_NAME]
      );
      const altId = alt.rows[0].id;
      await q(
        `insert into public.attendance (team_id, player_id, raid_date, status)
         values (1, $1, '2026-08-01', 'No Show')`,
        [altId]
      );
      await q(
        `insert into public.attendance (team_id, player_id, raid_date, status)
         values (1, $1, '2026-08-01', 'Present'), (1, $1, '2026-08-08', 'Present')`,
        [oldId]
      );

      const res = await promote(asOfficer, signupId, true, oldId);
      const newId = res.rows[0].player_id;
      expect(newId).toBe(altId);

      const rows = await q(
        'select raid_date::text as raid_date, status from public.attendance where player_id = $1 order by raid_date',
        [newId]
      );
      expect(rows.rows).toEqual([
        { raid_date: '2026-08-01', status: 'No Show' },
        { raid_date: '2026-08-08', status: 'Present' }
      ]);
      const stranded = await q('select count(*)::int as n from public.attendance where player_id = $1', [oldId]);
      expect(stranded.rows[0].n).toBe(1);
    });
  });

  it("clears the old character's live-season priority_order rows, but leaves past seasons and other players alone (20260828124142)", async () => {
    // The live season is current_season() (#938), not a key on the team's
    // settings row, so the swap happens on a minted team with an empty config,
    // as that team's officer; the past season is a tier the case mints.
    await withTxn(async (q, asOfficer, asUser) => {
      const { teamId, officer } = await seedTeam(q);
      const live = (await q('select public.current_season() as code')).rows[0].code;
      const past = `P${randomUUID().replace(/-/g, '').slice(0, 6)}`;
      await seedSeason(q, past);
      const signupId = await approvedSignup(q, teamId);

      const oldId = await seedPlayer(q, { teamId, nameRealm: 'Oldmain5-Illidan' });
      await q(
        `insert into public.priority_order (team_id, season, item_id, track, rank, player_id)
         values ($1, $3, 1, 'Hero', 1, $2), ($1, $4, 1, 'Hero', 1, $2)`,
        [teamId, oldId, live, past]
      );
      // A different, non-swapped player on the same team -- their live-season
      // row must survive untouched.
      const otherId = await seedPlayer(q, { teamId });
      await q(
        `insert into public.priority_order (team_id, season, item_id, track, rank, player_id)
         values ($1, $3, 1, 'Hero', 2, $2)`,
        [teamId, otherId, live]
      );

      await asUser(officer.uid, 'select public.add_signup_to_roster($1, $2, $3)', [signupId, true, oldId]);

      const rows = await q('select season from public.priority_order where player_id = $1 order by season', [oldId]);
      expect(rows.rows.map((r) => r.season)).toEqual([past]);

      const otherPlayer = await q(
        'select count(*)::int as n from public.priority_order where player_id = $1 and season = $2',
        [otherId, live]
      );
      expect(otherPlayer.rows[0].n).toBe(1);
    });
  });
});

describe('season_signups_player_only_when_added CHECK', () => {
  it('rejects a player link on a non-added signup', async () => {
    await withTxn(async (q) => {
      const pending = await seedSignup(q, { teamId: 1, nameRealm: 'Stillpending-Illidan', status: 'pending' });
      const playerId = await seedPlayer(q, { teamId: 1 });
      // 23514 = check_violation
      await expect(
        q('update public.season_signups set approved_player_id = $2 where id = $1', [pending, playerId])
      ).rejects.toMatchObject({
        code: '23514'
      });
    });
  });
});

afterAll(() => pool.end());
