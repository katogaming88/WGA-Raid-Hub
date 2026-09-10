// Serve the site for a person, against the local Supabase stack (#1052).
//
// `npm run serve`, then open http://localhost:3000. Pages served from
// localhost or 127.0.0.1 resolve the local stack rather than production
// (js/common.js and js/admin.js), so this is how a PR's migration and the page
// that goes with it get looked at together before the merge applies the
// migration for real.
//
// It reuses tests/browser/static-server.js rather than adding a second server:
// that one already resolves paths safely inside the repo root, answers the
// query strings every page carries, and sends no-store, and a second
// implementation would drift from the one the accessibility suite proves.
//
// localhost rather than 127.0.0.1 in the printed URL on purpose. Twitch's embed
// takes the hostname as its `parent` (js/streamers.js), and it accepts
// localhost; the numeric form it may refuse, which would show as an empty
// Streams tab rather than an error.
//
// Node built-ins only, like everything in scripts/.
//
// The npm script passes --disable-warning=MODULE_TYPELESS_PACKAGE_JSON. This
// package has no "type" field, so importing an ESM file from outside
// scripts/ci makes node print a three-line reparsing notice before anything
// this prints. Setting "type": "module" would silence it for the whole repo
// and change how every other .js file here is loaded, which is not worth it to
// tidy one banner.
import { startServer } from '../../tests/browser/static-server.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// 3000 is not arbitrary: it is the port supabase/config.toml's site_url names,
// which is where a sign-in link comes back to.
const PORT = Number(process.env.PORT || 3000);

function main() {
  return startServer(ROOT, { port: PORT }).then(function (server) {
    console.log(`WGA Raid Hub is served from ${ROOT}`);
    console.log('');
    console.log(`  http://localhost:${server.port}/?team=phoenix`);
    console.log(`  http://localhost:${server.port}/guild.html`);
    console.log(`  http://localhost:${server.port}/officer.html`);
    console.log('');
    console.log('Pages on localhost talk to the local Supabase stack. Start it with `supabase start`.');
    console.log('Ctrl+C to stop.');

    // Without this the process can exit as soon as the module finishes, since a
    // listening server is not always enough on its own to hold it open.
    process.stdin.resume();

    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.on(signal, () => {
        server.close().then(
          () => process.exit(0),
          () => process.exit(1)
        );
      });
    }
  });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
