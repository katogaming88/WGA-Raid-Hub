import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAccess } from '../auth/access';
import { BATTLENET, useSession } from '../auth/session';
import { Dialog } from '../components/Dialog';
import { useStatus } from '../components/Status';
import { useAddress } from '../data/address';
import { useTouchScreen } from '../lib/device';
import { errorMessage } from '../lib/errors';
import { classColor } from '../roster/roster';
import {
  linkedNotices,
  pickerRows,
  savedAlts,
  type AccountCharacter,
  type CharactersAnswer,
  type PickerRow
} from './characters';
import { CharacterIcon } from './CharacterIcon';
import { refusalStatus, useBattlenetCharacters } from './useCharacters';
import './characters.css';

// Choose alts (#942 step 5b). Opens from the profile's "Choose alts", and once
// on its own when the person comes back from connecting Battle.net (or from
// the Battle.net trip "Choose alts" makes for a fresh token). Computer-only
// (Kat, 2026-09-15), so it never opens on a phone or tablet.

const AltsPickerContext = createContext<(() => void) | null>(null);

// Null outside the provider, where there is no picker to open.
export const useOpenAltsPicker = () => useContext(AltsPickerContext);

export function AltsPickerProvider({ children }: { children: ReactNode }) {
  const { user, openAltsOnReturn, clearOpenAltsOnReturn } = useSession();
  const touch = useTouchScreen();
  const [open, setOpen] = useState(() => openAltsOnReturn && !!user?.hasBattlenet && !!user.hasDiscord && !touch);

  // Only once: a later remount (another guild's pages) does not open it again.
  useEffect(() => {
    if (openAltsOnReturn) clearOpenAltsOnReturn();
  }, [openAltsOnReturn, clearOpenAltsOnReturn]);

  const openPicker = useCallback(() => setOpen(true), []);

  return (
    <AltsPickerContext.Provider value={openPicker}>
      {children}
      {open && <AltsPicker onClose={() => setOpen(false)} />}
    </AltsPickerContext.Provider>
  );
}

function AltsPicker({ onClose }: { onClose: () => void }) {
  const { user, battlenetToken, connect, refreshBattlenet } = useSession();
  const { announce } = useStatus();
  const [leaving, setLeaving] = useState(false);

  const goTo = async (trip: () => Promise<void>, failure: string) => {
    setLeaving(true);
    try {
      await trip();
    } catch (error) {
      setLeaving(false);
      announce('error', `${failure}: ${errorMessage(error)}`);
    }
  };
  const toBattlenet = () => void goTo(refreshBattlenet, 'Could not reach Battle.net');
  const connectBattlenet = () => void goTo(() => connect(BATTLENET), 'Could not connect Battle.net');

  if (!user?.hasBattlenet) {
    return (
      <Dialog title="Choose your alts" onClose={onClose} busy={leaving}>
        <p>
          Your alts come from your Battle.net account. Connect Battle.net first, and the list opens when you’re back.
        </p>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose} disabled={leaving}>
            Cancel
          </button>
          <button type="button" className="button button-primary" onClick={connectBattlenet} disabled={leaving}>
            Connect Battle.net
          </button>
        </div>
      </Dialog>
    );
  }

  if (!battlenetToken) {
    return (
      <Dialog title="Choose your alts" onClose={onClose} busy={leaving}>
        <p>
          Battle.net needs to confirm it’s you before WGA Raid Hub can read your characters. You’ll come straight back
          here.
        </p>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose} disabled={leaving}>
            Cancel
          </button>
          <button type="button" className="button button-primary" onClick={toBattlenet} disabled={leaving}>
            Load your characters from Battle.net
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <PickerList
      token={battlenetToken}
      onClose={onClose}
      leaving={leaving}
      onBattlenet={toBattlenet}
      onConnect={connectBattlenet}
    />
  );
}

