// discord-settings (#994): what Settings › Discord reads from Discord through
// the bot. handler.ts holds the gate and the Discord calls; discord.ts works
// out channels and roles; deps.ts is the supabase-js side. This file only
// serves it.
import { handle } from './handler.ts';
import { productionDeps } from './deps.ts';

Deno.serve((req) => handle(req, productionDeps()));
