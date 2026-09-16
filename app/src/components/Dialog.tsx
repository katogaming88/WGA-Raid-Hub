import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import './dialog.css';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// The one modal for the whole app: the claim prompt, confirmations, and every
// later form (#1101 checklist, from #369 and #1034).
//
// - role="dialog", aria-modal and aria-labelledby its title
// - focus moves in on open (to `initialFocus` when it can take focus, else the
//   first control), Tab
//   and Shift+Tab stay inside, and focus returns to what had it on close
// - Escape and the backdrop close it, unless `busy` (a write in flight)
// - everything else on the page is inert while it is open
//
// Render it only while open; unmounting is closing.
export function Dialog({
  title,
  onClose,
  busy = false,
  initialFocus,
  wide = false,
  children
}: {
  title: string;
  onClose: () => void;
  busy?: boolean;
  // For a dialog holding a table, such as the alts picker.
  wide?: boolean;
  initialFocus?: React.RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);

  useEffect(() => {
    closeRef.current = onClose;
    busyRef.current = busy;
  });

  useEffect(() => {
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // `initialFocus` can point at a control that is still disabled when the
    // dialog opens (the alts picker's Save, until the character list loads).
    // Focusing a disabled control does nothing, so fall back when it did not
    // take rather than leaving focus on the body behind the dialog.
    initialFocus?.current?.focus();
    if (!panel.current?.contains(document.activeElement)) {
      const fallback = panel.current?.querySelector<HTMLElement>(FOCUSABLE) ?? panel.current;
      fallback?.focus();
    }

    // Inert the rest of the page. Only the elements this dialog made inert are
    // restored, so a drawer that was already inert stays that way.
    const siblings = Array.from(document.body.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el !== host.current && !el.inert
    );
    siblings.forEach((el) => (el.inert = true));

    // Keys are handled on the document, in the capture phase, so the dialog
    // answers Escape before anything behind it (the narrow-screen drawer
    // listens for Escape too) and Tab wraps even if focus reached the panel.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (!busyRef.current) closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const inside = panel.current.contains(document.activeElement);
      if (event.shiftKey && (!inside || document.activeElement === first || document.activeElement === panel.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      siblings.forEach((el) => (el.inert = false));
      if (returnTo?.isConnected) returnTo.focus();
    };
    // Once per opening: the dialog is mounted to open and unmounted to close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div ref={host} className="dialog-host">
      <div className="dialog-backdrop" aria-hidden="true" onClick={() => !busy && onClose()} />
      <div
        ref={panel}
        className={wide ? 'dialog dialog-wide' : 'dialog'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="dialog-header">
          <h2 id={titleId} className="dialog-title">
            {title}
          </h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose} disabled={busy}>
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}
