import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { DataState } from '../components/DataState';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { useStatus } from '../components/Status';
import { can, charactersOn, useAccess } from '../auth/access';
import { useSession } from '../auth/session';
import { useAddress, useTeam } from '../data/address';
import { bothQueries } from '../data/query';
import { useTouchScreen } from '../lib/device';
import { classColor, type PlayerRow } from '../roster/roster';
import { useRosterPlayers } from '../roster/useRoster';
import { isoDate, WEEKDAYS } from './nights';
import {
  ago,
  ANSWERS,
  answerLabel,
  ATTENDING,
  firstOfMonth,
  isDateParam,
  lastOfMonth,
  longDay,
  monthCounts,
  monthLabel,
  monthParam,
  neighbours,
  nightsBetween,
  nightTitle,
  nightView,
  parseMonth,
  PRESENT,
  rosterOf,
  shortDay,
  startTime,
  statusFor,
  timeRange,
  weekStart,
  type Answer,
  type CancelledNight,
  type Kind,
  type NightRow,
  type RaidNight,
  type ScheduleRule
} from './calendar';
import { BossLineup } from './BossLineup';
import { YourBosses } from './YourBosses';
import {
  useAnswers,
  useOfficerSetAnswer,
  useRotatorWeek,
  useSchedule,
  useScheduleChanges,
  useSetOwnAnswer,
  type AnswerAccess
} from './useCalendar';
import './calendar.css';

// The team's Calendar (#1102), redesigned (Kat, 2026-09-16): a month of raid
// nights, each opening its own page at ?date=YYYY-MM-DD. What it keeps from the
// current site is recorded in tests/behavior/calendar.js.
export function CalendarPage() {
  const [params] = useSearchParams();
  const date = params.get('date');
  return isDateParam(date) ? (
    <NightPage key={date} date={date} lineup={params.get('view') === 'lineup'} />
  ) : (
    <MonthPage month={params.get('month')} />
  );
}

// Who is reading, and what they may see and do.
type Viewer = {
  signedIn: boolean;
  access: AnswerAccess;
  // The reader's character on this team's roster, if any.
  me: PlayerRow | null;
  officer: boolean;
  // Still finding out who a signed-in reader is.
  ready: boolean;
};

function useViewer(roster: PlayerRow[] | undefined): Viewer {
  const team = useTeam();
  const { user } = useSession();
  const access = useAccess();
  const mine = charactersOn(access.data, team.id).map((c) => c.playerId);
  const officer = can(access.data, 'viewOfficerTools', team.id);
  const me = rosterOf(roster ?? []).find((p) => mine.includes(p.id)) ?? null;
  const ready = !user || access.isSuccess || access.isError;
  return {
    signedIn: !!user,
    access: officer ? { kind: 'officer' } : mine.length ? { kind: 'raider', playerIds: mine } : { kind: 'none' },
    me,
    officer,
    ready: ready && roster !== undefined
  };
}

const useCalendarBase = () => {
  const { guild } = useAddress();
  const team = useTeam();
  return `/g/${guild.key}/t/${team.key}/calendar`;
};

function scheduleSummary(schedule: ScheduleRule[]): string {
  const regular = schedule.filter((r) => !r.is_optional);
  if (!regular.length) return 'No weekly raid nights are set.';
  const days = [...new Set(regular.map((r) => r.weekday))].map((d) => LONG_WEEKDAYS[d]);
  const list = days.length > 1 ? `${days.slice(0, -1).join(', ')} and ${days.at(-1)}` : days[0];
  const first = regular[0]!;
  return `Raids ${list}, ${timeRange({ start: first.start_time, durationMinutes: first.duration_minutes })}.`;
}

