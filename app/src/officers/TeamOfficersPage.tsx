import { useState } from 'react';
import { can, useAccess } from '../auth/access';
import { DataState } from '../components/DataState';
import { useTeam } from '../data/address';
import { bioCards, type OfficerBio } from '../guild/guild';
import { useTouchScreen } from '../lib/device';
import { useRosterPlayers } from '../roster/useRoster';
import { BioCards } from './BioCards';
import { BiosEditor } from './BiosEditor';
import { useSaveTeamOfficers, useTeamOfficers } from './useOfficers';

// Team officers (#1102): who runs this team, in the officer editor's order.
// The team's officers edit the cards in place (#1361), on a computer.
export function TeamOfficersPage() {
  const team = useTeam();
  const access = useAccess();
  const touch = useTouchScreen();
  const bios = useTeamOfficers(team.id);
  const [editing, setEditing] = useState(false);
  const canEdit = can(access.data, 'viewOfficerTools', team.id) && !touch;

  return (
    <section className="page officers-page" aria-labelledby="page-title">
      <div className="officers-head">
        <div className="page-header">
          <h1 id="page-title">Team officers</h1>
          <p className="text-muted page-subtitle">Who runs this team's raids and loot.</p>
        </div>
        {canEdit && !editing && bios.isSuccess && (
          <button type="button" className="button" onClick={() => setEditing(true)}>
            Edit officers
          </button>
        )}
      </div>
      <DataState query={bios} label="the team officers">
        {(rows) =>
          canEdit && editing ? (
            <TeamEditor saved={rows} onDone={() => setEditing(false)} />
          ) : rows.length ? (
            <BioCards cards={bioCards(rows)} />
          ) : (
            <p className="text-muted">No team officers listed yet.</p>
          )
        }
      </DataState>
    </section>
  );
}

function TeamEditor({ saved, onDone }: { saved: OfficerBio[]; onDone: () => void }) {
  const team = useTeam();
  const save = useSaveTeamOfficers(team.id);
  const roster = useRosterPlayers(team.id);
  return <BiosEditor saved={saved} save={save} roster={roster.data ?? []} what="the team officers" onDone={onDone} />;
}
