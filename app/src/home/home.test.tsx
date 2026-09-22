import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { seededHandlers, type FakeHandlers } from '../test/fakeSupabase';
import { isOffSpec, lootFeed, mainSpecCount, raiderCount, searchFeed, type FeedLootRow } from './home';
import type { SeasonWindow } from '../profile/profile';

// The Home page's stats row and recent loot feed (#1102). The behavior these
// match on the current site is recorded in tests/behavior/home.js and checked
// end to end in tests/browser-app/home.test.js; this file covers the pieces
// that are cheaper to pin down here: the rules, and the page's own states.

const SEASON: SeasonWindow = { name: 'Midnight Season 3', code: 'MID3', start: '2026-03-04', end: null };

const award = (
  id: number,
  nameRealm: string,
  nickname: string | null,
  item: string,
  track: string,
  awardedAt: string,
  response = 'Mainspec/Need',
  season = 'MID3'
): FeedLootRow => ({
  id,
  track,
  season,
  awarded_at: awardedAt,
  response,
  items: { name: item },
  players: { name_realm: nameRealm, nickname }
});

const AWARDS = [
  award(1, 'Aurelith-Illidan', 'Aur', 'Ashwarden Greatshield', 'Myth', '2026-04-02T23:30:00+00:00'),
  award(2, 'Brightmoor-Illidan', null, 'Tidebound Vestments', 'Hero', '2026-04-09T23:30:00+00:00'),
  award(3, 'Cinderfall-Illidan', '', 'Hollow Choir Signet', 'Champion', '2026-04-16T23:30:00+00:00'),
  award(4, 'Aurelith-Illidan', 'Aur', 'Ashwarden Bulwark', 'Hero', '2026-04-23T23:30:00+00:00', 'OS'),
  award(5, 'Brightmoor-Illidan', null, 'Old Tier Chestguard', 'Myth', '2026-01-08T23:30:00+00:00', 'Need', 'MID2')
];

describe('the numbers on Home', () => {
  it('counts only roster entries: a character with no role is not one', () => {
    expect(
      raiderCount([
        { classes_specs: { role: 'Tank' } },
        { classes_specs: { role: 'Heal' } },
        { classes_specs: { role: null } },
        { classes_specs: null }
      ])
    ).toBe(2);
  });

  it('counts this season’s main-spec items, leaving out off-spec rolls', () => {
    expect(mainSpecCount(lootFeed(AWARDS, SEASON))).toBe(3);
  });

  it.each([
    ['OS', true],
    ['Minor Upgrade / OS', true],
    ['M+', true],
    ['Mainspec/Need', false],
    [null, false],
    // The current site misses these two as well; both have to move together.
    ['Offspec/Greed', false],
    ['Mythic+', false]
  ])('reads %s as off-spec: %s', (response, expected) => {
    expect(isOffSpec(response)).toBe(expected);
  });
});

describe('the recent loot feed', () => {
  const feed = lootFeed(AWARDS, SEASON);

  it('shows this season’s awards newest first, on the raid night’s own date', () => {
    expect(feed.map((r) => [r.player, r.item, r.difficulty, r.date, r.offSpec])).toEqual([
      ['Aur', 'Ashwarden Bulwark', 'Heroic', 'Apr 23, 2026', true],
      ['Cinderfall', 'Hollow Choir Signet', 'Normal', 'Apr 16, 2026', false],
      ['Brightmoor', 'Tidebound Vestments', 'Heroic', 'Apr 9, 2026', false],
      ['Aur', 'Ashwarden Greatshield', 'Mythic', 'Apr 2, 2026', false]
    ]);
  });

  it('keeps an award late on raid night on that night’s date', () => {
    const late = lootFeed(
      [award(9, 'Aurelith-Illidan', null, 'Late Drop', 'Myth', '2026-05-09T02:10:00+00:00')],
      SEASON
    );
    expect(late[0]!.date).toBe('May 8, 2026');
  });

  it('searches item names anywhere in the name, ignoring case', () => {
    expect(searchFeed(feed, 'CHOIR').map((r) => r.item)).toEqual(['Hollow Choir Signet']);
    expect(searchFeed(feed, 'nothing here')).toEqual([]);
  });

  it('shows the ten newest awards before anyone searches', () => {
    const many = Array.from({ length: 14 }, (_, i) =>
      award(
        100 + i,
        'Aurelith-Illidan',
        null,
        `Item ${i}`,
        'Myth',
        `2026-04-${String(i + 1).padStart(2, '0')}T23:30:00+00:00`
      )
    );
    expect(searchFeed(lootFeed(many, SEASON), '')).toHaveLength(10);
    expect(searchFeed(lootFeed(many, SEASON), 'Item')).toHaveLength(14);
  });
});

