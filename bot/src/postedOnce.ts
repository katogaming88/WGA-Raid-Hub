// "Character Added to Roster" posts each add once (#1674): the relay sends the
// add's Audit Log row id, and a repeat of an id already posted is dropped.
// ponytail: in memory, so a bot restart forgets; the relay only sends a row
// from the last few minutes, so a restart lets at most one repeat through.
// A table of posted ids if that ever matters.
export function postedOnce(limit = 1000) {
  const seen = new Set<number>();
  return (id: number): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    // A Set keeps insertion order, so the first value is the oldest.
    if (seen.size > limit) seen.delete(seen.values().next().value as number);
    return true;
  };
}
