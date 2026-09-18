import { useEffect, useState, type ReactNode } from 'react';
import { useBlocker } from 'react-router';
import { DataState } from '../components/DataState';
import { Dialog } from '../components/Dialog';
import { useStatus } from '../components/Status';
import { useTeam } from '../data/address';
import { bothQueries } from '../data/query';
import { classColor, type PlayerRow } from '../roster/roster';
import { shortDay, type Answer, type RaidNight } from './calendar';
import {
  changes,
  current,
  everyoneIn,
  lineupRaids,
  lineupView,
  placesFor,
  placesOf,
  sameSet,
  seasonOn,
  toggle,
  wholeNight,
  type EncounterRow,
  type LineupBoss,
  type LineupRaid,
  type PlaceRow,
  type SeasonRow
} from './lineup';
import {
  useBossGroups,
  useEncounters,
  useNightPlan,
  usePlanNight,
  useSaveGroups,
  useSaveNight,
  useSeasons,
  useSkipBoss,
  type BossSave,
  type NightPlan,
  type SaveResult
} from './useCalendar';

// The officer's boss lineup for a raid night (#1216): everyone on the roster
// down the side, the night's bosses across, and a cell to click for each. The
// night starts as a copy of each boss's usual group; an officer saves a change
// for tonight only or to the group. Board E of the boss lineup mockups
// (2026-09-18), with F, G and H for a night not planned yet, leaving with
// unsaved changes, and someone else saving first.
export function BossLineup({ night, players, answers }: { night: RaidNight; players: PlayerRow[]; answers: Answer[] }) {
  const team = useTeam();
  const lookups = bothQueries(useSeasons(), useEncounters());
  const plan = bothQueries(useNightPlan(team.id, night.date), useBossGroups(team.id));

  return (
    <DataState query={bothQueries(lookups, plan)} label="the boss lineup">
      {([[seasons, encounters], [nightPlan, groups]]) => (
        <Lineup
          night={night}
          players={players}
          answers={answers}
          seasons={seasons}
          encounters={encounters}
          plan={nightPlan}
          groups={groups}
        />
      )}
    </DataState>
  );
}

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const toList = (set: ReadonlySet<number>) => [...set].sort((a, b) => a - b);

