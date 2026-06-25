# Supabase Database Setup Guide

This guide sets up the database for the WGA Raid Hub migration described in PR #195.
It is written to help you understand what each piece does and why, not just how to
click through it. Reading the explanations will make it much easier to debug problems
and understand what Russell is talking about when he reviews the code.

**What is already done:**
- Supabase project created (ID: `kxgjqnpwfklbgrxdgmmv`, free tier, Americas region,
  auto RLS enabled)
- Both bots are on HTTPS: Phoenix at `https://wga-phoenix.duckdns.org`,
  Hellfire at `https://wga-hellfire.duckdns.org`
- Russell has dashboard access (Option A)

**What this guide covers:**
Getting the schema into the database correctly, understanding the security model,
wiring up Discord login, and confirming everything works before any app code changes.

---

## A quick mental model before you start

The Raid Hub currently stores data in a Google Sheet. Each tab in that Sheet (Roster,
Loot, BiS, etc.) becomes a **table** in PostgreSQL. A table is like a spreadsheet tab
with one important difference: the columns and the relationships between tabs are
*defined once and enforced by the database itself*, not held together by formulas and
careful formatting.

**Why that matters:** In the Sheet, if you type a player name slightly wrong in the
loot tab, nothing breaks immediately -- it just silently stops matching. In a proper
database, loot rows reference a player by their ID number (not their name), so a
wrong reference is impossible.

The system that enforces who can read and change each row is called
**Row Level Security (RLS)**. Think of it as per-row permissions that run inside the
database before any data is returned. The Raid Hub's public anon key (the one that
ships in the website code) can reach the database directly, which is normal and fine --
but RLS is the only thing standing between that key and your data, so it has to be
correct before anything goes live.

---

## Step 1: Collect your project credentials

You need three values from the Supabase dashboard. They are used at different times
for different purposes, and it is worth understanding why they are separate:

- **Project URL** -- the base address of your database API. Everything the website
  calls goes through this URL. It is not a secret.
- **anon public key** -- the key that goes into the website's JavaScript. It tells
  Supabase which project you are talking to and activates RLS so only the rules you
  define apply. Anyone can see this key by reading your page source, which is
  intentional and expected. RLS is what stops them from doing anything harmful with it.
- **service_role key** -- a key that bypasses RLS entirely. This is the admin key.
  It must never go into the website code or any file that gets committed. It lives
  only inside Edge Function secrets, on the server side where users cannot reach it.

