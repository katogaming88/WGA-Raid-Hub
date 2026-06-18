// ════════════════════════════════════════════════════════════════════════════
// PRIORITY GENERATOR
// ════════════════════════════════════════════════════════════════════════════

const PRIO_GEN_SHEET_NAME  = 'Priority Generator';
const ROSTER_SHEET_NAME    = 'Roster';
const ROSTER_HAS_PRIO_COL  = 1;   // Column A — Has 1st Prio checkbox
const ROSTER_PLAYER_COL    = 2;   // Column B — Player (Name-Realm)
const ROSTER_ROLE_COL      = 4;   // Column D — Role
const ROSTER_TRIAL_COL     = 5;   // Column E — Trial checkbox
const ROSTER_SORT_KEY_COL  = 6;   // Column F — Sort Key
const ROSTER_DATA_START    = 2;   // Row 2 onwards (row 1 = header)
const UPGRADE_SHEET_NAME   = 'Upgrade Values';

const ROLE_SCORE_MULTIPLIERS = {
  'tank':   0.50,
  'heal':   0.75,
  'ranged': 1.0,
  'melee':  1.0,
};

const BENCH_MULTIPLIER = 0.45;
const TRIAL_MULTIPLIER = 0.85;
const BENCH_ROLE_MULTIPLIER = 0.65;  // stacked on top of role multiplier
const TRIAL_ROLE_MULTIPLIER = 0.80;  // stacked on top of role multiplier

// Output columns on Priority Generator tab
const GEN_RANK_COL     = 1;   // A
const GEN_PLAYER_COL   = 2;   // B
const GEN_WEIGHTED_COL = 3;   // C
const GEN_UPGRADE_COL  = 4;   // D
const GEN_BLENDED_COL  = 5;   // E
const GEN_NOTE_COL     = 6;   // F
const GEN_DATA_START   = 7;   // Row 7 — first data row
const GEN_ITEM_CELL    = 'B4';

// ── Strip nickname from full name ─────────────────────────────────────────
// "Hinda-Thrall - Roth" → "Hinda-Thrall"
function stripNickname(name) {
  const parts = name.split(' - ');
  return parts.length > 1 ? parts.slice(0, -1).join(' - ').trim() : name.trim();
}

