import type { UseQueryResult } from '@tanstack/react-query';
import { DataState } from '../components/DataState';
import { bothQueries } from '../data/query';
import { latestSelfReceivedUpdate, lootPriority, sourceTag, type PriorityRow, type Standing } from './lootPriority';
import { MarkReceivedButton } from './ProfileForms';
import { wishlistSummary } from './wishlist';
import { timeAgoLabel, type LootRow, type SeasonWindow } from './profile';
import {
  useCatalog,
  useItemRanks,
  useRaidZones,
  useRequestSettings,
  useSelfReceived,
  useTierTokens,
  useWishlist,
  type ProfilePlayer
} from './useProfile';

// A read that may be switched off (nothing to ask yet) counts as an empty
// answer rather than as loading forever.
function orEmpty<T>(query: UseQueryResult<T[]>, enabled: boolean): UseQueryResult<T[]> {
  return enabled ? query : ({ ...query, isPending: false, isSuccess: true, isError: false, data: [] } as never);
}

export function LootPriorityCard({
  player,
  teamId,
  season,
  loot,
  own
}: {
  player: ProfilePlayer;
  teamId: number;
  season: UseQueryResult<SeasonWindow>;
  loot: UseQueryResult<LootRow[]>;
  // The signed-in raider's own character, which they can mark items received for.
  own: boolean;
}) {
  const settings = useRequestSettings(teamId);
  const canReport = own && settings.isSuccess && settings.data.reports;
  const wishlist = useWishlist(player.id);
  const catalog = useCatalog();
  const zones = useRaidZones();
  const selfReceived = useSelfReceived(player.id);
  const seasonCode = season.isSuccess ? season.data.code : null;
  const className = player.classes_specs?.class ?? null;
  const pickedIds = wishlist.isSuccess ? wishlist.data.filter((w) => w.status === 'bis').map((w) => w.item_id) : [];
  const ranksEnabled = seasonCode !== null && pickedIds.length > 0;
  const ranks = orEmpty(useItemRanks(teamId, seasonCode, pickedIds), ranksEnabled);
  const tiers = orEmpty(useTierTokens(seasonCode, className), seasonCode !== null && className !== null);

  const reads = bothQueries(
    bothQueries(bothQueries(season, wishlist), bothQueries(catalog, zones)),
    bothQueries(bothQueries(ranks, tiers), bothQueries(loot, selfReceived))
  );

  return (
    <section className="card profile-card" aria-labelledby="priority-title">
      <div className="card-heading">
        <h2 id="priority-title" className="card-title">
          BIS List & Personal Loot priority
        </h2>
        <p className="text-muted card-note">Where this raider stands for each BiS pick this season.</p>
      </div>
      <DataState query={reads} label="bis list and personal loot priority">
        {([[[s, w], [c, z]], [[r, t], [l, sr]]]) => (
          <PriorityTable
            player={player}
            canReport={canReport}
            updatedLabel={timeAgoLabel(latestSelfReceivedUpdate(sr))}
            rows={lootPriority({
              playerId: player.id,
              wishlist: w,
              catalog: c,
              zones: z,
              season: s,
              ranks: r,
              tierTokens: t,
              loot: l,
              selfReceived: sr
            })}
          />
        )}
      </DataState>
    </section>
  );
}

function StandingCell({ standing }: { standing: Standing | undefined }) {
  if (!standing) {
    return (
      <span className="text-dim">
        <span aria-hidden="true">–</span>
        <span className="visually-hidden">Not ranked</span>
      </span>
    );
  }
  return (
    <span className={standing.rank === 1 ? 'standing standing-first' : 'standing'}>
      <span className="num">#{standing.rank}</span> <span className="standing-of">of {standing.of}</span>
    </span>
  );
}

function PriorityTable({
  rows,
  player,
  canReport,
  updatedLabel
}: {
  rows: PriorityRow[];
  player: ProfilePlayer;
  canReport: boolean;
  updatedLabel: string;
}) {
  if (!rows.length) {
    return <p className="text-muted card-note">No BiS picks on the wishlist for this season yet.</p>;
  }
  return (
    <div className="profile-table-wrap">
      {updatedLabel && <p className="priority-updated">Updated {updatedLabel}</p>}
      <table className="profile-table priority-table">
        <caption className="visually-hidden">Loot priority for each BiS pick</caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Heroic</th>
            <th scope="col">Mythic</th>
            <th scope="col">Status</th>
            {/* Its own column so the buttons line up, whatever the status
                reads (#1195). Left out entirely when there is nothing to
                mark, rather than leaving an empty column on every row. */}
            {canReport && (
              <th scope="col">
                <span className="visually-hidden">Mark received</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} data-placeholder={row.placeholder || undefined}>
              <th scope="row">
                <span className="priority-item">
                  {row.item}
                  {sourceTag(row.source) && <span className="source-tag">{sourceTag(row.source)}</span>}
                </span>
                <span className="priority-slot">{row.slot}</span>
              </th>
              <td className="priority-heroic">
                <StandingCell standing={row.ranks.find((r) => r.track === 'Heroic')} />
              </td>
              <td className="priority-mythic">
                <StandingCell standing={row.ranks.find((r) => r.track === 'Mythic')} />
              </td>
              <td className="priority-status">
                {row.received ? (
                  <span className="received">
                    <span className="received-label">Received</span>{' '}
                    {row.received.track && (
                      <span className={`difficulty difficulty-${row.received.track.toLowerCase()} received-track`}>
                        {row.received.track}
                      </span>
                    )}{' '}
                    <span className="received-detail">{row.received.detail}</span>
                  </span>
                ) : (
                  <span className="text-muted">Wanted</span>
                )}
              </td>
              {canReport && (
                <td className="priority-action">
                  {/* Until a Mythic copy is on file, as on the current site. */}
                  {row.received?.track !== 'Mythic' && <MarkReceivedButton player={player} row={row} />}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WishlistSummaryCard({
  player,
  season
}: {
  player: ProfilePlayer;
  season: UseQueryResult<SeasonWindow>;
}) {
  const reads = bothQueries(bothQueries(season, useWishlist(player.id)), bothQueries(useCatalog(), useRaidZones()));
  return (
    <section className="card profile-card" aria-labelledby="wishlist-title">
      <h2 id="wishlist-title" className="card-title">
        Wishlist
      </h2>
      <DataState query={reads} label="the wishlist">
        {([[s, w], [c, z]]) => {
          const summary = wishlistSummary(w, c, z, s);
          return (
            <p className="wishlist-summary">
              <span className="num wishlist-bis">{summary.bis}</span> of {summary.total} slots have a BiS pick
              {summary.pass > 0 && (
                <>
                  , <span className="num wishlist-pass">{summary.pass}</span> passed
                </>
              )}
              .
            </p>
          );
        }}
      </DataState>
    </section>
  );
}