function PickerList({
  token,
  onClose,
  leaving,
  onBattlenet,
  onConnect
}: {
  token: string;
  onClose: () => void;
  leaving: boolean;
  onBattlenet: () => void;
  onConnect: () => void;
}) {
  const { teams } = useAddress();
  const access = useAccess();
  const { announce } = useStatus();
  const list = useBattlenetCharacters();
  const save = useBattlenetCharacters();
  const [answer, setAnswer] = useState<CharactersAnswer | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const saveButton = useRef<HTMLButtonElement>(null);
  const started = useRef(false);

  const teamNames = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams]);
  const rows = answer ? pickerRows(answer, teamNames) : [];
  const onATeam = access.isSuccess && access.data.teams.length > 0;

  const { mutate: read } = list;
  const load = useCallback(
    () =>
      read(
        { token },
        {
          onSuccess: (result) => {
            setAnswer(result);
            setPicked(savedAlts(pickerRows(result, new Map())));
          }
        }
      ),
    [read, token]
  );

  // Once per opening. The read also links roster matches, so it is not
  // repeated on every render or focus the way a plain read would be.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    load();
  }, [load]);

  const onSave = () =>
    save.mutate(
      { token, save: [...picked] },
      {
        onSuccess: () => {
          announce('success', picked.size ? 'Alts saved.' : 'Alts cleared.');
          onClose();
        }
      }
    );

  const busy = save.isPending || leaving;
  let body: ReactNode;
  if (list.isError) {
    body = <Refusal error={list.error} onRetry={load} onBattlenet={onBattlenet} onConnect={onConnect} busy={busy} />;
  } else if (!answer) {
    body = (
      <p className="text-muted picker-loading" role="status">
        Reading your characters from Battle.net…
      </p>
    );
  } else {
    const notices = linkedNotices(answer.roster, teamNames);
    body = (
      <>
        <p className="picker-found text-muted">
          <span className="num">{rows.length}</span> level 90 {rows.length === 1 ? 'character' : 'characters'} on your
          Battle.net account
        </p>
        {notices.length > 0 && (
          <ul className="picker-notices">
            {notices.map((notice) => (
              <li key={notice} className="picker-notice">
                <strong className="picker-linked">Linked:</strong> {notice}
              </li>
            ))}
          </ul>
        )}
        {rows.length === 0 ? (
          <p className="text-muted">No level 90 characters on this Battle.net account yet.</p>
        ) : (
          // Focusable, so the table can be scrolled from the keyboard when it is
          // wider than the dialog (axe: scrollable-region-focusable).
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          <div className="picker-table-wrap" tabIndex={0} role="region" aria-label="Your level 90 characters">
            <table className="picker-table">
              <thead>
                <tr>
                  <th scope="col">Character</th>
                  <th scope="col" className="col-num">
                    Item level
                  </th>
                  <th scope="col">On a roster</th>
                  <th scope="col">Show as</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <PickerTableRow
                    key={row.character.blizzard_id}
                    row={row}
                    alt={picked.has(row.character.blizzard_id)}
                    onATeam={onATeam}
                    disabled={busy}
                    onChange={(alt) =>
                      setPicked((current) => {
                        const next = new Set(current);
                        if (alt) next.add(row.character.blizzard_id);
                        else next.delete(row.character.blizzard_id);
                        return next;
                      })
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {save.isError && (
          <p className="picker-error" role="alert">
            Could not save your alts: {save.error.message}
          </p>
        )}
      </>
    );
  }

  return (
    <Dialog title="Choose your alts" onClose={onClose} busy={busy} wide initialFocus={saveButton}>
      <p className="picker-intro">From your Battle.net account. Pick the characters you want listed under your name.</p>
      {body}
      <div className="picker-footer">
        <span className="text-muted picker-count" aria-live="polite">
          {answer && rows.length > 0 && (
            <>
              <span className="num">{picked.size}</span> {picked.size === 1 ? 'alt' : 'alts'} selected
            </>
          )}
        </span>
        <span className="picker-buttons">
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            ref={saveButton}
            type="button"
            className="button button-primary"
            onClick={onSave}
            disabled={busy || !answer || rows.length === 0}
          >
            {save.isPending ? 'Saving…' : 'Save alts'}
          </button>
        </span>
      </div>
    </Dialog>
  );
}

function Refusal({
  error,
  onRetry,
  onBattlenet,
  onConnect,
  busy
}: {
  error: Error;
  onRetry: () => void;
  onBattlenet: () => void;
  onConnect: () => void;
  busy: boolean;
}) {
  const status = refusalStatus(error);
  const [label, action] =
    status === 401
      ? ['Sign in with Battle.net again', onBattlenet]
      : status === 409
        ? ['Connect Battle.net', onConnect]
        : status === 403
          ? [null, null]
          : ['Try again', onRetry];
  return (
    <div className="picker-refusal" role="alert">
      <p>{error.message}</p>
      {label && action && (
        <button type="button" className="button" onClick={action} disabled={busy}>
          {label}
        </button>
      )}
    </div>
  );
}

function CharacterCell({ character }: { character: AccountCharacter }) {
  return (
    <th scope="row" className="picker-character">
      <CharacterIcon className={character.class_name} spec={character.spec_name} />
      <span className="character-text">
        <span
          className="character-name"
          style={{ color: character.class_name ? classColor(character.class_name) : undefined }}
        >
          {character.name}
        </span>
        <span className="character-sub">
          {character.realm}
          {character.spec_name && ` · ${character.spec_name}`}
        </span>
      </span>
    </th>
  );
}

function PickerTableRow({
  row,
  alt,
  onATeam,
  disabled,
  onChange
}: {
  row: PickerRow;
  alt: boolean;
  onATeam: boolean;
  disabled: boolean;
  onChange: (alt: boolean) => void;
}) {
  const { character } = row;
  const itemLevel = (
    <td className="col-num num">
      {character.item_level ?? (
        <span className="text-dim" title="Blizzard did not share this character’s gear">
          <span aria-hidden="true">–</span>
          <span className="visually-hidden">Not shared</span>
        </span>
      )}
    </td>
  );
  if (row.kind === 'choose') {
    return (
      <tr>
        <CharacterCell character={character} />
        {itemLevel}
        <td className="text-dim">
          <span aria-hidden="true">–</span>
          <span className="visually-hidden">Not on a roster</span>
        </td>
        <td>
          <div className="picker-choice" role="group" aria-label={`Show ${character.name} as`}>
            <button
              type="button"
              className="picker-choice-option picker-choice-alt"
              aria-pressed={alt}
              disabled={disabled}
              onClick={() => onChange(true)}
            >
              Alt
            </button>
            <button
              type="button"
              className="picker-choice-option"
              aria-pressed={!alt}
              disabled={disabled}
              onClick={() => onChange(false)}
            >
              Skip
            </button>
          </div>
        </td>
      </tr>
    );
  }
  const [tag, tone, note] =
    row.kind === 'yours'
      ? [`${row.team} · claimed by you`, 'good', 'Your roster character']
      : row.kind === 'claimed'
        ? [
            `${row.team} · claimed by another player`,
            'warn',
            onATeam ? 'Ask your officers to check the claim' : 'Ask an officer to check the claim'
          ]
        : [`${row.team} · on the roster`, 'warn', 'Connect Discord to claim it'];
  return (
    <tr className="picker-locked">
      <CharacterCell character={character} />
      {itemLevel}
      <td>
        <span className={`status-tag picker-tag picker-tag-${tone}`}>{tag}</span>
      </td>
      <td className="picker-note">{note}</td>
    </tr>
  );
}
