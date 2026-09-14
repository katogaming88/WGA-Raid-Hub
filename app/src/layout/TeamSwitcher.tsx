import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Icon } from '../components/Icon';
import type { TeamSummary } from '../data/address';

// A disclosure, not a menu: a button that shows a list of links (#1101
// checklist: collapsibles are real buttons with aria-expanded/aria-controls).
// Picking a team keeps the page you are on, so Roster stays Roster.
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
  const listId = useId();

  if (open && location.pathname !== openedAt) setOpen(false);

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

  return (
    <div className="team-switcher-wrap" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="team-switcher"
        aria-expanded={open}
        aria-controls={listId}
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
      <ul id={listId} className="team-list" hidden={!open}>
        {active.map((team) => (
          <li key={team.id}>
            <Link
              to={`/g/${guildKey}/t/${team.key}${subpath}`}
              className="team-option"
              aria-current={team.key === currentKey ? 'true' : undefined}
            >
              {team.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
