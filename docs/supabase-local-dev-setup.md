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

### 1d. psql client (optional but useful)

For command-line checks against the local database. On Windows:

```powershell
scoop install postgresql
```

Note: scoop's postgresql package adds its `bin` directory to PATH instead of
creating shims, so `psql` only resolves in terminals opened after the install.
The binary lives at `~\scoop\apps\postgresql\current\bin\psql.exe`.

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
against prod and only then builds and publishes the site, so a release can
never reach raiders ahead of the schema it needs. Nothing to run by hand, and
nothing to remember after the merge.

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

## 9. Sign in as a seeded persona

Section 8 gets you the site; this gets you a person. The only sign-in the site
offers is Discord OAuth against production, so on a local stack every page shows
the signed-out view until you mint a link:

```sh
npm run dev:login -- officer
```

It prints a link. Open it, and the browser lands back on `localhost:3000` signed
in. Every page on that origin sees the session, so switch to `officer.html` or
`admin.html` without doing it again.

Six people are seeded, and what each is for:

| Persona | Who they are |
|---------|--------------|
| `officer` | Officer on team 1. The officer dashboard, the roster, loot and signups |
| `leader` | Team leader on team 1. Officer plus the team-leader-only paths |
| `raider` | Raider on team 1. The raider-facing side: profile, wishlist, BiS, signup |
| `admin` | Site admin with no team role. `admin.html` and nothing team-scoped |
| `officer2` | Officer on team 2. What one team's officer must not see of another's |
| `guild-officer` | Guild officer who raids on team 1 with no leadership role |

A seventh identity is seeded with no grant row at all, standing for somebody who
signed up and has no roster row. It has no persona name because there is no role
to look at, and `--discord-id` reaches it if it is ever wanted.

**Any Discord id, not just the six.**

```sh
npm run dev:login -- --discord-id 123456789012345678
```

This creates or reuses an account whose `provider_id` is that id, which is what
`link_auth_user_to_member()` keys on, so it binds to whatever grant rows already
name that person. On a seeded stack that is nobody; it matters after section 12,
where real rows are restored with their auth links cleared.

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
npm run dev:login -- officer      # 4. prints a sign-in link; open it
```

Then open the pages the PR touches, as the person the change is for. The table
in section 9 says who each persona is; `officer` is the right first pick for
most schema work and `raider` for anything on the profile side. This is the step
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
first red case. Section 1d covers psql if you skipped it.

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
