import { DataState } from '../components/DataState';
import { useTeam } from '../data/address';
import { bioCards } from '../guild/guild';
import { BioCards } from './BioCards';
import { useTeamOfficers } from './useOfficers';

// Team officers (#1102): who runs this team, in the officer editor's order.
export function TeamOfficersPage() {
  const team = useTeam();
  const bios = useTeamOfficers(team.id);
  return (
    <section className="page officers-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">Team officers</h1>
        <p className="text-muted page-subtitle">Who runs this team's raids and loot.</p>
      </div>
      <DataState query={bios} label="the team officers">
        {(rows) =>
          rows.length ? <BioCards cards={bioCards(rows)} /> : <p className="text-muted">No team officers listed yet.</p>
        }
      </DataState>
    </section>
  );
}
