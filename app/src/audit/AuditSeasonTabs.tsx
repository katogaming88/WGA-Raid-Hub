import { useState } from 'react';
import { DataState } from '../components/DataState';
import {
  VAULT_ROWS,
  bestKills,
  crestCap,
  crestProgress,
  killCounts,
  mplusFigures,
  seasonBestKeys,
  vaultView,
  weekOf,
  type AuditRaider
} from './audit';
import { Name, Scroller, trackClass } from './AuditTabs';
import { CREST_TRACKS, useCrestCaps, useDungeonNames, useRaidBosses, useSeasonWeeks } from './useAudit';

// The audit's Great Vault, Raids, Dungeons and Crests views (#1641, #1261),
// laid out like the gear tabs: the same raiders, one row each.

// -- Great Vault ---------------------------------------------------------------------

export function VaultTab({ raiders }: { raiders: AuditRaider[] }) {
  // How many runs fill each slot is the season's setting, read off the slots.
  const needs = (row: (typeof VAULT_ROWS)[number]['id']) => {
    for (const r of raiders) {
      const v = vaultView(r.thisWeek?.vault, row);
      if (v.slots) return v.slots.map((x) => x.needs);
    }
    return [];
  };
  return (
    <>
      <Scroller label="Great Vault slots">
        <table className="audit-table">
          <thead>
            <tr className="audit-sections">
              <td colSpan={2} />
              {VAULT_ROWS.map((row) => (
                <th key={row.id} scope="colgroup" colSpan={3} className="sep">
                  {row.name}
                  {needs(row.id).length > 0 && (
                    <>
                      {' '}
                      &middot; {needs(row.id).join(', ')} {row.unit}s
                    </>
                  )}
                </th>
              ))}
            </tr>
            <tr>
              <th scope="col">Raider</th>
              <th scope="col">Filled</th>
              {VAULT_ROWS.flatMap((row) =>
                ['1st', '2nd', '3rd'].map((n, i) => (
                  <th key={`${row.id}${n}`} scope="col" className={`col-tier${i === 0 ? ' sep' : ''}`}>
                    {n}
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {raiders.map((r) => {
              const filled = VAULT_ROWS.reduce((n, row) => n + vaultView(r.thisWeek?.vault, row.id).filled, 0);
              const known = VAULT_ROWS.some((row) => vaultView(r.thisWeek?.vault, row.id).slots !== null);
              return (
                <tr key={r.id}>
                  <Name r={r} />
                  <td className="audit-strong">{known ? `${filled} / 9` : '–'}</td>
                  {VAULT_ROWS.flatMap((row) => {
                    const v = vaultView(r.thisWeek?.vault, row.id);
                    return [0, 1, 2].map((i) => {
                      const slot = v.slots?.[i];
                      return (
                        <td key={`${row.id}${i}`} className={`col-tier${i === 0 ? ' sep' : ''}`}>
                          {!slot ? (
                            <span className="text-muted">–</span>
                          ) : slot.item_level != null ? (
                            <span className="vault-box">
                              <span className={`gear-ilvl ${trackClass(slot.track ?? null)}`}>{slot.item_level}</span>
                              <span className="text-muted audit-sub">{slot.track}</span>
                            </span>
                          ) : (
                            <span className="vault-box vault-box-empty">
                              <span className="text-muted">–</span>
                              <span className="text-muted audit-sub">
                                {slot.left} more {row.unit}
                                {slot.left === 1 ? '' : 's'}
                              </span>
                            </span>
                          )}
                        </td>
                      );
                    });
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Scroller>
      <p className="text-muted audit-note">
        Each box is a vault slot: the item level it offers, colored by track. A dashed box is not filled yet, with what
        is left to fill it. Worked out from Blizzard&rsquo;s data; the vault in game shows the exact items. This week
        only.
      </p>
    </>
  );
}

// -- Raids ----------------------------------------------------------------------------

type Period = 'this' | 'last' | 'season';
const PERIODS: { id: Period; label: string }[] = [
  { id: 'this', label: 'This week' },
  { id: 'last', label: 'Last week' },
  { id: 'season', label: 'Whole season' }
];

function Periods({ value, onChange, options }: { value: Period; onChange: (p: Period) => void; options: Period[] }) {
  return (
    <div role="group" aria-label="Period" className="audit-switch">
      {PERIODS.filter((p) => options.includes(p.id)).map((p) => (
        <button key={p.id} type="button" aria-pressed={value === p.id} onClick={() => onChange(p.id)}>
          {p.label}
        </button>
      ))}
    </div>
  );
}

const LETTER: Record<string, string> = { mythic: 'M', heroic: 'H', normal: 'N' };

export function RaidsTab({
  raiders,
  seasonCode,
  seasonStart
}: {
  raiders: AuditRaider[];
  seasonCode: string | null;
  seasonStart: string | null;
}) {
  const [period, setPeriod] = useState<Period>('this');
  const bosses = useRaidBosses(seasonCode);
  const keys = raiders.map((r) => r.key).filter((k): k is string => !!k);
  const weeks = useSeasonWeeks(keys, seasonStart);
  return (
    <>
      <div className="audit-toolbar">
        <span className="text-muted">Highest difficulty killed, per boss</span>
        <Periods value={period} onChange={setPeriod} options={['this', 'last', 'season']} />
      </div>
      <DataState query={bosses} label="the raid bosses">
        {(list) => (
          <DataState query={weeks} label="the season's weeks">
            {(seasonWeeks) => {
              const ids = list.map((b) => b.encounter_id);
              const weeksOf = (r: AuditRaider) => {
                if (period === 'this') return r.thisWeek ? [r.thisWeek] : [];
                if (period === 'last') return r.lastWeek ? [r.lastWeek] : [];
                return seasonWeeks.filter((w) => w.name_realm_key === r.key);
              };
              return (
                <Scroller label="Raid kills by boss">
                  <table className="audit-table">
                    <thead>
                      <tr>
                        <th scope="col">Raider</th>
                        {list.map((b, i) => (
                          <th
                            key={b.encounter_id}
                            scope="col"
                            className={`col-tier boss-head${i === 0 ? ' sep' : ''}`}
                            title={b.name}
                          >
                            {b.name}
                          </th>
                        ))}
                        <th scope="col" className="sep">
                          Normal
                        </th>
                        <th scope="col">Heroic</th>
                        <th scope="col">Mythic</th>
                      </tr>
                    </thead>
                    <tbody>
                      {raiders.map((r) => {
                        const kills = weeksOf(r);
                        const best = bestKills(kills);
                        const counts = killCounts(kills, ids);
                        const count = (n: number) => (n ? `${n} / ${ids.length}` : '–');
                        return (
                          <tr key={r.id}>
                            <Name r={r} />
                            {list.map((b, i) => {
                              const d = best.get(b.encounter_id);
                              return (
                                <td key={b.encounter_id} className={`col-tier${i === 0 ? ' sep' : ''}`}>
                                  {d ? (
                                    <span className={`kill kill-${d}`}>
                                      {LETTER[d]}
                                      <span className="visually-hidden"> {d}</span>
                                    </span>
                                  ) : (
                                    <span className="text-muted">–</span>
                                  )}
                                </td>
                              );
                            })}
                            <td className="sep">{count(counts.normal)}</td>
                            <td>{count(counts.heroic)}</td>
                            <td className="audit-strong">{count(counts.mythic)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </Scroller>
              );
            }}
          </DataState>
        )}
      </DataState>
      <p className="text-muted audit-note">
        M Mythic, H Heroic, N Normal, – not killed. The counts on the right are bosses killed on that difficulty. Raid
        Finder kills are not shown.
      </p>
    </>
  );
}

// -- Dungeons -------------------------------------------------------------------------

export function DungeonsTab({ raiders, seasonStart }: { raiders: AuditRaider[]; seasonStart: string | null }) {
  const [period, setPeriod] = useState<Period>('this');
  const names = useDungeonNames();
  const keys = raiders.map((r) => r.key).filter((k): k is string => !!k);
  const weeks = useSeasonWeeks(keys, seasonStart);
  return (
    <>
      <div className="audit-toolbar">
        <span className="text-muted">Runs in the week, and the best key in each dungeon this season</span>
        <Periods value={period} onChange={setPeriod} options={['this', 'last']} />
      </div>
      <DataState query={names} label="the dungeon names">
        {(dungeonNames) => (
          <DataState query={weeks} label="the season's weeks">
            {(seasonWeeks) => {
              const bests = new Map(
                raiders.map((r) => [r.id, seasonBestKeys(seasonWeeks.filter((w) => w.name_realm_key === r.key))])
              );
              // The season's pool is the dungeons its runs name, so there is no list to keep.
              const ids = [...new Set([...bests.values()].flatMap((m) => [...m.keys()]))].sort((a, b) =>
                (dungeonNames.get(a) ?? String(a)).localeCompare(dungeonNames.get(b) ?? String(b))
              );
              return (
                <Scroller label="Mythic plus by dungeon">
                  <table className="audit-table">
                    <thead>
                      <tr className="audit-sections">
                        <td />
                        <th scope="colgroup" colSpan={3} className="sep">
                          {period === 'this' ? 'This week' : 'Last week'}
                        </th>
                        <th scope="colgroup" colSpan={Math.max(1, ids.length)} className="sep">
                          Best key this season
                        </th>
                      </tr>
                      <tr>
                        <th scope="col">Raider</th>
                        <th scope="col" className="col-num sep">
                          Rating
                        </th>
                        <th scope="col" className="col-num">
                          Runs
                        </th>
                        <th scope="col">Best</th>
                        {ids.map((id, i) => (
                          <th
                            key={id}
                            scope="col"
                            className={`col-tier boss-head${i === 0 ? ' sep' : ''}`}
                            title={dungeonNames.get(id)}
                          >
                            {dungeonNames.get(id) ?? `Dungeon ${id}`}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {raiders.map((r) => {
                        const week = period === 'this' ? r.thisWeek : r.lastWeek;
                        const m = mplusFigures(week);
                        const best = bests.get(r.id)!;
                        return (
                          <tr key={r.id}>
                            <Name r={r} />
                            <td className="col-num sep audit-strong">
                              {week?.mplus_rating == null ? '–' : Math.round(week.mplus_rating).toLocaleString('en-US')}
                            </td>
                            <td className={`col-num ${m && m.runs === 0 ? 'audit-bad' : ''}`}>{m ? m.runs : '–'}</td>
                            <td>{m && m.runs ? `+${m.best}` : '–'}</td>
                            {ids.map((id, i) => {
                              const k = best.get(id);
                              return (
                                <td key={id} className={`col-tier${i === 0 ? ' sep' : ''}`}>
                                  {k ? (
                                    <span className={k.timed ? 'audit-strong' : 'text-muted'}>
                                      +{k.level}
                                      <span className="visually-hidden">{k.timed ? ' in time' : ' over time'}</span>
                                    </span>
                                  ) : (
                                    <span className="text-muted">–</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </Scroller>
              );
            }}
          </DataState>
        )}
      </DataState>
      <p className="text-muted audit-note">
        Rating is Blizzard&rsquo;s Mythic+ rating that week. Best key: bold if finished in time, grey if over time.
        Blizzard lists only the best run of each dungeon each week, so Runs can read lower than the keys done.
      </p>
    </>
  );
}

// -- Crests ---------------------------------------------------------------------------

export function CrestsTab({ raiders, seasonCode }: { raiders: AuditRaider[]; seasonCode: string | null }) {
  const caps = useCrestCaps(seasonCode, weekOf(new Date()));
  return (
    <>
      <p className="text-muted audit-note">
        Crests earned this season against this week&rsquo;s cap, which grows each week. Some types have no cap, and
        Blizzard usually lifts every cap in a later patch.
      </p>
      <DataState query={caps} label="the crest caps">
        {(rows) => (
          <Scroller label="Crests earned">
            <table className="audit-table">
              <thead>
                <tr>
                  <th scope="col">Raider</th>
                  {CREST_TRACKS.map((t, i) => {
                    const cap = crestCap(rows, t);
                    return (
                      <th key={t} scope="col" className={`${i === 0 ? 'sep ' : ''}ilvl-${t}`}>
                        {t}
                        <span className="text-muted audit-sub">{cap === null ? 'no cap' : `cap ${cap}`}</span>
                      </th>
                    );
                  })}
                  <th scope="col" className="sep">
                    On hand
                  </th>
                </tr>
              </thead>
              <tbody>
                {raiders.map((r) => {
                  const week = r.thisWeek ?? r.lastWeek;
                  return (
                    <tr key={r.id}>
                      <Name r={r} />
                      {CREST_TRACKS.map((t, i) => {
                        if (!week?.crests_at) {
                          return (
                            <td key={t} className={i === 0 ? 'sep' : undefined}>
                              <span className="text-muted">–</span>
                            </td>
                          );
                        }
                        const cap = crestCap(rows, t);
                        const p = crestProgress(week.crests[t] ?? 0, cap);
                        return (
                          <td key={t} className={i === 0 ? 'sep' : undefined}>
                            <span className="crest-cell">
                              {p.kind !== 'uncapped' && (
                                <span className="crest-bar" aria-hidden="true">
                                  <span className={`crest-fill fill-${t}`} style={{ width: `${p.pct}%` }} />
                                </span>
                              )}
                              {p.kind === 'capped' ? (
                                <span className="audit-ok audit-strong">Capped</span>
                              ) : p.kind === 'open' ? (
                                `${p.earned} / ${cap}`
                              ) : (
                                <>
                                  {p.earned} <span className="text-muted">no cap</span>
                                </>
                              )}
                            </span>
                          </td>
                        );
                      })}
                      <td className="sep text-muted">from the addon, later</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Scroller>
        )}
      </DataState>
      <p className="text-muted audit-note">
        Crests on hand (unspent) only the game knows; they come with the Raid Hub addon (#1444).
      </p>
    </>
  );
}
