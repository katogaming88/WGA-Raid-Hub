import { useId, useState } from 'react';
import { useTeam } from '../data/address';
import { DataState } from '../components/DataState';
import { formatInstant, localTimeZoneNote } from '../lib/dates';
import { filterAuditEntries, paginateAuditEntries, type AuditEntry } from './audit';
import { useAuditLog } from './useAudit';
import './settings.css';

// The officer dashboard's Audit log (#1358, #1103 row 1), ported from
// js/tabs/tab-audit.js: every action any officer feature has logged for this
// team, newest first, searchable across every visible column.
export function AuditLogPage() {
  const team = useTeam();
  const query = useAuditLog(team.id);

  return (
    <section className="page settings-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">Audit log</h1>
      </div>
      <DataState query={query} label="audit log">
        {(entries) => <AuditLogCard entries={entries} />}
      </DataState>
    </section>
  );
}

function AuditLogCard({ entries }: { entries: AuditEntry[] }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const searchId = useId();
  const filtered = filterAuditEntries(entries, search);
  const { rows, page: currentPage, totalPages } = paginateAuditEntries(filtered, page);
  const searching = search.trim() !== '';

  return (
    <div className="card settings-card">
      <div className="settings-row">
        <label className="visually-hidden" htmlFor={searchId}>
          Search by officer, action, player, or detail
        </label>
        <input
          id={searchId}
          type="search"
          className="input settings-audit-search"
          placeholder="Search by officer, action, player, or detail..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
      </div>
      <p className="text-muted" role="status">
        {!filtered.length
          ? searching
            ? 'No entries match your search.'
            : 'No audit log entries yet.'
          : `${filtered.length} entr${filtered.length === 1 ? 'y' : 'ies'}.`}
      </p>
      {!!rows.length && (
        <>
          <AuditPager page={currentPage} totalPages={totalPages} onChange={setPage} position="top" />
          <p className="text-muted">{localTimeZoneNote()}</p>
          <div style={{ overflowX: 'auto' }}>
            <table className="settings-roster-table">
              <thead>
                <tr>
                  <th className="settings-audit-time">Time</th>
                  <th>Changed By</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className="settings-audit-time">{formatInstant(e.ts)}</td>
                    <td>{e.changedBy}</td>
                    <td>{e.action}</td>
                    <td>{e.target}</td>
                    <td>{e.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <AuditPager page={currentPage} totalPages={totalPages} onChange={setPage} position="bottom" />
        </>
      )}
    </div>
  );
}

function AuditPager({
  page,
  totalPages,
  onChange,
  position
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  position: 'top' | 'bottom';
}) {
  if (totalPages <= 1) return null;
  const atStart = page === 0;
  const atEnd = page >= totalPages - 1;
  return (
    <div className="settings-row" data-audit-pager={position}>
      <button type="button" className="button" onClick={() => onChange(0)} disabled={atStart}>
        First
      </button>
      <button type="button" className="button" onClick={() => onChange(page - 1)} disabled={atStart}>
        Previous
      </button>
      <span className="text-muted">
        Page {page + 1} of {totalPages}
      </span>
      <button type="button" className="button" onClick={() => onChange(page + 1)} disabled={atEnd}>
        Next
      </button>
      <button type="button" className="button" onClick={() => onChange(totalPages - 1)} disabled={atEnd}>
        Last
      </button>
    </div>
  );
}
