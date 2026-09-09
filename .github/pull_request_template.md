## Summary

<!-- What does this PR do? One or two sentences. -->

Closes #

## Changes

- 

## Checklist

- [ ] `npm run stamp -- <x.y.z>` run. Every PR stamps the product; a PR that
      changes none of the four shipped pieces (frontend,
      `supabase/migrations/`, `supabase/functions/`, `bot/`) takes a patch
- [ ] CHANGELOG.md entry under this PR's version block, in the section for
      each piece it touches: `### Frontend`, `### Backend`, `### Functions`,
      `### Bot`, or `### Project` when it touches none of them
- [ ] `news.json` entry if raiders would want to hear about this
- [ ] Tested in browser (raider view and officer dashboard if affected)
- [ ] Any new migration was created with `npm run migration:new -- <slug>` and
      still sorts after everything applied on prod (CI checks both)
