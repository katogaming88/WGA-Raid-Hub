// ════════════════════════════════════════════════════════════════════════════
// SHARED CONFIG
// ════════════════════════════════════════════════════════════════════════════

const BIS_SHEET_NAME     = "BiS List";
const PRIO_SHEET_NAME    = "Priority Order";
const LOOKUP_SHEET_NAME  = "Item Lookup";
const SCORING_SHEET_NAME = "Scoring";

const PRIO_HEADER_ROW     = 2;
const PRIO_DATA_START     = 3;
const PRIO_ITEM_NAME_COL  = 2;
const PRIO_RANK_START_COL = 3;
const PRIO_RANK_END_COL   = 12 // Column L = 10th place

const PLAYER_COL        = 1;
const DRAFT_SCORE_COL   = 10;  // Column J — Recent Score (last 2 reports)
const TREND_SCORE_COL   = 11;  // Column K — Trend Score (last 8 reports)
const PERF_COL          = 3;   // Column C — Performance
const ATTENDANCE_COL    = 4;   // Column D — Attendance score (0-10 weighted)
const ATTEND_PCT_COL    = 5;   // Column E — Attendance % (matches webapp display)
const PLAYER_DATA_START = 4;  // First data row in Scoring sheet (rows 1-3 are headers)


// ════════════════════════════════════════════════════════════════════════════
// ROSTER HELPERS  (shared by Attendance.gs and WCL.gs)
// ════════════════════════════════════════════════════════════════════════════

// Returns all active roster members read from the Roster sheet.
// Each entry: { firstName, isBench }
function getRosterPlayers() {
  const ss          = SpreadsheetApp.getActiveSpreadsheet();
  const rosterSheet = ss.getSheetByName(ROSTER_SHEET_NAME);
  if (!rosterSheet) throw new Error('Roster sheet not found.');

  const lastRow = rosterSheet.getLastRow();
  const players = [];

  if (lastRow >= CFG.rosterDataStart) {
    const numCols = CFG.rosterPriorityCol - CFG.rosterPlayerCol + 1;
    const data    = rosterSheet.getRange(
      CFG.rosterDataStart, CFG.rosterPlayerCol,
      lastRow - CFG.rosterDataStart + 1, numCols
    ).getValues();

    for (const row of data) {
      const fullName = String(row[0] || '').trim();
      if (!fullName) continue;
      const priority = Number(row[CFG.rosterPriorityCol - CFG.rosterPlayerCol] || 0);
      players.push({ firstName: fullName.split('-')[0], isBench: priority === 6 });
    }
  }

  return players;
}

// Finds a player's row number in the Scoring sheet by matching firstName in col A.
// Returns the 1-based row number, or -1 if not found.
function findScoringRow(sheet, firstName) {
  const lastRow = sheet.getLastRow();
  if (lastRow < PLAYER_DATA_START) return -1;
  const values = sheet.getRange(PLAYER_DATA_START, PLAYER_COL, lastRow - PLAYER_DATA_START + 1, 1).getValues();
  const target = firstName.toLowerCase();
  for (let i = 0; i < values.length; i++) {
    const name = String(values[i][0] || '').split('-')[0].trim().toLowerCase();
    if (name === target) return PLAYER_DATA_START + i;
  }
  return -1;
}


// ════════════════════════════════════════════════════════════════════════════
// WCL CONFIG
// ════════════════════════════════════════════════════════════════════════════


const GUILD_TAG_ID       = 801219;
const RECENT_REPORTS     = 2;   // "Recent" score window
const TREND_REPORTS      = 8;   // "Trend" score window
const BEST_REPORTS       = 20;  // "Best" score window (widest look-back)


const MYTHIC_DIFF = 5;
const HEROIC_DIFF = 4;
