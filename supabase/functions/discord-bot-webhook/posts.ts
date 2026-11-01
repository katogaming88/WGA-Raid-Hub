// What discord-bot-webhook posts (#959), one builder per action, carried over
// from the bot process's routes (bot/src/index.ts) field for field. No I/O
// here: handler.ts decides who may ask and where it goes.
//
// Every message names whom it may ping. `parse: []` turns off Discord's
// reading of mentions in the text, so an "@everyone" typed into a note or a
// character name is text; the team's ping role, when it has one, is the only
// mention allowed. The bot holds Mention Everyone (Kat, 2026-10-29), so this
// is the only guard, and a test fails on any builder that leaves it out.
import { EMBED_FIELD_VALUE_MAX, truncate } from '../_shared/discord-text.ts';

export type Payload = Record<string, unknown>;
export type Field = { name: string; value: string; inline?: boolean };
export type Embed = { color: number; title: string; description?: string; fields?: Field[]; footer?: { text: string } };
export type Message = {
  content?: string;
  embeds: Embed[];
  allowed_mentions: { parse: never[]; roles: string[]; users: never[] };
};

// The setting each channel post reads on Settings › Discord (#994, #1712).
export type Kind = 'officer_requests' | 'mplus_requests' | 'rsvp_changes';

// Who may ask for each action (#959):
//   cron     the optional-rsvp-reminders job, by its own secret;
//   signedIn a signed-in caller (the pages behind it need a sign-in);
//   record   a request row for that character on that team written in the
//            last minute, since these forms work signed out on the current
//            site.
export type Gate = 'cron' | 'signedIn' | 'record';
export type RecordTable = 'self_received_requests' | 'bis_requests' | 'mplus_exclusion_requests';

export type Action = {
  gate: Gate;
  // A channel post's setting; absent for the DM, the channel check and the
  // signup sheet.
  kind?: Kind;
  record?: { table: RecordTable; nameRealm: (p: Payload) => string };
};

export const ACTIONS: Record<string, Action> = {
  signup: { gate: 'signedIn', kind: 'officer_requests' },
  addCharacter: { gate: 'signedIn', kind: 'officer_requests' },
  selfreceived: {
    gate: 'record',
    kind: 'officer_requests',
    record: { table: 'self_received_requests', nameRealm: (p) => text(p.player) }
  },
  bis: {
    gate: 'record',
    kind: 'officer_requests',
    record: { table: 'bis_requests', nameRealm: (p) => text(p.nameRealm) }
  },
  mplus: {
    gate: 'record',
    kind: 'mplus_requests',
    record: { table: 'mplus_exclusion_requests', nameRealm: (p) => text(p.nameRealm || p.characterName) }
  },
  rsvp: { gate: 'signedIn', kind: 'rsvp_changes' },
  optionalReminder: { gate: 'cron' },
  // The sheet moves into a function with #960; until then this answers OK and
  // posts nothing (Kat, 2026-11-01: the old bots are out of the server).
  signupSheetSync: { gate: 'signedIn' },
  verifyChannel: { gate: 'signedIn' }
};

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const field = (name: string, value: unknown, fallback: string, inline?: boolean): Field => ({
  name,
  value: truncate(text(value) || fallback, EMBED_FIELD_VALUE_MAX),
  ...(inline ? { inline } : {})
});
const when = (submittedAt: string): string => `<t:${Math.floor(new Date(submittedAt).getTime() / 1000)}:f>`;

export function mentions(roleId: string | null): Message['allowed_mentions'] {
  return { parse: [], roles: roleId ? [roleId] : [], users: [] };
}

// The ping line in front of the embed, or no content at all.
function withPing(roleId: string | null, line: string, embed: Embed): Message {
  return {
    ...(roleId ? { content: truncate(`<@&${roleId}> ${line}`, 2000) } : {}),
    embeds: [embed],
    allowed_mentions: mentions(roleId)
  };
}

export class MissingFields extends Error {}
const need = (...values: string[]) => {
  if (values.some((v) => !v)) throw new MissingFields();
};

