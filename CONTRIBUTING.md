# Contributing to WGA Raid Hub

## Workflow

1. Pick an issue from the [issue tracker](https://github.com/katogaming88/WGA-Raid-Hub/issues) or create one first
2. Branch off `main`: `git checkout -b <type>/<short-description>`
   - Types: `feat`, `fix`, `refactor`, `style`, `chore`, `docs`
   - Example: `feat/filter-by-role`
3. Make your changes, then open a pull request against `main`
4. Reference the issue in your PR description (e.g. `Closes #12`)

## Branch naming

| Type | When to use |
|------|-------------|
| `feat/` | New feature or roadmap item |
| `fix/` | Bug fix |
| `refactor/` | Code restructure with no behaviour change |
| `style/` | Visual or layout changes only |
| `chore/` | Config, tooling, project setup |
| `docs/` | Documentation only |

## Versioning

This project follows [Semantic Versioning](https://semver.org/)
(`MAJOR.MINOR.PATCH`), with one version line covering the whole project.

### What the version is a promise about

Semantic Versioning only means something against a declared public API: without
one, the three numbers have no referent. This project has four contracts, and a
break in any one of them breaks the product, so a MAJOR in any row is a MAJOR
for the whole release.

| Contract | Who consumes it | MAJOR | MINOR | PATCH |
|----------|-----------------|-------|-------|-------|
| URLs, bookmarks, sessions | visitors | an old link 404s, points at different data, or requires re-authenticating | a new page, tab or workflow reachable from existing URLs; a bare URL's default target changes but old links still resolve | fixes, copy, layout, performance |
| Schema and RPC surface | the frontend, the bot, the Edge Functions | a table, column, RPC or policy removed or repurposed; a signature changed | a new table, column, RPC, or a new optional parameter | data fixes, indexes, performance |
| Edge Function HTTP contracts | the frontend, `pg_cron`, the bot relay | request or response shape changed incompatibly; a caller class newly refused | a new action or a new optional field | internal changes |
| Site-to-bot relay contract | the bot | an action removed, or its payload changed incompatibly | a new action | internal changes |

The MAJOR bar is about **breaking an existing contract**, not about how much
surface area changed. A large, multi-PR feature (a new page, a new admin tab, a
new tracker) is still MINOR as long as everything that worked before the change
still works the same way after it. Ask "does an old bookmark, saved link, or
existing session still do what it used to?" -- if yes, it's MINOR regardless of
how big the diff is.

### Every PR stamps the product

There are four shipped pieces, and one version line covers all of them. A
release is named by that number, and a change to any piece moves it:

| Piece | Paths | CHANGELOG section |
|-------|-------|-------------------|
| Frontend | `js/`, `css/`, the root HTML pages | `### Frontend` |
| Database | `supabase/migrations/`, `scripts/import/` | `### Backend` |
| Edge Functions | `supabase/functions/` | `### Functions` |
| Bot | `bot/` | `### Bot` |
| Project | everything else | `### Project` |

A PR touching more than one piece writes a section for each and takes one bump.
A PR touching none of them still takes a bump and still writes a line, under
`### Project`: docs, tests, CI, workflows, `supabase/config.toml`, `seed.sql`,
`roles.sql`, `news.json`, this file. That is a patch by default, because none
of the four product contracts moved. `### Project` is required only when no
shipped piece changed, and allowed at any time; a feature PR that also edits
this file owes its `### Frontend` entry and nothing more.

**This replaced the `skip-changelog` exemption** (decided 2026-09-08, #1019).
That label turned all three checks off and was applied automatically to any
diff touching no shipped path, so every test, CI, docs and `news.json` change
reached `main` with no version and no entry, and the release history read as
though those days had no releases. It also made the gate something a label
could switch off on a PR that genuinely shipped. The label is retired rather
than repurposed.

Dependabot is the one exemption left. A bot-opened dependency bump takes no
stamp and no entry, because the bumped dependency is not a product change the
version should track. `changelog.yml` keys that on the PR's author rather than
on `github.actor`, since the workflow also runs on `synchronize`, where the
actor is whoever pushed: a human pushing a conformance fix onto a bot branch
would otherwise fail the bot's own PR.

**This replaced the old rule that a backend-only PR took no bump** (decided
2026-09-06, #965). Under that rule the number tracked the frontend rather than
the release, so 162 migrations, ten Edge Functions and the entire bot moved
without the version ever saying so, and a `### Backend` entry had to ride
whichever version block it happened to land beside. That is also how three
version numbers ended up used twice.

Each piece carries the version of the last release that touched it, recorded in
`version.json` beside its own platform identity: the migration ledger head for
the database, the deploy counter and bundle hash for each function, the commit
for anything built.

Two files at the root carry that, and they are separate on purpose:

| File | Written by | Holds |
|------|-----------|-------|
| `version.json` | `npm run stamp` | The product version and a `pieces` map, computed from the paths the branch changed. Pure JSON, because the stamp and the CI invariant both parse it |
| `build.json` | Jekyll, at deploy | The deployed commit and the build time. It carries Jekyll front matter, which is what makes Jekyll render the Liquid tags inside it, and front matter is exactly what would make `version.json` unparseable |

An absent entry in `pieces` means that piece has never been stamped, never that
it has drifted. A chore PR moves no piece, so it leaves the manifest alone. The version says which release something belongs to; the
platform identity says which artifact is actually live. Both are needed, because
only the second one can show that a piece was merged and never deployed. Since
#1050 the database is the one piece that cannot drift that way: its migrations
apply from the Deploy workflow before the site ships, so the ledger head and
`REQUIRED_SCHEMA` agree after every successful deploy. The Edge Functions still
deploy by hand and the counter is still the only thing that says so.

Bumping the version means more than one file: every local `css/`/`js/` tag on
every page carries a `?v=<VERSION>` cache-bust query string (#431), 56 of them
across the six pages. `npm run stamp -- 3.92.0` rewrites the `VERSION` constant
and every one of those tags in a single pass, and prints a per-page count so a
page that matched nothing is visible rather than reported as a silent success.
It refuses a version that is not `x.y.z`, and it writes nothing at all if any
page would fail.

A released version number is never reissued and a released block is never
rewritten. A wrong number is corrected by the next release, not by editing the
last one. Three numbers in this changelog are used twice (3.77.23, 3.60.32 and
3.60.6); each carries a note saying so, and they stay as they are.

CI enforces this (#353, extended by #966 and #1019): a path in any shipped
piece requires that piece's CHANGELOG section, a PR that ships none of them
requires a `### Project` section, every PR requires the bump, a bump with no
new version heading fails, and a new heading must be unique and above every
heading already in the file. Nothing the stamp itself writes counts as a
frontend change, so stamping
never satisfies the checks it has to pass (#978): not the `VERSION` line, not
`REQUIRED_SCHEMA`, and not the `?v=` tags and footer span it rewrites in all six
pages. Without that, a release shipping only a migration would arrive looking
like a frontend change and be asked for a `### Frontend` entry it has nothing to
put in. A page is judged on what is left after the stamp is taken back out, so
any real edit riding along with one still counts.

A mechanical change to a shipped path (formatting, lint, comment-only edits)
is still that piece's change and logs under that piece's section. Say in the
entry that nothing behaves differently; that is more use to whoever reads the
release than an exemption nobody can see afterwards. `chore/*` as a branch name
is fine for the PR's own classification and exempts nothing on its own (#979),
the same as every other branch prefix now.

No check here is exempt for anyone but Dependabot, and two would not be exempt
even for it, because they are wrong whoever wrote them: the heading rule, and
the manifest re-derivation that recomputes `pieces` from the paths the PR
changed.

### Every release is tagged and published

Merging a stamped PR tags the merge commit `v<VERSION>` and publishes a GitHub
Release whose body is that version's CHANGELOG block (#968). Nothing to do by
hand: `.github/workflows/release.yml` runs on `main` whenever `version.json` or
`CHANGELOG.md` moves.

It skips quietly when the tag already exists, because a push can touch
`CHANGELOG.md` without stamping. It fails when the version's heading appears
twice, because a tag names one commit and a release cannot pick between two
blocks. `npm run stamp` cannot see that case: nothing requires a branch to be up
to date before merge, so two PRs can stamp the same number and both land. The
fix is a follow-up stamp PR to the next free number, never a retag.

The Releases page is the public changelog, and the Discord deploy notification
names the version it deployed.

## Pull requests

- Keep PRs focused on one issue or theme
- Update `CHANGELOG.md` under `### Frontend` / `### Backend` per the
  versioning section above
- `js/common.js` is type-checked (`// @ts-check` plus JSDoc annotations, no
  build step). If you touch a checked file, run `npm run typecheck`; CI runs
  the same check on every `js/` change. Add `// @ts-check` to more `js/`
  files as they get touched
- Edge Functions under `supabase/functions/` are type-checked and linted in
  CI on every PR that touches them (`.github/workflows/edge-functions.yml`:
  `deno check` over each `index.ts`, `deno lint` over the directory, config
  in `deno.jsonc` at the repo root), and formatted by the same Prettier run
  as everything else. Locally: `scoop install deno` on Windows, then
  `deno check supabase/functions/*/index.ts`, `deno lint` and
  `npm run format:check`. The workflow pins the exact Deno release the local
  install uses; bump both in one commit, because CI would otherwise float on
  its own while local stays put. That is the checker's Deno, not the
  runtime's: `supabase/config.toml` pins only the runtime's major, and
  `supabase functions deploy` still bundles without checking anything, so
  the gate is the only place a type error in a function is caught before
  production. Their tests run in the same workflow: see "Testing Edge
  Functions" below
- Frontend logic has unit tests under `tests/frontend/` (they load the plain
  `js/` scripts into a vm sandbox, no browser needed). Run
  `npm run test:frontend`; CI runs the suite on every `js/` change. That job
  pins `TZ=America/New_York`, the project's canonical zone: date logic reads
  the viewer's local calendar date, so a UTC runner cannot catch a
  local-vs-UTC regression (#703). Two rules follow from that zone (#905):
  date logic and calendar facts (raid nights, award dates, join dates)
  reason in Eastern, and an instant shown to a person (a `timestamptz`) is
  rendered in the viewer's own zone with its clock through
  `formatDateTime()` in `js/common.js`, beside a `localTimeZoneNote()` line
  saying so; `tests/ci/date-format-check.test.js` enforces both
- Structural checks over the HTML and the CI tooling live in `tests/ci/`
  (`npm run test:ci`): landmarks, heading order, resolvable anchors, the
  `?v=` asset tags, the changelog classifier, the RLS autocommit guard and the
  security advisor allowlist. These read the pages and the source as text, so
  they judge markup and never behaviour
- Accessibility runs in a real browser under `tests/browser/`
  (`npm run test:a11y`), which needs a one-time
  `npx playwright install chromium`. It serves the site locally and answers
  every third-party and Supabase request from `tests/browser/fixtures/`, so
  it is offline and does not touch production. Eleven public page states are
  loaded, checked against axe at WCAG 2.1 AA, and measured for reflow at
  480px. Each state waits on a sentinel selector that only exists once its
  async reads have rendered, so a page that silently truncated fails rather
  than passing empty
- Two files in that suite measure what axe has no automated rule for, and both
  assert a pair rather than a single reading. `reduced-motion.test.js` reads
  animation and transition durations under `prefers-reduced-motion` and under
  the default, because "the spinner does not animate" is equally true of a
  working media query and of a stylesheet with no animation at all.
  `keyboard.test.js` focuses every focusable element on every state in
  `states.js` and reads its outline back, then checks the modality contract:
  Tab shows a ring, a click on a button or a link does not, and a click into
  a text box or a select does
- `tests/browser/a11y-baseline.json` records every violation the site has
  today, compared for exact equality. A PR that fixes one has to delete its
  entries, and a PR that adds one fails. Refresh it with
  `UPDATE_A11Y_BASELINE=1 npm run test:a11y` and read the diff before
  committing it: the file is the accessibility milestone's scoreboard, so a
  refresh that grows a count needs a reason. An axe-core or playwright bump
  can shift the numbers on its own; that is the harness working, and the fix
  is to refresh the baseline on the bump's own branch

## Testing Edge Functions

The functions under `supabase/functions/` have tests under `tests/edge/`,
run by Deno rather than vitest (#1006): `deno task test`, which CI runs in
`.github/workflows/edge-functions.yml` beside `deno check` and `deno lint`.
Install Deno with `scoop install deno` on Windows; the workflow pins the
release, so keep the two level. The task passes no `--allow-*` flag and sets
`--no-prompt`, so a test that reaches the network or reads an environment
variable fails on permissions rather than asking or quietly touching
something real. Hermeticity is checked, the way `tests/browser/harness.js`
records and fails on every request its fixtures do not answer.

**The shape of a testable function.** `index.ts` is one line,
`Deno.serve((req) => handle(req, productionDeps()))`. `handler.ts` holds
`handle(request, deps)`: the gate, the reads and the response codes, over a
named `db` interface with one method per read or write the function performs
(`readSale(id)`, `managerDiscordIds()`), plus `fetch` and `env`. `deps.ts`
implements that interface over supabase-js and is the only module that
imports it. Pure decisions (message text, arithmetic, classification) sit in
sibling modules such as `format.ts`. A test hands `handle` a plain object; no
test mocks supabase-js's fluent builder, because a fake that omits one link
of a chain turns a throw into a silent empty result. `boe-sold-webhook` is
the worked example; a function takes this shape when the PR that next
touches it does, with tests for what it touches. Anything two functions
share moves to `supabase/functions/_shared/` when the second one arrives.

**Five layers, one runner each, every behaviour in exactly one.**

| Layer | Runner | Home | What it holds |
|-------|--------|------|---------------|
| Pure | `deno task test` | `tests/edge/<function>/` | Message and response builders and their `allowed_mentions`, gate classification, arithmetic, formatting |
| Handler | `deno task test` | same | `handle(request, deps)` against injected dependencies, with a recording fetch |
| Database | `npm run test:rls` | `tests/rls/` | RPC semantics, constraints, RLS, cron rows, races |
| Contract | `deno task test` plus `tests/ci/` | `tests/edge/contract/` | Both ends of the relay, captured payloads, response-type enums (none yet) |
| Live | by hand | the PR body | What only Discord answers, listed before a deploy and recorded after |

**The harness**, `tests/edge/_support/`: `corpus.ts` holds the named ids,
row presets and `envOf()` (one role, one value, so a copy-paste between
roles fails); `fetch.ts` is a recording fetch that stores every call and
answers from a scripted queue, with `discordNoContent()` and
`discordError(status)`; `deps.ts` is `fakeDb(state)` with a call log and
`testDeps()`.

**Conventions.**

- Assert the contract, not the prose: keys, ids, status codes and the exact
  refusal message, decided before the code exists. A post's structure is
  pinned field by field; a phrasing-only gap is recorded, not pinned.
- Red first, and the passes in a red run are read one at a time. A stub
  throws a word no assertion uses (`unbuilt`), because a not-implemented
  error that names its own subject satisfies any assertion built from that
  subject's vocabulary.
- A refactor pins the current output first: run the pre-split code over the
  corpus rows and make those strings the expectations, so the split is
  measured against what was deployed rather than a reading of it.
- At least one test per chain asserts that a later step ran (the fake db's
  call log), not only the step under test.
- On green, a mutation pass over the cycle's modules, with the table in the
  PR body.
- The injected side is exactly what the fakes replace, so before the PR opens
  the function runs once for real against the local stack: `supabase
  functions serve <name> --env-file <file>` with the webhook URL at
  `npm run dev:sink` (section 11 of the local dev doc), and the responses go
  in the PR body.
- Tests deferred on purpose are listed with the change that arms them.

## Project structure

| Path | Purpose |
|------|---------|
| `index.html` | Public page -- landing, raider profiles, season signup |
| `officer.html` | Officer dashboard -- all management tabs |
| `admin.html` | Site admin dashboard -- team management, site admin grant/revoke, feature flags, cross-team audit log, maintenance mode |
| `guild.html` | Guild-wide page -- team selection, streams, news, a BoE Sales link, About the Guild. Not scoped to a team |
| `boe.html` | BoE -- the report form (#891) above the found-BoE auction lifecycle, open to anyone signed in and scoped by the read policies (#890). Reporting needs no login at all. Guild-wide like `guild.html`, reached from the BoE Sales link in every page's nav, and carrying that nav itself since #930 |
| `js/common.js` | Shared globals, `TEAMS`, `TEAM_SLUG`/`IS_COLD_LANDING` resolution, `VERSION`, data helpers, `renderProfile` |
| `js/discord.js` | Discord OAuth login/session mapping, character claim flow |
| `js/roster.js` | Public page boot, cold-landing team picker/auto-redirect, dropdown, stats row, recent loot |
| `js/signup.js` | Multi-step signup form logic |
| `js/officer.js` | Officer boot, session expiry, tab dispatch |
| `js/officer-quick-actions.js` | Officer quick-actions bar (priority export, attendance refresh, loot paste) shown on the public page |
| `js/streamers.js` | Live Twitch streamer widget |
| `js/tabs/tab-*.js` | One file per officer tab (19 files) |
| `js/admin.js` | Standalone boot/logic for `admin.html` -- not team-scoped, so it doesn't reuse common.js/discord.js |
| `js/guild.js` | Boot/logic for `guild.html`. Also not team-scoped, but it does load common.js for `TEAMS` and the guild-wide helpers, then nulls the team globals so a team-dependent call throws rather than rendering Phoenix's data. Skips discord.js, whose session read is hard-scoped to one team |
| `js/boe-page.js` | Boot for `boe.html`: session, the access answer (`fetchBoeAccess()` in common.js: the manage grant plus the teams the caller may settle), then `js/boe-manage.js` renders for anyone signed in. Same team-free shape as `js/guild.js` |
| `js/boe-manage.js` | The BoE lifecycle renderer and its RPC calls; takes the access answer as a parameter and resolves no identity itself |
| `js/boe.js` | The raider-facing report form on `boe.html` (#891): the reporting-team picker with its placeholder, the item picker from its own `items`/`raid_zones` reads, the `submit_boe_found` call and the webhook ping. Loaded before `js/boe-page.js`, which nulls the team globals it reads at parse time |
| `css/styles.css` | Shared styles across all pages |
| `css/officer.css` | Officer-specific styles (partial split out of `styles.css`, still in progress) |
| `css/admin.css` | Admin-page-specific styles |
| `css/guild.css` | Guild-page-specific styles, plus the keyboard/motion baselines scoped to that page until #435 generalises them |
| `supabase/` | Supabase CLI project: local dev stack config and schema migrations. `config.toml` also carries the per-function `verify_jwt` flags the CLI reads at deploy (#958), so a deploy that names no function no longer resets them |
| `supabase/functions/` | Edge Functions (Deno). Webhook relays (`boe-webhook`, `boe-sold-webhook`, `discord-bot-webhook`, `contact-webhook`), scheduled jobs (`wcl-progression-sync`, `twitch-live-check`, `blizzard-gear-sync`, `optional-rsvp-reminders`), and two that act on a caller's behalf and check their role first: `wcl-sync`, which an officer triggers, and `upload-bio-photo`, the only writer to Storage -- see "Storage" below. Run them against the local stack with `supabase functions serve` and catch every post in `npm run dev:sink` rather than a real webhook: section 11 of [the local dev doc](docs/supabase-local-dev-setup.md). Tests live under `tests/edge/` and run with `deno task test`; `boe-sold-webhook` is split into `index.ts`, `handler.ts`, `format.ts` and `deps.ts` for them (see "Testing Edge Functions") |
| `bot/` | The Discord bot (#954): a discord.js gateway process running on kat's VM under pm2. Ten slash commands, an express endpoint the `discord-bot-webhook` relay posts to, and a 15-minute sweep for the signup sheet. Keeps its own `package.json`, `tsconfig.json` and lockfile, and its own workflow (`.github/workflows/bot.yml`), which runs the format check, its tests and the build on Node 20 to match the VM. It formats with the root prettier config rather than one of its own, and is outside every root script: lint, typecheck, format and the test suites all read `js/`, `scripts/` and `tests/` only |
| `scripts/import/` | One-off/recurring data import tooling (loot, attendance, etc.) |
| `scripts/ci/` | CI checks that need more than a workflow step (changelog classification, the team-wide read guard, the RLS autocommit guard, the security advisor allowlist), plus the version stamper (`npm run stamp`), which owns the page registry the asset-version check reads |
| `dbdoc/` | Generated schema docs (tbls). Never edit by hand; regenerate with `npm run db:docs` |
| `docs/RLS.md` | Hand-maintained RLS policy reference (tbls cannot generate this) |

## Reading team-wide data

PostgREST caps any response at 1000 rows and returns the truncated page as an
ordinary `200` with `error: null`. Nothing in supabase-js surfaces the
partial-content signal, so a short read is indistinguishable from a complete
one at the call site: the app renders confidently wrong data rather than an
error. This has produced real defects more than once, including attendance
scores computed from part of a season and written to the database as fact.

**Any read filtered by `team_id` goes through `fetchAllPaged()`** (`js/common.js`).
It pages on `id`, takes an exact count on the first page, gives each page its
own timeout rather than sharing one budget across the read, and returns `null`
rather than partial rows if anything fails. Callers must treat `null` as "the
read failed" and `[]` as "there is nothing there", and must never render the
two the same way.

```js
fetchAllPaged(
  function (afterId, limit) {
    var q = supabaseClient
      .from('attendance')
      .select('id, player_id, status', afterId === null ? { count: 'exact' } : undefined)
      .eq('team_id', _teamCfg.supabaseTeamId)
      .order('id', { ascending: true })
      .limit(limit);
    return afterId === null ? q : q.gt('id', afterId);
  },
  { label: 'attendance grid' }
);
```

`scripts/ci/team-wide-read-check.js` enforces this on every PR touching `js/`.
It parses each file rather than grepping it, so the same call shape inside a
comment or a string does not trip it. A read is exempt when it cannot reach the
cap and the code says so: `.single()`/`.maybeSingle()`, a `head: true` count, a
narrowing `.eq('player_id', ...)`, or a literal `.limit(50)`.

Anything else that genuinely cannot grow past 1000 rows declares why, on or
just above the read:

```js
// team-read-guard: one row per roster member, 80 on the largest team.
```

Write the actual bound, not "this is fine". The annotation is also the escape
hatch for a `makeQuery` callback declared as a named function somewhere else,
which the check cannot follow. Run it locally with
`node scripts/ci/team-wide-read-check.js`.

## Database functions

The rules below are what `tests/rls/function-invariants.test.js` enforces, added
for #1010 after the spike in #1009 found the conventions held by review alone.

- **Static SQL only.** No function body builds a statement at runtime: no
  `execute`, no `format(`, no `quote_ident`/`quote_literal`/`quote_nullable`.
  This is the whole defence against SQL injection in this project, since
  everything above the database reaches it through PostgREST, which binds
  filter values and RPC arguments rather than pasting them into SQL. The one
  exception is `rls_auto_enable`, whose `format()` argument is the object
  identity Postgres supplies on DDL. Adding a name to `KNOWN_DYNAMIC` needs the
  same reasoning written into the migration that introduces it.
- **Every function pins its search path**, `set search_path = public`. Trigger
  and other SECURITY INVOKER functions included, not just definers: three of
  them resolve relations unqualified, so the pin is what stops the resolution
  depending on the caller.
- **SECURITY DEFINER functions take identity from `auth.uid()`**, never from a
  parameter, and revoke `public` and `anon` explicitly. Both revokes matter and
  for different reasons. Postgres grants EXECUTE to PUBLIC by default, which is
  live on production, so a migration that forgets `revoke ... from public`
  leaves the function callable by anyone. The local Postgres image additionally
  grants the three API roles, which `supabase/roles.sql` undoes so a developer's
  stack matches production rather than being quietly more permissive.
- **No table or column names as parameters.** The five `danger_clear_*`
  functions exist as five functions rather than one taking a table name for
  exactly this reason; see the 2026-07-11 entry in `docs/database-decisions.md`.
- **Clients never build filter strings**, and the offline SQL generators under
  `scripts/` route every value through `scripts/import/lib/sql.js`.

A new definer function that is meant to be anon-callable is added to
`ANON_DEFINER_ALLOWLIST` in that test file, in the same PR as its migration. The
test asserts set equality, so an accidental grant and an accidental revoke both
fail. `npm run test:rls` runs it.

### Security advisors

Supabase's own security linter runs on every migration PR (#1011), in the schema
docs workflow, against the stack that job has just built from the migration
files. `scripts/ci/advisor-check.js` reads the report and fails anything at WARN
or above that is not in its allowlist, printing the lint, the object and the
remediation URL. Run it locally the way CI does:

```bash
supabase db advisors --local --type security --level warn --fail-on none --output-format json > advisors.json
node scripts/ci/advisor-check.js advisors.json
```

Each allowlist entry carries its reason in the file, and the issue that retires
it where one exists. An entry keyed on a `cacheKey` accepts one object and
**fails the run once it matches nothing**, so a finding that gets fixed takes its
entry out with it, and a report that came back empty cannot pass as a clean
schema. An entry keyed on a lint `name` accepts that whole lint and passes when
it matches nothing.

The local run and `--linked` do not read the same linter, which decides what a
green run means. `--local` and `--db-url` run the CLI's embedded SQL query, 23
lints, inside a transaction it rolls back. `--linked` reads the Management API,
and the definer-function-executable findings and the leaked-password toggle come
only from there, so no CI run can produce them. `.github/workflows/security-advisors.yml`
sweeps production weekly through `--db-url` and inherits the same limit.

## Storage

`bio-photos` (added for #625) is the first Supabase Storage bucket in this
project, and the convention it set is meant to hold for the next one too:

- **No client ever writes to a bucket directly.** An Edge Function does the
  auth check and the write, using the service-role key. Storage RLS on
  `storage.objects` is left with no per-client rule at all -- the default
  deny already blocks a direct client write, so there is nothing to grant.
  A bucket created `public = true` still serves reads through its public URL
  without needing a read rule.
- **Path convention**: `{auth_user_id}/{filename}`, so a bucket that scopes
  content per-uploader gets that enforced for free -- an Edge Function using
  the caller's own `auth.uid()` to build the path can never be asked to
  write under someone else's.
- File-size/mime-type limits set on the bucket row itself
  (`file_size_limit`, `allowed_mime_types`) are defense-in-depth only; the
  real enforcement (resize, compression, a hard cap on the stored size)
  belongs in the Edge Function, not the client.
- See `supabase/functions/upload-bio-photo/index.ts` for the reference
  shape: authenticate by forwarding the caller's JWT to a second client and
  calling `auth.getUser()`, authorize with the same RPCs an equivalent save
  path already uses, then do the actual bucket read/write with a
  service-role client kept separate from the caller-scoped one.

## Local development database (Supabase)

The Supabase migration develops all schema changes against a local stack running in
Docker before anything touches the cloud project. Setup from scratch (Docker,
Supabase CLI, starting the stack, linking to the cloud project) is documented
step by step in [docs/supabase-local-dev-setup.md](docs/supabase-local-dev-setup.md).

PRs that change `supabase/migrations/` must also:

- See it running under the site before the merge, since the merge is what
  applies it: [section 10 of the local dev doc](docs/supabase-local-dev-setup.md)
  is four commands from a new migration file to `localhost:3000` signed in as a
  seeded persona, then the bullets below in the order a PR needs them.
- Rehearse it against real data when the shape of the data matters:
  `npm run db:snapshot` loads the nightly production dump under the schema it
  was taken from and runs this branch's migrations on top (section 12 of the
  local dev doc). It needs a read-only bucket token, and it puts production
  data on your machine.
- Create the file with `npm run migration:new -- <slug>`, which stamps it with
  the **real current Eastern wall clock** (`YYYYMMDDHHMMSS`). Supabase orders
  and applies migrations by that prefix, so it is a sort key shared between
  everyone's machines and has to come from one clock. Do **not** use
  `supabase migration new`: it stamps UTC, four hours ahead of Eastern in
  summer and five in winter, and has twice sorted a later migration ahead of
  an earlier one (2026-08-26 and 2026-09-03, both push refusals). Do not type
  the number by hand either. The vendored Supabase skill at
  `.agents/skills/supabase/SKILL.md` says to use the CLI command; it is pinned
  upstream and cannot be edited here, so this rule overrides it and CI enforces
  the override.
- A migration reaches production when its pull request merges: the Deploy
  workflow pushes it and only then deploys the site (#1050). Running
  `supabase db push` by hand is a repair route now, not the delivery route.
- The new file must still sort **after** every migration already applied on
  prod, because the push refuses the whole run when one does not, and at merge
  that refusal blocks the deploy. If someone else's file landed first and yours
  now sorts below it, re-stamp yours with
  `npm run migration:new -- --rename supabase/migrations/<file>`. The pull
  request ledger check fails that case before it can reach a merge. Never reach
  for `--include-all` to get around it.
- Open the file with a header: `-- #NNN: <what it does>.`, then a bare `--`,
  then why it is needed. Cite a prior migration by filename when this one
  patches it.
- Name the slug after the object changed, `<table>_<column>` or
  `<function>_<what changed>`, lowercase with underscores. No dates in the
  slug; the prefix already carries one.
- Regenerate the schema docs: `supabase db reset`, then `npm run db:docs`, and
  commit the `dbdoc/` changes (CI fails stale docs)
- Update [docs/RLS.md](docs/RLS.md) if the migration adds, alters, or drops an
  RLS policy (CI checks this too)
- Regenerate the policy export if policies changed: `npm run db:rls`, and
  commit `docs/rls_policies.csv` (CI fails a stale CSV)
- Pass the RLS policy tests: `supabase db reset` (applies migrations and the
  test seed), then `npm run test:rls`. CI runs the same suite on every
  supabase/ or tests/ change. If a policy legitimately changed, update the
  matching assertions in `tests/rls/` and the matrix in docs/RLS.md together

### Writing RLS tests

Every file in `tests/rls/` runs as its own worker against one database, so a
fixture that commits is visible to every other file until something deletes it.
That is not a small window to accept: two files writing the same row made a
third fail on a different case each run, and because the cleanup closed the
window, the table was clean by the time anyone queried it and the failure read
as a bug in the file that failed (#1021).

**Fixtures go inside `withTxn` from `tests/rls/helpers.js`**, which opens one
connection, runs everything in one transaction and always rolls back. It hands
the test a postgres-role `q` for fixtures and assertions, and `asRole`,
`asUser` and `asAnon` for calls made as a PostgREST role on that same
connection. Same connection is the point: a role-scoped read can then see the
rows the test just wrote without any of them being committed.

```js
await withTxn(async ({ q, asRole }) => {
  await q("insert into public.raid_schedule (team_id, weekday, start_time) values (1, 4, '20:00')");
  const res = await asRole('authenticated', RAIDER_T1)('select count(*)::int as n from public.raid_schedule');
  expect(res.rows[0].n).toBe(0);
});
```

`countAs` and `queryAs` open a connection of their own, so they cannot see an
uncommitted fixture. Use them against seeded data, never against a row the test
wrote. Reaching for `pool.query` to work around that is what created the
problem above.

`scripts/ci/rls-no-autocommit-check.js` enforces this and runs in the Lint
workflow. It parses each file rather than grepping it. A call that writes
nothing declares so on or just above itself, which is how the pg_proc catalog
read in `function-invariants.test.js` passes:

```js
// rls-pool-read-only: reads the pg_proc catalog, writes nothing.
```

Run it locally with `node scripts/ci/rls-no-autocommit-check.js`. It cannot see
a hand-rolled `pool.connect()` that commits instead of rolling back, so a new
harness of your own is on you rather than on the check.
