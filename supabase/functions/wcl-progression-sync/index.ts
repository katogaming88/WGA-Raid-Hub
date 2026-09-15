// wcl-progression-sync (#285): keeps team_raid_progress current from
// WarcraftLogs on a pg_cron schedule. The function lives in handler.ts (the
// cron gate, the season read, the sync) and deps.ts (the service-role
// client, fetch and Deno.env) so that tests/edge/ can run it without a
// server (#932). This file only serves it.
import { handle } from './handler.ts';
import { productionDeps } from './deps.ts';

Deno.serve((req) => handle(req, productionDeps()));