// A channel post, from the payload (and the time it arrived), pinging roleId.
export function buildPost(action: string, p: Payload, roleId: string | null, submittedAt: string): Message {
  switch (action) {
    case 'signup': {
      const charName = text(p.charName);
      need(charName, text(p.className), text(p.mainSpec));
      const realm = text(p.realm);
      return withPing(roleId, 'New raid signup received!', {
        color: 0x3498db,
        title: 'New Raid Signup',
        fields: [
          field('Character', realm ? `${charName}-${realm}` : charName, ''),
          field('Class / Main Spec', `${text(p.className)} — ${text(p.mainSpec)}`, ''),
          field('Role', p.role, 'N/A', true),
          field('Off Specs', p.offSpecs, '*(none)*', true),
          field('Discord', p.discord, '*(not provided)*', true),
          field(
            'Main Swap',
            p.mainSwap === true ? `Yes, from ${text(p.swapFromNameRealm) || 'unknown character'}` : 'No',
            '',
            true
          ),
          { name: 'Submitted At', value: when(submittedAt) },
          field('Notes', p.notes, '*(none)*')
        ],
        footer: { text: 'Raid Signup System' }
      });
    }
    case 'addCharacter': {
      const member = text(p.member);
      const nameRealm = text(p.nameRealm);
      need(member, nameRealm);
      // No ping: officers asked to hear of adds, not to be woken by them.
      return {
        embeds: [
          {
            color: 0x2ecc71,
            title: 'Character Added to Roster',
            description: truncate(
              `${member} added ${nameRealm} to the roster. If that is wrong, use Remove claim, Remove or Archive Member.`,
              4096
            ),
            fields: [
              field('Member', member, '', true),
              field('Character', nameRealm, '', true),
              field('Class / Spec', p.classSpec, 'N/A', true),
              { name: 'Added At', value: when(text(p.submittedAt) || submittedAt) }
            ],
            footer: { text: 'Roster' }
          }
        ],
        allowed_mentions: mentions(null)
      };
    }
    case 'selfreceived':
      need(text(p.player), text(p.item));
      return withPing(roleId, 'New self-received request received!', {
        color: 0xe67e22,
        title: 'New Self-Received Request',
        fields: [
          field('Player', p.player, ''),
          field('Item', p.item, ''),
          field('Slot', p.slot, 'N/A', true),
          field('Source', p.source, 'N/A', true),
          { name: 'Submitted At', value: when(submittedAt) },
          field('Notes', p.notes, '*(none)*')
        ],
        footer: { text: 'Self-Received Request System' }
      });
    case 'bis': {
      need(text(p.nameRealm), text(p.bisLink));
      const sameLink = p.sameLink === true;
      return withPing(
        roleId,
        sameLink ? 'BiS Source items changed (same link) -- please recheck!' : 'New BiS Source submission received!',
        {
          color: 0x1abc9c,
          title: sameLink ? 'BiS Source Flagged -- Items Changed' : 'New BiS Source Submission',
          fields: [
            field('Player', p.nameRealm, ''),
            { name: 'Submitted At', value: when(submittedAt) },
            field('BiS Source', p.bisLink, ''),
            field('Notes', p.notes, '*(none)*')
          ],
          footer: { text: 'BiS Source System' }
        }
      );
    }
    case 'mplus': {
      const player = text(p.nameRealm || p.characterName);
      const profile = text(p.raiderioUrl || p.mplusLink);
      need(player, profile);
      return withPing(roleId, 'New M+ exclusion request received!', {
        color: 0x9b59b6,
        title: 'New M+ Exclusion Request',
        fields: [
          field('Player', player, ''),
          { name: 'Submitted At', value: when(submittedAt) },
          field('Raider.io / Profile', profile, ''),
          ...(text(p.raidLink) ? [field('Raid Droptimizer', p.raidLink, '')] : []),
          field('Notes', p.notes, '*(none)*')
        ],
        footer: { text: 'M+ Exclusion Request System' }
      });
    }
    case 'rsvp': {
      const charName = text(p.charName);
      const raidDate = text(p.raidDate);
      const status = text(p.status);
      need(charName, raidDate, status);
      return withPing(roleId, `${charName} marked themselves ${status} for ${raidDate}`, {
        color: 0xe0c23d,
        title: 'Raid RSVP Update',
        fields: [
          field('Player', charName, ''),
          field('Raid Date', raidDate, ''),
          field('Status', status, ''),
          field('Note', p.note, '*(none)*')
        ],
        footer: { text: 'Raid Calendar' }
      });
    }
  }
  throw new Error('No post for ' + action);
}

// The optional raid night reminder, sent as a DM (#895).
export function buildReminder(p: Payload): Message {
  const checkpoint = text(p.checkpoint);
  const raidDate = text(p.raidDate);
  need(text(p.discordId), checkpoint, raidDate);
  const startTime = text(p.startTime);
  const timezone = text(p.timezone);
  return {
    embeds: [
      {
        color: 0xe0c23d,
        title: 'Raid RSVP Needed',
        description: `This is an optional raid night in ${checkpoint === '24h' ? '24 hours' : '2 hours'} (${raidDate}${startTime ? ', ' + startTime : ''}${timezone ? ' ' + timezone : ''}). You haven't set a status yet -- please RSVP on the calendar.`
      }
    ],
    allowed_mentions: mentions(null)
  };
}
