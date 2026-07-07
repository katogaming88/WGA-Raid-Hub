// Name handling shared by the #320 import generators.
//
// The exports store player names three ways: Roster holds "First-Realm",
// Attendance/Priority hold the bare first name, and Scoring plus the BiS List
// headers hold "First-Realm - Nickname" (older sheets used
// "First-Realm (Nickname)"; both forms are stripped). Matching across tabs
// mirrors the Apps Script behavior: normName (gs/wgaWebApp.gs:1999) and
// stripNickname (gs/Export.gs:70).

// NFD-normalize, strip combining marks, lowercase, trim.
export function normName(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

// Remove a trailing " (nickname)" or " - nickname" from a name cell. The
// dash form needs spaces on both sides, so the realm hyphen in "First-Realm"
// is never touched, and splitting on the last occurrence keeps realms with
// spaces ("Fxd-Area 52 - FX" -> "Fxd-Area 52") intact.
export function stripNickname(str) {
  const s = String(str || '').replace(/\s*\(.*?\)\s*$/, '');
  const idx = s.lastIndexOf(' - ');
  return idx === -1 ? s : s.slice(0, idx);
}

// "First-Realm" -> "First". Bare names pass through unchanged.
export function firstName(nameRealm) {
  return String(nameRealm || '')
    .split('-')[0]
    .trim();
}
