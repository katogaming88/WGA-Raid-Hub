import { useState } from 'react';
import { usePageCan } from '../auth/access';
import { useTeam } from '../data/address';
import { bothQueries } from '../data/query';
import { DataState } from '../components/DataState';
import { Dialog } from '../components/Dialog';
import { useStatus } from '../components/Status';
import { errorMessage } from '../lib/errors';
import { formatInstantDate, formatInstantShort, formatInstantTime, localTimeZoneNote } from '../lib/dates';
import { useCurrentSeason } from '../profile/useProfile';
import { useRosterPlayers } from '../roster/useRoster';
import { classColor, firstName, type PlayerRow } from '../roster/roster';
import {
  ATTENDANCE_STATUSES,
  buildGrid,
  needsALook,
  nightLabel,
  type FullAttendanceRow,
  type LastRun,
  type LookContext,
  type LookItem,
  type Night,
  type ReportKind,
  type ReportRow,
  effectiveKind,
  kindName,
  plural,
  reportUrl
} from './attendance';
import {
  useAttendanceRows,
  useCommitAttendanceScores,
  useLastRun,
  useLookDetails,
  useOverriders,
  useRefreshAttendanceFromWcl,
  useReports,
  useSetAttendanceStatus,
  useSetReportKind,
  useToggleReportExcluded
} from './useAttendance';
import './attendance.css';

// The officer's Manage Attendance page (#1354, #1103 row 1): the per-night
// status grid, refresh from WCL, and commit attendance scores, ported from
// tab-attendance.js's Manage sub-tab.
export function AttendanceManagePage() {
  const team = useTeam();
  // A guild Admin on another team reads the grid; only 'attendance' changes it (#1703).
  const readOnly = !usePageCan().can('manageAttendance');
  const page = bothQueries(useAttendanceRows(team.id), useRosterPlayers(team.id));

  return (
    <section className="page attendance-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">Manage attendance</h1>
        <p className="text-muted page-subtitle">
          Attendance refreshes from Warcraft Logs every hour. Scores go into loot priority on their own once nothing
          below needs a look.
        </p>
      </div>
      <DataState query={page} label="attendance">
        {([rows, roster]) => <Manage teamId={team.id} rows={rows} roster={roster} readOnly={readOnly} />}
      </DataState>
    </section>
  );
}

function Manage({
  teamId,
  rows,
  roster,
  readOnly
}: {
  teamId: number;
  rows: FullAttendanceRow[];
  roster: PlayerRow[];
  readOnly: boolean;
}) {
  const { announce } = useStatus();
  const season = useCurrentSeason(teamId);
  const nights = buildGrid(rows, roster);
  const [shown, setShown] = useState(0);
  const [confirmingCommit, setConfirmingCommit] = useState(false);
  const refresh = useRefreshAttendanceFromWcl(teamId);
  const commit = useCommitAttendanceScores(teamId);
  const lastRun = useLastRun(teamId);
  const seasonStart = season.isSuccess ? season.data.start : null;
  const flagged = needsALook(rows, roster, seasonStart, NO_CONTEXT);
  const dates = [...new Set(flagged.map((i) => i.date))];
  const lateDates = [...new Set(flagged.filter((i) => i.kind === 'Late?').map((i) => i.date))];
  const details = useLookDetails(teamId, lateDates, dates);
  const items = details.isSuccess ? needsALook(rows, roster, seasonStart, details.data) : flagged;

  const onRefresh = () =>
    refresh.mutate(undefined, {
      onSuccess: (result) => {
        setShown(0);
        const text = `Done: ${result.mainNights} night${result.mainNights === 1 ? '' : 's'} found, ${result.excluded} excluded.`;
        announce('success', text);
      },
      onError: (error) => announce('error', errorMessage(error))
    });

  const onCommit = () => {
    setConfirmingCommit(false);
    if (!season.isSuccess || !season.data.code) return;
    commit.mutate(undefined, {
      onSuccess: (summary) => {
        const text = `${summary.committed} player${summary.committed === 1 ? '' : 's'} scored (${summary.totalNights} night${summary.totalNights === 1 ? '' : 's'})`;
        announce('success', text);
      },
      onError: (error) => announce('error', errorMessage(error))
    });
  };

  const waiting = items.length;

  return (
    <div className="attend-manage-panel card">
      <div className="attend-manage-header">
        <RefreshLine run={lastRun.data ?? null} loaded={lastRun.isSuccess} waiting={readOnly ? 0 : waiting} />
        {!readOnly && (
          <div className="attend-manage-actions">
            <button type="button" className="button" onClick={onRefresh} disabled={refresh.isPending}>
              {refresh.isPending ? 'Refreshing…' : 'Refresh now'}
            </button>
            <button
              type="button"
              className={waiting > 0 ? 'button button-primary' : 'button'}
              onClick={() => setConfirmingCommit(true)}
              disabled={commit.isPending || !season.isSuccess || !season.data.code}
            >
              {waiting > 0 ? 'Commit anyway' : 'Commit Attendance Scores'}
            </button>
          </div>
        )}
      </div>
      {!readOnly && <LookList teamId={teamId} items={items} logNames={details.data?.logNames ?? []} />}
      {confirmingCommit && (
        <Dialog title="Commit attendance scores" onClose={() => setConfirmingCommit(false)}>
          <p>Calculate and write attendance scores for all players to Scoring?</p>
          <div className="dialog-actions">
            <span className="grow" />
            <button type="button" className="button" onClick={() => setConfirmingCommit(false)}>
              Cancel
            </button>
            <button type="button" className="button button-primary" onClick={onCommit}>
              Yes, Commit
            </button>
          </div>
        </Dialog>
      )}

      <section className="attend-section" aria-labelledby="attend-grid-title">
        <h2 id="attend-grid-title" className="section-title">
          Every night
        </h2>
        {nights.length === 0 ? (
          <p className="text-muted">No raid nights recorded yet. They show here after the first refresh.</p>
        ) : (
          <NightGrid teamId={teamId} nights={nights} shown={shown} onShow={setShown} readOnly={readOnly} />
        )}
      </section>

      <ReportsList teamId={teamId} rows={rows} readOnly={readOnly} />
    </div>
  );
}

