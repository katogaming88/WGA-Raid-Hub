import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import './status.css';

// The one way the app tells someone that something happened (#1101 checklist,
// from #438 and #1039). Two live regions sit in the page from the start, so a
// screen reader hears a message the moment it appears:
// - role="status" for progress and success; success clears itself
// - role="alert" for errors, which stay until dismissed

export type StatusKind = 'success' | 'progress' | 'error';
type Message = { id: number; kind: StatusKind; text: string };

type StatusValue = {
  announce: (kind: StatusKind, text: string) => void;
};

const StatusContext = createContext<StatusValue | null>(null);

const SUCCESS_MS = 8000;

export function StatusProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setMessages((current) => current.filter((m) => m.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const announce = useCallback(
    (kind: StatusKind, text: string) => {
      const id = nextId.current++;
      // A new progress or success message replaces the last one of its kind;
      // errors pile up, since each needs its own acknowledgement.
      setMessages((current) => [...current.filter((m) => kind === 'error' || m.kind === 'error'), { id, kind, text }]);
      if (kind === 'success')
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), SUCCESS_MS)
        );
    },
    [dismiss]
  );

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => clearTimeout(timer));
  }, []);

  const value = useMemo(() => ({ announce }), [announce]);
  const polite = messages.filter((m) => m.kind !== 'error');
  const errors = messages.filter((m) => m.kind === 'error');

  return (
    <StatusContext.Provider value={value}>
      {children}
      <div className="status-stack">
        <div role="status" className="status-region">
          {polite.map((m) => (
            <p key={m.id} className={`status-message status-${m.kind}`}>
              {m.text}
            </p>
          ))}
        </div>
        <div role="alert" className="status-region">
          {errors.map((m) => (
            <div key={m.id} className="status-message status-error">
              <p>{m.text}</p>
              <button type="button" className="button" onClick={() => dismiss(m.id)}>
                Dismiss
              </button>
            </div>
          ))}
        </div>
      </div>
    </StatusContext.Provider>
  );
}

export function useStatus(): StatusValue {
  const value = useContext(StatusContext);
  if (!value) throw new Error('useStatus needs a StatusProvider above it');
  return value;
}
