# Supabase Database Setup Guide

This guide walks through setting up the Supabase database described in the migration
plan (PR #195), step by step. The Supabase project is assumed to already exist.

---

## Step 1: Collect your project credentials

1. Go to [supabase.com](https://supabase.com) and open your project.
2. In the left sidebar go to **Project Settings > API**.
3. Write down these two values (you will need them throughout the guide):
   - **Project URL** — looks like `https://xyzxyz.supabase.co`
   - **anon public key** — a long string starting with `eyJ...`
4. Stay on the API page and also note the **service_role key** (keep this private —
   it goes only into Edge Function secrets, never into the website code).

---

## Step 2: Create the reference tables

These tables hold shared data (items, bosses) and have no team tag.
Run the following SQL in **SQL Editor** (left sidebar > SQL Editor > New query).

```sql
-- Items master list
create table items (
  id          serial primary key,
  name        text not null,
  slot        text not null,
  armor_type  text,
  sort_id     integer
);

-- Maps items to the boss they drop from
create table item_bosses (
  item_id  integer references items(id) on delete cascade,
  boss     text not null,
  primary key (item_id, boss)
);

-- Optional: class/spec reference
create table classes_specs (
  id        serial primary key,
  class     text not null,
  spec      text not null,
  role      text
);
```

Click **Run**.

---

## Step 3: Create the teams table

```sql
create table teams (
  id          serial primary key,
  name        text not null unique,
  slug        text not null unique  -- e.g. 'phoenix', 'hellfire'
);

-- Insert your two teams now
insert into teams (name, slug) values
  ('Phoenix', 'phoenix'),
  ('Hellfire', 'hellfire');
```

---

## Step 4: Create team_members

This table is the authority on who is an officer or admin. It is keyed on Discord ID
because that is known before a user logs in for the first time. The `auth_user_id`
column starts null and is filled in automatically on first login (see Step 9).

```sql
create table team_members (
  id            serial primary key,
  team_id       integer not null references teams(id) on delete cascade,
  discord_id    text not null,
  auth_user_id  uuid references auth.users(id) on delete set null,
  role          text not null check (role in ('raider', 'officer', 'admin')),
  name_realm    text,  -- e.g. 'Katarii-Stormrage'
  unique (team_id, discord_id)
);
```

After creating the table, insert the current officers and admins by their Discord user
IDs (right-click a user in Discord > Copy User ID with developer mode on):

```sql
insert into team_members (team_id, discord_id, role, name_realm) values
  (1, 'DISCORD_ID_HERE', 'admin', 'CharName-Realm'),
  -- add all current officers for team 1 (Phoenix) ...
  (2, 'DISCORD_ID_HERE', 'officer', 'CharName-Realm');
  -- add all current officers for team 2 (Hellfire) ...
```

---

## Step 5: Create the players and scoring tables

```sql
create table players (
  id          serial primary key,
  team_id     integer not null references teams(id) on delete cascade,
  name_realm  text not null,   -- full 'Name-Realm', the stable key
  class       text,
  spec        text,
  rank        text,            -- guild rank label
  note        text,
  active      boolean not null default true,
  unique (team_id, name_realm)
);

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

---

## Step 6: Create the loot and BiS tables

```sql
-- BiS list: one row per player per item (long form, replaces the grid)
create table bis_items (
  id         serial primary key,
  player_id  integer not null references players(id) on delete cascade,
  item_id    integer references items(id) on delete set null,
  item_name  text,   -- fallback if item_id not yet in master list
  slot       text,
  obtained   boolean not null default false
);

-- Loot log: one row per drop awarded
create table loot (
  id           serial primary key,
  team_id      integer not null references teams(id) on delete cascade,
  player_id    integer references players(id) on delete set null,
  item_id      integer references items(id) on delete set null,
  item_name    text not null,
  boss         text,
  awarded_at   timestamptz not null default now(),
  rclc_id      text,           -- RCLootCouncil unique ID for deduplication
  dedupe_key   text unique     -- hash of (team_id, rclc_id) to block re-imports
);
```

---

## Step 7: Create the attendance table

```sql
create table attendance (
  id           serial primary key,
  team_id      integer not null references teams(id) on delete cascade,
  player_id    integer not null references players(id) on delete cascade,
  raid_date    date not null,
  report_id    text,  -- WCL report ID
  present      boolean not null default true,
  unique (team_id, player_id, raid_date)
);
```

---

## Step 8: Create the priority order table

```sql
-- Long form: one row per player per rank slot (replaces the rank grid)
create table priority_order (
  id        serial primary key,
  team_id   integer not null references teams(id) on delete cascade,
  rank      integer not null,   -- 1 = highest priority
  player_id integer not null references players(id) on delete cascade,
  season    text not null,
  unique (team_id, season, rank)
);
```

---

## Step 9: Create the request queue tables

These are forms that raiders (or anonymous visitors) submit. Officers review and
approve them.

```sql
-- Raid signup form
create table signups (
  id              serial primary key,
  team_id         integer not null references teams(id) on delete cascade,
  character_name  text not null,
  realm           text not null,
  class           text,
  spec            text,
  note            text,
  submitted_at    timestamptz not null default now(),
  status          text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected'))
);

-- BiS change requests from raiders
create table bis_requests (
  id         serial primary key,
  team_id    integer not null references teams(id) on delete cascade,
  player_id  integer references players(id) on delete set null,
  item_name  text not null,
  slot       text,
  submitted_at  timestamptz not null default now(),
  status     text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected'))
);

-- "I received this item" self-reports
create table self_received_requests (
  id         serial primary key,
  team_id    integer not null references teams(id) on delete cascade,
  player_id  integer references players(id) on delete set null,
  item_name  text not null,
  submitted_at  timestamptz not null default now(),
  status     text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected'))
);

-- M+ lockout exclusion requests
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

-- Pending roster additions
create table pending_roster (
  id              serial primary key,
  team_id         integer not null references teams(id) on delete cascade,
  name_realm      text not null,
  class           text,
  spec            text,
  rank            text,
  submitted_at    timestamptz not null default now(),
  status          text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected'))
);
```

---

## Step 10: Create the audit log

```sql
create table audit_log (
  id          serial primary key,
  team_id     integer not null references teams(id) on delete cascade,
  actor_id    uuid references auth.users(id) on delete set null,
  action      text not null,
  target_type text,         -- e.g. 'player', 'loot', 'bis_item'
  target_id   integer,
  detail      jsonb,        -- before/after or extra context
  created_at  timestamptz not null default now()
);
```

---

## Step 11: Create settings and season snapshots

```sql
-- Per-team public config (season name, flags, etc.)
create table settings (
  team_id    integer primary key references teams(id) on delete cascade,
  config     jsonb not null default '{}'
);

insert into settings (team_id, config) values (1, '{}'), (2, '{}');

-- Historical season snapshots
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

Run this block to turn RLS on. Until policies are added (next step) nothing is readable
or writable by the public key, which is the safe default.

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

### Helper function (run once)

This function looks up the caller's role for a given team. Policies call it so the
logic is in one place.

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

### Reference tables — readable by everyone

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

### Roster — public read, officer/admin write

```sql
create policy "Public read players"
  on players for select using (true);

create policy "Officers write players"
  on players for all
  using (my_team_role(team_id) in ('officer', 'admin'))
  with check (my_team_role(team_id) in ('officer', 'admin'));

create policy "Public read scoring"
  on scoring for select using (true);

create policy "Officers write scoring"
  on scoring for all
  using (
    my_team_role((select team_id from players where id = player_id))
    in ('officer', 'admin')
  )
  with check (
    my_team_role((select team_id from players where id = player_id))
    in ('officer', 'admin')
  );
```

### BiS list — public read, officer/admin write

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

### Loot — public read, officer/admin write

```sql
create policy "Public read loot"
  on loot for select using (true);

create policy "Officers write loot"
  on loot for all
  using (my_team_role(team_id) in ('officer', 'admin'))
  with check (my_team_role(team_id) in ('officer', 'admin'));
```

### Attendance — public read, officer/admin write

```sql
create policy "Public read attendance"
  on attendance for select using (true);

create policy "Officers write attendance"
  on attendance for all
  using (my_team_role(team_id) in ('officer', 'admin'))
  with check (my_team_role(team_id) in ('officer', 'admin'));
```

### Priority order — public read, officer/admin write

```sql
create policy "Public read priority_order"
  on priority_order for select using (true);

create policy "Officers write priority_order"
  on priority_order for all
  using (my_team_role(team_id) in ('officer', 'admin'))
  with check (my_team_role(team_id) in ('officer', 'admin'));
```

### Request queues — insert open, read/approve officers only

```sql
-- Signups: anyone can insert (with bot check enforced on the front end),
-- only officers can read or change status
create policy "Anyone insert signups"
  on signups for insert with check (true);

create policy "Officers read signups"
  on signups for select
  using (my_team_role(team_id) in ('officer', 'admin'));

create policy "Officers update signups"
  on signups for update
  using (my_team_role(team_id) in ('officer', 'admin'))
  with check (my_team_role(team_id) in ('officer', 'admin'));

-- Repeat the same three-policy pattern for the other request queues
create policy "Anyone insert bis_requests"
  on bis_requests for insert with check (true);
create policy "Officers read bis_requests"
  on bis_requests for select
  using (my_team_role(team_id) in ('officer', 'admin'));
create policy "Officers update bis_requests"
  on bis_requests for update
  using (my_team_role(team_id) in ('officer', 'admin'))
  with check (my_team_role(team_id) in ('officer', 'admin'));

create policy "Anyone insert self_received_requests"
  on self_received_requests for insert with check (true);
create policy "Officers read self_received_requests"
  on self_received_requests for select
  using (my_team_role(team_id) in ('officer', 'admin'));
create policy "Officers update self_received_requests"
  on self_received_requests for update
  using (my_team_role(team_id) in ('officer', 'admin'))
  with check (my_team_role(team_id) in ('officer', 'admin'));

create policy "Anyone insert mplus_exclusion_requests"
  on mplus_exclusion_requests for insert with check (true);
create policy "Officers read mplus_exclusion_requests"
  on mplus_exclusion_requests for select
  using (my_team_role(team_id) in ('officer', 'admin'));
create policy "Officers update mplus_exclusion_requests"
  on mplus_exclusion_requests for update
  using (my_team_role(team_id) in ('officer', 'admin'))
  with check (my_team_role(team_id) in ('officer', 'admin'));

create policy "Anyone insert pending_roster"
  on pending_roster for insert with check (true);
create policy "Officers read pending_roster"
  on pending_roster for select
  using (my_team_role(team_id) in ('officer', 'admin'));
create policy "Officers update pending_roster"
  on pending_roster for update
  using (my_team_role(team_id) in ('officer', 'admin'))
  with check (my_team_role(team_id) in ('officer', 'admin'));
```

### Audit log — officer read only, no public write

```sql
create policy "Officers read audit_log"
  on audit_log for select
  using (my_team_role(team_id) in ('officer', 'admin'));
```

### Settings and season snapshots — public read

```sql
create policy "Public read settings"
  on settings for select using (true);

create policy "Admins write settings"
  on settings for all
  using (my_team_role(team_id) = 'admin')
  with check (my_team_role(team_id) = 'admin');

create policy "Public read season_snapshots"
  on season_snapshots for select using (true);

create policy "Admins write season_snapshots"
  on season_snapshots for all
  using (my_team_role(team_id) = 'admin')
  with check (my_team_role(team_id) = 'admin');
```

### team_members — officers read own team only

```sql
create policy "Officers read own team_members"
  on team_members for select
  using (my_team_role(team_id) in ('officer', 'admin'));

create policy "Admins write team_members"
  on team_members for all
  using (my_team_role(team_id) = 'admin')
  with check (my_team_role(team_id) = 'admin');
```

---

## Step 14: Add the auth_user_id trigger

When a Discord login completes for the first time, this trigger fills in `auth_user_id`
on the matching `team_members` row (matched by Discord ID from the user metadata).

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

---

## Step 15: Configure Discord OAuth in Supabase

1. In Supabase, go to **Authentication > Providers**.
2. Find **Discord** in the list and toggle it on.
3. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
   and open your existing application (the one used for the current login).
4. Under **OAuth2 > Redirects**, click **Add Redirect** and paste the callback URL
   shown in Supabase (format: `https://xyzxyz.supabase.co/auth/v1/callback`).
   Leave the existing redirect URI in place so the old login keeps working during
   the transition.
5. Copy the **Client ID** and **Client Secret** from the Discord app and paste them
   into the Supabase Discord provider form.
6. Save.

---

## Step 16: Store secrets for Edge Functions

In Supabase go to **Project Settings > Edge Functions > Secrets** (or use the Supabase
CLI: `supabase secrets set KEY=value`). Add:

| Secret name           | Value                                      |
|-----------------------|--------------------------------------------|
| `WCL_CLIENT_ID`       | WarcraftLogs OAuth client ID               |
| `WCL_CLIENT_SECRET`   | WarcraftLogs OAuth client secret           |
| `DISCORD_BOT_SECRET`  | The bot webhook secret from Script Props   |
| `BOT_WEBHOOK_URL`     | The HTTPS address of the Discord bot       |
| `SUPABASE_SERVICE_KEY`| The service_role key from Step 1           |

Do not put any of these in the website's JavaScript. They live only here.

---

## Step 17: Smoke-test the connection

Before writing any application code, confirm the database is reachable and RLS is
working.

Open your browser console on any page (or use a throwaway HTML file) and run:

```js
const { createClient } = supabase;  // assumes supabase-js loaded via CDN
const sb = createClient('YOUR_PROJECT_URL', 'YOUR_ANON_KEY');

// Should return the two teams — public read, no login needed
const { data, error } = await sb.from('teams').select('*');
console.log(data, error);

// Should return empty array (not an error) — no logged-in user means RLS blocks it
const { data: members, error: e2 } = await sb.from('team_members').select('*');
console.log(members, e2);
```

Expected results:
- First query: two rows (`Phoenix`, `Hellfire`), `error` is null.
- Second query: empty array `[]`, `error` is null (RLS silently filters, not rejected).

If the first query errors, double-check the Project URL and anon key. If it returns
no rows, confirm the `insert into teams` from Step 3 ran successfully.

---

## What comes next

The database is now ready for Phase 1 of the migration roadmap. The next steps
(covered in separate guides as each phase starts) are:

- **Phase 2:** Point the public roster and loot feed reads at Supabase instead of
  the Apps Script backend, verifying row counts match the live Sheet before switching.
- **Phase 3:** Swap Discord login to Supabase Auth, using the trigger from Step 14
  to restore officer access automatically on first login.
- **Phase 4 onward:** Migrate each officer write feature one at a time, audit log first.
