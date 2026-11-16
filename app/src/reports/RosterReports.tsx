import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { DataState } from '../components/DataState';
import { useTeam } from '../data/address';
import { bothQueries } from '../data/query';
import type { CatalogItem, ZoneRow } from '../profile/lootPriority';
import { useCatalog, useCurrentSeason, useRaidZones } from '../profile/useProfile';
import { wishlistProgress, type WishlistProgress } from '../profile/wishlist';
import { classColor, toRoster, type PlayerRow, type Raider, type Role } from '../roster/roster';
import type { NameRow } from '../roster/names';
import { useNames } from '../roster/useNames';
import { useRosterPlayers } from '../roster/useRoster';
import { ReportPage, RoleFilter } from './ReportPage';
import { SortableTable, type Column } from './SortableTable';
import { useTeamWishlists, type TeamWishlistRow } from './useReports';

// Two roster reports (#1344): who nobody has claimed, and how far each
// raider's wishlist is.

type UnclaimedRow = { key: string; name: string; detail: string; className: string | null; kind: string };

// A roster character with no Member behind it, or a Member an officer typed in
// that nobody has claimed (#1355): both are a spot an officer has to chase.
export function unclaimedRows(players: PlayerRow[], names: NameRow[]): UnclaimedRow[] {
  const characters: UnclaimedRow[] = players
    .filter((p) => p.team_member_id == null && p.name_realm.trim())
    .map((p) => ({
      key: `player-${p.id}`,
      name: p.nickname?.trim() || p.name_realm.split('-')[0]!.trim(),
      detail: p.classes_specs ? `${p.classes_specs.spec} ${p.classes_specs.class}` : 'No spec yet',
      className: p.classes_specs?.class ?? null,
      kind: 'Character'
    }));
  // Bare Names with or without a role guess: neither has a claimer.
  const members: UnclaimedRow[] = names
    .filter((n) => n.team_member_id === null)
    .map((n) => ({
      key: `name-${n.id}`,
      name: n.label,
      detail: n.role ?? 'No character yet',
      className: null,
      kind: 'Member'
    }));
  return [...characters, ...members].sort((a, b) => a.name.localeCompare(b.name));
}

export function UnclaimedPage() {
  const team = useTeam();
  const data = bothQueries(useRosterPlayers(team.id), useNames(team.id));
  return (
    <ReportPage
      title="Unclaimed"
      intro="Roster spots nobody has claimed yet, so officers can chase them. Click a column to sort."
    >
      <DataState query={data} label="the roster">
        {([players, names]) => <Unclaimed players={players} names={names} />}
      </DataState>
    </ReportPage>
  );
}

function Unclaimed({ players, names }: { players: PlayerRow[]; names: NameRow[] }) {
  const { pathname } = useLocation();
  const roster = `${pathname.slice(0, pathname.indexOf('/officer/'))}/roster`;
  const rows = unclaimedRows(players, names);
  const total = players.filter((p) => p.name_realm.trim()).length;
  const columns: Column<UnclaimedRow>[] = [
    {
      key: 'name',
      label: 'Name',
      sortValue: (r) => r.name,
      render: (r) => (
        <span className="raider-name" style={r.className ? { color: classColor(r.className) } : undefined}>
          {r.name}
        </span>
      )
    },
    { key: 'detail', label: 'Spec', sortValue: (r) => r.detail, render: (r) => r.detail },
    { key: 'kind', label: 'Entered as', sortValue: (r) => r.kind, render: (r) => r.kind }
  ];
  if (rows.length === 0) {
    return (
      <div className="card placeholder">
        <p>Everyone on the roster is claimed.</p>
      </div>
    );
  }
  return (
    <>
      <p className="report-count">
        <span className="num">{rows.length}</span> unclaimed, of {total} characters on the roster. Claim them from the{' '}
        <Link to={roster}>Roster</Link>.
      </p>
      <SortableTable
        caption="Unclaimed roster spots"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.key}
        initial={{ key: 'name', dir: 1 }}
      />
    </>
  );
}

