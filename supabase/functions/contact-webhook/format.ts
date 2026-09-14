// The Discord post a contact report becomes, split out of index.ts so it can
// be tested without a server (#1006 shape, #1129). Every field value has to
// fit Discord's 1024, or the whole post is refused and the report is gone:
// nothing stores a contact submission.
import { EMBED_FIELD_VALUE_MAX, truncate } from '../_shared/discord-text.ts';
import type { Submitter } from './submitter.ts';

export type ContactReport = {
  team: unknown;
  name: unknown;
  message: unknown;
  submitter: Submitter | null;
  // The [local] marker from the destination resolver, or null on production.
  mark: string | null;
  now?: Date;
};

export function contactPayload({ team, name, message, submitter, mark, now }: ContactReport) {
  // <@id> renders as a clickable mention in the embed field (right-click ->
  // Message) same as it would in plain message content -- no ping/
  // notification fires from this alone, it's just a clickable chip.
  const discordField = submitter?.discordId
    ? '<@' + submitter.discordId + '>'
    : submitter?.username
      ? truncate(submitter.username, EMBED_FIELD_VALUE_MAX)
      : '(not logged in)';

  // An embed has no first line to mark, so a local post carries the marker
  // as content above it; production sends no content key at all.
  return {
    ...(mark ? { content: mark } : {}),
    embeds: [
      {
        title: 'Site Contact Form Submission',
        color: 0xd6a344,
        fields: [
          { name: 'Team', value: truncate(String(team || 'Unknown'), EMBED_FIELD_VALUE_MAX), inline: true },
          {
            name: 'Name',
            value: name ? truncate(String(name), EMBED_FIELD_VALUE_MAX) : '(not provided)',
            inline: true
          },
          { name: 'Discord', value: discordField, inline: true },
          { name: 'Message', value: truncate(String(message), EMBED_FIELD_VALUE_MAX) }
        ],
        timestamp: (now ?? new Date()).toISOString()
      }
    ],
    // Nothing here has any business notifying anyone. An embed never pings
    // on its own; this is the line somebody can read.
    allowed_mentions: { parse: [] }
  };
}
