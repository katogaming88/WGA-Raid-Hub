import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers } from '../test/fakeSupabase';
import { biosChanged, draftsOf, moved, newDraft, photoProblem } from './officers';

// Editing officer bios in place (#1361): who gets Edit, what a save sends,
// and the card tools (move, remove, add from the roster, photo).

const KAT = {
  name: 'Kat',
  characterName: 'Katorri',
  pronouns: 'she/her',
  title: 'Loot officer',
  classKey: 'Warlock',
  spec: 'Demonology',
  bio: 'Runs the Hub.',
  imagePath: ''
};
const REX = { ...KAT, name: 'Rex', characterName: 'Rexx', title: 'Raid leader', classKey: 'Paladin', spec: 'Holy' };

const RAIDER = {
  id: 9,
  name_realm: 'Brightmoor-Illidan',
  nickname: 'Bright',
  is_trial: false,
  is_bench: false,
  is_rotator: false,
  tier_pieces_equipped: null,
  classes_specs: { class: 'Priest', spec: 'Holy', role: 'Heal' }
};

const person = (role: string, guildOfficer = false) => ({
  site_admin: false,
  guild_officer: guildOfficer,
  boe_manager: false,
  teams: [{ team_id: 1, team_member_id: 1, role, characters: [] }]
});

function handlers(role: string, options: { guildOfficer?: boolean; upload?: unknown } = {}): FakeHandlers {
  const base = seededHandlers();
  return seededHandlers({
    session: fakeSession({ battlenet: 'A#1', discord: { id: 'd', name: 'Ana' } }),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: 'discord-ana' };
      if (name === 'resolve_person') return { data: person(role, options.guildOfficer) };
      return base.rpc!(name, args);
    },
    from(read) {
      if (read.table === 'team_settings') return { data: { bios: [KAT, REX] } };
      if (read.table === 'site_settings') return { data: { guild_officer_bios: [KAT] } };
      if (read.table === 'players') return { data: [RAIDER] };
      return base.from!(read);
    },
    invoke: () => ({ data: options.upload ?? { success: true, url: 'https://cdn.example/kat.jpg' } })
  });
}

const TEAM = '/g/wga/t/phoenix/officers';

async function editTeam(role = 'officer') {
  const user = userEvent.setup();
  const app = renderApp(TEAM, handlers(role));
  await user.click(await screen.findByRole('button', { name: 'Edit officers' }));
  return { user, client: app.client };
}

const saved = (client: { rpcs: [string, unknown][] }, name: string) =>
  client.rpcs.filter(([n]) => n === name).map(([, args]) => args);

