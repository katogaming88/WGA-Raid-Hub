import { useState, type CSSProperties, type SyntheticEvent } from 'react';
import { DataState } from '../components/DataState';
import { Dialog } from '../components/Dialog';
import { useStatus } from '../components/Status';
import { useTeam } from '../data/address';
import { bothQueries } from '../data/query';
import { useTouchScreen } from '../lib/device';
import { classColor, type PlayerRow, type Role } from '../roster/roster';
import { specIcon } from '../roster/specIcons';
import { displayName, shortDay, weekdayOf, type Answer, type RaidNight } from './calendar';
import { ColumnSizer } from './ColumnSizer';
import { useLeaveGuard } from './leaveGuard';
import {
  capLabel,
  changeList,
  changes,
  current,
  everyoneIn,
  lineupRaids,
  lineupView,
  onRoster,
  placesFor,
  placesOf,
  sameSet,
  seasonOn,
  toggle,
  wholeNight,
  type BossTotal,
  type EncounterRow,
  type LineupBoss,
  type LineupRaid,
  type PlaceRow,
  type RoleTargets,
  type SeasonRow
} from './lineup';
import {
  useBossGroups,
  useCellStyle,
  useEncounters,
  useLineupRoleTargets,
  useNightPlan,
  usePlanNight,
  useSaveCellStyle,
  useSaveGroups,
  useSaveNight,
  useSeasons,
  useSkipBoss,
  type BossSave,
  type CellStyle,
  type NightPlan,
  type SaveResult
} from './useCalendar';

// The boss lineup for a raid night (#1216, redrawn by #1681 from board D of
// the #1680 mockups): bosses across the top, the roster down the side in
// Tanks / Healers / Melee / Ranged, a class-colored cell per raider per boss.
// The night starts as a copy of each boss's usual group; one Save asks
// whether a change is for this night only or every night after.
//
// Officers edit on any device: this page is the exception to "officer edits
// on a computer only" (Kat, #1681), though skipping a boss, which saves at
// once, stays on a computer. Raiders see the same grid, read-only.
export function BossLineup({
  night,
  players,
  answers,
  canEdit
}: {
  night: RaidNight;
  players: PlayerRow[];
  answers: Answer[];
  canEdit: boolean;
}) {
  const team = useTeam();
  const lookups = bothQueries(useSeasons(), useEncounters());
  const plan = bothQueries(useNightPlan(team.id, night.date), useBossGroups(team.id));
  const targets = useLineupRoleTargets(team.id);

  return (
    <DataState query={bothQueries(bothQueries(lookups, plan), targets)} label="the boss lineup">
      {([[[seasons, encounters], [nightPlan, groups]], roleTargets]) => (
        <Lineup
          night={night}
          players={players}
          answers={answers}
          seasons={seasons}
          encounters={encounters}
          plan={nightPlan}
          groups={groups}
          targets={roleTargets}
          canEdit={canEdit}
        />
      )}
    </DataState>
  );
}

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const toList = (set: ReadonlySet<number>) => [...set].sort((a, b) => a - b);
// A picture Warcraft Logs doesn't have (or a blocked request) leaves no
// broken-image box behind.
const hideBroken = (e: SyntheticEvent<HTMLImageElement>) => {
  e.currentTarget.style.visibility = 'hidden';
};

