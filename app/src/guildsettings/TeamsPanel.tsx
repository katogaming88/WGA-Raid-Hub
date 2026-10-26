import { useId, useRef, useState } from 'react';
import { DataState } from '../components/DataState';
import { Dialog } from '../components/Dialog';
import { useStatus } from '../components/Status';
import { useAddress, useGuildTeams, type GuildTeamRow } from '../data/address';
import { errorMessage } from '../lib/errors';
import { NewTeamDialog } from './NewTeamDialog';
import { useSetTeamArchived, useSetTeamUnlisted, useUpdateTeam } from './useGuildSettings';

type Editing = { kind: 'rename' | 'address' | 'archive'; team: GuildTeamRow };

// The Teams tab of Guild settings (#1644): every team of the guild, archived
// and unlisted ones included, each with its address and what a guild officer
// can do to it. Archiving keeps the team, greyed out; it is never a delete.
export function TeamsPanel() {
  const { guild } = useAddress();
  const teams = useGuildTeams(guild.id);
  const { announce } = useStatus();
  const setArchived = useSetTeamArchived();
  const setUnlisted = useSetTeamUnlisted();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [adding, setAdding] = useState(false);

  const fail = (what: string) => (error: Error) => announce('error', `Could not ${what}: ${errorMessage(error)}`);

  return (
    <>
      <div className="guildsettings-head">
        <div className="page-header">
          <h1 id="page-title">Teams</h1>
          <p className="text-muted page-subtitle">
            Add, rename and archive your guild's teams. An unlisted team stays off the team switcher for anyone not on
            it, but still opens by its address.
          </p>
        </div>
        <button type="button" className="button button-primary" onClick={() => setAdding(true)}>
          New team
        </button>
      </div>
      <DataState query={teams} label="the guild's teams">
        {(rows) => (
          <ul className="guildsettings-list">
            {rows.map((team) => {
              const archived = team.archived_at !== null;
              return (
                <li key={team.id} className="card guildsettings-row" data-archived={archived}>
                  <div className="guildsettings-team">
                    <span className="guildsettings-name">{team.name}</span>
                    {archived && <span className="text-muted"> (archived)</span>}
                    {team.unlisted && <span className="text-muted"> - Unlisted</span>}
                    <div className="text-muted">
                      /g/{guild.key}/t/{team.slug}
                    </div>
                  </div>
                  <label className="guildsettings-switch">
                    <input
                      type="checkbox"
                      checked={team.unlisted}
                      disabled={archived || setUnlisted.isPending}
                      onChange={(e) =>
                        setUnlisted.mutate(
                          { teamId: team.id, unlisted: e.target.checked },
                          { onError: fail(`change ${team.name}`) }
                        )
                      }
                    />
                    Unlisted<span className="visually-hidden">: {team.name}</span>
                  </label>
                  <button type="button" className="button" onClick={() => setEditing({ kind: 'rename', team })}>
                    Rename <span className="visually-hidden">{team.name}</span>
                  </button>
                  <button type="button" className="button" onClick={() => setEditing({ kind: 'address', team })}>
                    Change address <span className="visually-hidden">of {team.name}</span>
                  </button>
                  {archived ? (
                    <button
                      type="button"
                      className="button"
                      disabled={setArchived.isPending}
                      onClick={() =>
                        setArchived.mutate(
                          { teamId: team.id, archived: false },
                          {
                            onSuccess: () => announce('success', `${team.name} is back.`),
                            onError: fail(`bring back ${team.name}`)
                          }
                        )
                      }
                    >
                      Bring back <span className="visually-hidden">{team.name}</span>
                    </button>
                  ) : (
                    <button type="button" className="button" onClick={() => setEditing({ kind: 'archive', team })}>
                      Archive <span className="visually-hidden">{team.name}</span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DataState>
      {adding && <NewTeamDialog guildId={guild.id} guildKey={guild.key} onClose={() => setAdding(false)} />}
      {editing?.kind === 'archive' ? (
        <ArchiveDialog team={editing.team} onClose={() => setEditing(null)} />
      ) : editing ? (
        <EditDialog editing={editing} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}

// Rename or Change address: update_team() takes both, so the one not being
// edited is sent as it is.
function EditDialog({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const { team, kind } = editing;
  const id = useId();
  const { announce } = useStatus();
  const update = useUpdateTeam();
  const field = kind === 'rename' ? team.name : team.slug;
  const [value, setValue] = useState(field);
  const input = useRef<HTMLInputElement>(null);
  const trimmed = value.trim();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (trimmed === field) return onClose();
    update.mutate(
      { teamId: team.id, name: kind === 'rename' ? trimmed : team.name, key: kind === 'address' ? trimmed : team.slug },
      {
        onSuccess: () => {
          announce(
            'success',
            kind === 'rename' ? `Renamed to ${trimmed}.` : `${team.name}'s address is now ${trimmed}.`
          );
          onClose();
        }
      }
    );
  };

  return (
    <Dialog
      title={kind === 'rename' ? `Rename ${team.name}` : `Change the address of ${team.name}`}
      onClose={onClose}
      busy={update.isPending}
      initialFocus={input}
    >
      <form onSubmit={onSubmit} noValidate>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-value`}>
            {kind === 'rename' ? 'Team name' : 'Address'}
          </label>
          <input
            ref={input}
            id={`${id}-value`}
            className="input"
            value={value}
            maxLength={kind === 'rename' ? 60 : 32}
            onChange={(e) => setValue(e.target.value)}
          />
          {kind === 'address' && (
            <p className="field-hint">
              2 to 32 letters, numbers and single dashes. The old address keeps working and sends people to the new one.
            </p>
          )}
        </div>
        {update.isError && (
          <p className="form-error" role="alert">
            {update.error.message}
          </p>
        )}
        <div className="dialog-actions">
          <span className="grow" />
          <button type="button" className="button" onClick={onClose} disabled={update.isPending}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={update.isPending || trimmed === ''}>
            {update.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// Archiving asks for the team's name typed in, like the Danger zone.
function ArchiveDialog({ team, onClose }: { team: GuildTeamRow; onClose: () => void }) {
  const id = useId();
  const { announce } = useStatus();
  const archive = useSetTeamArchived();
  const [typed, setTyped] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const matches = typed.trim().toLowerCase() === team.name.toLowerCase();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!matches) return;
    archive.mutate(
      { teamId: team.id, archived: true },
      {
        onSuccess: () => {
          announce('success', `${team.name} archived. It is kept, and you can bring it back.`);
          onClose();
        }
      }
    );
  };

  return (
    <Dialog title={`Archive ${team.name}`} onClose={onClose} busy={archive.isPending} initialFocus={input}>
      <form onSubmit={onSubmit} noValidate>
        <p>
          {team.name} leaves the team switcher and the guild's pages. Nothing is deleted, and you can bring it back
          later.
        </p>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-name`}>
            Type {team.name} to confirm
          </label>
          <input
            ref={input}
            id={`${id}-name`}
            className="input"
            value={typed}
            autoComplete="off"
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
        {archive.isError && (
          <p className="form-error" role="alert">
            {archive.error.message}
          </p>
        )}
        <div className="dialog-actions">
          <span className="grow" />
          <button type="button" className="button" onClick={onClose} disabled={archive.isPending}>
            Cancel
          </button>
          <button type="submit" className="button button-danger" disabled={!matches || archive.isPending}>
            {archive.isPending ? 'Archiving…' : 'Archive team'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
