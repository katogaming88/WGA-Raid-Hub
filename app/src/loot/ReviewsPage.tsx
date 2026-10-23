import { useId, useState, type ReactNode } from 'react';
import { useTeam } from '../data/address';
import { bothQueries } from '../data/query';
import { useSeasons } from '../calendar/useCalendar';
import { DataState } from '../components/DataState';
import { Dialog } from '../components/Dialog';
import { ItemLink } from '../components/ItemLink';
import { Menu } from '../components/Menu';
import { useStatus } from '../components/Status';
import { can, useAccess } from '../auth/access';
import { errorMessage } from '../lib/errors';
import { formatInstant, formatInstantShort, localTimeZoneNote } from '../lib/dates';
import { itemLinkData } from '../profile/lootPriority';
import { currentSeason, type SeasonRow } from '../profile/profile';
import { classColor } from '../roster/roster';
import {
  groupByRaider,
  groupCounts,
  itemName,
  raiderName,
  searchReviews,
  seasonOf,
  sourceLabel,
  type ReviewRow
} from './reviews';
import { useDecide, useDeleteReview, useReviews, type Decision } from './useReviews';
import '../settings/settings.css';
import './loot.css';

// The officer's Reviews page (#1363), ported from js/tabs/tab-requests.js:
// items raiders say they got outside the team's raids, which count only once
// an officer approves them.
export function ReviewsPage() {
  const team = useTeam();
  const access = useAccess();
  const reviews = bothQueries(useReviews(team.id), useSeasons());
  const officer = can(access.data, 'actAsOfficer', team.id);

  return (
    <section className="page settings-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">Reviews</h1>
        <p className="text-muted page-subtitle">
          Items raiders say they got outside the team&apos;s raids, such as the Great Vault. An item counts as received
          once you approve it. The raider is told either way.
        </p>
      </div>
      <DataState query={reviews} label="reviews">
        {([rows, seasons]) => <Reviews teamId={team.id} rows={rows} seasons={seasons} officer={officer} />}
      </DataState>
    </section>
  );
}

