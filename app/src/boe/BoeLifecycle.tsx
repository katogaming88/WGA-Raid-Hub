import { useId, useMemo, useState } from 'react';
import { canSettleBoe, can, useAccess, type Access } from '../auth/access';
import { Dialog } from '../components/Dialog';
import { DataState } from '../components/DataState';
import { useAddress } from '../data/address';
import { bothQueries } from '../data/query';
import { useSession } from '../auth/session';
import {
  boeDate,
  boeMoney,
  boeSummary,
  formatGold,
  groupByStatus,
  olderOpenTwin,
  parseGoldInput,
  finderPaid,
  guildKept,
  HISTORY_PAGE_SIZE,
  type BoeItemRow,
  type BoeListingRow
} from './boe';
import {
  useBoeCatalog,
  useBoeItems,
  useBoeListings,
  useEditBoeItem,
  useMarkPaid,
  useRecordListing,
  useRecordSale,
  useRetireBoe,
  useRevertBoe
} from './useBoe';

const TRACKS = ['Champion', 'Hero', 'Myth'];
const RANKS = ['1/6', '2/6', '3/6', '4/6', '5/6', '6/6'];

// The lifecycle view (#1305): Open / Awaiting Payout / History, plus a
// summary strip, ported from js/boe-manage.js. Rendered for anyone signed in
// (raiders included, per RLS's own-finds scoping); a signed-out visitor gets
// only the report form above this.
export function BoeLifecycle() {
  const { user } = useSession();
  const items = useBoeItems(user !== null);
  const listings = useBoeListings(user !== null);
  if (!user) return null;
  return (
    <div className="boe-lifecycle">
      <DataState query={bothQueries(items, listings)} label="the BoE data">
        {([itemRows, listingRows]) => <BoeLifecycleView items={itemRows} listings={listingRows} />}
      </DataState>
    </div>
  );
}

type Action =
  | { type: 'listing'; item: BoeItemRow }
  | { type: 'sale'; item: BoeItemRow }
  | { type: 'edit'; item: BoeItemRow }
  | { type: 'retire'; item: BoeItemRow }
  | { type: 'undo-sale'; item: BoeItemRow }
  | { type: 'undo-payout'; item: BoeItemRow };