const NO_CONTEXT: LookContext = { firstBoss: new Map(), rsvps: new Map() };

// "today at 3:23 PM", or "Nov 15 at 3:23 PM" on another day, in the viewer's zone.
function whenLabel(iso: string): string {
  const time = formatInstantTime(iso);
  if (formatInstantDate(iso) === formatInstantDate(new Date())) return `today at ${time}`;
  return `${formatInstantShort(iso)} at ${time}`;
}

const hourAfter = (iso: string) => formatInstantTime(new Date(new Date(iso).getTime() + 60 * 60 * 1000));

// When the hourly refresh last ran, its error if it failed, and where the
// scores stand.
function RefreshLine({ run, loaded, waiting }: { run: LastRun | null; loaded: boolean; waiting: number }) {
  if (!loaded) return <div className="attend-refresh" />;
  return (
    <div className="attend-refresh">
      {!run ? (
        <span>No hourly refresh has run yet.</span>
      ) : run.error ? (
        <span className="attend-refresh-failed">
          Last refresh failed {whenLabel(run.started_at)}: {run.error}. It tries again around{' '}
          {hourAfter(run.started_at)}.
        </span>
      ) : (
        <span>
          Last refresh: <strong>{whenLabel(run.finished_at || run.started_at)}</strong>. Next one around{' '}
          {hourAfter(run.started_at)}.
        </span>
      )}
      {waiting > 0 ? (
        <span className="attend-scores-waiting">
          Scores waiting on {waiting} item{waiting === 1 ? '' : 's'}. They go into loot priority once{' '}
          {waiting === 1 ? 'it is' : 'these are'} set.
        </span>
      ) : (
        run?.committed != null &&
        !run.error && (
          <span className="attend-scores-done">Scores went into loot priority {whenLabel(run.finished_at)}.</span>
        )
      )}
      {run && <span className="text-muted attend-zone">{localTimeZoneNote()}</span>}
    </div>
  );
}

const capitalized = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

