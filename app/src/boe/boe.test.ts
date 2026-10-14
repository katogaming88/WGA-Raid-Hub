import { describe, expect, it } from 'vitest';
import {
  boeFieldError,
  boeSeasonCatalog,
  boeSummary,
  defaultBoeTeamId,
  EMPTY_BOE_FIELDS,
  finderPaid,
  formatGold,
  groupByStatus,
  guildKept,
  olderOpenTwin,
  parseGoldInput,
  twinWarning,
  type WarningPart,
  boeDate,
  type BoeItemRow
} from './boe';

describe('boeFieldError', () => {
  const filled = {
    teamId: 2,
    charName: 'Kae-Tichondrius',
    itemName: 'Voidglass Cloak',
    track: 'Hero',
    rank: '2/6',
    note: '',
    donate: false
  };

  it('passes a fully filled form', () => {
    expect(boeFieldError(filled)).toBeNull();
  });

  it('names the team first, since it is the first field', () => {
    expect(boeFieldError(EMPTY_BOE_FIELDS)).toBe('Please select the team you raided with.');
  });

  it.each([
    ['charName', '', 'Please enter your character name.'],
    ['itemName', '', 'Please select an item.'],
    ['track', '', 'Please select the track.'],
    ['rank', '', 'Please select the upgrade rank.']
  ] as const)('requires %s', (field, blank, message) => {
    expect(boeFieldError({ ...filled, [field]: blank })).toBe(message);
  });
});

describe('boeSeasonCatalog', () => {
  const S1 = { id: 10, name: 'Visage of Unseen Truths', wcl_zone_id: 46 };
  const S2 = { id: 11, name: 'Crushing Coiler Coif', wcl_zone_id: 53 };
  const UNSCOPED = { id: 12, name: 'Seed Test BoE Belt', wcl_zone_id: null };
  const ZONES = [
    { wcl_zone_id: 46, season: 'MID1' },
    { wcl_zone_id: 53, season: 'MID2' }
  ];

  it("offers the season's items plus any unscoped one, sorted by name", () => {
    expect(boeSeasonCatalog([S1, S2, UNSCOPED], 'MID2', ZONES).map((i) => i.name)).toEqual([
      'Crushing Coiler Coif',
      'Seed Test BoE Belt'
    ]);
  });

  it('offers every item when there is no current season', () => {
    expect(boeSeasonCatalog([S1, S2, UNSCOPED], null, ZONES).map((i) => i.id)).toEqual([11, 12, 10]);
  });

  it('fails open to the whole catalog when the season has no zones recorded', () => {
    expect(boeSeasonCatalog([S1, S2], 'MID3', ZONES).map((i) => i.id)).toEqual([11, 10]);
  });
});

describe('defaultBoeTeamId', () => {
  it('picks the one claimed team', () => {
    expect(defaultBoeTeamId([3])).toBe(3);
  });

  it('leaves the placeholder for no claim', () => {
    expect(defaultBoeTeamId([])).toBeNull();
  });

  it('leaves the placeholder for alts on multiple teams', () => {
    expect(defaultBoeTeamId([2, 3])).toBeNull();
  });
});

// The lifecycle view (#1305), pure logic ported from
// tests/frontend/boe-manage.test.js's money math and FCFS matching.
function boeRow(over: Partial<BoeItemRow>): BoeItemRow {
  return {
    id: 1,
    team_id: 1,
    finder_name: 'Kae-Tichondrius',
    item_name: 'Voidglass Cloak',
    track: 'Hero',
    upgrade_rank: null,
    note: null,
    status: 'found',
    found_at: '2026-08-20T01:00:00Z',
    sold_at: null,
    payout_paid_at: null,
    retired_at: null,
    sale_price: null,
    finder_payout: null,
    guild_cut: null,
    ah_fee: null,
    payout_donated: false,
    ...over
  };
}

describe('parseGoldInput and formatGold', () => {
  it('parses the formats officers actually paste', () => {
    expect(parseGoldInput('250,000')).toBe(250000);
    expect(parseGoldInput(' 1 000 000 ')).toBe(1000000);
    expect(parseGoldInput('250000g')).toBe(250000);
  });

  it('rejects garbage and negatives rather than returning NaN', () => {
    expect(parseGoldInput('abc')).toBeNull();
    expect(parseGoldInput('')).toBeNull();
    expect(parseGoldInput('-5')).toBeNull();
  });

  it('formats with thousands separators', () => {
    expect(formatGold(1234567)).toBe('1,234,567');
    expect(formatGold(0)).toBe('0');
  });
});

