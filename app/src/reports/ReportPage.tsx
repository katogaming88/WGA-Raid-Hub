import type { ReactNode } from 'react';
import { ROLE_LABELS, ROLE_ORDER, type Role } from '../roster/roster';
// The Roster's toggle buttons (role-filter), shared rather than restyled.
import '../roster/roster.css';
import './reports.css';

// The frame every report page (#1359) shares: the title and what it shows.
export function ReportPage({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <section className="page report-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">{title}</h1>
        <p className="text-muted page-subtitle">{intro}</p>
      </div>
      {children}
    </section>
  );
}

// Everyone or one role, the Roster's role switch.
export function RoleFilter({ value, onChange }: { value: Role | null; onChange: (role: Role | null) => void }) {
  return (
    <div className="role-filter" role="group" aria-label="Show role">
      {[null, ...ROLE_ORDER].map((r) => (
        <button
          key={r ?? 'all'}
          type="button"
          className="role-filter-option"
          aria-pressed={value === r}
          onClick={() => onChange(r)}
        >
          {r ? ROLE_LABELS[r] : 'Everyone'}
        </button>
      ))}
    </div>
  );
}
