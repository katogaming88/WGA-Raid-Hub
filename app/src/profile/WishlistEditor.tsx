import { useRef, useState, type KeyboardEvent } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { DataState } from '../components/DataState';
import { useTouchScreen } from '../lib/device';
import { bothQueries } from '../data/query';
import { useSeasons } from '../calendar/useCalendar';
import type { SeasonRow, SeasonWindow } from './profile';
import {
  useCatalog,
  useMarkWishlist,
  useRaidZones,
  useSeasonTierTokens,
  useWishlist,
  useWishlistSettings,
  type ProfilePlayer,
  type WishlistSettings
} from './useProfile';
import { sourceTag } from './lootPriority';
import { WishlistSummaryCard } from './LootPriorityCard';
import {
  editorSeason,
  editorSlots,
  ownWishlistSeason,
  planMark,
  wishlistCandidates,
  type EditorInput,
  type EditorSlot,
  type Mark
} from './wishlist';

// The season a raider picked for their own wishlist, kept in this browser so
// leaving the tab or reloading does not move them back to the default.
const seasonKey = (playerId: number) => `wga-wishlist-season-${playerId}`;

function savedSeason(playerId: number): string | null {
  try {
    return localStorage.getItem(seasonKey(playerId));
  } catch {
    // Storage can be blocked; the default applies.
    return null;
  }
}

