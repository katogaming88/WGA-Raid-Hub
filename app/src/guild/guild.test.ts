import { describe, expect, it } from 'vitest';
import {
  attentionRows,
  guildIntro,
  guildLinks,
  guildLive,
  nextRaid,
  officers,
  realmSlug,
  scheduleLine,
  teamCards,
  teamProgress,
  type TeamData
} from './guild';
import type { ScheduleChange, ScheduleRule } from '../calendar/calendar';
import type { StreamerRow } from '../streams/streams';

// Guild home's rules (#1102). The same behavior is checked in a browser against
// both sites from tests/behavior/guild.js; these cover the edges.

const rule = (weekday: number, start: string | null = '20:00:00', minutes: number | null = 180, optional = false) =>
  ({ weekday, start_time: start, duration_minutes: minutes, is_optional: optional }) satisfies ScheduleRule;

describe('guild links', () => {
  it('builds Raider.IO and the Armory from the region, realm and name', () => {
    expect(guildLinks({ name: 'We Go Again', region: 'us', realm: 'Tichondrius' })).toEqual({
      raiderIo: 'https://raider.io/guilds/us/tichondrius/We%20Go%20Again',
      armory: 'https://worldofwarcraft.com/en-us/guild/us/tichondrius/we-go-again'
    });
  });

  it('leaves the links out until both are set', () => {
    expect(guildLinks({ name: 'We Go Again', region: null, realm: 'Tichondrius' })).toBeNull();
    expect(guildLinks({ name: 'We Go Again', region: 'us', realm: null })).toBeNull();
  });

  it('slugs realms the way Blizzard does', () => {
    expect(realmSlug("Mal'Ganis")).toBe('malganis');
    expect(realmSlug('Aerie Peak')).toBe('aerie-peak');
  });

  it('counts the teams in the intro, and names the realm when there is one', () => {
    expect(guildIntro(3, 'Tichondrius')).toBe('Three raid teams on Tichondrius. Pick yours, or find one to join.');
    expect(guildIntro(1, null)).toBe('One raid team. Pick yours, or find one to join.');
    expect(guildIntro(12, null)).toBe('12 raid teams. Pick yours, or find one to join.');
  });
});

describe('schedule line', () => {
  it('names the nights once when they share a time', () => {
    expect(scheduleLine([rule(4), rule(2)])).toBe('Tue and Thu, 8:00 PM to 11:00 PM Eastern');
    expect(scheduleLine([rule(1), rule(3), rule(5)])).toBe('Mon, Wed and Fri, 8:00 PM to 11:00 PM Eastern');
  });

  it('gives each night its own start when the times differ', () => {
    expect(scheduleLine([rule(0, '19:00:00'), rule(2)])).toBe('Sun 7:00 PM, Tue 8:00 PM');
  });

  it('leaves optional nights out unless there are no others', () => {
    expect(scheduleLine([rule(2), rule(6, '20:00:00', 180, true)])).toBe('Tue, 8:00 PM to 11:00 PM Eastern');
    expect(scheduleLine([rule(6, '20:00:00', 180, true)])).toBe('Sat, 8:00 PM to 11:00 PM Eastern');
  });

  it('says so when a team has no raid nights', () => {
    expect(scheduleLine([])).toBe('No raid nights set');
  });
});

describe('next raid', () => {
  // A Wednesday.
  const today = new Date(2026, 4, 13, 12);
  const cancel = (date: string): ScheduleChange => ({
    raid_date: date,
    exception_type: 'cancelled',
    start_time: null,
    duration_minutes: null,
    is_optional: false,
    note: null
  });

  it('counts today', () => {
    expect(nextRaid([rule(3)], [], today)).toBe('Wed, May 13 8:00 PM');
  });

  it('skips a cancelled night', () => {
    expect(nextRaid([rule(3), rule(4)], [cancel('2026-05-13')], today)).toBe('Thu, May 14 8:00 PM');
  });

  it('has none without a schedule', () => {
    expect(nextRaid([], [], today)).toBeNull();
  });
});

