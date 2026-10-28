import { useId, useRef, useState } from 'react';
import { DataState } from '../components/DataState';
import { Dialog } from '../components/Dialog';
import { useStatus } from '../components/Status';
import { useAddress } from '../data/address';
import { errorMessage } from '../lib/errors';
import {
  RANK_LABELS,
  useGuildMembers,
  useSetGuildRank,
  useTransferOwnership,
  type GuildMember,
  type GuildRank
} from './useMembers';

const MOVES: { rank: Exclude<GuildRank, 'owner'>; verb: string }[] = [
  { rank: 'admin', verb: 'Make Admin' },
  { rank: 'team_lead', verb: 'Make Team Lead' },
  { rank: 'member', verb: 'Make Member' }
];

// The Members tab of Guild settings (#1650): everyone in the guild with their
// guild rank. Admins read the list; the Owner also promotes, demotes and
// hands the guild over. The Recruiter switch joins it with #1550.
export function MembersPanel() {
  const { guild } = useAddress();
  const members = useGuildMembers(guild.id);
  const { announce } = useStatus();
  const setRank = useSetGuildRank(guild.id);
  const [handing, setHanding] = useState<GuildMember | null>(null);

  return (
    <>
      <div className="page-header">
        <h1 id="page-title">Members</h1>
        <p className="text-muted page-subtitle">
          Everyone in the guild and their guild rank. Only the Owner changes ranks or hands the guild over.
        </p>
      </div>
      <DataState query={members} label="the guild's members">
        {(rows) => {
          const isOwner = rows.some((m) => m.is_you && m.rank === 'owner');
          return (
            <ul className="guildsettings-list">
              {rows.map((m) => (
                <li key={m.person_id} className="card guildsettings-row">
                  <div className="guildsettings-team">
                    <span className="guildsettings-name">{m.display_name}</span>
                    {m.is_you && <span className="text-muted"> (you)</span>}
                    <div className="text-muted">{RANK_LABELS[m.rank]}</div>
                  </div>
                  {isOwner && m.rank !== 'owner' && (
                    <>
                      {MOVES.filter((move) => move.rank !== m.rank).map((move) => (
                        <button
                          key={move.rank}
                          type="button"
                          className="button"
                          disabled={setRank.isPending}
                          onClick={() =>
                            setRank.mutate(
                              { personId: m.person_id, rank: move.rank },
                              {
                                onSuccess: () =>
                                  announce('success', `${m.display_name} is now ${RANK_LABELS[move.rank]}.`),
                                onError: (e) =>
                                  announce('error', `Could not change ${m.display_name}: ${errorMessage(e)}`)
                              }
                            )
                          }
                        >
                          {move.verb} <span className="visually-hidden">{m.display_name}</span>
                        </button>
                      ))}
                      <button type="button" className="button" onClick={() => setHanding(m)}>
                        Hand over ownership <span className="visually-hidden">to {m.display_name}</span>
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          );
        }}
      </DataState>
      {handing && <HandOverDialog member={handing} guildId={guild.id} onClose={() => setHanding(null)} />}
    </>
  );
}

// Handing over ownership asks for the new Owner's name typed in, like
// archiving a team: only the new Owner can undo it.
function HandOverDialog({ member, guildId, onClose }: { member: GuildMember; guildId: number; onClose: () => void }) {
  const id = useId();
  const { announce } = useStatus();
  const transfer = useTransferOwnership(guildId);
  const [typed, setTyped] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const matches = typed.trim().toLowerCase() === member.display_name.toLowerCase();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!matches) return;
    transfer.mutate(
      { personId: member.person_id },
      {
        onSuccess: () => {
          announce('success', `${member.display_name} is now the guild's Owner. You are an Admin.`);
          onClose();
        }
      }
    );
  };

  return (
    <Dialog title="Hand over ownership" onClose={onClose} busy={transfer.isPending} initialFocus={input}>
      <form onSubmit={onSubmit} noValidate>
        <p>
          {member.display_name} becomes the guild's Owner and you become an Admin. Only the new Owner can undo this.
        </p>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-name`}>
            Type {member.display_name} to confirm
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
        {transfer.isError && (
          <p className="form-error" role="alert">
            {transfer.error.message}
          </p>
        )}
        <div className="dialog-actions">
          <span className="grow" />
          <button type="button" className="button" onClick={onClose} disabled={transfer.isPending}>
            Cancel
          </button>
          <button type="submit" className="button button-danger" disabled={!matches || transfer.isPending}>
            {transfer.isPending ? 'Handing over…' : 'Hand over ownership'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
