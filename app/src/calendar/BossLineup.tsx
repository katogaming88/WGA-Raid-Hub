import { useEffect, useState, type CSSProperties, type MouseEvent, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { DataState } from '../components/DataState';
import { Dialog } from '../components/Dialog';
import { useStatus } from '../components/Status';
import { useTeam } from '../data/address';
import { bothQueries } from '../data/query';
import { useTeamAlts } from '../characters/useCharacters';
import { useClassSpecs } from '../characters/useMainSwaps';
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
  currentPicks,
  everyoneIn,
  lineupRaids,
  lineupView,
  onRoster,
  pickChanges,
  pickRows,
  picksFor,
  picksOf,
  placesFor,
  placesOf,
  playOf,
  playWords,
  samePicks,
  sameSet,
  seasonOn,
  setPick,
  toggle,
  wholeNight,
  type BossTotal,
  type ClassSpecRow,
  type Pick,
  type PickEdits,
  type PickedCharacter,
  type Picks,
  type PlayLookup,
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
  const [pickEdits, setPickEdits] = useState<PickEdits>(new Map());
  // The raider and boss whose character or spec is being picked (#1580).
  const [picking, setPicking] = useState<{ boss: LineupBoss; player: PlayerRow } | null>(null);
  const specs = useClassSpecs();
  // Only officers pick, so only they read the team's alts.
  const alts = useTeamAlts(team.id, canEdit);
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
  const savedPicks = picksOf(plan.places);
  const usualPicks = picksOf(groups);
  const picks = currentPicks(savedPicks, pickEdits);
  const live = bosses.filter((b) => !b.skipped);
  // Bosses whose picks changed for someone still in (#1580).
  const pickChanged = live
    .filter((b) => !samePicks(picksFor(savedPicks, b.id), picksFor(picks, b.id), placesFor(places, b.id)))
    .map((b) => b.id);
  const changedBosses = [...new Set([...changed.bosses, ...pickChanged])];
  const dirty = changed.cells > 0 || pickChanged.length > 0;
  const offGroup = live.filter(
    (b) =>
      !sameSet(placesFor(places, b.id), placesFor(usual, b.id)) ||
      !samePicks(picksFor(picks, b.id), picksFor(usualPicks, b.id), placesFor(places, b.id))
  );
  // What a pick shows: the spec list, and every alt this page can name, from
  // the lineup rows (anyone on the team) and the team's alts (officers).
  const look: PlayLookup = {
    specs: new Map((specs.data ?? []).map((cs) => [cs.id, cs as ClassSpecRow])),
    characters: new Map<number, PickedCharacter>([
      ...[...plan.places, ...groups].flatMap((r) => (r.character ? [[r.character.id, r.character] as const] : [])),
      ...(alts.data?.characters ?? []).map(
        (c) => [c.id, { id: c.id, name: c.name, class_name: c.class_name, spec_name: c.spec_name }] as const
      )
    ])
  };
  const names = (ids: number[]) => ids.map((id) => bosses.find((b) => b.id === id)?.name ?? 'A boss').join(', ');
  const byId = new Map(players.map((p) => [p.id, p]));
  const nameOf = (id: number) => (byId.has(id) ? displayName(byId.get(id)!) : 'A raider');
  const list = [
    ...raids.flatMap((r) =>
      changeList(saved, edits, r.bosses, nameOf, raids.length > 1 ? `for all of ${r.name}` : 'all night')
    ),
    ...pickChanges(savedPicks, picks, places, bosses, players, look)
  ];
  const day = weekdayOf(night.date);

  const leaveDialog = useLeaveGuard(dirty, Math.max(changed.cells, list.length), 'this night’s boss lineup');
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
    setPickEdits((e) => new Map([...e].filter(([id]) => !result.saved.includes(id))));
    setStale(result.stale);
    setMessage(result.stale.length ? '' : done);
    if (!result.stale.length) announce('success', done);
  };

  const nightSaves: BossSave[] = changedBosses.map((id) => ({
    encounterId: id,
    players: toList(placesFor(toSave, id)),
    expected: toList(placesFor(saved, id)),
    picks: pickRows(picksFor(picks, id), placesFor(toSave, id)),
    expectedPicks: pickRows(picksFor(savedPicks, id), placesFor(saved, id))
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
          expected: toList(placesFor(usual, b.id)),
          picks: pickRows(picksFor(picks, b.id), placesFor(toSave, b.id)),
          expectedPicks: pickRows(picksFor(usualPicks, b.id), placesFor(usual, b.id))
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
          setPickEdits((e) => new Map([...e].filter(([id]) => id !== boss.id)));
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

  const onPickPlay = (boss: LineupBoss, player: PlayerRow, pick: Pick | null) => {
    setPickEdits((e) => setPick(savedPicks, e, boss.id, player.id, pick));
    if (!placesFor(places, boss.id).has(player.id)) setEdits((e) => toggle(saved, e, boss.id, player.id));
    setMessage('');
    setStale([]);
    setPicking(null);
  };

  // The grid switches at once; a save that fails goes back to what is saved,
  // and says so, rather than looking kept until the next visit.
  const pickStyle = (style: CellStyle) => {
    setPicked(style);
    saveStyle.mutate(style, {
      onError: (e) => {
        setPicked(null);
        announce('error', `Your cell style didn’t save: ${e.message}`);
      }
    });
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
                  setPickEdits((e) => new Map([...e].filter(([id]) => !stale.includes(id))));
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
                setPickEdits(new Map());
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
        picks={picks}
        usualPicks={usualPicks}
        look={look}
        onPicking={(boss, player) => setPicking({ boss, player })}
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

      {picking && (
        <PlayPicker
          boss={picking.boss}
          player={picking.player}
          current={picksFor(picks, picking.boss.id).get(picking.player.id)}
          look={look}
          alts={alts.data ?? null}
          onPick={(pick) => onPickPlay(picking.boss, picking.player, pick)}
          onClose={() => setPicking(null)}
        />
      )}

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

// Hovering a boss shows the site's own tip at once (Kat, 2026-11-18): a
// small card of the boss's numbers, anything short in amber, and the missing
// buffs by name, where Needs a look only counts them to stay on its three
// lines. Board C of the tip options.
type Tip = { total: BossTotal; pull: number; left: number; top?: number; bottom?: number };

// Fixed to the page and portaled to the body, so the grid's scroll box can't
// clip it. It opens above what it describes, so it never covers the raiders
// under a boss (Kat, 2026-11-18), and below only when there isn't room above.
const TIP_WIDTH = 300;
const TIP_ROOM = 290;
function tipAt(el: HTMLElement, t: BossTotal, pull: number): Tip {
  const r = el.getBoundingClientRect();
  const half = TIP_WIDTH / 2 + 8;
  const left = Math.min(Math.max(r.left + r.width / 2, half), window.innerWidth - half);
  return r.top > TIP_ROOM
    ? { total: t, pull, left, bottom: window.innerHeight - r.top + 6 }
    : { total: t, pull, left, top: r.bottom + 6 };
}

function TipBody({ tip, targets }: { tip: Tip; targets: RoleTargets }) {
  const t = tip.total;
  const row = (label: string, value: string, warn: boolean) => (
    <tr key={label}>
      <th scope="row">{label}</th>
      <td className={warn ? 'blg-tip-warn' : undefined}>{value}</td>
    </tr>
  );
  const against = (n: number, target: number) => (target ? `${n}/${target}` : String(n));
  return (
    <>
      <strong>
        {tip.pull}. {t.boss.name}
      </strong>
      <table className="blg-tip-table">
        <tbody>
          {row('Raiders', `${t.count}/${t.boss.cap}`, t.status.tone === 'warn' || t.status.tone === 'bad')}
          {row('Tanks', against(t.tanks, targets.tanks), !!targets.tanks && t.tanks !== targets.tanks)}
          {row('Healers', against(t.healers, targets.healers), !!targets.healers && t.healers !== targets.healers)}
          {row('Melee', String(t.roles.Melee), false)}
          {row('Ranged', String(t.roles.Ranged), false)}
        </tbody>
      </table>
      {t.missing.length > 0 && (
        <>
          <span className="blg-tip-label">Missing buffs ({t.missing.length})</span>
          <ul className="blg-tip-cols">
            {t.missing.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </>
      )}
    </>
  );
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
  picks,
  usualPicks,
  look: plays,
  onPicking,
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
  picks: Picks;
  usualPicks: Picks;
  look: PlayLookup;
  onPicking: (boss: LineupBoss, player: PlayerRow) => void;
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
  const [tip, setTip] = useState<Tip | null>(null);
  // A scroll moves what the tip points at; it closes rather than drift.
  useEffect(() => {
    if (!tip) return;
    const close = () => setTip(null);
    window.addEventListener('scroll', close, true);
    return () => window.removeEventListener('scroll', close, true);
  }, [tip]);
  const tipProps = (t: BossTotal | undefined) =>
    t?.problems.length
      ? {
          onMouseEnter: (e: MouseEvent<HTMLElement>) =>
            setTip(tipAt(e.currentTarget, t, raid.bosses.indexOf(t.boss) + 1)),
          onMouseLeave: () => setTip(null)
        }
      : {};
  const view = lineupView(players, night, answers, raid, places, usual, targets, picks, plays, usualPicks);
  const totals = new Map(view.totals.map((t) => [t.boss.id, t]));
  const gaps = view.totals.filter((t) => t.problems.length);
  const liveCount = view.live.length;
  const looks = [
    ...gaps.map((t) => ({
      key: `boss-${t.boss.id}`,
      head: `${raid.bosses.indexOf(t.boss) + 1}. ${t.boss.short}`,
      text: t.brief.join(' · '),
      // Read out in full, since the tip is for the pointer only.
      full: `${t.problems.join('; ')}.`,
      total: t
    })),
    ...view.notComing.map((name) => ({
      key: `out-${name}`,
      head: name,
      text: 'is in, but said they’re not coming',
      full: null,
      total: undefined
    })),
    ...(view.benchOut.length
      ? [
          {
            key: 'bench',
            head: 'Bench',
            text: `${view.benchOut.join(' and ')} ${view.benchOut.length === 1 ? 'is' : 'are'} out on every boss unless you put them in.`,
            full: null,
            total: undefined
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
                <li key={l.key} {...tipProps(l.total)}>
                  <strong>{l.head}</strong>{' '}
                  <span className="text-muted" aria-hidden={l.full ? true : undefined}>
                    {l.text}
                  </span>
                  {l.full && <span className="visually-hidden">{l.full}</span>}
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
                    {...tipProps(t)}
                    onMouseEnter={(e) => {
                      setHot(boss.id);
                      tipProps(t).onMouseEnter?.(e);
                    }}
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
                        const usually =
                          c.in !== c.usuallyIn
                            ? c.usuallyIn
                              ? 'in'
                              : 'out'
                            : c.usualPlay.swapped
                              ? playWords(c.usualPlay)
                              : `as ${c.usualPlay.spec}`;
                        const extra = [
                          ...(c.in && c.play.swapped ? [playWords(c.play)] : []),
                          ...(c.conflict ? ['but said they’re not coming'] : []),
                          ...(c.differs ? [`changed for tonight only, usually ${usually}`] : [])
                        ];
                        const label = `${name}, ${c.boss.name}: ${[state, ...extra].join(', ')}`;
                        // A pick shows its class's color and its spec's icon (#1680).
                        const icon = c.in && c.play.swapped ? specIcon(c.play.class, c.play.spec) : null;
                        const look = {
                          className: 'blg-cell',
                          'data-in': c.in,
                          'data-tonight': c.differs || undefined,
                          'data-conflict': c.conflict || undefined,
                          'data-icon': icon ? true : undefined,
                          style: { '--cc': c.in ? classColor(c.play.class) : color } as CSSProperties
                        };
                        const body = (
                          <>
                            {icon && <img className="blg-cell-icon" src={icon} alt="" width={18} height={18} />}
                            {cellStyle === 'names' && !c.boss.skipped && (
                              <span className="blg-cell-name">{c.in ? (c.play.character ?? name) : name}</span>
                            )}
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
                              <>
                                <button
                                  type="button"
                                  {...look}
                                  aria-label={label}
                                  disabled={busy || c.boss.skipped}
                                  onClick={() => onToggle(c.boss.id, r.row.player.id)}
                                >
                                  {body}
                                </button>
                                {!c.boss.skipped && (
                                  <button
                                    type="button"
                                    className="blg-swap"
                                    aria-label={`Change what ${name} plays on ${c.boss.name}`}
                                    disabled={busy}
                                    onClick={() => onPicking(c.boss, r.row.player)}
                                  >
                                    <svg
                                      width="13"
                                      height="13"
                                      viewBox="0 0 16 16"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="1.6"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      aria-hidden="true"
                                    >
                                      <path d="M2 5h11M10 2l3 3-3 3" />
                                      <path d="M14 11H3M6 8l-3 3 3 3" />
                                    </svg>
                                  </button>
                                )}
                              </>
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

      {tip &&
        createPortal(
          <div
            className="blg-tip"
            role="tooltip"
            style={{ left: tip.left, top: tip.top, bottom: tip.bottom, width: TIP_WIDTH }}
          >
            <TipBody tip={tip} targets={targets} />
          </div>,
          document.body
        )}

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

// "What Katorrí plays on Sszorak" (#1580, Kat's #1680 design): each of the
// raider's characters, their roster character first, then their alts, each
// with every spec of its class and the usual one marked. Picking one swaps
// them, or puts them in if they were out.
function PlayPicker({
  boss,
  player,
  current,
  look,
  alts,
  onPick,
  onClose
}: {
  boss: LineupBoss;
  player: PlayerRow;
  current: Pick | undefined;
  look: PlayLookup;
  alts: {
    personByMember: Map<number, number>;
    characters: {
      id: number;
      person_id: number;
      name: string;
      realm: string;
      class_name: string | null;
      spec_name: string | null;
    }[];
  } | null;
  onPick: (pick: Pick | null) => void;
  onClose: () => void;
}) {
  const name = displayName(player);
  const main = player.classes_specs;
  const person = player.team_member_id != null ? alts?.personByMember.get(player.team_member_id) : undefined;
  const key = (nameRealm: string) => nameRealm.toLowerCase().replace(/\s+/g, '');
  const own = (alts?.characters ?? [])
    .filter((c) => c.person_id === person && c.class_name && key(`${c.name}-${c.realm}`) !== key(player.name_realm))
    .sort((a, b) => a.name.localeCompare(b.name));
  const specsOf = (cls: string) =>
    [...look.specs.values()].filter((cs) => cs.class === cls).sort((a, b) => a.spec.localeCompare(b.spec));
  const now = playOf(player, current, look);
  const characters = [
    {
      id: null as number | null,
      name: player.name_realm.split('-')[0]!,
      cls: main?.class ?? '',
      usual: main?.spec ?? '',
      main: true
    },
    ...own.map((c) => ({
      id: c.id as number | null,
      name: c.name,
      cls: c.class_name!,
      usual: c.spec_name ?? '',
      main: false
    }))
  ];

  return (
    <Dialog title={`What ${name} plays on ${boss.short}`} onClose={onClose}>
      {characters.map((ch) => (
        <section key={ch.id ?? 'main'} className="blg-pick" aria-label={ch.name}>
          <h3>
            <span style={{ color: classColor(ch.cls) }}>{ch.name}</span>{' '}
            <span className="text-muted">
              {ch.cls} · {ch.main ? 'main' : 'alt'}
            </span>
          </h3>
          <div className="blg-pick-specs">
            {specsOf(ch.cls).map((cs) => {
              const chosen =
                (ch.id === null ? now.character === null : current?.characterId === ch.id) &&
                now.class === ch.cls &&
                now.spec === cs.spec;
              const icon = specIcon(ch.cls, cs.spec);
              const usual = cs.spec === ch.usual;
              return (
                <button
                  key={cs.id}
                  type="button"
                  className="button blg-pick-spec"
                  aria-pressed={chosen}
                  onClick={() =>
                    // The main's usual spec is no pick; an alt's spec is
                    // kept as picked, so it doesn't follow their next
                    // Battle.net save.
                    onPick(
                      ch.main && usual ? null : { characterId: ch.id, classSpecId: ch.main && usual ? null : cs.id }
                    )
                  }
                >
                  {icon && <img src={icon} alt="" width={18} height={18} />}
                  <span>
                    {cs.spec}{' '}
                    <span className="text-muted blg-pick-role">
                      {cs.role === 'Heal' ? 'healer' : (cs.role ?? '').toLowerCase()}
                      {usual ? ' · usual' : ''}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {own.length === 0 && (
        <p className="text-muted blg-pick-note">
          {name} has no alts on their profile. A raider adds them from their own profile.
        </p>
      )}
    </Dialog>
  );
}
