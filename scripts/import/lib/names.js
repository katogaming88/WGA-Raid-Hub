// Name handling shared by the #320 import generators.
//
// The sheets store player names three ways: Roster holds "First-Realm",
// Scoring/Attendance/Priority hold the bare first name, and BiS List headers
// hold "First-Realm (Nickname)". Matching across tabs mirrors the Apps Script
// behavior: normName (gs/wgaWebApp.gs:1999) and stripNickname (gs/Export.gs:70).

// NFD-normalize, strip combining marks, lowercase, trim.
export function normName(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

// Remove a trailing " (nickname)" from a header cell.
export function stripNickname(str) {
  return String(str || '').replace(/\s*\(.*?\)\s*$/, '');
}

// "First-Realm" -> "First". Bare names pass through unchanged.
export function firstName(nameRealm) {
  return String(nameRealm || '')
    .split('-')[0]
    .trim();
}
