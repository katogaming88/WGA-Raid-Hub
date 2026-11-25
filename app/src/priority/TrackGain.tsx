import { formatGain, type TrackGain } from '../sims/sims';
import { SpecMark } from '../sims/SpecMark';

// A raider's sim gain beside their mark on the Priority page (#1443 part 2):
// "+1.98%", greyed when the sim is out of date, "No sim" when they have none at
// this difficulty, and a dash when their sim didn't include the item. It is
// the roster spec's sim, always shown first with its spec icon; other specs'
// gains follow, greyed with their icons (#1916), for information only.
export function TrackGainText({ gain }: { gain: TrackGain }) {
  const className = gain.roster?.className ?? null;
  return (
    <>
      <span className="priority-gain">
        {gain.roster && <SpecMark className={className} spec={gain.roster.spec} />}
        <RosterGain gain={gain} />
      </span>
      {gain.others.map((o) => (
        <span key={`${o.className}|${o.spec}`} className="priority-gain priority-gain-other num">
          <SpecMark className={o.className} spec={o.spec} />
          {formatGain(o.pct)}
          {o.stale && <span className="visually-hidden"> (sim out of date)</span>}
        </span>
      ))}
    </>
  );
}

function RosterGain({ gain }: { gain: TrackGain }) {
  if (!gain.sim) return <span className="text-dim">No sim</span>;
  if (gain.pct === null) {
    return (
      <span className="text-dim">
        <span aria-hidden="true">–</span>
        <span className="visually-hidden">Not in their sim</span>
      </span>
    );
  }
  return (
    <span className={`num${gain.stale ? ' is-stale' : ''}${gain.pct < 0 ? ' is-down' : ''}`}>
      {formatGain(gain.pct)}
      {gain.stale && <span className="visually-hidden"> (sim out of date)</span>}
    </span>
  );
}
