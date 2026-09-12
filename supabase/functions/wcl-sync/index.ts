// wcl-sync (#223): WarcraftLogs reads and writes for the officer tabs. The
// function lives in handler.ts (the gate and the five actions) and deps.ts
// (the caller's Supabase client) so that tests/edge/ can run the gate
// without a server (#1013). This file only serves it.
import { handle } from './handler.ts';
import { productionDeps } from './deps.ts';

Deno.serve((req) => handle(req, productionDeps()));
