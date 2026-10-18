import type { RankedRow } from './priority';

// The two real conflicts on a #1 (#1362 part 3), shown the same in the list
// and the editor.
export function ConflictFlags({ row }: { row: RankedRow }) {
  return (
    <>
      {row.heroicCopy && <span className="priority-flag priority-flag-warn">Has the Heroic copy</span>}
      {row.sameBoss.length > 0 && (
        <span className="priority-flag priority-flag-warn">Also #1 on {row.sameBoss.join(', ')}, same boss</span>
      )}
    </>
  );
}
