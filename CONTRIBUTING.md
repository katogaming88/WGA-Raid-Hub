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

### Every PR that changes a shipped piece stamps the product

There are four shipped pieces, and one version line covers all of them. A
release is named by that number, and a change to any piece moves it:

| Piece | Paths | CHANGELOG section |
|-------|-------|-------------------|
| Frontend | `js/`, `css/`, the root HTML pages | `### Frontend` |
| Database | `supabase/migrations/`, `scripts/import/` | `### Backend` |
| Edge Functions | `supabase/functions/` | `### Functions` |
| Bot | `bot/` | `### Bot` |

A PR touching more than one piece writes a section for each and takes one bump.
A PR touching none of them (docs, CI config, `supabase/config.toml`, `seed.sql`,
`roles.sql`) takes neither: it gets the `skip-changelog` label automatically.

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
| `build.json` | GitHub Pages, at deploy | The deployed commit and the build time. It carries Jekyll front matter, which is what makes Jekyll render the Liquid tags inside it, and front matter is exactly what would make `version.json` unparseable |

An absent entry in `pieces` means that piece has never been stamped, never that
it has drifted. A chore PR moves no piece, so it leaves the manifest alone. The version says which release something belongs to; the
platform identity says which artifact is actually live. Both are needed, because
only the second one can show that a piece was merged and never deployed.

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

CI enforces this (#353, extended by #966): a path in any shipped piece requires
that piece's CHANGELOG section and the bump, a bump with no shipped change
fails, and a new heading must be unique and above every heading already in the
file. The `js/common.js` VERSION line itself does not count as a frontend
change, so a bump alone never satisfies the checks. Mechanical PRs (formatting,
lint, comment-only changes) that still touch a shipped path are exempt from
every check by adding the `skip-changelog` label -- deliberately, after
looking at the diff. A PR that touches no shipped path gets that label
automatically. `chore/*` as a branch name is still fine for the PR's own
classification, but it no longer exempts anything on its own: a branch name is
picked before the diff exists, and what it turns into is what decides whether
a changelog entry is owed.

## Pull requests

- Keep PRs focused on one issue or theme
- Update `CHANGELOG.md` under `### Frontend` / `### Backend` per the
  versioning section above
- `js/common.js` is type-checked (`// @ts-check` plus JSDoc annotations, no
  build step). If you touch a checked file, run `npm run typecheck`; CI runs
  the same check on every `js/` change. Add `// @ts-check` to more `js/`
  files as they get touched
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
  `?v=` asset tags, and the changelog classifier. These read the pages as
  text, so they judge markup and never behaviour
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
| `supabase/` | Supabase CLI project: local dev stack config and schema migrations |
| `supabase/functions/` | Edge Functions (Deno). Webhook relays (`boe-webhook`, `boe-sold-webhook`, `discord-bot-webhook`, `contact-webhook`), scheduled sync jobs (`wcl-sync`, `wcl-progression-sync`, `twitch-live-check`), and `upload-bio-photo`, which authenticates the caller and is the only writer to Storage -- see "Storage" below |
| `bot/` | The Discord bot (#954): a discord.js gateway process running on kat's VM under pm2. Twelve slash commands, an express endpoint the `discord-bot-webhook` relay posts to, and a 15-minute sweep for the signup sheet. Keeps its own `package.json`, `tsconfig.json` and prettier config, and its own workflow (`.github/workflows/bot.yml`); it is not covered by the root lint, typecheck or format scripts |
| `scripts/import/` | One-off/recurring data import tooling (loot, attendance, etc.) |
| `scripts/ci/` | CI checks that need more than a workflow step (changelog classification, the team-wide read guard), plus the version stamper (`npm run stamp`), which owns the page registry the asset-version check reads |
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
- Before `supabase db push`, the new file must sort **after** every migration
  already applied on prod. If someone else's file landed first and yours now
  sorts below it, re-stamp yours with
  `npm run migration:new -- --rename supabase/migrations/<file>`. Never reach
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