function BoeLifecycleView({ items, listings }: { items: BoeItemRow[]; listings: BoeListingRow[] }) {
  const { teams } = useAddress();
  const access = useAccess();
  const [action, setAction] = useState<Action | null>(null);
  const [historyPage, setHistoryPage] = useState(0);
  const revert = useRevertBoe();

  const manage = can(access.data, 'manageBoe');
  const isRaiderView = !manage && !(access.data?.teams.some((t) => t.role === 'officer' || t.role === 'team_leader') ?? false);
  const teamName = (teamId: number) => teams.find((t) => t.id === teamId)?.name ?? `Team ${teamId}`;

  const sections = useMemo(() => groupByStatus(items), [items]);
  const summary = useMemo(() => boeSummary(items), [items]);
  const listingsByItem = useMemo(() => {
    const map = new Map<number, BoeListingRow[]>();
    for (const l of listings) {
      const list = map.get(l.boe_item_id) ?? [];
      list.push(l);
      map.set(l.boe_item_id, list);
    }
    return map;
  }, [listings]);

  const pageCount = Math.max(1, Math.ceil(sections.history.length / HISTORY_PAGE_SIZE));
  const clampedPage = Math.min(historyPage, pageCount - 1);
  const historyRows = sections.history.slice(clampedPage * HISTORY_PAGE_SIZE, clampedPage * HISTORY_PAGE_SIZE + HISTORY_PAGE_SIZE);

  const onUnretire = (item: BoeItemRow) => revert.mutate({ id: item.id });

  return (
    <>
      <SummaryStrip summary={summary} isRaiderView={isRaiderView} manage={manage} teamName={teamName} />

      <h2 className="boe-section-heading">Open</h2>
      {sections.open.length === 0 ? (
        <p className="text-muted boe-empty">No open BoEs. Found items land here from the raider form.</p>
      ) : (
        <div className="boe-table-wrap">
          <table className="boe-table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Team</th>
                <th scope="col">Finder</th>
                <th scope="col">Found</th>
                <th scope="col">Status</th>
                <th scope="col">Listings</th>
                {manage && <th scope="col">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {sections.open.map((item) => (
                <tr key={item.id}>
                  <td>{itemCell(item)}</td>
                  <td className="text-muted">{teamName(item.team_id)}</td>
                  <td>{item.finder_name || ''}</td>
                  <td>{boeDate(item.found_at)}</td>
                  <td>{statusBadge(item)}</td>
                  <td>
                    {(listingsByItem.get(item.id) ?? []).map((l) => (
                      <div key={l.id}>
                        {boeDate(l.listed_at)}: {formatGold(l.price)}g
                      </div>
                    ))}
                  </td>
                  {manage && (
                    <td>
                      <div className="boe-actions">
                        <button type="button" className="button" onClick={() => setAction({ type: 'listing', item })}>
                          Record Listing
                        </button>
                        <button type="button" className="button" onClick={() => setAction({ type: 'sale', item })}>
                          Record Sale
                        </button>
                        <button type="button" className="button" onClick={() => setAction({ type: 'retire', item })}>
                          Retire
                        </button>
                        <button type="button" className="button" onClick={() => setAction({ type: 'edit', item })}>
                          Edit
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="boe-section-heading">Awaiting Payout</h2>
      {sections.awaiting.length === 0 ? (
        <p className="text-muted boe-empty">Nothing awaiting payout.</p>
      ) : (
        <AwaitingTable
          rows={sections.awaiting}
          access={access.data}
          manage={manage}
          teamName={teamName}
          onAction={setAction}
        />
      )}

      <h2 className="boe-section-heading">History</h2>
      {sections.history.length === 0 ? (
        <p className="text-muted boe-empty">No paid or retired BoEs yet.</p>
      ) : (
        <>
          <HistoryTable
            rows={historyRows}
            access={access.data}
            manage={manage}
            teamName={teamName}
            onAction={setAction}
            onUnretire={onUnretire}
          />
          {pageCount > 1 && (
            <div className="boe-pager">
              <button type="button" className="button" disabled={clampedPage <= 0} onClick={() => setHistoryPage(clampedPage - 1)}>
                Previous
              </button>
              <button
                type="button"
                className="button"
                disabled={clampedPage >= pageCount - 1}
                onClick={() => setHistoryPage(clampedPage + 1)}
              >
                Next
              </button>
              <span className="text-dim">
                Showing {clampedPage * HISTORY_PAGE_SIZE + 1} to {clampedPage * HISTORY_PAGE_SIZE + historyRows.length} of{' '}
                {sections.history.length}
              </span>
            </div>
          )}
        </>
      )}

      {action?.type === 'listing' && <ListingDialog item={action.item} onClose={() => setAction(null)} />}
      {action?.type === 'sale' && <SaleDialog item={action.item} items={items} onClose={() => setAction(null)} />}
      {action?.type === 'edit' && <EditDialog item={action.item} onClose={() => setAction(null)} />}
      {action?.type === 'retire' && (
        <ConfirmActionDialog
          title="Retire this BoE?"
          message={`Retire ${action.item.item_name}? It leaves the open list; the row stays in History.`}
          confirmLabel="Retire"
          kind="retire"
          item={action.item}
          onClose={() => setAction(null)}
        />
      )}
      {action?.type === 'undo-sale' && (
        <ConfirmActionDialog
          title="Undo this sale?"
          message={`Undo the sale of ${action.item.item_name}? The sale price and the split are cleared.`}
          confirmLabel="Undo Sale"
          kind="revert"
          item={action.item}
          onClose={() => setAction(null)}
        />
      )}
      {action?.type === 'undo-payout' && (
        <ConfirmActionDialog
          title="Undo this payout?"
          message={`Undo the payout on ${action.item.item_name}? It goes back to Awaiting Payout.`}
          confirmLabel="Undo Payout"
          kind="revert"
          item={action.item}
          onClose={() => setAction(null)}
        />
      )}
    </>
  );
}

function itemCell(item: BoeItemRow) {
  const badge = [item.track, item.upgrade_rank].filter(Boolean).join(' ');
  return (
    <>
      {item.item_name}
      {badge && <span className="badge boe-badge">{badge}</span>}
      {item.note && <div className="text-muted boe-note">{item.note}</div>}
    </>
  );
}

const STATUS_LABEL: Record<string, string> = { found: 'Found', listed: 'Listed', sold: 'Sold', paid: 'Paid', retired: 'Retired' };
const STATUS_CLASS: Record<string, string> = {
  found: 'boe-status-open',
  listed: 'boe-status-open',
  sold: 'boe-status-good',
  paid: 'boe-status-muted',
  retired: 'boe-status-bad'
};

function statusBadge(item: BoeItemRow) {
  if (item.status === 'paid' && item.payout_donated) {
    return <span className="boe-status boe-status-muted">Donated</span>;
  }
  return (
    <>
      <span className={`boe-status ${STATUS_CLASS[item.status] ?? ''}`}>{STATUS_LABEL[item.status] ?? item.status}</span>
      {item.payout_donated && item.status !== 'paid' && item.status !== 'retired' && (
        <span className="text-dim boe-donating"> Donating</span>
      )}
    </>
  );
}

function AwaitingTable({
  rows,
  access,
  manage,
  teamName,
  onAction
}: {
  rows: BoeItemRow[];
  access: Access | null | undefined;
  manage: boolean;
  teamName: (id: number) => string;
  onAction: (a: Action) => void;
}) {
  const showActions = manage || rows.some((item) => canSettleBoe(access, item.team_id));
  return (
    <div className="boe-table-wrap">
      <table className="boe-table">
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Team</th>
            <th scope="col">Finder</th>
            <th scope="col">Sold</th>
            <th scope="col">Sale</th>
            <th scope="col">AH fee</th>
            <th scope="col">Finder payout</th>
            <th scope="col">Guild cut (net)</th>
            <th scope="col">Status</th>
            {showActions && <th scope="col">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.id}>
              <td>{itemCell(item)}</td>
              <td className="text-muted">{teamName(item.team_id)}</td>
              <td>{item.finder_name || ''}</td>
              <td>{boeDate(item.sold_at)}</td>
              <td>{boeMoney(item.sale_price)}</td>
              <td>{boeMoney(item.ah_fee)}</td>
              <td>{boeMoney(item.finder_payout)}</td>
              <td>{boeMoney(item.guild_cut)}</td>
              <td>{statusBadge(item)}</td>
              {showActions && (
                <td>
                  <div className="boe-actions">
                    {canSettleBoe(access, item.team_id) && (
                      <>
                        <MarkPaidButton item={item} donated={false} label="Mark Paid" />
                        <MarkPaidButton item={item} donated={true} label="Donate to Guild" />
                      </>
                    )}
                    {manage && (
                      <>
                        <button type="button" className="button" onClick={() => onAction({ type: 'undo-sale', item })}>
                          Undo Sale
                        </button>
                        <button type="button" className="button" onClick={() => onAction({ type: 'edit', item })}>
                          Edit
                        </button>
                      </>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryTable({
  rows,
  access,
  manage,
  teamName,
  onAction,
  onUnretire
}: {
  rows: BoeItemRow[];
  access: Access | null | undefined;
  manage: boolean;
  teamName: (id: number) => string;
  onAction: (a: Action) => void;
  onUnretire: (item: BoeItemRow) => void;
}) {
  const showActions = manage || rows.some((item) => item.status === 'paid' && canSettleBoe(access, item.team_id));
  return (
    <div className="boe-table-wrap">
      <table className="boe-table">
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Team</th>
            <th scope="col">Finder</th>
            <th scope="col">Status</th>
            <th scope="col">Date</th>
            <th scope="col">Sale</th>
            <th scope="col">AH fee</th>
            <th scope="col">Finder payout</th>
            <th scope="col">Guild cut (net)</th>
            {showActions && <th scope="col">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.id}>
              <td>{itemCell(item)}</td>
              <td className="text-muted">{teamName(item.team_id)}</td>
              <td>{item.finder_name || ''}</td>
              <td>{statusBadge(item)}</td>
              <td>{boeDate(item.payout_paid_at || item.retired_at)}</td>
              <td>{boeMoney(item.sale_price)}</td>
              <td>{boeMoney(item.ah_fee)}</td>
              <td>{boeMoney(finderPaid(item))}</td>
              <td>{boeMoney(guildKept(item))}</td>
              {showActions && (
                <td>
                  <div className="boe-actions">
                    {item.status === 'paid'
                      ? canSettleBoe(access, item.team_id) && (
                          <button type="button" className="button" onClick={() => onAction({ type: 'undo-payout', item })}>
                            Undo Payout
                          </button>
                        )
                      : manage && (
                          <button type="button" className="button" onClick={() => onUnretire(item)}>
                            Un-retire
                          </button>
                        )}
                    {manage && (
                      <button type="button" className="button" onClick={() => onAction({ type: 'edit', item })}>
                        Edit
                      </button>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MarkPaidButton({ item, donated, label }: { item: BoeItemRow; donated: boolean; label: string }) {
  const markPaid = useMarkPaid();
  return (
    <button
      type="button"
      className="button"
      disabled={markPaid.isPending}
      onClick={() => markPaid.mutate({ id: item.id, donated })}
    >
      {label}
    </button>
  );
}

function SummaryStrip({
  summary,
  isRaiderView,
  manage,
  teamName
}: {
  summary: ReturnType<typeof boeSummary>;
  isRaiderView: boolean;
  manage: boolean;
  teamName: (id: number) => string;
}) {
  return (
    <div className="boe-summary">
      <div className="boe-summary-line">
        {!isRaiderView && (
          <span>
            Guild income to date: <strong className="boe-gold">{formatGold(summary.guildIncome)}g</strong>
          </span>
        )}
        <span>
          Outstanding payouts: <strong className="boe-gold">{formatGold(summary.outstanding)}g</strong>
        </span>
        {summary.donated > 0 && (
          <span>
            Donated by finders: <strong className="boe-gold">{formatGold(summary.donated)}g</strong>
          </span>
        )}
      </div>
      {summary.byTeam.length >= 2 && (
        <div className="text-muted boe-team-credit">
          Found by team:{' '}
          {summary.byTeam
            .map((t) => `${teamName(t.teamId)} ${t.found} (${formatGold(t.gold)}g)`)
            .join(' · ')}
        </div>
      )}
      {!manage && (
        <p className="text-muted boe-scope-note">
          {isRaiderView
            ? "These are the BoEs reported under your character, plus anything you reported while signed in. Officers and BoE managers handle listing, sale and payout, and mail you your cut once the item sells."
            : 'You can settle payouts (Mark Paid, Donate to Guild, Undo Payout) on the finds of the teams you staff. Listing, sale, retiring and edits need the BoE manager grant, assigned by a site admin. The totals above cover your own teams; a BoE manager sees the whole guild.'}
        </p>
      )}
    </div>
  );
}

function ConfirmActionDialog({
  title,
  message,
  confirmLabel,
  kind,
  item,
  onClose
}: {
  title: string;
  message: string;
  confirmLabel: string;
  kind: 'retire' | 'revert';
  item: BoeItemRow;
  onClose: () => void;
}) {
  const retire = useRetireBoe();
  const revert = useRevertBoe();
  const action = kind === 'retire' ? retire : revert;
  return (
    <Dialog title={title} onClose={onClose} busy={action.isPending}>
      <p>{message}</p>
      {action.isError && (
        <p className="form-error" role="alert">
          {action.error.message}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onClose} disabled={action.isPending}>
          Cancel
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={action.isPending}
          onClick={() => action.mutate({ id: item.id }, { onSuccess: onClose })}
        >
          {action.isPending ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

function ListingDialog({ item, onClose }: { item: BoeItemRow; onClose: () => void }) {
  const record = useRecordListing();
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const id = useId();
  const parsed = parseGoldInput(price);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (parsed === null) return;
    record.mutate({ id: item.id, price: parsed, note: note.trim() || null }, { onSuccess: onClose });
  };

  return (
    <Dialog title={`Record listing: ${item.item_name}`} onClose={onClose} busy={record.isPending}>
      <form onSubmit={onSubmit} noValidate>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-price`}>
            Listing price in gold
          </label>
          <input
            id={`${id}-price`}
            className="input"
            value={price}
            placeholder="Price, like 250,000"
            aria-invalid={tried && parsed === null}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-note`}>
            Note (optional)
          </label>
          <input id={`${id}-note`} className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {tried && parsed === null && (
          <p className="form-error" role="alert">
            Enter a price in gold, like 250,000.
          </p>
        )}
        {record.isError && (
          <p className="form-error" role="alert">
            {record.error.message}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose} disabled={record.isPending}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={record.isPending}>
            {record.isPending ? 'Working…' : 'Confirm Listing'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function SaleDialog({ item, items, onClose }: { item: BoeItemRow; items: BoeItemRow[]; onClose: () => void }) {
  const record = useRecordSale();
  const [price, setPrice] = useState('');
  const [tried, setTried] = useState(false);
  const [warned, setWarned] = useState(false);
  const id = useId();
  const parsed = parseGoldInput(price);
  const twin = useMemo(() => olderOpenTwin(items, item), [items, item]);

  const submit = (priceValue: number) => record.mutate({ id: item.id, price: priceValue }, { onSuccess: onClose });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (parsed === null || parsed <= 0) return;
    if (twin && !warned) {
      setWarned(true);
      return;
    }
    submit(parsed);
  };

  return (
    <Dialog title={`Record sale: ${item.item_name}`} onClose={onClose} busy={record.isPending}>
      {warned && twin ? (
        <>
          <p role="alert">
            An older {twin.item_name} on {twin.track || 'no track'} is still open: {twin.finder_name || 'unknown finder'},
            reported {boeDate(twin.found_at)}. Cuts go to the first finder at the same rank. Record this sale anyway?
          </p>
          {record.isError && (
            <p className="form-error" role="alert">
              {record.error.message}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="button" onClick={() => setWarned(false)} disabled={record.isPending}>
              Back
            </button>
            <button type="button" className="button button-primary" disabled={record.isPending} onClick={() => submit(parsed!)}>
              {record.isPending ? 'Working…' : 'Record sale anyway'}
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-price`}>
              Sale price in gold
            </label>
            <input
              id={`${id}-price`}
              className="input"
              value={price}
              placeholder="Sale price, like 250,000"
              aria-invalid={tried && (parsed === null || parsed <= 0)}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          {tried && (parsed === null || parsed <= 0) && (
            <p className="form-error" role="alert">
              Enter a price in gold, like 250,000.
            </p>
          )}
          {record.isError && (
            <p className="form-error" role="alert">
              {record.error.message}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="button" onClick={onClose} disabled={record.isPending}>
              Cancel
            </button>
            <button type="submit" className="button button-primary" disabled={record.isPending}>
              {record.isPending ? 'Working…' : 'Confirm Sale'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function EditDialog({ item, onClose }: { item: BoeItemRow; onClose: () => void }) {
  const edit = useEditBoeItem();
  const catalog = useBoeCatalog();
  const [name, setName] = useState(item.item_name);
  const [track, setTrack] = useState(item.track ?? '');
  const [rank, setRank] = useState(item.upgrade_rank ?? '');
  const [note, setNote] = useState(item.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Enter the item name.');
      return;
    }
    setError(null);
    const hit = (catalog.data ?? []).find((c) => c.name.toLowerCase() === trimmedName.toLowerCase());
    const values = {
      itemName: hit ? hit.name : trimmedName,
      track: track || null,
      note: note.trim() || null,
      itemId: hit ? hit.id : null,
      rank: rank || null
    };
    const unchanged =
      values.itemName === item.item_name &&
      values.track === (item.track ?? null) &&
      values.note === (item.note ?? null) &&
      values.rank === (item.upgrade_rank ?? null);
    if (unchanged) {
      onClose();
      return;
    }
    edit.mutate({ id: item.id, ...values }, { onSuccess: onClose });
  };

  return (
    <Dialog title={`Edit find: ${item.item_name}`} onClose={onClose} busy={edit.isPending}>
      <form onSubmit={onSubmit} noValidate>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-name`}>
            Item name
          </label>
          <input id={`${id}-name`} className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-track`}>
            Track
          </label>
          <select id={`${id}-track`} className="select" value={track} onChange={(e) => setTrack(e.target.value)}>
            <option value="">No track</option>
            {TRACKS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-rank`}>
            Upgrade rank
          </label>
          <select id={`${id}-rank`} className="select" value={rank} onChange={(e) => setRank(e.target.value)}>
            <option value="">No rank</option>
            {RANKS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-note`}>
            Note (optional)
          </label>
          <textarea id={`${id}-note`} className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {edit.isError && (
          <p className="form-error" role="alert">
            {edit.error.message}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose} disabled={edit.isPending}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={edit.isPending}>
            {edit.isPending ? 'Working…' : 'Save'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