const handlers = (loot: FeedLootRow[]): FakeHandlers => {
  const base = seededHandlers();
  return seededHandlers({
    from: (read) => {
      if (read.table === 'players' && !read.single) {
        return {
          data: [
            {
              id: 1,
              name_realm: 'Aurelith-Illidan',
              nickname: 'Aur',
              classes_specs: { class: 'Warrior', spec: 'Protection', role: 'Tank' }
            },
            {
              id: 2,
              name_realm: 'Brightmoor-Illidan',
              nickname: null,
              classes_specs: { class: 'Paladin', spec: 'Holy', role: 'Heal' }
            }
          ]
        };
      }
      // The live tier is the seasons read (#938); the dates are still the
      // team's own keys until #1269.
      if (read.table === 'seasons')
        return { data: [{ code: SEASON.code, display_name: SEASON.name, starts_at: SEASON.start, ends_at: null }] };
      if (read.table === 'team_settings') return { data: { start: SEASON.start, end: SEASON.end } };
      if (read.table === 'rclc_loot') return { data: loot };
      return base.from!(read);
    }
  });
};

const statValue = (label: string) => screen.getByText(label).parentElement!.querySelector('dd')!.textContent;
const searchBox = () => screen.getByRole('searchbox', { name: 'Search item name' });
// The loot card, once the page's reads have landed. Scoped, because the shell
// keeps a status region of its own.
const lootCard = async () => within(await screen.findByRole('region', { name: 'Recent loot' }));

describe('the Home page', () => {
  it('names the team and its season, and shows both numbers', async () => {
    renderApp('/g/wga/t/phoenix', handlers(AWARDS));
    await lootCard();
    expect(screen.getByRole('heading', { level: 1, name: 'Phoenix' })).toBeInTheDocument();
    expect(screen.getByText('Midnight Season 3')).toBeInTheDocument();
    expect(statValue('Raiders')).toBe('2');
    expect(statValue('Items this season')).toBe('3');
  });

  it('reads the season’s loot for this team only', async () => {
    const { client } = renderApp('/g/wga/t/phoenix', handlers(AWARDS));
    await lootCard();
    const read = client.reads.find((r) => r.table === 'rclc_loot')!;
    expect(read.filters.filter(([op]) => op === 'eq')).toEqual([
      ['eq', 'team_id', 1],
      ['eq', 'season', 'MID3']
    ]);
  });

  it('filters the feed as the reader types, and says how many matched', async () => {
    renderApp('/g/wga/t/phoenix', handlers(AWARDS));
    const card = await lootCard();
    // A header row plus four awards.
    expect(card.getAllByRole('row')).toHaveLength(5);

    await userEvent.type(searchBox(), 'ashwarden');
    expect(card.getAllByRole('row')).toHaveLength(3);
    expect(card.getByRole('status')).toHaveTextContent('2 matching items.');

    await userEvent.clear(searchBox());
    expect(card.getByRole('status')).toHaveTextContent('The 4 newest awards in Midnight Season 3.');
  });

  it('says so when a search matches nothing, instead of showing an empty table', async () => {
    renderApp('/g/wga/t/phoenix', handlers(AWARDS));
    const card = await lootCard();
    await userEvent.type(searchBox(), 'zzzz');
    expect(card.getByRole('status')).toHaveTextContent('No matching items.');
    expect(card.queryByRole('table')).not.toBeInTheDocument();
  });

  it('says when the team has no loot yet', async () => {
    renderApp('/g/wga/t/phoenix', handlers([]));
    const card = await lootCard();
    expect(card.getByRole('status')).toHaveTextContent('No loot recorded in Midnight Season 3 yet.');
    expect(card.queryByRole('table')).not.toBeInTheDocument();
  });

  it('marks an off-spec award in words, not by colour', async () => {
    renderApp('/g/wga/t/phoenix', handlers(AWARDS));
    const card = await lootCard();
    const row = card.getByRole('row', { name: /Ashwarden Bulwark/ });
    expect(row).toHaveTextContent('OS/M+');
    expect(row).toHaveTextContent('Heroic');
  });
});
