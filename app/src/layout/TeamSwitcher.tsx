import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react';
import { Link, useLocation } from 'react-router';
import { Icon } from '../components/Icon';
import type { TeamSummary } from '../data/address';

// A disclosure, not a menu: a button that shows a list of links (#1101
// checklist: collapsibles are real buttons with aria-expanded/aria-controls).
// Picking a team keeps the page you are on, so Roster stays Roster.
//
// Keyboard: Down or Up on the button opens the list on the current team; Up,
// Down, Home and End move through it; Enter follows the link; Escape closes it
// and returns to the button; tabbing out closes it (Kat, 2026-09-13).
export function TeamSwitcher({
  guildKey,
  teams,
  currentKey,
  label
}: {
  guildKey: string;
  teams: TeamSummary[];
  currentKey: string | null;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState('');
  const location = useLocation();
  const button = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const focusOnOpen = useRef<'current' | 'last' | null>(null);
  const listId = useId();

  if (open && location.pathname !== openedAt) setOpen(false);

  const links = () => [...(list.current?.querySelectorAll<HTMLAnchorElement>('a') ?? [])];

  // Opened from the keyboard: move focus into the list once it is showing.
  useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    const all = links();
    const target =
      focusOnOpen.current === 'last'
        ? all.at(-1)
        : (all.find((a) => a.getAttribute('aria-current') === 'true') ?? all[0]);
    focusOnOpen.current = null;
    target?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    // It floats over the nav, so a click anywhere else closes it.
    const onPointer = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  // The part of the address after the team key, e.g. "/roster".
  const teamPrefix = currentKey ? `/g/${guildKey}/t/${currentKey}` : null;
  const subpath =
    teamPrefix && location.pathname.startsWith(teamPrefix) ? location.pathname.slice(teamPrefix.length) : '';

  const active = teams.filter((t) => !t.archived);

  const openFromKeyboard = (event: ReactKeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    focusOnOpen.current = event.key === 'ArrowUp' ? 'last' : 'current';
    if (open) {
      const all = links();
      (event.key === 'ArrowUp'
        ? all.at(-1)
        : (all.find((a) => a.getAttribute('aria-current') === 'true') ?? all[0])
      )?.focus();
      focusOnOpen.current = null;
    } else {
      setOpenedAt(location.pathname);
      setOpen(true);
    }
  };

  const moveWithinList = (event: ReactKeyboardEvent) => {
    const all = links();
    const at = all.indexOf(document.activeElement as HTMLAnchorElement);
    const next =
      event.key === 'ArrowDown'
        ? all[(at + 1) % all.length]
        : event.key === 'ArrowUp'
          ? all[(at - 1 + all.length) % all.length]
          : event.key === 'Home'
            ? all[0]
            : event.key === 'End'
              ? all.at(-1)
              : undefined;
    if (!next) return;
    event.preventDefault();
    next.focus();
  };

  // Focus leaving the button and the list altogether (Tab out) closes it.
  const closeIfFocusLeaves = (event: ReactFocusEvent) => {
    if (open && !wrap.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
  };

  return (
    <div className="team-switcher-wrap" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="team-switcher"
        aria-expanded={open}
        aria-controls={listId}
        onKeyDown={openFromKeyboard}
        onBlur={closeIfFocusLeaves}
        onClick={() => {
          setOpenedAt(location.pathname);
          setOpen(!open);
        }}
      >
        <span className="team-dot" aria-hidden="true" />
        <span className="team-name">{label}</span>
        <span className="visually-hidden">, switch team</span>
        <Icon name="chevronDown" />
      </button>
      <ul id={listId} ref={list} className="team-list" hidden={!open}>
        {active.map((team) => (
          <li key={team.id}>
            <Link
              to={`/g/${guildKey}/t/${team.key}${subpath}`}
              className="team-option"
              aria-current={team.key === currentKey ? 'true' : undefined}
              onKeyDown={moveWithinList}
              onBlur={closeIfFocusLeaves}
            >
              {team.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
