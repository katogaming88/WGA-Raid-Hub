import { useId, useState } from 'react';
import { useTeam } from '../data/address';
import { useSeasons } from '../calendar/useCalendar';
import { DataState } from '../components/DataState';
import { Dialog } from '../components/Dialog';
import { ItemLink } from '../components/ItemLink';
import { useStatus } from '../components/Status';
import { can, useAccess } from '../auth/access';
import { errorMessage } from '../lib/errors';
import { formatInstant, formatInstantShort, localTimeZoneNote } from '../lib/dates';
import { formatAuditDetail } from '../settings/audit';
import { itemLinkData } from '../profile/lootPriority';
import { difficultyOf, type SeasonRow } from '../profile/profile';
import { firstName, type PlayerRow } from '../roster/roster';
import { useRosterPlayers } from '../roster/useRoster';
import {
  parseMove,
  useRaiderLoot,
  useReassign,
  useReassignHistory,
  type ReassignHistory,
  type ReassignRow
} from './useReassign';
import '../settings/settings.css';
import './loot.css';

// "Nick (Character)", as the current site's picker shows a raider.
export const pickerName = (p: Pick<PlayerRow, 'name_realm' | 'nickname'>) =>
  p.nickname?.trim() ? `${p.nickname.trim()} (${firstName(p.name_realm)})` : firstName(p.name_realm);

const itemName = (row: ReassignRow) => row.items?.name ?? 'Unknown item';

// The officer's Reassign page (#1363), ported from js/tabs/tab-loot-import.js:
// loot council gave an item to one raider, and it was traded in game to
// someone else.
export function ReassignPage() {
  const team = useTeam();
  const access = useAccess();
  const players = useRosterPlayers(team.id);
  const history = useReassignHistory(team.id);

  return (
    <section className="page settings-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">Reassign loot</h1>
        <p className="text-muted page-subtitle">
          For an item loot council gave one raider that was then traded in game to someone else. Pick who has it now on
          file, find the item, and move it. Everywhere received items show follows the change.
        </p>
      </div>
      {can(access.data, 'actAsOfficer', team.id) ? (
        <DataState query={players} label="the roster">
          {(roster) => <Reassign teamId={team.id} roster={roster} />}
        </DataState>
      ) : (
        // #607: rclc_loot's officer write leaves guild officers out.
        <p className="card settings-card">Only this team&apos;s officers can reassign loot.</p>
      )}
      <DataState query={history} label="past reassignments">
        {(data) => <HistoryCard history={data} />}
      </DataState>
    </section>
  );
}

