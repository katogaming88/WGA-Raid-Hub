# Supabase Database Setup Guide

**What is already done:**
- Supabase project created (ID: `kxgjqnpwfklbgrxdgmmv`, Americas region, auto RLS enabled)
- Both bots on HTTPS: Phoenix at `https://wga-phoenix.duckdns.org`,
  Hellfire at `https://wga-hellfire.duckdns.org`
- Russell has dashboard access

This guide is written to teach you what you are doing, not just give you SQL to run.
Read the explanations. They are what makes the difference between "I followed steps"
and "I understand this system."

---

## Before any SQL: concepts you will see everywhere

Every table you create in this guide uses the same small set of building blocks.
Understanding them once here means you will not be confused when you see them
repeated across every table.

### Columns and types

A table is a grid. Each column has a **type** that tells the database what kind of
data goes there. The types you will see in this guide:

- `text` -- any string of any length. Used for names, IDs, notes.
- `integer` -- a whole number. Used for IDs and counts.
- `numeric` -- a decimal number. Used for scores and percentages.
- `boolean` -- true or false only. Used for flags like `is_trial`.
- `date` -- a calendar date with no time (e.g. `2025-01-15`). Used for raid dates.
- `timestamptz` -- a date and time that includes timezone information, stored in UTC.
  Used for anything where the exact moment matters, like when a loot award happened.
  The `tz` suffix is important: without it, the database stores time with no timezone,
  which causes sorting problems when data comes from different locations.
- `uuid` -- a 36-character globally unique identifier like
  `550e8400-e29b-41d4-a716-446655440000`. Supabase uses these for user IDs because
  they can be generated anywhere without two systems accidentally creating the same ID.
- `jsonb` -- stores arbitrary JSON as a compressed binary. Use it when a column needs
  to hold data where the shape varies row by row.

### Constraints

A **constraint** is a rule the database enforces on every write. These replace
code-level validation -- instead of trusting the app to only save valid values, the
database itself refuses anything that breaks the rule.

- `not null` -- this column must always have a value. Inserting a row without it fails.
- `default <value>` -- if you do not provide a value, the database uses this fallback.
- `unique` -- no two rows may have the same value in this column (or combination of
  columns). The database rejects any insert or update that would create a duplicate.
- `check (condition)` -- the condition must be true for every row. A common use is
  `check (role in ('raider', 'officer', 'admin'))`, which rejects any value outside
  that list.

### Primary keys

Every table needs a way to uniquely identify each row. That is the **primary key**.
In this guide, most tables use `serial primary key`, which means:

- `serial` -- the database automatically assigns the next integer (1, 2, 3...) when a
  row is inserted. You never write this value yourself; the database manages it.
- `primary key` -- this column uniquely identifies each row. No two rows can share the
  same value, and it can never be null.

Think of it like a row number that is permanent and never reused. Even if you delete
row 5, the next row is still 6.

### Foreign keys

A **foreign key** creates a hard link between two tables. For example:

```sql
team_id integer not null references teams(id)
```

This says: the value in `team_id` must exist in the `id` column of the `teams` table.
If you try to insert a `team_id` of 99 and there is no team with id 99, the database
refuses. This is how you get referential integrity -- it becomes physically impossible
to have a loot record pointing to a player that does not exist.

The `on delete` clause says what happens when the referenced row is deleted:
- `on delete cascade` -- delete this row too. If a team is deleted, all its players
  go with it. Use this when the child data has no meaning without the parent.
- `on delete set null` -- set this column to null instead. Use this when you want to
  keep the row but acknowledge the reference is gone. For example, if a Supabase
  user account is deleted, we want to keep the `team_members` record (it still holds
  the Discord ID and role history) but clear the auth link.

---

## Step 1: Collect your project credentials

Before writing any SQL, you need three values. They serve different purposes and it
matters that you understand why they are separate:

**Project URL** -- the base address of your Supabase project's API. Every request
from the website goes through this URL. It is not a secret; it is in the page source.

**anon public key** -- this is what the website uses to talk to Supabase. It
activates Row Level Security (the access rules you write in Step 13) so the database
knows to apply your policies to every request. Because the anon key ships in the page
source, anyone can see it. That is by design. It does not grant access to data -- it
just identifies which project you are connecting to. Your RLS policies are what
actually control what anyone can do.

