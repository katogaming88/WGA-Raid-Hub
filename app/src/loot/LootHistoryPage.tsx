import { useId, useState } from 'react';
import { DataState } from '../components/DataState';
import { ItemLink } from '../components/ItemLink';
import { itemLinkData } from '../profile/lootPriority';
import { useTeam } from '../data/address';
import { awardDate } from '../lib/dates';
import { SortableTable, type Column } from '../reports/SortableTable';
import {
  choices,
  filterDrops,
  itemName,
  NO_FILTERS,
  rollup,
  type HistoryDrop,
  type HistoryFilters,
  type Rollup,
  type TokenFamily
} from './lootHistory';
import { useLootHistory } from './useLootHistory';
import '../roster/roster.css';
import '../reports/reports.css';
import './loot-history.css';

type View = 'item' | 'boss' | 'season' | 'drops';

const VIEWS: { value: View; label: string; column?: string; by?: (d: HistoryDrop) => string }[] = [
  { value: 'item', label: 'By item', column: 'Item', by: itemName },
  { value: 'boss', label: 'By boss', column: 'Boss', by: (d) => d.boss || 'Unknown boss' },
  { value: 'season', label: 'By season', column: 'Season', by: (d) => d.season || 'No season' },
  { value: 'drops', label: 'Every drop' }
];

const FAMILIES: { value: TokenFamily; label: string }[] = [
  { value: '', label: 'Any item' },
  { value: 'tokens', label: 'Every tier token' },
  { value: 'Cloth', label: 'Cloth tier tokens' },
  { value: 'Leather', label: 'Leather tier tokens' },
  { value: 'Mail', label: 'Mail tier tokens' },
  { value: 'Plate', label: 'Plate tier tokens' }
];

