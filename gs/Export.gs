// ════════════════════════════════════════════════════════════════════════════
// EXPORT — RCLootCouncil Priority Export
// ════════════════════════════════════════════════════════════════════════════

const SLOT_LABEL_MAP = {
  "Head":      "helm",
  "Neck":      "neck",
  "Shoulders": "shoulders",
  "Chest":     "chest",
  "Gloves":    "gloves",
  "Legs":      "legs",
  "Ring 1":    "ring1",
  "Ring 2":    "ring2",
  "Trinket 1": "trinket1",
  "Trinket 2": "trinket2",
  "1H/2H":     "mh2h",
  "1H/2H ":    "mh2h",   // trailing-space variant
  "MH/2H":     "mh2h",   // legacy variant
  "OH":        "oh",
  "Cloak":     "cloak",
  "Bracers":   "bracers",
  "Belt":      "belt",
  "Boots":     "boots",
};

function exportPriorityData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const itemLookup = buildItemLookup(ss);
  const players    = buildPlayersObject(ss, itemLookup);
  const priority   = buildPriorityObject(ss, itemLookup);

  const playerCount   = Object.keys(players).length;
  const priorityCount = Object.keys(priority).length;

  if (playerCount === 0) {
    SpreadsheetApp.getUi().alert(
      `No player data found in "${BIS_SHEET_NAME}". ` +
      "Check the sheet name and that row 3+ has item entries."
    );
    return;
  }

  const payload = JSON.stringify({ players, priority });
  const encoded = Utilities.base64Encode(payload, Utilities.Charset.UTF_8);

  const exportSheet = ss.getSheetByName("Export");
  exportSheet.getRange("A11").setValue(encoded);

  showExportDialog(encoded, playerCount, priorityCount);
}

function buildItemLookup(ss) {
  const sheet = ss.getSheetByName(LOOKUP_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${LOOKUP_SHEET_NAME}" not found.`);

  const data   = sheet.getDataRange().getValues();
  const lookup = {};

  for (let r = 2; r < data.length; r++) {
    const name = String(data[r][0]).trim();
    const id   = Number(data[r][1]);
    if (name && id > 0) lookup[name.toLowerCase()] = id;
  }

  return lookup;
}

// Strips nickname suffix: "Name-Realm (Nick)" → "Name-Realm"
function stripNickname(name) {
  return name.replace(/\s*\(.*?\)\s*$/, "").trim();
}

function buildPlayersObject(ss, itemLookup) {
  const sheet = ss.getSheetByName(BIS_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${BIS_SHEET_NAME}" not found.`);

  const data        = sheet.getDataRange().getValues();
  const headerRow   = data[1];
  const playerNames = [];

  for (let c = 1; c < headerRow.length; c++) {
    playerNames.push(stripNickname(String(headerRow[c]).trim()));
  }

  const players = {};

  for (let r = 2; r < data.length; r++) {
    const row   = data[r];
    const label = String(row[0]).trim();
    if (!label) continue;

    // Support plain slot labels ("Trinket 1") as well as ranked ("Trinket 1 - 1")
    const rankMatch = label.match(/^(.+?)\s*-\s*(\d+)$/);
    const slotLabel = rankMatch ? rankMatch[1].trim() : label;
    const slotKey   = SLOT_LABEL_MAP[slotLabel];
    if (!slotKey) continue;

    for (let c = 0; c < playerNames.length; c++) {
      const playerName = playerNames[c];
      if (!playerName) continue;

      const itemName = String(row[c + 1]).trim();
      if (!itemName) continue;

      const itemID = itemLookup[itemName.toLowerCase()];
      if (!itemID) continue;

      if (!players[playerName])          players[playerName] = {};
      if (!players[playerName][slotKey]) players[playerName][slotKey] = { bis: [] };

      players[playerName][slotKey].bis.push(itemID);
    }
  }

  return players;
}

function buildPriorityObject(ss, itemLookup) {
  const sheet = ss.getSheetByName(PRIO_SHEET_NAME);
  if (!sheet) return {};

  const data     = sheet.getDataRange().getValues();
  const priority = {};

  for (let r = PRIO_DATA_START - 1; r < data.length; r++) {
    const row      = data[r];
    const itemName = String(row[PRIO_ITEM_NAME_COL - 1]).trim();
    if (!itemName) continue;

    const itemID = itemLookup[itemName.toLowerCase()];
    if (!itemID) continue;

    const names = [];
    for (let c = PRIO_RANK_START_COL - 1; c < row.length; c++) {
      const name = stripNickname(String(row[c]).trim());
      if (name) names.push(name);
    }

    if (names.length > 0) priority[String(itemID)] = names;
  }

  return priority;
}

function showExportDialog(encoded, playerCount, priorityCount) {
  const html = `<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: Arial, sans-serif; padding: 12px; margin: 0; }
  p    { margin: 0 0 8px; font-size: 13px; }
  textarea {
    width: 100%; height: 180px; font-family: monospace; font-size: 11px;
    word-break: break-all; resize: none; box-sizing: border-box;
  }
  button {
    margin-top: 8px; padding: 6px 16px; font-size: 13px;
    cursor: pointer; background: #4a86e8; color: #fff; border: none; border-radius: 4px;
  }
  button:hover { background: #2d6acf; }
  .meta { color: #555; font-size: 12px; margin-bottom: 10px; }
</style>
</head>
<body>
  <p class="meta">
    Exported <strong>${playerCount}</strong> player(s) and
    <strong>${priorityCount}</strong> priority override(s).
  </p>
  <p>Select all and copy, then paste into the in-game <code>/rclp import</code> window.</p>
  <textarea id="out" readonly>${encoded}</textarea>
  <br>
  <button onclick="selectAll()">Select All</button>
  <script>
    function selectAll() {
      var t = document.getElementById('out');
      t.focus();
      t.select();
    }
    window.onload = selectAll;
  </script>
</body>
</html>`;

  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(640).setHeight(320),
    "RCLootCouncil Priority Export"
  );
}

function onSelectionChange(e) {
  if (e.range.getSheet().getName() !== "Export") return;
  if (e.range.getA1Notation() !== "A8:C8") return;

  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Export Priority Data',
    'Run Export priority data and update the import string?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) return;
  exportPriorityData();
}
