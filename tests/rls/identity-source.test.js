// #1135: identity resolves from auth.identities, not from user metadata.
//
// auth.users.raw_user_meta_data is writable by the account itself through the
// auth API, so a check keyed on it says what an account claims. auth.identities
// is written only by the OAuth exchange. #1117 and #1118 guarded the two routes
// that reached a grant through the metadata; these cases retire the read.
//
// The fixture throughout is one account whose two records disagree: its
// identity row proves 'discord-forger', its metadata claims 'discord-raider-1',
// the seeded team 1 raider. Every case asks which one the schema believes.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, insertDiscordUser, SITE_ADMIN } from './helpers.js';

afterAll(() => pool.end());

const FORGER = '00000000-0000-0000-0000-0000000f1135';
const NO_IDENTITY = '00000000-0000-0000-0000-0000000f1136';
const FORGER_DISCORD = 'discord-forger';
// Seeded: team 1 member 3, the raider the forger's metadata impersonates.
const RAIDER_DISCORD = 'discord-raider-1';

// The account this arc is about. Identity says one thing, metadata another.
const addForger = (q) => insertDiscordUser(q, FORGER, FORGER_DISCORD, RAIDER_DISCORD);

// An account with metadata and no identity row at all: what a non-Discord
// signup looks like, and what every identity read must refuse to resolve.
const addMetadataOnly = (q) =>
  q(
    `insert into auth.users (id, raw_app_meta_data, raw_user_meta_data)
     values ($1, '{"provider":"email","providers":["email"]}'::jsonb,
             jsonb_build_object('provider_id', 'discord-ghost'))`,
    [NO_IDENTITY]
  );

describe('current_discord_id() reads the identity row', () => {
  it('answers the identity row when metadata disagrees with it', async () => {
    await withTxn(async ({ q, asUser }) => {
      await addForger(q);
      const res = await asUser(FORGER, 'select public.current_discord_id() as id');
      expect(res.rows[0].id).toBe(FORGER_DISCORD);
    });
  });

  it('answers null for an account with metadata and no Discord identity', async () => {
    await withTxn(async ({ q, asUser }) => {
      await addMetadataOnly(q);
      const res = await asUser(NO_IDENTITY, 'select public.current_discord_id() as id');
      expect(res.rows[0].id).toBeNull();
    });
  });
});

describe('the BoE raider reads follow the identity row', () => {
  // A find stamped with the raider's Discord id. The forger's metadata claims
  // that id, so before #1135 the policy hands them somebody else's row.
  const addFind = (q) =>
    q(
      `insert into public.boe_items (team_id, finder_name, finder_discord_id, item_name, track, upgrade_rank)
       values (1, 'Seedraider-Illidan', $1, 'Forged Test Item', 'Hero', '3/6')
       returning id`,
      [RAIDER_DISCORD]
    );

  it('boe_items: a forged Discord id does not read the real holder rows', async () => {
    await withTxn(async ({ q, asUser }) => {
      await addForger(q);
      const { rows } = await addFind(q);
      const seen = await asUser(FORGER, 'select id from public.boe_items where id = $1', [rows[0].id]);
      expect(seen.rowCount).toBe(0);
    });
  });

  it('boe_listings: the listings of a row it cannot read stay hidden too', async () => {
    await withTxn(async ({ q, asUser }) => {
      await addForger(q);
      const { rows } = await addFind(q);
      await q('insert into public.boe_listings (team_id, boe_item_id, price) values (1, $1, 100000)', [rows[0].id]);
      const seen = await asUser(FORGER, 'select id from public.boe_listings where boe_item_id = $1', [rows[0].id]);
      expect(seen.rowCount).toBe(0);
    });
  });

  it('submit_boe_found stamps the finder from the identity row', async () => {
    await withTxn(async ({ q, asUser }) => {
      await addForger(q);
      const res = await asUser(
        FORGER,
        "select public.submit_boe_found(1, 'Seedraider-Illidan', 'Forged Test Item', 'Hero', null, false, '3/6') as id"
      );
      const { rows } = await q('select finder_discord_id from public.boe_items where id = $1', [res.rows[0].id]);
      expect(rows[0].finder_discord_id).toBe(FORGER_DISCORD);
    });
  });
});

