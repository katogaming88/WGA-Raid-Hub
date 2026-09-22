import { useGuildOfficers } from '../guild/useGuildHome';
import { DataState } from '../components/DataState';
import { bioCards } from '../guild/guild';
import { BioCards } from './BioCards';

// Guild officers (#1102): who runs the guild as a whole, guild-wide rather
// than per team. Same read Guild home's compact officer list uses.
export function GuildOfficersPage() {
  const bios = useGuildOfficers();
  return (
    <section className="page officers-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">Guild officers</h1>
        <p className="text-muted page-subtitle">Who runs the guild as a whole. Each team has its own officers too.</p>
      </div>
      <DataState query={bios} label="the guild officers">
        {(rows) =>
          rows.length ? (
            <BioCards cards={bioCards(rows)} />
          ) : (
            <p className="text-muted">No guild officers listed yet.</p>
          )
        }
      </DataState>
    </section>
  );
}
