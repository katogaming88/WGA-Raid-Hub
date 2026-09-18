import { useId } from 'react';
import { useTeam } from '../data/address';
import { bothQueries } from '../data/query';
import type { PlayerRow } from '../roster/roster';
import type { RaidNight } from './calendar';
import { lineupRaids, placesOf, yourBosses } from './lineup';
import { useEncounters, useNightPlan } from './useCalendar';

// "Your bosses tonight" on a raid night (#1216, boards C and D): the bosses a
// raider is in for, set by their officers. Nothing shows on a night with no
// boss lineup, so teams that don't plan by boss see no change. `className`
// places it: the night page renders it twice, above everything on a phone and
// above Heads up on a computer, and shows one.
export function YourBosses({ night, me, className }: { night: RaidNight; me: PlayerRow; className: string }) {
  const team = useTeam();
  const id = useId();
  const data = bothQueries(useNightPlan(team.id, night.date), useEncounters());
  if (!data.isSuccess) return null;
  const [plan, encounters] = data.data;
  const card = yourBosses(
    lineupRaids(encounters, plan.bosses, { fresh: false, season: null }),
    placesOf(plan.places),
    me
  );
  if (!card) return null;

  return (
    <section className={`card your-bosses ${className}`} aria-labelledby={id}>
      <div className="your-bosses-head">
        <h2 id={id}>Your bosses tonight</h2>
        <span className="text-dim your-bosses-by" data-final={!card.notFinal}>
          {card.notFinal ? 'Not final yet' : 'Set by your officers'}
        </span>
      </div>
      <p>{card.summary}</p>
      {card.notFinal && <p className="text-muted your-bosses-note">{card.notFinal}</p>}
      <ol className="your-bosses-tiles">
        {card.tiles.map((t) => (
          <li key={t.n} className={`your-boss${t.in ? ' is-in' : ''}`}>
            <span className="your-boss-n text-muted">Boss {t.n}</span>
            <span className="your-boss-name">{t.name}</span>
            <span className="your-boss-word">{t.in ? 'In' : 'Sitting out'}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
