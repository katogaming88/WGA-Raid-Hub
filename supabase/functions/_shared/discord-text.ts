// Text budgets for a Discord post (#1129). contact-webhook and boe-webhook
// each carried a copy of truncate() that kept max - 1 characters and then
// added three, so a cut value came out at max + 2: 1026 against the 1024
// Discord allows an embed field, and the whole contact post was refused.
// One copy here, budgeted for the suffix, so a test can reach it.

// Discord's cap on one embed field value. A field over it rejects the whole
// post, not the field.
export const EMBED_FIELD_VALUE_MAX = 1024;

// At most `max` UTF-16 units, the suffix included. A cut that would land
// between the two halves of a surrogate pair (an emoji) moves one unit
// earlier: a lone half is the other thing Discord refuses, and the string
// is then a unit under budget rather than over it.
export function truncate(s: string, max: number, suffix = '...'): string {
  if (s.length <= max) return s;
  if (max <= suffix.length) return s.slice(0, max);
  let cut = max - suffix.length;
  const before = s.charCodeAt(cut - 1);
  if (before >= 0xd800 && before <= 0xdbff) cut -= 1;
  return s.slice(0, cut) + suffix;
}
