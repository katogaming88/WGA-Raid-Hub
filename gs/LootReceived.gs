// ════════════════════════════════════════════════════════════════════════════
// LOOT RECEIVED CHECK — Difficulty-aware item tracking
// ════════════════════════════════════════════════════════════════════════════
//
// SETUP: Create a tab called "Loot Data" in this spreadsheet and put this
// in cell A1, replacing the URL with your Loot Distribution file's URL:
//
//   =IMPORTRANGE("YOUR_LOOT_DIST_URL", "Active Data!A:V")
//
// Click "Allow access" when prompted. That's it.
//
// Highlights the Player column (col B) in Priority Generator after a run.
// Called automatically at the end of runPriorityGenerator() — see note below.
//
// ADD TO MENU: Add this line inside your existing onOpen() function:
//   .addItem('Highlight received items', 'highlightReceivedInPriorityOrder')
// ════════════════════════════════════════════════════════════════════════════

const LOOT_SHEET_NAME = "Loot Data";

// Active Data column indices (0-based) — mirrors your Loot Distribution sheet
const LOOT_COL = {
  ITEM_ID:    4,   // Col E
  INSTANCE:   9,   // Col J  e.g. "The Voidspire-Heroic"
  MAIN_OWNER: 21,  // Col V
};

// Prefixed to avoid collision with any future consts in other files
const LOOT_DIFF_RANK = { "Normal": 1, "Heroic": 2, "Mythic": 3 };

const LOOT_DIFF_COLORS = {
  "Normal": "#FFF176",  // yellow
  "Heroic": "#FFB74D",  // orange
  "Mythic": "#EF9A9A",  // red
};

// ── Helpers ───────────────────────────────────────────────────────────────

function loadLootData(ss) {
  const sheet = ss.getSheetByName(LOOT_SHEET_NAME);
  if (!sheet) {
    SpreadsheetApp.getUi().alert(
      `Sheet "${LOOT_SHEET_NAME}" not found.\n\n` +
      `Create a tab called "${LOOT_SHEET_NAME}" and put this in A1:\n` +
      `=IMPORTRANGE("YOUR_LOOT_DIST_URL", "Active Data!A:V")`
    );
    return null;
  }
  return sheet.getDataRange().getValues();
}

// "The Voidspire-Heroic" → "Heroic"   |   returns null if unrecognised
function parseLootDifficulty(instanceStr) {
  if (!instanceStr) return null;
  const parts = String(instanceStr).trim().split("-");
  const diff  = parts[parts.length - 1].trim();
  return LOOT_DIFF_RANK[diff] ? diff : null;
}

// Returns "Mythic" / "Heroic" / "Normal" / null (never received this item)
function getHighestDiffReceived(charName, itemId, lootData) {
  if (!lootData || !charName || !itemId) return null;

  const cleanName = String(charName).trim();
  const cleanId   = String(itemId).trim();
  let   highest   = 0;

  for (let i = 1; i < lootData.length; i++) {
    const row   = lootData[i];
    const owner = String(row[LOOT_COL.MAIN_OWNER] ?? "").trim();
    const id    = String(row[LOOT_COL.ITEM_ID]    ?? "").trim();

    if (owner !== cleanName || id !== cleanId) continue;

    const diff = parseLootDifficulty(row[LOOT_COL.INSTANCE]);
    if (!diff) continue;

    const rank = LOOT_DIFF_RANK[diff];
    if (rank > highest) highest = rank;
  }

  return Object.keys(LOOT_DIFF_RANK).find(d => LOOT_DIFF_RANK[d] === highest) ?? null;
}

// ── Main function ─────────────────────────────────────────────────────────
// Highlights the Player column in Priority Generator based on loot received.
// itemId is looked up from Item Lookup using the item name in B4.
//
// Colour key:
//   Yellow = has Normal
//   Orange = has Heroic
//   Red    = has Mythic
//   White  = never received

function highlightReceivedInPriorityOrder() {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const genSheet = ss.getSheetByName(PRIO_GEN_SHEET_NAME);
  const lootData = loadLootData(ss);

  if (!genSheet || !lootData) return;

  // Get the selected item name and look up its ID
  const itemName = String(genSheet.getRange(GEN_ITEM_CELL).getValue()).trim();
  if (!itemName) return;

  const itemLookup = buildItemLookup(ss);
  const itemId     = String(itemLookup[itemName.toLowerCase()] ?? "").trim();
  if (!itemId) return;

  // Scan player rows in the generator (col B, from GEN_DATA_START down)
  const lastRow = genSheet.getLastRow();

  for (let r = GEN_DATA_START; r <= lastRow; r++) {
    const displayName = String(genSheet.getRange(r, GEN_PLAYER_COL).getValue()).trim();
    if (!displayName || displayName === '—') continue;

    // Reuses stripNickname() from Export.gs
    const charName = stripNickname(displayName);
    const diff     = getHighestDiffReceived(charName, itemId, lootData);
    const color    = diff ? LOOT_DIFF_COLORS[diff] : "#FFFFFF";

    genSheet.getRange(r, GEN_PLAYER_COL).setBackground(color);
  }
}
