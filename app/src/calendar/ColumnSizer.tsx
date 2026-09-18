import type { LineupBoss } from './lineup';

// Every boss column in a lineup grid is the same width, set by the longest
// single word in any of the grid's boss names (Kat, 2026-09-18): each header
// carries every word, unseen, so a name wraps only between words and never
// splits one.
export function ColumnSizer({ bosses }: { bosses: LineupBoss[] }) {
  const words = [...new Set(bosses.flatMap((b) => b.short.split(/\s+/)))];
  return (
    <span className="lineup-boss-sizer" aria-hidden="true">
      {words.map((w) => (
        <span key={w}>{w}</span>
      ))}
    </span>
  );
}