function runPriorityGenerator() {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const genSheet = ss.getSheetByName(PRIO_GEN_SHEET_NAME);

  if (!genSheet) {
    SpreadsheetApp.getUi().alert(`Sheet "${PRIO_GEN_SHEET_NAME}" not found.`);
    return;
  }

  const itemName = String(genSheet.getRange(GEN_ITEM_CELL).getValue()).trim();
  if (!itemName) {
    SpreadsheetApp.getUi().alert('No item selected. Pick an item from the dropdown in B4 first.');
    return;
  }

  // ── Load data ─────────────────────────────────────────────────────────────

  const bisPlayers = getBiSPlayersForItem(ss, itemName);
  const scoringMap = getScoringMap(ss);
  const upgradeMap = getUpgradeMap(ss, itemName);
  const hasPrioSet = getHasPrioSet(ss);
  const benchSet   = getBenchSet(ss);
  const trialSet   = getTrialSet(ss);

  if (bisPlayers.length === 0) {
    SpreadsheetApp.getUi().alert(`No players have "${itemName}" in their BiS list.`);
    return;
  }

  // ── Build candidate rows ──────────────────────────────────────────────────

  const eligible    = [];
  const zeroUpgrade = [];
  const hasPrio     = [];

  for (const player of bisPlayers) {
    const baseName   = stripNickname(player);
    const scoreData  = scoringMap[player] ?? null;
    const upgradeVal = upgradeMap[player] ?? null;
    const isBench    = benchSet.has(baseName);
    const isTrial    = trialSet.has(baseName);
    const isHasPrio  = hasPrioSet.has(baseName);

    // Raw values from scoring map
    const rawScore   = scoreData?.rawScore ?? null;
    const roleMulti  = scoreData?.multiplier ?? 1.0;
    const role       = scoreData?.role ?? '';

    // Calculate final adjusted score based on bench/trial status
    let finalMultiplier = roleMulti;
    let statusLabel     = '';

    if (isBench && (role === 'tank' || role === 'heal')) {
      finalMultiplier = roleMulti * BENCH_ROLE_MULTIPLIER;
      statusLabel     = 'Bench';
    } else if (isTrial && (role === 'tank' || role === 'heal')) {
      finalMultiplier = roleMulti * TRIAL_ROLE_MULTIPLIER;
      statusLabel     = 'Trial';
    } else if (isBench) {
      finalMultiplier = BENCH_MULTIPLIER;
      statusLabel     = 'Bench';
    } else if (isTrial) {
      finalMultiplier = TRIAL_MULTIPLIER;
      statusLabel     = 'Trial';
    }

    const weightedTotal = rawScore !== null
      ? Math.round(rawScore * finalMultiplier * 10) / 10
      : null;

    const row = {
      player,
      weightedTotal,
      rawScore,
      roleMultiplier:  roleMulti,
      finalMultiplier,
      role,
      statusLabel,
      upgradeVal,
      sortScore: weightedTotal !== null ? weightedTotal : -1,
      hasPrio:   isHasPrio,
    };

    if (row.hasPrio) {
      hasPrio.push(row);
    } else if (upgradeVal !== null && upgradeVal === 0) {
      zeroUpgrade.push(row);
    } else {
      eligible.push(row);
    }
  }

  // Sort eligible by adjusted score descending
  const sortDesc = (a, b) => b.sortScore - a.sortScore;
  eligible.sort(sortDesc);
  zeroUpgrade.sort(sortDesc);
  hasPrio.sort(sortDesc);

  const allHavePrio = eligible.length === 0 && zeroUpgrade.length === 0 && hasPrio.length > 0;

  // ── Clear previous output ─────────────────────────────────────────────────

  const lastRow    = Math.max(genSheet.getLastRow(), GEN_DATA_START + 50);
  const clearRange = genSheet.getRange(GEN_DATA_START, GEN_RANK_COL, lastRow - GEN_DATA_START + 1, 6);
  clearRange.breakApart();
  clearRange.clearContent()
    .setBackground(null)
    .setFontColor(null)
    .setFontStyle('normal')
    .setFontWeight('normal')
    .setHorizontalAlignment('left')
    .setVerticalAlignment('middle')
    .setFontSize(10);

  // ── Write header row ──────────────────────────────────────────────────────

  const headerRange = genSheet.getRange(6, GEN_RANK_COL, 1, 6);
  headerRange.setValues([['Rank', 'Player', 'Weighted Total', 'Upgrade %', 'Notes', '']]);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#1A1A1A');
  headerRange.setFontColor('#FFFFFF');

  // ── Write eligible players ────────────────────────────────────────────────

  let currentRow = GEN_DATA_START;
  let rank       = 1;

  for (const p of eligible) {
    const note = buildNote(p);
    writeGeneratorRow(genSheet, currentRow, rank, p, false, note);
    rank++;
    currentRow++;
  }

  // ── Write zero-upgrade players (greyed out) ───────────────────────────────

  if (zeroUpgrade.length > 0) {
    for (const p of zeroUpgrade) {
      writeGeneratorRow(genSheet, currentRow, null, p, true, 'Does not need / already has item');
      currentRow++;
    }
  }

  // ── Write has-prio players (greyed out) ───────────────────────────────────

  if (allHavePrio) {
    const warnRange = genSheet.getRange(currentRow, GEN_RANK_COL, 1, 6);
    warnRange.merge();
    warnRange.setValue('⚠  All players already hold a 1st priority — review manually before setting priority order.');
    warnRange.setBackground('#FFF2CC');
    warnRange.setFontColor('#7F6000');
    warnRange.setFontWeight('bold');
    warnRange.setFontStyle('italic');
    warnRange.setWrap(true);
    genSheet.setRowHeight(currentRow, 36);
    currentRow++;
  }

  for (const p of hasPrio) {
    writeGeneratorRow(genSheet, currentRow, null, p, true, 'Already has 1st priority');
    currentRow++;
  }

  // ── Footer note ───────────────────────────────────────────────────────────

  currentRow++;
  const footerRange = genSheet.getRange(currentRow, GEN_RANK_COL, 1, 6);
  footerRange.merge();
  footerRange.setValue('Players ranked by Weighted Total score. Upgrade % is shown for reference only. Enter 0 in Upgrade Values to mark a player as not needing the item — they will be greyed out at the bottom.');
  footerRange.setFontSize(9);
  footerRange.setFontStyle('italic');
  footerRange.setFontColor('#888880');
  footerRange.setWrap(true);
  genSheet.setRowHeight(currentRow, 36);

  // ── Highlight loot received ───────────────────────────────────────────────

  highlightReceivedInPriorityOrder();

  const benchCount = eligible.filter(p => p.statusLabel === 'Bench').length;
  const trialCount = eligible.filter(p => p.statusLabel === 'Trial').length;
  const mainCount  = eligible.length - benchCount - trialCount;

  SpreadsheetApp.getUi().alert(
    `✅ Priority Generator updated for "${itemName}".\n\n` +
    `${mainCount} main roster player(s) ranked.\n` +
    (trialCount > 0     ? `${trialCount} trial player(s) ranked.\n` : '') +
    (benchCount > 0     ? `${benchCount} bench player(s) ranked.\n` : '') +
    (zeroUpgrade.length > 0 ? `${zeroUpgrade.length} player(s) greyed out — marked as not needing item.\n` : '') +
    (hasPrio.length > 0     ? `${hasPrio.length} player(s) greyed out — already hold 1st priority.\n` : '') +
    (allHavePrio            ? '\n⚠ All players already hold 1st priority — manual review needed.' : '')
  );
}

