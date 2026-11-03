// Uploads the 40 spec icons as the Raid Hub bot's own emojis (#960), so the
// signup sheet can show each raider's spec icon in its text. Application
// emojis belong to the bot, not to a server: every server the bot is in can
// show them, and no server's emoji list changes. Each is named after its icon
// file with underscores (app/public/spec-icons/warlock-demonology.jpg ->
// warlock_demonology), which is how the sheet finds them; no ids are stored.
//
// Run by hand when a spec icon is added; one already uploaded is skipped:
//
//   DISCORD_BOT_TOKEN=... npm run discord:emojis
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';

const token = Deno.env.get('DISCORD_BOT_TOKEN');
if (!token) {
  console.error('Set DISCORD_BOT_TOKEN.');
  Deno.exit(1);
}
const API = 'https://discord.com/api/v10';
const headers = { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' };
const call = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(API + path, { ...init, headers });
  if (!res.ok) throw new Error(`${path}: Discord answered ${res.status}: ${await res.text()}`);
  return res.json();
};

const app = await call('/applications/@me');
const existing = new Set(
  ((await call(`/applications/${app.id}/emojis`)).items as { name: string }[]).map((e) => e.name)
);
const dir = new URL('../../app/public/spec-icons/', import.meta.url);
let added = 0;
for (const entry of [...Deno.readDirSync(dir)].sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.name.endsWith('.jpg')) continue;
  const name = entry.name.slice(0, -4).replaceAll('-', '_');
  if (existing.has(name)) continue;
  const image = 'data:image/jpeg;base64,' + encodeBase64(Deno.readFileSync(new URL(entry.name, dir)));
  await call(`/applications/${app.id}/emojis`, { method: 'POST', body: JSON.stringify({ name, image }) });
  added++;
}
console.log(`Uploaded ${added}; ${existing.size} were already there.`);
