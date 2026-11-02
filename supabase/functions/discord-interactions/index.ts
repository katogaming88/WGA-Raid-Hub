// discord-interactions (#998): the bot's slash commands, sent by Discord as
// signed POSTs. Deployed with verify_jwt = false: Discord carries no
// Supabase login, and the Ed25519 signature check in handler.ts is the gate.
// handler.ts holds the check and the commands; nudge.ts what /nudge-missing
// says; deps.ts the supabase-js and Deno side. This file only serves it.
import { handle } from './handler.ts';
import { productionDeps } from './deps.ts';

Deno.serve((req) => handle(req, productionDeps()));
