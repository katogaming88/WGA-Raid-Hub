import { useEffect, useId, useRef, useState } from 'react';
import { useTeam } from '../data/address';
import { usePageCan } from '../auth/access';
import { DataState } from '../components/DataState';
import { Dialog } from '../components/Dialog';
import { useStatus } from '../components/Status';
import { errorMessage } from '../lib/errors';
import {
  useSetTeamRank,
  useTeamMemberRanks,
  useTeamRankGrid,
  type SettableTeamRank,
  type TeamMemberRank,
  type TeamRank
} from './useRanks';
import './settings.css';

const LABELS: Record<TeamRank, string> = {
  owner: 'Team Owner',
  officer: 'Officer',
  assistant: 'Assistant',
  raider: 'Raider'
};

// Highest first, with the heading each group goes under.
const GROUPS: { rank: TeamRank; heading: string }[] = [
  { rank: 'owner', heading: 'Team Owner' },
  { rank: 'officer', heading: 'Officers' },
  { rank: 'assistant', heading: 'Assistants' },
  { rank: 'raider', heading: 'Raiders' }
];

// The team grid's permissions in plain words, in the grid's order.
const CAN_DO: [permission: string, words: string][] = [
  ['own_character', 'keep their own characters'],
  ['edit_own_wishlist', 'edit their own wishlist'],
  ['edit_roster', 'edit the roster'],
  ['edit_schedule', 'edit the schedule and lineups'],
  ['see_rsvps', 'see RSVPs'],
  ['attendance', 'mark attendance and the bench'],
  ['manage_signups', 'manage signups'],
  ['view_reports', 'see reports'],
  ['view_loot', 'see wishlists, priority and loot history'],
  ['manage_loot', 'import loot and edit priority and scoring'],
  ['pay_boe_cuts', 'pay BoE cuts'],
  ['promote_assistants', 'make someone an Assistant'],
  ['view_team_audit_log', 'see the audit log'],
  ['change_discord_settings', 'change Discord settings']
];

const BELOW: Partial<Record<TeamRank, { rank: TeamRank; name: string }>> = {
  officer: { rank: 'assistant', name: 'an Assistant' },
  assistant: { rank: 'raider', name: 'a Raider' }
};

