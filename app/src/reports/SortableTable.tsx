import { useState, type ReactNode } from 'react';

// A report table sorted by clicking a column header (#1359). The sorted
// header says which way through aria-sort, so a screen reader announces it
// (#440); the arrow beside it is for the eye.

export type Column<T> = {
  key: string;
  label: string;
  sortValue: (row: T) => string | number;
  render: (row: T) => ReactNode;
  // The way a first click sorts: most first for numbers worth worrying about.
  firstDir?: 1 | -1;
  numeric?: boolean;
};

export function SortableTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  initial
}: {
  caption: string;
  // The first column names the row (a th scope="row").
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  initial: { key: string; dir: 1 | -1 };
}) {
  const [sort, setSort] = useState(initial);
  const column = columns.find((c) => c.key === sort.key) ?? columns[0]!;
  const sorted = [...rows].sort((a, b) => {
    const x = column.sortValue(a);
    const y = column.sortValue(b);
    return sort.dir * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y)));
  });
  const onSort = (c: Column<T>) =>
    setSort((s) =>
      s.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: c.firstDir ?? 1 }
    );

  return (
    // Focusable so a table wider than a phone can be scrolled from the keyboard
    // (axe: scrollable-region-focusable), as the Roster's is.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div className="card roster-table-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="roster-table report-table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => {
              const on = c.key === sort.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  className={c.numeric ? 'col-num' : undefined}
                  aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
                >
                  <button type="button" className={`sort-button${on ? ' sorted' : ''}`} onClick={() => onSort(c)}>
                    {c.label}
                    <span aria-hidden="true" className="sort-arrow">
                      {on ? (sort.dir === 1 ? '↑' : '↓') : ''}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c, i) =>
                i === 0 ? (
                  <th key={c.key} scope="row" className="raider-cell">
                    {c.render(row)}
                  </th>
                ) : (
                  <td key={c.key} className={c.numeric ? 'col-num num' : undefined}>
                    {c.render(row)}
                  </td>
                )
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
