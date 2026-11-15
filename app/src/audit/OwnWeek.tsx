import { useState } from 'react';
import { DataState } from '../components/DataState';
import { localTimeZoneNote } from '../lib/dates';
import { useCurrentSeason } from '../profile/useProfile';
import { ago, buildAudit, mplusFigures, weekOf } from './audit';
import { CrestsRow, RaidLine, VaultGrid, slotLabel } from './RaiderWeek';
import { useAuditData, useItemNames } from './useAudit';
import './audit.css';

// The raider's own week on My profile (#1639): what to fix before raid, then
// item level, crests, M+, raid and the Great Vault, in a column that reads on a
// phone. The same pieces and numbers as the audit page.
export function OwnWeekCard({ teamId, playerId }: { teamId: number; playerId: number }) {
  const season = useCurrentSeason(teamId);
  const code = season.isSuccess ? season.data.code : null;
  const data = useAuditData(teamId, code, [playerId]);
  const [now] = useState(() => new Date());

  return (
    <section className="card profile-card audit-own" aria-labelledby="week-title">
      <h2 id="week-title" className="card-title">
        Your week
      </h2>
      <DataState query={data} label="your week">
        {(audit) => {
          const raider = buildAudit(audit, 'this', now)[0];
          if (!raider) return <p className="text-muted">Your character is not on this team&rsquo;s roster yet.</p>;
          const todo = raider.check.problems.filter((p) => p.issue);
          return (
            <>
              <WeekTodo raider={raider} todo={todo} />
              <dl className="audit-own-facts">
                <div>
                  <dt>Item level</dt>
                  <dd>
                    {raider.highestIlvl == null ? '–' : Math.round(raider.highestIlvl)}
                    {raider.wornIlvl != null &&
                      raider.highestIlvl != null &&
                      raider.wornIlvl < raider.highestIlvl - 0.5 && (
                        <span className="text-muted"> ({Math.round(raider.wornIlvl)} worn)</span>
                      )}
                  </dd>
                </div>
                <div>
                  <dt>M+ this week</dt>
                  <dd>
                    {(() => {
                      const m = mplusFigures(raider.week);
                      return m === null ? '–' : m.runs ? `${m.runs} runs · best +${m.best}` : 'None yet';
                    })()}
                  </dd>
                </div>
                <div>
                  <dt>Raid this week</dt>
                  <dd>
                    <RaidLine week={raider.week} />
                  </dd>
                </div>
                <div>
                  <dt>M+ rating</dt>
                  <dd>{raider.rating == null ? '–' : Math.round(raider.rating).toLocaleString('en-US')}</dd>
                </div>
              </dl>
              <div>
                <h3 className="audit-h">Crests this season</h3>
                <CrestsRow week={raider.thisWeek ?? raider.lastWeek} seasonCode={code} />
              </div>
              <div>
                <h3 className="audit-h">Great Vault</h3>
                <VaultGrid week={raider.week} compact />
              </div>
              <p className="text-muted audit-note">
                From Blizzard, updated {ago(raider.updatedAt, now)}. Week of {weekOf(now)}. {localTimeZoneNote()}
              </p>
            </>
          );
        }}
      </DataState>
    </section>
  );
}

function WeekTodo({
  raider,
  todo
}: {
  raider: ReturnType<typeof buildAudit>[number];
  todo: ReturnType<typeof buildAudit>[number]['check']['problems'];
}) {
  const names = useItemNames(todo.map((p) => p.item).filter((id): id is number => id != null));
  const named = names.data ?? new Map<number, string>();
  const count = raider.issues;
  if (count === 0) return <p className="audit-ok">Nothing to fix before raid.</p>;
  return (
    <div className="audit-todo">
      <strong className="audit-bad">
        {count} {count === 1 ? 'thing' : 'things'} to fix before raid
      </strong>
      <ul>
        {todo.map((p, i) => (
          <li key={i}>
            {slotLabel(p.slot)}: {p.item != null ? (named.get(p.item) ?? 'equipped item') : 'empty'} &mdash;{' '}
            {p.problem.toLowerCase()}
          </li>
        ))}
        {raider.check.noEpicGem && <li>No epic gem worn</li>}
        {raider.belowRule.length > 0 && <li>Below the team&rsquo;s Great Vault rule</li>}
      </ul>
    </div>
  );
}
