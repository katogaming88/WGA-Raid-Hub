# Contributing to Phoenix-Roster

## Workflow

1. Pick an issue from the [issue tracker](https://github.com/katogaming88/Phoenix-Roster/issues) or create one first
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
| **MAJOR** | Architectural overhaul, breaking change to URLs, GAS API shape, or sheet structure | Page split, new auth system |
| **MINOR** | New officer capability, new tab, new GAS action, new raider-facing workflow | New dashboard tab, new approval queue |
| **PATCH** | Bug fixes, visual polish, copy changes, layout tweaks, performance improvements | Layout fix, subtitle change, footer tweak |

When merging a PR:
- Bump the version in `js/common.js` (`var VERSION`)
- Add an entry to `CHANGELOG.md` under the new version number

CI enforces both on functional PRs (changes under `js/`, `gs/`, or the HTML
pages). Mechanical PRs (formatting, lint, comment-only changes) are exempt
from the version-bump check: use a `chore/*` branch or add the `chore` label.
The changelog check has no exemption.

## Pull requests

- Keep PRs focused on one issue or theme
- Update `CHANGELOG.md` with a brief description of what changed
- If your change affects `PhoenixRosterWebApp.gs`, note whether a new deployment is needed
- `js/common.js` is type-checked (`// @ts-check` plus JSDoc annotations, no
  build step). If you touch a checked file, run `npm run typecheck`; CI runs
  the same check on every `js/` change. Add `// @ts-check` to more `js/`
  files as they get touched

## Project structure

| Path | Purpose |
|------|---------|
| `index.html` | Public page -- landing, raider profiles, season signup |
| `officer.html` | Officer dashboard -- all management tabs |
| `js/common.js` | Shared globals, `WEB_APP_URL`, `VERSION`, data helpers, `renderProfile` |
| `js/roster.js` | Public page boot, dropdown, stats row, recent loot |
| `js/signup.js` | Multi-step signup form logic |
| `js/officer.js` | Officer boot, password gate, session expiry, tab dispatch |
| `js/tabs/tab-*.js` | One file per officer tab (8 files) |
| `css/styles.css` | All styles |
| `css/officer.css` | Stub for officer-specific styles (future split) |
| `PhoenixRosterWebApp.gs` | Google Apps Script (data layer) |
| `supabase/` | Supabase CLI project: local dev stack config and schema migrations |
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

## Google Apps Script changes

If you change `PhoenixRosterWebApp.gs`:
1. Paste the updated script into the Apps Script editor
2. Deploy as a new version (Deploy -> Manage Deployments -> edit -> New version)
3. The URL stays the same -- no changes to `js/common.js` needed
