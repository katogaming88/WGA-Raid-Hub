// ════════════════════════════════════════════════════════════════════════════
// DROPDOWNS — Priority Order + BiS List slot filtering
// ════════════════════════════════════════════════════════════════════════════

const BIS_SLOT_TO_LOOKUP = {
  "Head":      "Head",
  "Neck":      "Neck",
  "Shoulders": "Shoulders",
  "Chest":     "Chest",
  "Gloves":    "Gloves",
  "Legs":      "Legs",
  "Ring 1":    "Ring",
  "Ring 2":    "Ring",
  "Trinket 1": "Trinket",
  "Trinket 2": "Trinket",
  "1H/2H":     "1H/2H",
  "OH":        "OH",
  "Cloak":     "Cloak",
  "Bracers":   "Bracers",
  "Belt":      "Belt",
  "Boots":     "Boots",
};

// ── Priority Order dropdowns ──────────────────────────────────────────────

function buildBisMap(ss) {
  const sheet = ss.getSheetByName(BIS_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${BIS_SHEET_NAME}" not found.`);

  const data      = sheet.getDataRange().getValues();
  const headerRow = data[1];

  const players = [];
  for (let c = 1; c < headerRow.length; c++) {
    const name = String(headerRow[c]).trim();
    if (name) players.push({ col: c, name });
  }

  const bisMap = {};

  for (let r = 2; r < data.length; r++) {
    const row = data[r];
    for (const { col, name: player } of players) {
      const cell = String(row[col]).trim();
      if (!cell || cell === "undefined") continue;
      const key = cell.toLowerCase();
      if (!bisMap[key]) bisMap[key] = new Set();
      bisMap[key].add(player);
    }
  }

  return bisMap;
}

function getEligiblePlayers(itemName, bisMap) {
  if (!itemName) return [];
  const key   = String(itemName).trim().toLowerCase();
  const found = bisMap[key];
  return found ? Array.from(found).sort() : [];
}

function applyDropdownsToRow(prioSheet, rowIndex, eligiblePlayers) {
  if (eligiblePlayers.length === 0) {
    for (let c = PRIO_RANK_START_COL; c <= PRIO_RANK_END_COL; c++) {
      prioSheet.getRange(rowIndex, c).clearDataValidations().clearContent();
    }
    SpreadsheetApp.getUi().alert(
      "No players have this item in their BiS List yet.\n" +
      "Fill in the BiS List sheet first, then re-run."
    );
    return;
  }

  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["", ...eligiblePlayers], true)
    .setAllowInvalid(false)
    .build();

  for (let c = PRIO_RANK_START_COL; c <= PRIO_RANK_END_COL; c++) {
    const cell     = prioSheet.getRange(rowIndex, c);
    const existing = String(cell.getValue()).trim();
    if (existing && !eligiblePlayers.includes(existing)) cell.clearContent();
    cell.setDataValidation(rule);
  }
}

function fillDropdownsForSelectedRow() {
  const ss          = SpreadsheetApp.getActiveSpreadsheet();
  const prioSheet   = ss.getSheetByName(PRIO_SHEET_NAME);
  const activeSheet = ss.getActiveSheet();

  if (!prioSheet) {
    SpreadsheetApp.getUi().alert(`Sheet "${PRIO_SHEET_NAME}" not found.`);
    return;
  }
  if (activeSheet.getName() !== PRIO_SHEET_NAME) {
    SpreadsheetApp.getUi().alert(`Please click a cell in the "${PRIO_SHEET_NAME}" sheet first.`);
    return;
  }

  const row = ss.getActiveRange().getRow();
  if (row < PRIO_DATA_START) {
    SpreadsheetApp.getUi().alert(`Please click on an item row (row ${PRIO_DATA_START} or below).`);
    return;
  }

  const itemName = String(prioSheet.getRange(row, PRIO_ITEM_NAME_COL).getValue()).trim();
  if (!itemName) {
    SpreadsheetApp.getUi().alert(`No item name found in column B of row ${row}.`);
    return;
  }

  const bisMap          = buildBisMap(ss);
  const eligiblePlayers = getEligiblePlayers(itemName, bisMap);

  applyDropdownsToRow(prioSheet, row, eligiblePlayers);

  if (eligiblePlayers.length > 0) {
    SpreadsheetApp.getUi().alert(
      `✓ Dropdowns set for "${itemName}".\n` +
      `${eligiblePlayers.length} eligible player(s): ${eligiblePlayers.join(", ")}`
    );
  }
}