function HistoryCard({ history }: { history: ReassignHistory }) {
  return (
    <div className="card settings-card">
      <h2 className="section-title">Past reassignments</h2>
      {!history.rows.length ? (
        <p className="text-muted">No loot reassigned yet.</p>
      ) : (
        <>
          <p className="text-muted">
            {history.rows.length} so far, newest first. {localTimeZoneNote()}
          </p>
          <ul className="loot-review-list">
            {history.rows.map((row) => {
              const move = parseMove(row.detail);
              return (
                <li key={row.id} className="loot-review">
                  <div className="loot-review-line">
                    {move ? (
                      <>
                        <span className="loot-review-item">
                          <ItemLink link={itemLinkData(history.items[move.item])}>{move.item}</ItemLink>
                        </span>
                        <span className="loot-reassign-move">
                          {move.from} <span aria-hidden="true">→</span>
                          <span className="visually-hidden">to</span> {move.to}
                        </span>
                      </>
                    ) : (
                      <span className="loot-review-item">{formatAuditDetail(row.detail)}</span>
                    )}
                    <span className="text-muted loot-reassign-by">
                      by {(row.actor_id && history.actorNames[row.actor_id]) || 'an officer'}
                    </span>
                    <span className="text-muted loot-review-when" title={formatInstant(row.created_at)}>
                      {formatInstantShort(row.created_at)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function Reassign({ teamId, roster }: { teamId: number; roster: PlayerRow[] }) {
  const { announce } = useStatus();
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [moving, setMoving] = useState<ReassignRow | null>(null);
  const loot = useRaiderLoot(teamId, playerId);
  const seasons = useSeasons();
  const reassign = useReassign(teamId);
  const pickId = useId();
  const sorted = [...roster].sort((a, b) => pickerName(a).localeCompare(pickerName(b)));
  const from = roster.find((p) => p.id === playerId);

  const onMove = (row: ReassignRow, to: PlayerRow) => {
    const detail = `${itemName(row)}: ${pickerName(from!)} -> ${pickerName(to)}`;
    reassign.mutate(
      { row, to: to.id, detail },
      {
        onSuccess: () => {
          setMoving(null);
          announce('success', `${itemName(row)} now counts for ${pickerName(to)}.`);
        },
        onError: (error) => announce('error', errorMessage(error))
      }
    );
  };

  return (
    <div className="card settings-card">
      <div className="settings-row">
        <label htmlFor={pickId}>Now credited to</label>
        <select
          id={pickId}
          className="select"
          value={playerId ?? ''}
          onChange={(e) => setPlayerId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Pick a raider</option>
          {sorted.map((p) => (
            <option key={p.id} value={p.id}>
              {pickerName(p)}
            </option>
          ))}
        </select>
      </div>
      {playerId !== null && (
        <DataState query={loot} label="their loot">
          {(rows) =>
            !rows.length ? (
              <p className="text-muted">No raid loot on file for {pickerName(from!)}.</p>
            ) : (
              <ul className="loot-review-list">
                {rows.map((row) => (
                  <li key={row.id} className="loot-review">
                    <div className="loot-review-line">
                      <span className="loot-review-item">
                        <ItemLink link={itemLinkData(row.items)}>{itemName(row)}</ItemLink>
                      </span>
                      <span className="loot-review-source">
                        {difficultyOf(row.track)}
                        {row.season && `, ${seasonName(seasons.data, row.season)}`}
                      </span>
                      <span className="text-muted loot-review-when" title={formatInstant(row.awarded_at)}>
                        {formatInstantShort(row.awarded_at)}
                      </span>
                      <span className="loot-review-actions">
                        <button
                          type="button"
                          className="button"
                          disabled={reassign.isPending}
                          onClick={() => setMoving(row)}
                        >
                          Reassign
                        </button>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )
          }
        </DataState>
      )}
      {moving && (
        <MoveDialog
          row={moving}
          others={sorted.filter((p) => p.id !== playerId)}
          busy={reassign.isPending}
          onClose={() => setMoving(null)}
          onMove={(to) => onMove(moving, to)}
        />
      )}
    </div>
  );
}

const seasonName = (seasons: SeasonRow[] | undefined, code: string) =>
  seasons?.find((s) => s.code === code)?.display_name ?? code;

function MoveDialog({
  row,
  others,
  busy,
  onClose,
  onMove
}: {
  row: ReassignRow;
  others: PlayerRow[];
  busy: boolean;
  onClose: () => void;
  onMove: (to: PlayerRow) => void;
}) {
  const [to, setTo] = useState('');
  const toId = useId();
  const target = others.find((p) => String(p.id) === to);
  return (
    <Dialog title={`Reassign ${itemName(row)}?`} onClose={onClose} busy={busy}>
      <label className="field-label" htmlFor={toId}>
        Give it to
      </label>
      <select id={toId} className="select" value={to} onChange={(e) => setTo(e.target.value)}>
        <option value="">Pick a raider</option>
        {others.map((p) => (
          <option key={p.id} value={p.id}>
            {pickerName(p)}
          </option>
        ))}
      </select>
      <div className="dialog-actions">
        <span className="grow" />
        <button type="button" className="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="button button-primary"
          onClick={() => target && onMove(target)}
          disabled={busy || !target}
        >
          Reassign
        </button>
      </div>
    </Dialog>
  );
}