function Reviews({
  teamId,
  rows,
  seasons,
  officer
}: {
  teamId: number;
  rows: ReviewRow[];
  seasons: SeasonRow[];
  officer: boolean;
}) {
  const { announce } = useStatus();
  const decide = useDecide(teamId);
  const remove = useDeleteReview(teamId);
  const [search, setSearch] = useState('');
  const [rejecting, setRejecting] = useState<ReviewRow | null>(null);
  const [deleting, setDeleting] = useState<ReviewRow | null>(null);
  const searchId = useId();
  const seasonId = useId();
  const busy = decide.isPending || remove.isPending;

  // The whole page goes by season (Kat, 2026-10-22), this one first, so an
  // older season's requests and raiders stay out of the way.
  const current = currentSeason(seasons)?.code ?? null;
  const withRows = new Set(rows.map((r) => seasonOf(r, seasons)));
  const seasonList = [...seasons].reverse().filter((s) => s.code === current || withRows.has(s.code));
  const [picked, setPicked] = useState<string | null>(null);
  const season = picked ?? current;
  const inSeason = rows.filter((r) => seasonOf(r, seasons) === season);
  const waiting = inSeason.filter((r) => r.status === 'pending');
  const decided = inSeason.filter((r) => r.status !== 'pending');
  const searching = search.trim() !== '';
  const groups = groupByRaider(searchReviews(decided, search));

  const onDecide = (decision: Decision, done: string) =>
    decide.mutate(decision, {
      onSuccess: () => {
        setRejecting(null);
        announce('success', done);
      },
      onError: (error) => announce('error', errorMessage(error))
    });

  const onDelete = (row: ReviewRow) =>
    remove.mutate(row, {
      onSuccess: () => {
        setDeleting(null);
        announce('success', `Deleted ${raiderName(row)}'s ${itemName(row)}.`);
      },
      onError: (error) => announce('error', errorMessage(error))
    });

  return (
    <>
      <div className="settings-row loot-season-row">
        <label htmlFor={seasonId}>Season</label>
        <select id={seasonId} className="select" value={season ?? ''} onChange={(e) => setPicked(e.target.value)}>
          {seasonList.map((s) => (
            <option key={s.code} value={s.code}>
              {s.display_name}
            </option>
          ))}
        </select>
      </div>
      <div className="card settings-card">
        <h2 className="section-title">Waiting for review</h2>
        {!waiting.length ? (
          <p className="text-muted">Nothing waiting this season.</p>
        ) : (
          <>
            <p className="text-muted">
              {waiting.length} waiting. {localTimeZoneNote()}
            </p>
            <ul className="loot-review-list">
              {waiting.map((row) => (
                <ReviewLine key={row.id} row={row} who={raiderName(row)}>
                  {officer && (
                    <>
                      <button
                        type="button"
                        className="button button-primary"
                        disabled={busy}
                        onClick={() =>
                          onDecide(
                            { row, to: 'approved' },
                            `Approved ${raiderName(row)}'s ${itemName(row)}. It counts as received.`
                          )
                        }
                      >
                        Approve
                      </button>
                      <button type="button" className="button" disabled={busy} onClick={() => setRejecting(row)}>
                        Reject
                      </button>
                    </>
                  )}
                </ReviewLine>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="card settings-card">
        <h2 className="section-title">Decided</h2>
        {!decided.length ? (
          <p className="text-muted">No decisions this season.</p>
        ) : (
          <>
            <label className="visually-hidden" htmlFor={searchId}>
              Search by raider, item, source or note
            </label>
            <input
              id={searchId}
              type="search"
              className="input"
              placeholder="Search by raider, item, source or note..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <p className="text-muted" role="status">
              {groups.length
                ? `${groups.length} raider${groups.length === 1 ? '' : 's'}.`
                : 'No decisions match your search.'}
            </p>
            <ul className="loot-review-groups">
              {groups.map((g) => (
                <li key={g.key}>
                  {/* One raider open at a time, as the officer menu (#869); a search
                      opens every raider it found instead, so the matches show. */}
                  <details open={searching || undefined} name={searching ? undefined : 'review-raiders'}>
                    <summary onClick={keepInPlace}>
                      <strong style={{ color: classColor(g.className) }}>{g.name}</strong>
                      <span className="text-muted">{groupCounts(g)}</span>
                    </summary>
                    <ul className="loot-review-list">
                      {g.rows.map((row) => (
                        <ReviewLine key={row.id} row={row} status>
                          {officer && (
                            <Menu
                              label={`More actions for ${g.name}'s ${itemName(row)}`}
                              actions={[
                                {
                                  label: 'Back to waiting',
                                  disabled: busy,
                                  onSelect: () =>
                                    onDecide(
                                      { row, to: 'pending' },
                                      `${g.name}'s ${itemName(row)} is waiting for review again.`
                                    )
                                },
                                { label: 'Delete', disabled: busy, onSelect: () => setDeleting(row) }
                              ]}
                            />
                          )}
                        </ReviewLine>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {rejecting && (
        <RejectDialog
          row={rejecting}
          busy={decide.isPending}
          onClose={() => setRejecting(null)}
          onReject={(reason) =>
            onDecide(
              { row: rejecting, to: 'rejected', reason },
              `Rejected ${raiderName(rejecting)}'s ${itemName(rejecting)}.`
            )
          }
        />
      )}
      {deleting && (
        <Dialog title="Delete this decision?" onClose={() => setDeleting(null)} busy={remove.isPending}>
          <p>
            {raiderName(deleting)}&apos;s {itemName(deleting)} ({deleting.status}) disappears from their profile. Use
            Back to waiting instead to change the decision.
          </p>
          <div className="dialog-actions">
            <span className="grow" />
            <button type="button" className="button" onClick={() => setDeleting(null)} disabled={remove.isPending}>
              Cancel
            </button>
            <button
              type="button"
              className="button button-danger"
              onClick={() => onDelete(deleting)}
              disabled={remove.isPending}
            >
              Delete
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

// Opening a raider closes the one open above it, which would pull the header
// just clicked up the page, out from under the pointer. Scroll by as much as
// it moved, so it stays put.
function keepInPlace(event: React.MouseEvent<HTMLElement>) {
  const header = event.currentTarget;
  const before = header.getBoundingClientRect().top;
  requestAnimationFrame(() => window.scrollBy(0, header.getBoundingClientRect().top - before));
}

// One request on one line: the raider (waiting list only), the item and its
// slot, the source, when it was sent, its decision, then the actions. The
// raider's note, or an officer's reason, sits on a small line below.
function ReviewLine({
  row,
  who,
  status = false,
  children
}: {
  row: ReviewRow;
  who?: string;
  status?: boolean;
  children: ReactNode;
}) {
  const slot = row.slot ?? row.items?.slot;
  return (
    <li className="loot-review">
      <div className="loot-review-line">
        {who && (
          <strong className="loot-review-who" style={{ color: classColor(row.players?.classes_specs?.class ?? '') }}>
            {who}
          </strong>
        )}
        <span className="loot-review-item">
          <ItemLink link={itemLinkData(row.items)}>{itemName(row)}</ItemLink>
          {slot && <span className="text-muted">{slot}</span>}
        </span>
        <span className="loot-review-source">{sourceLabel(row) || 'No source given'}</span>
        <span className="text-muted loot-review-when" title={formatInstant(row.submitted_at)}>
          {formatInstantShort(row.submitted_at)}
        </span>
        {status && (
          <span className={`loot-review-status loot-review-${row.status}`}>
            {row.status === 'approved' ? 'Approved' : 'Rejected'}
          </span>
        )}
        <span className="loot-review-actions">{children}</span>
      </div>
      {row.note && <p className="loot-review-note text-muted">&ldquo;{row.note}&rdquo;</p>}
      {row.status === 'rejected' && row.officer_notes && (
        <p className="loot-review-note text-muted">Reason: {row.officer_notes}</p>
      )}
    </li>
  );
}

function RejectDialog({
  row,
  busy,
  onClose,
  onReject
}: {
  row: ReviewRow;
  busy: boolean;
  onClose: () => void;
  onReject: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const reasonId = useId();
  return (
    <Dialog title={`Reject ${itemName(row)}?`} onClose={onClose} busy={busy}>
      <label className="field-label" htmlFor={reasonId}>
        Reason (optional, {raiderName(row)} sees it)
      </label>
      <textarea
        id={reasonId}
        className="textarea"
        rows={2}
        placeholder="For example: not on the wishlist for this character"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="dialog-actions">
        <span className="grow" />
        <button type="button" className="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="button button-danger" onClick={() => onReject(reason.trim())} disabled={busy}>
          Reject
        </button>
      </div>
    </Dialog>
  );
}
