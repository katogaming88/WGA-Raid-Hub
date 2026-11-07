import { useState } from 'react';
import { DataState } from '../components/DataState';
import { useStatus } from '../components/Status';
import { useAddress } from '../data/address';
import { errorMessage } from '../lib/errors';
import { useGuildGrid, useSetGuildGrid, type GridRank, type GuildGrid } from './useGuildSettings';
import { RANK_LABELS, useGuildMembers } from './useMembers';

const RANKS: GridRank[] = ['member', 'team_lead', 'admin'];

// Every switch the grid shows. Export guild data stays off this list until a
// guild export exists: the switch would do nothing (Kat, 2026-11-06).
const GROUPS: { name: string; rows: { permission: string; label: string; hint?: string }[] }[] = [
  {
    name: 'Teams',
    rows: [
      {
        permission: 'create_teams',
        label: 'Create teams',
        hint: 'Whoever creates a team becomes its Team Owner.'
      },
      { permission: 'rename_archive_teams', label: 'Rename and archive teams' },
      { permission: 'change_team_owner', label: "Change a team's Team Owner" },
      {
        permission: 'view_every_team',
        label: 'See every team (read-only)',
        hint: "Reads what an Officer reads on every team, and changes nothing. Someone on no team needs it to open the guild's pages."
      }
    ]
  },
  {
    name: 'Guild',
    rows: [
      {
        permission: 'edit_guild_profile',
        label: 'Edit guild profile (name, realm, site address)',
        hint: 'Also opens the Members and Rank permissions tabs.'
      },
      { permission: 'edit_own_bio', label: 'Edit own officer bio card' },
      { permission: 'edit_all_bios', label: "Edit everyone's officer bio cards" },
      { permission: 'view_guild_audit_log', label: 'View the guild audit log' }
    ]
  },
  {
    name: 'BoE',
    rows: [
      { permission: 'record_boe', label: 'Record BoE listings and sales' },
      {
        permission: 'pay_any_boe',
        label: "Pay any team's BoE finds",
        hint: "A backup for each team's own officers."
      },
      { permission: 'edit_boe_settings', label: 'Edit BoE payout settings' }
    ]
  }
];

const cell = (rank: GridRank, permission: string) => `${rank}:${permission}`;
const SHOWN = GROUPS.flatMap((g) => g.rows.flatMap((r) => RANKS.map((rank) => ({ rank, permission: r.permission }))));

// The Rank permissions tab of Guild settings (#1652): what each guild rank may
// do. The Owner changes it and Admins read it; the database refuses anyone else.
export function RankPermissionsPanel() {
  const { guild } = useAddress();
  const grid = useGuildGrid(guild.id);
  const members = useGuildMembers(guild.id);

  return (
    <>
      <div className="page-header">
        <h1 id="page-title">Rank permissions</h1>
        <p className="text-muted page-subtitle">
          What each guild rank can do. No guild rank can change anything inside a team it isn't on. Change someone's
          rank on the Members tab.
        </p>
      </div>
      <DataState query={members} label="your guild rank">
        {(rows) => (
          <DataState query={grid} label="the guild's rank permissions">
            {(saved) => (
              <GridForm guildId={guild.id} saved={saved} isOwner={rows.some((m) => m.is_you && m.rank === 'owner')} />
            )}
          </DataState>
        )}
      </DataState>
    </>
  );
}

function GridForm({ guildId, saved, isOwner }: { guildId: number; saved: GuildGrid; isOwner: boolean }) {
  const { announce } = useStatus();
  const setGrid = useSetGuildGrid(guildId);
  // What the Owner has ticked but not saved; null when it matches what's saved.
  const [draft, setDraft] = useState<ReadonlySet<string> | null>(null);

  const savedCells = new Set(saved.on.map((r) => cell(r.rank, r.permission)));
  const defaults = new Set(saved.defaults.map((r) => cell(r.rank, r.permission)));
  const current = draft ?? savedCells;
  const changes = SHOWN.filter((c) => {
    const key = cell(c.rank, c.permission);
    return current.has(key) !== savedCells.has(key);
  }).map((c) => ({ ...c, on: current.has(cell(c.rank, c.permission)) }));
  const atDefaults = SHOWN.every((c) => {
    const key = cell(c.rank, c.permission);
    return current.has(key) === defaults.has(key);
  });

  const toggle = (key: string) => {
    const next = new Set(current);
    if (!next.delete(key)) next.add(key);
    setDraft(next);
  };

  const save = () =>
    setGrid.mutate(
      { changes },
      {
        onSuccess: () => {
          setDraft(null);
          announce('success', 'Rank permissions saved.');
        },
        onError: (err) => announce('error', `Could not save rank permissions: ${errorMessage(err)}`)
      }
    );

  return (
    <>
      {!isOwner && <p className="text-muted">Only the Owner can change these.</p>}
      <table className="rank-grid">
        <thead>
          <tr>
            <th scope="col">What they can do</th>
            {RANKS.map((rank) => (
              <th key={rank} scope="col" className="rank-grid-col">
                {RANK_LABELS[rank]}
              </th>
            ))}
            <th scope="col" className="rank-grid-col">
              {RANK_LABELS.owner}
            </th>
          </tr>
        </thead>
        {GROUPS.map((group) => (
          <tbody key={group.name}>
            <tr>
              <th scope="rowgroup" colSpan={5} className="rank-grid-group">
                {group.name}
              </th>
            </tr>
            {group.rows.map((row) => (
              <tr key={row.permission}>
                <th scope="row" className="rank-grid-row">
                  {row.label}
                  {row.hint && <span className="text-muted rank-grid-hint">{row.hint}</span>}
                </th>
                {RANKS.map((rank) => {
                  const key = cell(rank, row.permission);
                  return (
                    <td key={rank} className="rank-grid-cell">
                      <label className="rank-grid-check">
                        <input
                          type="checkbox"
                          aria-label={`${RANK_LABELS[rank]}: ${row.label}`}
                          checked={current.has(key)}
                          disabled={!isOwner || setGrid.isPending}
                          onChange={() => toggle(key)}
                        />
                      </label>
                    </td>
                  );
                })}
                <td className="rank-grid-cell text-muted">Always</td>
              </tr>
            ))}
          </tbody>
        ))}
        <tbody>
          <tr>
            <th scope="rowgroup" colSpan={5} className="rank-grid-group">
              Ranks
            </th>
          </tr>
          <tr>
            <th scope="row" className="rank-grid-row">
              Promote and demote Admins and Team Leads, hand over ownership
            </th>
            <td colSpan={3} className="rank-grid-cell text-muted">
              Owner only
            </td>
            <td className="rank-grid-cell text-muted">Always</td>
          </tr>
        </tbody>
      </table>
      {isOwner && (
        <div className="rank-grid-bar">
          <span className="text-muted rank-grid-status">
            {changes.length === 0
              ? 'No changes.'
              : `${changes.length} ${changes.length === 1 ? 'change' : 'changes'} not saved.`}
          </span>
          <button
            type="button"
            className="button"
            disabled={atDefaults || setGrid.isPending}
            onClick={() => setDraft(defaults)}
          >
            Reset to defaults
          </button>
          <button
            type="button"
            className="button"
            disabled={changes.length === 0 || setGrid.isPending}
            onClick={() => setDraft(null)}
          >
            Discard changes
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={changes.length === 0 || setGrid.isPending}
            onClick={save}
          >
            {setGrid.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </>
  );
}
