// boe-sold-webhook (#873): posts to Discord when a BoE sells. The function
// is three modules so that tests/edge/ can run it without a server (#1006):
// handler.ts holds the gate, the reads and the response codes; format.ts
// holds the text of the post; deps.ts is the supabase-js and Deno side of
// what handler.ts is handed. This file only serves it.
import { handle } from './handler.ts';
import { productionDeps } from './deps.ts';

Deno.serve((req) => handle(req, productionDeps()));