type WishlistReportRow = { raider: Raider; progress: WishlistProgress };

const progressText = (p: WishlistProgress) =>
  p.state === 'not-started'
    ? 'Not started'
    : p.state === 'done'
      ? 'Done'
      : `Partly done: ${p.done} of ${p.total} slots`;

const progressTone = (p: WishlistProgress) =>
  p.state === 'not-started' ? 'tone-bad' : p.state === 'partly' ? 'tone-warn' : 'tone-good';

export function WishlistCompletenessPage() {
  const team = useTeam();
  const season = useCurrentSeason(team.id);
  const code = season.isSuccess ? season.data.code : null;
  const data = bothQueries(
    bothQueries(season, bothQueries(useRosterPlayers(team.id), useNames(team.id))),
    bothQueries(useTeamWishlists(team.id, code), bothQueries(useCatalog(), useRaidZones()))
  );
  return (
    <ReportPage
      title="Wishlist completeness"
      intro="How far each raider's wishlist is this season. A slot counts as done with a BiS pick or a Pass. Click a column to sort."
    >
      <DataState query={data} label="the wishlists">
        {([[s, [players, names]], [picks, [catalog, zones]]]) =>
          s.code ? (
            <Completeness
              season={s.code}
              seasonName={s.name}
              players={players}
              names={names}
              picks={picks}
              catalog={catalog}
              zones={zones}
            />
          ) : (
            <div className="card placeholder">
              <p>No season has started yet.</p>
            </div>
          )
        }
      </DataState>
    </ReportPage>
  );
}

function Completeness({
  season,
  seasonName,
  players,
  names,
  picks,
  catalog,
  zones
}: {
  season: string;
  seasonName: string;
  players: PlayerRow[];
  names: NameRow[];
  picks: TeamWishlistRow[];
  catalog: CatalogItem[];
  zones: ZoneRow[];
}) {
  const [role, setRole] = useState<Role | null>(null);
  const byPlayer = new Map<number, TeamWishlistRow[]>();
  for (const p of picks) byPlayer.set(p.player_id, [...(byPlayer.get(p.player_id) ?? []), p]);
  const raiders = toRoster(players, [], names).flatMap((g) => g.raiders);
  const shown: WishlistReportRow[] = raiders
    .filter((r) => r.playerId !== null && (!role || r.role === role))
    .map((raider) => ({
      raider,
      progress: wishlistProgress(byPlayer.get(raider.playerId!) ?? [], catalog, zones, season)
    }));
  const counts = { 'not-started': 0, partly: 0, done: 0 };
  for (const r of shown) counts[r.progress.state]++;
  const columns: Column<WishlistReportRow>[] = [
    {
      key: 'raider',
      label: 'Raider',
      sortValue: (r) => r.raider.name,
      render: (r) => (
        <>
          <span className="raider-name" style={{ color: classColor(r.raider.className) }}>
            {r.raider.name}
          </span>
          <span className="raider-spec">
            {r.raider.spec} {r.raider.className}
          </span>
        </>
      )
    },
    {
      key: 'status',
      label: 'Wishlist',
      // Not started sorts below 0 of 16, so the least done come first.
      sortValue: (r) => (r.progress.state === 'not-started' ? -1 : r.progress.done),
      render: (r) => <span className={progressTone(r.progress)}>{progressText(r.progress)}</span>,
      numeric: true
    }
  ];
  return (
    <>
      <p className="report-count">
        {seasonName || season}: <span className="num">{counts['not-started']}</span> not started,{' '}
        <span className="num">{counts.partly}</span> partly done, <span className="num">{counts.done}</span> done.
      </p>
      <RoleFilter value={role} onChange={setRole} />
      {shown.length === 0 ? (
        <div className="card placeholder">
          <p>No one in this role.</p>
        </div>
      ) : (
        <SortableTable
          caption="Wishlist completeness"
          columns={columns}
          rows={shown}
          rowKey={(r) => r.raider.key}
          initial={{ key: 'status', dir: 1 }}
        />
      )}
    </>
  );
}
