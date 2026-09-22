// A class badge reads "Restoration Shaman" from the spec (already the full
// name on the current site's editor) or, with no spec set, just the class.
export function classBadgeLabel(classKey: string, spec: string): string {
  return spec || classKey;
}