// Loot history (#814): the team's loot, every season, counted. No player
// column, filter or rollup anywhere (#279): it counts items, not raiders.
export function LootHistoryPage() {
  const team = useTeam();
  const history = useLootHistory(team.id);
  const [filters, setFilters] = useState<HistoryFilters>(NO_FILTERS);
  const [view, setView] = useState<View>('item');
  const set = (key: keyof HistoryFilters) => (value: string) => setFilters((f) => ({ ...f, [key]: value }));

  return (
    <section className="page loot-history-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">Loot history</h1>
        <p className="text-muted page-subtitle">Every item the team has handed out, counted. Pick what to count.</p>
      </div>
      <DataState query={history} label="the loot history">
        {({ drops, tokenIds }) => {
          const shown = filterDrops(drops, filters, tokenIds);
          const { by, column, label } = VIEWS.find((v) => v.value === view)!;
          return (
            <>
              <div className="report-filters">
                <div className="field">
                  <label className="field-label" htmlFor="lh-item">
                    Item name
                  </label>
                  <input
                    id="lh-item"
                    className="input"
                    type="search"
                    value={filters.item}
                    onChange={(e) => set('item')(e.target.value)}
                  />
                </div>
                <Pick label="Tier tokens" value={filters.family} onChange={set('family')} options={FAMILIES} />
                <Pick
                  label="Season"
                  value={filters.season}
                  onChange={set('season')}
                  all="Every season"
                  options={choices(drops, (d) => d.season).reverse()}
                />
                <Pick
                  label="Track"
                  value={filters.track}
                  onChange={set('track')}
                  all="Every track"
                  options={choices(drops, (d) => d.track)}
                />
                <Pick
                  label="Boss"
                  value={filters.boss}
                  onChange={set('boss')}
                  all="Every boss"
                  options={choices(drops, (d) => d.boss)}
                />
                <Pick
                  label="Slot"
                  value={filters.slot}
                  onChange={set('slot')}
                  all="Every slot"
                  options={choices(drops, (d) => d.items?.slot)}
                />
                <Pick
                  label="Armor type"
                  value={filters.armor}
                  onChange={set('armor')}
                  all="Every armor type"
                  options={choices(drops, (d) => d.items?.armor_type)}
                />
                <div className="field">
                  <label className="field-label" htmlFor="lh-from">
                    From
                  </label>
                  <input
                    id="lh-from"
                    className="input"
                    type="date"
                    value={filters.from}
                    onChange={(e) => set('from')(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="lh-to">
                    To
                  </label>
                  <input
                    id="lh-to"
                    className="input"
                    type="date"
                    value={filters.to}
                    onChange={(e) => set('to')(e.target.value)}
                  />
                </div>
              </div>
              <div className="loot-history-summary">
                <p className="loot-history-count" aria-live="polite">
                  <strong>{shown.length}</strong> {shown.length === 1 ? 'drop' : 'drops'}
                </p>
                <Pick
                  label="Show"
                  value={view}
                  onChange={(v) => setView(v as View)}
                  options={VIEWS.map(({ value, label }) => ({ value, label }))}
                />
                {filters !== NO_FILTERS && (
                  <button type="button" className="button" onClick={() => setFilters(NO_FILTERS)}>
                    Clear filters
                  </button>
                )}
              </div>
              {shown.length === 0 ? (
                <div className="card placeholder">
                  <p>{drops.length ? 'Nothing dropped that matches.' : 'No loot imported yet.'}</p>
                </div>
              ) : by ? (
                <RollupTable
                  key={view}
                  rows={rollup(shown, by)}
                  column={column!}
                  linked={view === 'item'}
                  caption={`Drops ${label.toLowerCase()}`}
                />
              ) : (
                <DropsTable drops={shown} />
              )}
            </>
          );
        }}
      </DataState>
    </section>
  );
}

function Pick({
  label,
  value,
  onChange,
  options,
  all
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: (string | { value: string; label: string })[];
  all?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {all && <option value="">{all}</option>}
        {options.map((o) =>
          typeof o === 'string' ? (
            <option key={o} value={o}>
              {o}
            </option>
          ) : (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          )
        )}
      </select>
    </div>
  );
}

function RollupTable({
  rows,
  column,
  caption,
  linked
}: {
  rows: Rollup[];
  column: string;
  caption: string;
  linked: boolean;
}) {
  const columns: Column<Rollup>[] = [
    {
      key: 'key',
      label: column,
      sortValue: (r) => r.key,
      render: (r) => (linked ? <ItemLink link={itemLinkData(r.sample.items)}>{r.key}</ItemLink> : r.key)
    },
    { key: 'count', label: 'Dropped', sortValue: (r) => r.count, render: (r) => r.count, numeric: true, firstDir: -1 },
    { key: 'last', label: 'Last drop', sortValue: (r) => r.last, render: (r) => awardDate(r.last), firstDir: -1 }
  ];
  return (
    <SortableTable
      caption={caption}
      columns={columns}
      rows={rows}
      rowKey={(r) => r.key}
      initial={{ key: 'count', dir: -1 }}
    />
  );
}

function DropsTable({ drops }: { drops: HistoryDrop[] }) {
  const columns: Column<HistoryDrop>[] = [
    {
      key: 'item',
      label: 'Item',
      sortValue: itemName,
      render: (d) => <ItemLink link={itemLinkData(d.items)}>{itemName(d)}</ItemLink>
    },
    {
      key: 'date',
      label: 'Date',
      sortValue: (d) => d.awarded_at,
      render: (d) => awardDate(d.awarded_at),
      firstDir: -1
    },
    { key: 'boss', label: 'Boss', sortValue: (d) => d.boss ?? '', render: (d) => d.boss ?? '' },
    { key: 'slot', label: 'Slot', sortValue: (d) => d.items?.slot ?? '', render: (d) => d.items?.slot ?? '' },
    { key: 'track', label: 'Track', sortValue: (d) => d.track ?? '', render: (d) => d.track ?? '' },
    { key: 'season', label: 'Season', sortValue: (d) => d.season ?? '', render: (d) => d.season ?? '' }
  ];
  return (
    <SortableTable
      caption="Every drop"
      columns={columns}
      rows={drops}
      rowKey={(d) => d.id}
      initial={{ key: 'date', dir: -1 }}
    />
  );
}
