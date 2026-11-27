// The boss grid shared by a night's Boss lineup and Boss groups (#1884):
// bosses across the top with their picture, count and fill bar, the roster
// down the side by role, a class-colored cell per raider per boss. One file,
// so a change to it reaches both pages.

import { useEffect, useState, type CSSProperties, type DragEvent, type MouseEvent, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { classColor, type PlayerRow, type Role } from '../roster/roster';
import { specIcon } from '../roster/specIcons';
import { shortDay, type Answer, type RaidNight } from './calendar';
import { ColumnSizer } from './ColumnSizer';
import {
  capLabel,
  lineupView,
  shortBossesLook,
  moveBoss,
  playWords,
  roleOff,
  wantsText,
  type BossTotal,
  type LineupBoss,
  type LineupRaid,
  type Picks,
  type PlayLookup,
  type RaiderOrder,
  type RoleTargets
} from './lineup';
import { useStatus } from '../components/Status';
import { useCellStyle, useSaveCellStyle, type CellStyle } from './useCalendar';

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

// Each viewer's Names / Solid bars choice (#1681), saved to their account and
// the same on both pages. The grid switches at once; a save that fails goes
// back to what is saved, and says so.
export function useCellStyleChoice(): [CellStyle, (style: CellStyle) => void] {
  const { announce } = useStatus();
  const saved = useCellStyle();
  const save = useSaveCellStyle();
  const [picked, setPicked] = useState<CellStyle | null>(null);
  const pick = (style: CellStyle) => {
    setPicked(style);
    save.mutate(style, {
      onError: (e) => {
        setPicked(null);
        announce('error', `Your cell style didn’t save: ${e.message}`);
      }
    });
  };
  return [picked ?? saved.data ?? 'names', pick];
}

export function CellStyleChoice({ value, onPick }: { value: CellStyle; onPick: (style: CellStyle) => void }) {
  return (
    <fieldset className="blg-style">
      <legend>Cells</legend>
      {(
        [
          ['names', 'Names'],
          ['bars', 'Solid bars']
        ] as const
      ).map(([style, label]) => (
        <label key={style}>
          <input type="radio" name="lineup-cell-style" checked={value === style} onChange={() => onPick(style)} />{' '}
          {label}
        </label>
      ))}
    </fieldset>
  );
}
// A picture Warcraft Logs doesn't have (or a blocked request) leaves no
// broken-image box behind.
const hideBroken = (e: SyntheticEvent<HTMLImageElement>) => {
  e.currentTarget.style.visibility = 'hidden';
};

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

function TipBody({ tip }: { tip: Tip }) {
  const t = tip.total;
  const row = (label: string, value: string, warn: boolean) => (
    <tr key={label}>
      <th scope="row">{label}</th>
      <td className={warn ? 'blg-tip-warn' : undefined}>{value}</td>
    </tr>
  );
  const against = (n: number, target: number | null) => (target ? `${n}/${target}` : String(n));
  const role = (label: string, r: Role) =>
    row(label, against(t.roles[r], t.wants[r]), roleOff(r, t.roles[r], t.wants[r], t.boss.flex));
  return (
    <>
      <strong>
        {tip.pull}. {t.boss.name}
      </strong>
      <table className="blg-tip-table">
        <tbody>
          {row('Raiders', `${t.count}/${t.boss.cap}`, t.status.tone === 'warn' || t.status.tone === 'bad')}
          {role('Tanks', 'Tank')}
          {role('Healers', 'Heal')}
          {role('Melee', 'Melee')}
          {role('Ranged', 'Ranged')}
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

// A Needs a look line.
export type Look = { key: string; head: string; text: string; full: string | null; total: BossTotal | undefined };

export function RaidGrid({
  kind = 'night',
  onEditCap = null,
  halfLabel,
  otherLooks,
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
  onSkip,
  onMove,
  raiderOrder,
  onRaiders,
  onNeeds
}: {
  // A night's lineup, or Boss groups (#1884): the groups leave out the
  // night-only parts (Needs a look here, RSVPs, Skip, picks) and read each
  // cell against what is saved.
  kind?: 'night' | 'groups';
  // Boss groups' Edit cap on each boss; null when this viewer can't.
  onEditCap?: ((boss: LineupBoss) => void) | null;
  // On a two-half night (#1688): the half on screen, named on its lines, and
  // the other half's bosses that need a look, listed after them.
  halfLabel: string | null;
  otherLooks: Look[];
  raid: LineupRaid;
  night: RaidNight;
  players: PlayerRow[];
  answers: Answer[];
  places: ReadonlyMap<number, ReadonlySet<number>>;
  usual: ReadonlyMap<number, ReadonlySet<number>>;
  picks: Picks;
  usualPicks: Picks;
  look: PlayLookup;
  // Null where picks aren't changed (Boss groups).
  onPicking: ((boss: LineupBoss, player: PlayerRow) => void) | null;
  targets: RoleTargets;
  cellStyle: CellStyle;
  canEdit: boolean;
  busy: boolean;
  onToggle: (boss: number, player: number) => void;
  // Null where a name isn't a button (Boss groups).
  onWholeNight: ((player: number, putIn: boolean) => void) | null;
  // Null when this viewer can't skip bosses here.
  onSkip: ((boss: LineupBoss) => void) | null;
  // Moves a boss onto another's place (#1679); null when this viewer can't.
  onMove: ((id: number, onto: number) => void) | null;
  raiderOrder: RaiderOrder;
  // Saves one role section's order (#1683); null when this viewer can't.
  onRaiders: ((role: Role, playerIds: number[]) => void) | null;
  // Opens a boss's standing targets (#1682); null when this viewer can't.
  onNeeds: ((boss: LineupBoss) => void) | null;
}) {
  const [showBuffs, setShowBuffs] = useState(false);
  // The column under the pointer, brightened top to bottom.
  const [hot, setHot] = useState<number | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  // The boss being dragged, and where it would land: a line before or after
  // the boss under the pointer.
  const [dragging, setDragging] = useState<number | null>(null);
  const [drop, setDrop] = useState<{ id: number; side: 'before' | 'after' } | null>(null);
  // The raider being dragged and the one under it, within their section.
  const [raiderDrag, setRaiderDrag] = useState<{ id: number; role: Role } | null>(null);
  const [raiderDrop, setRaiderDrop] = useState<{ id: number; side: 'before' | 'after' } | null>(null);
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
  const view = lineupView(players, night, answers, raid, places, usual, targets, picks, plays, usualPicks, raiderOrder);
  const totals = new Map(view.totals.map((t) => [t.boss.id, t]));
  const gaps = view.totals.filter((t) => t.problems.length);
  const liveCount = view.live.length;
  const bossLook = shortBossesLook(
    gaps.map((t) => `${raid.bosses.indexOf(t.boss) + 1}. ${t.boss.short}`),
    view.totals.length,
    { half: halfLabel ?? '' }
  );
  const looks: Look[] = [
    ...(bossLook
      ? [{ key: 'bosses-short', head: bossLook.head, text: bossLook.text, full: null, total: undefined }]
      : []),
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
      : []),
    ...otherLooks
  ];
  const hotProps = (id: number) => ({ 'data-hot': hot === id || undefined, onMouseEnter: () => setHot(id) });

  return (
    <>
      {canEdit && kind === 'night' && (
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
            {kind === 'groups'
              ? `${raid.name} boss groups, up to ${capLabel(raid.bosses)}`
              : `${raid.name} lineup for ${shortDay(night.date)}, up to ${capLabel(raid.bosses)}`}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="blg-corner">
                <span className="visually-hidden">Raider</span>
                {canEdit && (
                  <span className="text-dim" aria-hidden="true">
                    {kind === 'groups'
                      ? 'Click a cell to put someone in a group or take them out. Click a name for every boss.'
                      : 'Click a cell to put someone in or sit them out. Click a name for every boss.'}
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
                    data-drop={drop?.id === boss.id ? drop.side : undefined}
                    data-dragging={dragging === boss.id || undefined}
                    {...hotProps(boss.id)}
                    {...tipProps(t)}
                    onMouseEnter={(e) => {
                      setHot(boss.id);
                      tipProps(t).onMouseEnter?.(e);
                    }}
                    {...(onMove
                      ? {
                          draggable: true,
                          onDragStart: (e: DragEvent<HTMLElement>) => {
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', String(boss.id));
                            setDragging(boss.id);
                            setTip(null);
                          },
                          onDragOver: (e: DragEvent<HTMLElement>) => {
                            if (dragging === null) return;
                            e.preventDefault();
                            const from = raid.bosses.findIndex((b) => b.id === dragging);
                            setDrop(dragging === boss.id ? null : { id: boss.id, side: i > from ? 'after' : 'before' });
                          },
                          onDrop: (e: DragEvent<HTMLElement>) => {
                            e.preventDefault();
                            if (dragging !== null && dragging !== boss.id) onMove(dragging, boss.id);
                            setDragging(null);
                            setDrop(null);
                          },
                          onDragEnd: () => {
                            setDragging(null);
                            setDrop(null);
                          }
                        }
                      : {})}
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
                          {t.problems.length ? `, needs a look: ${t.problems.join('; ')}` : ''}
                        </span>
                      </>
                    ) : (
                      <span className="blg-count text-dim">Skipped tonight</span>
                    )}
                    {wantsText(targets, boss.id) &&
                      (onNeeds ? (
                        <button type="button" className="blg-wants" onClick={() => onNeeds(boss)}>
                          {wantsText(targets, boss.id)}
                        </button>
                      ) : (
                        <span className="blg-wants">{wantsText(targets, boss.id)}</span>
                      ))}
                    {onNeeds && (
                      <button
                        type="button"
                        className="blg-needs"
                        aria-label={`What ${boss.name} needs`}
                        title="What this boss needs"
                        onClick={() => onNeeds(boss)}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          aria-hidden="true"
                        >
                          <path d="M2 4h7M13 4h1M2 8h2M8 8h6M2 12h9M13 12h1" />
                          <circle cx="11" cy="4" r="1.8" />
                          <circle cx="6" cy="8" r="1.8" />
                          <circle cx="11" cy="12" r="1.8" />
                        </svg>
                      </button>
                    )}
                    {onMove && (
                      <span className="blg-move">
                        <button
                          type="button"
                          className="button"
                          disabled={i === 0}
                          aria-label={`Move ${boss.name} earlier`}
                          onClick={() => onMove(boss.id, raid.bosses[i - 1]!.id)}
                        >
                          ‹
                        </button>
                        <button
                          type="button"
                          className="button"
                          disabled={i === raid.bosses.length - 1}
                          aria-label={`Move ${boss.name} later`}
                          onClick={() => onMove(boss.id, raid.bosses[i + 1]!.id)}
                        >
                          ›
                        </button>
                      </span>
                    )}
                    {onEditCap && (
                      <button type="button" className="button lineup-skip" onClick={() => onEditCap(boss)}>
                        Edit cap
                      </button>
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
            return (
              <tbody key={g.role}>
                <tr className="blg-group">
                  <th scope="rowgroup">
                    {g.label} · {g.rows.length}
                    {onRaiders && g.ordered && (
                      <button
                        type="button"
                        className="blg-sort"
                        aria-label={`Sort ${g.label} A to Z`}
                        onClick={() => onRaiders(g.role, [])}
                      >
                        Sort A–Z
                      </button>
                    )}
                  </th>
                  {raid.bosses.map((boss) => {
                    const t = totals.get(boss.id);
                    const n = t?.roles[g.role] ?? 0;
                    const target = t?.wants[g.role];
                    return (
                      <td
                        key={boss.id}
                        data-tone={t && roleOff(g.role, n, target ?? null, t.boss.flex) ? 'warn' : undefined}
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
                  const id = r.row.player.id;
                  const ids = g.rows.map((x) => x.row.player.id);
                  const at = ids.indexOf(id);
                  const move = (onto: number) => onRaiders?.(g.role, moveBoss(ids, id, onto));
                  const dropOn = raiderDrag?.role === g.role && raiderDrop?.id === id ? raiderDrop.side : undefined;
                  // Boss groups tags a raider in no group, as it always has.
                  const player = r.row.player;
                  const unplaced = kind === 'groups' && off && !player.is_bench;
                  const tag =
                    kind === 'groups'
                      ? player.is_bench
                        ? 'Bench'
                        : unplaced
                          ? 'In no group'
                          : player.is_trial
                            ? 'Trial'
                            : null
                      : r.tag;
                  const tagTone = unplaced ? 'warn' : r.tagTone;
                  return (
                    <tr
                      key={id}
                      data-drop={dropOn}
                      data-dragging={raiderDrag?.id === id || undefined}
                      {...(onRaiders
                        ? {
                            onDragOver: (e: DragEvent<HTMLElement>) => {
                              // Only within the section being dragged.
                              if (raiderDrag?.role !== g.role) return;
                              e.preventDefault();
                              const from = ids.indexOf(raiderDrag.id);
                              setRaiderDrop(raiderDrag.id === id ? null : { id, side: at > from ? 'after' : 'before' });
                            },
                            onDrop: (e: DragEvent<HTMLElement>) => {
                              if (raiderDrag?.role !== g.role) return;
                              e.preventDefault();
                              if (raiderDrag.id !== id) onRaiders(g.role, moveBoss(ids, raiderDrag.id, id));
                              setRaiderDrag(null);
                              setRaiderDrop(null);
                            }
                          }
                        : {})}
                    >
                      <th scope="row" className="blg-raider" data-off={off}>
                        {/* Only the name is the button, so what it says matches
                            what it shows; it stretches over the whole box. */}
                        <span
                          className="blg-raider-box"
                          {...(onRaiders
                            ? {
                                draggable: true,
                                onDragStart: (e: DragEvent<HTMLElement>) => {
                                  e.dataTransfer.effectAllowed = 'move';
                                  e.dataTransfer.setData('text/plain', String(id));
                                  setRaiderDrag({ id, role: g.role });
                                },
                                onDragEnd: () => {
                                  setRaiderDrag(null);
                                  setRaiderDrop(null);
                                }
                              }
                            : {})}
                        >
                          {icon && <img className="blg-spec-icon" src={icon} alt="" width={16} height={16} />}
                          {canEdit && onWholeNight ? (
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
                          {tag && (
                            <span className="lineup-tag" data-tone={tagTone}>
                              {tag}
                            </span>
                          )}
                          {onRaiders && ids.length > 1 && (
                            <span className="blg-raider-move">
                              <button
                                type="button"
                                disabled={at === 0}
                                aria-label={`Move ${name} up`}
                                onClick={() => move(ids[at - 1]!)}
                              >
                                ▲
                              </button>
                              <button
                                type="button"
                                disabled={at === ids.length - 1}
                                aria-label={`Move ${name} down`}
                                onClick={() => move(ids[at + 1]!)}
                              >
                                ▼
                              </button>
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
                        const state =
                          kind === 'groups'
                            ? c.in
                              ? 'in the group'
                              : 'not in the group'
                            : c.boss.skipped
                              ? 'skipped tonight'
                              : c.in
                                ? 'in'
                                : 'out';
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
                          ...(c.differs
                            ? [kind === 'groups' ? 'not saved yet' : `changed for tonight only, usually ${usually}`]
                            : [])
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
                              {c.differs && kind === 'groups' && (
                                <span className="blg-mark" data-kind="unsaved">
                                  •
                                </span>
                              )}
                              {c.differs && kind === 'night' && (
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
                                {!c.boss.skipped && onPicking && (
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
            <TipBody tip={tip} />
          </div>,
          document.body
        )}

      <p className="blg-key text-muted">
        {kind === 'groups' ? (
          <span>
            <span className="blg-mark" data-kind="unsaved" aria-hidden="true">
              •
            </span>{' '}
            Not saved yet
          </span>
        ) : (
          <>
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
          </>
        )}
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
