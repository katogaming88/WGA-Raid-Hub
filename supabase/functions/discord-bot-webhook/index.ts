// discord-bot-webhook (#224): relays the site's Discord notices to the bot.
// handler.ts holds the gate and the relay; deps.ts is the supabase-js and
// Deno side of what handler.ts is handed. This file only serves it.
import { handle } from './handler.ts';
import { productionDeps } from './deps.ts';

Deno.serve((req) => handle(req, productionDeps()));
