import { useTeam } from '../data/address';
import { usePageCan } from '../auth/access';
import { DataState } from '../components/DataState';
import { useStatus } from '../components/Status';
import { errorMessage } from '../lib/errors';
import {
  useSetTeamRank,
  useTeamMemberRanks,
  type SettableTeamRank,
  type TeamMemberRank,
  type TeamRank
} from './useRanks';
import '../guildsettings/guildsettings.css';
import './settings.css';

const LABELS: Record<TeamRank, string> = {
  owner: 'Team Owner',
  officer: 'Officer',
  assistant: 'Assistant',
  raider: 'Raider'
};

// What the viewer may set this rank to: the Team Owner anything but Team
// Owner, and anyone with promote_assistants between Raider and Assistant.
// Empty means the rank is plain text. set_team_rank() is the real check.
export function rankChoices(rank: TeamRank, teamOwner: boolean, promotes: boolean): SettableTeamRank[] {
  if (rank === 'owner') return [];
  if (teamOwner) return ['officer', 'assistant', 'raider'];
  if (promotes && rank !== 'officer') return ['assistant', 'raider'];
  return [];
}

// Settings > Ranks (#1651): who holds which rank on the team. The team's rank
// permissions grid (#1653) belongs here too.
export function RanksSettingsPage() {
  const team = useTeam();
  const ranks = useTeamMemberRanks(team.id);
  return (
    <section className="page settings-page" aria-labelledby="page-title">
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
  const setRank = useSetTeamRank(teamId);
  const teamOwner = rows.some((m) => m.is_you && m.rank === 'owner');
  const promotes = can('promoteAssistants');
  return (
    <div className="members-table-wrap">
      <table className="members-table">
        <thead>
          <tr>
            <th scope="col">Member</th>
            <th scope="col">Rank</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const choices = rankChoices(m.rank, teamOwner, promotes);
            return (
              <tr key={m.team_member_id}>
                <th scope="row">{m.display_name}</th>
                <td>
                  {choices.length === 0 ? (
                    LABELS[m.rank]
                  ) : (
                    <select
                      className="select members-rank ranks-select"
                      aria-label={`Team rank for ${m.display_name}`}
                      value={m.rank}
                      disabled={setRank.isPending}
                      onChange={(e) => {
                        const rank = e.target.value as SettableTeamRank;
                        setRank.mutate(
                          { teamMemberId: m.team_member_id, rank },
                          {
                            onSuccess: () => announce('success', `${m.display_name} is now ${LABELS[rank]}.`),
                            onError: (err) =>
                              announce('error', `Could not change ${m.display_name}: ${errorMessage(err)}`)
                          }
                        );
                      }}
                    >
                      {choices.map((r) => (
                        <option key={r} value={r}>
                          {LABELS[r]}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
