import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { DataState } from '../components/DataState';
import { useTeam } from '../data/address';
import { localTimeZoneNote } from '../lib/dates';
import { useCurrentSeason } from '../profile/useProfile';
import { classColor } from '../roster/roster';
import {
  TIER_SLOT_LABELS,
  VAULT_ROWS,
  ago,
  buildAudit,
  groupRaiders,
  ilvlOf,
  mplusFigures,
  needsAttention,
  vaultView,
  weekOf,
  type AuditRaider,
  type GroupBy,
  type IlvlMode,
  type WhichWeek
} from './audit';
import { RaidLine, RaiderWeek } from './RaiderWeek';
import { useAuditData } from './useAudit';
import './audit.css';

const GROUPS: { id: GroupBy; label: string }[] = [
  { id: 'role', label: 'Role' },
  { id: 'armor', label: 'Armor' },
  { id: 'class', label: 'Class' },
  { id: 'none', label: 'None' }
];

// Audit (#1639, #1261): every raider's week on one page, for everyone on the
// team. Gear, tier and item level are always as of the last sync; the week
// switch changes the Great Vault, M+ and raid columns.
export function AuditPage() {
  const team = useTeam();
  const season = useCurrentSeason(team.id);
  const code = season.isSuccess ? season.data.code : null;
  const data = useAuditData(team.id, code);
  const [which, setWhich] = useState<WhichWeek>('this');
  const [group, setGroup] = useState<GroupBy>('role');
  const [mode, setMode] = useState<IlvlMode>('highest');
  const [params, setParams] = useSearchParams();
  const open = params.get('raider');
  const [now] = useState(() => new Date());

  return (
    <section className="page audit-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">Audit</h1>
        <p className="text-muted page-subtitle">
          Everyone&rsquo;s gear, Great Vault and weekly runs, from Blizzard&rsquo;s data.
        </p>
      </div>
      <DataState query={season} label="the season">
        {() => (
          <DataState query={data} label="the audit">
            {(audit) => {
              const raiders = buildAudit(audit, which, now);
              const hasRule = audit.vaultRule !== null;
              const attention = needsAttention(raiders, hasRule);
              const need = raiders.filter((r) => r.issues > 0).length;
              const opened = raiders.find((r) => r.code === open) ?? null;
              const week = which === 'this' ? weekOf(now) : null;
              return (
                <>
                  <div className="audit-toolbar">
                    <p className="audit-summary">
                      {week ? `Week of ${week} · ` : 'Last week · '}
                      {raiders.length} raiders · {need} need a look
                    </p>
                    <div role="group" aria-label="Week" className="audit-switch">
                      <button type="button" aria-pressed={which === 'this'} onClick={() => setWhich('this')}>
                        This week
                      </button>
                      <button type="button" aria-pressed={which === 'last'} onClick={() => setWhich('last')}>
                        Last week
                      </button>
                    </div>
                  </div>

                  <section aria-labelledby="attention-title" className="card audit-attention">
                    <h2 id="attention-title" className="card-title">
                      Needs attention
                    </h2>
                    {attention.length === 0 ? (
                      <p className="audit-ok">Nothing needs a look.</p>
                    ) : (
                      <ul>
                        {attention.map((a) => (
                          <li key={a.id}>
                            <strong className={a.id === 'stale' ? 'audit-warn' : 'audit-bad'}>{a.count}</strong>{' '}
                            {a.label} <span className="text-muted">&middot; {a.who.join(', ')}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <div className="audit-controls">
                    <label>
                      <span className="text-muted">Item level </span>
                      <select value={mode} onChange={(e) => setMode(e.target.value as IlvlMode)}>
                        <option value="highest">Highest ever</option>
                        <option value="worn">Equipped now</option>
                      </select>
                    </label>
                    <div role="group" aria-label="Group by" className="audit-switch">
                      {GROUPS.map((g) => (
                        <button key={g.id} type="button" aria-pressed={group === g.id} onClick={() => setGroup(g.id)}>
                          {g.label}
                        </button>
                      ))}
                    </div>
                    <span className="text-muted audit-note">
                      {mode === 'highest'
                        ? 'Highest ever, so someone who logged out in PvP gear is not shown low.'
                        : 'What each raider wears right now.'}
                    </span>
                  </div>

                  {opened && (
                    <section className="card audit-opened" aria-labelledby="opened-title">
                      <div className="audit-opened-head">
                        <div>
                          <h2
                            id="opened-title"
                            className="audit-opened-name"
                            style={{ color: classColor(opened.className) }}
                          >
                            {opened.name}
                          </h2>
                          <p className="text-muted">
                            {opened.realm} &middot; {opened.spec} {opened.className}
                            {opened.highestIlvl != null && <> &middot; ilvl {Math.round(opened.highestIlvl)}</>}
                          </p>
                        </div>
                        <button type="button" className="button" onClick={() => setParams({}, { replace: true })}>
                          Close
                        </button>
                      </div>
                      <RaiderWeek raider={opened} seasonCode={code} updated={ago(opened.updatedAt, now)} />
                    </section>
                  )}

                  <SummaryTable
                    raiders={raiders}
                    group={group}
                    mode={mode}
                    now={now}
                    onOpen={(r) => r.code && setParams({ raider: r.code }, { replace: true })}
                  />
                  <p className="text-muted audit-note">{localTimeZoneNote()}</p>
                  <p className="text-muted audit-note">
                    Tier: M Myth, H Hero, C Champion, V Veteran, A Adventurer, – not worn. Great Vault: each bar is a
                    slot, colored by the track it offers; the number is the best item level. Issues adds up missing
                    enchants, empty sockets, no epic gem and, if the team set one, the vault rule.
                  </p>
                </>
              );
            }}
          </DataState>
        )}
      </DataState>
    </section>
  );
}

function SummaryTable({
  raiders,
  group,
  mode,
  now,
  onOpen
}: {
  raiders: AuditRaider[];
  group: GroupBy;
  mode: IlvlMode;
  now: Date;
  onOpen: (r: AuditRaider) => void;
}) {
  const groups = groupRaiders(raiders, group, mode);
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div className="card audit-table-wrap" tabIndex={0} role="region" aria-label="Audit summary">
      <table className="audit-table">
        <thead>
          <tr>
            <th scope="col">Raider</th>
            <th scope="col" title="Missing enchants, empty sockets, no epic gem and below the vault rule, added up">
              Issues
            </th>
            <th scope="col" className="col-num">
              Ilvl
            </th>
            <th scope="col" className="col-num">
              M+ rating
            </th>
            <th scope="col" className="col-num">
              Sparks
            </th>
            {TIER_SLOT_LABELS.map((l) => (
              <th key={l} scope="col" className="col-tier">
                {l}
              </th>
            ))}
            <th scope="col">Enchants</th>
            <th scope="col">Gems</th>
            {VAULT_ROWS.map((r) => (
              <th key={r.id} scope="col">
                {r.name}
              </th>
            ))}
            <th scope="col">M+ runs</th>
            <th scope="col">Bosses</th>
            <th scope="col">Updated</th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.label}>
            {group !== 'none' && (
              <tr className="audit-group">
                <th scope="rowgroup" colSpan={2}>
                  {g.label} <span className="text-dim">({g.raiders.length})</span>
                </th>
                <td colSpan={20}>
                  <span className="text-muted">avg ilvl {g.avg ?? '–'}</span>{' '}
                  <span className={g.needLook ? 'audit-bad' : 'audit-ok'}>
                    {g.needLook ? `${g.needLook} need a look` : 'all ready'}
                  </span>
                </td>
              </tr>
            )}
            {g.raiders.map((r) => (
              <RaiderRow key={r.id} r={r} mode={mode} now={now} onOpen={onOpen} />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function RaiderRow({
  r,
  mode,
  now,
  onOpen
}: {
  r: AuditRaider;
  mode: IlvlMode;
  now: Date;
  onOpen: (r: AuditRaider) => void;
}) {
  const level = ilvlOf(r, mode);
  const c = r.check;
  const m = mplusFigures(r.week);
  const worn = mode === 'highest' && r.wornIlvl != null && r.highestIlvl != null && r.wornIlvl < r.highestIlvl - 0.5;
  const checked = c.enchantable > 0 || c.sockets > 0;
  return (
    <tr>
      <th scope="row" className="audit-name">
        <button type="button" className="audit-link" onClick={() => onOpen(r)} aria-label={`Open ${r.name}`}>
          <span style={{ color: classColor(r.className) }}>{r.name}</span>
        </button>
        <span className="text-muted audit-spec">
          {r.spec} {r.className}
        </span>
      </th>
      <td className={r.issues ? 'audit-bad' : 'text-muted'}>{r.issues || '–'}</td>
      <td className="col-num">
        {level == null ? '–' : Math.round(level)}
        {worn && <span className="text-muted audit-sub">{Math.round(r.wornIlvl!)} worn</span>}
      </td>
      <td className="col-num">{r.rating == null ? '–' : Math.round(r.rating).toLocaleString('en-US')}</td>
      <td className="col-num">{c.sparks || '–'}</td>
      {r.tier.map((t) => (
        <td key={t.slot} className="col-tier">
          {t.letter ? <span className={`tier-${t.letter}`}>{t.letter}</span> : <span className="text-muted">–</span>}
        </td>
      ))}
      <td className={!checked ? 'text-muted' : c.enchanted < c.enchantable ? 'audit-bad' : 'audit-ok'}>
        {checked ? `${c.enchanted}/${c.enchantable}` : '–'}
      </td>
      <td className={!checked ? 'text-muted' : c.filledSockets < c.sockets ? 'audit-bad' : 'audit-ok'}>
        {checked ? `${c.filledSockets}/${c.sockets}` : '–'}
      </td>
      {VAULT_ROWS.map((row) => {
        const v = vaultView(r.week?.vault, row.id);
        return (
          <td key={row.id}>
            {v.slots === null ? (
              <span className="text-muted">–</span>
            ) : (
              <span
                className="audit-cell-vault"
                aria-label={`${row.name}: ${v.filled} of 3 slots${v.best ? `, best ${v.best}` : ''}`}
              >
                <span className="audit-bars" aria-hidden="true">
                  {v.slots.map((s, i) => (
                    <span key={i} className={s.item_level != null ? `track-${s.track}` : 'bar-empty'} />
                  ))}
                </span>
                {v.filled}/3 {v.best && <span className="text-muted">{v.best}</span>}
              </span>
            )}
          </td>
        );
      })}
      <td>{m === null ? '–' : m.runs ? `${m.runs} · best +${m.best}` : 'None'}</td>
      <td>
        <RaidLine week={r.week} />
      </td>
      <td className={r.stale ? 'audit-warn' : 'text-muted'}>{ago(r.updatedAt, now)}</td>
    </tr>
  );
}
