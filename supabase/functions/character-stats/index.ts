// character-stats (#1538): an applicant's item level, M+ score and logs for
// one of their own characters. handler.ts holds the gate, the reads and the
// response; deps.ts is the supabase-js side. This file only serves it.
import { handle } from './handler.ts';
import { productionDeps } from './deps.ts';

Deno.serve((req) => handle(req, productionDeps()));