// ── Note builder ──────────────────────────────────────────────────────────

function buildNote(p) {
  if (!p.rawScore) return '';

  const raw     = p.rawScore;
  const result  = p.weightedTotal;
  const role    = p.role;
  const status  = p.statusLabel;
  const isRole  = role === 'tank' || role === 'heal';
  const roleLabel   = role === 'tank' ? 'Tank' : role === 'heal' ? 'Heal' : null;
  const statusLabel = status === 'Bench' ? 'Bench' : status === 'Trial' ? 'Trial' : null;

  // Main roster DPS — no note
  if (!roleLabel && !statusLabel) return '';

  // Build the multiplier chain
  const parts = [];
  if (statusLabel) parts.push(statusLabel);
  if (roleLabel)   parts.push(roleLabel);

  return raw + ' × ' + parts.join(' × ') + ' = ' + result;
}

// ── Row writer ────────────────────────────────────────────────────────────

function writeGeneratorRow(sheet, row, rank, p, greyed, note) {
  const bg        = greyed ? '#EEEEEE' : (row % 2 === 0 ? '#F8F7F4' : '#FFFFFF');
  const fontColor = greyed ? '#AAAAAA' : '#3A3A38';

  const values = [
    rank !== null ? rank : '—',
    p.player,
    p.weightedTotal !== null ? p.weightedTotal : '—',
    p.upgradeVal !== null && p.upgradeVal > 0 ? p.upgradeVal : '—',
    note,
    '',
  ];

  const range = sheet.getRange(row, GEN_RANK_COL, 1, 6);
  range.setValues([values]);
  range.setBackground(bg);
  range.setFontColor(fontColor);
  range.setHorizontalAlignment('left');
  range.setVerticalAlignment('middle');
  range.setFontSize(10);
  range.setFontStyle(greyed ? 'italic' : 'normal');
  range.setFontWeight('normal');

  sheet.setRowHeight(row, 22);
}

// ── Data helpers ──────────────────────────────────────────────────────────

