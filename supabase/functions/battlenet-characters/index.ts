// battlenet-characters (#942 step 5, #1162): a raider's characters from their
// Battle.net account. handler.ts holds the gate, the Blizzard reads and the
// response; characters.ts decides what is shown; deps.ts is the supabase-js
// side. This file only serves it.
import { handle } from './handler.ts';
import { productionDeps } from './deps.ts';

Deno.serve((req) => handle(req, productionDeps()));
