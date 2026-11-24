import { useId, useState } from 'react';
import { usePageCan } from '../auth/access';
import { DataState } from '../components/DataState';
import { ItemLink } from '../components/ItemLink';
import { useStatus } from '../components/Status';
import { errorMessage } from '../lib/errors';
import { useWishlist } from '../profile/useProfile';
import type { Pick } from '../profile/wishlist';
import { MARKS } from '../profile/wishlist';
import {
  bestPerItem,
  DIFFICULTY_LABELS,
  DIFFICULTY_ORDER,
  formatGain,
  isCharacter,
  isStale,
  parseSimLink,
  simAgeDays,
  slotLabel,
  SOURCE_LABELS
} from './sims';
import {
  readReport,
  usePlayerSims,
  useRemoveSim,
  useSaveSims,
  useSimStaleDays,
  type KnownItem,
  type SavedSim
} from './useSims';
import './sims.css';

// Profile > Sims (#1443): the raider, or an officer who manages loot, pastes a
// Raidbots droptimizer or QE Live upgrade report link. One sim per difficulty;
// a new one replaces the old. Out of date after the team's number of days.
export function SimsTab({
  player,
  teamId,
  own,
  wishlists,
  seasonCode
}: {
  player: { id: number; name_realm: string };
  teamId: number;
  own: boolean;
  // Whether the team uses wishlists (not on Loot council), and the season
  // whose marks show beside each item.
  wishlists: boolean;
  seasonCode: string | null;
}) {
  const { can } = usePageCan();
  const wishlist = useWishlist(player.id);
  const picks: Pick[] | null = !wishlists
    ? null
    : wishlist.isSuccess
      ? wishlist.data.filter((p) => !p.season || p.season === seasonCode)
      : [];
  const canAdd = own || can('manageLoot');
  const sims = usePlayerSims(player.id);
  const staleDays = useSimStaleDays(teamId);
  return (
    <section className="card profile-card" aria-labelledby="sims-title">
      <h2 id="sims-title" className="card-title">
        Sims
      </h2>
      {canAdd && <AddSim player={player} own={own} />}
      <DataState query={sims} label="sims">
        {({ sims: saved, items }) =>
          saved.length ? (
            DIFFICULTY_ORDER.flatMap((d) => saved.filter((s) => s.difficulty === d)).map((sim) => (
              <SimTable
                key={sim.id}
                sim={sim}
                items={items}
                picks={picks}
                staleDays={staleDays.isSuccess ? staleDays.data : null}
                playerId={player.id}
                canRemove={canAdd}
              />
            ))
          ) : (
            <p className="text-muted card-note">No sims yet.</p>
          )
        }
      </DataState>
    </section>
  );
}

function AddSim({ player, own }: { player: { id: number; name_realm: string }; own: boolean }) {
  const id = useId();
  const { announce } = useStatus();
  const save = useSaveSims(player.id);
  const [link, setLink] = useState('');
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const busy = reading || save.isPending;

  const onAdd = async () => {
    setProblem(null);
    const parsed = parseSimLink(link);
    if ('error' in parsed) return setProblem(parsed.error);
    setReading(true);
    const report = await readReport(parsed);
    setReading(false);
    if ('error' in report) return setProblem(report.error);
    if (!isCharacter(player.name_realm, report.character)) {
      const who = [report.character.name, report.character.realm].filter(Boolean).join('-');
      return setProblem(`That report is for ${who}, not ${player.name_realm}.`);
    }
    save.mutate(report, {
      onSuccess: () => {
        setLink('');
        const names = report.sims.map((s) => DIFFICULTY_LABELS[s.difficulty]).join(' and ');
        announce('success', `Added the ${names} sim from ${SOURCE_LABELS[report.source]}.`);
      },
      onError: (error) => setProblem(errorMessage(error))
    });
  };

  return (
    <form
      className="sims-add"
      onSubmit={(e) => {
        e.preventDefault();
        void onAdd();
      }}
    >
      <label className="field-label" htmlFor={id}>
        Raidbots droptimizer or QE Live upgrade report link
      </label>
      <p className="text-muted sims-hint" id={`${id}-hint`}>
        DPS and tanks: a Raidbots droptimizer. Healers: QE Live’s Upgrade Finder.{' '}
        {own
          ? 'A new sim replaces your one at the same difficulty.'
          : 'A new sim replaces the one at the same difficulty.'}
      </p>
      <div className="sims-add-row">
        <input
          id={id}
          className="input sims-link"
          type="url"
          inputMode="url"
          placeholder="https://www.raidbots.com/simbot/report/…"
          aria-describedby={`${id}-hint${problem ? ` ${id}-problem` : ''}`}
          aria-invalid={problem ? true : undefined}
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
        <button type="submit" className="button button-primary" disabled={busy || !link.trim()}>
          {busy ? 'Adding…' : 'Add sim'}
        </button>
      </div>
      {problem && (
        <p className="form-error" id={`${id}-problem`} role="alert">
          {problem}
        </p>
      )}
    </form>
  );
}

