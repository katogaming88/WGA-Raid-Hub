import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers } from '../test/fakeSupabase';
import { nightInViewerZone } from '../lib/dates';
import { progressSummary, quickFacts, sortedSpots, spotLabel, type RecruitingTeam } from './apply';
import { rememberRecruiter, savedRecruiter } from './recruiterLink';

// The public apply pages (#1546): the guild's teams, one team, the role
// filter, the two kinds of join button, the not-recruiting card and the
// recruiter link kept for 30 days.

const BASE: RecruitingTeam = {
  team_id: 1,
  name: 'Phoenix',
  slug: 'phoenix',
  taking_applications: true,
  join_method: 'application',
  ticket_link: null,
  about: 'Cutting Edge Mythic.\nTwo nights.',
  schedule_note: null,
  extra_night: 'none',
  raid_languages: ['English'],
  split_runs: 'none',
  alts_expected: 1,
  ptr_testing: 'none',
  min_item_level: 265,
  attendance_percent: 90,
  trial_days: 14,
  logs_required: true,
  other_requirements: null,
  exceptional_line: 'Exceptional players of any class or spec are welcome to apply.',
  spots: [
    { role: 'ranged', class_spec_id: null, class: null, spec: null, priority: 'low' },
    { role: 'healer', class_spec_id: 264, class: 'Shaman', spec: 'Restoration', priority: 'high' }
  ],
  nights: [
    {
      weekday: 3,
      start_time: '20:00:00',
      timezone: 'America/New_York',
      duration_minutes: 180,
      is_optional: false,
      difficulty: null
    }
  ],
  progress: [
    { zone: 'Old Raid', season: 1, boss: 'A', mythic_date: '2026-01-01', heroic_date: '2026-01-01' },
    { zone: 'New Raid', season: 2, boss: 'B', mythic_date: '2026-10-01', heroic_date: '2026-09-01' },
    { zone: 'New Raid', season: 2, boss: 'C', mythic_date: null, heroic_date: '2026-09-02' }
  ]
};

const TICKET: RecruitingTeam = {
  ...BASE,
  team_id: 3,
  name: 'Immolation',
  slug: 'immolation',
  join_method: 'discord_ticket',
  ticket_link: 'https://discord.gg/ticket',
  spots: [{ role: 'tank', class_spec_id: null, class: null, spec: null, priority: 'high' }],
  progress: []
};

const CLOSED: RecruitingTeam = {
  ...BASE,
  team_id: 4,
  name: 'Wrathless',
  slug: 'wrathless',
  taking_applications: false
};

function handlers(teams: RecruitingTeam[], extra: { recruiter?: { name: string; active: boolean } | null } = {}) {
  return seededHandlers({
    rpc(name, args) {
      if (name === 'team_recruiting_page') {
        const key = args['p_team_key'];
        return { data: key ? teams.filter((t) => t.slug === key) : teams };
      }
      if (name === 'recruiter_for_code') return { data: extra.recruiter ?? null };
      return seededHandlers().rpc!(name, args);
    }
  });
}

beforeEach(() => localStorage.clear());

describe('nightInViewerZone', () => {
  const night = { weekday: 4, start_time: '23:00:00', timezone: 'America/New_York', duration_minutes: 120 };
  const now = new Date('2026-11-10T12:00:00Z');

  it('keeps the night for a viewer in the same zone', () => {
    expect(nightInViewerZone(night, 'America/New_York', now)).toEqual({
      day: 'Thursday',
      time: '11:00 PM to 1:00 AM'
    });
  });

  it('moves the weekday for a viewer ahead of the team', () => {
    // 11 PM Thursday Eastern (UTC-5 in November) is 5 AM Friday in Berlin.
    expect(nightInViewerZone(night, 'Europe/Berlin', now)).toEqual({ day: 'Friday', time: '5:00 AM to 7:00 AM' });
  });

  it('uses the offset in force on the night, not today', () => {
    // 20 March 2026: Eastern is already on summer time (UTC-4) for a Thursday in April.
    const spring = nightInViewerZone({ ...night, start_time: '20:00:00' }, 'UTC', new Date('2026-03-01T12:00:00Z'));
    expect(spring.time).toBe('1:00 AM to 3:00 AM');
    const april = nightInViewerZone({ ...night, start_time: '20:00:00' }, 'UTC', new Date('2026-04-06T12:00:00Z'));
    expect(april.time).toBe('12:00 AM to 2:00 AM');
  });
});

describe('the apply rules', () => {
  it('lists high priority first and names a spot by its spec or role', () => {
    const spots = sortedSpots(BASE.spots);
    expect(spots.map(spotLabel)).toEqual(['Restoration Shaman', 'Any ranged']);
    expect(spotLabel({ role: 'tank', class_spec_id: null, class: null, spec: null, priority: 'low' })).toBe('Any tank');
  });

  it('counts the newest raid, Mythic when a boss is down', () => {
    expect(progressSummary(BASE.progress)).toEqual({ main: 'Mythic 1/2', sub: 'Heroic 2/2 in New Raid' });
    expect(progressSummary([])).toBeNull();
  });

  it('shows only the quick facts a team set', () => {
    expect(quickFacts(BASE)).toEqual(['Raid language: English', '1 alt expected']);
  });
});

