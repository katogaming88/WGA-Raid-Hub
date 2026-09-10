// A stand-in for Discord, so the posters can be rehearsed locally (#1055).
//
//   npm run dev:sink
//   npm run dev:sink -- --status 500
//
// It answers every request the way an incoming webhook does and prints what it
// was sent. Point every *_WEBHOOK_URL in supabase/functions/.env at it and a
// rehearsal exercises the real post path with nothing reaching a channel a
// team operates in. From inside the functions runtime the host is
// `http://host.docker.internal:8899/<anything>`, because the container cannot
// see the machine's own localhost.
//
// 204 with no body is what Discord answers, and matching it matters: a poster
// that treats any 2xx as success would pass against a sink returning 200 and
// fail against the real thing. `--status 500` is the other half, for the
// refusal paths, which otherwise only run when something is already broken.
//
// This began as a throwaway during the 2026-09-07 boe-webhook proof. It is
// tracked now so the next person does not write it again.
//
// Node built-ins only, like everything in scripts/.
import { createServer } from 'node:http';

// The port the runbook and supabase/functions/.env.example both name.
const DEFAULT_PORT = 8899;

/** Reads the body, parsed when it is JSON and raw when it is not. */
function readBody(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
    });
    request.on('error', reject);
    request.on('end', () => {
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        // Not an error worth failing on: a poster with the wrong
        // Content-Type should read as a post here, not as the sink falling
        // over in the middle of a rehearsal.
        resolve(raw);
      }
    });
  });
}

/**
 * Starts the sink. `log` is injected so the tests stay quiet; the CLI passes
 * console.log. `received` is the array the tests read and the caller can too.
 */
export function startSink({ port = DEFAULT_PORT, status = 204, log = () => {} } = {}) {
  const received = [];

  const server = createServer((request, response) => {
    readBody(request).then(
      (body) => {
        received.push({ method: request.method, path: request.url, body });
        log(`${request.method} ${request.url}`);
        log(typeof body === 'string' ? body : JSON.stringify(body, null, 2));
        log('');
        if (status === 204) {
          response.writeHead(204);
          response.end();
          return;
        }
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ message: `discord-sink is answering ${status} on purpose` }));
      },
      (err) => {
        response.writeHead(400);
        response.end(err.message);
      }
    );
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        received,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

function parseArgs(argv) {
  const at = argv.indexOf('--status');
  const portAt = argv.indexOf('--port');
  return {
    status: at === -1 ? 204 : Number(argv[at + 1]),
    port: portAt === -1 ? DEFAULT_PORT : Number(argv[portAt + 1])
  };
}

function main() {
  const { status, port } = parseArgs(process.argv.slice(2));
  return startSink({ port, status, log: console.log }).then(function (sink) {
    console.log(`Catching webhook posts on http://127.0.0.1:${sink.port}, answering ${status}.`);
    console.log('From inside the functions runtime that is http://host.docker.internal:' + sink.port);
    console.log('Ctrl+C to stop.');
    console.log('');

    process.stdin.resume();

    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.on(signal, () => {
        sink.close().then(
          () => process.exit(0),
          () => process.exit(1)
        );
      });
    }
  });
}

// Only when run, not when imported by the tests.
if (process.argv[1] && process.argv[1].endsWith('discord-sink.js')) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
