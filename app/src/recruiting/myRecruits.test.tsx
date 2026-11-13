import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers } from '../test/fakeSupabase';
import { links, summary, type MyRecruit } from './myRecruits';

// My recruits (#1550): the links, the people list and notes, the page being
// hidden from anyone who is not a recruiter, and the Members tab's switch.

const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms - 60_000).toISOString();

const PEOPLE: MyRecruit[] = [
  {
    id: 1,
    team_id: 1,
    guild_id: 1,
    team_name: 'Phoenix',
    name: 'Katorri',
    name_realm: 'Katorri-Stormrage',
    class_name: 'Warlock',
    spec_name: 'Demonology',
    status: 'waiting_on_officers',
    applied_at: ago(2 * HOUR),
    closed_at: null,
    trial_starts_on: null,
    trial_ends_on: null,
    notes: [{ id: 9, body: 'Great attitude.', created_at: ago(HOUR) }]
  },
  {
    id: 2,
    team_id: 1,
    guild_id: 1,
    team_name: 'Phoenix',
    name: null,
    name_realm: 'Lumenae-Stormrage',
    class_name: 'Shaman',
    spec_name: 'Restoration',
    status: 'joined',
    applied_at: ago(24 * HOUR * 60),
    closed_at: null,
    trial_starts_on: null,
    trial_ends_on: null,
    notes: []
  }
];

const TEAM = { team_id: 1, name: 'Phoenix', slug: 'phoenix', taking_applications: true, spots: [] };

function signedIn(opts: { code: string | null }): FakeHandlers & { writes: [string, Record<string, unknown>][] } {
  const base = seededHandlers();
  const writes: [string, Record<string, unknown>][] = [];
  return {
    ...base,
    writes,
    session: fakeSession({ discord: { id: 'discord-x', name: 'Someone' } }),
    rpc(name, args) {
      switch (name) {
        case 'current_discord_id':
          return { data: 'discord-x' };
        case 'resolve_person':
          return {
            data: {
              site_admin: false,
              guild_officer: false,
              boe_manager: false,
              teams: [{ team_id: 1, team_member_id: 1, role: 'raider', characters: [] }]
            }
          };
        case 'my_recruiter_code':
          return { data: opts.code };
        case 'my_recruits':
          return { data: PEOPLE };
        case 'team_recruiting_page':
          return { data: [TEAM] };
        case 'add_recruit_note':
          writes.push([name, args]);
          return { data: 1 };
        default:
          return base.rpc!(name, args);
      }
    }
  };
}

describe('the rules behind the page', () => {
  it('builds one link per team, then the guild page, all with the same code', () => {
    expect(links('https://x.test', 'wga', 'r8t2r8t2', [{ name: 'Phoenix', slug: 'phoenix' }])).toEqual([
      { label: 'Phoenix', url: 'https://x.test/g/wga/apply/phoenix?from=r8t2r8t2' },
      { label: 'Not sure yet', url: 'https://x.test/g/wga/apply?from=r8t2r8t2' }
    ]);
  });

  it('counts this month and joined', () => {
    const month = (d: string) => ({ ...PEOPLE[0]!, applied_at: `${d}T15:00:00Z` });
    const list = [
      month('2026-11-03'),
      month('2026-11-10'),
      month('2026-10-30'),
      { ...month('2026-09-01'), status: 'joined' as const }
    ];
    expect(summary(list, '2026-11-13')).toBe('2 this month \u00b7 1 joined');
  });
});

describe('My recruits', () => {
  it('shows the links, copies one, and lists the people with their notes', async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (t: string) => (copied.push(t), Promise.resolve()) }
    });
    renderApp('/g/wga/me/recruits', signedIn({ code: 'r8t2r8t2' }));
    const phoenix = await screen.findByLabelText('Phoenix link');
    expect(phoenix).toHaveValue(`${window.location.origin}/g/wga/apply/phoenix?from=r8t2r8t2`);
    expect(screen.getByLabelText('Not sure yet link')).toHaveValue(
      `${window.location.origin}/g/wga/apply?from=r8t2r8t2`
    );
    await userEvent.click(screen.getByRole('button', { name: /Copys*Phoenix link/ }));
    await waitFor(() => expect(copied).toEqual([(phoenix as HTMLInputElement).value]));

    expect(screen.getByText(/1 this month/)).toBeInTheDocument();
    const kat = screen.getByText('Katorri', { selector: 'b' }).closest('li')!;
    expect(within(kat).getByText('Waiting on officers')).toBeInTheDocument();
    expect(within(kat).getByText('Great attitude.')).toBeInTheDocument();
    expect(screen.getByText('Lumenae', { selector: 'b' })).toBeInTheDocument();
  });

  it('adds a note for the person', async () => {
    const h = signedIn({ code: 'r8t2r8t2' });
    renderApp('/g/wga/me/recruits', h);
    const lumenae = (await screen.findByText('Lumenae', { selector: 'b' })).closest('li')!;
    await userEvent.click(within(lumenae).getByRole('button', { name: /Add a note/ }));
    await userEvent.type(within(lumenae).getByLabelText(/Your note for Phoenix/), 'Can do Wed/Thu.');
    await userEvent.click(within(lumenae).getByRole('button', { name: 'Save note' }));
    await waitFor(() =>
      expect(h.writes).toEqual([['add_recruit_note', { p_application_id: 2, p_body: 'Can do Wed/Thu.' }]])
    );
  });

  it('is hidden from someone who is not a recruiter', async () => {
    renderApp('/g/wga/me/recruits', signedIn({ code: null }));
    expect(await screen.findByText(/page you.re looking for|not found/i)).toBeInTheDocument();
    expect(screen.queryByText('Your links')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'My recruits' })).not.toBeInTheDocument();
  });

  it('shows My recruits under You for a recruiter', async () => {
    renderApp('/g/wga/t/phoenix/roster', signedIn({ code: 'r8t2r8t2' }));
    // One of the two people is waiting on officers.
    const link = await screen.findByRole('link', { name: 'My recruits, 1 waiting' });
    expect(link).toHaveAttribute('href', '/g/wga/me/recruits');
  });
});
