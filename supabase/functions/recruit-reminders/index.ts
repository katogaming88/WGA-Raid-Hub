// recruit-reminders (#1543): the 15-minute recruiting reminder sweep.
// handler.ts holds the rules and the Discord side; deps.ts is the supabase-js
// side. This file only serves it.
import { handle } from './handler.ts';
import { productionDeps } from './deps.ts';

Deno.serve((req) => handle(req, productionDeps()));
