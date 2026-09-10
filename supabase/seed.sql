-- Local/CI test fixtures. Applied automatically by `supabase db reset`
-- (config.toml [db.seed]). Never pushed to the cloud: `db push` only runs
-- migrations.
--
-- Identities used by tests/rls/. The UUIDs are what the harness puts in
-- request.jwt.claims to impersonate each person; they must stay in sync
-- with tests/rls/helpers.js.
--
--   ...0001  officer on team 1          phoenix-officer
--   ...0002  team leader on team 1      phoenix-leader
--   ...0003  raider on team 1           phoenix-raider
--   ...0004  site admin (no team role)  admin
--   ...0005  officer on team 2          hellfire-officer
--   ...0006  a season_signups.auth_user_id owner, no team_members/players row
--            (get_own_signup()/update_own_signup() never touch those tables)
--                                       signup-owner
--   ...0007  guild officer (#607): a plain raider on team 1, no officer/
--            team_leader role anywhere, but granted guild_officers -- models
--            a Guild Master raiding on one team with no team-leadership role
--                                       guild-officer
--   ...0008  officer on team 3          immolation-officer
--   ...0009  team leader on team 3      immolation-leader
--   ...0010  raider on team 3           immolation-raider
--
-- The persona names follow the scheme a restored snapshot mints from the
-- teams table (scripts/dev/snapshot-personas.js, #1065): <slug>-officer,
-- <slug>-leader, <slug>-raider, and the guild-wide grants by name. Team 1 is
-- Phoenix and team 2 Hellfire Rollers here as in production, so
-- phoenix-officer means the same person after a reset and after a snapshot.
-- tests/rls/seed-personas.test.js holds the seed to it.

-- The auth side of those identities (#1053). Until this they were bare ids,
-- which is all tests/rls needs (it impersonates through request.jwt.claims
-- inside a rolled-back transaction and never authenticates). A browser cannot
-- do that, so signing in to the local site needs rows the auth service will
-- issue a magic link against: `npm run dev:login -- phoenix-officer`.
--
-- Three details are load bearing:
--   * provider_id must equal the grant row's discord_id below, because
--     link_auth_user_to_member() keys on that. A mismatch signs in fine and
--     then sees nothing, which reads as broken policies.
--   * the four token columns are '' rather than null. GoTrue scans them into
--     plain strings, so a null is a 500 on sign-in; the other four token
--     columns already default to ''.
--   * @wga.local is never a real inbox, and the local stack mails nothing
--     anyway (Mailpit catches it).
--
-- ...0006 gets no persona name in the login script because it stands for
-- somebody with a signup and no roster row, so it has no grant row to link to.
-- `npm run dev:login -- --discord-id <id>` reaches any identity, seeded or not.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000',
  p.id::uuid,
  'authenticated',
  'authenticated',
  p.email,
  '',
  now(),
  '', '', '', '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('provider_id', p.provider_id, 'full_name', p.full_name),
  now(),
  now()
from (values
  ('00000000-0000-0000-0000-000000000001', 'phoenix-officer@wga.local',  'discord-officer-1',      'Phoenix Officer'),
  ('00000000-0000-0000-0000-000000000002', 'phoenix-leader@wga.local',   'discord-leader-1',       'Phoenix Leader'),
  ('00000000-0000-0000-0000-000000000003', 'phoenix-raider@wga.local',   'discord-raider-1',       'Phoenix Raider'),
  ('00000000-0000-0000-0000-000000000004', 'admin@wga.local',            'discord-site-admin',     'Admin'),
  ('00000000-0000-0000-0000-000000000005', 'hellfire-officer@wga.local', 'discord-officer-2',      'Hellfire Officer'),
  ('00000000-0000-0000-0000-000000000006', 'signup-owner@wga.local',     'discord-signup-owner',   'Signup Owner'),
  ('00000000-0000-0000-0000-000000000007', 'guild-officer@wga.local',    'discord-guildofficer-1', 'Guild Officer'),
  ('00000000-0000-0000-0000-000000000008', 'immolation-officer@wga.local', 'discord-officer-3',     'Immolation Officer'),
  ('00000000-0000-0000-0000-000000000009', 'immolation-leader@wga.local',  'discord-leader-3',      'Immolation Leader'),
  ('00000000-0000-0000-0000-000000000010', 'immolation-raider@wga.local',  'discord-raider-3',      'Immolation Raider')
) as p(id, email, provider_id, full_name);

-- One identity row each, so an account looks like one that signed in rather
-- than one conjured in SQL. The auth service reads these when listing a user's
-- providers.
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select
  u.raw_user_meta_data ->> 'provider_id',
  u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'provider_id', u.raw_user_meta_data ->> 'provider_id'),
  'email',
  now(),
  now(),
  now()
from auth.users u;

-- Production's teams, less Wrathless (id 4), which a migration creates on
-- every stack (20260826220829_wrathless_team.sql). Immolation was created in
-- production by hand, so it is seeded here to keep the seeded teams table the
-- same shape as production's (#1065).
insert into public.teams (id, name, slug) values
  (1, 'Team Phoenix', 'phoenix'),
  (2, 'Hellfire Rollers', 'hellfire'),
  (3, 'Immolation', 'immolation');

insert into public.team_members (id, team_id, discord_id, auth_user_id, role, name_realm) values
  (1, 1, 'discord-officer-1', '00000000-0000-0000-0000-000000000001', 'officer', 'Seedofficer-Illidan'),
  (2, 1, 'discord-leader-1',  '00000000-0000-0000-0000-000000000002', 'team_leader', 'Seedleader-Illidan'),
  (3, 1, 'discord-raider-1',  '00000000-0000-0000-0000-000000000003', 'raider',  'Seedraider-Illidan'),
  (4, 2, 'discord-officer-2', '00000000-0000-0000-0000-000000000005', 'officer', 'Seedofficertwo-Illidan'),
  (5, 1, 'discord-guildofficer-1', '00000000-0000-0000-0000-000000000007', 'raider', 'Seedguildofficer-Illidan'),
  (6, 3, 'discord-officer-3', '00000000-0000-0000-0000-000000000008', 'officer', 'Seedimmolationofficer-Illidan'),
  (7, 3, 'discord-leader-3',  '00000000-0000-0000-0000-000000000009', 'team_leader', 'Seedimmolationleader-Illidan'),
  (8, 3, 'discord-raider-3',  '00000000-0000-0000-0000-000000000010', 'raider',  'Seedimmolationraider-Illidan');

insert into public.site_admins (id, discord_id, auth_user_id) values
  (1, 'discord-site-admin', '00000000-0000-0000-0000-000000000004');

insert into public.guild_officers (id, discord_id, auth_user_id) values
  (1, 'discord-guildofficer-1', '00000000-0000-0000-0000-000000000007');

insert into public.classes_specs (id, class, spec, role) values
  (1, 'Mage', 'Frost', 'Ranged');

-- Item 3 is the seed's one BoE (#875): submit_boe_found links a find to a
-- flagged row only, and the picker suites want one to offer. Unscoped (no
-- wcl_zone_id), like the other two, so it shows for every season.
insert into public.items (id, wow_item_id, name, slot, armor_type, is_boe) values
  (1, 100001, 'Seed Test Staff', 'Two-Hand', null, false),
  (2, 100002, 'Seed Test Robe', 'Chest', 'Cloth', false),
  (3, 100003, 'Seed Test BoE Belt', 'Waist', 'Leather', true);

insert into public.players (id, team_id, name_realm, class_spec_id) values
  (1, 1, 'Seedraider-Illidan', 1),
  (2, 1, 'Seedplayertwo-Illidan', 1),
  (3, 2, 'Seedhellfire-Illidan', 1),
  (4, 3, 'Seedimmolationraider-Illidan', 1);

-- One row per gated table so the harness can prove invisibility to the
-- wrong roles and visibility plus UPDATE reach to the right ones.

insert into public.audit_log (id, team_id, actor_id, action) values
  (1, 1, '00000000-0000-0000-0000-000000000001', 'seed_test_action');

insert into public.bis_requests (id, team_id, player_id, bis_link, status) values
  (1, 1, 1, 'https://example.com/seed-bis-link', 'pending');

insert into public.mplus_exclusion_requests (id, team_id, player_id, reason, status) values
  (1, 1, 1, 'seed test reason', 'pending');

-- #925: player 1 carries the note so the gated-table matrix has a row to
-- prove invisible to anon and raiders. Player 2 is left without one, so the
-- write assertions have a free primary key to insert against.
insert into public.player_officer_notes (player_id, team_id, officer_notes) values
  (1, 1, 'seed officer note');

-- Signup 1 exercises the gated-table matrix; 2 and 3 are approved so the
-- pending_roster view and add_signup_to_roster() have rows to work with.
insert into public.season_signups (id, team_id, signup_name_realm, class_spec_id, season, status) values
  (1, 1, 'Seedsignup-Illidan', 1, 'seed-season', 'pending'),
  (2, 1, 'Seedapproved-Illidan', 1, 'seed-season', 'approved'),
  (3, 2, 'Seedapprovedtwo-Illidan', 1, 'seed-season', 'approved');

insert into public.self_received_requests (id, team_id, player_id, self_item_id, status) values
  (1, 1, 1, 2, 'pending');

-- Corrections fixtures (#756): an approved and a rejected row on team 1 plus
-- an approved row on team 2, so delete_self_received_request() and the
-- revert-to-pending UPDATE path have per-role targets. Placed before the
-- bis_items block below on purpose: the approved inserts fire
-- trg_self_received_sync_bis_obtained, and with no matching bis_items row
-- existing yet the seed's obtained flags stay false. Row 2 shares
-- (player 1, item 1) with the bis_items seed row so the sync tests can
-- exercise the trigger against it.
insert into public.self_received_requests (id, team_id, player_id, self_item_id, status, track, source, slot) values
  (2, 1, 1, 1, 'approved', 'Hero', 'M+', null),
  (3, 1, 2, 2, 'rejected', 'Champion', 'Great Vault', null),
  (4, 2, 3, 1, 'approved', 'Myth', 'Crafted', null);

-- BoE tracker (#745): item 1 is found and owned by (unlinked) player 1 so
-- own-row read tests can link and see it; item 2 is sold with an unresolved
-- finder and a split satisfying the policy formula (150000 -> 30000 / 112500
-- with a 7500 auction house fee at floor 20000 / pivot 100000, #861);
-- listing 1 hangs off the sold item. The
-- manager grant goes to the team-1 officer's Discord id; the team-1 leader
-- stays ungranted to prove grant-only writes. The grant is guild-wide (#766),
-- so it authorizes that person on every team, not just team 1.
insert into public.boe_items (id, team_id, player_id, finder_name, item_id, item_name, track, season, status, found_at) values
  (1, 1, 1, 'Seedraider-Illidan', 1, 'Seed Test Staff', 'Hero', 'seed-season', 'found', '2026-01-02T00:00:00Z');

insert into public.boe_items (id, team_id, player_id, finder_name, item_id, item_name, track, season, status,
    found_at, sold_at, sale_price, finder_payout, guild_cut, ah_fee, payout_floor, payout_pivot) values
  (2, 1, null, 'Oldfinder-Illidan', null, 'Seed Sold Sash', 'Myth', 'seed-season', 'sold',
    '2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z', 150000, 30000, 112500, 7500, 20000, 100000);

insert into public.boe_listings (id, team_id, boe_item_id, price, listed_at) values
  (1, 1, 2, 160000, '2026-01-02T12:00:00Z');

insert into public.boe_managers (id, discord_id, auth_user_id) values
  (1, 'discord-officer-1', '00000000-0000-0000-0000-000000000001');

-- Rows for public-read tables the matrix test asserts are visible.

insert into public.attendance (id, team_id, player_id, raid_date, status) values
  (1, 1, 1, '2026-01-01', 'Present');

insert into public.bis_items (id, player_id, item_id, obtained) values
  (1, 1, 1, false);

insert into public.scoring (id, player_id, season) values
  (1, 1, 'seed-season');

insert into public.priority_order (id, team_id, season, item_id, track, rank, player_id) values
  (1, 1, 'seed-season', 1, 'Myth', 1, 1);

insert into public.rclc_loot (id, team_id, player_id, item_id, track, season) values
  (1, 1, 1, 1, 'Myth', 'seed-season');

insert into public.player_wcl_season_perf (player_id, team_id, season) values
  (1, 1, 'seed-season');

insert into public.team_settings (team_id, config) values
  (1, '{"activeSignupSeason":"seed-season"}'),
  (2, '{"activeSignupSeason":"seed-season"}'),
  (3, '{"activeSignupSeason":"seed-season"}');

insert into public.item_bosses (item_id, boss) values
  (1, 'Seed Test Boss');

-- Serial sequences must move past the explicit ids above or the first
-- INSERT a test makes collides on the primary key.
select setval('public.teams_id_seq', 10);
select setval('public.team_members_id_seq', 10);
select setval('public.site_admins_id_seq', 10);
select setval('public.guild_officers_id_seq', 10);
select setval('public.classes_specs_id_seq', 10);
select setval('public.items_id_seq', 10);
select setval('public.players_id_seq', 10);
select setval('public.audit_log_id_seq', 10);
select setval('public.bis_requests_id_seq', 10);
select setval('public.mplus_exclusion_requests_id_seq', 10);
select setval('public.signups_id_seq', 10);
select setval('public.self_received_requests_id_seq', 10);
select setval('public.attendance_id_seq', 10);
select setval('public.bis_items_id_seq', 10);
select setval('public.scoring_id_seq', 10);
select setval('public.priority_order_id_seq', 10);
select setval('public.loot_id_seq', 10);
select setval('public.boe_items_id_seq', 10);
select setval('public.boe_listings_id_seq', 10);
select setval('public.boe_managers_id_seq', 10);

-- Keep this stack off production (#1055).
--
-- Four migrations schedule pg_cron jobs whose command carries the production
-- functions URL, and a reset recreates them, so without this a developer
-- machine and every CI stack call production on a schedule. They are refused
-- 401 because the local Vault holds no secret, which is a property of the
-- Vault and not of the stack being sealed.
--
-- Deactivating rather than rewriting the URL: the command is what the
-- migration wrote, and it has to stay that way, because it is production's
-- schedule and nothing compares the two. This file runs on local and CI
-- resets only; `db push` never runs it, so production is untouched.
--
-- To run one on purpose for a session: select cron.alter_job(<jobid>, active := true);
select cron.alter_job(jobid, active := false) from cron.job;
