// Registers the Raid Hub bot's slash commands with Discord (#998), once for
// the whole application, so every server that adds the bot has them. Run by
// hand whenever supabase/functions/discord-interactions/commands.ts changes:
//
//   DISCORD_BOT_TOKEN=... DISCORD_APPLICATION_ID=... npm run discord:register
//
// It replaces the whole set, so a command removed from the file goes from
// Discord too. A global change can take a few minutes to show in a server.
import { COMMANDS } from '../../supabase/functions/discord-interactions/commands.ts';

const token = Deno.env.get('DISCORD_BOT_TOKEN');
const appId = Deno.env.get('DISCORD_APPLICATION_ID');
if (!token || !appId) {
  console.error('Set DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID (Developer Portal, General Information).');
  Deno.exit(1);
}

const res = await fetch(`https://discord.com/api/v10/applications/${appId}/commands`, {
  method: 'PUT',
  headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify(COMMANDS)
});
if (!res.ok) {
  console.error(`Discord answered ${res.status}: ${await res.text()}`);
  Deno.exit(1);
}
const registered = (await res.json()) as { name: string }[];
console.log('Registered: ' + registered.map((c) => '/' + c.name).join(', '));
