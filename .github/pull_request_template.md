<!--
Write this for someone who doesn't know the code. Plain words first; use a
technical term only when needed, and explain it with a short analogy.
See "Writing issues and pull requests" in CONTRIBUTING.md.
Delete any section that doesn't apply.
-->

Closes #

## What's changing

<!-- In a few plain sentences: what does someone using the site notice, or
what problem goes away? -->

## Why

<!-- The reason for the change. Link the issue or decision it comes from. -->

## Screenshots

<!-- Required if this changes how something looks or adds something new.
One per changed view; add phone width and light mode if they change. -->

## Database changes (applies on merge)

<!-- Each migration: what it changes, in plain words, and whether any
existing data is rewritten or removed. -->

## Not in this PR

<!-- What was left out on purpose, and where it goes next. -->

## Unrelated fixes (Kat approved)

<!-- Only if Kat asked for an unrelated fix to ride along. Otherwise delete. -->

## How it was tested

<!-- What you checked by hand, and which test suites ran. -->

## Review

- [ ] Design review by Kat (anything that changes how something looks)
- [ ] Database / devops review by Rex (big migrations, policies, deploys, CI)

## Checklist

- [ ] `npm run stamp -- <x.y.z>` run. Every PR stamps the product; a PR that
      changes none of the four shipped pieces (frontend,
      `supabase/migrations/`, `supabase/functions/`, `bot/`) takes a patch
- [ ] CHANGELOG.md entry under this PR's version block, in the section for
      each piece it touches: `### Frontend`, `### Backend`, `### Functions`,
      `### Bot`, or `### Project` when it touches none of them
- [ ] `news.json` entry if raiders would want to hear about this
- [ ] Any new migration was created with `npm run migration:new -- <slug>` and
      still sorts after everything applied on prod (CI checks both)