**service_role key** -- this key bypasses RLS entirely. It is the database admin
key. It must never appear in the website's JavaScript or in any file committed to the
repo. It lives only inside Edge Function secrets, running on Supabase's servers where
users cannot reach it.

To get them:
1. Open your project at [supabase.com](https://supabase.com).
2. Left sidebar -> **Project Settings** -> **API**.
3. Your Project URL for this project is `https://kxgjqnpwfklbgrxdgmmv.supabase.co`.
4. Copy the **anon public** key.
5. Copy the **service_role** key -- store it in a password manager, not a text file.

The anon key and project URL are not used in this guide. They go into `js/common.js`
when the Supabase client is initialized in Phase 2 (issue #207). Collect them now so
they are ready when that work starts.

---

## Step 2: Create the reference tables

Open **SQL Editor** in the left sidebar and click **New query**.

Reference tables hold shared data that belongs to both teams -- the master item list,
which boss drops each item, and the class/spec reference. They have no `team_id`
because they are not owned by Phoenix or Hellfire, they are just lookup data.

```sql
create table items (
  id          serial primary key,
  wow_item_id integer,
  name        text not null,
  slot        text not null,
  armor_type  text,
  sort_id     integer
);
```

Reading this line by line:
- `id serial primary key` -- the auto-assigned row number that uniquely identifies
  each item. You will never write this value; the database picks the next one.
- `wow_item_id integer` -- the numeric ID WoW uses internally for each item. It
  appears in RCLootCouncil exports. No `not null` here because we may add items to
  the list before we have confirmed their WoW ID.
- `name text not null` -- every item must have a name. `not null` enforces this.
- `slot text not null` -- every item must have a slot (Head, Trinket, etc.).
- `armor_type text` -- optional (no `not null`), so it can be null for weapons and
  accessories that are not armor-type specific.
- `sort_id integer` -- an optional number used to control display order.

```sql
create table item_bosses (
  item_id  integer references items(id) on delete cascade,
  boss     text not null,
  primary key (item_id, boss)
);
```

New concepts here:
- `references items(id) on delete cascade` -- this is a foreign key. The `item_id`
  value must exist in the `items` table's `id` column. If that item is deleted,
  all its boss rows are deleted too (`cascade`).
- `primary key (item_id, boss)` -- this is a **composite primary key** using two
  columns together. A single item can drop from multiple bosses (Trinket drops from
  Council *and* is in the Great Vault), and a single boss drops multiple items, so
  neither column alone is unique. But the same item-boss pair should only appear once,
  so the combination is the primary key.

```sql
create table classes_specs (
  id    serial primary key,
  class text not null,
  spec  text not null,
  role  text  -- 'Tank', 'Heal', 'Melee', 'Ranged'
);
```

The comment after `role text` is just documentation. The database does not read it.
No `not null` on `role` means it is optional -- useful if we add entries before the
role is confirmed.

Click **Run** to create all three tables.

---

## Step 3: Create the teams table

```sql
create table teams (
  id    serial primary key,
  name  text not null unique,
  slug  text not null unique
);
```

`unique` on both `name` and `slug` means no two teams can share a name or a slug.
If you tried to insert a second team with `name = 'Phoenix'`, the database would
refuse. This is stronger than just a convention -- it is enforced.

The `slug` is a short URL-safe identifier (`phoenix`, `hellfire`) that the app uses
in query strings and code. Storing it in the database means neither it nor the full
name needs to be hardcoded anywhere in the JavaScript.

Now seed the two teams immediately, because every table that comes after references
them by their `id` number. Phoenix will be team 1, Hellfire will be team 2 -- not
because we configured that, but because `serial` assigns numbers in insertion order.

```sql
insert into teams (name, slug) values
  ('Phoenix', 'phoenix'),
  ('Hellfire', 'hellfire');
```

---

## Step 4: Create team_members

This is the most important table to understand because it is the foundation of the
entire authorization system.

**Authentication vs. authorization -- the distinction that matters here:**

When someone logs in with Discord, Supabase *authenticates* them: it confirms who
they are and creates a session. But that does not tell the app what the person is
allowed to do. That is *authorization*, and `team_members` is where it comes from.

Every row in `team_members` says: "this Discord user, on this team, has this role."
The RLS policies you write in Step 13 will call a function that looks up a row in
this table. If a row exists and says `officer`, officer-level access is granted.
If no row exists, the caller is treated as an anonymous visitor regardless of whether
they are logged in.

```sql
create table team_members (
  id            serial primary key,
  team_id       integer not null references teams(id) on delete cascade,
  discord_id    text not null,
  auth_user_id  uuid references auth.users(id) on delete set null,
  role          text not null check (role in ('raider', 'officer', 'admin')),
  name_realm    text,
  unique (team_id, discord_id)
);
```

Walking through the new parts:
- `auth_user_id uuid references auth.users(id) on delete set null` -- `auth.users` is
  Supabase's internal user table. When someone logs in, Supabase creates a row there
  and assigns a UUID. This column links that UUID to your team membership record.
  It starts as null because we seed officers before they have logged in yet.
  `on delete set null` (not cascade) means if the Supabase account is deleted, we
  keep the `team_members` row -- the Discord ID and role history are still useful --
  we just clear the auth link.
- `check (role in ('raider', 'officer', 'admin'))` -- the database rejects any value
  outside this list. You cannot accidentally put `'admin '` (trailing space) or
  `'Officer'` (wrong case) in this column.
- `unique (team_id, discord_id)` -- a composite unique constraint. A Discord user
  can have a row in both teams (if they are in both raids) but cannot have two rows
  in the same team.

**Insert current officers now.** Find each person's Discord user ID by enabling
Developer Mode in Discord (Settings -> Advanced -> Developer Mode), then right-clicking
their name and choosing "Copy User ID".

```sql
insert into team_members (team_id, discord_id, role) values
  (1, 'DISCORD_ID_HERE', 'admin'),    -- Phoenix admin
  (1, 'DISCORD_ID_HERE', 'officer'),  -- Phoenix officer
  (2, 'DISCORD_ID_HERE', 'officer');  -- Hellfire officer
  -- add all current officers for both teams
```

You are not inserting `auth_user_id` because it is null for now. When each officer
logs in for the first time, the trigger in Step 14 will fill it in automatically.

**What about raiders?** Raiders have no pre-seeded row. When a raider logs in with
Discord and claims their character, the app creates a `team_members` row for them
with `role = 'raider'`. That claim flow is built in Phase 3.

---

## Step 5: Create players and scoring

**Why `name_realm` and not just a first name:**

The current Sheet sometimes references players by first name alone, which breaks
when two people share a name. In the database, every player is uniquely identified
by `Name-Realm` (e.g. `Katarii-Stormrage`). This is exactly the format RCLootCouncil
exports use, so when loot is pasted in, the player lookup is a direct match -- not
a fuzzy name comparison.

```sql
create table players (
  id              serial primary key,
  team_id         integer not null references teams(id) on delete cascade,
  name_realm      text not null,
  class           text,
  spec            text,
  role            text check (role in ('Tank', 'Heal', 'Melee', 'Ranged')),
  is_trial        boolean not null default false,
  is_bench        boolean not null default false,
  nickname        text,
  bis_link        text,
  join_date       date,
  m_plus_excluded boolean not null default false,
  m_plus_note     text,
  sort_key        integer,
  unique (team_id, name_realm)
);
```

A few things worth noting:
- `role check (role in ('Tank', 'Heal', 'Melee', 'Ranged'))` -- notice there is no
  `not null` here, so `role` can be null if it has not been set yet. The `check`
  constraint only runs when a value is provided; null values skip it.
- `is_trial boolean not null default false` -- booleans with `not null default false`
  are the cleanest way to store flags. Every player starts as not-a-trial; you only
  change it when needed. Storing this in the database (instead of inferring it from
  a guild rank text field) is what lets the priority generator query it directly.
- `join_date date` -- nullable, because existing players were already in the guild
  when this system was built. Once set, it determines where each player's attendance
  window starts.
- `unique (team_id, name_realm)` -- the same `Name-Realm` can appear in both teams
  (a player in both raids), but not twice in the same team.

**Why scoring is a separate table:**

Scoring is one-to-one with players -- one row per player -- so you might expect it to
be columns on `players`. It is separate because it is written by a different process
(the WCL sync Edge Function) on a completely different schedule than roster edits.
Keeping them separate means a WCL sync cannot accidentally overwrite a roster edit
and vice versa.

```sql
create table scoring (
  id                 serial primary key,
  player_id          integer not null references players(id) on delete cascade unique,
  recent_score       numeric,
  trend_score        numeric,
  best_score         numeric,
  performance_score  numeric,
  attendance_score   numeric,
  attendance_pct     numeric
);
```

`player_id ... unique` -- the `unique` here (on a single column) means every player
can have at most one scoring row. Combined with the foreign key, this enforces the
one-to-one relationship at the database level.

---

## Step 6: BiS items and loot

**The grid-to-rows shift for BiS:**

In the Sheet, the BiS list is a grid: players across columns, item slots down the
rows. This makes it easy to read on screen but awkward to query. If you want to know
every player who has a trinket on their BiS list, you have to scan every column.
In the database, each player-item pair is one row. This layout is called *long form*,
and it is how databases are meant to store this kind of data. Querying becomes:
`select player_id from bis_items where slot = 'Trinket'` -- one line, instant.

```sql
create table bis_items (
  id         serial primary key,
  player_id  integer not null references players(id) on delete cascade,
  item_id    integer references items(id) on delete set null,
  item_name  text,
  slot       text,
  obtained   boolean not null default false
);
```

`item_id references items(id) on delete set null` -- if an item is removed from the
master list, we do not want to lose the BiS entry entirely. `set null` keeps the row
and falls back to the `item_name` text column for display. That is why both `item_id`
and `item_name` exist -- one is the reliable link, the other is a human-readable
fallback when the link is broken.

**Loot and the deduplication key:**

The current Sheet protects against pasting the same RCLootCouncil export twice by
checking for duplicate entries in code. In the database, we do this at the schema
level with a `unique` constraint on a `dedupe_key` column. The key is a hash of
`(team_id, rclc_id)`. When the app pastes a loot export, it computes this hash for
each row. If a row with that key already exists, the database rejects the insert --
not with an error that breaks things, but with a conflict the app catches and ignores.
The result: pasting the same export twice does nothing the second time.

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
  source       text,
  season       text,
  awarded_at   timestamptz not null default now(),
  rclc_id      text,
  dedupe_key   text unique
);
```

`awarded_at timestamptz not null default now()` -- `now()` is a database function
that returns the current time. `default now()` means if no timestamp is provided,
the database records the exact moment the row was inserted. This is more reliable
than letting the app supply the time, because the app's clock could be wrong.

---

## Step 7: Attendance

**Why six statuses instead of a boolean:**

A simple present/absent column loses information the scoring system needs. Each status
scores differently: Present/Bench/Medical Leave count as full attendance, Excused
counts as 0.8, No Show counts as 0, and Not on Roster is excluded from the
calculation entirely. If you collapse those to true/false, you cannot reproduce the
current scoring behavior.

The `check` constraint here is doing double duty: it both documents what the valid
values are and enforces that nothing else can be stored.

```sql
create table attendance (
  id               serial primary key,
  team_id          integer not null references teams(id) on delete cascade,
  player_id        integer not null references players(id) on delete cascade,
  raid_date        date not null,
  report_id        text,
  status           text not null default 'Present'
    check (status in ('Present', 'Bench', 'Medical Leave', 'Excused',
                      'No Show', 'Not on Roster')),
  report_excluded  boolean not null default false,
  unique (team_id, player_id, raid_date)
);
```

`unique (team_id, player_id, raid_date)` -- a player can only have one attendance
record per team per raid date. If the WCL sync tries to insert attendance for a player
who already has a row for that date, the database rejects it. This means the sync is
safe to run more than once -- it will not create duplicates.

`report_excluded` -- the per-night toggle that officers use when a raid is not
representative (e.g. a fast farm clear). When excluded, the night still exists in
the database for history, but the scoring query skips it.

---

## Step 8: Priority order

**Why priority is not a simple numbered list:**

You might expect priority to be one ranked list per team. But the app ranks players
per item, per difficulty. A player might be rank 1 for the Heroic trinket but rank 4
for the Mythic trinket. That is not one list -- it is one list per `(item, difficulty)`
pair. The unique constraint captures this exactly:

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

`unique (team_id, season, item, difficulty, rank)` -- within a team, season, item, and
difficulty, each rank slot can only be occupied by one player. The database makes it
impossible to accidentally have two players at rank 1 for the same item.

---

## Step 9: Request queues

The request queues are where public-facing forms land before an officer acts on them:
raid signups, BiS change requests, self-reported received items, M+ exclusion
requests, and pending roster additions.

**The security model for these forms -- read this before running the SQL:**

The anon key is in the website's source code. Anyone can open DevTools, copy it, and
use it to talk to your database directly -- bypassing the website entirely. If you
created an RLS policy that lets the anon key insert rows into these tables, someone
could flood them with spam rows without ever touching the signup form.

The correct approach: form submissions go through an Edge Function (a small
server-side script). The Edge Function first verifies a Cloudflare Turnstile token --
proof that a real browser submitted the form -- and then does the insert using the
service-role key, not the anon key. The anon key cannot insert directly.

For now, these tables have no insert policy at all. They are locked. The Edge Function
insert path is added in Phase 5 when the forms are migrated.

All five queue tables follow the same pattern -- only the columns differ:

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

The `status` column with `default 'pending'` is the lifecycle of each request.
Officers see pending items in their queue, then flip the status to `approved` or
`rejected`. The database enforces that only those three values are valid.

---

## Step 10: Audit log

The audit log records every officer action: who made the change, what they changed,
and what the before and after values were. It backs the Audit Log dashboard tab.

```sql
create table audit_log (
  id          serial primary key,
  team_id     integer not null references teams(id) on delete cascade,
  actor_id    uuid references auth.users(id) on delete set null,
  action      text not null,
  target_type text,
  target_id   integer,
  detail      jsonb,
  created_at  timestamptz not null default now()
);
```

`detail jsonb` -- this is where the actual change content goes. `jsonb` is used here
because different action types need to store different things. A roster edit stores
before and after values. A loot award stores the item name and player. A BiS update
stores which items changed. Rather than creating a separate column for every possible
field across every possible action type, `jsonb` lets each row store whatever shape
makes sense for that specific action.

**There is no insert policy on this table.** Writes only come from security-definer
functions and Edge Functions using the service-role key. If anything else could write
audit rows, the audit log would be useless -- you could fabricate entries to cover
tracks. The lack of an anon insert policy is intentional and correct.

---

## Step 11: Settings and season snapshots

```sql
create table settings (
  team_id  integer primary key references teams(id) on delete cascade,
  config   jsonb not null default '{}'
);

insert into settings (team_id, config) values (1, '{}'), (2, '{}');
```

Notice `team_id integer primary key` -- here `team_id` is both the primary key and
a foreign key. This table has exactly one row per team, guaranteed. There is no
auto-increment `id` because the team's own ID is the unique identifier.

`config jsonb not null default '{}'` -- an empty JSON object `{}` is the default,
meaning a freshly created team config is valid and readable (it just has no settings
yet). The app fills it in as features are configured.

```sql
create table season_snapshots (
  id         serial primary key,
  team_id    integer not null references teams(id) on delete cascade,
  season     text not null,
  snapped_at timestamptz not null default now(),
  data       jsonb not null,
  unique (team_id, season)
);
```

`unique (team_id, season)` -- each team can only have one snapshot per season. Taking
a new snapshot for the same season replaces the old one rather than accumulating
duplicates.

---

## Step 12: Enable Row Level Security

This is a single block. Run it all at once.

**What RLS actually does:**

RLS intercepts every query before any data is returned. Without RLS on, any caller
with the database URL can read every row in every table -- there is no filtering.
With RLS on, every query is run through the policies you define in Step 13. If no
policy permits the action, the result is an empty response (for reads) or a rejected
insert (for writes). The default after enabling RLS is maximum lockdown -- nothing
is allowed until you explicitly open it.

This is the correct order: enable first, then add policies. If you enabled RLS and
skipped straight to the smoke test, everything would return empty. That is correct
and expected.

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

## Step 13: Write the RLS policies

A policy answers three questions: which table, which operation (select/insert/update/
delete/all), and which rows does the caller have permission to act on.

Before writing any policies, build the mental model of who can call your database:

- **Anonymous caller:** has the anon key, no session. Represents any visitor to the
  public site who is not logged in. Should see roster and loot data, nothing else.
- **Logged-in raider:** has a Discord session and a `team_members` row with
  `role = 'raider'`. Can submit forms (through an Edge Function).
- **Officer / Admin:** has a Discord session and a `team_members` row with
  `role = 'officer'` or `'admin'`. Can read queues, approve requests, write data.

### The role-checking function

Every policy that asks "is this person an officer?" needs to look up their role in
`team_members`. You could write that lookup inside every single policy, but it would
run once per row being evaluated, which is expensive and repetitive. Instead, define
it once as a function.

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

Three things to understand here:

**`auth.uid()`** is a Supabase built-in. It returns the UUID of whoever is currently
making the request -- the same UUID stored in `team_members.auth_user_id`. For an
anonymous caller, it returns null, so the function returns null, and officer policies
deny access. No special anonymous handling needed.

**`security definer`** means this function runs with the permissions of whoever
created it (you, the database owner) rather than the caller's permissions. Without
this, the function would try to read `team_members` using the caller's RLS policies --
but there is no "read your own team_members row" policy yet, so it would return
nothing, creating a catch-22 where you need role access to check role access.
`security definer` breaks that loop.

**`stable`** tells PostgreSQL the function returns the same result for the same input
within a single query. This allows the database to call it once and cache the result
rather than re-running it for every row being evaluated. A query against a 500-row
player table would otherwise call this function 500 times.

### How `using` and `with check` work

Every policy has up to two clauses:

- **`using (...)`** filters which rows the caller can *see or target*. It applies to
  SELECT, UPDATE, and DELETE. A row that fails this check is invisible -- not an error,
  just absent from results.
- **`with check (...)`** applies to INSERT and UPDATE. It validates what the caller is
  allowed to *write*. A row that fails this check causes a permission error.

For a write policy you need both: `using` covers the row being updated/deleted,
`with check` covers the new values being written.

### Reference tables -- open to everyone

The item list, boss list, and team names are public data. The whole point is that
any visitor can read them.

```sql
create policy "Public read items"         on items         for select using (true);
create policy "Public read item_bosses"   on item_bosses   for select using (true);
create policy "Public read classes_specs" on classes_specs for select using (true);
create policy "Public read teams"         on teams         for select using (true);
```

`using (true)` means the condition is always true -- every row passes, for every
caller. Combined with `for select`, this opens the table for reading with no
restrictions while still blocking any writes (which have no policy).

### Roster -- public read, officers write

Anyone can see the roster. Only officers can change it.

```sql
create policy "Public read players"
  on players for select using (true);

create policy "Officers write players"
  on players for all
  using      (my_team_role(team_id) in ('officer', 'admin'))
  with check (my_team_role(team_id) in ('officer', 'admin'));
```

`for all` covers every operation (select, insert, update, delete). Combined with
`for select using (true)`, both policies apply to reads -- but since `true` is always
more permissive than the officer check, reads are effectively open to everyone.

The scoring table has no `team_id` column of its own -- it only has `player_id`. To
find which team a scoring row belongs to, you follow the foreign key to `players`:

```sql
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

The subquery `(select team_id from players where id = player_id)` runs for each row
being evaluated. It follows the foreign key to get the team, then `my_team_role()`
checks whether the current user is an officer of that team. If they are not, the row
is invisible to writes.

### BiS items -- same pattern as scoring

BiS rows also reach their team through `player_id`, so the same subquery applies:

```sql
create policy "Public read bis_items"
  on bis_items for select using (true);

create policy "Officers write bis_items"
  on bis_items for all
  using (
    my_team_role((select team_id from players where id = player_id))
    in ('officer', 'admin')
  )
  with check (
    my_team_role((select team_id from players where id = player_id))
    in ('officer', 'admin')
  );
```

### Loot, attendance, priority -- same pattern, direct team_id

These tables have `team_id` directly, so no subquery is needed:

```sql
create policy "Public read loot"       on loot       for select using (true);
create policy "Public read attendance" on attendance  for select using (true);
create policy "Public read priority_order" on priority_order for select using (true);

create policy "Officers write loot"
  on loot for all
  using      (my_team_role(team_id) in ('officer', 'admin'))
  with check (my_team_role(team_id) in ('officer', 'admin'));

create policy "Officers write attendance"
  on attendance for all
  using      (my_team_role(team_id) in ('officer', 'admin'))
  with check (my_team_role(team_id) in ('officer', 'admin'));

create policy "Officers write priority_order"
  on priority_order for all
  using      (my_team_role(team_id) in ('officer', 'admin'))
  with check (my_team_role(team_id) in ('officer', 'admin'));
```

### Request queues -- officers read and approve, no anon path

There is no insert policy here. The why was explained in Step 9. Officers can read
pending items and flip their status; nothing else is permitted through the anon key.

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

### Audit log, settings, team_members

```sql
-- Audit log: officers can read, nothing can write through the anon key
create policy "Officers read audit_log"
  on audit_log for select
  using (my_team_role(team_id) in ('officer', 'admin'));

-- Settings: everyone can read, only admins can change
create policy "Public read settings"
  on settings for select using (true);
create policy "Admins write settings"
  on settings for all
  using      (my_team_role(team_id) = 'admin')
  with check (my_team_role(team_id) = 'admin');

-- Season snapshots: everyone can read, only admins can write
create policy "Public read season_snapshots"
  on season_snapshots for select using (true);
create policy "Admins write season_snapshots"
  on season_snapshots for all
  using      (my_team_role(team_id) = 'admin')
  with check (my_team_role(team_id) = 'admin');

-- team_members: officers can see their team's member list, admins can change it
create policy "Officers read own team_members"
  on team_members for select
  using (my_team_role(team_id) in ('officer', 'admin'));
create policy "Admins write team_members"
  on team_members for all
  using      (my_team_role(team_id) = 'admin')
  with check (my_team_role(team_id) = 'admin');
```

---

## Step 14: The auth_user_id trigger

**The problem this solves:**

In Step 4, you inserted officer rows with `discord_id` filled in but `auth_user_id`
null. When an officer logs in with Discord for the first time, Supabase creates a row
in `auth.users` and assigns them a UUID. At that exact moment, the database knows the
Discord ID (from the OAuth metadata) but the `team_members` row still has a null
`auth_user_id`. Until that UUID is linked, `auth.uid()` in any policy returns their
UUID but `my_team_role()` finds no matching row and returns null -- the officer is
logged in but treated as anonymous.

A **trigger** is a piece of code the database runs automatically in response to an
event. This one fires every time a new row is inserted into `auth.users` (i.e., every
first login) and fills in the `auth_user_id` link:

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

Reading the function body:
- `new` is a special variable inside trigger functions that holds the row that was
  just inserted. Here, `new` is the new `auth.users` row.
- `new.id` is the Supabase UUID that was just assigned.
- `new.raw_user_meta_data ->> 'provider_id'` reads the Discord user ID from the JSON
  metadata Supabase saves during OAuth. `->>` is the operator that reads a JSON field
  as text (vs `->` which reads it as JSON).
- `and auth_user_id is null` ensures the update only runs on rows not yet linked --
  so a second login does not overwrite anything.
- `return new` is required in trigger functions; it passes the inserted row through
  unchanged.

After this trigger exists, any pre-seeded officer who logs in for the first time
immediately gets their `auth_user_id` linked and their role is active within the same
session.

---

## Step 15: Wire up Discord OAuth

1. In Supabase: **Authentication** -> **Providers** -> find **Discord** -> toggle on.
2. Copy the **Callback URL** from that page:
   `https://kxgjqnpwfklbgrxdgmmv.supabase.co/auth/v1/callback`
3. Open the [Discord Developer Portal](https://discord.com/developers/applications)
   and open the existing Raid Hub application.
4. Go to **OAuth2** -> **Redirects** -> click **Add Redirect** -> paste the callback URL.
   Do not touch the existing redirect. Both can be registered at the same time. The
   current login keeps working until you explicitly remove it in Phase 3.
5. Copy the **Client ID** and **Client Secret** from the Discord app page.
6. Paste them into the Supabase Discord provider form and save.

**What the callback URL is:** when Discord finishes authenticating a user, it needs to
know where to send them back. The callback URL is that destination. It goes to
Supabase's auth service, which finalizes the session and fires the trigger from Step 14.

---

## Step 16: Store secrets for Edge Functions

**What an Edge Function is:**

An Edge Function is a small server-side script that runs inside Supabase's
infrastructure, not in the browser. It is the only place where secrets can safely
live. The website calls an Edge Function URL; the function reads its secrets from
environment variables that Supabase injects at runtime; the function does the work
that requires those secrets and returns a result. The browser never sees the secrets.

In Supabase: **Project Settings** -> **Edge Functions** -> **Secrets**. Add each:

| Secret name                | What it is                                        |
|----------------------------|---------------------------------------------------|
| `WCL_CLIENT_ID`            | WarcraftLogs OAuth client ID                      |
| `WCL_CLIENT_SECRET`        | WarcraftLogs OAuth client secret                  |
| `DISCORD_BOT_SECRET`       | Bot webhook secret (currently in Script Properties) |
| `BOT_WEBHOOK_URL_PHOENIX`  | `https://wga-phoenix.duckdns.org`                 |
| `BOT_WEBHOOK_URL_HELLFIRE` | `https://wga-hellfire.duckdns.org`                |
| `SUPABASE_SERVICE_KEY`     | The service_role key from Step 1                  |

The bot URLs are already live on HTTPS. The `SUPABASE_SERVICE_KEY` is what Edge
Functions use when they need to write to the database without RLS applying -- for
example, writing an audit log row or syncing WCL scores.

---

## Step 17: Smoke test

Before touching any app code, verify two things: the database is reachable, and the
RLS policies are doing what you designed them to do.

Open your browser's developer console on any page (F12) and run:

```js
const { createClient } = supabase; // assumes supabase-js loaded via CDN
const sb = createClient(
  'https://kxgjqnpwfklbgrxdgmmv.supabase.co',
  'YOUR_ANON_KEY'
);

// Test 1: Can anonymous callers read public data?
const { data: teams, error: e1 } = await sb.from('teams').select('*');
console.log('Teams:', teams, e1);
// Expect: [{id:1, name:'Phoenix', slug:'phoenix'}, {id:2, ...}], error: null

// Test 2: Are officer-only tables blocked for anonymous callers?
const { data: members, error: e2 } = await sb.from('team_members').select('*');
console.log('team_members (expect []):', members, e2);
// Expect: [], error: null  -- RLS filters to zero rows, does not throw

// Test 3: Are teams isolated from each other?
// Log in as a Phoenix officer first, then run this.
// A Phoenix officer's my_team_role(2) returns null, so Hellfire rows are invisible.
const { data: players, error: e3 } = await sb
  .from('players').select('*').eq('team_id', 2);
console.log('Hellfire players as Phoenix officer (expect []):', players, e3);
```

**What to do if tests fail:**

- Test 1 returns an error: check that the Project URL and anon key are correct.
- Test 1 returns zero rows: the `insert into teams` from Step 3 did not run. Run it.
- Test 2 returns actual rows: one of your `team_members` policies is too permissive.
  Check that the `using` clause on the select policy calls `my_team_role()` and is
  not accidentally set to `using (true)`.
- Test 3 returns Hellfire rows when logged in as a Phoenix officer: the cross-team
  isolation is broken. `my_team_role(team_id)` is returning the wrong value. This
  must be fixed before any officer write features are migrated.

---

## Step 18: Migration files (handled by Russell)

Everything applied in the steps above exists only in the Supabase dashboard right
now. If the project were deleted and recreated, you would have to redo all of it.

The plan is to capture every SQL statement above as numbered migration files in the
repo under `supabase/migrations/`. Once those exist, rebuilding the database from
scratch is a single command (`supabase db push`), and every future schema change
is a PR rather than a dashboard edit. Russell handles authoring these files to match
what was applied above.

---

## What comes next

**Phase 2 -- reads first:** The public roster and loot feed start reading from
Supabase. No logins, no writes. Apps Script stays in charge of everything else.
You verify by comparing Supabase output against the live site row for row.

**Phase 3 -- login:** Discord login switches to Supabase Auth. The trigger from
Step 14 links officers on first login. The old redirect stays registered until
the switch is verified end to end.

**Phase 4 -- audit log infrastructure:** The audit log write path is wired up before
any officer write features move, so every change is recorded from day one.

**Phase 5 -- officer writes:** Roster edits, BiS, attendance, loot, and the priority
generator move one at a time. Each runs against Apps Script in parallel until it
passes a side-by-side check.

**Phase 6 -- settings and secrets:** Season config moves to the `settings` table;
secrets move from Script Properties to Edge Function secrets.

**Phase 7 -- integrations:** WCL sync and Discord bot notifications become Edge
Functions. Apps Script is retired.
