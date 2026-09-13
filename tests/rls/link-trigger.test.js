// Behavior tests for the provider guard on link_auth_user_to_member() (#1118).
//
// The trigger fills auth_user_id on any unlinked grant row whose discord_id
// matches the new account's raw_user_meta_data ->> 'provider_id'. That column
// is writable by the account it belongs to, so before this guard the trigger
// decided who holds a grant on a value the signup supplied. It now runs only
// for an account GoTrue stamped as a Discord signup, in raw_app_meta_data,
// which is service-role-only.
//
// after insert, so the fixtures write the grant rows first and the auth.users
// row last: write order is what decides whether the trigger is the subject
// (2026-09-03). Each case asserts the four rows start unlinked, so a fixture
// that links them by some other route fails the setup instead of passing the
// test for the wrong reason.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn } from './helpers.js';

afterAll(() => pool.end());

// Team 4 'Wrathless' (20260826220829) has no members and no players, so a
// team_members row here collides with nothing seeded.
const WRATHLESS = 4;

// Invented here. No other file in the suite uses these ids, so the rows one
// case writes are never the rows another worker is reading.
const DISCORD_SIGNUP = 'discord-guard-discord-1';
const DISCORD_SIGNUP_UID = '00000000-0000-0000-0000-0000000000e1';
const EMAIL_SIGNUP = 'discord-guard-email-1';
const EMAIL_SIGNUP_UID = '00000000-0000-0000-0000-0000000000e2';
const NO_META = 'discord-guard-nometa-1';
const NO_META_UID = '00000000-0000-0000-0000-0000000000e3';

const DISCORD_APP_META = '{"provider":"discord","providers":["discord"]}';
const EMAIL_APP_META = '{"provider":"email","providers":["email"]}';

// One unlinked row in each of the four tables the trigger writes.
async function addGrants(q, discordId) {
  await q('insert into public.team_members (team_id, discord_id, role) values ($1, $2, $3)', [
    WRATHLESS,
    discordId,
    'officer'
  ]);
  await q('insert into public.site_admins (discord_id) values ($1)', [discordId]);
  await q('insert into public.guild_officers (discord_id) values ($1)', [discordId]);
  await q('insert into public.boe_managers (discord_id) values ($1)', [discordId]);
}

// The four auth_user_id values, in one shape, so a case reads them together.
async function grantLinks(q, discordId) {
  const rows = await Promise.all(
    ['team_members', 'site_admins', 'guild_officers', 'boe_managers'].map((table) =>
      q(`select auth_user_id from public.${table} where discord_id = $1`, [discordId]).then((r) => r.rows[0])
    )
  );
  return {
    team_members: rows[0].auth_user_id,
    site_admins: rows[1].auth_user_id,
    guild_officers: rows[2].auth_user_id,
    boe_managers: rows[3].auth_user_id
  };
}

const allNull = { team_members: null, site_admins: null, guild_officers: null, boe_managers: null };
const allLinkedTo = (uid) => ({
  team_members: uid,
  site_admins: uid,
  guild_officers: uid,
  boe_managers: uid
});

// The ::text casts are required: node-pg cannot infer a type for a parameter
// used only inside jsonb_build_object (#889).
const addAuthUser = (q, uid, discordId, appMeta) =>
  q(
    'insert into auth.users (id, raw_app_meta_data, raw_user_meta_data) values ($1, $2::jsonb, jsonb_build_object($3::text, $4::text))',
    [uid, appMeta, 'provider_id', discordId]
  );

describe('link_auth_user_to_member() links only a Discord-provider account (#1118)', () => {
  it('links all four grant tables for a Discord signup', async () => {
    await withTxn(async ({ q }) => {
      await addGrants(q, DISCORD_SIGNUP);
      expect(await grantLinks(q, DISCORD_SIGNUP)).toEqual(allNull);

      await addAuthUser(q, DISCORD_SIGNUP_UID, DISCORD_SIGNUP, DISCORD_APP_META);

      expect(await grantLinks(q, DISCORD_SIGNUP)).toEqual(allLinkedTo(DISCORD_SIGNUP_UID));
    });
  });

  it('links nothing for an email signup carrying the same Discord id', async () => {
    await withTxn(async ({ q }) => {
      await addGrants(q, EMAIL_SIGNUP);
      expect(await grantLinks(q, EMAIL_SIGNUP)).toEqual(allNull);

      await addAuthUser(q, EMAIL_SIGNUP_UID, EMAIL_SIGNUP, EMAIL_APP_META);

      expect(await grantLinks(q, EMAIL_SIGNUP)).toEqual(allNull);
    });
  });

  it('links nothing for an account with no raw_app_meta_data at all', async () => {
    await withTxn(async ({ q }) => {
      await addGrants(q, NO_META);
      expect(await grantLinks(q, NO_META)).toEqual(allNull);

      // No raw_app_meta_data column in the insert, the shape boe.test.js's
      // addNoDiscordRaider already writes: the guard reads null, not 'discord'.
      await q('insert into auth.users (id, raw_user_meta_data) values ($1, jsonb_build_object($2::text, $3::text))', [
        NO_META_UID,
        'provider_id',
        NO_META
      ]);

      expect(await grantLinks(q, NO_META)).toEqual(allNull);
    });
  });
});
