# Local Supabase Dev Stack: Setup Walkthrough

How to run the full Supabase stack (Postgres, Auth, REST API, Studio) on your own
machine with Docker. This is the standard dev setup for the Supabase migration
(decision 8 in [supabase-migration-plan.md](supabase-migration-plan.md)): schema
changes are developed and tested locally first, then pushed to the cloud project.

This guide was written while setting up the first dev machine (Windows 10, AMD CPU)
and covers every step from bare metal. Most steps are one-time.

## 1. Prerequisites

### 1a. CPU virtualization (one-time, BIOS)

Docker on Windows needs hardware virtualization. Check first: open Task Manager >
Performance > CPU and look for `Virtualization: Enabled`, or run in PowerShell:

```powershell
(Get-CimInstance Win32_Processor).VirtualizationFirmwareEnabled
```

If it reports `False`, reboot into BIOS/UEFI setup and enable:

- **AMD boards:** `SVM Mode` (usually under Advanced CPU settings or "OC" > CPU features)
- **Intel boards:** `Intel VT-x` (sometimes "Intel Virtualization Technology")

Save, boot back into Windows, and re-run the check. It should now report `True`.

### 1b. Docker Desktop

Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) with the
WSL 2 backend (the default on Windows 10/11; it works on Home editions). If WSL 2
itself is missing, Docker Desktop's installer sets it up.

Verify Docker is alive:

```powershell
docker version --format '{{.Server.Version}}'
```

Any version number back means the engine is running. If it errors, start Docker
Desktop from the Start menu and wait for the whale icon to settle.

### 1c. Supabase CLI