describe('editing Team officers', () => {
  it('is for the team’s officers only', async () => {
    renderApp(TEAM, handlers('raider'));
    expect(await screen.findByText('Kat')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit officers' })).not.toBeInTheDocument();
  });

  it('saves the whole list once something changed, trimmed', async () => {
    const { user, client } = await editTeam();
    const save = screen.getByRole('button', { name: 'Save officers' });
    expect(save).toBeDisabled();
    const title = screen.getAllByRole('textbox', { name: 'Title' })[0]!;
    await user.clear(title);
    await user.type(title, '  Loot and roster  ');
    expect(screen.getByText('You have unsaved changes.')).toBeInTheDocument();
    await user.click(save);
    await vi.waitFor(() =>
      expect(saved(client, 'set_team_officer_bios')).toEqual([
        { p_team_id: 1, p_bios: [{ ...KAT, title: 'Loot and roster' }, REX] }
      ])
    );
  });

  it('moves and removes cards', async () => {
    const { user, client } = await editTeam();
    expect(screen.getByRole('button', { name: 'Move Kat up' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Move Kat down' }));
    await user.click(screen.getByRole('button', { name: 'Remove Rex' }));
    await user.click(screen.getByRole('button', { name: 'Save officers' }));
    await vi.waitFor(() => expect(saved(client, 'set_team_officer_bios')).toEqual([{ p_team_id: 1, p_bios: [KAT] }]));
  });

  it('starts a new card from a roster raider, copied once', async () => {
    const { user, client } = await editTeam();
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Start from someone on the roster (optional)' }),
      'Bright (Brightmoor)'
    );
    await user.click(screen.getByRole('button', { name: '+ Add officer' }));
    await user.click(screen.getByRole('button', { name: 'Save officers' }));
    await vi.waitFor(() =>
      expect(saved(client, 'set_team_officer_bios')[0]).toEqual({
        p_team_id: 1,
        p_bios: [
          KAT,
          REX,
          {
            name: 'Bright',
            characterName: 'Brightmoor',
            pronouns: '',
            title: '',
            classKey: 'Priest',
            spec: 'Holy',
            bio: '',
            imagePath: ''
          }
        ]
      })
    );
  });

  it('uploads a photo onto the card', async () => {
    const { user, client } = await editTeam();
    const photo = new File(['x'], 'kat.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getAllByLabelText('Upload photo')[0]!, photo);
    expect(await screen.findByRole('img', { name: 'Kat' })).toHaveAttribute('src', 'https://cdn.example/kat.jpg');
    expect(
      client.authCalls.some(([name, args]) => name === 'invoke' && (args as unknown[])[0] === 'upload-bio-photo')
    ).toBe(true);
  });

  it('turns a photo away before sending it when it is too big', async () => {
    const { user, client } = await editTeam();
    const huge = new File([new Uint8Array(6 * 1024 * 1024)], 'big.png', { type: 'image/png' });
    await user.upload(screen.getAllByLabelText('Upload photo')[0]!, huge);
    expect(await screen.findByText('A photo must be under 5 MB.')).toBeInTheDocument();
    expect(client.authCalls.some(([name]) => name === 'invoke')).toBe(false);
  });

  it('asks before stopping with unsaved changes', async () => {
    const { user } = await editTeam();
    await user.click(screen.getAllByRole('button', { name: /^Remove / })[0]!);
    await user.click(screen.getByRole('button', { name: 'Done editing' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'Discard and stop' }));
    expect(await screen.findByRole('button', { name: 'Edit officers' })).toBeInTheDocument();
    expect(screen.getByText('Rex')).toBeInTheDocument();
  });
});

describe('editing Guild officers', () => {
  it('is for guild officers and site admins, not a team’s officers', async () => {
    renderApp('/g/wga/officers', handlers('officer'));
    expect(await screen.findByText('Kat')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit officers' })).not.toBeInTheDocument();
  });

  it('saves through the guild-wide save, with no roster to start from', async () => {
    const user = userEvent.setup();
    const { client } = renderApp('/g/wga/officers', handlers('raider', { guildOfficer: true }));
    await user.click(await screen.findByRole('button', { name: 'Edit officers' }));
    expect(screen.queryByRole('combobox', { name: /Start from someone/ })).not.toBeInTheDocument();
    const bio = screen.getByRole('textbox', { name: 'Bio' });
    await user.type(bio, ' Also the guild site.');
    await user.click(screen.getByRole('button', { name: 'Save officers' }));
    await vi.waitFor(() =>
      expect(saved(client, 'set_guild_officer_bios')).toEqual([
        { p_bios: [{ ...KAT, bio: 'Runs the Hub. Also the guild site.' }] }
      ])
    );
  });
});

describe('the bio editor’s rules', () => {
  it('sees a move as a change, and no change as none', () => {
    const drafts = draftsOf([KAT, REX]);
    expect(biosChanged([KAT, REX], drafts)).toBe(false);
    expect(biosChanged([KAT, REX], moved(drafts, 0, 1))).toBe(true);
    expect(moved(drafts, 0, -1)).toBe(drafts);
  });

  it('starts a blank card when nobody is picked', () => {
    expect(newDraft(3, null)).toMatchObject({ key: 3, name: '', classKey: '', spec: '' });
  });

  it('takes PNG, JPEG and WebP under 5 MB', () => {
    expect(photoProblem({ type: 'image/webp', size: 1000 })).toBeNull();
    expect(photoProblem({ type: 'image/gif', size: 1000 })).toBe('Photos must be PNG, JPEG or WebP.');
    expect(photoProblem({ type: 'image/png', size: 6 * 1024 * 1024 })).toBe('A photo must be under 5 MB.');
  });
});
