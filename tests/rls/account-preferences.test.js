// Behavior tests for account_preferences (#940): the per-account preferences
// store that replaced no_character_dismissals (#512) and the browser-only
// notifications "cleared through" marker. Covers the own-rows-only RLS rule,
// the key/team_id CHECK, the guild-wide unique key, and the trigger that
// clears the "no character" dismissal once the account claims a character,
// through both claim_character() and add_signup_to_roster()'s main swap.
//
// Each test runs in one rolled-back transaction (helpers.js withTxn): fixture
// writes happen as postgres (bypasses RLS), impersonated calls happen as the
// caller, and assertions happen back as postgres. A savepoint wraps each
// impersonated call so an expected raise does not abort the whole transaction.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedPlayer, seedSignup, RAIDER_T1, OFFICER_T1 } from './helpers.js';

// Seeded rows this file leans on (supabase/seed.sql): team_members 3 is the
// team 1 raider (auth_user_id = RAIDER_T1) and 1 is the team 1 officer. The
// characters and the signup the trigger cases link are minted per case
// (#1123), so no case writes a seeded players row.
const RAIDER_T1_MEMBER = 3;
const OFFICER_T1_MEMBER = 1;
const OTHER = '00000000-0000-0000-0000-0000000000ef';

const addAuthUser = (q, uid, providerId) =>
  q('insert into auth.users (id, raw_user_meta_data) values ($1, $2)', [
    uid,
    JSON.stringify({ provider_id: providerId })
  ]);

const dismiss = (run, uid) =>
  run(
    "insert into public.account_preferences (auth_user_id, team_id, key, value) values ($1, null, 'no_character_dismissed', 'true')",
    [uid]
  );

const dismissalCount = async (q, uid) =>
  (
    await q(
      "select count(*)::int as n from public.account_preferences where auth_user_id = $1 and key = 'no_character_dismissed'",
      [uid]
    )
  ).rows[0].n;

describe('account_preferences replaces no_character_dismissals', () => {
  it('the old table is gone', async () => {
    await withTxn(async ({ q }) => {
      const res = await q("select count(*)::int as n from pg_class where relname = 'no_character_dismissals'");
      expect(res.rows[0].n).toBe(0);
    });
  });
});

describe('account_preferences own-rows RLS', () => {
  it('a raider can set and then read their own guild-wide key', async () => {
    await withTxn(async ({ asUser }) => {
      await dismiss((text, params) => asUser(RAIDER_T1, text, params), RAIDER_T1);
      const res = await asUser(RAIDER_T1, 'select auth_user_id, team_id, key from public.account_preferences');
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].auth_user_id).toBe(RAIDER_T1);
      expect(res.rows[0].team_id).toBeNull();
    });
  });

  it('a raider can upsert a per-team key and update its value', async () => {
    await withTxn(async ({ asUser }) => {
      const upsert = (v) =>
        asUser(
          RAIDER_T1,
          `insert into public.account_preferences (auth_user_id, team_id, key, value)
           values ($1, 1, 'notifications_cleared_through', $2::jsonb)
           on conflict (auth_user_id, team_id, key) do update set value = excluded.value`,
          [RAIDER_T1, String(v)]
        );
      await upsert(10);
      await upsert(25);
      const res = await asUser(
        RAIDER_T1,
        "select value from public.account_preferences where key = 'notifications_cleared_through'"
      );
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].value).toBe(25);
    });
  });

  it('a raider cannot write a row for a different account', async () => {
    await withTxn(async ({ q, asUser }) => {
      await addAuthUser(q, OTHER, 'discord-other-pref');
      await expect(dismiss((text, params) => asUser(RAIDER_T1, text, params), OTHER)).rejects.toThrow();
    });
  });

  it("a raider does not see another account's rows", async () => {
    await withTxn(async ({ q, asUser }) => {
      await addAuthUser(q, OTHER, 'discord-other-pref');
      await dismiss(q, OTHER);
      const res = await asUser(RAIDER_T1, 'select key from public.account_preferences where auth_user_id = $1', [
        OTHER
      ]);
      expect(res.rows).toHaveLength(0);
    });
  });

  it('anon cannot write or read any row', async () => {
    await withTxn(async ({ q, asAnon }) => {
      await dismiss(q, RAIDER_T1);
      await expect(dismiss(asAnon, RAIDER_T1)).rejects.toThrow();
      const res = await asAnon('select key from public.account_preferences');
      expect(res.rows).toHaveLength(0);
    });
  });
});

