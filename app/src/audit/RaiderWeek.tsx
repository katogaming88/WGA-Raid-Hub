import { useState } from 'react';
import { DataState } from '../components/DataState';
import {
  SLOT_LABELS,
  VAULT_ROWS,
  crestCap,
  weekOf,
  mplusFigures,
  raidCounts,
  vaultFilled,
  vaultView,
  type AuditRaider,
  type VaultSlot,
  type WeekRow
} from './audit';
import { CREST_TRACKS, useCrestCaps, useItemNames } from './useAudit';

// What one raider's week looks like, drawn from the weekly row and current
// gear (#1639). The audit page opens it beside the table and My profile shows
// the same pieces as the raider's own card, so the two always agree.

export const slotLabel = (slot: string) => SLOT_LABELS[slot] ?? slot;

const slotText = (s: VaultSlot, unit: string) =>
  s.item_level != null
    ? `${s.item_level} from ${s.track} ${s.rank}`
    : `${s.left} more ${unit}${s.left === 1 ? '' : 's'}`;

// The Great Vault, drawn as the game draws it: three rows of three slots.
export function VaultGrid({ week, compact = false }: { week: WeekRow | null; compact?: boolean }) {
  const filled = vaultFilled(week?.vault);
  return (
    <div className="audit-vault">
      {!compact && (
        <p className="text-muted audit-note">
          {filled} of 9 slots filled. Worked out from Blizzard&rsquo;s data; the vault in game shows the exact items.
        </p>
      )}
      <ul className="audit-vault-rows">
        {VAULT_ROWS.map((row) => {
          const view = vaultView(week?.vault, row.id);
          return (
            <li key={row.id} className="audit-vault-row">
              <span className="audit-vault-name">{row.name}</span>
              {view.slots === null ? (
                <span className="text-muted">Not read yet</span>
              ) : (
                <ul className="audit-slots" aria-label={`${row.name}, ${view.filled} of 3 slots filled`}>
                  {view.slots.map((s, i) => (
                    <li
                      key={i}
                      className={`audit-slot${s.item_level != null ? ` track-${s.track}` : ' audit-slot-empty'}`}
                    >
                      <span className="audit-slot-level">{s.item_level ?? '–'}</span>
                      {!compact && <span className="text-muted audit-slot-text">{slotText(s, row.unit)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// "Gear to fix": what the check found, by slot, with the item named.
export function GearToFix({ raider }: { raider: AuditRaider }) {
  const issues = raider.check.problems;
  const names = useItemNames(issues.map((p) => p.item).filter((id): id is number => id != null));
  const named = names.data ?? new Map<number, string>();
  const c = raider.check;
  return (
    <div className="audit-fix">
      {issues.length === 0 ? (
        <p className="audit-ok">Nothing to fix.</p>
      ) : (
        <ul className="audit-fix-list">
          {issues.map((p, i) => (
            <li key={i}>
              <span className="audit-fix-slot">{slotLabel(p.slot)}</span>
              <span>{p.item != null ? (named.get(p.item) ?? 'Equipped item') : 'Empty slot'}</span>
              <span className={p.issue ? 'audit-bad' : 'text-muted'}>{p.problem}</span>
            </li>
          ))}
        </ul>
      )}
      {c.noEpicGem && <p className="audit-bad">No epic gem worn.</p>}
      <p className="text-muted audit-note">
        Enchants {c.enchanted}/{c.enchantable}. Gems {c.filledSockets}/{c.sockets}. Embellishments worn:{' '}
        {c.embellishments} (for information). Sparks used: {c.sparks}.
      </p>
    </div>
  );
}

export function CrestsRow({ week, seasonCode }: { week: WeekRow | null; seasonCode: string | null }) {
  const caps = useCrestCaps(seasonCode, weekOf(new Date()));
  if (!week || !week.crests_at) return <p className="text-muted">Crests not read yet.</p>;
  return (
    <DataState query={caps} label="the crest caps">
      {(rows) => (
        <ul className="audit-crests">
          {CREST_TRACKS.map((track) => {
            const have = week.crests[track] ?? 0;
            const cap = crestCap(rows, track);
            return (
              <li key={track}>
                <span className="text-muted">{track}</span>
                <span>
                  {cap === null ? (
                    <>
                      {have} <span className="text-muted">no cap</span>
                    </>
                  ) : have >= cap ? (
                    <span className="audit-ok">Capped</span>
                  ) : (
                    `${have} / ${cap}`
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </DataState>
  );
}

export function MplusRuns({ rows }: { rows: { thisWeek: WeekRow | null; lastWeek: WeekRow | null } }) {
  const [which, setWhich] = useState<'this' | 'last'>('this');
  const week = which === 'this' ? rows.thisWeek : rows.lastWeek;
  const figures = mplusFigures(week);
  const other = mplusFigures(which === 'this' ? rows.lastWeek : rows.thisWeek);
  return (
    <div className="audit-mplus">
      <div role="group" aria-label="M+ week" className="audit-switch">
        <button type="button" aria-pressed={which === 'this'} onClick={() => setWhich('this')}>
          This week
        </button>
        <button type="button" aria-pressed={which === 'last'} onClick={() => setWhich('last')}>
          Last week
        </button>
      </div>
      {figures === null ? (
        <p className="text-muted">No M+ read for this week.</p>
      ) : (
        <>
          <p className="audit-big">
            {figures.runs} {figures.runs === 1 ? 'run' : 'runs'}
            {figures.runs > 0 && <span className="text-muted"> &middot; best +{figures.best}</span>}
            {other && (
              <span className="text-muted">
                {' '}
                &middot; {which === 'this' ? 'last week' : 'this week'} {other.runs}
              </span>
            )}
          </p>
          {week && week.mplus_runs.length > 0 && (
            <p>
              {week.mplus_runs.map((r, i) => (
                <span key={i} className="audit-run">
                  +{r.level}
                  {!r.timed && <span className="text-muted"> (not timed)</span>}
                </span>
              ))}
            </p>
          )}
          <p className="text-muted audit-note">Blizzard lists only the best run of each dungeon.</p>
        </>
      )}
    </div>
  );
}

export function RaidLine({ week }: { week: WeekRow | null }) {
  const raid = raidCounts(week);
  return <>{raid === null ? '–' : `H ${raid.heroic} · M ${raid.mythic}`}</>;
}

// The whole week for one raider: the opened row on the audit page.
export function RaiderWeek({
  raider,
  seasonCode,
  updated
}: {
  raider: AuditRaider;
  seasonCode: string | null;
  // When the raider was last read, as the page words it ("2 h ago").
  updated: string;
}) {
  const { thisWeek, lastWeek } = raider;
  const newest = thisWeek ?? lastWeek;
  return (
    <div className="audit-week">
      <section aria-labelledby={`fix-${raider.id}`}>
        <h3 id={`fix-${raider.id}`} className="audit-h">
          Gear to fix
        </h3>
        <GearToFix raider={raider} />
      </section>
      <section aria-labelledby={`vault-${raider.id}`}>
        <h3 id={`vault-${raider.id}`} className="audit-h">
          Great Vault so far
        </h3>
        <VaultGrid week={thisWeek} />
      </section>
      <section aria-labelledby={`crests-${raider.id}`}>
        <h3 id={`crests-${raider.id}`} className="audit-h">
          Crests earned this season
        </h3>
        <CrestsRow week={newest} seasonCode={seasonCode} />
      </section>
      <section aria-labelledby={`mplus-${raider.id}`}>
        <h3 id={`mplus-${raider.id}`} className="audit-h">
          M+ runs
        </h3>
        <MplusRuns rows={{ thisWeek, lastWeek }} />
      </section>
      <p className="text-muted audit-note">
        From Blizzard, updated {updated}. Bonus rolls, crests on hand and the vault pick come later, from the Raid Hub
        addon.
      </p>
    </div>
  );
}