describe('olderOpenTwin', () => {
  const OLDER = boeRow({ id: 1, found_at: '2026-08-19T01:00:00Z' });
  const NEWER = boeRow({ id: 2, found_at: '2026-08-20T01:00:00Z' });

  it('finds an older open row with the same name, track and rank', () => {
    expect(olderOpenTwin([OLDER, NEWER], NEWER)).toBe(OLDER);
  });

  it('ignores a row that is not open', () => {
    const sold = boeRow({ id: 1, status: 'sold', found_at: '2026-08-19T01:00:00Z' });
    expect(olderOpenTwin([sold, NEWER], NEWER)).toBeNull();
  });

  it('ignores a different item name, case aside', () => {
    const other = boeRow({ id: 1, item_name: 'sash of the fallen star', found_at: '2026-08-19T01:00:00Z' });
    expect(olderOpenTwin([other, NEWER], NEWER)).toBeNull();
    const same = boeRow({ id: 1, item_name: 'voidglass cloak', found_at: '2026-08-19T01:00:00Z' });
    expect(olderOpenTwin([same, NEWER], NEWER)).toBe(same);
  });

  it('ignores a different track', () => {
    const other = boeRow({ id: 1, track: 'Champion', found_at: '2026-08-19T01:00:00Z' });
    expect(olderOpenTwin([other, NEWER], NEWER)).toBeNull();
  });

  it('treats a missing rank on either side as a match', () => {
    const older = boeRow({ id: 1, upgrade_rank: null, found_at: '2026-08-19T01:00:00Z' });
    const candidate = boeRow({ id: 2, upgrade_rank: '2/6', found_at: '2026-08-20T01:00:00Z' });
    expect(olderOpenTwin([older, candidate], candidate)).toBe(older);
  });

  it('ignores a row with a different rank when both carry one', () => {
    const older = boeRow({ id: 1, upgrade_rank: '1/6', found_at: '2026-08-19T01:00:00Z' });
    const candidate = boeRow({ id: 2, upgrade_rank: '2/6', found_at: '2026-08-20T01:00:00Z' });
    expect(olderOpenTwin([older, candidate], candidate)).toBeNull();
  });

  it('returns the oldest match when several qualify', () => {
    const oldest = boeRow({ id: 1, found_at: '2026-08-18T01:00:00Z' });
    const middle = boeRow({ id: 2, found_at: '2026-08-19T01:00:00Z' });
    expect(olderOpenTwin([middle, oldest, NEWER], NEWER)).toBe(oldest);
  });
});

describe('twinWarning (#1205)', () => {
  // Each paragraph as the dialog reads it, with the bold names marked *Name*.
  const text = (lines: WarningPart[][]) =>
    lines.map((parts) => parts.map((p) => (typeof p === 'string' ? p : `*${p.finder}*`)).join(''));
  const older = (rank: string | null) =>
    boeRow({
      id: 1,
      finder_name: 'Firstfinder-Dalaran',
      track: 'Champion',
      upgrade_rank: rank,
      found_at: '2026-08-19T01:00:00Z'
    });
  const newer = (rank: string | null) =>
    boeRow({
      id: 2,
      finder_name: 'Second-Illidan',
      track: 'Champion',
      upgrade_rank: rank,
      found_at: '2026-08-20T01:00:00Z'
    });

  it('names the rank and older finder, says it has not sold, and names the row being sold', () => {
    expect(text(twinWarning(older('2/6'), newer('2/6')))).toEqual([
      `*Firstfinder-Dalaran* found a Voidglass Cloak at Champion 2/6 earlier (${boeDate('2026-08-19T01:00:00Z')}), and it hasn’t sold yet.`,
      'The first finder of the same item at the same rank gets the cut, so this sale belongs on *Firstfinder-Dalaran*’s find.',
      `You’re recording it on *Second-Illidan*’s find (${boeDate('2026-08-20T01:00:00Z')}).`
    ]);
  });

  it('says which find has no rank recorded', () => {
    expect(text(twinWarning(older(null), newer('2/6')))[0]).toContain('at Champion 2/6 earlier');
    expect(text(twinWarning(older(null), newer('2/6')))[0]).toContain('Its rank wasn’t recorded');
    expect(text(twinWarning(older('2/6'), newer(null)))[0]).toContain('This find’s rank wasn’t recorded');
    expect(text(twinWarning(older(null), newer(null)))[0]).toContain('at Champion earlier');
    expect(text(twinWarning(older(null), newer(null)))[0]).toContain('Neither find has a rank recorded');
  });

  it('keeps the no-track and unknown-finder fallbacks, and says "an" before a vowel', () => {
    const msg = text(
      twinWarning(
        boeRow({ id: 1, item_name: 'Ashen Band', track: null, finder_name: null, found_at: '2026-08-19T01:00:00Z' }),
        boeRow({ id: 2, item_name: 'Ashen Band', track: null, finder_name: null })
      )
    );
    expect(msg[0]).toMatch(/^Someone found an Ashen Band with no track earlier/);
    expect(msg[1]).toContain('belongs on *the unknown finder*’s find');
    expect(msg[2]).toMatch(/^You’re recording it on \*the unknown finder\*’s find/);
  });
});