describe('account_preferences shape', () => {
  it('rejects a key that is not on the allowed list', async () => {
    await withTxn(async ({ q }) => {
      await expect(
        q(
          "insert into public.account_preferences (auth_user_id, team_id, key, value) values ($1, null, 'made_up_key', 'true')",
          [RAIDER_T1]
        )
      ).rejects.toThrow(/check/i);
    });
  });

  it('keeps the guild-wide key guild-wide and the per-team key per team', async () => {
    await withTxn(async ({ q }) => {
      await expect(
        q(
          "insert into public.account_preferences (auth_user_id, team_id, key, value) values ($1, 1, 'no_character_dismissed', 'true')",
          [RAIDER_T1]
        )
      ).rejects.toThrow(/check/i);
    });
    await withTxn(async ({ q }) => {
      await expect(
        q(
          "insert into public.account_preferences (auth_user_id, team_id, key, value) values ($1, null, 'notifications_cleared_through', '5')",
          [RAIDER_T1]
        )
      ).rejects.toThrow(/check/i);
    });
  });

  it("accepts the client's guild-wide upsert twice, which is how a double-click lands", async () => {
    await withTxn(async ({ asUser }) => {
      const upsert = () =>
        asUser(
          RAIDER_T1,
          `insert into public.account_preferences (auth_user_id, team_id, key, value)
           values ($1, null, 'no_character_dismissed', 'true')
           on conflict (auth_user_id, team_id, key) do nothing`,
          [RAIDER_T1]
        );
      await upsert();
      await upsert();
      const res = await asUser(RAIDER_T1, 'select count(*)::int as n from public.account_preferences');
      expect(res.rows[0].n).toBe(1);
    });
  });

  it('holds one guild-wide row per account and key, even though team_id is null', async () => {
    await withTxn(async ({ q }) => {
      await dismiss(q, RAIDER_T1);
      await expect(dismiss(q, RAIDER_T1)).rejects.toThrow(/duplicate key/);
    });
  });
});

describe('claiming a character clears the no-character dismissal', () => {
  it('through claim_character()', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedPlayer(q, { teamId: 1, nameRealm: 'Dismissclaim-Illidan' });
      await dismiss(q, RAIDER_T1);
      await asUser(RAIDER_T1, 'select * from public.claim_character($1, $2)', [1, 'Dismissclaim-Illidan']);
      expect(await dismissalCount(q, RAIDER_T1)).toBe(0);
    });
  });

  it("through add_signup_to_roster()'s main swap, which carries the link to the new character", async () => {
    await withTxn(async ({ q, asUser }) => {
      const oldCharacter = await seedPlayer(q, { memberId: RAIDER_T1_MEMBER });
      const signup = await seedSignup(q, { teamId: 1 });
      await dismiss(q, RAIDER_T1);
      await asUser(OFFICER_T1, 'select public.add_signup_to_roster($1, $2, $3)', [signup, true, oldCharacter]);
      expect(await dismissalCount(q, RAIDER_T1)).toBe(0);
    });
  });

  it('unlinking a character does not touch the dismissal', async () => {
    await withTxn(async ({ q }) => {
      const mine = await seedPlayer(q, { memberId: RAIDER_T1_MEMBER });
      await dismiss(q, RAIDER_T1);
      await q('update public.players set team_member_id = null where id = $1', [mine]);
      expect(await dismissalCount(q, RAIDER_T1)).toBe(1);
    });
  });

  it("linking someone else's character leaves this account's dismissal alone", async () => {
    await withTxn(async ({ q }) => {
      const theirs = await seedPlayer(q, { teamId: 1 });
      await dismiss(q, RAIDER_T1);
      await q('update public.players set team_member_id = $1 where id = $2', [OFFICER_T1_MEMBER, theirs]);
      expect(await dismissalCount(q, RAIDER_T1)).toBe(1);
    });
  });
});

afterAll(() => pool.end());