const LONG_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Status marks: each kind has its own shape as well as its colour (#442).
function Mark({ kind }: { kind: Kind }) {
  return <span className={`mark mark-${kind}`} aria-hidden="true" />;
}

function Pill({ kind, children }: { kind: Kind; children: ReactNode }) {
  return (
    <span className={`pill pill-${kind}`}>
      <Mark kind={kind} />
      {children}
    </span>
  );
}

// The month

function MonthPage({ month: monthValue }: { month: string | null }) {
  const team = useTeam();
  const base = useCalendarBase();
  const [today] = useState(() => new Date());
  const { year, month } = parseMonth(monthValue, today);
  const from = firstOfMonth(year, month);
  const to = lastOfMonth(year, month);
  const schedule = useSchedule(team.id);
  const changes = useScheduleChanges(team.id, from, to);
  const roster = useRosterPlayers(team.id);
  const viewer = useViewer(roster.data);
  const answers = useAnswers(team.id, from, to, viewer.access, viewer.ready);
  const page = bothQueries(bothQueries(schedule, changes), bothQueries(roster, answers));
  const label = monthLabel(year, month);
  const prev = new Date(year, month - 1, 1);
  const next = new Date(year, month + 1, 1);

  return (
    <section className="page calendar-page" aria-labelledby="page-title">
      <div className="calendar-head">
        <div className="page-header">
          <h1 id="page-title">Calendar</h1>
          {schedule.isSuccess && <p className="text-muted page-subtitle">{scheduleSummary(schedule.data)}</p>}
        </div>
        <nav className="month-nav" aria-label="Month">
          <Link
            className="button icon-only"
            to={`${base}?month=${monthParam(prev.getFullYear(), prev.getMonth())}`}
            aria-label={`Previous month, ${monthLabel(prev.getFullYear(), prev.getMonth())}`}
          >
            <Icon name="chevronLeft" />
          </Link>
          <h2 className="month-label" aria-live="polite">
            {label}
          </h2>
          <Link
            className="button icon-only"
            to={`${base}?month=${monthParam(next.getFullYear(), next.getMonth())}`}
            aria-label={`Next month, ${monthLabel(next.getFullYear(), next.getMonth())}`}
          >
            <Icon name="chevronRight" />
          </Link>
          <Link className="button" to={base}>
            Today
          </Link>
        </nav>
      </div>

      <DataState query={page} label="the calendar">
        {([[rules, dayChanges], [players, rows]]) => (
          <Month
            year={year}
            month={month}
            today={today}
            viewer={viewer}
            players={players}
            answers={rows}
            {...nightsBetween(rules, dayChanges, from, to)}
          />
        )}
      </DataState>
    </section>
  );
}

function Month({
  year,
  month,
  today,
  viewer,
  players,
  answers,
  nights,
  cancelled
}: {
  year: number;
  month: number;
  today: Date;
  viewer: Viewer;
  players: PlayerRow[];
  answers: Answer[];
  nights: RaidNight[];
  cancelled: CancelledNight[];
}) {
  const base = useCalendarBase();
  const todayIso = isoDate(today);
  const seesAnswers = viewer.access.kind !== 'none';
  const mine = (night: RaidNight) =>
    viewer.me
      ? statusFor(
          viewer.me,
          night,
          answers.find((a) => a.player_id === viewer.me!.id && a.raid_date === night.date)
        )
      : null;

  type Entry = { date: string; night: RaidNight | null; cancelled: CancelledNight | null };
  const entries: Entry[] = [
    ...nights.map((night) => ({ date: night.date, night, cancelled: null })),
    ...cancelled.map((c) => ({ date: c.date, night: null, cancelled: c }))
  ].sort((a, b) => a.date.localeCompare(b.date));
  const nextUp = viewer.me ? nights.find((n) => n.date >= todayIso) : undefined;

  const chip = (entry: Entry) => {
    if (entry.cancelled) {
      return (
        <div className="night-chip night-cancelled">
          <span className="night-chip-row">
            <span className="night-title">Raid night</span>
            <span className="night-time">{startTime(entry.cancelled)}</span>
          </span>
          <span className="night-cancelled-label">Cancelled</span>
        </div>
      );
    }
    const night = entry.night!;
    const counts = seesAnswers ? monthCounts(players, night, answers) : null;
    const status = mine(night);
    const title = nightTitle(night);
    const label = [
      shortDay(night.date),
      title,
      startTime(night),
      counts ? `${counts.in} in${counts.out ? `, ${counts.out} out` : ''}` : null,
      status ? `you: ${status.label}` : null
    ]
      .filter(Boolean)
      .join(', ');
    return (
      <Link
        className={`night-chip${night.optional ? ' night-optional' : night.extra ? ' night-extra' : ''}${
          night.date < todayIso ? ' night-past' : ''
        }`}
        to={`${base}?date=${night.date}`}
        aria-label={label}
        data-date={night.date}
      >
        <span className="night-chip-row">
          <span className="night-title">{title}</span>
          <span className="night-time">{startTime(night)}</span>
        </span>
        {counts && (
          <span className="night-count num">
            <b>{counts.in}</b> in{counts.out ? ` · ${counts.out} out` : ''}
          </span>
        )}
        {status && (
          <span className="night-mine" data-status={status.label}>
            <Pill kind={status.kind}>{status.label}</Pill>
          </span>
        )}
      </Link>
    );
  };

  // The grid: the month's days under their weekdays, with the days either
  // side greyed out to fill the weeks.
  const first = new Date(year, month, 1);
  const days: { date: string; day: number; inMonth: boolean }[] = [];
  const start = new Date(year, month, 1 - first.getDay());
  const length = Math.ceil((first.getDay() + new Date(year, month + 1, 0).getDate()) / 7) * 7;
  for (let i = 0; i < length; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    days.push({ date: isoDate(d), day: d.getDate(), inMonth: d.getMonth() === month });
  }

  const nextStatus = nextUp ? mine(nextUp) : null;
  const nextCounts = nextUp && seesAnswers ? nightView(players, nextUp, answers).counts : null;

  return (
    <>
      {!viewer.signedIn && <p className="card calendar-note">Sign in to see who’s coming and to give your answer.</p>}
      {viewer.signedIn && !seesAnswers && viewer.ready && (
        <p className="card calendar-note">Only this team’s raiders and officers can see who’s coming.</p>
      )}

      {nextUp && nextStatus && (
        <section className="card next-raid" aria-labelledby="next-raid-title">
          <h2 id="next-raid-title" className="eyebrow">
            Your next raid
          </h2>
          <span className="next-raid-when">
            {shortDay(nextUp.date)} · {startTime(nextUp)}
          </span>
          <Pill kind={nextStatus.kind}>{nextStatus.label}</Pill>
          {nextCounts && (
            <span className="text-muted num">
              {nextCounts.in} in{nextCounts.flagged ? ` (${nextCounts.flagged} late or unsure)` : ''} · {nextCounts.out}{' '}
              out
            </span>
          )}
          <span className="grow" />
          <Link className="button" to={`${base}?date=${nextUp.date}`}>
            Open night
          </Link>
        </section>
      )}

      <section className="card month-grid-card" aria-label={`Raid nights in ${monthLabel(year, month)}`}>
        <div className="month-weekdays" aria-hidden="true">
          {WEEKDAYS.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <div className="month-grid">
          {days.map((d) => (
            <div
              key={d.date}
              className={`month-day${d.inMonth ? '' : ' month-day-other'}${d.date === todayIso ? ' month-day-today' : ''}`}
            >
              <span className="month-daynum num" aria-hidden="true">
                {d.day}
              </span>
              {d.date === todayIso && <span className="visually-hidden">Today</span>}
              {d.inMonth &&
                entries
                  .filter((e) => e.date === d.date)
                  .map((e, i) => (
                    <div key={i} className="month-day-night">
                      {chip(e)}
                    </div>
                  ))}
            </div>
          ))}
        </div>
      </section>

      {/* On a phone the grid is a list of the month's nights. */}
      <ol className="card month-list" aria-label={`Raid nights in ${monthLabel(year, month)}`}>
        {entries.map((e, i) => {
          const showToday = e.date >= todayIso && (i === 0 || entries[i - 1]!.date < todayIso);
          const d = new Date(`${e.date}T00:00:00`);
          return (
            <li key={`${e.date}-${i}`} className="month-list-item">
              {showToday && e.date !== todayIso && (
                <span className="month-list-today">Today, {shortDay(todayIso)}</span>
              )}
              <div className="month-list-row">
                <span className="month-list-date" aria-hidden="true">
                  <small>{WEEKDAYS[d.getDay()]}</small>
                  <b className={`num${e.date === todayIso ? ' is-today' : ''}`}>{d.getDate()}</b>
                </span>
                {chip(e)}
              </div>
            </li>
          );
        })}
        {!entries.length && <li className="text-dim month-list-empty">No raid nights this month.</li>}
      </ol>

      <ul className="calendar-legend">
        <li>
          <span className="legend-edge" aria-hidden="true" />
          Raid night
        </li>
        <li>
          <span className="legend-edge legend-optional" aria-hidden="true" />
          Optional night: say if you’re coming
        </li>
        <li>
          <span className="legend-edge legend-extra" aria-hidden="true" />
          Extra night
        </li>
        {seesAnswers && (
          <>
            <li>
              <Mark kind="in" />
              Present
            </li>
            <li>
              <Mark kind="flag" />
              Late, leaving early or tentative
            </li>
            <li>
              <Mark kind="out" />
              Absent
            </li>
          </>
        )}
      </ul>
    </>
  );
}

// A raid night

function NightPage({ date, lineup }: { date: string; lineup: boolean }) {
  const team = useTeam();
  const base = useCalendarBase();
  const day = new Date(`${date}T00:00:00`);
  // A month either side, to find the previous and next raid nights.
  const from = firstOfMonth(day.getFullYear(), day.getMonth() - 1);
  const to = lastOfMonth(day.getFullYear(), day.getMonth() + 1);
  const schedule = useSchedule(team.id);
  const changes = useScheduleChanges(team.id, from, to);
  const roster = useRosterPlayers(team.id);
  const viewer = useViewer(roster.data);
  const answers = useAnswers(team.id, date, date, viewer.access, viewer.ready);
  const page = bothQueries(bothQueries(schedule, changes), bothQueries(roster, answers));

  const found = schedule.isSuccess && changes.isSuccess ? nightsBetween(schedule.data, changes.data, from, to) : null;
  const night = found?.nights.find((n) => n.date === date) ?? null;
  const { previous, next } = neighbours(found?.nights ?? [], date);

  return (
    <section className="page calendar-page night-page" aria-labelledby="page-title">
      <Link className="back-link" to={`${base}?month=${monthParam(day.getFullYear(), day.getMonth())}`}>
        <Icon name="chevronLeft" size={14} />
        {monthLabel(day.getFullYear(), day.getMonth())}
      </Link>
      <div className="night-head">
        <div className="page-header">
          <h1 id="page-title">{longDay(date)}</h1>
          <p className="text-muted page-subtitle">
            {night ? `${timeRange(night)} · ${nightTitle(night)}` : found ? 'No raid' : ' '}
          </p>
        </div>
        <nav className="night-nav" aria-label="Raid nights">
          <NightStep base={base} date={previous} direction="previous" lineup={lineup} />
          <NightStep base={base} date={next} direction="next" lineup={lineup} />
        </nav>
      </div>

      <DataState query={page} label="this raid night">
        {([, [players, rows]]) => {
          if (!night) {
            const wasCancelled = found?.cancelled.some((c) => c.date === date);
            return (
              <p className="card calendar-note">
                {wasCancelled ? 'This raid night was cancelled.' : 'The team has no raid on this date.'}
              </p>
            );
          }
          if (viewer.access.kind === 'none') {
            return (
              <p className="card calendar-note">
                {viewer.signedIn
                  ? 'Only this team’s raiders and officers can see who’s coming.'
                  : 'Sign in to see who’s coming and to give your answer.'}
              </p>
            );
          }
          return <Night night={night} viewer={viewer} players={players} answers={rows} lineup={lineup} />;
        }}
      </DataState>
    </section>
  );
}

// Stepping to another night keeps the view: from the boss lineup, the next
// night's boss lineup.
function NightStep({
  base,
  date,
  direction,
  lineup
}: {
  base: string;
  date: string | null;
  direction: 'previous' | 'next';
  lineup: boolean;
}) {
  const icon = <Icon name={direction === 'previous' ? 'chevronLeft' : 'chevronRight'} />;
  const word = direction === 'previous' ? 'Previous' : 'Next';
  if (!date) {
    return (
      <span className="night-step">
        <span className="button icon-only" aria-disabled="true" role="link" aria-label={`${word} raid night: none`}>
          {icon}
        </span>
      </span>
    );
  }
  return (
    <span className={`night-step night-step-${direction}`}>
      {direction === 'previous' && <span className="night-step-date">{shortDay(date)}</span>}
      <Link
        className="button icon-only"
        to={`${base}?date=${date}${lineup ? '&view=lineup' : ''}`}
        aria-label={`${word} raid night: ${shortDay(date)}`}
      >
        {icon}
      </Link>
      {direction === 'next' && <span className="night-step-date">{shortDay(date)}</span>}
    </span>
  );
}

function Night({
  night,
  viewer,
  players,
  answers,
  lineup
}: {
  night: RaidNight;
  viewer: Viewer;
  players: PlayerRow[];
  answers: Answer[];
  lineup: boolean;
}) {
  const touch = useTouchScreen();
  const base = useCalendarBase();
  // Officer changes need a computer (Kat, 2026-09-16).
  const officerTools = viewer.officer && !touch;

  // The boss lineup is an officer tool (#1216), so it needs a computer too.
  if (officerTools) {
    return (
      <>
        <nav className="night-tabs" aria-label="Night views">
          <Link to={`${base}?date=${night.date}`} aria-current={lineup ? undefined : 'page'}>
            Who’s coming
          </Link>
          <Link to={`${base}?date=${night.date}&view=lineup`} aria-current={lineup ? 'page' : undefined}>
            Boss lineup
          </Link>
        </nav>
        {lineup ? (
          <BossLineup night={night} players={players} answers={answers} />
        ) : (
          <Coming night={night} viewer={viewer} players={players} answers={answers} officerTools />
        )}
      </>
    );
  }
  return <Coming night={night} viewer={viewer} players={players} answers={answers} officerTools={false} />;
}

function Coming({
  night,
  viewer,
  players,
  answers,
  officerTools
}: {
  night: RaidNight;
  viewer: Viewer;
  players: PlayerRow[];
  answers: Answer[];
  officerTools: boolean;
}) {
  const view = nightView(players, night, answers);
  const [now] = useState(() => new Date());
  const [editing, setEditing] = useState<NightRow | null>(null);
  const mine = viewer.me
    ? {
        player: viewer.me,
        answer: answers.find((a) => a.player_id === viewer.me!.id && a.raid_date === night.date) ?? null
      }
    : null;
  // The bench has nothing to answer on a normal night; the database refuses it too.
  const canAnswer = mine && !(mine.player.is_bench && !night.optional);

  const row = (r: NightRow) => (
    <li key={r.player.id} className={`night-row${r.status.kind === 'apart' ? ' night-row-apart' : ''}`}>
      <span className="night-name" style={{ color: classColor(r.player.classes_specs?.class ?? '') }}>
        {r.name}
      </span>
      {r.status.kind === 'in' && !r.status.answered ? (
        <span className="night-status" title={PRESENT}>
          <Mark kind="in" />
          <span className="visually-hidden">{PRESENT}</span>
        </span>
      ) : (
        <span className="night-status">
          <Pill kind={r.status.kind}>{r.status.label}</Pill>
        </span>
      )}
      {officerTools && <EditButton name={r.name} onClick={() => setEditing(r)} />}
    </li>
  );

  return (
    <>
      {viewer.me && <YourBosses night={night} me={viewer.me} className="your-bosses-narrow" />}
      <div className="night-layout">
        <aside className="card night-rail" aria-label="Your answer and tonight’s numbers">
          {canAnswer && mine && <OwnAnswer night={night} player={mine.player} answer={mine.answer} />}
          <section aria-labelledby="tonight-title" className="rail-section">
            <h2 id="tonight-title" className="eyebrow">
              Tonight
            </h2>
            <dl className="night-counts">
              <Count kind="in" label="Coming" value={view.counts.in} />
              <Count kind="flag" label="…of them late, leaving early or tentative" value={view.counts.flagged} sub />
              <Count kind="out" label="Out" value={view.counts.out} />
              <Count kind="apart" label="Bench and rotators" value={view.counts.apart} />
            </dl>
          </section>
          {view.latest.length > 0 && (
            <section aria-labelledby="latest-title" className="rail-section">
              <h2 id="latest-title" className="eyebrow">
                Latest answers
              </h2>
              <ul className="latest-list">
                {view.latest.map((r) => (
                  <li key={r.player.id}>
                    <span className="latest-row">
                      <span className="night-name" style={{ color: classColor(r.player.classes_specs?.class ?? '') }}>
                        {r.name}
                      </span>
                      <Pill kind={r.status.kind}>{r.status.label}</Pill>
                    </span>
                    <time className="text-dim" dateTime={r.updatedAt!} title={new Date(r.updatedAt!).toLocaleString()}>
                      {ago(r.updatedAt!, now)}
                    </time>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>

        <div className="night-main">
          {viewer.me && <YourBosses night={night} me={viewer.me} className="your-bosses-wide" />}
          <section className="card heads-up" aria-labelledby="heads-up-title">
            <h2 id="heads-up-title" className="eyebrow">
              Heads up
            </h2>
            <div className="heads-up-groups">
              <HeadsUpGroup
                title="Out"
                kind="out"
                rows={view.headsUp.out}
                officerTools={officerTools}
                onEdit={setEditing}
              />
              <HeadsUpGroup
                title="Late, leaving early or tentative"
                kind="flag"
                rows={view.headsUp.flagged}
                officerTools={officerTools}
                onEdit={setEditing}
              />
            </div>
          </section>

          <div className="role-columns">
            {view.groups.map((g) => (
              <section key={g.role} className="card role-column" aria-labelledby={`role-${g.role}`}>
                <h2 id={`role-${g.role}`} className="role-title">
                  {g.label}
                  <span className="text-muted num" aria-label={`${g.coming} of ${g.total} coming`}>
                    {g.coming}/{g.total}
                  </span>
                </h2>
                <ul className="night-rows">{g.rows.map(row)}</ul>
                {g.apart.length > 0 && (
                  <>
                    <h3 className="visually-hidden">{g.label}: bench and rotators</h3>
                    <ul className="night-rows night-rows-apart">{g.apart.map(row)}</ul>
                  </>
                )}
              </section>
            ))}
          </div>
        </div>

        {editing && <OfficerDialog row={editing} night={night} onClose={() => setEditing(null)} />}
      </div>
    </>
  );
}

// `sub`: a part of the row above (the late raiders are counted as coming).
function Count({ kind, label, value, sub = false }: { kind: Kind; label: string; value: number; sub?: boolean }) {
  return (
    <div className={`night-count-row${sub ? ' night-count-sub' : ''}`} data-kind={kind}>
      <dt>
        <Mark kind={kind} />
        {label}
      </dt>
      <dd className="num">{value}</dd>
    </div>
  );
}

function HeadsUpGroup({
  title,
  kind,
  rows,
  officerTools,
  onEdit
}: {
  title: string;
  kind: Kind;
  rows: NightRow[];
  officerTools: boolean;
  onEdit: (row: NightRow) => void;
}) {
  const id = useId();
  return (
    <div className="heads-up-group">
      <h3 id={id} className="heads-up-title">
        <Mark kind={kind} />
        {title}
        <span className="text-muted num">{rows.length}</span>
      </h3>
      {rows.length ? (
        <ul className="heads-up-list" aria-labelledby={id}>
          {rows.map((r) => (
            <li key={r.player.id} className={`heads-up-item heads-up-${kind}`}>
              <span className="heads-up-line">
                <span className="night-name" style={{ color: classColor(r.player.classes_specs?.class ?? '') }}>
                  {r.name}
                </span>
                <span className="text-dim heads-up-role">
                  {ROLE_WORD[r.role]} · {r.player.classes_specs?.spec}
                </span>
                <span className="grow" />
                <Pill kind={r.status.kind}>{r.status.label}</Pill>
                {officerTools && <EditButton name={r.name} onClick={() => onEdit(r)} />}
              </span>
              {r.note && <span className="heads-up-note">“{r.note}”</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-dim heads-up-empty">Nobody</p>
      )}
    </div>
  );
}

const ROLE_WORD = { Tank: 'Tank', Heal: 'Healer', Melee: 'Melee', Ranged: 'Ranged' } as const;

function EditButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button type="button" className="icon-button edit-button" aria-label={`Change ${name}’s answer`} onClick={onClick}>
      <Icon name="edit" size={13} />
    </button>
  );
}

// The reader's own answer. Present clears it back to the default; anything
// else needs a note so officers know why (Attending on an optional night
// does not).
function OwnAnswer({ night, player, answer }: { night: RaidNight; player: PlayerRow; answer: Answer | null }) {
  const team = useTeam();
  const { announce } = useStatus();
  const save = useSetOwnAnswer(team.id);
  const id = useId();
  const choices = [...(night.optional ? [ATTENDING] : [PRESENT]), ...ANSWERS];
  const [choice, setChoice] = useState<string>(answer?.status ?? (night.optional ? '' : PRESENT));
  const [note, setNote] = useState(answer?.note ?? '');
  const [missing, setMissing] = useState(false);
  const noteNeeded = choice !== PRESENT && choice !== ATTENDING && choice !== '';
  const unchanged = choice === (answer?.status ?? (night.optional ? '' : PRESENT)) && note === (answer?.note ?? '');

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!choice || (noteNeeded && !note.trim())) {
      setMissing(true);
      return;
    }
    setMissing(false);
    const status = choice === PRESENT ? null : choice;
    save.mutate(
      { date: night.date, status, note: note.trim(), teamKey: team.key, nameRealm: player.name_realm },
      {
        onSuccess: () => {
          if (status === null) setNote('');
          announce('success', `Saved: ${answerLabel(choice)} for ${shortDay(night.date)}.`);
        }
      }
    );
  };

  return (
    <form className="rail-section own-answer" onSubmit={onSubmit} noValidate>
      <fieldset>
        <legend className="eyebrow">Your answer</legend>
        <div className="answer-choices">
          {choices.map((c) => (
            <label key={c} className={`answer-choice${choice === c ? ' is-chosen' : ''}`}>
              <input
                type="radio"
                name={`${id}-answer`}
                value={c}
                checked={choice === c}
                onChange={() => setChoice(c)}
              />
              <Mark kind={c === PRESENT || c === ATTENDING ? 'in' : c === 'Absent' ? 'out' : 'flag'} />
              {answerLabel(c)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-note`}>
          {noteNeeded ? 'Note for officers (required)' : 'Note (optional)'}
        </label>
        <input
          id={`${id}-note`}
          className="input"
          value={note}
          aria-invalid={missing && noteNeeded && !note.trim()}
          disabled={choice === PRESENT}
          placeholder={noteNeeded ? 'For example, work runs late' : undefined}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {missing && (
        <p className="form-error" role="alert">
          {choice ? 'A note is required so officers know why.' : 'Choose your answer.'}
        </p>
      )}
      {save.isError && (
        <p className="form-error" role="alert">
          That did not save: {save.error.message}
        </p>
      )}
      <button type="submit" className="button button-primary" disabled={save.isPending || unchanged}>
        {save.isPending ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}

// An officer changing a raider's answer when they forgot to.
function OfficerDialog({ row, night, onClose }: { row: NightRow; night: RaidNight; onClose: () => void }) {
  const team = useTeam();
  const { announce } = useStatus();
  const save = useOfficerSetAnswer(team.id);
  const id = useId();
  const current = row.status.answered ? row.status.label : null;
  const choices = [...(night.optional ? [ATTENDING] : []), ...ANSWERS];
  const [choice, setChoice] = useState('');
  const [note, setNote] = useState('');
  const [missing, setMissing] = useState(false);
  const rotator = useRotatorWeek(team.id);
  const week = weekStart(night.date);
  const inForWeek = row.status.label === answerLabel('Rotator-In');
  const showRotator = row.player.is_rotator && !night.optional;

  const toggleWeek = () =>
    rotator.mutate(
      { date: night.date, weekStart: week, playerId: row.player.id, isIn: !inForWeek, teamKey: team.key },
      {
        onSuccess: () => {
          announce('success', `${row.name} is ${inForWeek ? 'out' : 'in'} for the week of ${shortDay(week)}.`);
          onClose();
        }
      }
    );

  const run = (status: string | null) =>
    save.mutate(
      { date: night.date, playerId: row.player.id, status, note: note.trim(), teamKey: team.key },
      {
        onSuccess: () => {
          announce(
            'success',
            status === null
              ? `Cleared ${row.name}’s answer for ${shortDay(night.date)}.`
              : `Saved: ${row.name} is ${answerLabel(status)} for ${shortDay(night.date)}.`
          );
          onClose();
        }
      }
    );

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!choice || !note.trim()) {
      setMissing(true);
      return;
    }
    run(choice);
  };

  return (
    <Dialog title={`Change ${row.name}’s answer`} onClose={onClose} busy={save.isPending || rotator.isPending}>
      <form className="officer-answer" onSubmit={onSubmit} noValidate>
        <p className="text-muted">
          {longDay(night.date)} · {nightTitle(night)} · {row.player.classes_specs?.spec}{' '}
          {row.player.classes_specs?.class}
        </p>
        <p className="officer-current">
          Right now: <Pill kind={row.status.kind}>{row.status.label}</Pill>
          {!current && <span className="text-dim"> (they haven’t answered)</span>}
        </p>
        {showRotator && (
          <div className="rotator-week">
            <p>
              {row.name} is a rotator.{' '}
              {inForWeek
                ? `They are in for every raid night in the week of ${shortDay(week)}.`
                : `Put them in for every raid night in the week of ${shortDay(week)}?`}
            </p>
            <button type="button" className="button" disabled={rotator.isPending} onClick={toggleWeek}>
              {inForWeek ? 'Out for the week' : 'In for the week'}
            </button>
            {rotator.isError && (
              <p className="form-error" role="alert">
                That did not save: {rotator.error.message}
              </p>
            )}
          </div>
        )}
        <fieldset>
          <legend className="field-label">New answer</legend>
          <div className="answer-choices answer-choices-stacked">
            {choices.map((c) => (
              <label key={c} className={`answer-choice${choice === c ? ' is-chosen' : ''}`}>
                <input
                  type="radio"
                  name={`${id}-answer`}
                  value={c}
                  checked={choice === c}
                  onChange={() => setChoice(c)}
                />
                <Mark kind={c === ATTENDING ? 'in' : c === 'Absent' ? 'out' : 'flag'} />
                {answerLabel(c)}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-note`}>
            Reason (required, the raider sees it)
          </label>
          <input
            id={`${id}-note`}
            className="input"
            value={note}
            aria-invalid={missing && !note.trim()}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        {missing && (
          <p className="form-error" role="alert">
            {choice ? 'A note is required so the raider knows why.' : 'Choose their new answer.'}
          </p>
        )}
        {save.isError && (
          <p className="form-error" role="alert">
            That did not save: {save.error.message}
          </p>
        )}
        <div className="dialog-actions">
          {current && (
            <button type="button" className="button" disabled={save.isPending} onClick={() => run(null)}>
              Clear their answer
            </button>
          )}
          <span className="grow" />
          <button type="button" className="button" onClick={onClose} disabled={save.isPending}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
