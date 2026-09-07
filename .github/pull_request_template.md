## Summary

<!-- What does this PR do? One or two sentences. -->

Closes #

## Changes

- 

## Checklist

- [ ] `npm run stamp -- <x.y.z>` run, if this PR changes a shipped piece
      (frontend, `supabase/migrations/`, `supabase/functions/`, `bot/`).
      Mechanical PRs use a `chore/*` branch or the `chore` label instead
- [ ] CHANGELOG.md entry under this PR's version block, in the section for
      each piece it touches: `### Frontend`, `### Backend`, `### Functions`,
      `### Bot`
- [ ] `news.json` entry if raiders would want to hear about this
- [ ] Tested in browser (raider view and officer dashboard if affected)
- [ ] Any new migration was created with `npm run migration:new -- <slug>` and
      still sorts after everything applied on prod (CI checks both)
