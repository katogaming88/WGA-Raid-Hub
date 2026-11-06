import { usePageCan } from '../auth/access';
import { useStatus } from '../components/Status';
import { errorMessage } from '../lib/errors';
import { useSetTeamRank, type SettableTeamRank, type TeamRank as Rank } from './useRoster';

const LABELS: Record<Rank, string> = {
  owner: 'Team Owner',
  officer: 'Officer',
  assistant: 'Assistant',
  raider: 'Raider'
};

// What the viewer may set this rank to (#1651): the Team Owner anything but
// Team Owner, and anyone with promote_assistants between Raider and Assistant.
// Empty means the rank is plain text. set_team_rank() is the real check.
export function rankChoices(rank: Rank, teamOwner: boolean, promotes: boolean): SettableTeamRank[] {
  if (rank === 'owner') return [];
  if (teamOwner) return ['officer', 'assistant', 'raider'];
  if (promotes && rank !== 'officer') return ['assistant', 'raider'];
  return [];
}

// A member's team rank on their Roster row, officers only.
export function TeamRank({
  teamId,
  teamMemberId,
  name,
  rank,
  teamOwner
}: {
  teamId: number;
  teamMemberId: number;
  name: string;
  rank: Rank;
  teamOwner: boolean;
}) {
  const { can } = usePageCan();
  const { announce } = useStatus();
  const setRank = useSetTeamRank(teamId);
  const choices = rankChoices(rank, teamOwner, can('promoteAssistants'));
  if (choices.length === 0) return <span className="team-rank text-muted">{LABELS[rank]}</span>;
  return (
    <select
      className="select team-rank-select"
      aria-label={`Team rank for ${name}`}
      value={rank}
      disabled={setRank.isPending}
      onChange={(e) => {
        const to = e.target.value as SettableTeamRank;
        setRank.mutate(
          { teamMemberId, rank: to },
          {
            onSuccess: () => announce('success', `${name} is now ${LABELS[to]}.`),
            onError: (err) => announce('error', `Could not change ${name}: ${errorMessage(err)}`)
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
  );
}