describe('resolve_person() does not take a forged claim as being that person', () => {
  // #1121 added the is_self gate, which decides both whether the caller is
  // refused outright and whether the site_admin and guild_officer flags are
  // returned. The forger holds no grant of any kind, so once is_self is honest
  // there is nothing left to authorize them.
  it('refuses a caller whose only claim to the person is its own metadata', async () => {
    await withTxn(async ({ q, asUser }) => {
      await addForger(q);
      await expect(asUser(FORGER, 'select public.resolve_person($1)', [RAIDER_DISCORD])).rejects.toThrow(
        /Not authorized/
      );
    });
  });
});

describe('claim_character() follows the identity row', () => {
  it('claims onto the identity Discord id, not the one the metadata names', async () => {
    await withTxn(async ({ q, asUser }) => {
      await addForger(q);
      await asUser(FORGER, "select * from public.claim_character(1, 'Seedplayertwo-Illidan')");
      const { rows } = await q('select discord_id from public.team_members where auth_user_id = $1', [FORGER]);
      expect(rows.map((r) => r.discord_id)).toEqual([FORGER_DISCORD]);
    });
  });

  it('refuses an account with no Discord identity rather than inventing a member row', async () => {
    await withTxn(async ({ q, asUser }) => {
      await addMetadataOnly(q);
      await expect(
        asUser(NO_IDENTITY, "select * from public.claim_character(1, 'Seedplayertwo-Illidan')")
      ).rejects.toThrow(/Discord/);
    });
  });
});

describe('the admin_grant_* RPCs resolve through the identity row', () => {
  const GRANTS = [
    ['admin_grant_site_admin', 'site_admins'],
    ['admin_grant_guild_officer', 'guild_officers'],
    ['admin_grant_boe_manager', 'boe_managers']
  ];

  for (const [fn, table] of GRANTS) {
    it(`${fn} links the account whose identity row carries the id`, async () => {
      await withTxn(async ({ q, asUser }) => {
        await addForger(q);
        await asUser(SITE_ADMIN, `select public.${fn}($1)`, [FORGER_DISCORD]);
        const { rows } = await q(`select auth_user_id from public.${table} where discord_id = $1`, [FORGER_DISCORD]);
        expect(rows[0].auth_user_id).toBe(FORGER);
      });
    });

    it(`${fn} leaves the link null when only metadata carries the id`, async () => {
      await withTxn(async ({ q, asUser }) => {
        await addMetadataOnly(q);
        await asUser(SITE_ADMIN, `select public.${fn}('discord-ghost')`);
        const { rows } = await q(`select auth_user_id from public.${table} where discord_id = 'discord-ghost'`);
        expect(rows[0].auth_user_id).toBeNull();
      });
    });
  }

  it('admin_grant_team_role links the account whose identity row carries the id', async () => {
    await withTxn(async ({ q, asUser }) => {
      await addForger(q);
      await asUser(SITE_ADMIN, 'select public.admin_grant_team_role(1, $1, $2)', [FORGER_DISCORD, 'officer']);
      const { rows } = await q('select auth_user_id from public.team_members where team_id = 1 and discord_id = $1', [
        FORGER_DISCORD
      ]);
      expect(rows[0].auth_user_id).toBe(FORGER);
    });
  });
});

describe('what makes the reverse lookup exact', () => {
  // Green both sides on purpose. The grant RPCs drop their `limit 1` because
  // of this constraint, so the constraint is the assertion, not the removal.
  // Note what it does not say: nothing stops one user holding two rows for the
  // same provider. GoTrue refuses that at the API, not the schema, which is why
  // current_discord_id() carries a comment rather than a `limit 1`.
  it('(control) auth.identities is unique on (provider_id, provider)', async () => {
    // rls-pool-read-only: reads the catalog, writes nothing.
    const { rows } = await pool.query(
      `select pg_get_constraintdef(c.oid) as def
         from pg_constraint c
        where c.conrelid = 'auth.identities'::regclass and c.contype = 'u'`
    );
    expect(rows.map((r) => r.def)).toContain('UNIQUE (provider_id, provider)');
  });
});