describe('finderPaid and guildKept (donated payout, #862)', () => {
  const SOLD = boeRow({ status: 'sold', sale_price: 250000, finder_payout: 50000, guild_cut: 187500, ah_fee: 12500 });

  it('is unaffected by donate intent before settlement', () => {
    expect(finderPaid(SOLD)).toBe(50000);
    expect(guildKept(SOLD)).toBe(187500);
  });

  it('a plain paid row pays the finder', () => {
    const paid = { ...SOLD, status: 'paid', payout_paid_at: '2026-08-22T00:00:00Z' };
    expect(finderPaid(paid)).toBe(50000);
    expect(guildKept(paid)).toBe(187500);
  });

  it('a donated paid row pays the finder nothing and the guild the whole cut', () => {
    const donated = { ...SOLD, status: 'paid', payout_paid_at: '2026-08-22T00:00:00Z', payout_donated: true };
    expect(finderPaid(donated)).toBe(0);
    expect(guildKept(donated)).toBe(237500);
  });
});

describe('groupByStatus', () => {
  it('partitions by status, oldest-first open and awaiting, newest-first history', () => {
    const found = boeRow({ id: 1, status: 'found', found_at: '2026-08-20T00:00:00Z' });
    const listed = boeRow({ id: 2, status: 'listed', found_at: '2026-08-19T00:00:00Z' });
    const sold = boeRow({ id: 3, status: 'sold', sold_at: '2026-08-21T00:00:00Z' });
    const paid = boeRow({ id: 4, status: 'paid', payout_paid_at: '2026-08-22T00:00:00Z' });
    const retired = boeRow({ id: 5, status: 'retired', retired_at: '2026-08-23T00:00:00Z' });
    const sections = groupByStatus([found, listed, sold, paid, retired]);
    expect(sections.open.map((r) => r.id)).toEqual([2, 1]);
    expect(sections.awaiting.map((r) => r.id)).toEqual([3]);
    expect(sections.history.map((r) => r.id)).toEqual([5, 4]);
  });
});

describe('boeSummary', () => {
  it('totals guild income over sold and paid, and outstanding over sold', () => {
    const items = [
      boeRow({ id: 1, status: 'sold', sale_price: 250000, finder_payout: 50000, guild_cut: 187500, ah_fee: 12500 }),
      boeRow({
        id: 2,
        status: 'paid',
        payout_paid_at: '2026-08-22T00:00:00Z',
        sale_price: 100000,
        finder_payout: 20000,
        guild_cut: 75000,
        ah_fee: 5000
      })
    ];
    const summary = boeSummary(items);
    expect(summary.guildIncome).toBe(262500);
    expect(summary.outstanding).toBe(50000);
    expect(summary.donated).toBe(0);
  });

  it('counts a donated payout toward donated, not outstanding', () => {
    const items = [
      boeRow({
        id: 1,
        team_id: 1,
        status: 'paid',
        payout_paid_at: '2026-08-22T00:00:00Z',
        payout_donated: true,
        sale_price: 100000,
        finder_payout: 20000,
        guild_cut: 75000
      })
    ];
    const summary = boeSummary(items);
    expect(summary.donated).toBe(20000);
    expect(summary.outstanding).toBe(0);
  });

  it('sums per-team credit to the guild income headline, most finds first', () => {
    const items = [
      boeRow({ id: 1, team_id: 1, status: 'found' }),
      boeRow({ id: 2, team_id: 1, status: 'found' }),
      boeRow({
        id: 3,
        team_id: 1,
        status: 'paid',
        payout_paid_at: '2026-08-19T00:00:00Z',
        sale_price: 100000,
        finder_payout: 20000,
        guild_cut: 80000
      }),
      boeRow({ id: 4, team_id: 4, status: 'found' })
    ];
    const summary = boeSummary(items);
    expect(summary.byTeam).toEqual([
      { teamId: 1, found: 3, gold: 80000 },
      { teamId: 4, found: 1, gold: 0 }
    ]);
    expect(summary.guildIncome).toBe(80000);
  });
});
