import { useState } from 'react';
import { DataState } from '../components/DataState';
import { useStatus } from '../components/Status';
import { errorMessage } from '../lib/errors';
import { TEAM_RANK_LABELS } from '../guildsettings/useMembers';
import { useSetTeamGrid, useTeamGrid, type TeamGrid, type TeamGridRank } from './useRanks';
import '../guildsettings/guildsettings.css';

const RANKS: TeamGridRank[] = ['raider', 'assistant', 'officer'];

// Every switch the grid shows, in the grid's order. "Claim and edit own
// character" stays off this list until the database asks for it: the switch
// would do nothing.
const GROUPS: { name: string; rows: { permission: string; label: string; hint?: string }[] }[] = [
  {
    name: 'Everyone',
    rows: [
      {
        permission: 'edit_own_wishlist',
        label: 'Edit own wishlist',
        hint: 'Turn off for Raiders to lock picks before a raid.'
      }
    ]
  },
  {
    name: 'Running raids',
    rows: [
      { permission: 'edit_roster', label: 'Edit roster (add, archive, main swaps)' },
      { permission: 'edit_schedule', label: 'Edit schedule and boss lineups' },
      { permission: 'see_rsvps', label: "See everyone's RSVPs and notes" },
      { permission: 'attendance', label: 'Attendance and bench' },
      { permission: 'manage_signups', label: 'Manage season signups' },
      { permission: 'view_reports', label: 'View reports' },
      { permission: 'view_loot', label: 'View wishlists, priority order and loot history', hint: 'Read-only.' }
    ]
  },
  {
    name: 'Loot',
    rows: [
      {
        permission: 'manage_loot',
        label: 'Import loot, edit priority and scoring, review received-item and M+ requests'
      },
      { permission: 'pay_boe_cuts', label: "Pay out BoE cuts for this team's finds" }
    ]
  },
  {
    name: 'Team',
    rows: [
      { permission: 'promote_assistants', label: 'Make Raiders Assistants and back' },
      { permission: 'view_team_audit_log', label: 'View the team audit log' },
      { permission: 'change_discord_settings', label: "Change the team's Discord settings" }
    ]
  }
];

const cell = (rank: TeamGridRank, permission: string) => `${rank}:${permission}`;
const SHOWN = GROUPS.flatMap((g) => g.rows.flatMap((r) => RANKS.map((rank) => ({ rank, permission: r.permission }))));

// What each team rank can do (#1653). The Team Owner changes it and Officers
// read it; the database refuses anyone else.
export function TeamGridPanel({ teamId, isOwner }: { teamId: number; isOwner: boolean }) {
  const grid = useTeamGrid(teamId);
  return (
    <section aria-labelledby="team-grid-title">
      <h3 id="team-grid-title">Rank permissions</h3>
      <p className="text-muted">
        What each rank can do on this team. The Team Owner can always do everything.
        {!isOwner && ' Only the Team Owner can change these.'}
      </p>
      <DataState query={grid} label="the team's rank permissions">
        {(saved) => <GridForm teamId={teamId} saved={saved} isOwner={isOwner} />}
      </DataState>
    </section>
  );
}

function GridForm({ teamId, saved, isOwner }: { teamId: number; saved: TeamGrid; isOwner: boolean }) {
  const { announce } = useStatus();
  const setGrid = useSetTeamGrid(teamId);
  // What the Team Owner has ticked but not saved; null when it matches what's saved.
  const [draft, setDraft] = useState<ReadonlySet<string> | null>(null);

  const savedCells = new Set(saved.on.map((r) => cell(r.rank, r.permission)));
  const defaults = new Set(saved.defaults.map((r) => cell(r.rank, r.permission)));
  const current = draft ?? savedCells;
  const changes = SHOWN.filter(
    (c) => current.has(cell(c.rank, c.permission)) !== savedCells.has(cell(c.rank, c.permission))
  ).map((c) => ({ ...c, on: current.has(cell(c.rank, c.permission)) }));
  const atDefaults = SHOWN.every(
    (c) => current.has(cell(c.rank, c.permission)) === defaults.has(cell(c.rank, c.permission))
  );

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
      <table className="rank-grid">
        <thead>
          <tr>
            <th scope="col">What they can do</th>
            {RANKS.map((rank) => (
              <th key={rank} scope="col" className="rank-grid-col">
                {TEAM_RANK_LABELS[rank]}
              </th>
            ))}
            <th scope="col" className="rank-grid-col">
              {TEAM_RANK_LABELS.owner}
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
                          aria-label={`${TEAM_RANK_LABELS[rank]}: ${row.label}`}
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
              Settings
            </th>
          </tr>
          <tr>
            <th scope="row" className="rank-grid-row">
              Edit team settings and this grid
            </th>
            <td colSpan={3} className="rank-grid-cell text-muted">
              Team Owner only
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