describe('team progress', () => {
  const raid = {
    name: 'Halls of the Fallen Choir',
    wclZoneId: 1,
    bosses: [{ name: 'Warden of Ash', mythicDate: '2026-04-02' }, { name: 'Choirmaster' }, { name: 'Hollow King' }]
  };
  const heroicKill = {
    mythic_date: null,
    mythic_pulls: null,
    mythic_best_pct: null,
    mythic_report_code: null,
    mythic_fight_id: null,
    heroic_date: '2026-03-20',
    heroic_pulls: 5,
    heroic_best_pct: null,
    heroic_report_code: null,
    heroic_fight_id: null,
    raid_encounters: { name: 'Choirmaster', wcl_encounter_id: null, raid_zones: { wcl_zone_id: 1 } }
  };

  it('counts a Mythic kill as a Heroic one too', () => {
    expect(teamProgress([raid], [heroicKill])).toEqual({
      text: '2/3 Heroic, 1/3 Mythic',
      pips: [
        { name: 'Warden of Ash', kill: 'mythic' },
        { name: 'Choirmaster', kill: 'heroic' },
        { name: 'Hollow King', kill: 'none' }
      ]
    });
  });

  it('follows the first full raid, not a mini-raid listed before it', () => {
    const mini = { name: 'Side Wing', isMiniRaid: true, bosses: [{ name: 'Gatekeeper' }] };
    expect(teamProgress([mini, raid], [])?.pips).toHaveLength(3);
  });

  it('has nothing to show without raids', () => {
    expect(teamProgress([], [])).toBeNull();
  });
});

describe('team cards', () => {
  const teams = [
    { id: 1, key: 'phoenix', name: 'Phoenix' },
    { id: 4, key: 'wrathless', name: 'Wrathless' }
  ];
  const data: TeamData = {
    settings: [{ team_id: 1, signups_open: true, logs: 'https://www.warcraftlogs.com/guild/id/1', raids: null }],
    progress: [],
    schedule: [{ ...rule(2), team_id: 1 }],
    changes: [],
    roles: [
      { team_id: 1, classes_specs: { role: 'Tank' } },
      { team_id: 1, classes_specs: null },
      { team_id: 4, classes_specs: { role: 'Heal' } }
    ]
  };

  it('keeps every team, and closes signups for one with no settings', () => {
    const cards = teamCards(teams, data, new Set([4]), new Date(2026, 4, 13));
    expect(cards.map((c) => [c.name, c.mine, c.signup, c.logs, c.raiders])).toEqual([
      ['Phoenix', false, true, 'https://www.warcraftlogs.com/guild/id/1', 1],
      ['Wrathless', true, false, null, 1]
    ]);
    expect(cards[1]?.schedule).toBe('No raid nights set');
    expect(cards[1]?.progress).toBeNull();
  });
});

describe('live streams', () => {
  const row = (id: number, live: boolean, optOut: boolean, nickname: string | null): StreamerRow => ({
    id,
    team_id: 2,
    twitch_channel: `channel${id}`,
    schedule_note: null,
    guild_wide_opt_out: optOut,
    is_live: live,
    players: { name_realm: `Name${id}-Illidan`, nickname }
  });

  it('lists who is live, by nickname or first name, leaving out anyone who opted out', () => {
    const live = guildLive(
      [row(1, true, false, 'Aur'), row(2, true, true, null), row(3, false, false, null), row(4, true, false, ' ')],
      new Map([[2, 'Hellfire Rollers']])
    );
    expect(live.map((s) => [s.name, s.team])).toEqual([
      ['Aur', 'Hellfire Rollers'],
      ['Name4', 'Hellfire Rollers']
    ]);
  });
});

describe('guild officers', () => {
  it('falls back to initials and a placeholder name', () => {
    expect(officers([{ name: 'Aurelith', title: 'Guild Master', classKey: 'Paladin' }, { title: 'Officer' }])).toEqual([
      { name: 'Aurelith', title: 'Guild Master', photo: null, initials: 'AU', classKey: 'Paladin' },
      { name: 'Unnamed', title: 'Officer', photo: null, initials: 'UN', classKey: null }
    ]);
    expect(officers(null)).toEqual([]);
  });
});

describe('needs your attention', () => {
  const teams = [
    { id: 1, key: 'phoenix', name: 'Phoenix' },
    { id: 2, key: 'hellfire', name: 'Hellfire Rollers' }
  ];

  it('lists only what is waiting, with the teams it waits on', () => {
    const rows = attentionRows(
      [
        { team_id: 1, reviews: 3, signups: 0, boe: 1 },
        { team_id: 2, reviews: 1, signups: 0, boe: 0 }
      ],
      teams
    );
    expect(rows).toEqual([
      {
        kind: 'reviews',
        label: 'Received-item reviews',
        total: 4,
        teams: [
          { key: 'phoenix', name: 'Phoenix', count: 3 },
          { key: 'hellfire', name: 'Hellfire Rollers', count: 1 }
        ]
      },
      { kind: 'boe', label: 'BoE finds to price', total: 1, teams: [{ key: 'phoenix', name: 'Phoenix', count: 1 }] }
    ]);
  });

  it('is empty when nothing is waiting', () => {
    expect(attentionRows([{ team_id: 1, reviews: 0, signups: 0, boe: 0 }], teams)).toEqual([]);
  });
});
