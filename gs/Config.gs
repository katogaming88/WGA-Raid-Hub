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
const PLAYER_DATA_START = 4;
const PLAYER_DATA_END   = 33;


// ════════════════════════════════════════════════════════════════════════════
// WCL CONFIG
// ════════════════════════════════════════════════════════════════════════════


const GUILD_TAG_ID       = 801219;
const RECENT_REPORTS     = 2;   // "Recent" score window
const TREND_REPORTS      = 8;   // "Trend" score window
const BEST_REPORTS       = 20;  // "Best" score window (widest look-back)


const MYTHIC_DIFF = 5;
const HEROIC_DIFF = 4;
