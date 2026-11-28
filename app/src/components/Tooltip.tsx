import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './tooltip.css';

// Our own hover text, shown the instant the pointer is over something, not
// after the browser's delay for a `title`. Wrap an area; anything inside it
// with a `data-tip` shows that text above it. One tip for the whole area, so a
// chart of hundreds of dots costs one handler, not hundreds.
export function TipArea({ children, className }: { children: ReactNode; className?: string }) {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);

  const show = (target: EventTarget) => {
    const el = (target as HTMLElement).closest?.<HTMLElement>('[data-tip]');
    if (!el) return setTip(null);
    const r = el.getBoundingClientRect();
    setTip({ text: el.dataset['tip']!, x: r.left + r.width / 2, y: r.top });
  };

  return (
    <div className={className} onPointerOver={(e) => show(e.target)} onPointerLeave={() => setTip(null)}>
      {children}
      {tip &&
        createPortal(
          <div className="tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
            {tip.text}
          </div>,
          document.body
        )}
    </div>
  );
}
