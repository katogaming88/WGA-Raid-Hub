import { useState } from 'react';
import { shortBossName } from '../calendar/lineup';
import { useEncounters } from '../calendar/useCalendar';
import { DataState } from '../components/DataState';
import { useTeam } from '../data/address';
import { bothQueries } from '../data/query';
import { easternToday, isoDateLong } from '../lib/dates';
import type { SeasonRow } from '../profile/profile';
import { classColor, ROLE_LABELS, ROLE_ORDER, toRoster, type Role, type RoleGroup } from '../roster/roster';
import { useNames } from '../roster/useNames';
import { useRosterPlayers } from '../roster/useRoster';
import {
  bossLineups,
  nightLineups,
  raiderLineups,
  roleLoad,
  slotsOf,
  type BossInfo,
  type BossLineup,
  type LineupData,
  type RaiderLineup
} from './lineups';
import { oneDecimal } from './fairness';
import { RoleFilter } from './ReportPage';
import { nameOf, SeasonReport } from './SeasonReports';
import { SortableTable, type Column } from './SortableTable';
import { useBonusRolls, useLineupReport } from './useReports';

// Boss lineups (#1247): the season's plan from the Calendar's boss lineup
// against who the logs say was in each fight (#1242).

export function LineupReportPage() {
  const team = useTeam();
  return (
    <SeasonReport
      title="Boss lineups"
      intro="Who was planned for each boss this season, and who the logs say was in. A night whose log is not in yet counts from its plan."
    >
      {(season, seasons) => <LineupReport key={season} teamId={team.id} season={season} seasons={seasons} />}
    </SeasonReport>
  );
}

type View = 'raiders' | 'bosses' | 'nights';
const VIEWS: { value: View; label: string }[] = [
  { value: 'raiders', label: 'Raiders' },
  { value: 'bosses', label: 'Bosses' },
  { value: 'nights', label: 'Nights' }
];

function LineupReport({ teamId, season, seasons }: { teamId: number; season: string; seasons: SeasonRow[] }) {
  const [view, setView] = useState<View>('raiders');
  const today = easternToday();
  const row = seasons.find((s) => s.code === season)!;
  const end = row.ends_at && row.ends_at < today ? row.ends_at : today;
  const lineups = bothQueries(useLineupReport(teamId, row.starts_at, end), useEncounters());
  const roster = bothQueries(useRosterPlayers(teamId), useBonusRolls(teamId));
  const names = useNames(teamId);
  return (
    <DataState query={bothQueries(lineups, roster)} label="this season's lineups">
      {([[data, encounters], [players, bonus]]) => {
        if (data.nightBosses.length === 0) {
          return (
            <div className="card placeholder">
              <p>
                No boss lineups planned for {nameOf(seasons, season)} yet. Officers plan them on each raid night in the
                Calendar.
              </p>
            </div>
          );
        }
        const groups = toRoster(players, [], names.data ?? []);
        const bosses = new Map<number, BossInfo>(
          encounters.map((e) => [e.id, { id: e.id, name: e.name, short: shortBossName(e.name) }])
        );
        const order = [...encounters]
          .sort((a, b) => a.zone.sort_index - b.zone.sort_index || a.sort_index - b.sort_index || a.id - b.id)
          .map((e) => e.id);
        const props = {
          data,
          today,
          groups,
          bosses,
          order,
          bonus: new Map(bonus.map((b) => [b.id, b.bonus_roll_encounter_id]))
        };
        return (
          <>
            <div className="role-filter" role="group" aria-label="Show">
              {VIEWS.map((v) => (
                <button
                  key={v.value}
                  type="button"
                  className="role-filter-option"
                  aria-pressed={view === v.value}
                  onClick={() => setView(v.value)}
                >
                  {v.label}
                </button>
              ))}
            </div>
            {view === 'raiders' && <Raiders {...props} />}
            {view === 'bosses' && <Bosses {...props} />}
            {view === 'nights' && <Nights {...props} />}
          </>
        );
      }}
    </DataState>
  );
}

type Props = {
  data: LineupData;
  today: string;
  groups: RoleGroup[];
  bosses: ReadonlyMap<number, BossInfo>;
  order: number[];
  bonus: ReadonlyMap<number, number | null>;
};

const shortOf = (bosses: ReadonlyMap<number, BossInfo>, id: number) => bosses.get(id)?.short ?? 'Unknown boss';
const list = (items: string[]) => (items.length ? items.join(', ') : '–');

// Per raider, with the sit-out spread for each role above the table.

