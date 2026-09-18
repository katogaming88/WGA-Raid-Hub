import { useEffect, type ReactNode } from 'react';
import { useBlocker } from 'react-router';
import { Dialog } from '../components/Dialog';

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

// Leaving with unsaved changes asks first: another tab, another night, or any
// other page. Closing the browser tab gets the browser's own question. `what`
// names what the changes are to, as in "unsaved changes to <what>".
export function useLeaveGuard(dirty: boolean, count: number, what: string): ReactNode {
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
        You have {plural(count, 'unsaved change')} to {what}. If you leave now, {count === 1 ? 'it’s' : 'they’re'} lost.
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