// The Needs a look list (#1846): each item sets its status right here and
// leaves the list once set (Kat, 2026-11-16).
function LookList({
  teamId,
  items,
  logNames
}: {
  teamId: number;
  items: LookItem[];
  logNames: { raid_date: string; character_name: string }[];
}) {
  const { announce } = useStatus();
  const setStatus = useSetAttendanceStatus(teamId);
  const strangers = new Map<string, string[]>();
  for (const n of logNames) strangers.set(n.raid_date, [...(strangers.get(n.raid_date) ?? []), n.character_name]);

  return (
    <section className="attend-section" aria-labelledby="attend-look-title">
      <h2 id="attend-look-title" className="section-title">
        Needs a look{items.length > 0 && <span className="attend-look-count"> {items.length}</span>}
      </h2>
      {items.length === 0 ? (
        <p className="text-muted">Nothing right now. New items show here after a refresh.</p>
      ) : (
        <ul className="attend-look-list">
          {items.map((item) => {
            const night = nightLabel(item.date);
            const id = `attend-look-${item.date}-${item.playerId}`;
            return (
              <li className="attend-look-item" key={`${item.date}-${item.playerId}`}>
                <span className="attend-look-name" style={{ color: classColor(item.className) }}>
                  {item.name}
                </span>
                <span className="attend-look-night">{night}</span>
                <span className="attend-look-reason">
                  <span className="attend-late-flag">{item.kind}</span> {item.reason}
                </span>
                <label className="visually-hidden" htmlFor={id}>
                  {item.name}'s status for {night}
                </label>
                <select
                  id={id}
                  className="input attend-status-select"
                  value=""
                  disabled={setStatus.isPending}
                  onChange={(e) =>
                    setStatus.mutate(
                      { playerId: item.playerId, raidDate: item.date, status: e.target.value, oldStatus: null },
                      { onError: (error) => announce('error', errorMessage(error)) }
                    )
                  }
                >
                  <option value="" disabled>
                    Pick a status
                  </option>
                  {ATTENDANCE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      )}
      {[...strangers].map(([date, names]) => (
        <p className="text-muted" key={date}>
          In the {nightLabel(date)} log but not on the roster: {names.map(capitalized).join(', ')}. These never hold up
          scores.
        </p>
      ))}
    </section>
  );
}

// Every report the progression sync has seen (#1473), with what each counts
// as and, for an officer, the switch (#1472). Exclude, in the grid above, stays
// an attendance decision for one night; this says whether the report is the
// team's raid at all.
function ReportsList({ teamId, rows, readOnly }: { teamId: number; rows: FullAttendanceRow[]; readOnly: boolean }) {
  const reports = useReports(teamId);
  return (
    <section className="attend-section" aria-labelledby="attend-reports-title">
      <h2 id="attend-reports-title" className="section-title">
        Reports
      </h2>
      <p className="text-muted">
        Every Warcraft Logs report the site has read, and whether it counts as the team's raid. A report marked as an
        alt run is left out of the lineup's killed bosses, the progression card and attendance.
      </p>
      <DataState query={reports} label="reports">
        {(list) => <ReportRows teamId={teamId} reports={list} rows={rows} readOnly={readOnly} />}
      </DataState>
    </section>
  );
}

function ReportRows({
  teamId,
  reports,
  rows,
  readOnly
}: {
  teamId: number;
  reports: ReportRow[];
  rows: FullAttendanceRow[];
  readOnly: boolean;
}) {
  const { announce } = useStatus();
  const setKind = useSetReportKind(teamId);
  const refresh = useRefreshAttendanceFromWcl(teamId);
  const [failed, setFailed] = useState<{ code: string; message: string } | null>(null);
  const overriderIds = [...new Set(reports.flatMap((r) => (r.kind_override_by === null ? [] : [r.kind_override_by])))];
  const overriders = useOverriders(teamId, overriderIds);
  const synced = new Set(rows.map((r) => r.report_id).filter((id): id is string => !!id));

  if (reports.length === 0) {
    return <p className="text-muted">No reports yet. They show here after the next sync from Warcraft Logs.</p>;
  }

  // kind null goes back to the title's verdict.
  const change = (report: ReportRow, kind: ReportKind | null) => {
    setFailed(null);
    const label = report.title || report.raid_date;
    const result: ReportKind = kind ?? (report.kind === 'alt' ? 'alt' : 'main');
    setKind.mutate(
      { reportCode: report.report_code, kind },
      {
        onSuccess: () => {
          announce('success', `${label} now counts as ${result === 'main' ? "the team's raid" : 'an alt run'}.`);
          // A report newly the team's raid has no attendance yet: pull it in now.
          if (result === 'main' && effectiveKind(report) !== 'main') {
            refresh.mutate(undefined, {
              onSuccess: (r) => announce('success', `Attendance refreshed: ${plural(r.mainNights, 'night')} found.`),
              onError: (error) =>
                announce(
                  'error',
                  `Attendance did not refresh (${errorMessage(error)}). The hourly refresh will pick it up.`
                )
            });
          }
        },
        onError: (error) => setFailed({ code: report.report_code, message: errorMessage(error) })
      }
    );
  };

  return (
    <ul className="attend-report-list">
      {reports.map((r) => {
        const label = r.title || r.raid_date;
        const kind = effectiveKind(r);
        const saving = setKind.isPending && setKind.variables?.reportCode === r.report_code;
        const who = r.kind_override_by === null ? null : (overriders.data?.get(r.kind_override_by) ?? null);
        return (
          <li className="attend-report" key={r.report_code}>
            <span className="attend-report-date">{nightLabel(r.raid_date)}</span>
            <span className="attend-report-main">
              <a
                className="attend-report-title"
                href={reportUrl(r.report_code)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {label}
              </a>
              <span className="text-muted attend-report-pulls">
                {plural(r.boss_pulls, 'pull')}, {plural(r.boss_kills, 'kill')}
              </span>
              <span className="text-muted attend-report-synced">
                {synced.has(r.report_code) ? 'Attendance from it' : 'No attendance from it'}
              </span>
            </span>
            <span className={`attend-report-kind${kind === 'alt' ? ' attend-report-alt' : ''}`}>
              {r.kind_override === null
                ? `${kindName(kind)}, from the title`
                : `${kindName(kind)}, set by ${who ? firstName(who) : 'an officer'}${
                    r.kind_override_at ? ` on ${formatInstantShort(r.kind_override_at)}` : ''
                  }`}
            </span>
            {!readOnly && (
              <span className="attend-report-actions">
                <button
                  type="button"
                  className="button button-quiet"
                  disabled={setKind.isPending}
                  onClick={() => change(r, kind === 'main' ? 'alt' : 'main')}
                >
                  {saving ? 'Saving…' : kind === 'main' ? 'Mark as alt run' : 'Mark as team raid'}
                  <span className="visually-hidden"> {label}</span>
                </button>
                {r.kind_override !== null && (
                  <button
                    type="button"
                    className="button button-quiet"
                    disabled={setKind.isPending}
                    onClick={() => change(r, null)}
                  >
                    Back to the title's verdict
                    <span className="visually-hidden"> for {label}</span>
                  </button>
                )}
              </span>
            )}
            {failed?.code === r.report_code && (
              <p className="form-error attend-report-error" role="alert">
                Did not save: {failed.message}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function NightGrid({
  teamId,
  nights,
  shown,
  onShow,
  readOnly
}: {
  teamId: number;
  nights: Night[];
  shown: number;
  onShow: (index: number) => void;
  readOnly: boolean;
}) {
  const { announce } = useStatus();
  const night = nights[Math.min(shown, nights.length - 1)]!;
  const setStatus = useSetAttendanceStatus(teamId);
  const toggleExcluded = useToggleReportExcluded(teamId);

  return (
    <>
      <div className="attend-night-row">
        <label className="visually-hidden" htmlFor="attend-night-select">
          Raid night
        </label>
        <select
          id="attend-night-select"
          className="input attend-night-select"
          value={shown}
          onChange={(e) => onShow(Number(e.target.value))}
        >
          {nights.map((n, i) => (
            <option key={n.date} value={i}>
              {n.title}
              {n.excluded ? ' [EXCLUDED]' : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="attend-grid-info">
        <span className="text-muted">
          {night.players.length} player{night.players.length !== 1 ? 's' : ''}
        </span>
        {night.excluded && <span className="attend-excluded-tag">Excluded from scoring</span>}
        {!readOnly && (
          <button
            type="button"
            className="button button-quiet attend-exclude-btn"
            disabled={toggleExcluded.isPending}
            onClick={() =>
              toggleExcluded.mutate(
                { raidDate: night.date, excluded: !night.excluded },
                { onError: (error) => announce('error', errorMessage(error)) }
              )
            }
          >
            {night.excluded ? 'Remove Exclusion' : 'Exclude Report'}
          </button>
        )}
      </div>
      <div className="attend-grid-rows">
        {night.players.map((p) => {
          const isLateFlag = p.source === 'WCL (Late?)';
          return (
            <div className="attend-grid-row" key={p.playerId}>
              <span className="attend-grid-name">{p.name}</span>
              <span className={`attend-grid-source${isLateFlag ? ' attend-late-flag' : ''}`}>{p.source || ''}</span>
              <label className="visually-hidden" htmlFor={`attend-status-${night.date}-${p.playerId}`}>
                {p.name}'s status for {night.title}
              </label>
              <select
                id={`attend-status-${night.date}-${p.playerId}`}
                className="input attend-status-select"
                value={p.status ?? ''}
                disabled={readOnly || setStatus.isPending}
                onChange={(e) =>
                  setStatus.mutate(
                    { playerId: p.playerId, raidDate: night.date, status: e.target.value, oldStatus: p.status },
                    { onError: (error) => announce('error', errorMessage(error)) }
                  )
                }
              >
                {!p.status && (
                  <option value="" disabled>
                    (no status)
                  </option>
                )}
                {ATTENDANCE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </>
  );
}
