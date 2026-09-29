import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './Icon';
import './menu.css';

export type MenuAction = { label: string; onSelect: () => void; disabled?: boolean };

// The "..." row-action menu (Viserio-style, Kat 2026-09-29): the one place
// this app hides secondary actions behind a trigger instead of inline
// buttons. `label` names the menu for screen readers ("More actions for
// Torbjorn"), not shown on screen.
export function Menu({ label, actions }: { label: string; actions: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const items = () =>
      Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
    items()[0]?.focus();

    const onDocMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      const list = items();
      const index = list.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        list[index < 0 ? 0 : (index + 1) % list.length]?.focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        list[index < 0 ? list.length - 1 : (index - 1 + list.length) % list.length]?.focus();
      } else if (event.key === 'Home') {
        event.preventDefault();
        list[0]?.focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        list[list.length - 1]?.focus();
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  return (
    <span className="menu">
      <button
        type="button"
        ref={triggerRef}
        className="icon-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="more" />
        <span className="visually-hidden">{label}</span>
      </button>
      {open && (
        <div id={id} ref={panelRef} role="menu" aria-label={label} className="menu-panel">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              className="menu-item"
              disabled={action.disabled}
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