const reportUrl = (sim: SavedSim) =>
  sim.source === 'raidbots'
    ? `https://www.raidbots.com/simbot/report/${sim.report_id}`
    : `https://questionablyepic.com/live/upgradereport/${sim.report_id}`;

const ageText = (days: number) => (days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`);

function SimTable({
  sim,
  items,
  picks,
  staleDays,
  playerId,
  canRemove
}: {
  sim: SavedSim;
  items: KnownItem[];
  picks: Pick[] | null;
  staleDays: number | null;
  playerId: number;
  canRemove: boolean;
}) {
  const { announce } = useStatus();
  const remove = useRemoveSim(playerId);
  const byWowId = new Map(items.map((i) => [i.wow_item_id, i]));
  const markOf = (wowId: number) => {
    const item = byWowId.get(wowId);
    const pick = item && picks?.find((p) => p.item_id === item.id && p.status !== '');
    return pick ? (MARKS.find((m) => m.mark === pick.status)?.label ?? '') : '';
  };
  const label = DIFFICULTY_LABELS[sim.difficulty];
  const stale = staleDays !== null && isStale(sim.simmed_at, staleDays);
  const rows = bestPerItem(sim.character_sim_results).filter((r) => Number(r.pct_gain) > 0);
  const titleId = `sim-${sim.id}-title`;

  return (
    <div className={`sims-sim${stale ? ' sims-stale' : ''}`}>
      <h3 id={titleId} className="sims-title">
        {label}
      </h3>
      <p className="sims-meta">
        <a href={reportUrl(sim)} target="_blank" rel="noopener noreferrer">
          {SOURCE_LABELS[sim.source]}
        </a>
        <span aria-hidden="true"> · </span>
        <span>simmed {ageText(simAgeDays(sim.simmed_at))}</span>
        {sim.fight_style && (
          <>
            <span aria-hidden="true"> · </span>
            <span>
              {sim.fight_style}
              {sim.target_count && sim.target_count > 1 ? `, ${sim.target_count} targets` : ''}
            </span>
          </>
        )}
        {staleDays !== null && (
          <>
            <span aria-hidden="true"> · </span>
            <span className={stale ? 'sims-old' : 'sims-fresh'}>{stale ? 'Out of date' : 'Up to date'}</span>
          </>
        )}
        {canRemove && (
          <button
            type="button"
            className="button sims-remove"
            disabled={remove.isPending}
            aria-label={`Remove the ${label} sim`}
            onClick={() =>
              remove.mutate(sim.difficulty, {
                onSuccess: () => announce('success', `Removed the ${label} sim.`),
                onError: (error) => announce('error', errorMessage(error))
              })
            }
          >
            Remove
          </button>
        )}
      </p>
      {rows.length ? (
        <div className="profile-table-wrap">
          <table className="profile-table sims-table" aria-labelledby={titleId}>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Slot</th>
                <th scope="col" className="col-num">
                  Item level
                </th>
                <th scope="col" className="col-num">
                  Gain
                </th>
                {picks && <th scope="col">Wishlist</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const known = byWowId.get(r.wow_item_id);
                const name = known?.name ?? r.item_name ?? `Item ${r.wow_item_id}`;
                return (
                  <tr key={r.id}>
                    <th scope="row">
                      <ItemLink link={{ wowId: r.wow_item_id, ptr: known?.is_ptr ?? false, icon: known?.icon ?? null }}>
                        {name}
                      </ItemLink>
                    </th>
                    <td className="gear-slot">{slotLabel(r.slot)}</td>
                    <td className="col-num num">{r.item_level}</td>
                    <td className="col-num num">{formatGain(Number(r.pct_gain))}</td>
                    {picks && <td>{markOf(r.wow_item_id)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted card-note">Nothing in this sim is an upgrade.</p>
      )}
    </div>
  );
}
