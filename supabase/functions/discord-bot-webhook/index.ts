// discord-bot-webhook (#224, #959): posts the site's Discord notices as the
// bot. handler.ts holds the gate and the post; posts.ts what each notice says;
// deps.ts is the supabase-js and Deno side of what handler.ts is handed. This
// file only serves it.
import { handle } from './handler.ts';
import { productionDeps } from './deps.ts';

Deno.serve((req) => handle(req, productionDeps()));
