import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { DataState } from '../components/DataState';
import { useTeam } from '../data/address';
import {
  ROLE_LABELS,
  ROLE_ORDER,
  classColor,
  summarize,
  summaryLine,
  toIncoming,
  toRoster,
  type Raider,
  type Role,
  type RoleGroup,
  type RosterSummary
} from './roster';
import { useIncomingRoster, useRosterGear, useRosterPlayers, useSignupSeason } from './useRoster';
import './roster.css';

// Two reads that only make sense together, shown through one DataState: loading
// until both land, an error (with one Retry for both) if either fails.
function useBoth<A, B>(a: UseQueryResult<A>, b: UseQueryResult<B>): UseQueryResult<[A, B]> {
  if (a.isSuccess && b.isSuccess) return { ...a, data: [a.data, b.data] } as UseQueryResult<[A, B]>;
  const failed = a.isError ? a : b.isError ? b : null;
  const refetch = () => Promise.all([a.refetch(), b.refetch()]);
  if (failed)
    return { ...failed, refetch, isFetching: a.isFetching || b.isFetching } as unknown as UseQueryResult<[A, B]>;
  return { ...(a.isPending ? a : b), refetch } as unknown as UseQueryResult<[A, B]>;
}

type Filter = Role | 'All';

export function RosterPage() {
  const team = useTeam();
  const current = useBoth(useRosterPlayers(team.id), useRosterGear(team.id));
  const incoming = useBoth(useIncomingRoster(team.id), useSignupSeason(team.id));
  const [tab, setTab] = useState<'current' | 'incoming'>('current');

  const incomingGroups = incoming.isSuccess ? toIncoming(incoming.data[0]) : [];
  const hasIncoming = incomingGroups.length > 0;
  const showing = hasIncoming ? tab : 'current';

  return (
    <section className="page roster-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">Roster</h1>
        {current.isSuccess && (
          <p className="text-muted page-subtitle">{summaryLine(summarize(toRoster(...current.data)))}</p>
        )}
      </div>

      {hasIncoming && (
        <RosterTabs
          selected={showing}
          onSelect={setTab}
          incomingLabel={
            incoming.data![1] ? `${incoming.data![1]} Roster (Tentative)` : 'Next Season Roster (Tentative)'
          }
        />
      )}

      <div
        id="roster-panel-current"
        role={hasIncoming ? 'tabpanel' : undefined}
        aria-labelledby={hasIncoming ? 'roster-tab-current' : undefined}
        hidden={showing !== 'current'}
      >
        <DataState query={current} label="the roster">
          {([players, gear]) => <CurrentRoster groups={toRoster(players, gear)} />}
        </DataState>
      </div>

      {hasIncoming && (
        <div
          id="roster-panel-incoming"
          role="tabpanel"
          aria-labelledby="roster-tab-incoming"
          hidden={showing !== 'incoming'}
        >
          <IncomingRoster groups={incomingGroups} />
        </div>
      )}

      {incoming.isError && (
        <DataState query={incoming} label="next season’s roster">
          {() => null}
        </DataState>
      )}
    </section>
  );
}

// Tabs with arrow-key movement between them (#439).
function RosterTabs({
  selected,
  onSelect,
  incomingLabel
}: {
  selected: 'current' | 'incoming';
  onSelect: (tab: 'current' | 'incoming') => void;
  incomingLabel: string;
}) {
  const tabs = [
    { id: 'current' as const, label: 'Current Roster' },
    { id: 'incoming' as const, label: incomingLabel }
  ];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    onSelect(tabs[next]!.id);
    refs.current[next]?.focus();
  };
  return (
    <div className="roster-tabs" role="tablist" aria-label="Which roster">
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`roster-tab-${t.id}`}
          aria-controls={`roster-panel-${t.id}`}
          aria-selected={selected === t.id}
          tabIndex={selected === t.id ? 0 : -1}
          className="roster-tab"
          onClick={() => onSelect(t.id)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function CurrentRoster({ groups }: { groups: RoleGroup[] }) {
  const [filter, setFilter] = useState<Filter>('All');
  const summary = summarize(groups);
  const shown = filter === 'All' ? groups : groups.filter((g) => g.role === filter);

  if (groups.length === 0) {
    return (
      <div className="card placeholder">
        <p>No one is on this team’s roster yet.</p>
      </div>
    );
  }

  return (
    <div className="roster-layout">
      <div className="roster-main">
        <div className="role-filter" role="group" aria-label="Show role">
          {(['All', ...ROLE_ORDER] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              className="role-filter-option"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {f === 'All' ? 'Everyone' : ROLE_LABELS[f]}
            </button>
          ))}
        </div>
        <RosterTable groups={shown} caption="Current roster" details />
      </div>
      <RosterSummaryPanel summary={summary} />
    </div>
  );
}