On Windows, install via [scoop](https://scoop.sh/):

```powershell
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase/supabase
supabase --version
```

On macOS/Linux: `brew install supabase/tap/supabase`.

If a freshly installed command is not found in an already-open terminal, open a new
terminal (the PATH change only applies to new sessions).

### 1d. psql and pg_restore

For command-line checks against the local database, and required by sections
11 and 12. On Windows:

```powershell
scoop install postgresql
```

On macOS: `brew install libpq`, or the full `postgresql@17`.

**Version 17 or newer.** The local server is 17 (`supabase/config.toml`), and a
client older than the server cannot read an archive that server wrote, which is
how section 12 fails on an old client. Check with `pg_restore --version`.

Note: scoop's postgresql package adds its `bin` directory to PATH instead of
creating shims, so `psql` only resolves in terminals opened after the install.
The binary lives under `scoop/apps/postgresql/current/bin/`.

### 1e. AWS CLI (section 12 only)

Only needed to pull a production dump out of R2 (section 12). Everything else
in this document works without it.

```powershell
scoop install aws
```

On macOS: `brew install awscli`. Version 2.13 or newer, because section 12 puts
the R2 endpoint on the profile rather than on every command line, and older
versions ignore it there. Check with `aws --version`.

## 2. Start the stack

The repo already contains the CLI project scaffolding (`supabase/config.toml`,
created once with `supabase init`), so you do NOT run `supabase init` yourself.
From the repo root:

```powershell
supabase start
```

The first run downloads several GB of Docker images and takes a few minutes.
Later runs take seconds. When it finishes it prints the local endpoints and keys.

To see them again at any time: `supabase status`.

| Service | URL |
|---------|-----|
| API (REST/Auth/GraphQL) | http://127.0.0.1:54321 |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Studio dashboard | http://127.0.0.1:54323 |
| Mailpit (captures outgoing mail) | http://127.0.0.1:54324 |

The keys printed by `supabase status` (anon key, service role key, JWT secret) are
the same well-known defaults on every machine that runs Supabase locally. They are
not secrets and they do not touch the cloud project.

## 3. Verify it works

1. Open http://127.0.0.1:54323 in a browser. Studio should load and show a running
   database.
2. Query Postgres directly:

   ```powershell
   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select version();"
   ```

3. `docker ps` should list ~11 healthy `supabase_*_WGA-Raid-Hub` containers.

The local stack builds only from `supabase/roles.sql` plus the migration files in
`supabase/migrations/`; it knows nothing about the cloud schema beyond what those
files capture. Run `supabase db reset` and the 20 public tables should appear
(check in Studio or with `\dt public.*` in psql).

`roles.sql` exists because the cloud cluster has a custom `claude_readers` role
that the RLS policies in the baseline migration reference. Local and shadow
databases need that role created before the migrations run or the policy
statements fail with `role "claude_readers" does not exist`.

Since #1010 it carries a second statement, revoking the default EXECUTE on new
public functions from `anon`, `authenticated` and `service_role`. The Postgres
image's own init script grants all three, and production grants none of them, so
without this line a local stack hands out execute rights production does not and
a forgotten `revoke` in a migration only ever shows up on production. It lives
here rather than in a migration because this file is applied before any
migration runs, so the default is in place before the first function exists.

## 4. Link to the cloud project (one-time)

Linking tells the CLI which cloud project this repo belongs to, which later enables
`supabase db pull` / `db push`. Run these yourself in a terminal; both involve
credentials that should never pass through anything else:

```powershell
supabase login
supabase link --project-ref kxgjqnpwfklbgrxdgmmv
```

- `supabase login` opens a browser window; approve it and the CLI stores an access
  token for your Supabase account.
- `supabase link` prompts for the cloud database password. Get it from the project
  owner. It is not stored in the repo and must never be committed.

Link state is written to `supabase/.temp/`, which is gitignored. Verify with
`supabase projects list`: the linked project shows a `●` marker.

## 5. Day-to-day commands

| Command | What it does |
|---------|--------------|
| `supabase start` | Start the local stack |
| `supabase stop` | Stop it (data volumes are kept) |
| `supabase status` | Show endpoints and keys |
| `supabase db reset` | Rebuild the local database from `supabase/migrations/` + seed |
| `npm run db:docs` | Regenerate the schema docs in `dbdoc/` (see section 6) |

Docker Desktop must be running before `supabase start`.

## 6. Regenerating schema docs (after any migration change)

The generated docs in `dbdoc/` (markdown + Mermaid ER diagrams, built by
[tbls](https://github.com/k1LoW/tbls)) must match the schema the migrations
produce; the schema-docs CI workflow fails a PR when they drift.

One-time install: tbls is not in the main scoop bucket. Download the
`tbls_vX.Y.Z_windows_amd64.zip` asset from the
[tbls releases page](https://github.com/k1LoW/tbls/releases), and put
`tbls.exe` somewhere on PATH (this setup used `~\bin`, added to the user PATH).
On macOS/Linux: `brew install k1LoW/tap/tbls`.

Then, whenever migrations change:

```powershell
supabase db reset   # make the local DB match the migration files
npm run db:docs     # regenerate dbdoc/
```

Use the latest tbls release: the schema-docs workflow installs latest, and since tbls 1.96.0
trigger listings are in creation order on every platform, so an older local tbls can produce a
trigger-order diff in CI that is not real staleness. Commit the `dbdoc/` changes together with the migration. `npm run db:docs:check`
runs `tbls diff` locally, the same check CI runs. If your PR adds, alters, or
drops an RLS policy, also update [RLS.md](RLS.md) and regenerate the raw policy
export with `npm run db:rls` (commit `docs/rls_policies.csv`) in the same PR;
CI checks both.

## 7. Applying migrations to production

The rule: a migration reaches prod when its pull request merges. The Deploy
workflow (`.github/workflows/deploy.yml`, #1050) runs `supabase db push`
against prod, then deploys the Edge Functions the merge changed (#1083; a
`_shared/` change deploys its importers, a `config.toml` change deploys all,
and `scripts/ci/functions-to-deploy.js` holds by name what `main` cannot
deploy yet), and only then builds and publishes the site, so a release can
never reach raiders ahead of the schema or the functions it needs. Nothing to
run by hand, and nothing to remember after the merge; a redeploy by hand is
`gh workflow run deploy.yml -f functions=all` (or a comma list of names).

Running the SQL in the dashboard SQL Editor still does not count as applying
it, and the consequence is larger than it used to be: it now blocks every
deploy, not just this one.

The why: the SQL Editor never writes `supabase_migrations.schema_migrations`,
the ledger that `db push` and `migration list` read. Every editor-applied
migration leaves the ledger one row behind reality, `migration list` misreports
prod, and once an unrecorded version sits behind a recorded one, `db push`
refuses to run at all (`LegacyDbPushMissingRemoteError`). On 2026-08-31 the
ledger was 22 migrations behind the live schema for exactly this reason and
had to be reconciled by hand (`supabase migration repair --status applied`,
after verifying each migration's effect was live on prod first; marking an
unapplied migration applied would tell push to never run it). That repair is
what `db push` by hand is for now: recovering the ledger, rather than
delivering a migration.

Two checks watch this, and they read the same tree against the same ledger with
different verdicts on one case:

- **On a pull request**, the Migration ledger check runs with `--pending-ok`. A
  committed migration that is not yet on prod is the normal state of a
  migration PR, since the merge is what applies it, so that passes and is
  listed. A file sorting below the newest applied version still fails, because
  the push would refuse the whole run and the merge would deploy nothing. So
  does a ledger row with no file behind it.
- **At merge and in the weekly sweep**, the same script runs strict, where a
  migration in the tree and not in the ledger is a failure. In the Deploy
  workflow it runs immediately after the push, so what it catches is a push
  that silently did not take.

When the push fails, the site does not deploy and the run posts to Discord.
Fix forward in a new PR: never edit a merged migration, and never reach for
`--include-all`.

Known limits:

- SQL run in the editor with no committed migration file is invisible to this
  check. Catching that needs `supabase db diff` against a shadow database,
  which is not wired up.
- Two open PRs can carry migrations whose timestamps interleave; the CLI
  refuses out-of-order pushes. Since #927 the check catches that before the
  push does: it fails a pending file that sorts below the newest version
  applied on prod, and separately fails a file stamped ahead of the Eastern
  wall clock at the commit that added it, which is what a UTC stamp looks
  like. Both name the same fix,
  `npm run migration:new -- --rename supabase/migrations/<file>`.

## 8. Run the site against the local stack

The stack has the schema and the seed. This puts the site on top of it, so a PR
that touches a migration and a page can be looked at as one thing rather than
as an RLS suite and a guess.

```sh
supabase start     # if it is not already up
npm run serve      # binds http://localhost:3000, Ctrl+C to stop
```

Then open <http://localhost:3000/?team=phoenix>.

**How the page knows.** `js/common.js` and `js/admin.js` resolve the Supabase
target from `location.hostname`: `localhost` and `127.0.0.1` select the local
stack at `http://127.0.0.1:54321` with Supabase's published demo anon key,
anything else selects production. The match is exact, so
`localhost.example.com` is production, and a page with no hostname at all (the
vm sandboxes in `tests/frontend`) is production too. Nothing else can switch it:
no query string, no stored flag. `admin.html` carries its own copy of that block
because it loads neither `common.js` nor `discord.js`, and a CI test pins the
two copies identical.

**Use `localhost`, not `127.0.0.1`, in the browser.** Both resolve the local
stack, but the Twitch embed passes the hostname as its `parent`
(`js/streamers.js`) and accepts `localhost`; the numeric form can be refused,
which shows up as an empty Streams tab rather than an error.

Three things are worth knowing before something looks broken:

- **You are signed out, on every page.** The only sign-in is Discord OAuth
  against production, and the seeded `auth.users` rows are ids with nothing
  attached. Officer and admin pages will offer a login and stop there.
- **The CDN still needs internet.** `supabase-js` and the fonts load from the
  network; only the database and the API are local.
- **`build.json` reads as unrendered Liquid**, because Jekyll runs at deploy
  rather than here. Nothing on the site reads it.

To point a browser at production deliberately, open the deployed site. There is
no switch for pointing a local page at production, on purpose.

## 9. Sign in as a named persona

Section 8 gets you the site; this gets you a person. The only sign-in the site
offers is Discord OAuth against production, so on a local stack every page shows
the signed-out view until you mint a link:

```sh
npm run dev:login                    # lists who this stack holds
npm run dev:login -- phoenix-officer
```

It prints a link. Open it, and the browser lands back on `localhost:3000` signed
in. Every page on that origin sees the session, so switch to `officer.html` or
`admin.html` without doing it again.

The names are the same on both states of the stack. After `supabase db reset`
they are the seed's people; after `npm run db:snapshot` (section 12) they are
minted from the real teams table. A name is `<team>-officer`, `<team>-leader`
or `<team>-raider`, or one of the three guild-wide grants, and a name the
running stack does not hold is refused with the list of the ones it does. Team 1
is Phoenix and team 2 Hellfire Rollers in the seed as in production, so
`phoenix-officer` is the same person either way.

What the seed holds, and what each is for. The teams are production's four:
Phoenix, Hellfire Rollers and Immolation from the seed, Wrathless from the
migration that created it, and each has its three people, so the seed offers
every name a snapshot mints.

| Persona | Who they are |
|---------|--------------|
| `phoenix-officer` | Officer on team 1. The officer dashboard, the roster, loot and signups. Also holds the BoE manager grant, because the BoE suite acts as one identity that is both an officer and a manager |
| `phoenix-leader` | Team leader on team 1. Officer plus the team-leader-only paths |
| `phoenix-raider` | Raider on team 1 with the character Seedraider-Illidan. The raider-facing side: profile, wishlist, BiS, signup |
| `hellfire-officer` | Officer on team 2. What one team's officer must not see of another's |
| `hellfire-leader` | Team leader on team 2 |
| `hellfire-raider` | Raider on team 2 with the character Seedhellfireraider-Illidan |
| `immolation-officer` | Officer on team 3 |
| `immolation-leader` | Team leader on team 3 |
| `immolation-raider` | Raider on team 3 with the character Seedimmolationraider-Illidan |
| `wrathless-officer` | Officer on team 4 |
| `wrathless-leader` | Team leader on team 4 |
| `wrathless-raider` | Raider on team 4 with the character Seedwrathlessraider-Illidan |
| `admin` | Site admin with no team role. `admin.html` and nothing team-scoped. A site admin passes every BoE gate too |
| `guild-officer` | Guild officer who raids on team 1 with no leadership role. Writes on players, attendance, schedule and officer notes on every team; no approvals, season, priority, loot import or BoE |
| `boe-manager` | The BoE manager grant and nothing else: the guild banker who is not a site admin, which is what the grant exists for |
| `signup-owner` | A signup with no roster row and no grant. The signed-in view of somebody who applied and was never added |

A snapshot mints the same twelve team names plus `admin`, `guild-officer` and
`boe-manager`; section 12 has that table. The only names on one stack and not
the other are `signup-owner`, which is a seed fixture, and whatever a fifth
production team would add.

**One specific real person, by Discord id.**

```sh
npm run dev:login -- --discord-id 123456789012345678
```

This creates or reuses an account whose `provider_id` is that id, which is what
`link_auth_user_to_member()` keys on, so it binds to whatever grant rows already
name that person. On a seeded stack that is nobody; it matters after section 12,
where real rows are restored with their auth links cleared, and there it means
reading that person's data. The named personas cover every role without it.

**No email is sent and none is needed.** The addresses are `@wga.local`, the
link comes back from the API rather than an inbox, and anything the stack does
try to mail is caught by Mailpit at <http://127.0.0.1:54324>.

**If it says the stack is not running**, start it with `supabase start`. The
script reads the API URL and the service key from `supabase status` each time
it runs, so neither is ever written down.

**Changing `[auth]` in `supabase/config.toml` needs a restart, not a reset.**
The auth container reads that file when it starts, so `supabase db reset` leaves
the old `site_url` in place and links keep redirecting to the previous port.
`supabase stop && supabase start` applies it.

**Signing in as your real Discord self** is possible and not needed for most
work. It takes a `[auth.external.discord]` block in `supabase/config.toml`
reading its id and secret through `env()` from a root `.env` (already
gitignored), plus `http://127.0.0.1:54321/auth/v1/callback` added to the redirect
list of a Discord application. The seeded personas cover every role without it.

## 10. Rehearse a migration PR end to end

Since #1050 the merge is what applies a migration to production, so your own
machine is the place to see a migration running under the site, before the PR
merges. Sections 8 and 9 supply the pieces; this is the order for a PR that
touches a migration and a page.

**Four commands from an empty file to the site signed in on top of it.** The
stack has to be up first (`supabase start`), and `npm run serve` holds its
terminal, so it wants a second one.

```sh
npm run migration:new -- <slug>   # 1. stamps a file under supabase/migrations/; write the SQL in it
supabase db reset                 # 2. rebuilds the database from every migration, then the seed
npm run serve                     # 3. serves the site at http://localhost:3000 from your checkout
npm run dev:login -- phoenix-officer   # 4. prints a sign-in link; open it
```

Then open the pages the PR touches, as the person the change is for. The table
in section 9 says who each persona is; `phoenix-officer` is the right first pick
for most schema work and `phoenix-raider` for anything on the profile side. This is the step
nothing else covers: the RLS suite proves what the policies allow and says
nothing about whether the page asks for it correctly.

Once the loop is running:

- **Change the SQL, reset, reload.** `supabase db reset` is the only way to
  re-apply a migration file, and it rebuilds from empty every time, so what you
  are looking at is what a fresh database gets rather than the accumulation of
  your afternoon. Let it finish before reloading.
- **Change a page, reload.** The site is served straight from your checkout and
  read from disk on every request, so nothing needs restarting.
- **A reset does not sign you out.** The pages read the session from the browser
  rather than asking the server, and the seed puts the same people back, so what
  you already have keeps working. It lasts about an hour, after which the
  renewal fails against a database that no longer holds the token and you mint
  another link.
- **A reset does not read `supabase/config.toml` either.** If you changed
  anything under `[auth]`, that takes `supabase stop && supabase start`; section
  9 has the symptom, which is a sign-in link that keeps landing on the old port.
- **On the slug and the stamp:** name the slug after the object changed
  (`<table>_<column>`, `<function>_<what changed>`), and open the file with
  `-- #NNN: <what it does>.`, a bare `--`, then why it is needed. Never
  `supabase migration new`, which stamps UTC and has twice sorted a later
  migration ahead of an earlier one.

**Before opening the PR, regenerate what the schema drives.** CI fails a PR
whose generated docs are stale and cannot regenerate them for you:

```sh
npm run db:docs     # dbdoc/, after any schema change
npm run db:rls      # docs/rls_policies.csv, only if a policy changed
```

Section 6 has the tbls install, which is a manual download the first time, and
the version trap that produces a trigger-order diff that is not real staleness.
A policy change also moves [RLS.md](RLS.md) and the assertions in `tests/rls/`,
in the same PR.

**What the PR runs for you.** The RLS suite, `supabase db lint` and the security
advisors all run on a migration PR against a stack CI builds from your files, so
none of them has to run here first. Run them locally when you want the answer
sooner than the checks give it:

```sh
npm run test:rls
supabase db lint --local --schema public --level warning --fail-on warning
supabase db advisors --local --type security --level warn --fail-on none --output-format json > advisors.json
node scripts/ci/advisor-check.js advisors.json
```

**What the ledger check on your PR is saying.** On a pull request it runs with
`--pending-ok`: a committed migration that is not on production yet passes and
is listed, because that is now the normal state of every migration PR. It still
fails a file that sorts below the newest version applied on prod, and a ledger
row with no file behind it. Section 7 has both checks and the one case they
read differently.

**Do not push it to production first.** `supabase db push` from your branch
works, which is the problem: it writes the ledger row while the file is still
unsettled. Re-stamp the migration, which the out-of-order rule regularly asks
for, or abandon the PR, and production is left holding a ledger row naming a
file `main` never had. The strict check fails that, the strict check runs inside
the Deploy workflow, and every deploy for everyone is blocked until someone
repairs the ledger by hand. Pushing by hand is the repair route now, not the
delivery route.

**When the stack misbehaves, ask whether the database is there before reading
any assertion.** A run that fails wholesale is a claim about the environment
rather than about the change:

```sh
psql "postgres://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable" \
  -c "select count(*) from pg_proc where pronamespace = 'public'::regnamespace"
```

Two known failures answer that badly, and a completed `supabase db reset` cures
both. A stack that has been up for many hours can report `(healthy)` from
`docker ps` while Postgres refuses every client, because the healthcheck is a
claim about the container and not about connections. And a reset that is still
running has only part of its schema applied, so anything started against it is
genuinely missing objects. Both arrive as errors raised per test, which read
like assertion failures, which is why this one query is worth more than the
first red case. Section 1d has psql if it is not installed yet.

**Nothing on this stack reaches production.** Four migrations schedule
`pg_cron` jobs whose command carries the production functions URL, and a reset
recreates them, so the seed switches all four off after the fixtures (#1055).
They stay in the catalog, because that schedule is production's and editing it
locally would drift from prod in a way nothing compares. Section 11 has how to
run one on purpose.

## 11. Serve the Edge Functions locally

The site reaches the functions on its own once section 8 is running, because
every call goes through `supabaseClient.functions.invoke` and the client is
already pointed at the local stack. What needs setting up is where the
functions post to, since most of them end at a Discord webhook and a rehearsal
that needs a real webhook URL is a rehearsal that can post into a channel a
team operates in.

**Catch the posts on your own machine.** In its own terminal:

```sh
npm run dev:sink                  # answers 204 like Discord, prints what it was sent
npm run dev:sink -- --status 500  # the other half: refuses, so the error paths run
```

**Point the functions at it.** Copy `supabase/functions/.env.example` to
`supabase/functions/.env` (gitignored) and set every `*_WEBHOOK_URL` to the
sink, plus any value you like for `OPTIONAL_RSVP_REMINDERS_SECRET`:

```sh
BOE_WEBHOOK_URL=http://host.docker.internal:8899/webhooks/boe-found
DISCORD_TEST_WEBHOOK_URL=http://host.docker.internal:8899/webhooks/test-channel
OPTIONAL_RSVP_REMINDERS_SECRET=any-local-value
```

`host.docker.internal` rather than `127.0.0.1`: the functions runtime is a
container and cannot see the machine's own localhost.

**Serve them.**

```sh
supabase functions serve --env-file supabase/functions/.env
```

The CLI injects `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` for the local stack, so those never go in the file.
Whether a function wants an `Authorization` header is `verify_jwt` in
`config.toml`, per function since #958: the five listed there take none, and
everything else wants the anon key.

**Post to one in smoke mode**, which is the mode that exists so a poster can be
exercised without reaching a team's channel (#1007). It goes to
`DISCORD_TEST_WEBHOOK_URL` and prefixes the message with `[smoke]`:

```sh
ANON=$(supabase status -o json | node -pe "JSON.parse(require('fs').readFileSync(0)).ANON_KEY")
curl -X POST "http://127.0.0.1:54321/functions/v1/boe-webhook" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: any-local-value" \
  -d '{"id":1,"smoke":true}'
```

That answers `{"success":true}` and the post prints in the sink's terminal.
`id` is a row in `boe_items`; the seed ships two.

**Fire a cron function by hand.** The scheduled jobs are inactive on a local
stack (section 10), so this is how those functions get run. They take no JWT
and check the operator header instead:

```sh
curl -X POST "http://127.0.0.1:54321/functions/v1/optional-rsvp-reminders" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: any-local-value" -d '{}'
```

To let the schedule itself run for a session, switch one job back on:
`select cron.alter_job(<jobid>, active := true);`. It will call **production**,
not your stack, because the command the migration wrote names the production
host. That is almost never what you want.

**If a fresh serve answers nothing**, with `curl: (52) Empty reply from server`
and no request lines in the runtime's log, it is Kong rather than the function.
A `functions serve` starts a new edge-runtime container and a Kong that has
been up for days keeps routing to the one that is gone. Restarting it is safe,
since it holds no state:

```sh
docker restart supabase_kong_WGA-Raid-Hub
```

## 12. Rehearse against last night's production data

**This section is optional.** Sections 8 to 11 are the everyday rehearsal
loop: they need no account, no token, and put nothing sensitive on your
machine. Come here only when the shape of the data matters, and you can get
everything else working first.

Those sections all run on the seeded stack, so a migration is rehearsed on
six players and a handful of people across four teams, and a page is clicked
through on the same. This loads the nightly backup instead: the `pg_dump` of
`public` that `db-backup.yml` ships to R2, restored under the schema it was
taken from, with this branch's own migrations run on top.

**When the dump is from.** The backup is scheduled for 10:00 UTC and does not
run then. Measured across eight consecutive days, GitHub started it between
13:13 and 15:28 UTC, because scheduled workflows are queued at low priority
and the top of the hour is the most contended slot there is. So before
mid-afternoon UTC the newest dump is yesterday's, which is fine and is not a
failed backup. The tool reads each object's own timestamp rather than
assuming one, and prints the capture instant it used.

**What it needs first:** the AWS CLI (section 1e), a Postgres client 17 or
newer (section 1d), and a read-only token for the bucket, which the next
subsection covers. Without them the run stops on its first step and says which
one is missing.

```sh
npm run db:snapshot           # newest dump, schema version worked out for you
npm run db:snapshot -- --plan # print the steps and run nothing
```

**This puts production data on your machine.** Real names, Discord ids, officer
notes, the audit log. The next `supabase db reset` wipes it, the downloaded
file is deleted as soon as the restore succeeds, and none of it is ever
committed or shared. Treat the laptop it is on the way you would treat the
production dashboard.

### Getting access to the bucket

A token to this bucket is a copy of production, so it is granted the way
production access is granted, not the way a dev tool is. Two kinds of
credential reach the bucket: the read-write token the nightly workflow holds
as a repo secret, and one read-only token per person, minted in the
Cloudflare dashboard, scoped to this bucket alone with **Object Read only**,
and held in that person's own AWS CLI profile. Never the read-write token,
and never an account-wide one. One token per person, because R2 has no
per-user identity: the token *is* the identity, so a shared one cannot be
revoked for one person without revoking it for everybody.

**If you do not own the bucket**, the owner mints your token and hands it to
you. It is yours alone, and revoking it touches nobody else.

**If you do own the bucket**, owning it is how tokens get minted, not how
dumps are read on your machine. Mint yourself one the same way, scoped to
this bucket with Object Read only, and hold it in a profile like anyone else;
that is how it is done today. Not the account's own credentials, and not the
read-write token the workflow holds: a read-write production credential on a
dev machine is exactly what the split exists to prevent.

**The profile's name is a label you choose on your own machine.** It has
nothing to do with what the token is called in Cloudflare, and nobody else's
profile is visible to you. `npm run db:snapshot` looks for a profile named
`wga-raidhub-backups-ro` unless told otherwise, so either name yours that or
pass `--profile <name>` (or set `AWS_PROFILE`). The commands below use the
default.

Set it up once:

```sh
aws configure --profile wga-raidhub-backups-ro
aws configure set endpoint_url https://<account-id>.r2.cloudflarestorage.com --profile wga-raidhub-backups-ro
```

The second line is why no command here carries `--endpoint-url` and why the
account id is typed exactly once. It is not in this repo (it is a repo secret);
it is on the R2 page of the Cloudflare dashboard. **Both lines matter**: keys
without the endpoint send the request to Amazon, which answers
`InvalidAccessKeyId` and reads like a bad token.

Prove it before going further, because everything below assumes it works:

```sh
aws s3 ls s3://wga-raid-hub-backups/pg/ --profile wga-raidhub-backups-ro
```

A list of `wga-<date>.dump` objects means you are done. One thing to know:
pressing Enter at an `aws configure` prompt leaves that key **blank** when
there was nothing stored before, rather than keeping an old value.

### What it does, and why each step is there

1. Lists the bucket and takes the newest `wga-<date>.dump`, ignoring the
   `wga-auth-` dumps beside it.
2. Works out the schema that dump belongs to: the newest migration **merged**
   before the dump was captured. Merged, not stamped, because since #1050 the
   merge is what applies a migration to production, and a PR that sits open for
   a day is normal here. `supabase db reset --version <that> --no-seed`.
3. Switches the cron jobs off. The seed normally does that (section 10) and
   `--no-seed` skipped it.
4. Empties every table in `public`. 46 migrations insert rows of their own, and
   a data-only restore on top of those would stop at the first duplicate key.
   The list comes from the catalog, so a new table cannot be missed.
5. `pg_restore --data-only --disable-triggers`. Triggers off because the nine
   foreign keys into `auth.users` would every one fail: your local `auth.users`
   is empty and the restored rows carry production's ids.
6. Nulls those nine columns. This is the full-rebuild runbook's own step 9, and
   it is what makes signing in work: `link_auth_user_to_member()` only ever
   fills a link that is `null`, so leaving production's ids in place would mean
   signing in successfully and seeing nothing.
7. Mints the personas: an officer, a team leader and a raider for every team
   in the restored `teams` table, plus `admin`, `guild-officer` and
   `boe-manager`, each an account with its grant row bound to it and, for each
   raider, one character of its own. After the nulling so no real account is
   ever bound; before the migrations so these rows go through them like the
   restored ones. It prints the names.
8. `supabase migration up --local`, so this branch's migrations run on
   production-shaped data. This is the step the whole thing exists for.
9. Prints the row counts of the eight tables the backup workflow refuses to see
   empty, so a restore that technically succeeded but loaded nothing is
   visible. A test keeps that list identical to the workflow's own.

The dump is about a megabyte, so the download is never the slow part. The
reset is.

Sequences come back with the data. `restart identity` resets them by ownership
rather than by name, which is what handles `season_signups` still owning the
legacy `signups_id_seq`, and the dump then sets each one. No `setval` by hand,
unlike the selective restore in [backup-restore.md](backup-restore.md).

### Signing in afterwards

The seeded people are gone, because they were seed rows and the seed did not
run. Step 7 minted their replacements, and `npm run dev:login` with no name
lists them. On today's four teams that is fifteen:

| Persona | Who they are |
|---------|--------------|
| `<team>-officer` | Officer on that real team: `phoenix-officer`, `hellfire-officer`, `immolation-officer`, `wrathless-officer` |
| `<team>-leader` | Team leader on that team, same four |
| `<team>-raider` | Raider on that team, owning the character `<Team>raider-Persona` with an empty wishlist and BiS, same four |
| `admin` | Site admin |
| `guild-officer` | The guild-wide grant, no team row |
| `boe-manager` | The guild-wide BoE manager grant |

These are real grants, not impersonation: every policy reads
`auth_user_id = auth.uid()` and nothing else, so `phoenix-officer` sees exactly
what a Phoenix officer sees and is nobody. The rows are synthetic and easy to
tell apart: Discord ids of 20 digits starting with 9, which no real id can be,
and one `<Team>raider-Persona` on each team's roster, which is the raider
persona's character. A new team gets its three with no code change.

**A name the stack does not hold is refused**, with the list of the ones it
does. Before this, `npm run dev:login -- officer` on a snapshot minted an
account with no grant row and signed you in with no access, which read like
broken policies.

**One specific real person** is still reachable with `--discord-id <id>`,
which binds a local account to that person's real rows across `team_members`,
`site_admins`, `boe_managers` and `guild_officers`. That is reading their
data; reach for it only when the question is about that person.

Photos still point at production Storage, so they either load from the public
bucket or do not load. Nothing to fix.

**Do not run `npm run test:rls` against a snapshot.** The suite asserts against
the seed, and the seeded personas and fixtures are not there. `supabase db
reset` first, which also puts the quiet cron jobs back.

**Reset before you re-stamp or drop a migration you rehearsed here.**
`supabase migration up --local` writes the version into the local ledger, so
removing or renaming that file afterwards leaves a local row naming a file that
no longer exists. It is the same orphan the strict check catches on production
(section 7), and out-of-order re-stamping asks for exactly this often enough to
be worth the habit. A reset clears it.

### When it fails

Every step stops on its own error and names itself, and the restore runs in one
transaction, so a failure leaves the tables empty rather than half loaded. The
downloaded dump is kept on a failure and deleted on success.

- **`ERROR: column "..." does not exist`, naming a table.** The dump and the
  schema disagree. Usually the checkout is behind: `git pull` on `main` (or
  rebase the branch) and run it again. Otherwise pass an older `--dump` or an
  explicit `--version`.
- **`No migration on this branch was merged before ...`.** The dump predates
  the history you have, or the clone is shallow. Pass `--version <stamp>`.
- **`Credential access key has length 0, should be 32`.** The profile exists
  with empty keys, which is what `aws configure` leaves when you press Enter
  through its prompts. Run it again and paste both values.
- **`InvalidAccessKeyId: ... does not exist in our records`.** The keys are set
  but the endpoint is not, so the request went to Amazon rather than
  Cloudflare. Run the `aws configure set endpoint_url` line above.
- **`"aws" is not installed or not on PATH`**, or the same for `pg_restore`.
  Sections 1e and 1d.
- **`SSL: SSLV3_ALERT_HANDSHAKE_FAILURE`** from `aws`. This is always the
  account id in the endpoint and never the path or the key, because TLS
  finishes before the request path is sent. Re-check the `endpoint_url` on the
  profile.
- **`input file is too short`** from `pg_restore`. A truncated download, which
  on this machine usually means an unclean shutdown mid-fetch. Run it again.

If your `pg_restore` is older than 17 it cannot read the archive. The stack's
own container carries 17.6, so it can:

```sh
MSYS_NO_PATHCONV=1 docker cp <the dump> supabase_db_WGA-Raid-Hub:/tmp/wga.dump
MSYS_NO_PATHCONV=1 docker exec supabase_db_WGA-Raid-Hub \
  pg_restore --data-only --disable-triggers --no-owner --exit-on-error --single-transaction \
  -U supabase_admin -d postgres /tmp/wga.dump
```

`MSYS_NO_PATHCONV=1` is for Git Bash on Windows only, and drops on macOS and
Linux. Those are paths inside the container, and without it Git Bash rewrites
them so the error names a path you never typed.

## Known quirk: vector container restart loop (Windows)

On Docker Desktop for Windows the `supabase_vector` container (log shipping for the
local Logs page) can restart-loop forever. Everything else works fine. Local
analytics is therefore disabled in `supabase/config.toml` (`[analytics]
enabled = false`), which removes the vector and analytics containers from the
stack. The only loss is the Logs page inside local Studio.

## What comes next

With the stack running, linked, and the baseline migration captured
(`supabase/migrations/20260704204411_initial_schema.sql`, pulled with
`supabase db pull --diff-engine migra`; the default pg-delta engine reported
"no schema changes found" against the live schema, so use the migra engine),
the next migration-plan steps are:

- **Schema fixes as migrations:** issues #271 and #272 ride the new workflow.
- **Test harness:** vitest RLS policy matrix against the local stack.

See the roadmap in [supabase-migration-plan.md](supabase-migration-plan.md).
