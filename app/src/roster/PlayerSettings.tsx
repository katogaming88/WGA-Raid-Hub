import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { DataState } from '../components/DataState';
import { useStatus } from '../components/Status';
import { useClassSpecs } from '../characters/useMainSwaps';
import { classColor } from './roster';
import { FLAGS, usePlayerSettings, useSavePlayerSetting, type Flag, type SettingsChange } from './usePlayerSettings';
import './player-settings.css';

// Player settings (#1360, Kat 2026-10-07): a panel beside the roster, opened
// from a row's gear or the Profile, with nothing to scroll past. Every
// change saves as it is made, with Undo on the message; the arrows step
// through the roster without closing. Phones get it too, full screen.

export type SettingsTarget = { playerId: number; name: string };

type Opener = { openId: number | null; toggle: (playerId: number) => void };
const OpenContext = createContext<Opener | null>(null);

// The player whose panel is open, and the way to open or close it; null where
// no panel is offered (anyone but an officer, or a page without one).
export function usePlayerSettingsOpener() {
  return useContext(OpenContext);
}

const PANEL_ID = 'player-settings-panel';

// `order` is the players the arrows step through, in the order the page shows
// them.
export function PlayerSettingsProvider({
  teamId,
  order,
  children
}: {
  teamId: number;
  order: SettingsTarget[];
  children: ReactNode;
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const close = () => {
    setOpenId(null);
    window.setTimeout(() => returnTo.current?.isConnected && returnTo.current.focus(), 0);
  };
  // The button for the player already open closes it (Kat, 2026-10-07);
  // another player's switches to them.
  const toggle = (playerId: number) => {
    if (openId === playerId) return close();
    // The gear or Profile button, for focus to go back to on close.
    if (openId === null)
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpenId(playerId);
  };
  const index = order.findIndex((t) => t.playerId === openId);
  const target = index >= 0 ? order[index]! : null;
  return (
    <OpenContext.Provider value={{ openId: target ? openId : null, toggle }}>
      {children}
      {target && (
        <SettingsPanel
          key="panel"
          teamId={teamId}
          target={target}
          previous={order[index - 1] ?? null}
          next={order[index + 1] ?? null}
          onMove={(t) => setOpenId(t.playerId)}
          onClose={close}
        />
      )}
    </OpenContext.Provider>
  );
}

// A field's pending edit commits when it loses focus, so leaving the panel any
// way commits it first: moving focus away blurs it.
function commitFocused(panel: HTMLElement | null) {
  const el = document.activeElement;
  if (el instanceof HTMLElement && panel?.contains(el)) el.blur();
}

function SettingsPanel({
  teamId,
  target,
  previous,
  next,
  onMove,
  onClose
}: {
  teamId: number;
  target: SettingsTarget;
  previous: SettingsTarget | null;
  next: SettingsTarget | null;
  onMove: (t: SettingsTarget) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const leave = (then: () => void) => {
    commitFocused(panel.current);
    then();
  };

  // Focus moves in on open and on each step, so a screen reader hears whose
  // settings these are; Escape closes.
  useEffect(() => {
    heading.current?.focus();
  }, [target.playerId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        commitFocused(panel.current);
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside ref={panel} id={PANEL_ID} className="settings-panel" aria-labelledby={titleId}>
      <div className="settings-head">
        <div className="settings-title">
          <span className="settings-kicker">Player settings</span>
          <h2 id={titleId} ref={heading} tabIndex={-1}>
            {target.name}
          </h2>
        </div>
        <button
          type="button"
          className="icon-button settings-nav"
          aria-label={previous ? `Previous player, ${previous.name}` : 'Previous player'}
          disabled={!previous}
          onClick={() => previous && leave(() => onMove(previous))}
        >
          <Icon name="chevronLeft" />
        </button>
        <button
          type="button"
          className="icon-button settings-nav"
          aria-label={next ? `Next player, ${next.name}` : 'Next player'}
          disabled={!next}
          onClick={() => next && leave(() => onMove(next))}
        >
          <Icon name="chevronRight" />
        </button>
        <button type="button" className="icon-button" aria-label="Close player settings" onClick={() => leave(onClose)}>
          <Icon name="close" />
        </button>
      </div>
      {/* Keyed by player: a half-typed note never follows the arrows. */}
      <SettingsForm key={target.playerId} teamId={teamId} target={target} />
      <p className="settings-foot">Every change saves as you make it.</p>
    </aside>
  );
}

function SettingsForm({ teamId, target }: { teamId: number; target: SettingsTarget }) {
  const id = useId();
  const query = usePlayerSettings(teamId, target.playerId);
  const specs = useClassSpecs();
  const save = useSavePlayerSetting(teamId);
  const { announce } = useStatus();
  // What a change shows until the save is back, so a switch moves on the
  // click rather than a moment later.
  const [pending, setPending] = useState<Partial<Record<Flag, boolean>>>({});
  const [joinDraft, setJoinDraft] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);

  if (query.isError || query.isPending) {
    return (
      <div className="settings-body">
        <DataState query={query} label="this player's settings">
          {() => null}
        </DataState>
      </div>
    );
  }
  const player = query.data;
  if (!player) {
    return (
      <div className="settings-body">
        <p className="text-muted">This character is no longer on the roster.</p>
      </div>
    );
  }

  const run = (change: SettingsChange, done: string, undo?: SettingsChange) =>
    save.mutate(
      { playerId: player.id, change },
      {
        onSuccess: () =>
          announce(
            'success',
            done,
            undo && {
              label: 'Undo',
              onSelect: () => save.mutate({ playerId: player.id, change: undo })
            }
          ),
        onSettled: () => {
          if (change.kind === 'flag')
            setPending((p) => {
              const rest = { ...p };
              delete rest[change.flag];
              return rest;
            });
          if (change.kind === 'joinDate') setJoinDraft(null);
          if (change.kind === 'note') setNoteDraft(null);
        }
      }
    );

  const flip = (flag: Flag, label: string) => {
    const value = !(pending[flag] ?? player[flag]);
    setPending((p) => ({ ...p, [flag]: value }));
    run({ kind: 'flag', flag, value }, `${label} turned ${value ? 'on' : 'off'} for ${target.name}.`, {
      kind: 'flag',
      flag,
      value: !value
    });
  };

  const classes = specs.isSuccess ? groupByClass(specs.data) : [];
  const current = specs.isSuccess ? specs.data.find((s) => s.id === player.class_spec_id) : undefined;
  const specLabel = (specId: number) => {
    const s = specs.data?.find((x) => x.id === specId);
    return s ? `${s.spec} ${s.class}` : '';
  };

  const joinValue = joinDraft ?? player.join_date ?? '';
  const noteValue = noteDraft ?? player.officer_notes ?? '';

  return (
    <div className="settings-body">
      <section className="settings-section" aria-labelledby={`${id}-char`}>
        <h3 id={`${id}-char`} className="settings-heading">
          Character
        </h3>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-spec`}>
            Spec
          </label>
          <select
            id={`${id}-spec`}
            className="input"
            style={{ color: current ? classColor(current.class) : undefined }}
            value={player.class_spec_id ?? ''}
            disabled={!specs.isSuccess}
            onChange={(e) => {
              const to = Number(e.target.value);
              const was = player.class_spec_id;
              run(
                { kind: 'spec', classSpecId: to, label: specLabel(to) },
                `${target.name} is now ${specLabel(to)}.`,
                was !== null ? { kind: 'spec', classSpecId: was, label: specLabel(was) } : undefined
              );
            }}
          >
            {player.class_spec_id === null && <option value="">Not set</option>}
            {classes.map(([cls, list]) => (
              <optgroup key={cls} label={cls}>
                {list.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.spec} {s.class}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-joined`}>
            Joined the team
          </label>
          <input
            id={`${id}-joined`}
            className="input"
            type="date"
            value={joinValue}
            onChange={(e) => setJoinDraft(e.target.value)}
            onBlur={() => {
              if (joinDraft === null || joinDraft === (player.join_date ?? '')) return setJoinDraft(null);
              const was = player.join_date;
              run({ kind: 'joinDate', value: joinDraft || null }, `Join date saved for ${target.name}.`, {
                kind: 'joinDate',
                value: was
              });
            }}
          />
        </div>
      </section>

      <section className="settings-section" aria-labelledby={`${id}-status`}>
        <h3 id={`${id}-status`} className="settings-heading">
          Status
        </h3>
        <ul className="settings-switches">
          {FLAGS.map((f) => {
            // Missing reads as off, so a switch always says which it is.
            const on = Boolean(pending[f.flag] ?? player[f.flag]);
            return (
              <li key={f.flag} className="settings-switch">
                <span className="settings-switch-text">
                  <span id={`${id}-${f.flag}`} className="settings-switch-label">
                    {f.label}
                  </span>
                  <span id={`${id}-${f.flag}-help`} className="text-muted">
                    {f.help}
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  className="switch"
                  aria-checked={on}
                  aria-labelledby={`${id}-${f.flag}`}
                  aria-describedby={`${id}-${f.flag}-help`}
                  onClick={() => flip(f.flag, f.label)}
                />
              </li>
            );
          })}
        </ul>
      </section>

      <section className="settings-section">
        <label className="settings-heading" htmlFor={`${id}-note`}>
          Officer note <span className="text-muted">(only officers see it)</span>
        </label>
        <textarea
          id={`${id}-note`}
          className="input"
          rows={3}
          value={noteValue}
          onChange={(e) => setNoteDraft(e.target.value)}
          onBlur={() => {
            const trimmed = noteDraft?.trim() ?? null;
            if (noteDraft === null || trimmed === (player.officer_notes ?? '')) return setNoteDraft(null);
            run({ kind: 'note', value: trimmed || null }, `Officer note saved for ${target.name}.`);
          }}
        />
      </section>

      {save.isError && (
        <p className="form-error" role="alert">
          That did not save: {save.error.message}
        </p>
      )}
    </div>
  );
}

// Classes alphabetically, each with its specs, for the one Spec list: picking
// a spec picks its class too, so there is never a class with a spec from
// another one.
function groupByClass<T extends { class: string; spec: string }>(specs: T[]): [string, T[]][] {
  const out = new Map<string, T[]>();
  for (const s of [...specs].sort((a, b) => a.class.localeCompare(b.class) || a.spec.localeCompare(b.spec))) {
    out.set(s.class, [...(out.get(s.class) ?? []), s]);
  }
  return [...out];
}

// The Profile's way in (Kat, 2026-10-07): the same panel, for the one player
// being looked at.
export function PlayerSettingsButton({ teamId, target }: { teamId: number; target: SettingsTarget }) {
  return (
    <PlayerSettingsProvider teamId={teamId} order={[target]}>
      <OpenButton playerId={target.playerId} />
    </PlayerSettingsProvider>
  );
}

function OpenButton({ playerId }: { playerId: number }) {
  const opener = usePlayerSettingsOpener();
  return (
    <button
      type="button"
      className="button"
      aria-expanded={opener?.openId === playerId}
      aria-controls={PANEL_ID}
      onClick={() => opener?.toggle(playerId)}
    >
      <Icon name="gear" />
      Player settings
    </button>
  );
}

// A roster row's way in (Kat, 2026-10-07: not in the "..." menu). Nothing
// where no panel is offered.
export function SettingsRowButton({ playerId, name }: { playerId: number; name: string }) {
  const opener = usePlayerSettingsOpener();
  if (!opener) return null;
  return (
    <button
      type="button"
      className="icon-button settings-row-button"
      aria-label={`Player settings for ${name}`}
      aria-expanded={opener.openId === playerId}
      aria-controls={PANEL_ID}
      title="Player settings"
      onClick={() => opener.toggle(playerId)}
    >
      <Icon name="gear" />
    </button>
  );
}