// What a rank can do on this team, from its own grid. A rank that holds all of
// the rank below it says so, rather than repeating the list.
export function rankLine(rank: TeamRank, grid: Map<TeamRank, Set<string>>): string {
  if (rank === 'owner') return 'Everything here, and makes someone an Officer.';
  const has = grid.get(rank) ?? new Set<string>();
  const below = BELOW[rank];
  const under = below && grid.get(below.rank);
  if (below && under && [...under].every((p) => has.has(p))) {
    const extra = CAN_DO.filter(([p]) => has.has(p) && !under.has(p)).map(([, words]) => words);
    return extra.length > 0
      ? `Everything ${below.name} can, and: ${extra.join(', ')}.`
      : `Everything ${below.name} can.`;
  }
  const text = CAN_DO.filter(([p]) => has.has(p))
    .map(([, words]) => words)
    .join(', ');
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}.` : 'Nothing on this team yet.';
}

// What the viewer may set this rank to: the Team Owner anything but Team
// Owner, and anyone with promote_assistants between Raider and Assistant.
// Empty means the rank is plain text. set_team_rank() is the real check.
export function rankChoices(rank: TeamRank, teamOwner: boolean, promotes: boolean): SettableTeamRank[] {
  if (rank === 'owner') return [];
  if (teamOwner) return ['officer', 'assistant', 'raider'];
  if (promotes && rank !== 'officer') return ['assistant', 'raider'];
  return [];
}

// Settings > Ranks (#1651): who holds which rank on the team: a section per rank, highest first, with its people across the width in columns. The
// team's rank permissions grid (#1653) belongs here too.
export function RanksSettingsPage() {
  const team = useTeam();
  const ranks = useTeamMemberRanks(team.id);
  return (
    <section className="page settings-page ranks-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">Ranks</h1>
        <p className="text-muted page-subtitle">
          Who holds which rank on {team.name}. The Team Owner makes someone an Officer, and Officers make someone an
          Assistant. A guild Owner or Admin changes the Team Owner.
        </p>
      </div>
      <DataState query={ranks} label="the team's ranks">
        {(rows) => <RanksTable teamId={team.id} rows={rows} />}
      </DataState>
    </section>
  );
}

function RanksTable({ teamId, rows }: { teamId: number; rows: TeamMemberRank[] }) {
  const { can } = usePageCan();
  const { announce } = useStatus();
  const grid = useTeamRankGrid(teamId);
  const setRank = useSetTeamRank(teamId);
  const searchId = useId();
  const listId = useId();
  const [search, setSearch] = useState('');
  const [confirming, setConfirming] = useState<TeamMemberRank | null>(null);
  const sections = useRef<HTMLDivElement>(null);
  // A changed rank moves the person to another section, which would lose the
  // keyboard's place, so focus follows it there.
  const refocus = useRef<number | null>(null);
  useEffect(() => {
    if (refocus.current === null || setRank.isPending) return;
    sections.current?.querySelector<HTMLSelectElement>(`select[data-member="${refocus.current}"]`)?.focus();
  }, [rows, setRank.isPending]);

  const teamOwner = rows.some((m) => m.is_you && m.rank === 'owner');
  const promotes = can('promoteAssistants');
  const term = search.trim().toLowerCase();
  const matching = rows.filter((m) => m.display_name.toLowerCase().includes(term));

  const closeDialog = () => {
    setRank.reset();
    setConfirming(null);
  };

  const save = (m: TeamMemberRank, rank: SettableTeamRank) => {
    refocus.current = m.team_member_id;
    setRank.mutate(
      { teamMemberId: m.team_member_id, rank },
      {
        onSuccess: () => {
          announce('success', `${m.display_name} is now ${LABELS[rank]}.`);
          setConfirming(null);
        },
        onError: (err) => {
          // In the dialog, the error shows there.
          if (rank !== 'officer') announce('error', `Could not change ${m.display_name}: ${errorMessage(err)}`);
        }
      }
    );
  };

  return (
    <>
      <div className="field ranks-search">
        <label className="field-label" htmlFor={searchId}>
          Search
        </label>
        <input
          id={searchId}
          type="search"
          className="input"
          placeholder="Name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {matching.length === 0 ? (
        <p className="text-muted">Nobody on the team matches that.</p>
      ) : (
        <div className="ranks-sections" ref={sections}>
          {GROUPS.map(({ rank, heading }) => {
            const members = matching.filter((m) => m.rank === rank);
            // While searching, only the sections with a match.
            if (term && members.length === 0) return null;
            return (
              <section key={rank} className="ranks-section" aria-labelledby={`${listId}-${rank}`}>
                <div className="ranks-section-head">
                  <h2 id={`${listId}-${rank}`}>
                    {heading} {members.length}
                  </h2>
                  {grid.isSuccess && <p className="text-muted">{rankLine(rank, grid.data)}</p>}
                  {grid.isError && <p className="text-muted">Couldn’t load what this rank can do.</p>}
                </div>
                {members.length === 0 && !term && <p className="text-muted">Nobody yet.</p>}
                <ul>
                  {members.map((m) => {
                    const choices = rankChoices(m.rank, teamOwner, promotes);
                    return (
                      <li key={m.team_member_id}>
                        <span className="ranks-name">
                          {m.display_name}
                          {m.is_you && <span className="text-muted"> (you)</span>}
                          {!m.signed_in && <span className="ranks-not-signed-in text-muted">Hasn’t signed in yet</span>}
                        </span>
                        {choices.length > 0 && (
                          <select
                            className="select ranks-select"
                            data-member={m.team_member_id}
                            aria-label={`Team rank for ${m.display_name}`}
                            value={m.rank}
                            disabled={setRank.isPending}
                            onChange={(e) => {
                              const to = e.target.value as SettableTeamRank;
                              if (to === 'officer') setConfirming(m);
                              else save(m, to);
                            }}
                          >
                            {choices.map((r) => (
                              <option key={r} value={r}>
                                {LABELS[r]}
                              </option>
                            ))}
                          </select>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      {confirming && (
        <Dialog title={`Make ${confirming.display_name} an Officer?`} onClose={closeDialog} busy={setRank.isPending}>
          {grid.isSuccess && <p>Officers can do this: {rankLine('officer', grid.data)}</p>}
          {setRank.isError && (
            <p className="form-error" role="alert">
              {setRank.error.message}
            </p>
          )}
          <div className="dialog-actions">
            <span className="grow" />
            <button type="button" className="button" disabled={setRank.isPending} onClick={closeDialog}>
              Cancel
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={setRank.isPending}
              onClick={() => save(confirming, 'officer')}
            >
              {setRank.isPending ? 'Saving…' : 'Make Officer'}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