function IncomingRoster({ groups }: { groups: RoleGroup[] }) {
  const total = groups.reduce((n, g) => n + g.raiders.length, 0);
  return (
    <div className="roster-main">
      <h2 className="section-title">
        {total} Pending Raider{total === 1 ? '' : 's'}
      </h2>
      <p className="text-muted">Approved signups for next season. Not final until the season starts.</p>
      <RosterTable groups={groups} caption="Next season’s tentative roster" details={false} />
    </div>
  );
}

function RosterTable({ groups, caption, details }: { groups: RoleGroup[]; caption: string; details: boolean }) {
  const columns = details ? 4 : 1;
  return (
    <div className="card roster-table-wrap">
      <table className="roster-table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Raider</th>
            {details && (
              <>
                <th scope="col" className="col-num">
                  Item level
                </th>
                <th scope="col">Tier</th>
                <th scope="col">
                  <span className="visually-hidden">Status</span>
                </th>
              </>
            )}
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.role}>
            <tr className="role-row">
              <th scope="rowgroup" colSpan={columns}>
                <span className="role-name">{group.label}</span>{' '}
                <span className="role-count num">{group.raiders.length}</span>
              </th>
            </tr>
            {group.raiders.map((raider) => (
              <RosterRow key={raider.key} raider={raider} details={details} />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function RosterRow({ raider, details }: { raider: Raider; details: boolean }) {
  return (
    <tr>
      <th scope="row" className="raider-cell">
        <span className="raider-name" style={{ color: classColor(raider.className) }}>
          {raider.name}
        </span>
        {raider.character && <span className="raider-character">{raider.character}</span>}
        <span className="raider-spec">
          {raider.spec} {raider.className}
        </span>
      </th>
      {details && (
        <>
          <td className="col-num num">
            {raider.itemLevel === null ? (
              <span className="text-dim" title="No gear synced from Blizzard yet">
                <span aria-hidden="true">–</span>
                <span className="visually-hidden">Not synced</span>
              </span>
            ) : (
              raider.itemLevel.toFixed(1)
            )}
          </td>
          <td>
            <TierPieces count={raider.tierPieces} />
          </td>
          <td className="status-cell">
            {raider.statuses.map((s) => (
              <span key={s} className={`status-tag status-${s.toLowerCase()}`}>
                {s}
              </span>
            ))}
          </td>
        </>
      )}
    </tr>
  );
}

// Pips for the look, the number for everyone (#442: never color alone).
function TierPieces({ count }: { count: number | null }) {
  if (count === null) {
    return (
      <span className="text-dim">
        <span aria-hidden="true">–</span>
        <span className="visually-hidden">Not synced</span>
      </span>
    );
  }
  return (
    <span className="tier">
      <span className="tier-pips" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className={i < count ? 'tier-pip on' : 'tier-pip'} />
        ))}
      </span>
      <span className="num tier-count">{count}/5</span>
    </span>
  );
}

function RosterSummaryPanel({ summary }: { summary: RosterSummary }) {
  const compositionId = useId();
  const itemLevelId = useId();
  const armorId = useId();
  return (
    <aside className="roster-side" aria-label="Roster summary">
      <section className="card side-card" aria-labelledby={compositionId}>
        <h2 id={compositionId} className="side-title">
          Composition
        </h2>
        <dl className="side-list">
          {summary.roles.map((r) => (
            <div key={r.role}>
              <dt>{r.label}</dt>
              <dd className="num">{r.count}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="card side-card" aria-labelledby={itemLevelId}>
        <h2 id={itemLevelId} className="side-title">
          Item level
        </h2>
        {summary.averageItemLevel === null ? (
          <p className="text-muted side-note">No gear synced yet.</p>
        ) : (
          <dl className="side-list">
            <div>
              <dt>Average</dt>
              <dd className="num">{summary.averageItemLevel.toFixed(1)}</dd>
            </div>
            {summary.lowest && (
              <div>
                <dt>Lowest, {summary.lowest.name}</dt>
                <dd className="num">{summary.lowest.itemLevel.toFixed(1)}</dd>
              </div>
            )}
            {summary.withoutGear > 0 && (
              <div>
                <dt>Not synced</dt>
                <dd className="num">{summary.withoutGear}</dd>
              </div>
            )}
          </dl>
        )}
      </section>
      <section className="card side-card" aria-labelledby={armorId}>
        <h2 id={armorId} className="side-title">
          Armor types
        </h2>
        <dl className="side-list">
          {summary.armor.map((a) => (
            <div key={a.type}>
              <dt>{a.type}</dt>
              <dd className="num">{a.count}</dd>
            </div>
          ))}
        </dl>
      </section>
    </aside>
  );
}