function fillAllPriorityDropdowns() {
  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const prioSheet = ss.getSheetByName(PRIO_SHEET_NAME);

  if (!prioSheet) {
    SpreadsheetApp.getUi().alert(`Sheet "${PRIO_SHEET_NAME}" not found.`);
    return;
  }

  const bisMap  = buildBisMap(ss);
  const data    = prioSheet.getDataRange().getValues();
  let   updated = 0;
  let   skipped = 0;

  for (let r = PRIO_DATA_START - 1; r < data.length; r++) {
    const itemName = String(data[r][PRIO_ITEM_NAME_COL - 1]).trim();
    if (!itemName) { skipped++; continue; }

    const eligible = getEligiblePlayers(itemName, bisMap);
    applyDropdownsToRow(prioSheet, r + 1, eligible);
    updated++;
  }

  SpreadsheetApp.getUi().alert(
    `✓ Done!\nUpdated dropdowns for ${updated} item row(s).\nSkipped ${skipped} empty row(s).`
  );
}

// ── BiS List slot dropdowns ───────────────────────────────────────────────

function setBiSDropdowns() {
  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const bisSheet  = ss.getSheetByName(BIS_SHEET_NAME);
  const itemSheet = ss.getSheetByName(LOOKUP_SHEET_NAME);

  if (!bisSheet || !itemSheet) {
    SpreadsheetApp.getUi().alert(`Could not find "${BIS_SHEET_NAME}" or "${LOOKUP_SHEET_NAME}". Check sheet names.`);
    return;
  }

  const itemData    = itemSheet.getDataRange().getValues();
  const itemsBySlot = {};

  for (let r = 2; r < itemData.length; r++) {
    const name = String(itemData[r][0]).trim();
    const slot = String(itemData[r][2]).trim();
    if (!name || !slot || name === 'Item Name') continue;
    if (!itemsBySlot[slot]) itemsBySlot[slot] = [];
    itemsBySlot[slot].push(name);
  }

  for (const slot in itemsBySlot) {
    itemsBySlot[slot].sort();
  }

  const bisData    = bisSheet.getDataRange().getValues();
  const lastCol    = bisSheet.getLastColumn();
  let   rowsSet    = 0;
  let   rowsMissed = 0;

  for (let r = 2; r < bisData.length; r++) {
    const label = String(bisData[r][0]).trim();
    if (!label) continue;

    const lookupKey = BIS_SLOT_TO_LOOKUP[label];
    if (!lookupKey) continue;

    const catalystSlots = new Set(["Cloak", "Bracers", "Belt", "Boots"]);
    const items = [...(itemsBySlot[lookupKey] || []), "Crafted", "M+", ...(catalystSlots.has(lookupKey) ? ["Catalyst"] : [])];
    if (items.length === 1) {
      rowsMissed++;
    }

    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(["", ...items], true)
      .setAllowInvalid(false)
      .build();

    bisSheet.getRange(r + 1, 2, 1, lastCol - 1).setDataValidation(rule);
    rowsSet++;
  }

  SpreadsheetApp.getUi().alert(
    `✅ Done!\n` +
    `${rowsSet} slot row(s) updated with filtered dropdowns.\n` +
    (rowsMissed > 0 ? `${rowsMissed} row(s) skipped (no matching items found).` : '')
  );
}