function Lineup({
  night,
  players,
  answers,
  seasons,
  encounters,
  plan,
  groups
}: {
  night: RaidNight;
  players: PlayerRow[];
  answers: Answer[];
  seasons: SeasonRow[];
  encounters: EncounterRow[];
  plan: NightPlan;
  groups: PlaceRow[];
}) {
  const team = useTeam();
  const { announce } = useStatus();
  const [edits, setEdits] = useState<ReadonlyMap<number, ReadonlySet<number>>>(new Map());
  const [fresh, setFresh] = useState(false);
  const [shown, setShown] = useState<number | null>(null);
  const [stale, setStale] = useState<number[]>([]);
  const [message, setMessage] = useState('');
  const saveNight = useSaveNight(team.id, night.date);
  const saveGroups = useSaveGroups(team.id, night.date);
  const planNight = usePlanNight(team.id, night.date);
  const skip = useSkipBoss(team.id, night.date);
  const busy = saveNight.isPending || saveGroups.isPending || planNight.isPending || skip.isPending;

  const season = seasonOn(seasons, night.date);
  const planned = plan.bosses.length > 0;
  const saved = placesOf(plan.places);
  const usual = placesOf(groups);
  const raids = lineupRaids(encounters, plan.bosses, { fresh: fresh && !planned, season });
  const bosses = raids.flatMap((r) => r.bosses);
  const places = current(saved, edits);
  const changed = changes(saved, edits);
  const dirty = changed.cells > 0;
  const live = bosses.filter((b) => !b.skipped);
  const offGroup = live.filter((b) => !sameSet(placesFor(places, b.id), placesFor(usual, b.id)));
  const names = (ids: number[]) => ids.map((id) => bosses.find((b) => b.id === id)?.name ?? 'A boss').join(', ');

  const leaveDialog = useLeaveGuard(dirty, changed.cells);

  if (!raids.length) {
    const seasonBosses = encounters.filter((e) => e.zone.season === season);
    const hasGroups = groups.some((g) => seasonBosses.some((e) => e.id === g.encounter_id));
    if (!seasonBosses.length) {
      return (
        <p className="card calendar-note">
          No bosses are loaded for this season yet. They arrive with the next Warcraft Logs sync.
        </p>
      );
    }
    if (hasGroups) {
      return (
        <section className="card lineup-empty" aria-labelledby="lineup-empty-title">
          <h2 id="lineup-empty-title">This night isn’t planned yet.</h2>
          <p className="text-muted">
            Each raid night is filled from the boss groups automatically about a week ahead. You can fill this one now
            and change it from there. Bench raiders start out on every boss.
          </p>
          <button
            type="button"
            className="button button-primary"
            disabled={busy}
            onClick={() =>
              planNight.mutate(null, {
                onSuccess: (n) => announce('success', `Filled ${plural(n, 'boss', 'bosses')} from their groups.`)
              })
            }
          >
            {planNight.isPending ? 'Filling…' : 'Fill from the groups'}
          </button>
          {planNight.isError && (
            <p className="form-error" role="alert">
              That did not fill: {planNight.error.message}
            </p>
          )}
        </section>
      );
    }
    return (
      <section className="card lineup-empty" aria-labelledby="lineup-empty-title">
        <h2 id="lineup-empty-title">No boss has a usual group yet.</h2>
        <p className="text-muted">
          Start this night with everyone on the roster in (bench raiders out), set each boss the way you want, then
          press <strong>Save to the group</strong>. Every night after this one starts from those groups.
        </p>
        <button
          type="button"
          className="button button-primary"
          onClick={() => {
            const all = lineupRaids(encounters, [], { fresh: true, season }).flatMap((r) => r.bosses);
            setEdits(everyoneIn(players, all));
            setFresh(true);
          }}
        >
          Start with everyone in
        </button>
      </section>
    );
  }

  const raid = raids.find((r) => r.zoneId === shown) ?? raids[0]!;

  // After a save: saved bosses drop their edits, refused ones keep them so the
  // officer can compare.
  const settle = (result: SaveResult, done: string) => {
    setEdits((e) => new Map([...e].filter(([id]) => !result.saved.includes(id))));
    setStale(result.stale);
    setMessage(result.stale.length ? '' : done);
    if (!result.stale.length) announce('success', done);
  };

  const nightSaves: BossSave[] = changed.bosses.map((id) => ({
    encounterId: id,
    players: toList(places.get(id)!),
    expected: toList(placesFor(saved, id))
  }));

  const onSaveTonight = () =>
    saveNight.mutate(nightSaves, { onSuccess: (r) => settle(r, `Saved the lineup for ${shortDay(night.date)}.`) });

  const onSaveGroups = () =>
    saveGroups.mutate(
      {
        night: nightSaves,
        groups: offGroup.map((b) => ({
          encounterId: b.id,
          players: toList(placesFor(places, b.id)),
          expected: toList(placesFor(usual, b.id))
        }))
      },
      {
        onSuccess: (r) =>
          settle(
            r,
            `Saved to the usual groups, and ${shortDay(night.date)} too. Coming nights nobody has saved yet start this way now.`
          )
      }
    );

  const onSkip = (boss: LineupBoss) =>
    skip.mutate(
      { encounterId: boss.id, skipped: !boss.skipped },
      {
        onSuccess: () => {
          setEdits((e) => new Map([...e].filter(([id]) => id !== boss.id)));
          const done = boss.skipped
            ? `${boss.name} is back on ${shortDay(night.date)}, filled from its group.`
            : `${boss.name} is off ${shortDay(night.date)}.`;
          setMessage(done);
          announce('success', done);
        }
      }
    );

  const error = saveNight.error ?? saveGroups.error ?? skip.error;
  const barState = stale.length ? 'stale' : error ? 'error' : dirty ? 'dirty' : 'clean';
  const barTitle =
    barState === 'stale'
      ? `${names(stale)} ${stale.length === 1 ? 'wasn’t' : 'weren’t'} saved.`
      : barState === 'error'
        ? 'That did not save.'
        : dirty
          ? `${plural(changed.cells, 'unsaved change')}.`
          : message || 'No unsaved changes. Click a cell to swap someone in or out.';
  const barHelp =
    barState === 'stale'
      ? 'Someone else changed it while you were editing, and saving yours would have undone theirs. Your other bosses saved.'
      : barState === 'error'
        ? error!.message
        : 'Save tonight changes this night only. Save to the group also makes it the usual group, so every coming night starts this way.';

  const confirmed = live.filter((b) => b.confirmed).length;

  return (
    <div className="lineup">
      <p className="lineup-status">
        <span>
          {!planned
            ? 'Not saved yet: every boss starts with everyone in.'
            : confirmed === live.length
              ? `Every boss is saved for ${shortDay(night.date)}.`
              : `${confirmed} of ${plural(live.length, 'boss', 'bosses')} saved for ${shortDay(night.date)}; the rest follow their usual groups.`}
        </span>
        <span className="lineup-legend text-muted">
          <span>
            <span className="lineup-dot" aria-hidden="true" /> changed for tonight only (the usual group has it the
            other way)
          </span>
          <span>
            <span className="lineup-conflict-mark" aria-hidden="true">
              !
            </span>{' '}
            in, but said they’re not coming
          </span>
        </span>
      </p>

      <div className="lineup-savebar" data-state={barState} role="status">
        <p>
          <strong>{barTitle}</strong> <span className="text-muted">{barHelp}</span>
        </p>
        <div className="lineup-actions">
          {barState === 'stale' && (
            <button
              type="button"
              className="button"
              onClick={() => {
                setEdits((e) => new Map([...e].filter(([id]) => !stale.includes(id))));
                setStale([]);
              }}
            >
              Show their version
            </button>
          )}
          <button
            type="button"
            className="button button-quiet"
            disabled={busy || !dirty}
            onClick={() => {
              setEdits(new Map());
              setStale([]);
              setFresh(false);
            }}
          >
            Discard
          </button>
          <button
            type="button"
            className="button"
            disabled={busy || (!dirty && !offGroup.length)}
            onClick={onSaveGroups}
          >
            {saveGroups.isPending ? 'Saving…' : 'Save to the group'}
          </button>
          <button type="button" className="button button-primary" disabled={busy || !dirty} onClick={onSaveTonight}>
            {saveNight.isPending ? 'Saving…' : 'Save tonight'}
          </button>
        </div>
      </div>

      {raids.length > 1 && (
        <div className="lineup-raids" role="group" aria-label="Raid">
          {raids.map((r) => (
            <button
              key={r.zoneId}
              type="button"
              className={`button${r.zoneId === raid.zoneId ? ' is-chosen' : ''}`}
              aria-pressed={r.zoneId === raid.zoneId}
              onClick={() => setShown(r.zoneId)}
            >
              {r.name} · {r.cap} per boss
            </button>
          ))}
        </div>
      )}

      <RaidGrid
        raid={raid}
        night={night}
        players={players}
        answers={answers}
        places={places}
        usual={usual}
        busy={busy}
        onToggle={(boss, id) => {
          setEdits((e) => toggle(saved, e, boss, id));
          setMessage('');
          setStale([]);
        }}
        onWholeNight={(id, putIn) => {
          setEdits((e) => wholeNight(saved, e, raid.bosses, id, putIn));
          setMessage('');
        }}
        onSkip={planned ? onSkip : null}
      />
      {leaveDialog}
    </div>
  );
}