function Raiders({ data, today, groups, bosses, bonus }: Props) {
  const [role, setRole] = useState<Role | null>(null);
  const slots = slotsOf(data, today);
  const raiders = raiderLineups(slots, groups, bonus);
  const load = roleLoad(raiders, groups);
  const pct = (r: RaiderLineup) => (r.slots ? Math.round((r.assigned / r.slots) * 100) : 0);
  const columns: Column<RaiderLineup>[] = [
    {
      key: 'name',
      label: 'Raider',
      sortValue: (r) => r.name,
      render: (r) => (
        <span className="raider-name" style={{ color: classColor(r.className) }}>
          {r.name}
        </span>
      )
    },
    {
      key: 'assigned',
      label: 'Planned',
      sortValue: (r) => r.assigned,
      render: (r) => `${r.assigned} of ${r.slots} (${pct(r)}%)`,
      firstDir: -1,
      numeric: true
    },
    {
      key: 'satOut',
      label: 'Sat out',
      sortValue: (r) => r.satOut,
      render: (r) => r.satOut,
      firstDir: -1,
      numeric: true
    },
    {
      key: 'run',
      label: 'Longest run out',
      sortValue: (r) => r.longestSitOut,
      render: (r) => r.longestSitOut,
      firstDir: -1,
      numeric: true
    },
    {
      key: 'played',
      label: 'Played',
      sortValue: (r) => r.played,
      render: (r) => r.played,
      firstDir: -1,
      numeric: true
    },
    {
      key: 'missed',
      label: 'Missed',
      sortValue: (r) => r.missed,
      render: (r) => <span className={r.missed ? 'tone-bad' : undefined}>{r.missed}</span>,
      firstDir: -1,
      numeric: true
    },
    {
      key: 'swapped',
      label: 'Swapped in',
      sortValue: (r) => r.swappedIn,
      render: (r) => r.swappedIn,
      firstDir: -1,
      numeric: true
    },
    {
      key: 'kills',
      label: 'In for kills',
      sortValue: (r) => r.kills.length,
      render: (r) => list(r.kills.map((b) => shortOf(bosses, b))),
      firstDir: -1
    },
    {
      key: 'never',
      label: 'Never in for',
      sortValue: (r) => r.neverIn.length,
      render: (r) => (
        <span className={r.neverIn.length ? 'tone-warn' : undefined}>
          {list(r.neverIn.map((b) => shortOf(bosses, b)))}
        </span>
      ),
      firstDir: -1
    },
    {
      key: 'bonus',
      label: 'Bonus roll boss',
      sortValue: (r) => (r.bonusRoll ? r.bonusRoll.inFor - r.bonusRoll.slots : 1),
      render: (r) =>
        r.bonusRoll ? `${shortOf(bosses, r.bonusRoll.bossId)}: in ${r.bonusRoll.inFor} of ${r.bonusRoll.slots}` : '–'
    }
  ];
  return (
    <>
      <p className="text-muted">
        {slots.length} boss {slots.length === 1 ? 'pull' : 'pulls'} so far. Played, Missed and Swapped in come from
        nights whose log is in.
      </p>
      <ul className="lineup-load" aria-label="Sat out, by role">
        {load.map((l) => (
          <li key={l.role}>
            <strong>{l.label}</strong> sat out {l.fewest === l.most ? l.fewest : `${l.fewest}–${l.most}`}, average{' '}
            {oneDecimal(l.average)}
          </li>
        ))}
      </ul>
      <RoleFilter value={role} onChange={setRole} />
      <SortableTable
        caption="Boss lineups by raider"
        columns={columns}
        rows={raiders.filter((r) => !role || r.role === role)}
        rowKey={(r) => r.playerId}
        initial={{ key: 'satOut', dir: -1 }}
      />
    </>
  );
}

// Per boss: who always plays it, the seats that rotate, the average make-up,
// the first kill's lineup, and a grid of how often each raider has been in.

