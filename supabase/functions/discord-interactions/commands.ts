// The bot's slash commands (#998, #961), registered once for the whole
// application by scripts/discord/register-commands.ts, not per server: a
// server that adds the bot gets them with nothing re-run.
//
// Grouped by who uses them. Discord decides who sees a command per top-level
// command, so /officer defaults to Manage Server and /raider to everyone. A
// server admin can open /officer to more roles; the function still checks
// Raid Hub permissions on every command, so that widens nothing.

// Manage Server, so only a server's officers see /officer by default.
const MANAGE_GUILD = String(1 << 5);
// Server channels only: a DM has no server to read teams from.
const GUILD_ONLY = [0];
const SUB_COMMAND = 1;

// Optional: a server with one team needs no answer. The choices are the
// teams whose Discord server is this one, read as it is typed.
const TEAM = {
  type: 3,
  name: 'team',
  description: 'Which team, when this server has more than one',
  required: false,
  autocomplete: true
};

const sub = (name: string, description: string) => ({ type: SUB_COMMAND, name, description, options: [TEAM] });

export const COMMANDS = [
  {
    name: 'help',
    description: 'What the Raid Hub bot does in this server',
    contexts: GUILD_ONLY
  },
  {
    name: 'raider',
    description: 'Your own Raid Hub setup',
    contexts: GUILD_ONLY,
    options: [
      sub('me', 'Your wishlist, season signup and items received'),
      sub('schedule', 'Your next raid nights and your RSVP for each')
    ]
  },
  {
    name: 'officer',
    description: 'Officer tools for your team',
    default_member_permissions: MANAGE_GUILD,
    contexts: GUILD_ONLY,
    options: [
      sub('nudge-missing', 'DM raiders missing a wishlist, BiS source link, or a real BiS pick on their wishlist'),
      sub('invite', "Post the team's invite link in this channel")
    ]
  }
];
