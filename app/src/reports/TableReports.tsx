import { useState } from 'react';
import { DataState } from '../components/DataState';
import { useTeam } from '../data/address';
import { bothQueries } from '../data/query';
import { awardDate, formatInstant, localTimeZoneNote } from '../lib/dates';
import { classColor, toRoster, type PlayerRow, type Raider, type Role } from '../roster/roster';
import { useNames } from '../roster/useNames';
import { useRosterPlayers } from '../roster/useRoster';
import { ReportPage, RoleFilter } from './ReportPage';
import { SortableTable, type Column } from './SortableTable';
import { useRaidNightsSinceItem, type RaidNightsRow } from './useReports';

// Raid nights since last item and Tier sets (#1359 part 2): the current
// site's tab-reports.js tables, sortable by any column.

// The roster's rows by character, named as the Roster names them.
function useRaiders(teamId: number, players: PlayerRow[]): Raider[] {
  const names = useNames(teamId);
  return toRoster(players, [], names.data ?? []).flatMap((g) => g.raiders);
}

function RaiderName({ raider }: { raider: Raider }) {
  return (
    <>
      <span className="raider-name" style={{ color: classColor(raider.className) }}>
        {raider.name}
      </span>
      <span className="raider-spec">
        {raider.spec} {raider.className}
      </span>
    </>
  );
}

export function RaidNightsPage() {
  const team = useTeam();
  const data = bothQueries(useRosterPlayers(team.id), useRaidNightsSinceItem(team.id));
  return (
    <ReportPage
      title="Raid nights since last item"
      intro="How many of the team's raid nights each raider has gone without an item. Click a column to sort."
    >
      <DataState query={data} label="the report">
        {([players, rows]) => <RaidNights teamId={team.id} players={players} rows={rows} />}
      </DataState>
    </ReportPage>
  );
}

type NightsRow = { raider: Raider; lastAward: string | null; nights: number };

// The longest third of the waits stands out, then the middle third, relative
// to the longest on the page, as the current site colors them. The number is
// always written out.
const nightsTone = (nights: number, max: number) =>
  max > 0 && nights >= (max * 2) / 3 ? 'tone-bad' : max > 0 && nights >= max / 3 ? 'tone-warn' : undefined;

function RaidNights({ teamId, players, rows }: { teamId: number; players: PlayerRow[]; rows: RaidNightsRow[] }) {
  const [role, setRole] = useState<Role | null>(null);
  const byPlayer = new Map(rows.map((r) => [r.player_id, r]));
  const shown: NightsRow[] = useRaiders(teamId, players)
    .filter((r) => r.playerId !== null && (!role || r.role === role))
    .map((raider) => {
      const row = byPlayer.get(raider.playerId!);
      return { raider, lastAward: row?.last_award_at ?? null, nights: row?.raid_nights_since_last_item ?? 0 };
    });
  const max = Math.max(0, ...shown.map((r) => r.nights));
  const columns: Column<NightsRow>[] = [
    {
      key: 'raider',
      label: 'Raider',
      sortValue: (r) => r.raider.name,
      render: (r) => <RaiderName raider={r.raider} />
    },
    {
      key: 'last',
      label: 'Last item',
      // Never sorts below the oldest date.
      sortValue: (r) => r.lastAward ?? '',
      render: (r) => (r.lastAward ? awardDate(r.lastAward) : <span className="text-dim">Never</span>),
      firstDir: -1
    },
    {
      key: 'nights',
      label: 'Raid nights since',
      sortValue: (r) => r.nights,
      render: (r) => <span className={nightsTone(r.nights, max)}>{r.nights}</span>,
      firstDir: -1,
      numeric: true
    }
  ];
  return (
    <>
      <RoleFilter value={role} onChange={setRole} />
      {shown.length === 0 ? (
        <div className="card placeholder">
          <p>No one in this role.</p>
        </div>
      ) : (
        <SortableTable
          caption="Raid nights since last item"
          columns={columns}
          rows={shown}
          rowKey={(r) => r.raider.key}
          initial={{ key: 'nights', dir: -1 }}
        />
      )}
    </>
  );
}

export function TierSetsPage() {
  const team = useTeam();
  const players = useRosterPlayers(team.id);
  return (
    <ReportPage
      title="Tier sets"
      intro="Tier set pieces each raider has equipped, from their last gear sync. Click a column to sort."
    >
      <DataState query={players} label="the roster">
        {(rows) => <TierSets teamId={team.id} players={rows} />}
      </DataState>
    </ReportPage>
  );
}

type TierRow = { raider: Raider; count: number | null; syncedAt: string | null };

// Few pieces is the end to watch (#1359), as the current site colors it.
const tierTone = (count: number | null) =>
  count === null ? undefined : count <= 1 ? 'tone-bad' : count <= 3 ? 'tone-warn' : 'tone-good';

function TierSets({ teamId, players }: { teamId: number; players: PlayerRow[] }) {
  const [role, setRole] = useState<Role | null>(null);
  const synced = new Map(players.map((p) => [p.id, p.tier_pieces_synced_at ?? null]));
  const shown: TierRow[] = useRaiders(teamId, players)
    .filter((r) => r.playerId !== null && (!role || r.role === role))
    .map((raider) => ({ raider, count: raider.tierPieces, syncedAt: synced.get(raider.playerId!) ?? null }));
  const columns: Column<TierRow>[] = [
    {
      key: 'raider',
      label: 'Raider',
      sortValue: (r) => r.raider.name,
      render: (r) => <RaiderName raider={r.raider} />
    },
    {
      key: 'count',
      label: 'Tier pieces',
      // Never synced sorts below 0/5, so it doesn't read as a raider with none.
      sortValue: (r) => r.count ?? -1,
      render: (r) =>
        r.count === null ? (
          <span className="text-dim">Not synced</span>
        ) : (
          <span className={tierTone(r.count)}>{r.count}/5</span>
        ),
      numeric: true
    },
    {
      key: 'synced',
      label: 'Last synced',
      sortValue: (r) => r.syncedAt ?? '',
      render: (r) => (r.syncedAt ? formatInstant(r.syncedAt) : <span className="text-dim">Never</span>),
      firstDir: -1
    }
  ];
  return (
    <>
      <RoleFilter value={role} onChange={setRole} />
      {shown.length === 0 ? (
        <div className="card placeholder">
          <p>No one in this role.</p>
        </div>
      ) : (
        <>
          <SortableTable
            caption="Tier sets"
            columns={columns}
            rows={shown}
            rowKey={(r) => r.raider.key}
            initial={{ key: 'count', dir: 1 }}
          />
          <p className="text-dim report-note">{localTimeZoneNote()}</p>
        </>
      )}
    </>
  );
}
