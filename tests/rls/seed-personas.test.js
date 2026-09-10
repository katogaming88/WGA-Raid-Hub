// The seeded identities are sign-in-able people, not just ids (#1053).
//
// Before this the seven auth.users rows carried an id and nothing else, which
// was all tests/rls needed: it impersonates through request.jwt.claims inside a
// rolled-back transaction and never authenticates. A browser cannot do that, so
// once the site runs against the local stack (#1052) every page shows the
// signed-out view unless these rows can be issued a link.
//
// What is asserted here is the agreement between three places that have to
// match and can drift independently: the auth.users row, the grant row it is
// meant to be, and the naming scheme a snapshot mints from the teams table
// (#1065), which the seed follows by hand so one name means one person on
// either stack. The link
// trigger keys on provider_id matching discord_id, so a mismatch would show as
// a person signing in successfully and then having no access at all, which
// reads as broken policies rather than a bad fixture.
import { describe, it, expect, afterAll } from 'vitest';
import { pool } from './helpers.js';
import { resolveTarget } from '../../scripts/dev/local-login.js';

afterAll(() => pool.end());

// Every seeded auth user, with the grant row that names the same person. The
// left join is the point: one seeded user (the season_signups owner) has no
// grant row at all, and that is a real state rather than a gap.
const USERS = `
  select u.id,
         u.email,
         u.aud,
         u.role,
         u.raw_user_meta_data ->> 'provider_id' as provider_id,
         u.confirmation_token,
         u.recovery_token,
         u.email_change,
         u.email_change_token_new,
         coalesce(tm.discord_id, sa.discord_id, go.discord_id) as grant_discord_id
    from auth.users u
    left join public.team_members  tm on tm.auth_user_id = u.id
    left join public.site_admins   sa on sa.auth_user_id = u.id
    left join public.guild_officers go on go.auth_user_id = u.id
   order by u.id
`;

describe('seeded personas (#1053)', () => {
  it('seeds the identities the RLS suite documents, so the assertions below have a subject', async () => {
    // rls-pool-read-only: reads the seeded identities, writes nothing.
    const { rows } = await pool.query(USERS);
    expect(rows.length).toBe(7);
  });

  it('gives every seeded user an email, which is what a link is issued against', async () => {
    // rls-pool-read-only: reads the seeded identities, writes nothing.
    const { rows } = await pool.query(USERS);
    expect(rows.filter((r) => !r.email).map((r) => r.id)).toEqual([]);
  });

  it('gives every seeded user the aud and role the auth service expects', async () => {
    // rls-pool-read-only: reads the seeded identities, writes nothing.
    const { rows } = await pool.query(USERS);
    expect(rows.filter((r) => r.aud !== 'authenticated' || r.role !== 'authenticated')).toEqual([]);
  });

  it('leaves no token column null, which the auth service cannot scan', async () => {
    // GoTrue reads these into plain strings, so a NULL is a 500 on sign-in
    // rather than a validation error. The columns with an empty-string default
    // are already safe; these four have no default.
    // rls-pool-read-only: reads the seeded identities, writes nothing.
    const { rows } = await pool.query(USERS);
    const nulls = rows
      .filter(
        (r) =>
          r.confirmation_token === null ||
          r.recovery_token === null ||
          r.email_change === null ||
          r.email_change_token_new === null
      )
      .map((r) => r.id);
    expect(nulls).toEqual([]);
  });

  it('matches each user provider_id to the discord_id of the grant row it stands for', async () => {
    // The link trigger (link_auth_user_to_member) keys on exactly this, so a
    // mismatch is an account that signs in and can see nothing.
    // rls-pool-read-only: reads the seeded identities, writes nothing.
    const { rows } = await pool.query(USERS);
    const granted = rows.filter((r) => r.grant_discord_id !== null);
    expect(granted.length).toBeGreaterThan(4);
    expect(granted.filter((r) => r.provider_id !== r.grant_discord_id).map((r) => r.id)).toEqual([]);
  });

  it('gives every user an identities row, so the account looks like one that signed in', async () => {
    // rls-pool-read-only: reads the seeded identities, writes nothing.
    const { rows } = await pool.query(
      'select u.id from auth.users u left join auth.identities i on i.user_id = u.id where i.user_id is null'
    );
    expect(rows.map((r) => r.id)).toEqual([]);
  });

  it('is reachable by name through the login script, which builds the address from it', async () => {
    // The static persona table is gone (#1065): any name resolves to its
    // wga.local address and the running stack says whether it exists. So what
    // has to hold is that every seeded address is one the script can build.
    // rls-pool-read-only: reads the seeded identities, writes nothing.
    const { rows } = await pool.query(USERS);
    for (const { email } of rows) {
      const name = email.replace(/@wga\.local$/, '');
      expect(resolveTarget({ persona: name }).email).toBe(email);
    }
  });

  it('names every team member the way a snapshot would, so one vocabulary covers both stacks', async () => {
    // A snapshot mints <slug>-officer, <slug>-leader and <slug>-raider from
    // the teams table (#1065). The seed follows the same scheme by hand, and
    // this is what stops the two from drifting apart: phoenix-officer has to
    // mean the same person after a reset and after a snapshot. The one seeded
    // team member named for a guild-wide grant instead (guild-officer, a
    // raider who holds guild_officers) is excluded, since the grant is what it
    // stands for.
    // rls-pool-read-only: reads the seeded identities, writes nothing.
    const { rows } = await pool.query(`
      select u.email, t.slug, tm.role
        from auth.users u
        join public.team_members tm on tm.auth_user_id = u.id
        join public.teams t on t.id = tm.team_id
        left join public.guild_officers go on go.auth_user_id = u.id
        left join public.site_admins sa on sa.auth_user_id = u.id
       where go.id is null and sa.id is null
       order by u.email
    `);
    expect(rows.length).toBeGreaterThan(2);
    const short = { officer: 'officer', team_leader: 'leader', raider: 'raider' };
    for (const { email, slug, role } of rows) {
      expect(email).toBe(`${slug}-${short[role]}@wga.local`);
    }
  });
});