describe('the recruiter link', () => {
  it('keeps a code for 30 days and no longer', () => {
    const day = 86_400_000;
    rememberRecruiter('wga', 'abcd1234', 0);
    expect(savedRecruiter('wga', 29 * day)).toBe('abcd1234');
    expect(savedRecruiter('wga', 31 * day)).toBeNull();
    expect(savedRecruiter('other', 0)).toBeNull();
  });
});

describe('the guild apply page', () => {
  it('is open to someone signed out and lists each team with the right button', async () => {
    renderApp('/g/wga/apply', handlers([BASE, TICKET, CLOSED]));
    expect(await screen.findByRole('heading', { name: 'Join us', level: 1 })).toBeInTheDocument();

    const phoenix = within(await screen.findByRole('region', { name: 'Phoenix' }));
    expect(phoenix.getByText('Recruiting')).toBeInTheDocument();
    expect(phoenix.getByRole('link', { name: 'Apply' })).toHaveAttribute('href', '/g/wga/apply/phoenix/form');
    expect(phoenix.getByRole('link', { name: 'See team' })).toHaveAttribute('href', '/g/wga/apply/phoenix');
    expect(phoenix.getByText('Restoration Shaman')).toBeInTheDocument();
    expect(phoenix.getByText('Mythic 1/2')).toBeInTheDocument();

    const immolation = within(screen.getByRole('region', { name: 'Immolation' }));
    expect(immolation.getByRole('link', { name: 'Open a Discord ticket' })).toHaveAttribute(
      'href',
      'https://discord.gg/ticket'
    );
    expect(immolation.queryByRole('link', { name: 'Apply' })).toBeNull();

    const wrathless = within(screen.getByRole('region', { name: 'Wrathless' }));
    expect(wrathless.getByText('Not recruiting')).toBeInTheDocument();
    expect(wrathless.queryByRole('link', { name: 'Apply' })).toBeNull();
    expect(wrathless.queryByRole('link', { name: 'Open a Discord ticket' })).toBeNull();
    // Still shows when it raids.
    expect(wrathless.getByText('Wednesday', { exact: false })).toBeInTheDocument();
    // The mockup's one visitor menu, not the whole team menu.
    expect(screen.queryByRole('link', { name: 'Roster' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Join us' })).toBeInTheDocument();
  });

  it('is open to someone signed in who is on no team', async () => {
    renderApp('/g/wga/apply', {
      ...handlers([BASE]),
      session: fakeSession({ battlenet: 'K#1', discord: { id: 'd', name: 'Kat' } })
    });
    expect(await screen.findByRole('region', { name: 'Phoenix' })).toBeInTheDocument();
  });

  it('tags the teams that need the role picked and fades the rest', async () => {
    const user = userEvent.setup();
    renderApp('/g/wga/apply', handlers([BASE, TICKET, CLOSED]));
    await screen.findByRole('region', { name: 'Phoenix' });

    await user.click(screen.getByRole('radio', { name: 'Healer' }));
    expect(within(screen.getByRole('region', { name: 'Phoenix' })).getByText('Needs a healer')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Phoenix' })).toHaveClass('apply-match');
    expect(screen.getByRole('region', { name: 'Immolation' })).toHaveClass('apply-faded');
    // A team not recruiting is never a match, even with the spot on file.
    expect(screen.getByRole('region', { name: 'Wrathless' })).toHaveClass('apply-faded');

    await user.click(screen.getByRole('radio', { name: 'Anything' }));
    expect(screen.queryByText('Needs a healer')).toBeNull();
    expect(screen.getByRole('region', { name: 'Immolation' })).not.toHaveClass('apply-faded');
  });

  it('keeps a good ?from= code and ignores a switched-off one', async () => {
    renderApp('/g/wga/apply?from=ABCD1234', handlers([BASE], { recruiter: { name: 'Kat', active: true } }));
    await screen.findByRole('region', { name: 'Phoenix' });
    await waitFor(() => expect(savedRecruiter('wga')).toBe('abcd1234'));
  });

  it('leaves an earlier code alone when the new one is switched off', async () => {
    rememberRecruiter('wga', 'goodgood');
    renderApp('/g/wga/apply?from=offoffoff', handlers([BASE], { recruiter: { name: 'Kat', active: false } }));
    await screen.findByRole('region', { name: 'Phoenix' });
    expect(savedRecruiter('wga')).toBe('goodgood');
  });
});

describe('a team apply page', () => {
  it('shows the team, what it asks for and who it wants', async () => {
    renderApp('/g/wga/apply/phoenix', handlers([BASE, TICKET]));
    expect(await screen.findByRole('heading', { name: 'Phoenix', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Item level 265+ on the character you apply with')).toBeInTheDocument();
    expect(screen.getByText('14-day trial before a full spot')).toBeInTheDocument();
    expect(screen.getByText('Restoration Shaman')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Apply' })).toBeInTheDocument();
    // A guild-level page: the shell must not treat Phoenix as the team being viewed.
    expect(screen.getByRole('button', { name: /Choose a team/ })).toBeInTheDocument();
  });

  it('is not found for a team that is not listed', async () => {
    renderApp('/g/wga/apply/nobody', handlers([BASE]));
    expect(await screen.findByRole('heading', { name: /not found/i })).toBeInTheDocument();
  });
});