function Lineup({
  night,
  players,
  answers,
  seasons,
  encounters,
  plan,
  groups,
  targets,
  canEdit
}: {
  night: RaidNight;
  players: PlayerRow[];
  answers: Answer[];
  seasons: SeasonRow[];
  encounters: EncounterRow[];
  plan: NightPlan;
  groups: PlaceRow[];
  targets: RoleTargets;
  canEdit: boolean;
}) {
  const team = useTeam();
  const touch = useTouchScreen();
  const { announce } = useStatus();
  const [edits, setEdits] = useState<ReadonlyMap<number, ReadonlySet<number>>>(new Map());
  const [fresh, setFresh] = useState(false);
  const [shown, setShown] = useState<number | null>(null);
  const [stale, setStale] = useState<number[]>([]);
  const [message, setMessage] = useState('');
  const [asking, setAsking] = useState(false);
  const [scope, setScope] = useState<'night' | 'usual'>('night');
  const savedStyle = useCellStyle();
  const saveStyle = useSaveCellStyle();
  const [picked, setPicked] = useState<CellStyle | null>(null);
  const saveNight = useSaveNight(team.id, night.date);
  const saveGroups = useSaveGroups(team.id, night.date);
  const planNight = usePlanNight(team.id, night.date);
  const skip = useSkipBoss(team.id, night.date);
  const busy = saveNight.isPending || saveGroups.isPending || planNight.isPending || skip.isPending;
  const cellStyle = picked ?? savedStyle.data ?? 'names';

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
  const byId = new Map(players.map((p) => [p.id, p]));
  const nameOf = (id: number) => (byId.has(id) ? displayName(byId.get(id)!) : 'A raider');
  const list = raids.flatMap((r) =>
    changeList(saved, edits, r.bosses, nameOf, raids.length > 1 ? `for all of ${r.name}` : 'all night')
  );
  const day = weekdayOf(night.date);

  const leaveDialog = useLeaveGuard(dirty, changed.cells, 'this night’s boss lineup');
  // What a save sends: nobody who has left the roster since the night was filled.
  const toSave = onRoster(places, players);

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
    if (!canEdit) {
      return <p className="card calendar-note">Your officers haven’t set the boss lineup for this night yet.</p>;
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
          Start this night with everyone on the roster in (bench raiders out), set each boss the way you want, then save
          it for {day} and every night after. Every night after this one starts from those groups.
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
    players: toList(placesFor(toSave, id)),
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
          players: toList(placesFor(toSave, b.id)),
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

  const confirmed = live.filter((b) => b.confirmed).length;
  const finalLine = !planned
    ? 'Not saved yet: every boss starts with everyone in.'
    : confirmed === live.length
      ? `Every boss is saved for ${shortDay(night.date)}.`
      : `${confirmed} of ${plural(live.length, 'boss', 'bosses')} saved for ${shortDay(night.date)}; the rest follow their usual groups.`;

  const error = saveNight.error ?? saveGroups.error ?? skip.error;
  const barState = stale.length ? 'stale' : error ? 'error' : dirty ? 'dirty' : 'clean';
  const barTitle =
    barState === 'stale'
      ? `${names(stale)} ${stale.length === 1 ? 'wasn’t' : 'weren’t'} saved.`
      : barState === 'error'
        ? 'That did not save.'
        : dirty
          ? `${plural(list.length, 'unsaved change')}:`
          : message || 'No unsaved changes.';
  const barHelp =
    barState === 'stale'
      ? 'Someone else changed it while you were editing, and saving yours would have undone theirs. Your other bosses saved.'
      : barState === 'error'
        ? error!.message
        : dirty
          ? list.slice(0, 3).join(' · ') + (list.length > 3 ? ` · and ${list.length - 3} more` : '')
          : finalLine;

  const openSave = () => {
    setScope(dirty ? 'night' : 'usual');
    setAsking(true);
  };
  const onSave = () => {
    setAsking(false);
    if (scope === 'night') onSaveTonight();
    else onSaveGroups();
  };

  const pickStyle = (style: CellStyle) => {
    setPicked(style);
    saveStyle.mutate(style);
  };

  return (
    <div className="lineup">
      {canEdit ? (
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
              className="button button-primary"
              disabled={busy || (!dirty && !offGroup.length)}
              onClick={openSave}
            >
              {saveNight.isPending || saveGroups.isPending ? 'Saving…' : 'Save…'}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-muted blg-final">{finalLine}</p>
      )}

      <div className="blg-tools">
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
                {r.name} · {capLabel(r.bosses)}
              </button>
            ))}
          </div>
        )}
        <fieldset className="blg-style">
          <legend>Cells</legend>
          {(
            [
              ['names', 'Names'],
              ['bars', 'Solid bars']
            ] as const
          ).map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name="lineup-cell-style"
                checked={cellStyle === value}
                onChange={() => pickStyle(value)}
              />{' '}
              {label}
            </label>
          ))}
        </fieldset>
      </div>

      <RaidGrid
        raid={raid}
        night={night}
        players={players}
        answers={answers}
        places={places}
        usual={usual}
        targets={targets}
        cellStyle={cellStyle}
        canEdit={canEdit}
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
        onSkip={canEdit && planned && !touch ? onSkip : null}
      />

      {asking && (
        <Dialog title="Save the boss lineup" onClose={() => setAsking(false)}>
          <fieldset className="blg-scope">
            <legend className="visually-hidden">How far this save reaches</legend>
            <label data-chosen={scope === 'night'}>
              <input
                type="radio"
                name="lineup-scope"
                checked={scope === 'night'}
                disabled={!dirty}
                onChange={() => setScope('night')}
              />
              <strong>Just {day}</strong>
              <span className="text-muted">Other nights stay as they are.</span>
            </label>
            <label data-chosen={scope === 'usual'}>
              <input type="radio" name="lineup-scope" checked={scope === 'usual'} onChange={() => setScope('usual')} />
              <strong>{day} and every night after</strong>
              <span className="text-muted">
                Also becomes the usual group. Nights an officer already saved keep their own lineup.
              </span>
            </label>
          </fieldset>
          <div className="dialog-actions">
            <button type="button" className="button button-quiet" onClick={() => setAsking(false)}>
              Cancel
            </button>
            <button type="button" className="button button-primary" onClick={onSave}>
              Save
            </button>
          </div>
        </Dialog>
      )}
      {leaveDialog}
    </div>
  );
}

