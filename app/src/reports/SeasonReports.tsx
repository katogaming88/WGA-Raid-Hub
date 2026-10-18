import { useState, type ReactNode } from 'react';
import { useSeasons } from '../calendar/useCalendar';
import { DataState } from '../components/DataState';
import { useTeam } from '../data/address';
import { currentSeason, difficultyOf, type SeasonRow } from '../profile/profile';
import { classColor, firstName, toRoster } from '../roster/roster';
import { useNames } from '../roster/useNames';
import { useRosterPlayers } from '../roster/useRoster';
import { ReportPage, SeasonPicker } from './ReportPage';
import { SortableTable, type Column } from './SortableTable';
import { useBisDemand, useLootPace, usePriorityHealth, type BisDemandRow, type PriorityHealth } from './useReports';

// BiS demand, Loot pace and Priority order health (#1359 part 3): the current
// site's tab-reports.js reports that pick a season.

// The season list, newest first, opening on the current one. A season with
// nothing in a report still shows, so an officer can see it is clean.
export function SeasonReport({
  title,
  intro,
  children
}: {
  title: string;
  intro: string;
  children: (season: string, seasons: SeasonRow[]) => ReactNode;
}) {
  const seasons = useSeasons();
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <ReportPage title={title} intro={intro}>
      <DataState query={seasons} label="the seasons">
        {(rows) => {
          const season = picked ?? currentSeason(rows)?.code ?? rows[rows.length - 1]?.code ?? null;
          if (!season) {
            return (
              <div className="card placeholder">
                <p>No seasons are set up yet.</p>
              </div>
            );
          }
          return (
            <>
              <SeasonPicker
                seasons={[...rows].reverse().map((s) => ({ code: s.code, name: s.display_name }))}
                value={season}
                onChange={setPicked}
              />
              {children(season, rows)}
            </>
          );
        }}
      </DataState>
    </ReportPage>
  );
}

export const nameOf = (seasons: SeasonRow[], code: string) =>
  seasons.find((s) => s.code === code)?.display_name ?? code;

// BiS demand

export function BisDemandPage() {
  const team = useTeam();
  return (
    <SeasonReport
      title="BiS demand"
      intro="Raid items the roster has marked BiS on their wishlists this season, how many raiders want each, and how many the team has awarded. Most wanted first. Click a column to sort."
    >
      {(season, seasons) => <BisDemand teamId={team.id} season={season} seasonName={nameOf(seasons, season)} />}
    </SeasonReport>
  );
}

type DemandRow = { id: number; name: string; slot: string; demand: number; awarded: number };

function BisDemand({ teamId, season, seasonName }: { teamId: number; season: string; seasonName: string }) {
  const rows = useBisDemand(teamId, season);
  const columns: Column<DemandRow>[] = [
    {
      key: 'item',
      label: 'Item',
      sortValue: (r) => r.name,
      render: (r) => <span className="report-item">{r.name}</span>
    },
    { key: 'slot', label: 'Slot', sortValue: (r) => r.slot, render: (r) => r.slot },
    {
      key: 'demand',
      label: 'Want it',
      sortValue: (r) => r.demand,
      render: (r) => r.demand,
      firstDir: -1,
      numeric: true
    },
    {
      key: 'awarded',
      label: 'Awarded',
      sortValue: (r) => r.awarded,
      render: (r) => r.awarded,
      firstDir: -1,
      numeric: true
    }
  ];
  return (
    <DataState query={rows} label="BiS demand">
      {(data) => {
        const shown: DemandRow[] = data.map((r: BisDemandRow, i) => ({
          id: r.item_id ?? -i,
          name: r.item_name ?? 'Unknown item',
          slot: r.slot ?? '',
          demand: r.demand_count ?? 0,
          awarded: r.awarded_count ?? 0
        }));
        return shown.length === 0 ? (
          <div className="card placeholder">
            <p>No one on the roster has marked a raid item BiS for {seasonName}.</p>
          </div>
        ) : (
          <SortableTable
            caption={`BiS demand, ${seasonName}`}
            columns={columns}
            rows={shown}
            rowKey={(r) => r.id}
            initial={{ key: 'demand', dir: -1 }}
          />
        );
      }}
    </DataState>
  );
}

