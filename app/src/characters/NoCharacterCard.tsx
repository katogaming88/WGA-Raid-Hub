import { useState } from 'react';
import { DataState } from '../components/DataState';
import { useTeam } from '../data/address';
import { useTouchScreen } from '../lib/device';
import { useNames } from '../roster/useNames';
import { classColor } from '../roster/roster';
import { useOpenAltsPicker } from './AltsPicker';
import { AddCharacterDialog } from './AddCharacterDialog';
import { CharacterIcon } from './CharacterIcon';
import type { SavedCharacter } from './characters';
import { useMySavedCharacters } from './useCharacters';
import './characters.css';

// The profile of someone on the team with no roster character (#1464): their
// Member, the characters they have imported, and the way onto the roster.
export function NoCharacterCard({ teamMemberId }: { teamMemberId: number }) {
  const team = useTeam();
  const names = useNames(team.id);
  const saved = useMySavedCharacters();
  const openPicker = useOpenAltsPicker();
  const touch = useTouchScreen();
  const [adding, setAdding] = useState<SavedCharacter | null>(null);
  const member = names.data?.find((n) => n.team_member_id === teamMemberId)?.label ?? null;

  return (
    <section className="card profile-card characters-card" aria-labelledby="characters-title">
      <div className="characters-head">
        <h2 id="characters-title" className="card-title">
          {member ?? 'Characters'}
        </h2>
        {openPicker && !touch && (
          <button type="button" className="button" onClick={openPicker}>
            Import characters
          </button>
        )}
      </div>
      <p>You don’t have a character on {team.name} yet.</p>
      <DataState query={saved} label="your characters">
        {(rows) =>
          rows.length === 0 ? (
            <p className="text-muted card-note characters-empty">
              {touch
                ? 'Importing characters works on a computer.'
                : 'Import your characters, then add one to the roster.'}
            </p>
          ) : (
            <ul className="characters-list" aria-label="Your characters">
              {rows.map((c) => (
                <li key={c.id} className="character-row character-row-own">
                  <CharacterIcon className={c.class_name} spec={c.spec_name} />
                  <span className="character-text">
                    <span
                      className="character-name"
                      style={{ color: c.class_name ? classColor(c.class_name) : undefined }}
                    >
                      {c.name}
                    </span>
                    <span className="character-sub">
                      {c.realm}
                      {c.spec_name && ` · ${c.spec_name}`}
                    </span>
                  </span>
                  <span className="num character-level">{c.item_level ?? '–'}</span>
                  <button type="button" className="button button-small character-ask" onClick={() => setAdding(c)}>
                    Add character to roster
                  </button>
                </li>
              ))}
            </ul>
          )
        }
      </DataState>
      {adding && <AddCharacterDialog character={adding} onClose={() => setAdding(null)} />}
    </section>
  );
}