// Leaving with unsaved changes asks first: another tab, another night, or any
// other page. Closing the browser tab gets the browser's own question.
function useLeaveGuard(dirty: boolean, count: number): ReactNode {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search)
  );

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (blocker.state !== 'blocked') return null;
  return (
    <Dialog title="Leave without saving?" onClose={() => blocker.reset()}>
      <p className="text-muted">
        You have {plural(count, 'unsaved change')} to this night’s boss lineup. If you leave now,{' '}
        {count === 1 ? 'it’s' : 'they’re'} lost.
      </p>
      <div className="dialog-actions">
        <span className="grow" />
        <button type="button" className="button button-quiet" onClick={() => blocker.proceed()}>
          Leave and discard
        </button>
        <button type="button" className="button button-primary" onClick={() => blocker.reset()}>
          Keep editing
        </button>
      </div>
    </Dialog>
  );
}

function RaidGrid({
  raid,
  night,
  players,
  answers,
  places,
  usual,
  busy,
  onToggle,
  onWholeNight,
  onSkip
}: {
  raid: LineupRaid;
  night: RaidNight;
  players: PlayerRow[];
  answers: Answer[];
  places: ReadonlyMap<number, ReadonlySet<number>>;
  usual: ReadonlyMap<number, ReadonlySet<number>>;
  busy: boolean;
  onToggle: (boss: number, player: number) => void;
  onWholeNight: (player: number, putIn: boolean) => void;
  // Null until the night has a plan to skip bosses on.
  onSkip: ((boss: LineupBoss) => void) | null;
}) {
  const [showBuffs, setShowBuffs] = useState(false);
  const view = lineupView(players, night, answers, raid, places, usual);
  const columns = raid.bosses.length + 2;
  const totals = new Map(view.totals.map((t) => [t.boss.id, t]));
  const gaps = view.totals.filter((t) => t.problems.length);
  const liveCount = view.live.length;

  return (
    <div className="lineup-layout">
      <div className="card lineup-card">
        <table className="lineup-grid">
          <caption className="visually-hidden">
            {raid.name} lineup for {shortDay(night.date)}, up to {raid.cap} per boss
          </caption>
          <thead>
            <tr>
              <th scope="col" className="lineup-name-col">
                Raider
              </th>
              {raid.bosses.map((boss) => {
                const t = totals.get(boss.id);
                return (
                  <th key={boss.id} scope="col" className="lineup-boss" data-skipped={boss.skipped}>
                    <span className="lineup-boss-name" aria-hidden="true">
                      {boss.short}
                    </span>
                    <span className="visually-hidden">{boss.name}</span>
                    {t ? (
                      <>
                        <span className="lineup-total num" data-tone={t.status.tone}>
                          {t.count}/{raid.cap}
                        </span>
                        <span className="lineup-warn">{t.warn}</span>
                        <span className="lineup-mix" aria-hidden="true">
                          {t.tanks}T {t.healers}H {t.damage}D
                        </span>
                        <span className="visually-hidden">
                          {plural(t.tanks, 'tank')}, {plural(t.healers, 'healer')}, {t.damage} damage
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="lineup-total lineup-skipped">Skipped</span>
                        <span className="lineup-warn lineup-skipped">tonight</span>
                      </>
                    )}
                    {onSkip && (
                      <button
                        type="button"
                        className="button lineup-skip"
                        disabled={busy}
                        aria-label={boss.skipped ? `Put ${boss.name} back on tonight` : `Skip ${boss.name} tonight`}
                        onClick={() => onSkip(boss)}
                      >
                        {boss.skipped ? 'Put back' : 'Skip'}
                      </button>
                    )}
                  </th>
                );
              })}
              <th scope="col" className="lineup-count-col">
                <span className="visually-hidden">Bosses in</span>
              </th>
            </tr>
          </thead>
          {view.groups.map((g) => (
            <tbody key={g.role}>
              <tr className="lineup-group">
                <th colSpan={columns} scope="colgroup">
                  {g.label}
                </th>
              </tr>
              {g.rows.map((r) => {
                const name = r.row.name;
                const liveCells = r.cells.filter((c) => !c.boss.skipped);
                const allIn = liveCells.length > 0 && liveCells.every((c) => c.in);
                return (
                  <tr key={r.row.player.id}>
                    <th scope="row" className="lineup-raider">
                      <span
                        className="lineup-raider-name"
                        style={{ color: classColor(r.row.player.classes_specs?.class ?? '') }}
                      >
                        {name}
                      </span>{' '}
                      <span className="text-dim lineup-spec">{r.row.player.classes_specs?.spec}</span>
                      {r.tag && (
                        <span className="lineup-tag" data-tone={r.tagTone}>
                          {r.tag}
                        </span>
                      )}
                      {r.row.player.is_bench && liveCells.length > 0 && (
                        <button
                          type="button"
                          className="link-button lineup-whole-night"
                          disabled={busy}
                          aria-label={allIn ? `${name} out all night` : `${name} in all night`}
                          onClick={() => onWholeNight(r.row.player.id, !allIn)}
                        >
                          {allIn ? 'Out all night' : 'In all night'}
                        </button>
                      )}
                    </th>
                    {r.cells.map((c) => {
                      const state = c.boss.skipped ? 'skipped tonight' : c.in ? 'in' : 'out';
                      const extra = [
                        ...(c.conflict ? ['but said they’re not coming'] : []),
                        ...(c.differs ? [`changed for tonight only, usually ${c.in ? 'out' : 'in'}`] : [])
                      ];
                      return (
                        <td key={c.boss.id} className="lineup-cell">
                          <button
                            type="button"
                            className={`lineup-toggle${c.in ? ' is-in' : ''}${c.conflict ? ' is-conflict' : ''}`}
                            aria-label={`${name}, ${c.boss.name}: ${[state, ...extra].join(', ')}`}
                            disabled={busy || c.boss.skipped}
                            onClick={() => onToggle(c.boss.id, r.row.player.id)}
                          >
                            <span aria-hidden="true">{c.boss.skipped ? '' : c.conflict ? '!' : c.in ? '✓' : '–'}</span>
                            {c.differs && <span className="lineup-dot lineup-cell-dot" aria-hidden="true" />}
                          </button>
                        </td>
                      );
                    })}
                    <td className="lineup-count num text-muted">
                      {r.count}/{liveCount}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>

      <aside className="lineup-side" aria-label="Lineup checks">
        <section className="card lineup-panel" aria-labelledby="needs-look-title">
          <div className="lineup-panel-head">
            <h2 id="needs-look-title">Needs a look</h2>
            <span className="lineup-gap-summary" data-clear={gaps.length === 0}>
              {gaps.length ? `${gaps.length} of ${plural(liveCount, 'boss', 'bosses')}` : 'All clear'}
            </span>
          </div>
          {(gaps.length > 0 || view.benchOut.length > 0) && (
            <ul className="lineup-gaps">
              {gaps.map((t) => (
                <li key={t.boss.id}>
                  <span className="lineup-gap-boss">
                    {raid.bosses.indexOf(t.boss) + 1}. {t.boss.name}
                  </span>
                  <span className="lineup-gap-text">{t.problems.join(' · ')}</span>
                </li>
              ))}
              {view.benchOut.length > 0 && (
                <li>
                  <span className="lineup-gap-boss">Bench</span>
                  <span className="text-muted lineup-gap-note">
                    {view.benchOut.join(' and ')} {view.benchOut.length === 1 ? 'is' : 'are'} out on every boss unless
                    you put them in.
                  </span>
                </li>
              )}
            </ul>
          )}
          {!gaps.length && <p className="lineup-all-clear">Every boss is full and every buff is covered.</p>}
          <button
            type="button"
            className="link-button"
            aria-expanded={showBuffs}
            aria-controls="all-buffs"
            onClick={() => setShowBuffs((v) => !v)}
          >
            {showBuffs ? 'Hide all buffs' : 'Show all buffs'}
          </button>
        </section>
        {showBuffs && (
          <section id="all-buffs" className="card lineup-panel" aria-labelledby="all-buffs-title">
            <h2 id="all-buffs-title">All buffs, by boss</h2>
            <p className="text-dim lineup-buff-key">
              One square per boss tonight, left to right: {view.live.map((b) => b.short).join(', ')}. A check is
              covered, a cross is missing.
            </p>
            <ul className="lineup-buff-rows">
              {view.buffs.map(({ buff, cells }) => (
                <li key={buff.name}>
                  <span className="text-muted">{buff.name}</span>
                  <span className="lineup-squares">
                    {cells.map((c) => {
                      const text = c.providers.length
                        ? `${c.boss.short}: ${c.providers.join(', ')}`
                        : `${c.boss.short}: missing`;
                      return (
                        <span
                          key={c.boss.id}
                          className={`lineup-square${c.providers.length ? '' : ' is-missing'}`}
                          title={text}
                        >
                          <span aria-hidden="true">{c.providers.length ? '✓' : '✕'}</span>
                          <span className="visually-hidden">{text}</span>
                        </span>
                      );
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}
