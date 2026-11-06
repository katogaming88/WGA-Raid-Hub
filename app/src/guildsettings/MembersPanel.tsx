import { useId, useRef, useState } from 'react';
import { DataState } from '../components/DataState';
import { Dialog } from '../components/Dialog';
import { useStatus } from '../components/Status';
import { useAddress } from '../data/address';
import { formatInstantDate, localTimeZoneNote } from '../lib/dates';
import { errorMessage } from '../lib/errors';
import {
  RANK_LABELS,
  TEAM_RANK_LABELS,
  useGuildMembers,
  useSetGuildRank,
  useTransferOwnership,
  type GuildMember,
  type GuildRank
} from './useMembers';

const MOVES: Exclude<GuildRank, 'owner'>[] = ['admin', 'team_lead', 'member'];
const RANK_ORDER: GuildRank[] = ['owner', 'admin', 'team_lead', 'member'];

// How many people show before "Show all". The list is about 100 long.
const PAGE = 25;

// "1 Owner, 6 Admins, 2 Team Leads, 56 Members".
function counts(rows: GuildMember[]): string {
  const part = (r: GuildRank) => {
    const n = rows.filter((m) => m.rank === r).length;
    return `${n} ${RANK_LABELS[r]}${n === 1 ? '' : 's'}`;
  };
  return RANK_ORDER.map(part).join(', ');
}

// The Members tab of Guild settings (#1650): everyone in the guild as a table
// with their guild rank, teams and last sign-in, searchable and filterable by
// rank. Admins read it; the Owner also changes ranks and hands the guild over.
// The Recruiter switch joins it with #1550.
export function MembersPanel() {
  const { guild } = useAddress();
  const members = useGuildMembers(guild.id);
  const { announce } = useStatus();
  const setRank = useSetGuildRank(guild.id);
  const [handing, setHanding] = useState<GuildMember | null>(null);
  const [search, setSearch] = useState('');
  const [rankFilter, setRankFilter] = useState<GuildRank | 'all'>('all');
  const [showAll, setShowAll] = useState(false);
  const searchId = useId();
  const filterId = useId();

  return (
    <>
      <div className="page-header">
        <h1 id="page-title">Members</h1>
        <p className="text-muted page-subtitle">
          Everyone on a team in the guild. Only the Owner changes ranks or hands the guild over.
        </p>
      </div>
      <DataState query={members} label="the guild's members">
        {(rows) => {
          const isOwner = rows.some((m) => m.is_you && m.rank === 'owner');
          const term = search.trim().toLowerCase();
          const matching = rows.filter(
            (m) =>
              (rankFilter === 'all' || m.rank === rankFilter) &&
              (!term ||
                m.display_name.toLowerCase().includes(term) ||
                m.characters.some((c) => c.toLowerCase().includes(term)))
          );
          // Searching or filtering shows every match; only the plain list is cut.
          const filtering = term !== '' || rankFilter !== 'all';
          const shown = showAll || filtering ? matching : matching.slice(0, PAGE);
          return (
            <>
              <div className="members-controls">
                <p className="text-muted members-count">
                  {counts(rows)}. {localTimeZoneNote()}
                </p>
                <div className="field">
                  <label className="field-label" htmlFor={searchId}>
                    Search
                  </label>
                  <input
                    id={searchId}
                    type="search"
                    className="input"
                    placeholder="Name or character"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor={filterId}>
                    Guild rank
                  </label>
                  <select
                    id={filterId}
                    className="select"
                    value={rankFilter}
                    onChange={(e) => setRankFilter(e.target.value as GuildRank | 'all')}
                  >
                    <option value="all">All</option>
                    {RANK_ORDER.map((r) => (
                      <option key={r} value={r}>
                        {RANK_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="members-table-wrap">
                <table className="members-table">
                  <thead>
                    <tr>
                      <th scope="col">Member</th>
                      <th scope="col">Guild rank</th>
                      <th scope="col">Teams and team rank</th>
                      <th scope="col">Last signed in</th>
                      <th scope="col">
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((m) => (
                      <tr key={m.person_id}>
                        <td>
                          <span className="guildsettings-name">{m.display_name}</span>
                          {m.is_you && <span className="text-muted"> (you)</span>}
                        </td>
                        <td>
                          {isOwner && m.rank !== 'owner' ? (
                            <select
                              className="select members-rank"
                              aria-label={`Guild rank for ${m.display_name}`}
                              value={m.rank}
                              disabled={setRank.isPending}
                              onChange={(e) => {
                                const rank = e.target.value as Exclude<GuildRank, 'owner'>;
                                setRank.mutate(
                                  { personId: m.person_id, rank },
                                  {
                                    onSuccess: () =>
                                      announce('success', `${m.display_name} is now ${RANK_LABELS[rank]}.`),
                                    onError: (err) =>
                                      announce('error', `Could not change ${m.display_name}: ${errorMessage(err)}`)
                                  }
                                );
                              }}
                            >
                              {MOVES.map((r) => (
                                <option key={r} value={r}>
                                  {RANK_LABELS[r]}
                                </option>
                              ))}
                            </select>
                          ) : (
                            RANK_LABELS[m.rank]
                          )}
                        </td>
                        <td>
                          {m.teams.length === 0 ? (
                            <span className="text-muted">No team</span>
                          ) : (
                            <ul className="members-teams">
                              {m.teams.map((t) => (
                                <li key={t.team_id}>
                                  {t.name} <span className="text-muted">{TEAM_RANK_LABELS[t.rank]}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td className="text-muted">{m.last_sign_in ? formatInstantDate(m.last_sign_in) : 'Never'}</td>
                        <td>
                          {isOwner && m.rank !== 'owner' && (
                            <button type="button" className="button" onClick={() => setHanding(m)}>
                              Hand over ownership <span className="visually-hidden">to {m.display_name}</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {matching.length === 0 && <p className="text-muted members-empty">No one matches.</p>}
              </div>
              <p className="text-muted members-foot">
                Showing {shown.length} of {rows.length}.{' '}
                {shown.length < matching.length && (
                  <button type="button" className="link-button" onClick={() => setShowAll(true)}>
                    Show all
                  </button>
                )}
              </p>
            </>
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