function Bosses({ data, today, groups, bosses, order }: Props) {
  const slots = slotsOf(data, today);
  const raiders = groups.flatMap((g) => g.raiders).filter((r) => r.playerId !== null);
  const roleOf = new Map(raiders.map((r) => [r.playerId!, r.role as string]));
  const nameById = new Map(raiders.map((r) => [r.playerId!, r.name]));
  const report = bossLineups(slots, order, roleOf);
  const named = (ids: number[]) => {
    const known = ids.flatMap((id) => (nameById.has(id) ? [nameById.get(id)!] : [])).sort();
    const left = ids.length - known.length;
    return left ? [...known, `${left} who left`] : known;
  };
  const columns: Column<BossLineup>[] = [
    {
      key: 'boss',
      label: 'Boss',
      sortValue: (b) => order.indexOf(b.bossId),
      render: (b) => <span className="report-item">{bosses.get(b.bossId)?.name ?? 'Unknown boss'}</span>
    },
    { key: 'pulls', label: 'Nights pulled', sortValue: (b) => b.slots, render: (b) => b.slots, numeric: true },
    {
      key: 'always',
      label: 'Always in',
      sortValue: (b) => b.always.length,
      render: (b) => b.always.length,
      firstDir: -1,
      numeric: true
    },
    {
      key: 'rotating',
      label: 'Rotating seats',
      sortValue: (b) => b.rotatingSeats,
      render: (b) => (b.rotating.length ? `${oneDecimal(b.rotatingSeats)} among ${b.rotating.length}` : '0'),
      firstDir: -1,
      numeric: true
    },
    {
      key: 'roles',
      label: 'Average pull',
      sortValue: (b) => b.roles.Tank ?? 0,
      render: (b) =>
        ROLE_ORDER.filter((r) => b.roles[r])
          .map((r) => `${oneDecimal(b.roles[r]!)} ${ROLE_LABELS[r].toLowerCase()}`)
          .join(', ')
    },
    {
      key: 'kill',
      label: 'First kill',
      sortValue: (b) => b.firstKill?.date ?? '9999',
      render: (b) =>
        b.firstKill ? (
          <details className="lineup-kill">
            <summary>
              {isoDateLong(b.firstKill.date)}, {b.firstKill.lineup.length} in
            </summary>
            {named(b.firstKill.lineup).join(', ')}
          </details>
        ) : (
          '–'
        )
    }
  ];
  const shown = report.map((b) => b.bossId);
  return (
    <div className="report-sections">
      <SortableTable
        caption="Boss lineups by boss"
        columns={columns}
        rows={report}
        rowKey={(b) => b.bossId}
        initial={{ key: 'boss', dir: 1 }}
      />
      <section className="report-section" aria-labelledby="seen-title">
        <h2 id="seen-title" className="section-title">
          Times in, per raider
        </h2>
        <p className="text-muted">How many of each boss's pulls this season each raider was in for.</p>
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrolls on a phone, as the Roster's table */}
        <div className="card roster-table-wrap" tabIndex={0} role="region" aria-label="Times in, per raider">
          <table className="roster-table report-table lineup-grid">
            <caption className="visually-hidden">Times each raider was in for each boss</caption>
            <thead>
              <tr>
                <th scope="col">Raider</th>
                {report.map((b) => (
                  <th key={b.bossId} scope="col" className="col-num">
                    <span aria-hidden="true">{shortOf(bosses, b.bossId)}</span>
                    <span className="visually-hidden">{bosses.get(b.bossId)?.name ?? 'Unknown boss'}</span>
                    <span className="lineup-grid-of text-muted"> /{b.slots}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {raiders.map((r) => (
                <tr key={r.key}>
                  <th scope="row" className="raider-cell">
                    <span className="raider-name" style={{ color: classColor(r.className) }}>
                      {r.name}
                    </span>
                  </th>
                  {shown.map((id, i) => {
                    const n = report[i]!.seen.get(r.playerId!) ?? 0;
                    return (
                      <td key={id} className={`col-num num${n === 0 ? ' text-dim' : ''}`}>
                        {n}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// Per night, newest first: each boss's plan against the log, and who came
// late for the first boss they were planned for.

function Nights({ data, today, groups, bosses }: Props) {
  const nameById = new Map(
    groups.flatMap((g) => g.raiders).flatMap((r) => (r.playerId !== null ? [[r.playerId, r.name] as const] : []))
  );
  const named = (ids: number[]) => list(ids.map((id) => nameById.get(id) ?? 'someone who left').sort());
  return (
    <div className="report-sections">
      {nightLineups(data, today).map((n) => (
        <section key={n.date} className="card lineup-night" aria-labelledby={`night-${n.date}`}>
          <h2 id={`night-${n.date}`} className="section-title">
            {isoDateLong(n.date)}
          </h2>
          {!n.logged && <p className="text-muted">The log is not in yet, so this is the plan.</p>}
          <ul className="lineup-night-bosses">
            {n.bosses.map((b) => (
              <li key={b.bossId}>
                <span className="report-item">{shortOf(bosses, b.bossId)}</span>
                {b.killed && <span className="lineup-killed"> Killed</span>}
                <span className="text-muted">
                  {' '}
                  {b.state === 'skipped'
                    ? 'Skipped'
                    : b.state === 'not pulled'
                      ? 'Not pulled'
                      : b.state === 'planned'
                        ? `${b.planned} planned`
                        : `${b.planned} planned, ${b.played} in`}
                </span>
                {b.swappedIn.length > 0 && <div>Swapped in: {named(b.swappedIn)}</div>}
                {b.missed.length > 0 && <div className="tone-bad">Missed: {named(b.missed)}</div>}
              </li>
            ))}
          </ul>
          {n.late.length > 0 && (
            <p className="tone-warn">
              Late:{' '}
              {n.late
                .map(
                  (l) =>
                    `${nameById.get(l.playerId) ?? 'someone who left'} (planned from ${shortOf(bosses, l.plannedFrom)}, first in at ${shortOf(bosses, l.arrivedAt)})`
                )
                .join('; ')}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
