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

## Pull requests

- Keep PRs focused on one issue or theme
- Update `CHANGELOG.md` with a brief description of what changed
- If your change affects `PhoenixRosterWebApp.gs`, note whether a new deployment is needed

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

## Google Apps Script changes

If you change `PhoenixRosterWebApp.gs`:
1. Paste the updated script into the Apps Script editor
2. Deploy as a new version (Deploy -> Manage Deployments -> edit -> New version)
3. The URL stays the same -- no changes to `js/common.js` needed
