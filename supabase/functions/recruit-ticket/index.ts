// recruit-ticket (#1541): what the bot makes in Discord when someone applies.
// handler.ts holds the gate, the ticket, thread or post, the card and the DM;
// deps.ts is the supabase-js side. This file only serves it.
import { handle } from './handler.ts';
import { productionDeps } from './deps.ts';

Deno.serve((req) => handle(req, productionDeps()));
