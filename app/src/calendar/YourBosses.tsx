import { useId } from 'react';
import { useTeam } from '../data/address';
import { bothQueries } from '../data/query';
import type { PlayerRow } from '../roster/roster';
import type { RaidNight } from './calendar';
import { useClassSpecs } from '../characters/useMainSwaps';
import {
  lineupRaids,
  nightPlans,
  picksOf,
  placesOf,
  PLAN_LABELS,
  yourBosses,
  type PickedCharacter,
  type Plan
} from './lineup';
import { useEncounters, useNightPlan } from './useCalendar';

// "Your bosses tonight" on a raid night (#1216, boards C and D): the bosses a
// raider is in for, set by their officers. Nothing shows on a night with no
// boss lineup, so teams that don't plan by boss see no change. `className`
// places it: the night page renders it twice, above everything on a phone and
// above Heads up on a computer, and shows one. A Heroic into Mythic night
// has one card per half (#1688).
export function YourBosses({ night, me, className }: { night: RaidNight; me: PlayerRow; className: string }) {
  const halves = nightPlans(night);
  return (
    <>
      {halves.map((half) => (
        <YourHalf key={half} night={night} me={me} className={className} half={half} named={halves.length > 1} />
      ))}
    </>
  );
}

function YourHalf({
  night,
  me,
  className,
  half,
  named
}: {
  night: RaidNight;
  me: PlayerRow;
  className: string;
  half: Plan;
  named: boolean;
}) {
  const team = useTeam();
  const id = useId();
  const data = bothQueries(useNightPlan(team.id, night.date, half), useEncounters());
  const specs = useClassSpecs();
  if (!data.isSuccess) return null;
  const [plan, encounters] = data.data;
  const card = yourBosses(
    lineupRaids(encounters, plan.bosses, { fresh: false, season: null, plan: half }),
    placesOf(plan.places),
    me,
    picksOf(plan.places),
    {
      specs: new Map((specs.data ?? []).map((cs) => [cs.id, cs])),
      characters: new Map(
        plan.places.flatMap((r) => (r.character ? [[r.character.id, r.character] as [number, PickedCharacter]] : []))
      )
    }
  );
  if (!card) return null;

  return (
    <section className={`card your-bosses ${className}`} aria-labelledby={id}>
      <div className="your-bosses-head">
        <h2 id={id}>Your bosses tonight{named ? `, ${PLAN_LABELS[half]}` : ''}</h2>
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
            {/* What to bring, where it isn't their main in its usual spec (#1580). */}
            {t.play && <span className="your-boss-play">{t.play}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
