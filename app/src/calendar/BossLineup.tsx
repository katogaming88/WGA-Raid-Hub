import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
import { CellStyleChoice, RaidGrid, useCellStyleChoice } from './RaidGrid';
import { PlanSwitch } from './PlanSwitch';
import { useLeaveGuard } from './leaveGuard';
import {
  capLabel,
  changeList,
  changes,
  current,
  currentPicks,
  everyoneIn,
  isStaleSave,
  lineupRaids,
  lineupView,
  shortBossesLook,
  moveBoss,
  nightOrder,
  nightPlans,
  PLAN_LABELS,
  orderChanges,
  onRoster,
  pickChanges,
  pickRows,
  picksFor,
  picksOf,
  placesFor,
  placesOf,
  playOf,
  type RaiderOrder,
  sameOrder,
  samePicks,
  sameSet,
  seasonOn,
  setPick,
  toggle,
  wholeNight,
  withOrder,
  type ClassSpecRow,
  type Pick,
  type PickEdits,
  type PickedCharacter,
  type PlayLookup,
  type EncounterRow,
  type LineupBoss,
  type PlaceRow,
  type Plan,
  type RoleTargets,
  type SeasonRow,
  type BossTargets,
  NO_BOSS_TARGETS,
  wantsOf,
  wantsText
} from './lineup';
import {
  useBossGroups,
  useEncounters,
  lineupKey,
  useLineupRoleTargets,
  useNightPlan,
  usePlanNight,
  useSaveGroups,
  useSaveNight,
  useRaiderOrder,
  useSaveOrder,
  useSaveRaiderOrder,
  useSeasons,
  useSetBossTargets,
  useSkipBoss,
  type BossSave,
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
  // A Heroic into Mythic night has a Heroic and a Mythic lineup per boss
  // (#1688), shown one half at a time, Heroic first.
  const halves = nightPlans(night);
  const [picked, setPicked] = useState<Plan>(halves[0]!);
  const half = halves.includes(picked) ? picked : halves[0]!;
  const [dirty, setDirty] = useState(false);
  // The other half, saved, for Needs a look on a two-half night (Kat,
  // 2026-11-22); on a one-half night this reads the same half again, cached.
  const other = halves.find((h) => h !== half) ?? null;
  const otherPlan = useNightPlan(team.id, night.date, other ?? half);
  const lookups = bothQueries(useSeasons(), useEncounters());
  const plan = bothQueries(useNightPlan(team.id, night.date, half), useBossGroups(team.id, half));
  const targets = bothQueries(useLineupRoleTargets(team.id), useRaiderOrder(team.id));

  return (
    <>
      {halves.length > 1 && (
        <PlanSwitch legend="Lineup" plans={halves} value={half} onChange={setPicked} disabled={dirty} />
      )}
      <DataState query={bothQueries(bothQueries(lookups, plan), targets)} label="the boss lineup">
        {([[[seasons, encounters], [nightPlan, groups]], [roleTargets, raiderOrder]]) => (
          <Lineup
            key={half}
            half={half}
            otherHalf={other && otherPlan.data ? { plan: other, night: otherPlan.data } : null}
            onDirty={setDirty}
            night={night}
            players={players}
            answers={answers}
            seasons={seasons}
            encounters={encounters}
            plan={nightPlan}
            groups={groups}
            targets={roleTargets}
            raiderOrder={raiderOrder}
            canEdit={canEdit}
          />
        )}
      </DataState>
    </>
  );
}

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const toList = (set: ReadonlySet<number>) => [...set].sort((a, b) => a - b);