// The fill bar under each boss's count (#1681): green when full, amber with a
// problem, red when over, blue for a flex boss with room to spare.
function fillTone(t: BossTotal): string {
  if (t.status.tone === 'bad') return 'bad';
  if (t.problems.length) return 'warn';
  return t.status.tone === 'good' ? 'good' : 'room';
}

const roleTarget = (role: Role, targets: RoleTargets) =>
  role === 'Tank' ? targets.tanks : role === 'Heal' ? targets.healers : 0;

function RaidGrid({
  raid,
  night,
  players,
  answers,
  places,
  usual,
  targets,
  cellStyle,
  canEdit,
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
  targets: RoleTargets;
  cellStyle: CellStyle;
  canEdit: boolean;
  busy: boolean;
  onToggle: (boss: number, player: number) => void;
  onWholeNight: (player: number, putIn: boolean) => void;
  // Null when this viewer can't skip bosses here.
  onSkip: ((boss: LineupBoss) => void) | null;
}) {
  const [showBuffs, setShowBuffs] = useState(false);
  // The column under the pointer, brightened top to bottom.
  const [hot, setHot] = useState<number | null>(null);
  const view = lineupView(players, night, answers, raid, places, usual, targets);
  const totals = new Map(view.totals.map((t) => [t.boss.id, t]));
  const gaps = view.totals.filter((t) => t.problems.length);
  const liveCount = view.live.length;
  const looks = [
    ...gaps.map((t) => ({
      key: `boss-${t.boss.id}`,
      head: `${raid.bosses.indexOf(t.boss) + 1}. ${t.boss.short}`,
      text: t.brief.join(' · ')
    })),
    ...view.notComing.map((name) => ({ key: `out-${name}`, head: name, text: 'is in, but said they’re not coming' })),
    ...(view.benchOut.length
      ? [
          {
            key: 'bench',
            head: 'Bench',
            text: `${view.benchOut.join(' and ')} ${view.benchOut.length === 1 ? 'is' : 'are'} out on every boss unless you put them in.`
          }
        ]
      : [])
  ];
  const hotProps = (id: number) => ({ 'data-hot': hot === id || undefined, onMouseEnter: () => setHot(id) });

  return (
    <>
      {canEdit && (
        <section className="blg-look" aria-labelledby="needs-look-title">
          <h2 id="needs-look-title" data-clear={looks.length === 0}>
            Needs a look
          </h2>
          {looks.length ? (
            <ul>
              {looks.map((l) => (
                <li key={l.key}>
                  <strong>{l.head}</strong> <span className="text-muted">{l.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="lineup-all-clear">All clear: every boss is full and every buff is covered.</p>
          )}
        </section>
      )}

      <div className="blg-wrap">
        {/* The column highlight is pointer-only decoration; nothing to do from a keyboard. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <table className="blg-grid" data-style={cellStyle} onMouseLeave={() => setHot(null)}>
          <caption className="visually-hidden">
            {raid.name} lineup for {shortDay(night.date)}, up to {capLabel(raid.bosses)}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="blg-corner">
                <span className="visually-hidden">Raider</span>
                {canEdit && (
                  <span className="text-dim" aria-hidden="true">
                    Click a cell to put someone in or sit them out. Click a name for every boss.
                  </span>
                )}
              </th>
              {raid.bosses.map((boss, i) => {
                const t = totals.get(boss.id);
                return (
                  <th
                    key={boss.id}
                    scope="col"
                    className="blg-boss"
                    data-skipped={boss.skipped}
                    data-warn={(t?.problems.length ?? 0) > 0}
                    {...hotProps(boss.id)}
                  >
                    <ColumnSizer bosses={raid.bosses} />
                    <img className="blg-backdrop" src={boss.art} alt="" onError={hideBroken} />
                    <span className="blg-art" aria-hidden="true">
                      <img className="blg-icon" src={boss.art} alt="" width={44} height={44} onError={hideBroken} />
                      <span className="blg-pull">{i + 1}</span>
                    </span>
                    <span className="blg-boss-name" aria-hidden="true">
                      {boss.short}
                    </span>
                    <span className="visually-hidden">
                      {boss.name}, pull {i + 1}
                    </span>
                    {t ? (
                      <>
                        <span className="blg-count num" aria-hidden="true">
                          <span data-tone={fillTone(t)}>
                            {t.count}/{t.boss.cap}
                          </span>
                          {t.problems.length > 0 && <span className="blg-warn">⚠ {t.problems.length}</span>}
                        </span>
                        <span className="blg-track" aria-hidden="true">
                          <span
                            className="blg-fill"
                            data-tone={fillTone(t)}
                            style={{ width: `${Math.min(100, Math.round((t.count / t.boss.cap) * 100))}%` }}
                          />
                        </span>
                        <span className="visually-hidden">
                          {t.count}/{t.boss.cap}, {t.status.text}, {plural(t.tanks, 'tank')},{' '}
                          {plural(t.healers, 'healer')}, {t.damage} damage
                          {t.problems.length ? `, ${plural(t.problems.length, 'problem')}` : ''}
                        </span>
                      </>
                    ) : (
                      <span className="blg-count text-dim">Skipped tonight</span>
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
            </tr>
          </thead>
          {view.groups.map((g) => {
            const target = roleTarget(g.role, targets);
            return (
              <tbody key={g.role}>
                <tr className="blg-group">
                  <th scope="rowgroup">
                    {g.label} · {g.rows.length}
                  </th>
                  {raid.bosses.map((boss) => {
                    const t = totals.get(boss.id);
                    const n = t?.roles[g.role] ?? 0;
                    return (
                      <td
                        key={boss.id}
                        data-tone={t && target && n !== target ? 'warn' : undefined}
                        {...hotProps(boss.id)}
                      >
                        {t ? (target ? `${n}/${target}` : n) : ''}
                      </td>
                    );
                  })}
                </tr>
                {g.rows.map((r) => {
                  const name = r.row.name;
                  const spec = r.row.player.classes_specs;
                  const color = classColor(spec?.class ?? '');
                  const icon = specIcon(spec?.class ?? null, spec?.spec ?? null);
                  const off = r.count === 0;
                  return (
                    <tr key={r.row.player.id}>
                      <th scope="row" className="blg-raider" data-off={off}>
                        {/* Only the name is the button, so what it says matches
                            what it shows; it stretches over the whole box. */}
                        <span className="blg-raider-box">
                          {icon && <img className="blg-spec-icon" src={icon} alt="" width={16} height={16} />}
                          {canEdit ? (
                            <button
                              type="button"
                              className="blg-raider-name blg-raider-toggle"
                              style={{ color }}
                              disabled={busy || liveCount === 0}
                              aria-label={off ? `Put ${name} back in on every boss` : `Sit ${name} out on every boss`}
                              onClick={() => onWholeNight(r.row.player.id, off)}
                            >
                              {name}
                            </button>
                          ) : (
                            <span className="blg-raider-name" style={{ color }}>
                              {name}
                            </span>
                          )}
                          <span className="text-dim blg-raider-spec">{spec?.spec}</span>
                          {r.tag && (
                            <span className="lineup-tag" data-tone={r.tagTone}>
                              {r.tag}
                            </span>
                          )}
                          <span
                            className="blg-raider-count num"
                            data-tone={off ? 'bad' : r.count === liveCount ? 'good' : undefined}
                          >
                            {r.count}/{liveCount}
                          </span>
                        </span>
                      </th>
                      {r.cells.map((c) => {
                        const state = c.boss.skipped ? 'skipped tonight' : c.in ? 'in' : 'out';
                        const extra = [
                          ...(c.conflict ? ['but said they’re not coming'] : []),
                          ...(c.differs ? [`changed for tonight only, usually ${c.in ? 'out' : 'in'}`] : [])
                        ];
                        const label = `${name}, ${c.boss.name}: ${[state, ...extra].join(', ')}`;
                        const look = {
                          className: 'blg-cell',
                          'data-in': c.in,
                          'data-tonight': c.differs || undefined,
                          'data-conflict': c.conflict || undefined,
                          style: { '--cc': color } as CSSProperties
                        };
                        const body = (
                          <>
                            {cellStyle === 'names' && !c.boss.skipped && <span className="blg-cell-name">{name}</span>}
                            <span className="blg-marks" aria-hidden="true">
                              {c.differs && (
                                <span className="blg-mark" data-kind="tonight">
                                  <svg width="9" height="9" viewBox="0 0 16 16">
                                    <path fill="currentColor" d="M10.5 1.2A7 7 0 1 0 14.8 11 6 6 0 0 1 10.5 1.2z" />
                                  </svg>
                                </span>
                              )}
                              {c.conflict && (
                                <span className="blg-mark" data-kind="conflict">
                                  !
                                </span>
                              )}
                            </span>
                          </>
                        );
                        return (
                          <td key={c.boss.id} className="blg-td" {...hotProps(c.boss.id)}>
                            {canEdit ? (
                              <button
                                type="button"
                                {...look}
                                aria-label={label}
                                disabled={busy || c.boss.skipped}
                                onClick={() => onToggle(c.boss.id, r.row.player.id)}
                              >
                                {body}
                              </button>
                            ) : (
                              <span {...look}>
                                <span className="visually-hidden">{label}</span>
                                {body}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>

      <p className="blg-key text-muted">
        <span>
          <span className="blg-mark" data-kind="tonight" aria-hidden="true">
            <svg width="9" height="9" viewBox="0 0 16 16">
              <path fill="currentColor" d="M10.5 1.2A7 7 0 1 0 14.8 11 6 6 0 0 1 10.5 1.2z" />
            </svg>
          </span>{' '}
          Tonight only, not the usual group
        </span>
        <span>
          <span className="blg-mark" data-kind="conflict" aria-hidden="true">
            !
          </span>{' '}
          In, but said they’re not coming
        </span>
        {canEdit && (
          <button
            type="button"
            className="link-button"
            aria-expanded={showBuffs}
            aria-controls="all-buffs"
            onClick={() => setShowBuffs((v) => !v)}
          >
            {showBuffs ? 'Hide all buffs' : 'Show all buffs'}
          </button>
        )}
      </p>

      {canEdit && showBuffs && (
        <section id="all-buffs" className="card lineup-panel" aria-labelledby="all-buffs-title">
          <h2 id="all-buffs-title">All buffs, by boss</h2>
          <p className="text-dim lineup-buff-key">
            One square per boss tonight, left to right: {view.live.map((b) => b.short).join(', ')}. A check is covered,
            a cross is missing.
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
    </>
  );
}