To get them:
1. Open [supabase.com](https://supabase.com) and open the project.
2. Left sidebar -> **Project Settings** -> **API**.
3. Copy the **Project URL** (for this project: `https://kxgjqnpwfklbgrxdgmmv.supabase.co`)
4. Copy the **anon public** key.
5. Copy the **service_role** key and store it somewhere safe (a password manager,
   not a text file on your desktop).

---

## Step 2: Create the reference tables

Open **SQL Editor** in the left sidebar, click **New query**, paste the SQL below,
and click **Run**.

**What these tables are:**
Reference tables hold data that is shared across both teams and does not change often --
the master list of items in the game, which boss drops each item, and the class/spec
list. They have no `team_id` column because they belong to everyone, not to Phoenix
or Hellfire specifically.

```sql
-- Master item list. wow_item_id is the numeric ID WoW uses for each item --
-- it appears in the RCLootCouncil export and is how we link an item name
-- to a specific game item rather than matching by name alone.
create table items (
  id          serial primary key,
  wow_item_id integer,
  name        text not null,
  slot        text not null,
  armor_type  text,
  sort_id     integer
);

-- One row per boss that can drop a given item.
-- An item can drop from multiple bosses (e.g. Great Vault), so this is
-- a separate table rather than a single column on items.
create table item_bosses (
  item_id  integer references items(id) on delete cascade,
  boss     text not null,
  primary key (item_id, boss)
);

-- Optional class/spec reference used for BiS filtering and role display.
create table classes_specs (
  id        serial primary key,
  class     text not null,
  spec      text not null,
  role      text  -- 'Tank', 'Heal', 'Melee', 'Ranged'
);
```

---

## Step 3: Create the teams table

```sql
create table teams (
  id    serial primary key,
  name  text not null unique,
  slug  text not null unique  -- short identifier used in URLs and code, e.g. 'phoenix'
);

-- Seed the two teams now so every later table can reference them by ID.
insert into teams (name, slug) values
  ('Phoenix', 'phoenix'),
  ('Hellfire', 'hellfire');
```

**Why a `slug` column?**
The app code often needs to refer to a team by a short, URL-safe string
(`?team=phoenix`). Storing the slug here means the app never has to hardcode
team names in multiple places -- it just looks them up.

---

## Step 4: Create team_members

This table is the authority on who has access to what. Before writing it, it helps
to understand the authentication flow we are building toward.

**How auth works with Discord login:**
When someone clicks "Login with Discord", Supabase redirects them to Discord, Discord
confirms who they are, and then redirects back with a token. Supabase creates a row
in its internal `auth.users` table and issues a session. At that point, the person
is *authenticated* (we know who they are) but not yet *authorized* (we do not
automatically know what they can do).

Authorization comes from `team_members`. Each row says: this Discord user, on this
team, has this role. The `discord_id` column is the link between Discord's identity
and your own access records. The `auth_user_id` column is the link between Discord's
identity and Supabase's internal user record -- it starts as null and gets filled in
automatically the first time that person logs in (see Step 14 for the trigger that
does this).

Pre-seeding officers by their Discord ID (before they ever log in) is what gives them
their role automatically on first login, without any manual step.

```sql
create table team_members (
  id            serial primary key,
  team_id       integer not null references teams(id) on delete cascade,
  discord_id    text not null,
  auth_user_id  uuid references auth.users(id) on delete set null,
  role          text not null check (role in ('raider', 'officer', 'admin')),
  name_realm    text,  -- e.g. 'Katarii-Stormrage', filled in when they claim a character
  unique (team_id, discord_id)
);
```

**Insert your officers and admins now.**
You need each person's Discord user ID. To find it: in Discord, go to Settings ->
Advanced -> turn on Developer Mode. Then right-click any user and choose "Copy User ID".

```sql
insert into team_members (team_id, discord_id, role) values
  -- Phoenix officers (team_id = 1)
  (1, 'DISCORD_ID_HERE', 'admin'),
  (1, 'DISCORD_ID_HERE', 'officer'),
  -- Hellfire officers (team_id = 2)
  (2, 'DISCORD_ID_HERE', 'officer');
  -- add all current officers for both teams
```

**Raider login:** A raider who logs in for the first time has no pre-seeded row.
When they log in and claim a character, the app will create a `team_members` row for
them with `role = 'raider'` and link it to their Discord ID. This row is what the
RLS policies check when deciding what they can see and submit. This step (the claim
flow) is handled in Phase 3 of the migration, not here.

---

## Step 5: Create players and scoring

**The key design decision here: `name_realm` is the stable player key.**
In the current Sheet, players are sometimes referenced by first name only, which
causes problems when two people share a name. In the database, every player is
identified by their full `Name-Realm` string (e.g. `Katarii-Stormrage`). This is
the same format RCLootCouncil exports use, so loot records and attendance records
can reliably link to the right player.

```sql
create table players (
  id              serial primary key,
  team_id         integer not null references teams(id) on delete cascade,
  name_realm      text not null,   -- 'Name-Realm', the stable unique key per team
  class           text,
  spec            text,
  role            text check (role in ('Tank', 'Heal', 'Melee', 'Ranged')),
  is_trial        boolean not null default false,
  is_bench        boolean not null default false,
  nickname        text,            -- short name shown in the UI
  bis_link        text,            -- URL to their public BiS list (Wowhead, etc.)
  join_date       date,            -- sets the start of their attendance window
  m_plus_excluded boolean not null default false,
  m_plus_note     text,
  sort_key        integer,         -- manual ordering override for the roster display
  unique (team_id, name_realm)
);
```

**Why `role` and `is_trial`/`is_bench` here?**
The priority generator applies different multipliers based on these values -- trials
get a different weight than main raiders, and bench players are scored differently
for attendance. Storing them as proper boolean and enum columns means the priority
logic can query them directly without parsing formatted text from a cell.

```sql
-- Scoring is one-to-one with players (one scoring row per player).
-- It is a separate table rather than columns on players because it is written
-- by the WCL sync Edge Function on a different schedule than roster edits.
create table scoring (
  id                 serial primary key,
  player_id          integer not null references players(id) on delete cascade unique,
  recent_score       numeric,   -- last 2 reports
  trend_score        numeric,   -- last 8 reports
  best_score         numeric,   -- best of last 20 reports
  performance_score  numeric,
  attendance_score   numeric,   -- 0 to 10
  attendance_pct     numeric    -- percentage as a decimal (0.0 to 1.0)
);
```

---

## Step 6: Create the BiS and loot tables

**BiS list: from a grid to rows**
In the Sheet, the BiS list is a grid: one column per player, items listed down the
rows. That format is easy to read but hard to query ("give me all players who want
Trinket X" requires reading every column). In the database, each player-item pair
becomes its own row. This is called *long form*, and it is the standard way databases
store this kind of data.

```sql
create table bis_items (
  id         serial primary key,
  player_id  integer not null references players(id) on delete cascade,
  item_id    integer references items(id) on delete set null,
  item_name  text,      -- fallback display name if item not yet in the master list
  slot       text,
  obtained   boolean not null default false
);
```

**Loot: the dedupe_key column**
The `dedupe_key` column is a hash of `(team_id, rclc_id)` and has a `unique`
constraint. This is what makes re-pasting the same RCLootCouncil export safe: the
second insert fails silently on the duplicate key rather than adding a second row.
Every loot event gets a `slot` and `difficulty` because those drive the fairness
view and the priority penalty calculations.

```sql
create table loot (
  id           serial primary key,
  team_id      integer not null references teams(id) on delete cascade,
  player_id    integer references players(id) on delete set null,
  item_id      integer references items(id) on delete set null,
  item_name    text not null,
  slot         text,
  boss         text,
  difficulty   text check (difficulty in ('Champion', 'Heroic', 'Mythic')),
  source       text,   -- 'M+', 'Great Vault', 'Raid', etc.
  season       text,
  awarded_at   timestamptz not null default now(),
  rclc_id      text,
  dedupe_key   text unique  -- hash of (team_id, rclc_id); prevents duplicate imports
);
```

---

## Step 7: Create the attendance table

**Why `status` instead of `present boolean`:**
The original guide used a simple present/absent flag. The actual app has six
attendance states that score differently:
- `Present`, `Bench`, `Medical Leave` -- count as full attendance
- `Excused` -- counts as 0.8
- `No Show` -- counts as 0
- `Not on Roster` -- excluded from the calculation entirely

Collapsing those into a boolean would lose the scoring distinctions. The
`report_excluded` flag is the per-night "exclude this report" toggle officers can
use when a raid night is not representative (e.g. a short farm clear).

```sql
create table attendance (
  id               serial primary key,
  team_id          integer not null references teams(id) on delete cascade,
  player_id        integer not null references players(id) on delete cascade,
  raid_date        date not null,
  report_id        text,    -- WCL report ID this row came from
  status           text not null default 'Present'
    check (status in ('Present', 'Bench', 'Medical Leave', 'Excused',
                      'No Show', 'Not on Roster')),
  report_excluded  boolean not null default false,
  unique (team_id, player_id, raid_date)
);
```

---

## Step 8: Create the priority order table

**Why item and difficulty are part of the key:**
The current priority system ranks players per item per difficulty -- Phoenix might
have a player at rank 1 for the Heroic trinket and rank 3 for the Mythic trinket.
That is not one global ranking; it is one ranking per (item, difficulty) pair. The
unique constraint reflects that: within a team and season, each (item, difficulty,
rank) slot can only be occupied by one player.

```sql
create table priority_order (
  id         serial primary key,
  team_id    integer not null references teams(id) on delete cascade,
  season     text not null,
  item       text not null,
  difficulty text not null check (difficulty in ('Heroic', 'Mythic')),
  rank       integer not null,
  player_id  integer not null references players(id) on delete cascade,
  unique (team_id, season, item, difficulty, rank)
);
```

---

## Step 9: Create the request queue tables

These are the forms that raiders and anonymous visitors submit -- signups, BiS change
requests, "I received this item" self-reports, M+ exclusion requests, and pending
roster additions. Officers review and approve them in the dashboard.

**A note on security for these forms:**
The anon key ships in the website's page source, which means anyone can grab it and
post directly to the database without going through the website at all. The correct
approach is to route form submissions through an Edge Function that first verifies a
Cloudflare Turnstile token (the spam check) before doing the insert with the
service-role key. The RLS policies on these tables therefore allow no anon inserts --
the Edge Function handles that in Phase 5.

```sql
create table signups (
  id              serial primary key,
  team_id         integer not null references teams(id) on delete cascade,
  character_name  text not null,
  realm           text not null,
  discord         text,
  class           text,
  spec            text,
  role            text,
  off_specs       text,
  main_swap       boolean not null default false,
  note            text,
  submitted_at    timestamptz not null default now(),
  status          text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected'))
);

create table bis_requests (
  id           serial primary key,
  team_id      integer not null references teams(id) on delete cascade,
  player_id    integer references players(id) on delete set null,
  item_name    text not null,
  slot         text,
  submitted_at timestamptz not null default now(),
  status       text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected'))
);

create table self_received_requests (
  id           serial primary key,
  team_id      integer not null references teams(id) on delete cascade,
  player_id    integer references players(id) on delete set null,
  item_name    text not null,
  submitted_at timestamptz not null default now(),
  status       text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected'))
);

create table mplus_exclusion_requests (
  id           serial primary key,
  team_id      integer not null references teams(id) on delete cascade,
  player_id    integer references players(id) on delete set null,
  week_of      date not null,
  reason       text,
  submitted_at timestamptz not null default now(),
  status       text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected'))
);

create table pending_roster (
  id              serial primary key,
  team_id         integer not null references teams(id) on delete cascade,
  name_realm      text not null,
  class           text,
  spec            text,
  role            text,
  submitted_at    timestamptz not null default now(),
  status          text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected'))
);
```

---

## Step 10: Create the audit log

The audit log records every officer action: who did what, to which record, and when.
It is the basis for the Audit Log dashboard tab.

**Why it has no direct insert policy:**
With RLS on and no policy that allows anon inserts, nothing can write audit rows
through the public key. That is intentional -- you do not want anyone fabricating
audit entries. Every write to the audit log goes through a security-definer function
or an Edge Function using the service-role key. This is set up when the officer write
features are migrated in Phase 5. If you ever see zero audit entries after an officer
action, the write path for that action has not been wired up yet.

```sql
create table audit_log (
  id          serial primary key,
  team_id     integer not null references teams(id) on delete cascade,
  actor_id    uuid references auth.users(id) on delete set null,
  action      text not null,
  target_type text,     -- e.g. 'player', 'loot', 'bis_item'
  target_id   integer,
  detail      jsonb,    -- before/after values or extra context as a JSON blob
  created_at  timestamptz not null default now()
);
```

**What is `jsonb`?**
`jsonb` is a column type that stores arbitrary JSON in a binary format that is
efficient to query. Using it for `detail` means each action type can store whatever
context makes sense -- for a roster edit, the before and after values; for a loot
award, the item name and player -- without needing a separate column for every
possible field.

---

## Step 11: Create settings and season snapshots

```sql
-- Per-team public config: current season name, feature flags, display options.
-- Stored as a JSON blob so new settings can be added without a schema change.
create table settings (
  team_id  integer primary key references teams(id) on delete cascade,
  config   jsonb not null default '{}'
);

insert into settings (team_id, config) values (1, '{}'), (2, '{}');

-- A snapshot of end-of-season state for the season history feature.
create table season_snapshots (
  id         serial primary key,
  team_id    integer not null references teams(id) on delete cascade,
  season     text not null,
  snapped_at timestamptz not null default now(),
  data       jsonb not null,
  unique (team_id, season)
);
```

---

## Step 12: Enable Row Level Security on every table

**What enabling RLS does:**
Once RLS is on for a table, every query is filtered through the policies you define
in Step 13. If there is no policy that allows an action, the action is denied -- no
exceptions. The anon key hitting a table with RLS and no matching policy gets back
an empty result (for reads) or an error (for writes), not the data. This is the safe
default: locked down first, then opened up exactly as much as needed.

```sql
alter table items                    enable row level security;
alter table item_bosses              enable row level security;
alter table classes_specs            enable row level security;
alter table teams                    enable row level security;
alter table team_members             enable row level security;
alter table players                  enable row level security;
alter table scoring                  enable row level security;
alter table bis_items                enable row level security;
alter table loot                     enable row level security;
alter table attendance               enable row level security;
alter table priority_order           enable row level security;
alter table signups                  enable row level security;
alter table bis_requests             enable row level security;
alter table self_received_requests   enable row level security;
alter table mplus_exclusion_requests enable row level security;
alter table pending_roster           enable row level security;
alter table audit_log                enable row level security;
alter table settings                 enable row level security;
alter table season_snapshots         enable row level security;
```

---

## Step 13: Add RLS policies

Policies are the rules that decide what each type of caller can do. Before writing
them, it helps to know the three types of caller in this system:

- **Anon (not logged in):** uses the public anon key, no session. Can see public
  data (roster, loot feed, item lists) but cannot write anything.
- **Logged-in raider:** has a Supabase session from Discord login and a
  `team_members` row with `role = 'raider'`. Can submit forms (via Edge Functions).
- **Officer / Admin:** has a session and a `team_members` row with `role = 'officer'`
  or `'admin'`. Can read and approve queues, write roster and loot data, read the
  audit log.

**The helper function -- write this first**

Every policy that checks "is this caller an officer?" needs to look up their role in
`team_members`. Writing that lookup inside every policy would be repetitive and slow.
Instead, we define it once as a function.

`security definer` means this function always runs with the permissions of whoever
created it (you, the database owner), not the caller. This is how the function can
read `team_members` even when the caller's RLS policies would otherwise block it --
without this, the function would recurse into its own RLS check and fail.

`stable` tells PostgreSQL the function returns the same result for the same input
within a single query, so it is safe to cache rather than calling it once per row.

```sql
create or replace function my_team_role(p_team_id integer)
returns text
language sql
security definer
stable
as $$
  select role
  from team_members
  where team_id = p_team_id
    and auth_user_id = auth.uid()
  limit 1;
$$;
```

`auth.uid()` is a Supabase built-in that returns the UUID of the currently logged-in
user, or null if nobody is logged in. The function returns the role string, or null
if the caller has no membership on that team.

### Reference tables -- readable by everyone

```sql
create policy "Public read items"
  on items for select using (true);

create policy "Public read item_bosses"
  on item_bosses for select using (true);

create policy "Public read classes_specs"
  on classes_specs for select using (true);

create policy "Public read teams"
  on teams for select using (true);
```

`using (true)` means "this policy matches every row, for every caller". Combined with
`for select`, it opens the table for reading with no restrictions.

### Roster -- public read, officer/admin write

```sql
create policy "Public read players"
  on players for select using (true);

create policy "Officers write players"
  on players for all
  using      (my_team_role(team_id) in ('officer', 'admin'))
  with check (my_team_role(team_id) in ('officer', 'admin'));

create policy "Public read scoring"
  on scoring for select using (true);

create policy "Officers write scoring"
  on scoring for all
  using (
    my_team_role(
      (select team_id from players where id = player_id)
    ) in ('officer', 'admin')
  )
  with check (
    my_team_role(
      (select team_id from players where id = player_id)
    ) in ('officer', 'admin')
  );
```

**What `using` vs `with check` means:**
`using` is the filter applied when *reading or targeting* rows (select, update,
delete). `with check` is the filter applied when *writing* rows (insert, update).
Both are needed on a write policy. The subquery on scoring is necessary because
scoring rows do not have a `team_id` column directly -- you follow the `player_id`
foreign key to find which team they belong to.

### BiS list -- public read, officer/admin write

```sql
create policy "Public read bis_items"
  on bis_items for select using (true);

create policy "Officers write bis_items"
  on bis_items for all
  using (
    my_team_role(
      (select team_id from players where id = player_id)
    ) in ('officer', 'admin')
  )
  with check (
    my_team_role(
      (select team_id from players where id = player_id)
    ) in ('officer', 'admin')
  );
```

### Loot -- public read, officer/admin write

```sql
create policy "Public read loot"
  on loot for select using (true);

create policy "Officers write loot"
  on loot for all
  using      (my_team_role(team_id) in ('officer', 'admin'))
  with check (my_team_role(team_id) in ('officer', 'admin'));
```

### Attendance -- public read, officer/admin write

```sql
create policy "Public read attendance"
  on attendance for select using (true);

create policy "Officers write attendance"
  on attendance for all
  using      (my_team_role(team_id) in ('officer', 'admin'))
  with check (my_team_role(team_id) in ('officer', 'admin'));
```

### Priority order -- public read, officer/admin write

```sql
create policy "Public read priority_order"
  on priority_order for select using (true);

create policy "Officers write priority_order"
  on priority_order for all
  using      (my_team_role(team_id) in ('officer', 'admin'))
  with check (my_team_role(team_id) in ('officer', 'admin'));
```

### Request queues -- officer read/update only

No anon insert policy. Submissions go through an Edge Function (Phase 5) that
verifies the Turnstile token before inserting with the service-role key.

```sql
create policy "Officers read signups"
  on signups for select
  using (my_team_role(team_id) in ('officer', 'admin'));

create policy "Officers update signups"
  on signups for update
  using      (my_team_role(team_id) in ('officer', 'admin'))
  with check (my_team_role(team_id) in ('officer', 'admin'));

create policy "Officers read bis_requests"
  on bis_requests for select
  using (my_team_role(team_id) in ('officer', 'admin'));

create policy "Officers update bis_requests"
  on bis_requests for update
  using      (my_team_role(team_id) in ('officer', 'admin'))
  with check (my_team_role(team_id) in ('officer', 'admin'));

create policy "Officers read self_received_requests"
  on self_received_requests for select
  using (my_team_role(team_id) in ('officer', 'admin'));

create policy "Officers update self_received_requests"
  on self_received_requests for update
  using      (my_team_role(team_id) in ('officer', 'admin'))
  with check (my_team_role(team_id) in ('officer', 'admin'));

create policy "Officers read mplus_exclusion_requests"
  on mplus_exclusion_requests for select
  using (my_team_role(team_id) in ('officer', 'admin'));

create policy "Officers update mplus_exclusion_requests"
  on mplus_exclusion_requests for update
  using      (my_team_role(team_id) in ('officer', 'admin'))
  with check (my_team_role(team_id) in ('officer', 'admin'));

create policy "Officers read pending_roster"
  on pending_roster for select
  using (my_team_role(team_id) in ('officer', 'admin'));

create policy "Officers update pending_roster"
  on pending_roster for update
  using      (my_team_role(team_id) in ('officer', 'admin'))
  with check (my_team_role(team_id) in ('officer', 'admin'));
```

### Audit log -- officer read only, no direct write

```sql
create policy "Officers read audit_log"
  on audit_log for select
  using (my_team_role(team_id) in ('officer', 'admin'));
```

### Settings and season snapshots

```sql
create policy "Public read settings"
  on settings for select using (true);

create policy "Admins write settings"
  on settings for all
  using      (my_team_role(team_id) = 'admin')
  with check (my_team_role(team_id) = 'admin');

create policy "Public read season_snapshots"
  on season_snapshots for select using (true);

create policy "Admins write season_snapshots"
  on season_snapshots for all
  using      (my_team_role(team_id) = 'admin')
  with check (my_team_role(team_id) = 'admin');
```

### team_members

Officers can read their team's member list. Only admins can add or change members.

```sql
create policy "Officers read own team_members"
  on team_members for select
  using (my_team_role(team_id) in ('officer', 'admin'));

create policy "Admins write team_members"
  on team_members for all
  using      (my_team_role(team_id) = 'admin')
  with check (my_team_role(team_id) = 'admin');
```

---

## Step 14: Add the auth_user_id trigger

**What this trigger does and why it is needed:**
When an officer logs in with Discord for the first time, Supabase creates a row in
its internal `auth.users` table. At that moment, the officer already has a row in
`team_members` (seeded in Step 4) but with `auth_user_id = null`. The trigger runs
automatically right after the `auth.users` insert, reads the Discord user ID out of
the login metadata, finds the matching `team_members` row, and fills in the UUID.
From that point on, `auth.uid()` in any RLS policy correctly identifies the officer.

Without this trigger, an officer would log in successfully but all the policies
that call `my_team_role()` would return null -- their session would have no link to
their team membership.

```sql
create or replace function link_auth_user_to_member()
returns trigger
language plpgsql
security definer
as $$
begin
  update team_members
  set auth_user_id = new.id
  where discord_id = new.raw_user_meta_data ->> 'provider_id'
    and auth_user_id is null;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function link_auth_user_to_member();
```

`new` inside a trigger refers to the row that was just inserted -- in this case, the
new `auth.users` row. `new.id` is the Supabase UUID. `new.raw_user_meta_data ->> 'provider_id'`
extracts the Discord user ID from the metadata Supabase saves during OAuth. The
`->>` operator reads a JSON field as text.

---

## Step 15: Configure Discord OAuth in Supabase

This wires up "Login with Discord" in Supabase's auth system.

1. In Supabase: **Authentication** -> **Providers** -> **Discord** -> toggle on.
2. Copy the **Callback URL** shown on that page:
   `https://kxgjqnpwfklbgrxdgmmv.supabase.co/auth/v1/callback`
3. Open the [Discord Developer Portal](https://discord.com/developers/applications)
   and open the existing Raid Hub application.
4. **OAuth2** -> **Redirects** -> **Add Redirect** -> paste the Supabase callback URL.
   Do not remove the existing redirect. Leaving both registered means the old login
   keeps working during the transition -- you are adding a second valid target, not
   replacing the first.
5. From the same Discord app page, copy the **Client ID** and **Client Secret**.
6. Paste them into the Supabase Discord provider form and save.

---

## Step 16: Store Edge Function secrets

Edge Functions are small server-side scripts that run inside Supabase. They are the
only place where secrets must live -- the service-role key, the WCL key, the bot
secret. The website never sees these values; Edge Functions read them from environment
variables that Supabase injects at runtime.

In Supabase: **Project Settings** -> **Edge Functions** -> **Secrets**. Add each:

| Secret name                | What it is                                           |
|----------------------------|------------------------------------------------------|
| `WCL_CLIENT_ID`            | WarcraftLogs OAuth client ID                         |
| `WCL_CLIENT_SECRET`        | WarcraftLogs OAuth client secret                     |
| `DISCORD_BOT_SECRET`       | Bot webhook secret (from Script Properties)          |
| `BOT_WEBHOOK_URL_PHOENIX`  | `https://wga-phoenix.duckdns.org` (already live)     |
| `BOT_WEBHOOK_URL_HELLFIRE` | `https://wga-hellfire.duckdns.org` (already live)    |
| `SUPABASE_SERVICE_KEY`     | The service_role key from Step 1                     |

The two bot URLs are already confirmed and running on HTTPS. The `SUPABASE_SERVICE_KEY`
is what Edge Functions use to bypass RLS for writes that need elevated access
(audit log inserts, WCL sync writes, etc.).

---

## Step 17: Smoke test the connection

Before touching any app code, confirm the database is reachable and that RLS is
doing its job. Open your browser developer console (F12) on any page and run:

```js
const { createClient } = supabase; // assumes supabase-js loaded via CDN
const sb = createClient(
  'https://kxgjqnpwfklbgrxdgmmv.supabase.co',
  'YOUR_ANON_KEY'
);

// Test 1: public read -- should return two rows
const { data: teams, error: e1 } = await sb.from('teams').select('*');
console.log('Teams:', teams, e1);

// Test 2: RLS blocking an officers-only table -- should return [] not an error.
// RLS silently returns zero rows when no policy matches; it does not throw.
const { data: members, error: e2 } = await sb.from('team_members').select('*');
console.log('Members (expect []):', members, e2);

// Test 3: cross-team leak check -- log in as a Phoenix officer, then try to
// read Hellfire players. Should return [] because my_team_role(2) returns null.
const { data: players, error: e3 } = await sb
  .from('players')
  .select('*')
  .eq('team_id', 2);
console.log('Cross-team leak test (expect []):', players, e3);
```

**What to expect:**
- Test 1: two rows, no error. If it errors, check the project URL and anon key.
  If it returns zero rows, re-run the `insert into teams` from Step 3.
- Test 2: empty array, no error. If you get actual rows back, a policy is too open.
- Test 3 (while logged in as a Phoenix officer): empty array. If you get Hellfire
  rows back, the cross-team isolation is broken and must be fixed before going further.

---

## Step 18: Capture the schema as migration files (handled by Russell)

Rather than having the schema live only in the Supabase dashboard (invisible and
unreviewable), every change gets captured as a SQL migration file in the repo.
This means any future schema change goes through a PR, and the database can be
rebuilt from scratch by running the files in order.

The output of this step is a `supabase/migrations/` folder in the repo with numbered
SQL files. Running `supabase db push` applies any unapplied migrations to the live
project. Russell will create these files to match what was applied above, and they
get added to the repo in the next PR. You do not need to do this manually.

---

## What comes next (the roadmap)

With the schema in place, the migration follows the phase plan from PR #195:

**Phase 2 (reads first):** The public roster and loot feed start reading from
Supabase instead of Apps Script. No logins needed, no writes. The Apps Script
backend stays in charge of everything else. You can compare the Supabase output
against the live site side by side to verify before switching.

**Phase 3 (login):** Discord login switches to Supabase Auth. The trigger from
Step 14 fires on first login and links officers automatically. The old redirect
stays registered as a fallback until the switch is verified.

**Phase 4 (audit log):** The audit log is stood up in the database first, so that
every officer write from Phase 5 onward is recorded from the start.

**Phase 5 (officer writes):** Roster edits, BiS updates, attendance, loot imports,
and the priority generator move to Supabase one at a time. Each one keeps the Apps
Script version running in parallel until it passes a side-by-side check.

**Phase 6 (settings and secrets):** Season config and secrets move out of Script
Properties into Supabase settings and Edge Function secrets.

**Phase 7 (integrations):** WarcraftLogs sync and Discord bot notifications move
into Edge Functions. The Apps Script deployment is retired.
