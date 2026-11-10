// discord-join (#1540): adds an applicant to their team's Discord server when
// they send an application. handler.ts holds the gate, the OAuth step and the
// add; deps.ts is the supabase-js side. This file only serves it.
import { handle } from './handler.ts';
import { productionDeps } from './deps.ts';

Deno.serve((req) => handle(req, productionDeps()));
