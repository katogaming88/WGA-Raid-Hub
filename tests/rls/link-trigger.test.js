// Behavior tests for link_auth_user_to_member() (#1118, moved in #1135).
//
// The trigger fills auth_user_id on any unlinked grant row whose discord_id
// matches the account's Discord id. It used to fire on auth.users and read
// raw_user_meta_data ->> 'provider_id', a column the account itself can write,
// so it decided who holds a grant on a value the signup supplied. #1118 guarded
// that with raw_app_meta_data; #1135 removes the question by moving the trigger
// onto auth.identities, where provider and provider_id are the row itself and
// only the OAuth exchange writes them.
//
// after insert, so the fixtures write the grant rows first and the identity row
// last: write order is what decides whether the trigger is the subject
// (2026-09-03). Each case asserts the four rows start unlinked, so a fixture
// that links them by some other route fails the setup instead of passing the
// test for the wrong reason.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, insertDiscordUser, grantGuild } from './helpers.js';

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
const NO_IDENTITY = 'discord-guard-noidentity-1';
const NO_IDENTITY_UID = '00000000-0000-0000-0000-0000000000e3';

// One unlinked team_members row and one of each guild grant. Since #942 step 2
// the grants reach their account through the person, so the three grant names
// are read back through their views.
async function addGrants(q, discordId) {
  await q('insert into public.team_members (team_id, discord_id, role) values ($1, $2, $3)', [
    WRATHLESS,
    discordId,
    'officer'
  ]);
  await grantGuild(q, discordId, 'site_admin');
  await grantGuild(q, discordId, 'guild_officer');
  await grantGuild(q, discordId, 'boe_manager');
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

describe('link_auth_user_to_member() links on the identity row (#1118, #1135)', () => {
  // Two of these four are green on both sides of #1135 and are marked as such:
  // they are the regression guards that the linking still works and still
  // refuses email. The two that discriminate are the ones that separate the
  // account row from the identity row, since that separation is the change.
  it('links on the identity even when the account metadata claims nothing', async () => {
    await withTxn(async ({ q }) => {
      const uid = '00000000-0000-0000-0000-0000000000e4';
      const discordId = 'discord-guard-identity-only-1';
      await addGrants(q, discordId);
      expect(await grantLinks(q, discordId)).toEqual(allNull);

      // No Discord stamp in raw_app_meta_data: the identity row is the only
      // thing saying who this is, which is exactly the point of the move.
      await q(
        `insert into auth.users (id, raw_app_meta_data, raw_user_meta_data)
         values ($1, '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb)`,
        [uid]
      );
      await q(
        `insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
         values ($1::text, $2::uuid, jsonb_build_object('sub', $3::text), 'discord', now(), now())`,
        [discordId, uid, uid]
      );

      expect(await grantLinks(q, discordId)).toEqual(allLinkedTo(uid));
    });
  });

  it('(control) links all four grant tables for an ordinary Discord account', async () => {
    await withTxn(async ({ q }) => {
      await addGrants(q, DISCORD_SIGNUP);
      expect(await grantLinks(q, DISCORD_SIGNUP)).toEqual(allNull);

      await insertDiscordUser(q, DISCORD_SIGNUP_UID, DISCORD_SIGNUP);

      expect(await grantLinks(q, DISCORD_SIGNUP)).toEqual(allLinkedTo(DISCORD_SIGNUP_UID));
    });
  });

  it('(control) links nothing for a non-Discord identity carrying the same id', async () => {
    await withTxn(async ({ q }) => {
      await addGrants(q, EMAIL_SIGNUP);
      expect(await grantLinks(q, EMAIL_SIGNUP)).toEqual(allNull);

      await q('insert into auth.users (id) values ($1)', [EMAIL_SIGNUP_UID]);
      await q(
        `insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
         values ($1::text, $2::uuid, jsonb_build_object('sub', $3::text), 'email', now(), now())`,
        [EMAIL_SIGNUP, EMAIL_SIGNUP_UID, EMAIL_SIGNUP_UID]
      );

      expect(await grantLinks(q, EMAIL_SIGNUP)).toEqual(allNull);
    });
  });

  it('links nothing for an account row with no identity behind it', async () => {
    await withTxn(async ({ q }) => {
      await addGrants(q, NO_IDENTITY);
      expect(await grantLinks(q, NO_IDENTITY)).toEqual(allNull);

      // The whole point of the move: an auth.users row is not proof of
      // anything, whatever its metadata says, so it links nothing on its own.
      await q(
        `insert into auth.users (id, raw_app_meta_data, raw_user_meta_data)
         values ($1, '{"provider":"discord","providers":["discord"]}'::jsonb,
                 jsonb_build_object('provider_id', $2::text))`,
        [NO_IDENTITY_UID, NO_IDENTITY]
      );

      expect(await grantLinks(q, NO_IDENTITY)).toEqual(allNull);
    });
  });
});