function getBiSPlayersForItem(ss, itemName) {
  const sheet = ss.getSheetByName(BIS_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${BIS_SHEET_NAME}" not found.`);

  const data      = sheet.getDataRange().getValues();
  const headerRow = data[1];
  const key       = itemName.trim().toLowerCase();
  const found     = new Set();

  for (let r = 2; r < data.length; r++) {
    for (let c = 1; c < data[r].length; c++) {
      if (String(data[r][c]).trim().toLowerCase() === key) {
        const player = String(headerRow[c]).trim();
        if (player) found.add(player);
      }
    }
  }

  return Array.from(found).filter(p => p.length > 0);
}

function getScoringMap(ss) {
  const sheet = ss.getSheetByName(SCORING_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${SCORING_SHEET_NAME}" not found.`);

  const rosterSheet = ss.getSheetByName(ROSTER_SHEET_NAME);
  const roleMap = {};
  if (rosterSheet) {
    const rosterData = rosterSheet.getDataRange().getValues();
    for (let r = ROSTER_DATA_START - 1; r < rosterData.length; r++) {
      const player = String(rosterData[r][ROSTER_PLAYER_COL - 1]).trim();
      const role   = String(rosterData[r][ROSTER_ROLE_COL - 1]).trim().toLowerCase();
      if (player) roleMap[player] = role;
    }
  }

  const data = sheet.getDataRange().getValues();
  const map  = {};

  for (let r = PLAYER_DATA_START - 1; r < data.length; r++) {
    const fullName = String(data[r][PLAYER_COL - 1]).trim();
    const baseName = stripNickname(fullName);
    const score    = data[r][4];

    if (fullName && typeof score === 'number' && score > 0) {
      const role       = roleMap[baseName] ?? '';
      const multiplier = ROLE_SCORE_MULTIPLIERS[role] ?? 1.0;
      map[fullName] = {
        score:      Math.round(score * multiplier * 10) / 10,
        rawScore:   Math.round(score * 10) / 10,
        multiplier: multiplier,
        role:       role,
      };
    }
  }

  return map;
}

function getUpgradeMap(ss, itemName) {
  const sheet = ss.getSheetByName(UPGRADE_SHEET_NAME);
  if (!sheet) return {};

  const data      = sheet.getDataRange().getValues();
  const key       = itemName.trim().toLowerCase();
  const map       = {};
  const headerRow = data[2];

  for (let r = 3; r < data.length; r++) {
    const rowItem = String(data[r][0]).trim().toLowerCase();
    if (rowItem !== key) continue;

    for (let c = 2; c < headerRow.length; c++) {
      const player = String(headerRow[c]).trim();
      const val    = data[r][c];
      if (player && typeof val === 'number') {
        map[player] = val;
      }
    }
    break;
  }

  return map;
}

function getHasPrioSet(ss) {
  const sheet = ss.getSheetByName(ROSTER_SHEET_NAME);
  if (!sheet) return new Set();

  const data = sheet.getDataRange().getValues();
  const set  = new Set();

  for (let r = ROSTER_DATA_START - 1; r < data.length; r++) {
    const checked = data[r][ROSTER_HAS_PRIO_COL - 1];
    const player  = String(data[r][ROSTER_PLAYER_COL - 1]).trim();
    if (checked === true && player) {
      set.add(player);
    }
  }

  return set;
}

function getBenchSet(ss) {
  const sheet = ss.getSheetByName(ROSTER_SHEET_NAME);
  if (!sheet) return new Set();

  const data = sheet.getDataRange().getValues();
  const set  = new Set();

  for (let r = ROSTER_DATA_START - 1; r < data.length; r++) {
    const player  = String(data[r][ROSTER_PLAYER_COL - 1]).trim();
    const sortKey = data[r][ROSTER_SORT_KEY_COL - 1];
    if (player && String(sortKey).startsWith('6')) {
      set.add(player);
    }
  }

  return set;
}

function getTrialSet(ss) {
  const sheet = ss.getSheetByName(ROSTER_SHEET_NAME);
  if (!sheet) return new Set();

  const data = sheet.getDataRange().getValues();
  const set  = new Set();

  for (let r = ROSTER_DATA_START - 1; r < data.length; r++) {
    const checked = data[r][ROSTER_TRIAL_COL - 1];
    const player  = String(data[r][ROSTER_PLAYER_COL - 1]).trim();
    if (checked === true && player) {
      set.add(player);
    }
  }

  return set;
}

// ── Debug helpers ─────────────────────────────────────────────────────────

function debugUpgradeMap() {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const genSheet = ss.getSheetByName(PRIO_GEN_SHEET_NAME);
  const itemName = String(genSheet.getRange(GEN_ITEM_CELL).getValue()).trim();
  const map      = getUpgradeMap(ss, itemName);

  const lines = Object.entries(map).map(([k, v]) => `${k}: ${v} (type: ${typeof v})`);
  SpreadsheetApp.getUi().alert(
    `Upgrade map for "${itemName}":\n\n` +
    (lines.length > 0 ? lines.join('\n') : 'Empty — no players found')
  );
}

function debugRoleMap() {
  const ss          = SpreadsheetApp.getActiveSpreadsheet();
  const rosterSheet = ss.getSheetByName(ROSTER_SHEET_NAME);
  const data        = rosterSheet.getDataRange().getValues();

  const lines = [];
  for (let r = ROSTER_DATA_START - 1; r < data.length; r++) {
    const player = String(data[r][ROSTER_PLAYER_COL - 1]).trim();
    const role   = String(data[r][ROSTER_ROLE_COL - 1]).trim();
    if (player) lines.push(`"${player}" → role: "${role}"`);
  }

  SpreadsheetApp.getUi().alert(lines.join('\n'));
}

function debugBenchSet() {
  const ss          = SpreadsheetApp.getActiveSpreadsheet();
  const rosterSheet = ss.getSheetByName(ROSTER_SHEET_NAME);
  const data        = rosterSheet.getDataRange().getValues();

  const lines = [];
  for (let r = ROSTER_DATA_START - 1; r < data.length; r++) {
    const player  = String(data[r][ROSTER_PLAYER_COL - 1]).trim();
    const sortKey = data[r][ROSTER_SORT_KEY_COL - 1];
    if (player) lines.push(`"${player}" → sortKey: "${sortKey}" (type: ${typeof sortKey})`);
  }

  SpreadsheetApp.getUi().alert(lines.join('\n'));
}
