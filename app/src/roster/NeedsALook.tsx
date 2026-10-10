import { DataState } from '../components/DataState';
import { useStatus } from '../components/Status';
import { SwapReview } from '../characters/MainSwapReviews';
import { useTeamMainSwaps } from '../characters/useMainSwaps';
import type { LookLine } from './lookLines';
import { classColor } from './roster';
import { useSavePlayerSetting } from './usePlayerSettings';

// One box above the roster for everything waiting on an officer (#1360):
// trials ready to promote, main swap requests (#631), and new raiders with no
// wishlist. One line per person, and nothing at all when nothing is waiting.
// Officers only; the page does not mount it for anyone else.
export function NeedsALook({ teamId, lines }: { teamId: number; lines: LookLine[] }) {
  const swaps = useTeamMainSwaps(teamId, true);
  const waiting = swaps.isSuccess ? swaps.data : [];
  const count = lines.length + waiting.length;

  return (
    <>
      {swaps.isError && (
        <DataState query={swaps} label="main swaps">
          {() => null}
        </DataState>
      )}
      {count > 0 && (
        <section className="card needs-a-look" aria-labelledby="needs-a-look-title">
          <h2 id="needs-a-look-title" className="card-title">
            Needs a look <span className="text-muted">({count})</span>
          </h2>
          <ul className="look-list">
            {lines
              .filter((l) => l.promote)
              .map((l) => (
                <Line key={l.key} line={l} teamId={teamId} />
              ))}
            {waiting.map((row) => (
              <SwapReview key={row.id} row={row} teamId={teamId} />
            ))}
            {lines
              .filter((l) => !l.promote)
              .map((l) => (
                <Line key={l.key} line={l} teamId={teamId} />
              ))}
          </ul>
        </section>
      )}
    </>
  );
}

function Line({ line, teamId }: { line: LookLine; teamId: number }) {
  const { announce } = useStatus();
  const save = useSavePlayerSetting(teamId);
  const promote = () =>
    save.mutate(
      { playerId: line.playerId, change: { kind: 'flag', flag: 'is_trial', value: false } },
      { onSuccess: () => announce('success', `${line.name} is now a raider.`) }
    );

  return (
    <li className="look-row">
      <p className="look-line">
        <strong style={{ color: classColor(line.className) }}>{line.name}</strong>{' '}
        <span className="look-text">{line.text}</span>
      </p>
      {line.promote && (
        <button type="button" className="button" onClick={promote} disabled={save.isPending}>
          Promote to raider
        </button>
      )}
      {save.isError && (
        <p className="form-error" role="alert">
          That did not go through: {save.error.message}
        </p>
      )}
    </li>
  );
}
