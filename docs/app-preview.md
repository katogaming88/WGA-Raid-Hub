# The new app's preview

The rebuilt WGA Raid Hub (`app/`, #1109) runs at a private preview address until the January cutover (#1105):

**https://wga-raid-hub-app.pages.dev**

It is not linked from anywhere, and only people on an allow list can open it.

## Who can open it, and what a tester needs

Cloudflare Access sits in front of the preview. A tester does **not** need a Cloudflare account. They need:

1. **An email address on the allow list** (see below).
2. **Battle.net or Discord**, to sign in to the app itself once they are past Cloudflare, the same logins as the live site.

What a tester sees:

1. They open the preview and Cloudflare asks for their email.
2. Cloudflare emails them a 6-digit code. It only sends one to an address on the list; anyone else never gets a code.
3. After the code, they are in for **one week** before Cloudflare asks again.
4. Inside the app, they sign in with Battle.net (or Discord) at the bottom of the sidebar.

> **The preview uses the live database.** It reads and writes the same data as wgaraidhub.com. Today the app mostly reads, but once officer tools arrive (Revamp 3) an action on the preview is a real action. Tell testers that.

## Adding or removing a tester

In the Cloudflare dashboard, open **Cloudflare One** (Zero Trust):

1. **Access controls → Policies → Kat and Testers**.
2. Under **Include → Emails**, add or remove the address. Save.

Removing someone from the list stops new sign-ins right away. A session they already have lasts until its week is up; to end it sooner, revoke it under **Team & Resources → Users**.

**Seats:** the Zero Trust Free plan allows 50 seats. Everyone who signs in through Access counts as one, Kat included. Remove testers who are done, and free their seat under **Team & Resources → Users** if the count gets close.

## How it is set up

| Piece | Where | What it is |
| --- | --- | --- |
| The deploy | `.github/workflows/deploy.yml`, job `cloudflare-app` | Every merge to `main` builds `app/` and uploads it to the Cloudflare Pages project `wga-raid-hub-app`, after the migrations and functions, the same way the current site deploys. Uses the existing `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets. |
| The lock | Cloudflare One → Access controls → Applications → **WGA Raid Hub preview** | A self-hosted application covering two addresses: `wga-raid-hub-app.pages.dev` and `*.wga-raid-hub-app.pages.dev`. The wildcard matters: every deploy also gets its own address (`<hash>.wga-raid-hub-app.pages.dev`), and without it those would be open. Login method: One-time PIN. Plan: Zero Trust Free. |
| Sign-in return | Supabase dashboard → Authentication → URL Configuration → Redirect URLs | `https://wga-raid-hub-app.pages.dev/**`, so Battle.net and Discord sign-in come back to the preview. |
| Battle.net sign-in | Supabase (hosted), custom provider `custom:battlenet` | Added through the auth admin API, type `oauth2` (not `oidc`: Blizzard's signing key format breaks Supabase's OIDC check). Manual identity linking is switched on. See the 2026-09-14 entry in `docs/database-decisions.md`. |
| Tests | `tests/browser-app/`, run by the App workflow on every PR and every merge to `main` | Accessibility, reflow, focus and reduced motion on the built app. `npm run test:app-browser` after `cd app && npm run build`. |

No Battle.net or Discord app setting is tied to the preview: both send people back to Supabase, and Supabase sends them on to the preview.

## When something goes wrong

**Sign-in with Battle.net lands on the old GitHub Pages site instead of the preview.**
The preview address is missing from Supabase's Redirect URLs, so Supabase fell back to its Site URL. Add `https://wga-raid-hub-app.pages.dev/**` (see the table). If the person got past the Battle.net login first, check for a stray account (next item).

**A stray, empty account.**
Pressing Battle.net before that login is attached to someone's real account makes a new, empty account. In the app, the "Already use WGA Raid Hub with Discord?" button removes it and connects Battle.net to their real account. To clear one by hand: Supabase dashboard → Authentication → Users, sort by newest, and delete a user whose only provider is Battle.net and that has no email. Nothing else points at such an account, so deleting it loses nothing.

**"That Battle.net account is already connected to a different login."**
That Battle.net login is attached to another account on the site, often a second account the same person made. Find both under Authentication → Users and delete the one that has nothing on it (Battle.net only, no email), then connect again.

**The preview opens without asking for an email.**
Access is not covering that address. Check the application's destinations include both the plain address and the `*.` wildcard.

**The preview still shows old code.**
The `Deploy the new app preview` job in the latest Deploy run shows whether the upload happened. A merge only reaches the preview after its migrations and functions deploy.
