import { formatGain, type TrackGain } from '../sims/sims';

// A raider's sim gain beside their mark on the Priority page (#1443 part 2):
// "+1.98%", greyed when the sim is out of date, "No sim" when they have none at
// this difficulty, and a dash when their sim didn't include the item. It is
// the roster spec's sim; other specs' gains follow, greyed and named (#1916),
// for information only: "+2.50% Affliction +4.10%".
export function TrackGainText({ gain }: { gain: TrackGain }) {
  return (
    <>
      <RosterGain gain={gain} />
      {gain.others.map((o) => (
        <span key={o.spec} className="priority-gain priority-gain-other num">
          {o.spec} {formatGain(o.pct)}
          {o.stale && <span className="visually-hidden"> (sim out of date)</span>}
        </span>
      ))}
    </>
  );
}

function RosterGain({ gain }: { gain: TrackGain }) {
  if (!gain.sim) return <span className="priority-gain text-dim">No sim</span>;
  if (gain.pct === null) {
    return (
      <span className="priority-gain text-dim">
        <span aria-hidden="true">–</span>
        <span className="visually-hidden">Not in their sim</span>
      </span>
    );
  }
  return (
    <span className={`priority-gain num${gain.stale ? ' is-stale' : ''}${gain.pct < 0 ? ' is-down' : ''}`}>
      {formatGain(gain.pct)}
      {gain.stale && <span className="visually-hidden"> (sim out of date)</span>}
    </span>
  );
}
