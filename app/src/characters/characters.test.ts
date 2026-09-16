import { describe, expect, it } from 'vitest';
import { battlenetTokenAfter } from '../auth/session';
import { officerStats } from '../roster/roster';
import { seasonLoot } from '../profile/profile';
import {
  altsOf,
  earlierOwners,
  linkedNotices,
  pickerRows,
  savedAlts,
  withEarlierLoot,
  type AccountCharacter,
  type RosterLink
} from './characters';

const TEAMS = new Map([
  [1, 'Phoenix'],
  [2, 'Hellfire']
]);

const character = (id: number, name: string, extra: Partial<AccountCharacter> = {}): AccountCharacter => ({
  blizzard_id: id,
  name,
  realm: 'Illidan',
  realm_slug: 'illidan',
  class_name: 'Evoker',
  spec_name: 'Preservation',
  level: 90,
  item_level: 701,
  saved: false,
  roster: null,
  ...extra
});

const link = (outcome: RosterLink['outcome'], team_id = 1, name_realm = 'Grihz-Illidan'): RosterLink => ({
  player_id: 5,
  team_id,
  name_realm,
  outcome
});

describe('pickerRows', () => {
  it('locks roster characters and leaves the rest to choose', () => {
    const rows = pickerRows(
      {
        characters: [
          character(1, 'Grihz', { roster: link('already_yours') }),
          character(2, 'Grihzy', { saved: true }),
          character(3, 'Holygrihz', { roster: link('claimed_by_someone_else', 2) }),
          character(4, 'Grihzfrost', { roster: link('needs_discord', 2) }),
          character(5, 'Grihznew', { roster: link('linked') })
        ],
        roster: []
      },
      TEAMS
    );
    expect(rows.map((r) => [r.character.name, r.kind, 'team' in r ? r.team : null])).toEqual([
      ['Grihz', 'yours', 'Phoenix'],
      ['Grihzy', 'choose', null],
      ['Holygrihz', 'claimed', 'Hellfire'],
      ['Grihzfrost', 'needs-discord', 'Hellfire'],
      ['Grihznew', 'yours', 'Phoenix']
    ]);
    // Only a character they can choose starts as an alt, and only if saved.
    expect([...savedAlts(rows)]).toEqual([2]);
  });
});

describe('linkedNotices', () => {
  it('names each character just linked and its team', () => {
    expect(
      linkedNotices(
        [link('linked'), link('already_yours', 1, 'Old-Illidan'), link('linked', 7, 'Lowbie-Illidan')],
        TEAMS
      )
    ).toEqual([
      'Grihz-Illidan was on Phoenix’s roster, so it’s now your roster character.',
      'Lowbie-Illidan was on a team’s roster, so it’s now your roster character.'
    ]);
  });
});

describe('altsOf', () => {
  it('leaves out a saved character that is on the roster, highest item level first', () => {
    const saved = (id: number, name: string, item_level: number | null, realm = 'Illidan') => ({
      id,
      person_id: 3,
      name,
      realm,
      class_name: 'Druid',
      spec_name: 'Guardian',
      item_level
    });
    const alts = altsOf(
      [saved(1, 'Grihzbear', 689, 'Area 52'), saved(2, 'Grihz', 708), saved(3, 'Grihzy', 701)],
      ['Grihz-Illidan', 'Someone-Area52']
    );
    expect(alts.map((a) => a.name)).toEqual(['Grihzy', 'Grihzbear']);
  });
});

const SEASON = { name: 'Midnight Season 2', code: 'MID2', start: '2026-08-01', end: '2026-12-31' };
const award = (id: number, player_id: number, season = 'MID2') => ({
  id,
  player_id,
  track: 'Hero',
  season,
  awarded_at: `2026-08-${10 + id}T18:00:00Z`,
  items: { name: `Item ${id}` }
});

describe('loot from earlier characters (Kat, 2026-09-15)', () => {
  const pairs = [
    { player_id: 10, earlier_player_id: 20 },
    { player_id: 10, earlier_player_id: 30 },
    { player_id: 11, earlier_player_id: 40 }
  ];
  const players = new Map([
    [20, { id: 20, name_realm: 'Fluffold-Illidan', team_id: 1 }],
    [30, { id: 30, name_realm: 'Fluffhell-Illidan', team_id: 2 }],
    [40, { id: 40, name_realm: 'Other-Illidan', team_id: 1 }]
  ]);

  it('adds an old main’s and a left team’s loot to the profile, marked where it was received', () => {
    const rows = withEarlierLoot(
      10,
      [award(1, 10)],
      [award(2, 20), award(3, 30), award(4, 40), award(1, 10)],
      pairs,
      players,
      1,
      TEAMS
    );
    const loot = seasonLoot(rows, SEASON);
    expect(loot.awards.map((a) => [a.name, a.from])).toEqual([
      ['Item 3', 'Hellfire'],
      ['Item 2', 'Fluffold'],
      ['Item 1', null]
    ]);
  });

  it('counts them in the roster’s items, once each, for the row they belong to now', () => {
    const stats = officerStats(
      [
        { id: 10, join_date: null },
        { id: 11, join_date: null }
      ],
      [],
      // The team's read already holds the old main's award 2; the earlier read
      // brings it again with the other team's award 3.
      [award(1, 10), award(2, 20), award(4, 40), award(5, 10, 'MID1'), award(2, 20), award(3, 30)],
      SEASON,
      earlierOwners(pairs)
    );
    expect(stats.get(10)?.items).toBe(3);
    expect(stats.get(11)?.items).toBe(1);
  });
});

describe('battlenetTokenAfter', () => {
  it('keeps the token only after a round trip to Battle.net that finished', () => {
    expect(battlenetTokenAfter('choose-alts', 'custom:battlenet', null, 'tok')).toBe('tok');
    expect(battlenetTokenAfter('sign-in', 'custom:battlenet', null, 'tok')).toBe('tok');
    expect(battlenetTokenAfter('connect-battlenet', 'custom:battlenet', null, 'tok')).toBe('tok');
    // A Discord sign-in leaves Discord's token, which Blizzard would refuse.
    expect(battlenetTokenAfter('sign-in', 'discord', null, 'tok')).toBeNull();
    expect(battlenetTokenAfter('connect-battlenet', 'custom:battlenet', 'refused', 'tok')).toBeNull();
    expect(battlenetTokenAfter(null, null, null, 'tok')).toBeNull();
  });
});
