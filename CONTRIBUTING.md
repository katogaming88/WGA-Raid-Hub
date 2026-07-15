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

This project follows [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`):

| Bump | When to use | Examples |
|------|-------------|---------|
| **MAJOR** | Architectural overhaul, breaking change to URLs or database schema | Page split, new auth system |
| **MINOR** | New officer capability, new tab, new raider-facing workflow | New dashboard tab, new approval queue |
| **PATCH** | Bug fixes, visual polish, copy changes, layout tweaks, performance improvements | Layout fix, subtitle change, footer tweak |

When merging a PR:
- Frontend changes (under `js/` or the root HTML pages): bump the
  version in `js/common.js` (`var VERSION`) and add an entry under a
  `### Frontend` heading in the new version's `CHANGELOG.md` block
- Backend changes (under `supabase/migrations/` or `scripts/import/`): add
  an entry under a `### Backend` heading, with no version bump. Backend
  entries join the version block of the release they land next to
- A PR touching both sides updates both sections; a PR touching neither
  needs neither

CI enforces this in both directions (#353): frontend paths require a
Frontend entry and a bump, backend paths require a Backend entry, and a
bump without a frontend change fails. The `js/common.js` VERSION line
itself does not count as a frontend change, so a bump alone never
satisfies the frontend checks. Mechanical PRs (formatting, lint,
comment-only changes) are exempt from every check: use a `chore/*` branch
or add the `chore` label.

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
  `npm run test:frontend`; CI runs the suite on every `js/` change

## Project structure

| Path | Purpose |
|------|---------|
| `index.html` | Public page -- landing, raider profiles, season signup |
| `officer.html` | Officer dashboard -- all management tabs |
| `admin.html` | Site admin dashboard -- team management, site admin grant/revoke, feature flags, cross-team audit log, maintenance mode |
| `js/common.js` | Shared globals, `TEAMS`, `TEAM_SLUG`/`IS_COLD_LANDING` resolution, `VERSION`, data helpers, `renderProfile` |
| `js/discord.js` | Discord OAuth login/session mapping, character claim flow |
| `js/roster.js` | Public page boot, cold-landing team picker/auto-redirect, dropdown, stats row, recent loot |
| `js/signup.js` | Multi-step signup form logic |
| `js/officer.js` | Officer boot, session expiry, tab dispatch |
| `js/officer-quick-actions.js` | Officer quick-actions bar (priority export, attendance refresh, loot paste) shown on the public page |
| `js/streamers.js` | Live Twitch streamer widget |
| `js/tabs/tab-*.js` | One file per officer tab (17 files) |
| `js/admin.js` | Standalone boot/logic for `admin.html` -- not team-scoped, so it doesn't reuse common.js/discord.js |
| `css/styles.css` | Shared styles across all pages |
| `css/officer.css` | Officer-specific styles (partial split out of `styles.css`, still in progress) |
| `css/admin.css` | Admin-page-specific styles |
| `gs/*.gs` | Retired Google Apps Script source, kept only as historical record -- no code reads `gasUrl` or writes through GAS anymore; everything is Supabase-only |
| `supabase/` | Supabase CLI project: local dev stack config and schema migrations |
| `scripts/import/` | One-off/recurring data import tooling (loot, attendance, etc.) |
| `dbdoc/` | Generated schema docs (tbls). Never edit by hand; regenerate with `npm run db:docs` |
| `docs/RLS.md` | Hand-maintained RLS policy reference (tbls cannot generate this) |

## Local development database (Supabase)

The Supabase migration develops all schema changes against a local stack running in
Docker before anything touches the cloud project. Setup from scratch (Docker,
Supabase CLI, starting the stack, linking to the cloud project) is documented
step by step in [docs/supabase-local-dev-setup.md](docs/supabase-local-dev-setup.md).

PRs that change `supabase/migrations/` must also:

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
