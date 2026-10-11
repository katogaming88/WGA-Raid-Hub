import { useId, type ReactNode } from 'react';
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

// Which season a report shows (#1359 part 3), by the name on the season.
export function SeasonPicker({
  seasons,
  value,
  onChange
}: {
  seasons: { code: string; name: string }[];
  value: string;
  onChange: (code: string) => void;
}) {
  const id = useId();
  return (
    <div className="field report-season">
      <label className="field-label" htmlFor={id}>
        Season
      </label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {seasons.map((s) => (
          <option key={s.code} value={s.code}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}
