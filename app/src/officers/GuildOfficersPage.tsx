import { useState } from 'react';
import { can, useAccess } from '../auth/access';
import { useGuildOfficers } from '../guild/useGuildHome';
import { DataState } from '../components/DataState';
import { bioCards } from '../guild/guild';
import { useTouchScreen } from '../lib/device';
import { BioCards } from './BioCards';
import { BiosEditor } from './BiosEditor';
import { useSaveGuildOfficers } from './useOfficers';

// Guild officers (#1102): who runs the guild as a whole, guild-wide rather
// than per team. Same read Guild home's compact officer list uses. A guild
// officer or site admin edits the cards in place (#1361), on a computer;
// there is no one team's roster here to start a card from.
export function GuildOfficersPage() {
  const access = useAccess();
  const touch = useTouchScreen();
  const bios = useGuildOfficers();
  const save = useSaveGuildOfficers();
  const [editing, setEditing] = useState(false);
  const canEdit = can(access.data, 'editGuildOfficers') && !touch;

  return (
    <section className="page officers-page" aria-labelledby="page-title">
      <div className="officers-head">
        <div className="page-header">
          <h1 id="page-title">Guild officers</h1>
          <p className="text-muted page-subtitle">Who runs the guild as a whole. Each team has its own officers too.</p>
        </div>
        {canEdit && !editing && bios.isSuccess && (
          <button type="button" className="button" onClick={() => setEditing(true)}>
            Edit officers
          </button>
        )}
      </div>
      <DataState query={bios} label="the guild officers">
        {(rows) =>
          canEdit && editing ? (
            <BiosEditor
              saved={rows}
              save={save}
              roster={null}
              what="the guild officers"
              onDone={() => setEditing(false)}
            />
          ) : rows.length ? (
            <BioCards cards={bioCards(rows)} />
          ) : (
            <p className="text-muted">No guild officers listed yet.</p>
          )
        }
      </DataState>
    </section>
  );
}
