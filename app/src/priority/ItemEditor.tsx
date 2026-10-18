import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { useStatus } from '../components/Status';
import { errorMessage } from '../lib/errors';
import type { CatalogItem } from '../profile/lootPriority';
import { classColor, firstName, type PlayerRow } from '../roster/roster';
import {
  applySuggestion,
  blocked,
  firstCounts,
  MARK_LABEL,
  pairedNoun,
  move,
  outOf100,
  owned,
  poolFor,
  rankedRows,
  TRACK_LABEL,
  wasRank,
  type PriorityData,
  type PriorityItem,
  type Track
} from './priority';
import { useSaveOrder, useSuggestOrder } from './usePriority';

// An order being changed and not saved yet. It is kept per item and track
// while the officer moves around the list, so nothing is lost by looking at
// another item first.
export type Draft = {
  order: number[];
  locked: number[];
  // From Suggest order: each raider's score and what the generator noted.
  scores: Record<number, { score: number | null; label: string }>;
  // Suggest order has run once, so pressing it again spreads the #1s.
  again: boolean;
  note: string | null;
};

export const draftKey = (itemId: number, track: Track) => `${itemId}|${track}`;

// The side-panel editor (Kat, 2026-10-18, mockup 2B): the current site's
// Priority Edit dialog, in the page. Move up and Move down do by keyboard what
// dragging does by mouse, and each move is read out (#441).
export function ItemEditor({
  teamId,
  season,
  item,
  track,
  managed,
  data,
  players,
  catalog,
  draft,
  onDraft,
  autoSuggest,
  onAutoSuggested
}: {
  teamId: number;
  season: string;
  item: PriorityItem;
  track: Track;
  // Whether the track has an order saved for the item, empty or not.
  managed: boolean;
  data: PriorityData;
  players: PlayerRow[];
  catalog: CatalogItem[];
  draft: Draft | null;
  onDraft: (draft: Draft | null) => void;
  autoSuggest: boolean;
  onAutoSuggested: () => void;
}) {
  const { announce } = useStatus();
  const suggest = useSuggestOrder(teamId);
  const save = useSaveOrder(teamId, season);
  const [wholeRoster, setWholeRoster] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const focusAfter = useRef<{ id: number; dir: 'up' | 'down' } | null>(null);
  const titleId = useId();
  const listRef = useRef<HTMLOListElement>(null);

  const saved = item.ranked;
  const order = draft?.order ?? saved;
  const locked = new Set(draft?.locked ?? []);
  const scores = draft?.scores ?? {};
  const nameOf = (id: number) => {
    const p = players.find((x) => x.id === id);
    return p?.nickname?.trim() || firstName(p?.name_realm ?? '') || `Player ${id}`;
  };
  const update = (patch: Partial<Draft>) =>
    onDraft({ order, locked: [...locked], scores, again: draft?.again ?? false, note: null, ...patch });

  const runSuggest = () =>
    suggest.mutate(
      { season, itemId: item.itemId, track },
      {
        onSuccess: (rows) => {
          if (rows.length === 0) {
            update({ note: 'Nobody has marked this item BiS.' });
            return;
          }
          const result = applySuggestion(
            order,
            locked,
            rows.map((r) => r.player_id),
            firstCounts(data, track, item.itemId),
            draft?.again ?? false
          );
          const next: Draft['scores'] = {};
          for (const r of rows) next[r.player_id] = { score: r.weighted_total, label: r.status_label ?? '' };
          // A locked raider the generator no longer ranks keeps what was shown.
          for (const id of locked) if (!next[id] && scores[id]) next[id] = scores[id]!;
          const marks = result.order.map((id, i) => wasRank(saved, id, i));
          const moved = marks.filter((m) => m?.kind === 'up' || m?.kind === 'down').length;
          const added = marks.filter((m) => m?.kind === 'new').length;
          const removed = saved.filter((id) => !result.order.includes(id)).length;
          const parts = [
            ...(moved ? [`${moved} ${moved === 1 ? 'raider' : 'raiders'} moved`] : []),
            ...(added ? [`${added} added`] : []),
            ...(removed ? [`${removed} removed`] : []),
            ...(result.keptLocked
              ? [`${result.keptLocked} locked ${result.keptLocked === 1 ? 'spot' : 'spots'} kept`]
              : [])
          ];
          let note = `Suggested order loaded: ${parts.length ? parts.join(', ') : 'no change from the saved order'}. Not saved yet.`;
          if (result.promoted) {
            note +=
              result.promoted.count === 0
                ? ` ${nameOf(result.promoted.id)} moved to #1: the first pick already holds a #1 on another item.`
                : ` ${nameOf(result.promoted.id)} moved to #1: everyone holds a #1 elsewhere, and they hold the fewest (${result.promoted.count}).`;
          }
          onDraft({ order: result.order, locked: [...locked], scores: next, again: true, note });
          announce('success', note);
        },
        onError: (error) => announce('error', errorMessage(error))
      }
    );

  // Set Heroic / Set Mythic on Unmanaged opens the item with a suggestion.
  const asked = useRef(false);
  useEffect(() => {
    if (!autoSuggest || asked.current) return;
    asked.current = true;
    onAutoSuggested();
    runSuggest();
  });

  // After a move by keyboard, the same button on the moved row keeps focus,
  // or the other one when the row reached the end.
  useEffect(() => {
    const after = focusAfter.current;
    if (!after) return;
    focusAfter.current = null;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-player="${after.id}"]`);
    const button =
      row?.querySelector<HTMLButtonElement>(`button[data-move="${after.dir}"]:not(:disabled)`) ??
      row?.querySelector<HTMLButtonElement>('button[data-move]:not(:disabled)');
    button?.focus();
  });

  const moveTo = (from: number, to: number, dir?: 'up' | 'down') => {
    if (to < 0 || to >= order.length || from === to) return;
    const id = order[from]!;
    update({ order: move(order, from, to) });
    announce('success', `Moved ${nameOf(id)} to position ${to + 1} of ${order.length}.`);
    if (dir) focusAfter.current = { id, dir };
  };

  const remove = (id: number) => {
    update({ order: order.filter((x) => x !== id), locked: [...locked].filter((x) => x !== id) });
    announce('success', `Removed ${nameOf(id)}.`);
  };

  const add = (id: number) => {
    update({ order: [...order, id] });
    announce('success', `Added ${nameOf(id)} at position ${order.length + 1}.`);
  };

  const toggleLock = (id: number) =>
    update({ locked: locked.has(id) ? [...locked].filter((x) => x !== id) : [...locked, id] });

  const onSave = () =>
    save.mutate(
      { itemId: item.itemId, track, order },
      {
        onSuccess: () => {
          onDraft(null);
          announce('success', `Saved the ${TRACK_LABEL[track]} order for ${item.name}.`);
        },
        onError: (error) => announce('error', errorMessage(error))
      }
    );

  const rows = rankedRows({ ...item, ranked: order }, track, data, players, catalog);
  const pool = poolFor(item.itemId, order, data, players, wholeRoster);
  const marks = new Map(data.prefs.filter((p) => p.item_id === item.itemId).map((p) => [p.player_id, p.status]));

  return (
    <section className="card priority-panel priority-editor" aria-labelledby={titleId}>
      <div className="priority-panel-head">
        <div>
          <h2 id={titleId} className="priority-panel-title">
            {item.name}
          </h2>
          <p className="text-muted priority-panel-sub">{[item.slot, item.boss].filter(Boolean).join(', ')}</p>
        </div>
        <span className={`difficulty difficulty-${track === 'Myth' ? 'mythic' : 'heroic'}`}>{TRACK_LABEL[track]}</span>
        <button type="button" className="button" disabled={suggest.isPending} onClick={runSuggest}>
          {suggest.isPending ? 'Suggesting…' : 'Suggest order'}
        </button>
      </div>

      <div className="priority-editor-body">
        {draft?.note && <p className="priority-editor-note">{draft.note}</p>}
        {!managed && !draft && (
          <p className="text-muted priority-editor-note">
            No {TRACK_LABEL[track]} order saved yet. Suggest order, or add raiders below, then save. Saving it empty
            marks it as nobody on purpose.
          </p>
        )}
        <h3 className="priority-editor-label">Ranked ({order.length})</h3>
        {order.length === 0 ? (
          <p className="text-muted">Nobody ranked.</p>
        ) : (
          <ol ref={listRef} className="priority-edit-rows" aria-label={`${item.name}, ${TRACK_LABEL[track]} order`}>
            {rows.map((r, i) => {
              const was = draft ? wasRank(saved, r.playerId, i) : null;
              const own = owned(r.playerId, item.itemId, data);
              const score = scores[r.playerId];
              const isLocked = locked.has(r.playerId);
              return (
                // Dragging is for the mouse; Move up and Move down are the
                // keyboard's way to do the same (#441).
                // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
                <li
                  key={r.playerId}
                  data-player={r.playerId}
                  className={`priority-edit-row${isLocked ? ' locked' : ''}${dragFrom === i ? ' dragging' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    setDragFrom(i);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragFrom !== null) moveTo(dragFrom, i);
                    setDragFrom(null);
                  }}
                  onDragEnd={() => setDragFrom(null)}
                >
                  <span className="priority-grip" aria-hidden="true">
                    ⋮⋮
                  </span>
                  <span className="priority-rank-num">{r.rank}</span>
                  <span className="priority-edit-who">
                    <span
                      className="priority-rank-name"
                      style={r.className ? { color: classColor(r.className) } : undefined}
                    >
                      {r.name}
                    </span>
                    {was?.kind === 'new' && <span className="priority-was new">new</span>}
                    {was && was.kind !== 'new' && (
                      <span className={`priority-was ${was.kind}`}>
                        <span aria-hidden="true">{was.kind === 'up' ? '▲' : '▼'}</span> was #{was.rank}
                      </span>
                    )}
                    {track === 'Myth' && own.heroic && (
                      <span className="priority-owned" title="Has the Heroic version">
                        Has Heroic
                      </span>
                    )}
                    {own.normal && !(track === 'Myth' && own.heroic) && (
                      <span className="priority-owned" title="Has the Champion (Normal) version">
                        Has Normal
                      </span>
                    )}
                    {r.left && <span className="priority-flag">Left the roster</span>}
                    {r.received && (
                      <span className="priority-flag priority-flag-good">Received {TRACK_LABEL[track]}</span>
                    )}
                    {r.otherBis.length > 0 && (
                      <span className="priority-flag priority-flag-warn">
                        Has BiS {pairedNoun(item.slot)}: {r.otherBis.join(', ')}
                      </span>
                    )}
                    {score?.label && <span className="priority-flag">{score.label}</span>}
                  </span>
                  <span className={r.mark === 'bis' ? 'priority-mark priority-mark-bis' : 'priority-mark'}>
                    {r.mark ? (MARK_LABEL[r.mark] ?? r.mark) : <span className="text-dim">No mark</span>}
                  </span>
                  <span className="priority-score">
                    {score && score.score != null ? `Score ${outOf100(score.score)}` : ''}
                  </span>
                  <span className="priority-edit-actions">
                    <button
                      type="button"
                      className="icon-button priority-icon"
                      data-move="up"
                      aria-label={`Move ${r.name} up`}
                      disabled={i === 0}
                      onClick={() => moveTo(i, i - 1, 'up')}
                    >
                      <Icon name="chevronUp" />
                    </button>
                    <button
                      type="button"
                      className="icon-button priority-icon"
                      data-move="down"
                      aria-label={`Move ${r.name} down`}
                      disabled={i === order.length - 1}
                      onClick={() => moveTo(i, i + 1, 'down')}
                    >
                      <Icon name="chevronDown" />
                    </button>
                    <button
                      type="button"
                      className="icon-button priority-icon priority-lock"
                      aria-label={`Lock ${r.name} at #${r.rank}`}
                      aria-pressed={isLocked}
                      title={isLocked ? 'Locked to this spot: Suggest order keeps them here' : 'Lock to this spot'}
                      onClick={() => toggleLock(r.playerId)}
                    >
                      <Icon name={isLocked ? 'lock' : 'unlock'} />
                    </button>
                    <button
                      type="button"
                      className="icon-button priority-icon"
                      aria-label={`Remove ${r.name}`}
                      onClick={() => remove(r.playerId)}
                    >
                      <Icon name="close" />
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        <div className="priority-pool-head">
          <h3 className="priority-editor-label">{wholeRoster ? 'Whole roster, not ranked' : 'Marked, not ranked'}</h3>
          <label className="priority-hide-empty">
            <input type="checkbox" checked={wholeRoster} onChange={(e) => setWholeRoster(e.target.checked)} /> Whole
            roster
          </label>
        </div>
        {pool.length === 0 ? (
          <p className="text-muted">
            {wholeRoster ? 'Everyone on the roster is ranked.' : 'Nobody else has marked this item.'}
          </p>
        ) : (
          <ul className="priority-pool">
            {pool.map((p) => {
              const own = owned(p.id, item.itemId, data);
              const out = blocked(own, track);
              const mark = marks.get(p.id);
              const name = p.nickname?.trim() || firstName(p.name_realm);
              return (
                <li key={p.id} className="priority-pool-row">
                  <span
                    className="priority-rank-name"
                    style={p.classes_specs?.class ? { color: classColor(p.classes_specs.class) } : undefined}
                  >
                    {name}
                  </span>
                  {mark && (
                    <span className={mark === 'bis' ? 'priority-mark priority-mark-bis' : 'priority-mark'}>
                      {MARK_LABEL[mark] ?? mark}
                    </span>
                  )}
                  {out ? (
                    <span className="text-muted priority-pool-out">
                      {own.mythic ? 'Has Mythic, can’t be added' : 'Has Heroic, can’t be added to Heroic'}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="button priority-pool-add"
                      aria-label={`Add ${name}`}
                      onClick={() => add(p.id)}
                    >
                      Add
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="priority-editor-foot">
        {draft && <span className="priority-unsaved">Not saved</span>}
        <span className="text-muted priority-editor-hint">Locked raiders keep their spot when you suggest again.</span>
        {draft && (
          <button type="button" className="button" onClick={() => onDraft(null)}>
            Undo changes
          </button>
        )}
        <button
          type="button"
          className="button priority-save"
          disabled={save.isPending || (!draft && managed)}
          onClick={onSave}
        >
          {save.isPending ? 'Saving…' : 'Save priority'}
        </button>
      </div>
    </section>
  );
}
