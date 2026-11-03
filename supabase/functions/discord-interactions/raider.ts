// What /raider me, /raider schedule and /help say (#961). Pure functions of
// rows already read, so the tests check the words without a database.
import { type Night, startsAt } from '../_shared/signup-sheet.ts';
import { profileDeepLink, type WishlistSetupStatusRow } from './nudge.ts';

const BLUE = 0x3b82f6;

export type Signup = { seasonName: string; status: string | null } | null;
export type Award = { itemName: string | null; awardedAt: string; response: string | null };
export type RaidNight = { raidDate: string; night: Night; status: string | null };
export type ChannelPost = { label: string; channelId: string };
export type HelpTeam = { name: string; posts: ChannelPost[] };

// -- What counts as received ---------------------------------------------------
// A copy of app/src/settings/lootResponses.ts awardCountsAs() and the
// `counted` rule in shownLoot(): the app's tree isn't deployed with the
// functions. ponytail: two copies of one rule; move both to one shared file if
// a third reader appears.
type CountsAs = 'main' | 'off' | 'none' | 'hidden';
type Button = { text?: unknown; countsAs?: unknown };
const key = (text: string) => text.trim().toLowerCase();
const FIXED = ['personal loot - non tradeable', 'disenchant'];

function countsAs(list: any, response: string | null): CountsAs {
  if (!response?.trim()) return 'main';
  const k = key(response);
  if (!list || typeof list !== 'object') {
    if (k === 'xmog' || k === 'pet') return 'hidden';
    if (k === 'bonus loot' || FIXED.includes(k)) return 'none';
    return /\bos\b/i.test(response) || /m\+/i.test(response) ? 'off' : 'main';
  }
  if (FIXED.includes(k)) return 'none';
  const buttons: Button[] = [
    ...(Array.isArray(list.buttons) ? list.buttons : []),
    ...(Array.isArray(list.groups) ? list.groups.flatMap((g: any) => (Array.isArray(g?.buttons) ? g.buttons : [])) : [])
  ];
  const hit = buttons.find((b) => typeof b?.text === 'string' && key(b.text) === k)?.countsAs;
  return hit === 'main' || hit === 'off' || hit === 'none' ? hit : 'hidden';
}

// Counted toward items received: Main spec, or Off spec while the team has
// saved no list (today's rule).
export function counted(awards: Award[], list: unknown): Award[] {
  return awards
    .filter((a) => {
      const c = countsAs(list, a.response);
      return c === 'main' || (c === 'off' && !list);
    })
    .sort((a, b) => b.awardedAt.localeCompare(a.awardedAt));
}

// -- /raider me ----------------------------------------------------------------

function wishlistLines(rows: WishlistSetupStatusRow[]): string {
  if (rows.length === 0) return 'No wishlist is open for you right now.';
  const named = new Set(rows.map((r) => r.player_id)).size > 1;
  return rows
    .map((r) => {
      const label = `**${r.season_name}**${named ? ` (${r.name_realm})` : ''}: `;
      if (r.wishlist_count === 0) return label + 'no wishlist yet.';
      if (r.missing_bis_rows.length === 0) return label + 'every slot has a BiS pick.';
      return label + `missing a BiS pick for ${r.missing_bis_rows.join(', ')}.`;
    })
    .join('\n');
}

const SIGNUP_STATUS: Record<string, string> = {
  pending: 'signed up, waiting for an officer',
  approved: 'signed up and approved'
};

function signupLine(signup: Signup): string {
  if (!signup) return "Signups for the next season aren't open.";
  if (!signup.status) return `Not signed up for ${signup.seasonName} yet.`;
  return `${signup.seasonName}: ${SIGNUP_STATUS[signup.status] ?? signup.status}.`;
}

function receivedLine(awards: Award[]): string {
  if (awards.length === 0) return 'None yet this season.';
  const last = awards[0];
  const when = Math.round(new Date(last.awardedAt).getTime() / 1000);
  return `${awards.length} this season. Last: ${last.itemName ?? 'an item'}, <t:${when}:R>.`;
}

export function meMessage(input: {
  teamName: string;
  firstName: string | null;
  wishlist: WishlistSetupStatusRow[];
  signup: Signup;
  received: Award[];
  siteUrl?: string;
}) {
  const { siteUrl, firstName } = input;
  const base = siteUrl?.replace(/\/$/, '');
  const buttons =
    base && firstName
      ? [
          { type: 2, style: 5, label: 'Fix my wishlist', url: profileDeepLink(base, firstName, ['no-wishlist'])! },
          { type: 2, style: 5, label: 'Open my profile', url: `${base}/#profile/${encodeURIComponent(firstName)}` }
        ]
      : [];
  return {
    embeds: [
      {
        color: BLUE,
        title: `${input.teamName} -- Your loot setup`,
        fields: [
          { name: 'Wishlist', value: wishlistLines(input.wishlist) },
          { name: 'Season signup', value: signupLine(input.signup) },
          { name: 'Items received', value: receivedLine(input.received) }
        ]
      }
    ],
    components: buttons.length ? [{ type: 1, components: buttons }] : []
  };
}

// -- /raider schedule ------------------------------------------------------------

export function scheduleMessage(teamName: string, nights: RaidNight[]) {
  const lines = nights.map(({ raidDate, night, status }) => {
    const at = startsAt(raidDate, night);
    const when = at ? `<t:${Math.round(at.getTime() / 1000)}:F>` : raidDate;
    // Present unless answered, except on an optional night, which has no default.
    const answer = status ?? (night.isOptional ? 'No response' : 'Present');
    return `${when}${night.isOptional ? ' (optional)' : ''}: **${answer}**`;
  });
  return {
    embeds: [
      {
        color: BLUE,
        title: `${teamName} -- Your next raid nights`,
        description: lines.length ? lines.join('\n') : 'No raid nights in the next two weeks.'
      }
    ]
  };
}

// -- /help -----------------------------------------------------------------------

export function helpMessage(input: { teams: HelpTeam[]; commands: string[]; version: string }) {
  const teams = input.teams.length
    ? input.teams
        .map((t) => {
          const posts = t.posts.map((p) => `- ${p.label}: <#${p.channelId}>`).join('\n');
          return `**${t.name}**\n${posts || '- No posts set up yet'}`;
        })
        .join('\n\n')
    : 'No team has set this Discord server on Settings › Discord yet.';
  return {
    embeds: [
      {
        color: BLUE,
        title: 'Raid Hub bot',
        description: 'Raid Hub posts signup sheets and officer notices here, and answers the commands below.',
        fields: [
          { name: 'Teams and where their posts go', value: teams.slice(0, 1024) },
          {
            name: 'Commands you can use',
            value: input.commands.length ? input.commands.join('\n') : 'Link this Discord account on Raid Hub first.'
          },
          { name: 'Changing it', value: "A team's officers change its posts on Settings › Discord." }
        ],
        footer: { text: `The bot was last updated in Raid Hub release ${input.version}.` }
      }
    ]
  };
}
