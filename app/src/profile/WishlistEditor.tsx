import type { UseQueryResult } from '@tanstack/react-query';
import { DataState } from '../components/DataState';
import { bothQueries } from '../data/query';
import type { SeasonWindow } from './profile';
import { seasonCode } from './profile';
import {
  useCatalog,
  useMarkWishlist,
  useRaidZones,
  useSeasonTierTokens,
  useWishlist,
  useWishlistSettings,
  type ProfilePlayer
} from './useProfile';
import { editorSlots, planMark, type EditorInput, type EditorSlot, type Mark } from './wishlist';

// The wishlist editor (#868 part 3): each slot's raid items, marked BiS or Pass.
// The raider edits their own while the team's wishlist is open, or when an
// officer allowed them; everyone else who can open the profile reads it.
export function WishlistEditor({
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
  const settings = useWishlistSettings(teamId);
  const picks = useWishlist(player.id);
  const catalog = useCatalog();
  const zones = useRaidZones();
  const seasonName = season.isSuccess && settings.isSuccess ? settings.data.view || season.data.name : null;
  const tokens = useSeasonTierTokens(seasonName ? seasonCode(seasonName) : null);

  return (
    <section className="card profile-card" aria-labelledby="wishlist-editor-title">
      <h2 id="wishlist-editor-title" className="card-title">
        BiS or Pass by slot
      </h2>
      <DataState query={bothQueries(bothQueries(season, settings), bothQueries(picks, catalog))} label="the wishlist">
        {([[, s], [p, c]]) => (
          <DataState query={bothQueries(zones, tokens)} label="the wishlist">
            {([z, t]) => (
              <Editor
                input={{
                  picks: p,
                  catalog: c,
                  zones: z,
                  seasonName: seasonName ?? '',
                  tokens: t,
                  wearer: {
                    className: player.classes_specs?.class ?? null,
                    spec: player.classes_specs?.spec ?? null,
                    role: player.classes_specs?.role ?? null
                  }
                }}
                teamId={teamId}
                playerId={player.id}
                editable={own && (s.open || player.wishlist_allowed)}
                closed={own && !s.open && !player.wishlist_allowed}
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
  closed
}: {
  input: EditorInput;
  teamId: number;
  playerId: number;
  editable: boolean;
  closed: boolean;
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
        <div className="wishlist-slots">
          {slots.map((s) => (
            <SlotCard
              key={s.slot}
              slot={s}
              disabled={!editable || mark.isPending}
              onMark={(itemId, next) => set(s.slot, itemId, next)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function SlotCard({
  slot,
  disabled,
  onMark
}: {
  slot: EditorSlot;
  disabled: boolean;
  onMark: (itemId: number, next: Mark | null) => void;
}) {
  const bis = slot.items.find((i) => i.mark === 'bis');
  const pick = bis ? bis.name : slot.notFromRaid ? `${slot.notFromRaid} (not from raid)` : null;
  return (
    <details className="wishlist-slot" data-slot={slot.slot}>
      <summary className="wishlist-slot-summary">
        <span className="wishlist-slot-name">{slot.slot}</span>
        <span className={pick ? 'wishlist-slot-pick' : 'wishlist-slot-pick text-muted'}>{pick ?? 'No BiS pick'}</span>
      </summary>
      {slot.notFromRaid && (
        <p className="card-note wishlist-not-raid">
          Your BiS for this slot is <strong>{slot.notFromRaid}</strong>. Marking a raid item BiS replaces it.
        </p>
      )}
      <ul className="wishlist-items">
        {slot.items.map((item) => (
          <li key={item.itemId} className="wishlist-item" data-mark={item.mark ?? undefined}>
            <span className="wishlist-item-name">{item.name}</span>
            {item.takenBy ? (
              <span className="wishlist-taken">Your {item.takenBy} BiS</span>
            ) : (
              <span className="mark-buttons" role="group" aria-label={`${item.name}, ${slot.slot}`}>
                {(['bis', 'pass'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`mark-button mark-${m}`}
                    aria-pressed={item.mark === m}
                    disabled={disabled}
                    onClick={() => onMark(item.itemId, item.mark === m ? null : m)}
                  >
                    {m === 'bis' ? 'BiS' : 'Pass'}
                  </button>
                ))}
              </span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