// Loot pace

export function LootPacePage() {
  const team = useTeam();
  return (
    <SeasonReport
      title="Loot pace"
      intro="Items awarded each week of the season, next to the same week of the season before. Week 1 starts with the season's first award."
    >
      {(season, seasons) => <LootPace teamId={team.id} season={season} seasons={seasons} />}
    </SeasonReport>
  );
}

const TRACKS = [
  { value: '', label: 'Every track' },
  { value: 'Myth', label: 'Mythic' },
  { value: 'Hero', label: 'Heroic' },
  { value: 'Champion', label: 'Champion' }
];

function LootPace({ teamId, season, seasons }: { teamId: number; season: string; seasons: SeasonRow[] }) {
  const [track, setTrack] = useState('');
  const [slot, setSlot] = useState('');
  const at = seasons.findIndex((s) => s.code === season);
  const previous = at > 0 ? seasons[at - 1]!.code : null;
  const rows = useLootPace(teamId, previous ? [season, previous] : [season]);
  return (
    <DataState query={rows} label="loot pace">
      {(data) => {
        const slots = [...new Set(data.map((r) => r.slot).filter((s): s is string => !!s))].sort();
        const totals = (code: string) => {
          const byWeek = new Map<number, number>();
          for (const r of data) {
            if (r.season !== code || r.season_week === null) continue;
            if (track && r.track !== track) continue;
            if (slot && r.slot !== slot) continue;
            byWeek.set(r.season_week, (byWeek.get(r.season_week) ?? 0) + (r.items_awarded ?? 0));
          }
          return byWeek;
        };
        const now = totals(season);
        const before = previous ? totals(previous) : new Map<number, number>();
        const weeks = [...new Set([...now.keys(), ...before.keys()])].sort((a, b) => a - b);
        return (
          <>
            <div className="report-filters">
              <div className="field">
                <label className="field-label" htmlFor="pace-track">
                  Track
                </label>
                <select id="pace-track" className="input" value={track} onChange={(e) => setTrack(e.target.value)}>
                  {TRACKS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="pace-slot">
                  Slot
                </label>
                <select id="pace-slot" className="input" value={slot} onChange={(e) => setSlot(e.target.value)}>
                  <option value="">Every slot</option>
                  {slots.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {weeks.length === 0 ? (
              <div className="card placeholder">
                <p>No loot awarded yet for this choice.</p>
              </div>
            ) : (
              // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrolls on a phone, as the Roster's table
              <div className="card roster-table-wrap" tabIndex={0} role="region" aria-label="Loot pace">
                <table className="roster-table report-table">
                  <caption className="visually-hidden">Items awarded per week</caption>
                  <thead>
                    <tr>
                      <th scope="col">Week</th>
                      <th scope="col" className="col-num">
                        {nameOf(seasons, season)}
                      </th>
                      <th scope="col" className="col-num">
                        {previous ? nameOf(seasons, previous) : 'Season before'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {weeks.map((w) => (
                      <tr key={w}>
                        <th scope="row">Week {w}</th>
                        <td className="col-num num">{now.get(w) ?? 0}</td>
                        <td className="col-num num">
                          {previous ? (
                            (before.get(w) ?? 0)
                          ) : (
                            <>
                              <span aria-hidden="true">–</span>
                              <span className="visually-hidden">No season before</span>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        );
      }}
    </DataState>
  );
}

// Priority order health

export function PriorityHealthPage() {
  const team = useTeam();
  return (
    <SeasonReport
      title="Priority order health"
      intro="Things in the season's priority order worth cleaning up or a second look."
    >
      {(season, seasons) => (
        <PriorityHealthReport teamId={team.id} season={season} seasonName={nameOf(seasons, season)} />
      )}
    </SeasonReport>
  );
}

function PriorityHealthReport({ teamId, season, seasonName }: { teamId: number; season: string; seasonName: string }) {
  const health = usePriorityHealth(teamId, season);
  const players = useRosterPlayers(teamId);
  const names = useNames(teamId);
  // Raiders still on the roster go by the Roster's name for them.
  const raiders = new Map(
    toRoster(players.data ?? [], [], names.data ?? [])
      .flatMap((g) => g.raiders)
      .map((r) => [r.playerId, r])
  );
  return (
    <DataState query={health} label="the priority order">
      {(data: PriorityHealth) => (
        <div className="report-sections">
          <section className="report-section" aria-labelledby="stale-title">
            <h2 id="stale-title" className="section-title">
              Raiders who have left <span className="text-muted">({data.stale.length})</span>
            </h2>
            <p className="text-muted">Entries for raiders who are no longer on the roster. Take them out.</p>
            {data.stale.length === 0 ? (
              <p className="text-dim">None for {seasonName}.</p>
            ) : (
              <SimpleTable
                caption="Entries for raiders who have left"
                head={['Item', 'Track', 'Rank', 'Raider']}
                rows={data.stale.map((r, i) => ({
                  key: r.priority_order_id ?? i,
                  cells: [
                    r.item_name ?? 'Unknown item',
                    difficultyOf(r.track),
                    r.rank ?? '',
                    r.name_realm ? firstName(r.name_realm) : ''
                  ]
                }))}
              />
            )}
          </section>

          <section className="report-section" aria-labelledby="gaps-title">
            <h2 id="gaps-title" className="section-title">
              Not in the priority order <span className="text-muted">({data.gaps.length})</span>
            </h2>
            <p className="text-muted">
              Raiders on the roster, not on the bench, with no entry for any item this season. Fill them in.
            </p>
            {data.gaps.length === 0 ? (
              <p className="text-dim">None for {seasonName}.</p>
            ) : (
              <ul className="report-names">
                {data.gaps.map((r, i) => {
                  const raider = r.player_id !== null ? raiders.get(r.player_id) : undefined;
                  return (
                    <li key={r.player_id ?? i}>
                      <span
                        className="raider-name"
                        style={raider ? { color: classColor(raider.className) } : undefined}
                      >
                        {raider?.name ?? (r.name_realm ? firstName(r.name_realm) : '')}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="report-section" aria-labelledby="heroic-title">
            <h2 id="heroic-title" className="section-title">
              Mythic #1 who already have the Heroic one <span className="text-muted">({data.afterHeroic.length})</span>
            </h2>
            <p className="text-muted">
              Raiders first in line for a Mythic item who already received its Heroic version. Not necessarily wrong,
              since they may still want the upgrade, but worth a second look.
            </p>
            {data.afterHeroic.length === 0 ? (
              <p className="text-dim">None for {seasonName}.</p>
            ) : (
              <SimpleTable
                caption="Mythic #1 who already have the Heroic one"
                head={['Item', 'Raider']}
                rows={data.afterHeroic.map((r, i) => ({
                  key: r.priority_order_id ?? i,
                  cells: [r.item_name ?? 'Unknown item', r.name_realm ? firstName(r.name_realm) : '']
                }))}
              />
            )}
          </section>
        </div>
      )}
    </DataState>
  );
}

function SimpleTable({
  caption,
  head,
  rows
}: {
  caption: string;
  head: string[];
  rows: { key: number; cells: ReactNode[] }[];
}) {
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrolls on a phone, as the Roster's table
    <div className="card roster-table-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="roster-table report-table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              {r.cells.map((c, i) =>
                i === 0 ? (
                  <th key={i} scope="row">
                    {c}
                  </th>
                ) : (
                  <td key={i}>{c}</td>
                )
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