// The Wishlist tab: the summary and the editor read one season, and the page
// names it. A raider's own is the season they pick from the ones the team
// opened (#936, decision 13 on #1189), starting on the live tier; anyone else
// reads the season on the officer's screen, as every officer view does (#1351).
export function WishlistTab({
  player,
  teamId,
  season,
  own
}: {
  player: ProfilePlayer;
  teamId: number;
  season: UseQueryResult<SeasonWindow>;
  own: boolean;
}) {
  // What decides the season: the team's switches and the officer's pin, and
  // the shared season list, which orders and names the seasons (#1368).
  const tiers = bothQueries(useWishlistSettings(teamId), useSeasons());
  // This visit's picks win over the saved one, which covers blocked storage.
  const [chosen, setChosen] = useState<Record<number, string>>({});
  const picked = own ? (chosen[player.id] ?? savedSeason(player.id)) : null;
  const pick = (code: string) => {
    setChosen({ ...chosen, [player.id]: code });
    try {
      localStorage.setItem(seasonKey(player.id), code);
    } catch {
      // Not saved; the pick still applies for this visit.
    }
  };
  const live = season.isSuccess ? season.data.code : null;
  // The shared list comes in start order.
  const newestFirst = tiers.isSuccess ? [...tiers.data[1]].reverse() : [];
  const nameOf = (code: string) => newestFirst.find((t) => t.code === code)?.display_name ?? code;
  const candidates =
    own && tiers.isSuccess
      ? wishlistCandidates(
          tiers.data[0].openSeasons,
          live,
          player.wishlist_allowed,
          newestFirst.map((t) => t.code)
        )
      : [];
  const planned =
    season.isSuccess && tiers.isSuccess
      ? own
        ? ownWishlistSeason(picked, candidates, live)
        : editorSeason(tiers.data[0].view, season.data)
      : null;

  return (
    <div className="profile-wishlist">
      {planned &&
        (candidates.length > 1 ? (
          <div className="field wishlist-season-picker">
            <label className="field-label" htmlFor="wishlist-season">
              Wishlist for
            </label>
            <select id="wishlist-season" className="select" value={planned} onChange={(e) => pick(e.target.value)}>
              {candidates.map((code) => (
                <option key={code} value={code}>
                  {nameOf(code)}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="wishlist-season-name">
            Wishlist for <strong>{nameOf(planned)}</strong>
          </p>
        ))}
      <WishlistSummaryCard
        player={player}
        season={season}
        seasonOf={{ reads: tiers, code: planned, name: planned && nameOf(planned) }}
      />
      <WishlistEditor player={player} teamId={teamId} season={season} tiers={tiers} planned={planned} own={own} />
    </div>
  );
}

// The wishlist editor (#868 part 3): each slot's raid items, marked BiS or Pass.
// The raider edits their own while the team's wishlist is open, or when an
// officer allowed them; everyone else who can open the profile reads it.
function WishlistEditor({
  player,
  teamId,
  season,
  tiers,
  planned,
  own
}: {
  player: ProfilePlayer;
  teamId: number;
  season: UseQueryResult<SeasonWindow>;
  tiers: UseQueryResult<[WishlistSettings, SeasonRow[]]>;
  planned: string | null;
  own: boolean;
}) {
  const picks = useWishlist(player.id);
  const catalog = useCatalog();
  const zones = useRaidZones();
  // Editing is open per tier (#939): the switch for the tier the editor is
  // scoped to, which is the tier a pick is stamped with.
  const open = planned != null && tiers.isSuccess && tiers.data[0].openSeasons.includes(planned);
  const tokens = useSeasonTierTokens(planned);
  // Not on a phone or tablet, where a stray tap marks the wrong item.
  const touch = useTouchScreen();

  return (
    <section className="card profile-card" aria-labelledby="wishlist-editor-title">
      <h2 id="wishlist-editor-title" className="card-title">
        BiS or Pass by slot
      </h2>
      <DataState query={bothQueries(bothQueries(season, tiers), bothQueries(picks, catalog))} label="the wishlist">
        {([, [p, c]]) => (
          <DataState query={bothQueries(zones, tokens)} label="the wishlist">
            {([z, t]) => (
              <Editor
                input={{
                  picks: p,
                  catalog: c,
                  zones: z,
                  seasonCode: planned,
                  tokens: t,
                  wearer: {
                    className: player.classes_specs?.class ?? null,
                    spec: player.classes_specs?.spec ?? null,
                    role: player.classes_specs?.role ?? null
                  }
                }}
                teamId={teamId}
                playerId={player.id}
                editable={own && planned != null && (open || player.wishlist_allowed) && !touch}
                closed={own && (planned == null || (!open && !player.wishlist_allowed))}
                touch={own && touch}
              />
            )}
          </DataState>
        )}
      </DataState>
    </section>
  );
}

function Editor({
  input,
  teamId,
  playerId,
  editable,
  closed,
  touch
}: {
  input: EditorInput;
  teamId: number;
  playerId: number;
  editable: boolean;
  closed: boolean;
  touch: boolean;
}) {
  const mark = useMarkWishlist(playerId);
  const slots = editorSlots(input);
  const set = (slot: string, itemId: number, next: Mark | null) =>
    mark.mutate(planMark({ ...input, teamId, playerId }, slot, itemId, next));

  return (
    <>
      {closed ? (
        <p className="card-note wishlist-closed">
          Wishlist editing is closed, so your marks are read-only. Ask an officer if something needs to change.
        </p>
      ) : touch ? (
        <p className="card-note wishlist-closed wishlist-touch">
          Wishlist editing works on a computer, so your marks are read-only on a phone or tablet.
        </p>
      ) : editable ? (
        <p className="card-note text-muted">
          Mark one item BiS for each slot, and Pass on anything you would not take. Click a mark again to clear it.
        </p>
      ) : null}
      {mark.isError && (
        <p className="wishlist-error" role="alert">
          That did not save: {mark.error.message}
        </p>
      )}
      {slots.length === 0 ? (
        <p className="text-muted card-note">No raid items are set up for this season yet.</p>
      ) : (
        <SlotTabs slots={slots} disabled={!editable || mark.isPending} onMark={set} />
      )}
    </>
  );
}

const pickFor = (slot: EditorSlot) => {
  const bis = slot.items.find((i) => i.mark === 'bis');
  return bis ? bis.name : slot.notFromRaid ? `${slot.notFromRaid} (not from raid)` : null;
};

const tabId = (slot: string) => `wishlist-slot-${slot.toLowerCase().replace(/s+/g, '-')}`;

// The slots across the top in one scrolling row (Kat, 2026-09-14), each a tab showing whether it
// has a BiS pick; the chosen slot's items are listed below. Arrow keys, Home
// and End move between slots.
function SlotTabs({
  slots,
  disabled,
  onMark
}: {
  slots: EditorSlot[];
  disabled: boolean;
  onMark: (slot: string, itemId: number, next: Mark | null) => void;
}) {
  const [chosen, setChosen] = useState(slots[0]!.slot);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    slots.findIndex((s) => s.slot === chosen)
  );
  const current = slots[index]!;

  const onKeyDown = (event: KeyboardEvent) => {
    const last = slots.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % slots.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + slots.length) % slots.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    setChosen(slots[next]!.slot);
    refs.current[next]?.focus();
  };

  const pick = pickFor(current);
  return (
    <>
      <div className="wishlist-slot-tabs" role="tablist" aria-label="Gear slots">
        {slots.map((s, i) => {
          const picked = pickFor(s) !== null;
          return (
            <button
              key={s.slot}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={tabId(s.slot)}
              aria-selected={s === current}
              aria-controls="wishlist-slot-panel"
              tabIndex={s === current ? 0 : -1}
              className="wishlist-slot-tab"
              data-slot={s.slot}
              data-picked={picked || undefined}
              onClick={() => setChosen(s.slot)}
              onKeyDown={onKeyDown}
            >
              <span className="wishlist-slot-dot" aria-hidden="true" />
              {s.slot}
              <span className="visually-hidden">{picked ? ', BiS picked' : ', no BiS pick'}</span>
            </button>
          );
        })}
      </div>

      <div
        id="wishlist-slot-panel"
        role="tabpanel"
        aria-labelledby={tabId(current.slot)}
        className="wishlist-slot"
        data-slot={current.slot}
      >
        <p className="wishlist-slot-summary">
          <span className="wishlist-slot-name">{current.slot}</span>
          <span className={pick ? 'wishlist-slot-pick' : 'wishlist-slot-pick text-muted'}>{pick ?? 'No BiS pick'}</span>
        </p>
        {current.notFromRaid && (
          <p className="card-note wishlist-not-raid">
            Your BiS for this slot is <strong>{current.notFromRaid}</strong>. Marking a raid item BiS replaces it.
          </p>
        )}
        <ul className="wishlist-items">
          {current.items.map((item) => (
            <li key={item.itemId} className="wishlist-item" data-mark={item.mark ?? undefined}>
              <span className="wishlist-item-name">
                {item.name}
                {sourceTag(item.source) && <span className="source-tag">{sourceTag(item.source)}</span>}
              </span>
              {item.takenBy ? (
                <span className="wishlist-taken">Your {item.takenBy} BiS</span>
              ) : (
                <span className="mark-buttons" role="group" aria-label={`${item.name}, ${current.slot}`}>
                  {(['bis', 'pass'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`mark-button mark-${m}`}
                      aria-pressed={item.mark === m}
                      disabled={disabled}
                      onClick={() => onMark(current.slot, item.itemId, item.mark === m ? null : m)}
                    >
                      {m === 'bis' ? 'BiS' : 'Pass'}
                    </button>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
