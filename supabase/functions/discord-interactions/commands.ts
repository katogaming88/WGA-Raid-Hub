// The bot's slash commands (#998), registered once for the whole application
// by scripts/discord/register-commands.ts, not per server: a server that adds
// the bot gets them with nothing re-run. #961 adds the other nine here.

// Manage Server, so only a server's officers see /nudge-missing by default.
const MANAGE_GUILD = String(1 << 5);
// Server channels only: a DM has no server to read teams from.
const GUILD_ONLY = [0];

export const COMMANDS = [
  {
    name: 'nudge-missing',
    description: 'DM raiders missing a wishlist, BiS source link, or a real BiS pick on their wishlist',
    default_member_permissions: MANAGE_GUILD,
    contexts: GUILD_ONLY,
    options: [
      {
        // Optional: a server with one team needs no answer. The choices are
        // the teams whose Discord server is this one, read as it is typed.
        type: 3,
        name: 'team',
        description: 'Which team, when this server has more than one',
        required: false,
        autocomplete: true
      }
    ]
  },
  {
    name: 'about',
    description: 'Which Raid Hub release last changed the bot',
    contexts: GUILD_ONLY
  }
];
