// Text budgets for a Discord post (#1129). contact-webhook and boe-webhook
// each carried their own copy of this helper; one copy here so a test can
// reach it. The arithmetic is theirs as it was.

// Discord's cap on one embed field value. A field over it rejects the whole
// post, not the field.
export const EMBED_FIELD_VALUE_MAX = 1024;

export const truncate = (s: string, max: number, suffix = '...') => (s.length > max ? s.slice(0, max - 1) + suffix : s);