function Lineup({
  half,
  otherHalf,
  onDirty,
  night,
  players,
  answers,
  seasons,
  encounters,
  plan,
  groups,
  targets,
  raiderOrder,
  canEdit
}: {
  half: Plan;
  otherHalf: { plan: Plan; night: NightPlan } | null;
  onDirty: (dirty: boolean) => void;
  night: RaidNight;
  players: PlayerRow[];
  answers: Answer[];
  seasons: SeasonRow[];
  encounters: EncounterRow[];
  plan: NightPlan;
  groups: PlaceRow[];
  targets: RoleTargets;
  raiderOrder: RaiderOrder;
  canEdit: boolean;
}) {
  const team = useTeam();
  const touch = useTouchScreen();
  const { announce } = useStatus();
  const [edits, setEdits] = useState<ReadonlyMap<number, ReadonlySet<number>>>(new Map());
  const [pickEdits, setPickEdits] = useState<PickEdits>(new Map());
  // An officer's unsaved pull order (#1679): every boss on the night, in order.
  const [orderEdit, setOrderEdit] = useState<number[] | null>(null);
  // The raider and boss whose character or spec is being picked (#1580).
  const [picking, setPicking] = useState<{ boss: LineupBoss; player: PlayerRow } | null>(null);
  // The boss whose standing targets are open (#1682).
  const [needsFor, setNeedsFor] = useState<LineupBoss | null>(null);
  const specs = useClassSpecs();
  // Only officers pick, so only they read the team's alts.
  const alts = useTeamAlts(team.id, canEdit);
  const [fresh, setFresh] = useState(false);
  const [shown, setShown] = useState<number | null>(null);
  const [stale, setStale] = useState<number[]>([]);
  const [message, setMessage] = useState('');
  const [asking, setAsking] = useState(false);
  const [scope, setScope] = useState<'night' | 'usual'>('night');
  const [cellStyle, pickStyle] = useCellStyleChoice();
  const saveNight = useSaveNight(team.id, night.date, half);
  const saveGroups = useSaveGroups(team.id, night.date, half);
  const saveOrder = useSaveOrder(team.id, night.date, half);
  const saveRaiders = useSaveRaiderOrder(team.id);
  const queryClient = useQueryClient();
  const planNight = usePlanNight(team.id, night.date);
  const skip = useSkipBoss(team.id, night.date, half);
  const busy =
    saveNight.isPending ||
    saveGroups.isPending ||
    saveOrder.isPending ||
    saveRaiders.isPending ||
    planNight.isPending ||
    skip.isPending;

  const season = seasonOn(seasons, night.date);
  const planned = plan.bosses.length > 0;
  const saved = placesOf(plan.places);
  const usual = placesOf(groups);
  const savedOrder = nightOrder(plan.bosses);
  // An edit made before someone else added or took off a boss no longer fits.
  const order =
    orderEdit &&
    sameOrder(
      [...orderEdit].sort((a, b) => a - b),
      [...savedOrder].sort((a, b) => a - b)
    )
      ? orderEdit
      : null;
  const orderDirty = order !== null && !sameOrder(order, savedOrder);
  const raids = lineupRaids(encounters, withOrder(plan.bosses, order), {
    fresh: fresh && !planned,
    season,
    plan: half
  });
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
  const lineupDirty = changed.cells > 0 || pickChanged.length > 0;
  const dirty = lineupDirty || orderDirty;
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
    ...(orderDirty
      ? orderChanges(lineupRaids(encounters, plan.bosses, { fresh: false, season, plan: half }), raids)
      : []),
    ...raids.flatMap((r) =>
      changeList(saved, edits, r.bosses, nameOf, raids.length > 1 ? `for all of ${r.name}` : 'all night')
    ),
    ...pickChanges(savedPicks, picks, places, bosses, players, look)
  ];
  const day = weekdayOf(night.date);

  const leaveDialog = useLeaveGuard(dirty, Math.max(changed.cells, list.length), 'this night’s boss lineup');
  // The page's Heroic / Mythic switch stays off while this half has unsaved changes.
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
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
        <h2 id="lineup-empty-title">No boss has a usual {PLAN_LABELS[half]} group yet.</h2>
        <p className="text-muted">
          Start this night with everyone on the roster in (bench raiders out), set each boss the way you want, then save
          it for {day} and every night after. Every night after this one starts from those groups.
        </p>
        <button
          type="button"
          className="button button-primary"
          onClick={() => {
            const all = lineupRaids(encounters, [], { fresh: true, season, plan: half }).flatMap((r) => r.bosses);
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
  // The other half's bosses in this raid that need a look, as saved.
  const otherLooks = (() => {
    if (!otherHalf) return [];
    const otherRaid = lineupRaids(encounters, otherHalf.night.bosses, {
      fresh: false,
      season,
      plan: otherHalf.plan
    }).find((r) => r.zoneId === raid.zoneId);
    if (!otherRaid) return [];
    const otherSaved = placesOf(otherHalf.night.places);
    const view = lineupView(
      players,
      night,
      answers,
      otherRaid,
      otherSaved,
      otherSaved,
      targets,
      picksOf(otherHalf.night.places),
      look,
      new Map(),
      raiderOrder
    );
    const gone = shortBossesLook(
      view.totals
        .filter((t) => t.problems.length)
        .map((t) => `${otherRaid.bosses.indexOf(t.boss) + 1}. ${t.boss.short}`),
      view.totals.length,
      { hover: false, half: PLAN_LABELS[otherHalf.plan] }
    );
    return gone ? [{ key: 'other-short', head: gone.head, text: gone.text, full: null, total: undefined }] : [];
  })();

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

  const error = saveOrder.error ?? saveNight.error ?? saveGroups.error ?? skip.error;
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
    const rest = () => {
      if (scope === 'night' && lineupDirty) onSaveTonight();
      else if (scope === 'usual' && (lineupDirty || offGroup.length)) onSaveGroups();
    };
    if (!orderDirty) return rest();
    // The order first, then the bosses' lineups (#1679).
    const everyNight = scope === 'usual';
    saveOrder.mutate(
      { order: order!, expected: savedOrder, everyNight },
      {
        onSuccess: () => {
          setOrderEdit(null);
          const done = everyNight
            ? `Saved the pull order for ${shortDay(night.date)} and every night after.`
            : `Saved the pull order for ${shortDay(night.date)}.`;
          setMessage(done);
          announce('success', done);
          rest();
        },
        // Someone else saved an order first: theirs shows, with nothing of
        // this officer's to undo it (fresh review on PR #1880).
        onError: (e) => {
          if (!isStaleSave(e.message)) return;
          saveOrder.reset();
          setOrderEdit(null);
          void queryClient.invalidateQueries({ queryKey: lineupKey(team.id) });
          const done = 'Someone else changed the pull order while you were editing. Theirs is showing now.';
          setMessage(done);
          announce('error', done);
        }
      }
    );
  };
  // A boss dropped on another, or moved one place by its arrows.
  const onMove = (id: number, onto: number) => {
    setOrderEdit(moveBoss(order ?? savedOrder, id, onto));
    setMessage('');
    setStale([]);
  };

  // A raider's place in their role section (#1683) saves at once, for the whole
  // team; an empty list puts the section back to A-Z.
  const onRaiders = (role: Role, playerIds: number[]) =>
    saveRaiders.mutate(
      { role, playerIds },
      { onError: (e) => announce('error', `The raider order didn’t save: ${e.message}`) }
    );

  const onPickPlay = (boss: LineupBoss, player: PlayerRow, pick: Pick | null) => {
    setPickEdits((e) => setPick(savedPicks, e, boss.id, player.id, pick));
    if (!placesFor(places, boss.id).has(player.id)) setEdits((e) => toggle(saved, e, boss.id, player.id));
    setMessage('');
    setStale([]);
    setPicking(null);
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
                setOrderEdit(null);
                saveOrder.reset();
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
              {saveNight.isPending || saveGroups.isPending || saveOrder.isPending ? 'Saving…' : 'Save…'}
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
        <CellStyleChoice value={cellStyle} onPick={pickStyle} />
      </div>

      <RaidGrid
        halfLabel={otherHalf ? PLAN_LABELS[half] : null}
        otherLooks={otherLooks}
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
        onMove={canEdit && planned && !touch && !busy ? onMove : null}
        raiderOrder={raiderOrder}
        onRaiders={canEdit && !touch && !busy ? onRaiders : null}
        // On any device, though it saves at once (Kat, #1682).
        onNeeds={canEdit ? setNeedsFor : null}
      />

      {needsFor && <BossNeeds boss={needsFor} targets={targets} onClose={() => setNeedsFor(null)} />}

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
                {orderDirty && ' The pull order goes on every coming night, including ones already saved.'}
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

// "What Katorrí plays on Sszorak" (#1580, Kat's #1680 design): each of the
// raider's characters, their roster character first, then their alts, each
// with every spec of its class and the usual one marked. Picking one swaps
// them, or puts them in if they were out.
// "What Ula'tek needs" (#1682, board D): a boss's standing tanks, healers,
// melee and ranged, for every night. Each - or + saves at once, so it never
// shows as an unsaved change (Kat, 2026-10-27); melee and ranged are minimums. Tanks and healers start at the
// team's targets and stop at 0; melee and ranged start at Any and step down to
// it from 1.
const NEEDS_ROWS: { label: string; role: Role; key: keyof BossTargets }[] = [
  { label: 'Tanks', role: 'Tank', key: 'tanks' },
  { label: 'Healers', role: 'Heal', key: 'healers' },
  { label: 'Melee', role: 'Melee', key: 'melee' },
  { label: 'Ranged', role: 'Ranged', key: 'ranged' }
];

function BossNeeds({ boss, targets, onClose }: { boss: LineupBoss; targets: RoleTargets; onClose: () => void }) {
  const team = useTeam();
  const { announce } = useStatus();
  const save = useSetBossTargets(team.id);
  const wants = wantsOf(targets, boss.id);
  const teamWants = wantsOf({ tanks: targets.tanks, healers: targets.healers }, boss.id);
  const own = targets.bosses?.get(boss.id) ?? NO_BOSS_TARGETS;

  const put = (next: BossTargets) => {
    if (save.isPending) return;
    const text = wantsText({ ...targets, bosses: new Map([[boss.id, next]]) }, boss.id);
    save.mutate(
      { encounterId: boss.id, targets: next },
      {
        onSuccess: () =>
          announce(
            'success',
            `Saved: ${boss.short} ${text ? text.replace(/^Wants/, 'wants') : 'uses the team’s targets'}.`
          ),
        onError: (e) => announce('error', `That did not save: ${e.message}`)
      }
    );
  };
  const step = (role: Role, d: number) => {
    const floor = teamWants[role] === null ? 1 : 0;
    const v = wants[role];
    const value = v === null ? (d > 0 ? 1 : null) : v + d < floor ? (floor ? null : 0) : Math.min(v + d, 30);
    // Only what differs from the team's is the boss's own.
    const next = { ...NO_BOSS_TARGETS };
    for (const r of NEEDS_ROWS) {
      const w = r.role === role ? value : wants[r.role];
      next[r.key] = w === teamWants[r.role] ? null : w;
    }
    put(next);
  };

  return (
    <Dialog title={`What ${boss.short} needs`} onClose={onClose}>
      <p className="text-muted">
        Team targets: {plural(targets.tanks, 'tank')}, {plural(targets.healers, 'healer')}. This is the boss’s standing
        setting, used every night. Changes save right away.
      </p>
      <table className="blg-needs-table">
        <tbody>
          {NEEDS_ROWS.map(({ label, role }) => (
            <tr key={role}>
              <th scope="row">{label}</th>
              <td>
                <span className="blg-step">
                  <button
                    type="button"
                    className="button"
                    aria-label={`One fewer: ${label.toLowerCase()}`}
                    aria-disabled={save.isPending || undefined}
                    onClick={() => step(role, -1)}
                  >
                    −
                  </button>
                  <output className="num" data-own={wants[role] !== teamWants[role] || undefined}>
                    {wants[role] ?? 'Any'}
                  </output>
                  <button
                    type="button"
                    className="button"
                    aria-label={`One more: ${label.toLowerCase()}`}
                    aria-disabled={save.isPending || undefined}
                    onClick={() => step(role, 1)}
                  >
                    +
                  </button>
                </span>
              </td>
            </tr>
          ))}
          <tr className="text-dim">
            <th scope="row">Raiders</th>
            <td>up to {boss.cap}</td>
          </tr>
        </tbody>
      </table>
      <div className="dialog-actions">
        <button
          type="button"
          className="button button-quiet"
          disabled={Object.values(own).every((v) => v === null)}
          onClick={() => put(NO_BOSS_TARGETS)}
        >
          Use team targets
        </button>
        <button type="button" className="button button-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}

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
