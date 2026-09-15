import { DataState } from '../components/DataState';
import { useTouchScreen } from '../lib/device';
import { classColor } from '../roster/roster';
import type { ProfilePlayer } from '../profile/useProfile';
import { useOpenAltsPicker } from './AltsPicker';
import { CharacterIcon } from './CharacterIcon';
import { altsOf } from './characters';
import { usePersonCharacters, usePersonOfPlayer } from './useCharacters';
import './characters.css';

// The profile's Characters card (#942 step 5b): the roster character first,
// tagged Raiding, then the alts the raider picked. Shown only on the raider's
// own profile and to the team's officers (Kat, 2026-09-15), which is also who
// the characters table lets read them.
export function CharactersCard({
  player,
  itemLevel,
  own
}: {
  player: ProfilePlayer;
  itemLevel: number | null;
  own: boolean;
}) {
  const person = usePersonOfPlayer(player.id, true);
  const openPicker = useOpenAltsPicker();
  const touch = useTouchScreen();
  const [character, realm = ''] = player.name_realm.split('-').map((part) => part.trim());
  const cs = player.classes_specs;

  return (
    <section className="card profile-card characters-card" aria-labelledby="characters-title">
      <div className="characters-head">
        <h2 id="characters-title" className="card-title">
          Characters
        </h2>
        {own && openPicker && !touch && (
          <button type="button" className="button" onClick={openPicker}>
            Choose alts
          </button>
        )}
      </div>
      <ul className="characters-list">
        <li className="character-row character-main">
          <CharacterIcon className={cs?.class ?? null} spec={cs?.spec ?? null} />
          <span className="character-text">
            <span className="character-name" style={{ color: cs ? classColor(cs.class) : undefined }}>
              {character}
            </span>
            <span className="character-sub">
              {realm}
              {cs && ` · ${cs.spec}`}
            </span>
          </span>
          <span className="status-tag character-tag character-tag-main">Raiding</span>
          <span className="num character-level">{itemLevel === null ? '–' : Math.round(itemLevel)}</span>
        </li>
      </ul>
      <DataState query={person} label="alts">
        {(personId) =>
          personId === null ? null : <Alts personId={personId} rosterNameRealm={player.name_realm} own={own} />
        }
      </DataState>
      {own && touch && <p className="text-muted card-note">Choosing alts works on a computer.</p>}
      <p className="characters-privacy">
        <svg className="characters-lock" viewBox="0 0 12 12" aria-hidden="true">
          <rect x="2" y="5.5" width="8" height="5.5" rx="1" fill="none" stroke="currentColor" />
          <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" fill="none" stroke="currentColor" />
        </svg>
        {own
          ? 'Only you and your team’s officers see your alts. Alts don’t count for attendance, loot or the Priority List.'
          : 'Only this raider and the team’s officers see their alts. Alts don’t count for attendance, loot or the Priority List.'}
      </p>
    </section>
  );
}

function Alts({ personId, rosterNameRealm, own }: { personId: number; rosterNameRealm: string; own: boolean }) {
  const saved = usePersonCharacters(personId);
  const touch = useTouchScreen();
  return (
    <DataState query={saved} label="alts">
      {(rows) => {
        const alts = altsOf(rows, [rosterNameRealm]);
        if (!alts.length) {
          return (
            <p className="text-muted card-note characters-empty">
              {own && !touch ? 'No alts listed yet. Choose alts to add your other characters.' : 'No alts listed.'}
            </p>
          );
        }
        return (
          <ul className="characters-list" aria-label="Alts">
            {alts.map((alt) => (
              <li key={alt.id} className="character-row">
                <CharacterIcon className={alt.class_name} spec={alt.spec_name} />
                <span className="character-text">
                  <span
                    className="character-name"
                    style={{ color: alt.class_name ? classColor(alt.class_name) : undefined }}
                  >
                    {alt.name}
                  </span>
                  <span className="character-sub">
                    {alt.realm}
                    {alt.spec_name && ` · ${alt.spec_name}`}
                  </span>
                </span>
                <span className="status-tag character-tag">Alt</span>
                <span className="num character-level">{alt.item_level ?? '–'}</span>
              </li>
            ))}
          </ul>
        );
      }}
    </DataState>
  );
}
