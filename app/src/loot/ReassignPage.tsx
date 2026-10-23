import { useId, useState } from 'react';
import { useTeam } from '../data/address';
import { useSeasons } from '../calendar/useCalendar';
import { DataState } from '../components/DataState';
import { Dialog } from '../components/Dialog';
import { ItemLink } from '../components/ItemLink';
import { useStatus } from '../components/Status';
import { can, useAccess } from '../auth/access';
import { errorMessage } from '../lib/errors';
import { awardDate, formatInstant, formatInstantShort, localTimeZoneNote } from '../lib/dates';
import { formatAuditDetail } from '../settings/audit';
import { itemLinkData } from '../profile/lootPriority';
import { difficultyOf, seasonLoot, type SeasonRow } from '../profile/profile';
import { difficultyClass, NotCounted } from '../profile/ProfilePage';
import { classColor, firstName, ROLE_LABELS, ROLE_ORDER, type PlayerRow, type Role } from '../roster/roster';
import { useRosterPlayers } from '../roster/useRoster';
import {
  parseMove,
  useReassign,
  useReassignHistory,
  useTeamLoot,
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
          For an item loot council gave one raider that was then traded in game to someone else. Find the raider who has
          it on file, or the item itself, and move it. Everywhere received items show follows the change.
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
  const [search, setSearch] = useState('');
  const [moving, setMoving] = useState<ReassignRow | null>(null);
  const loot = useTeamLoot(teamId);
  const seasons = useSeasons();
  const reassign = useReassign(teamId);
  const searchId = useId();
  const sorted = [...roster].sort((a, b) => pickerName(a).localeCompare(pickerName(b)));
  const byId = new Map(roster.map((p) => [p.id, p]));
  const picked = playerId === null ? undefined : byId.get(playerId);
  const q = search.trim().toLowerCase();
  const shown = q ? sorted.filter((p) => pickerName(p).toLowerCase().includes(q)) : sorted;
  const holder = (row: ReassignRow) => (row.player_id === null ? undefined : byId.get(row.player_id));

  const onMove = (row: ReassignRow, to: PlayerRow) => {
    const from = holder(row);
    const detail = `${itemName(row)}: ${from ? pickerName(from) : 'Unknown'} -> ${pickerName(to)}`;
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

  const reassignButton = (row: ReassignRow, label: string) => (
    <button
      type="button"
      className="button"
      aria-label={label}
      disabled={reassign.isPending}
      onClick={() => setMoving(row)}
    >
      Reassign
    </button>
  );

  return (
    <div className="card settings-card">
      <label className="field-label" htmlFor={searchId}>
        Find a raider or an item
      </label>
      <input
        id={searchId}
        type="search"
        className="input"
        placeholder="For example: Brakkus, or Voidbound Cinch"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {/* Every raider at once, by role and in class color, so picking one is a
          single click (Kat, 2026-10-23: the dropdown was slow to go through). */}
      <RaiderButtons players={shown} picked={playerId} onPick={(id) => setPlayerId(id === playerId ? null : id)} />
      <DataState query={loot} label="the team's loot">
        {(rows) => {
          // Items whose name matches, whoever has them, newest first.
          const items =
            q.length >= 2
              ? rows
                  .filter((r) => itemName(r).toLowerCase().includes(q))
                  .sort((a, b) => (a.awarded_at < b.awarded_at ? 1 : -1))
              : [];
          const theirs = picked ? rows.filter((r) => r.player_id === picked.id) : [];
          return (
            <>
              {q && !shown.length && !items.length && (
                <p className="text-muted loot-reassign-season">
                  No raider or item matches &ldquo;{search.trim()}&rdquo;.
                </p>
              )}
              {items.length > 0 && (
                <section className="loot-reassign-season">
                  <h3 className="loot-summary">
                    <span className="num loot-count">{items.length}</span> {items.length === 1 ? 'item' : 'items'} named
                    like &ldquo;{search.trim()}&rdquo;
                  </h3>
                  <ul className="loot-review-list">
                    {items.map((row) => {
                      const who = holder(row);
                      const difficulty = difficultyOf(row.track);
                      return (
                        <li key={row.id} className="loot-review">
                          <div className="loot-review-line">
                            <strong
                              className="loot-review-who"
                              style={{ color: classColor(who?.classes_specs?.class ?? '') }}
                            >
                              {who ? pickerName(who) : 'No longer on the roster'}
                            </strong>
                            <span className="loot-review-item">
                              <ItemLink link={itemLinkData(row.items)}>{itemName(row)}</ItemLink>
                              {row.counted === false && <span className="loot-offspec">Off spec</span>}
                            </span>
                            <span className={difficultyClass(difficulty)}>{difficulty}</span>
                            <span className="text-muted loot-review-when" title={formatInstant(row.awarded_at)}>
                              {awardDate(row.awarded_at)}
                            </span>
                            <span className="loot-review-actions">
                              {reassignButton(row, `Reassign ${itemName(row)} from ${who ? pickerName(who) : 'them'}`)}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
              {picked &&
                (!theirs.length ? (
                  <p className="text-muted loot-reassign-season">No raid loot on file for {pickerName(picked)}.</p>
                ) : (
                  bySeason(theirs, seasons.data ?? []).map(({ code, loot: season }) => {
                    const rowById = new Map(theirs.map((r) => [r.id, r]));
                    return (
                      <section key={code ?? 'none'} className="loot-reassign-season">
                        {/* The profile's Items received, one season at a time. */}
                        <h3 className="loot-summary">
                          <strong style={{ color: classColor(picked.classes_specs?.class ?? '') }}>
                            {pickerName(picked)}
                          </strong>
                          : <span className="num loot-count">{season.count}</span>{' '}
                          {season.count === 1 ? 'item' : 'items'} in{' '}
                          <span className="loot-season">{season.season}</span>
                        </h3>
                        <ul className="loot-review-list">
                          {season.awards.map((a) => {
                            const row = rowById.get(a.key)!;
                            return (
                              <li key={a.key} className="loot-review">
                                <div className="loot-review-line">
                                  <span className="loot-review-item">
                                    <ItemLink link={itemLinkData(row.items)}>{a.name}</ItemLink>
                                    <NotCounted award={a} />
                                  </span>
                                  <span className={difficultyClass(a.difficulty)}>{a.difficulty}</span>
                                  <span className="text-muted loot-review-when" title={formatInstant(a.awardedAt)}>
                                    {a.date}
                                  </span>
                                  <span className="loot-review-actions">
                                    {reassignButton(row, `Reassign ${a.name}`)}
                                  </span>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    );
                  })
                ))}
            </>
          );
        }}
      </DataState>
      {moving && (
        <MoveDialog
          row={moving}
          others={sorted.filter((p) => p.id !== moving.player_id)}
          busy={reassign.isPending}
          onClose={() => setMoving(null)}
          onMove={(to) => onMove(moving, to)}
        />
      )}
    </div>
  );
}

// Every raider at once, by role and in class color, so picking one is a single
// click (Kat, 2026-10-23: the dropdown was slow to go through). The page and
// the move dialog both pick with it.
function RaiderButtons({
  players,
  picked,
  onPick
}: {
  players: PlayerRow[];
  picked: number | null;
  onPick: (id: number) => void;
}) {
  if (!players.length) return null;
  return (
    <div className="loot-reassign-roles">
      {raidersByRole(players).map(({ label, raiders }) => (
        <div key={label} role="group" aria-label={label} className="loot-reassign-role">
          <span className="loot-reassign-role-label text-muted" aria-hidden="true">
            {label}
          </span>
          {/* Equal-width columns, so the names line up row to row (Kat: the
              wrapped buttons looked messy). */}
          <div className="loot-reassign-raiders">
            {raiders.map((p) => (
              <button
                key={p.id}
                type="button"
                className="button loot-reassign-raider"
                aria-pressed={p.id === picked}
                title={pickerName(p)}
                style={{ color: classColor(p.classes_specs?.class ?? '') }}
                onClick={() => onPick(p.id)}
              >
                {pickerName(p)}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// The roster's role groups, in its order; a raider with no role set goes last.
function raidersByRole(players: PlayerRow[]) {
  const groups = ROLE_ORDER.map((role) => ({
    label: ROLE_LABELS[role],
    raiders: players.filter((p) => p.classes_specs?.role === role)
  }));
  const other = players.filter((p) => !ROLE_ORDER.includes(p.classes_specs?.role as Role));
  return [...groups, { label: 'No role set', raiders: other }].filter((g) => g.raiders.length);
}

// One block per season the raider has loot in, newest season first, each read
// by seasonLoot() as the profile does. Awards from before seasons were
// recorded go last.
export function bySeason(rows: ReassignRow[], seasons: SeasonRow[]) {
  const codes = [...new Set(rows.map((r) => r.season))];
  const order = (c: string | null) => (c === null ? -1 : seasons.findIndex((s) => s.code === c));
  return codes
    .sort((a, b) => order(b) - order(a))
    .map((code) => ({
      code,
      loot: seasonLoot(
        rows.filter((r) => r.season === code),
        {
          code: null,
          name: code === null ? 'no recorded season' : (seasons.find((s) => s.code === code)?.display_name ?? code),
          start: null,
          end: null
        }
      )
    }));
}

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
  const [to, setTo] = useState<number | null>(null);
  const [filter, setFilter] = useState('');
  const filterId = useId();
  const target = others.find((p) => p.id === to);
  const f = filter.trim().toLowerCase();
  const shown = f ? others.filter((p) => pickerName(p).toLowerCase().includes(f)) : others;
  return (
    <Dialog title={`Reassign ${itemName(row)}?`} onClose={onClose} busy={busy}>
      <label className="field-label" htmlFor={filterId}>
        Give it to
      </label>
      <input
        id={filterId}
        type="search"
        className="input"
        placeholder="Type to narrow the raiders"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <RaiderButtons players={shown} picked={to} onPick={setTo} />
      {!shown.length && <p className="text-muted">No raider matches.</p>}
      <div className="dialog-actions">
        {target && <span className="text-muted">Gives it to {pickerName(target)}.</span>}
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
