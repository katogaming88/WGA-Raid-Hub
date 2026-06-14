# Contributing to Phoenix-Roster

## Workflow

1. Pick an issue from the [issue tracker](https://github.com/katogaming88/Phoenix-Roster/issues) or create one first
2. Branch off `main`: `git checkout -b <type>/<short-description>`
   - Types: `feat`, `fix`, `chore`, `docs`
   - Example: `feat/filter-by-role`
3. Make your changes, then open a pull request against `main`
4. Reference the issue in your PR description (e.g. `Closes #12`)

## Branch naming

| Type | When to use |
|------|-------------|
| `feat/` | New feature or roadmap item |
| `fix/` | Bug fix |
| `chore/` | Config, tooling, project setup |
| `docs/` | Documentation only |

## Pull requests

- Keep PRs focused on one issue
- Update CHANGELOG.md under `[Unreleased]` with a brief line describing what changed
- If your change affects the Apps Script (`PhoenixRosterWebApp.gs`), note whether a new deployment is needed

## Project structure

| Path | Purpose |
|------|---------|
| `index.html` | Page shell and script/style links |
| `css/styles.css` | All styles |
| `js/app.js` | All client-side logic |
| `PhoenixRosterWebApp.gs` | Google Apps Script (data layer) |

## Google Apps Script changes

If you change `PhoenixRosterWebApp.gs`:
1. Paste the updated script into the Apps Script editor
2. Deploy as a new version (Deploy -> Manage Deployments -> edit -> New version)
3. The URL stays the same — no changes to `index.html` needed
