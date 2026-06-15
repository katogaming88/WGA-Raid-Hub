// ════════════════════════════════════════════════════════════════════════════
// Phoenix Loot Priority — Roster Web App
// ════════════════════════════════════════════════════════════════════════════

const CFG = {
  // ── Roster tab ────────────────────────────────────────────────────────
  rosterSheet:       'Roster',
  rosterTrialCol:    2,   // B — Is Trial
  rosterPlayerCol:   4,   // D — Player (Name-Realm)
  rosterNickCol:     5,   // E — Nickname
  rosterClassCol:    6,   // F — Class
  rosterSpecCol:     7,   // G — Spec
  rosterRoleCol:     8,   // H — Role
  rosterBisLinkCol:  9,   // I — BiS Link
  rosterSortKeyCol:  10,  // J - Sort Key (auto)
  rosterPriorityCol: 11,  // K - Priority (1=RL,2=Officer,3=Tank,4=Heal,5=DPS,6=Bench)
  rosterDataStart:   4,   // First data row (rows 1-3 are title/subtitle/header)

  // ── Scoring tab ──────────────────────────────────────────────────────
  scoringSheet:      'Scoring',
  scoringPlayerCol:  1,   // A — Player (Name-Realm)
  scoringAttendCol:  4,   // D — Attendance (1-10)
  scoringDataStart:  4,   // First data row

  // ── BiS List tab ──────────────────────────────────────────────────────
  bisSheet:          'BiS List',
  bisSlotCol:        1,
  bisPlayerStartCol: 2,
  bisHeaderRow:      2,
  bisDataStart:      3,

  // ── Priority Order tab ────────────────────────────────────────────────
  prioritySheet:     'Priority Order',
  priorityItemCol:   2,
  priorityRankStart: 3,
  priorityDataStart: 2,

  // ── Item Lookup tab ───────────────────────────────────────────────────
  itemLookupSheet:   'Item Lookup',
  itemNameCol:       1,
  itemSlotCol:       3,
  itemDataStart:     2,

  // ── Roster Responses tab ─────────────────────────────────────────
  responsesSheet:    'Roster Responses',

  // ── Self Received Requests tab ────────────────────────────────────
  selfReceivedSheet: 'Self Received Requests',

  // ── BiS Responses tab ────────────────────────────────────────────────
  bisResponsesSheet: 'BiS Responses',

  // ── Loot Sheet ───────────────────────────────────────────────────
  lootSheet:         'Loot Data',
  lootPlayerCol:     1,  // A - Player (Name-Realm)
  lootDateCol:       2,  // B - Date
  lootInstanceCol:   10, // J - Instance (e.g. "The Voidspire-Heroic")
  lootDataStart:     2,  // First Data row (row 1 = headers)

  // ── Attendance Sheet ───────────────────────────────────────────────────
  attendanceSheet:  'Attendance',
  attendNameCol:    2,  // B - Player First Name
  attendStatusCol:  3,  // C - Status
  attendDateCol:    1,  // A - Raid Date
  attendDataStart:  2,  // First data row
};

function doGet(e) {
  try {
    const cache    = CacheService.getScriptCache();
    const props    = PropertiesService.getScriptProperties();
    const action   = e && e.parameter && e.parameter.action;
    const callback = e && e.parameter && e.parameter.callback;

    if (action === 'clearCache') {
      cache.remove('rosterPayload');
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'setSignupsOpen') {
      const open = e.parameter.value === 'true';
      props.setProperty('signupsOpen', open ? 'true' : 'false');
      cache.remove('rosterPayload');
      return jsonpResponse(callback, { success: true, signupsOpen: open });
    }

    if (action === 'setBisSubmissionsOpen') {
      const open = e.parameter.value === 'true';
      props.setProperty('bisSubmissionsOpen', open ? 'true' : 'false');
      cache.remove('rosterPayload');
      return jsonpResponse(callback, { success: true, bisSubmissionsOpen: open });
    }

    if (action === 'submitSignup') {
      const data = JSON.parse(decodeURIComponent(e.parameter.data || '{}'));
      writeSignup(data);
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'getSignups') {
      return jsonpResponse(callback, { signups: getSignupResponses() });
    }

    if (action === 'requestSelfReceived') {
      const data = JSON.parse(decodeURIComponent(e.parameter.data || '{}'));
      // TODO(auth): once Discord OAuth ships, bypass officer approval for verified players:
      //   if (isPlayerVerified(data.player)) { approveSelfReceivedDirect(data); cache.remove('rosterPayload'); return jsonpResponse(callback, { success: true }); }
      writeSelfReceivedRequest(data);
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'getPendingRequests') {
      return jsonpResponse(callback, { requests: getSelfReceivedRequests('Pending') });
    }

    if (action === 'approveRequest') {
      const row = parseInt(e.parameter.row, 10);
      if (isNaN(row) || row < 2) return jsonpResponse(callback, { error: 'Invalid row' });
      updateRequestStatus(row, 'Approved');
      cache.remove('rosterPayload');
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'rejectRequest') {
      const row = parseInt(e.parameter.row, 10);
      if (isNaN(row) || row < 2) return jsonpResponse(callback, { error: 'Invalid row' });
      updateRequestStatus(row, 'Rejected');
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'submitBiS') {
      const data = JSON.parse(decodeURIComponent(e.parameter.data || '{}'));
      writeBiSSubmission(data);
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'getPendingBiS') {
      return jsonpResponse(callback, { submissions: getBiSSubmissions('Pending') });
    }

    if (action === 'approveBiS') {
      const data      = JSON.parse(decodeURIComponent(e.parameter.data || '{}'));
      const row       = parseInt(data.row, 10);
      const nameRealm = String(data.nameRealm || '');
      const url       = String(data.url || '');
      if (isNaN(row) || row < 2) return jsonpResponse(callback, { error: 'Invalid row' });
      updateBisLinkInRoster(nameRealm, url);
      updateBiSStatus(row, 'Approved');
      cache.remove('rosterPayload');
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'rejectBiS') {
      const row = parseInt(e.parameter.row, 10);
      if (isNaN(row) || row < 2) return jsonpResponse(callback, { error: 'Invalid row' });
      updateBiSStatus(row, 'Rejected');
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'allowBisForPlayer') {
      const data      = JSON.parse(decodeURIComponent(e.parameter.data || '{}'));
      const nameRealm = String(data.nameRealm || '');
      const allowed   = getBisAllowedPlayers();
      if (nameRealm && allowed.indexOf(nameRealm) === -1) {
        allowed.push(nameRealm);
        setBisAllowedPlayers(allowed);
      }
      cache.remove('rosterPayload');
      return jsonpResponse(callback, { success: true, bisAllowedPlayers: allowed });
    }

    if (action === 'revokeBisForPlayer') {
      const data      = JSON.parse(decodeURIComponent(e.parameter.data || '{}'));
      const nameRealm = String(data.nameRealm || '');
      const allowed   = getBisAllowedPlayers().filter(function(n) { return n !== nameRealm; });
      setBisAllowedPlayers(allowed);
      cache.remove('rosterPayload');
      return jsonpResponse(callback, { success: true, bisAllowedPlayers: allowed });
    }

    if (action === 'updateBisLink') {
      const data      = JSON.parse(decodeURIComponent(e.parameter.data || '{}'));
      const nameRealm = String(data.nameRealm || '');
      const url       = String(data.url || '');
      updateBisLinkInRoster(nameRealm, url);
      cache.remove('rosterPayload');
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'updatePlayerField') {
      const data      = JSON.parse(decodeURIComponent(e.parameter.data || '{}'));
      const nameRealm = String(data.nameRealm || '');
      const field     = String(data.field     || '');
      const value     = data.value;
      if (!nameRealm || !field) return jsonpResponse(callback, { error: 'Missing params' });
      updateRosterField(nameRealm, field, value);
      cache.remove('rosterPayload');
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'savePlayerNote') {
      const data      = JSON.parse(decodeURIComponent(e.parameter.data || '{}'));
      const nameRealm = String(data.nameRealm || '');
      const note      = String(data.note      || '');
      if (!nameRealm) return jsonpResponse(callback, { error: 'Missing nameRealm' });
      const notes = getPlayerNotes();
      if (note) { notes[nameRealm] = note; } else { delete notes[nameRealm]; }
      setPlayerNotes(notes);
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'deleteSignup') {
      const row = parseInt(e.parameter.row, 10);
      if (isNaN(row) || row < 2) return jsonpResponse(callback, { error: 'Invalid row' });
      const ss    = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(CFG.responsesSheet);
      if (!sheet) return jsonpResponse(callback, { error: 'Sheet not found' });
      sheet.deleteRow(row);
      return jsonpResponse(callback, { success: true });
    }

    const cached = cache.get('rosterPayload');
    const json   = cached || (() => {
      const fresh = JSON.stringify(buildPayload());
      cache.put('rosterPayload', fresh, 300);
      return fresh;
    })();

    if (callback) {
      return ContentService
        .createTextOutput(`${callback}(${json})`)
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService
      .createTextOutput(json)
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    const callback = e && e.parameter && e.parameter.callback;
    return jsonpResponse(callback, { error: err.message });
  }
}

function jsonpResponse(callback, data) {
  const json = JSON.stringify(data);
  if (callback) {
    return ContentService
      .createTextOutput(`${callback}(${json})`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function getSignupResponses() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CFG.responsesSheet);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data    = sheet.getDataRange().getValues();
  const results = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[1]) continue;
    const ts = row[0] instanceof Date
      ? Utilities.formatDate(row[0], Session.getScriptTimeZone(), 'MMM d, yyyy HH:mm')
      : String(row[0] || '');
    results.push({
      rowIndex:  i + 1,
      timestamp: ts,
      charName:  String(row[1] || ''),
      realm:     String(row[2] || ''),
      className: String(row[3] || ''),
      mainSpec:  String(row[4] || ''),
      offSpecs:  String(row[5] || ''),
      role:      String(row[6] || ''),
      discord:   String(row[7] || ''),
      notes:     String(row[8] || '')
    });
  }
  return results.reverse();
}

function writeSignup(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CFG.responsesSheet);
  if (!sheet) {
    sheet = ss.insertSheet(CFG.responsesSheet);
    sheet.appendRow(['Timestamp', 'Character', 'Realm', 'Class', 'Main Spec', 'Off Specs', 'Role', 'Discord', 'Notes']);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([
    new Date(),
    data.charName  || '',
    data.realm     || '',
    data.className || '',
    data.mainSpec  || '',
    (data.offSpecs || []).join(', '),
    data.role      || '',
    data.discord   || '',
    data.notes     || ''
  ]);
}

function writeSelfReceivedRequest(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CFG.selfReceivedSheet);
  if (!sheet) {
    sheet = ss.insertSheet(CFG.selfReceivedSheet);
    sheet.appendRow(['Timestamp', 'Player', 'Item', 'Slot', 'Source', 'Notes', 'Status']);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([
    new Date(),
    data.player  || '',
    data.item    || '',
    data.slot    || '',
    data.source  || '',
    data.notes   || '',
    'Pending'
  ]);
}

function getSelfReceivedRequests(statusFilter) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CFG.selfReceivedSheet);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data    = sheet.getDataRange().getValues();
  const results = [];
  for (let i = 1; i < data.length; i++) {
    const row    = data[i];
    const status = String(row[6] || '').trim();
    if (statusFilter && status !== statusFilter) continue;
    if (!row[1] || !row[2]) continue;
    const ts = row[0] instanceof Date
      ? Utilities.formatDate(row[0], Session.getScriptTimeZone(), 'MMM d, yyyy HH:mm')
      : String(row[0] || '');
    results.push({
      rowIndex:  i + 1,
      timestamp: ts,
      player:    String(row[1] || ''),
      item:      String(row[2] || ''),
      slot:      String(row[3] || ''),
      source:    String(row[4] || ''),
      notes:     String(row[5] || ''),
      status:    status
    });
  }
  return results.reverse();
}

function updateRequestStatus(row, status) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CFG.selfReceivedSheet);
  if (!sheet) return;
  sheet.getRange(row, 7).setValue(status);
}

function getSelfReceived(sheets) {
  const sheet = sheets[CFG.selfReceivedSheet];
  if (!sheet || sheet.getLastRow() < 2) return {};

  const data   = sheet.getDataRange().getValues();
  const result = {};
  for (let i = 1; i < data.length; i++) {
    const row    = data[i];
    const status = String(row[6] || '').trim();
    if (status !== 'Approved') continue;
    const player = String(row[1] || '').trim();
    const item   = String(row[2] || '').trim();
    const slot   = String(row[3] || '').trim();
    const source = String(row[4] || '').trim();
    if (!player || !item) continue;
    if (!result[player]) result[player] = [];
    result[player].push({ item, slot, source });
  }
  return result;
}

function buildPayload() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Pre-load all sheets in one pass to minimise Sheets API calls
  const sheets = {};
  for (const sheet of ss.getSheets()) {
    sheets[sheet.getName()] = sheet;
  }

  const scriptProps       = PropertiesService.getScriptProperties();
  const signupsOpen       = scriptProps.getProperty('signupsOpen')       === 'true';
  const bisSubmissionsOpen = scriptProps.getProperty('bisSubmissionsOpen') === 'true';

  return {
    generatedAt:          new Date().toISOString(),
    signupsOpen:          signupsOpen,
    bisSubmissionsOpen:    bisSubmissionsOpen,
    bisAllowedPlayers:     getBisAllowedPlayers(),
    playerNotes:           getPlayerNotes(),
    roster:        getRoster(sheets),
    priorityOrder: getPriorityOrder(sheets),
    bisList:       getBisList(sheets),
    itemSlots:     getItemSlots(sheets),
    lootCounts:        getLootCounts(sheets),
    attendanceDetails: getAttendanceDetails(sheets),
    selfReceived:      getSelfReceived(sheets),
  };
}

function getRoster(sheets) {
  const sheet = sheets[CFG.rosterSheet];
  if (!sheet) return [];

  // Build attendance lookup from Scoring tab: firstName -> attendance string
  const attendMap = {};
  const scoringSheet = sheets[CFG.scoringSheet];
  if (scoringSheet) {
    const scoringData = scoringSheet.getDataRange().getValues();
    for (let i = CFG.scoringDataStart - 1; i < scoringData.length; i++) {
      const row       = scoringData[i];
      const nameRealm = String(row[CFG.scoringPlayerCol - 1] || '').trim();
      const score     = row[CFG.scoringAttendCol - 1];
      if (!nameRealm || score === '' || score === null) continue;
      const firstName = nameRealm.split('-')[0].trim();
      const pct = parseFloat(score);
      if (!isNaN(pct)) attendMap[firstName] = (Math.round(pct * 10)).toFixed(1) + '%';
    }
  }

  const data    = sheet.getDataRange().getValues();
  const players = [];

  for (let i = CFG.rosterDataStart - 1; i < data.length; i++) {
    const row       = data[i];
    const nameRealm = String(row[CFG.rosterPlayerCol - 1] || '').trim();
    if (!nameRealm) continue;

    const parts     = nameRealm.split('-');
    const firstName = parts[0].trim();
    const realm     = parts.slice(1).join('-').trim();
    const isTrial   = row[CFG.rosterTrialCol  - 1] === true ||
                      String(row[CFG.rosterTrialCol - 1]).toLowerCase() === 'true';
    const nick      = String(row[CFG.rosterNickCol    - 1] || '').trim();
    const charClass = String(row[CFG.rosterClassCol   - 1] || '').trim();
    const spec      = String(row[CFG.rosterSpecCol    - 1] || '').trim();
    const role      = String(row[CFG.rosterRoleCol    - 1] || '').trim();
    const bisLink   = String(row[CFG.rosterBisLinkCol - 1] || '').trim();
    const sortKey = String(row[CFG.rosterSortKeyCol - 1] || '').trim();
    const isBench = String(Math.floor(Number(sortKey) / 1000)) === '6';

    if (!role) continue;

    players.push({ nameRealm, firstName, realm, isTrial, isBench, attendance: attendMap[firstName] || '', nick, class: charClass, spec, role, bisLink });
  }

  return players;
}

function getPriorityOrder(sheets) {
  const sheet = sheets[CFG.prioritySheet];
  if (!sheet) return {};

  const data   = sheet.getDataRange().getValues();
  const result = {};

  for (let i = CFG.priorityDataStart - 1; i < data.length; i++) {
    const row      = data[i];
    const itemName = String(row[CFG.priorityItemCol - 1] || '').trim();
    if (!itemName) continue;

    const ranked = [];
    for (let c = CFG.priorityRankStart - 1; c < row.length; c++) {
      const val = String(row[c] || '').trim();
      if (val) ranked.push(val.split('-')[0].trim());
    }
    result[itemName] = ranked;
  }

  return result;
}

function normaliseName(str) {
  return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function getBisList(sheets) {
  const sheet = sheets[CFG.bisSheet];
  if (!sheet) return {};

  const data      = sheet.getDataRange().getValues();
  const headerRow = data[CFG.bisHeaderRow - 1];

  const colToName = {};
  for (let c = CFG.bisPlayerStartCol - 1; c < headerRow.length; c++) {
    const header = String(headerRow[c] || '').trim();
    if (!header) continue;
    colToName[c] = header.split('-')[0].trim();
  }

  const bisList = {};

  for (let i = CFG.bisDataStart - 1; i < data.length; i++) {
    const row  = data[i];
    const slot = String(row[CFG.bisSlotCol - 1] || '').trim();
    if (!slot) continue;

    for (const [colIdx, firstName] of Object.entries(colToName)) {
      const item = String(row[colIdx] || '').trim();
      if (!item) continue;
      if (!bisList[firstName]) bisList[firstName] = [];
      const alreadyAdded = bisList[firstName].some(function(e) {
        return e.item === item && e.slot === slot;
      });
      if (!alreadyAdded) bisList[firstName].push({ item, slot });
    }
  }

  return bisList;
}

function getAttendanceDetails(sheets) {
  const sheet = sheets[CFG.attendanceSheet];
  if (!sheet) return {};

  const data       = sheet.getDataRange().getValues();
  const result     = {};
  const penalizing = new Set(['No Show', 'Excused']);
  var   skipReport = false;

  for (let i = CFG.attendDataStart - 1; i < data.length; i++) {
    const row     = data[i];
    const rawDate = row[CFG.attendDateCol    - 1];
    const name    = String(row[CFG.attendNameCol    - 1] || '').trim();
    const status  = String(row[CFG.attendStatusCol  - 1] || '').trim();
    const exclude = row[5]; // column F — Exclude Report checkbox

    const dateStr = String(rawDate || '').trim();

    // Stop at the excluded section divider at the bottom
    if (dateStr.startsWith('──') || dateStr === 'Report Title') break;

    // Report header row — check the exclude checkbox
    if (!name) {
      skipReport = (exclude === true);
      continue;
    }

    // Skip all player rows under an excluded report
    if (skipReport) continue;

    // Skip blank rows or non-penalizing statuses
    if (!rawDate || !status) continue;
    if (!penalizing.has(status)) continue;

    var formattedDate;
    if (rawDate instanceof Date) {
      formattedDate = Utilities.formatDate(rawDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } else {
      formattedDate = dateStr;
    }

    if (!result[name]) result[name] = [];
    result[name].push({ date: formattedDate, status });
  }

  return result;
}

function getItemSlots(sheets) {
  const sheet = sheets[CFG.itemLookupSheet];
  if (!sheet) return {};

  const data   = sheet.getDataRange().getValues();
  const result = {};

  for (let i = CFG.itemDataStart - 1; i < data.length; i++) {
    const row  = data[i];
    const name = String(row[CFG.itemNameCol - 1] || '').trim();
    const slot = String(row[CFG.itemSlotCol - 1] || '').trim();
    if (name && slot) result[name] = slot;
  }

  return result;
}

function getLootCounts(sheets) {
  const sheet = sheets[CFG.lootSheet];
  if (!sheet) return {};

  const data   = sheet.getDataRange().getValues();
  const result = {};

  function normName(str) {
    return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  for (let i = CFG.lootDataStart - 1; i < data.length; i++) {
    const row      = data[i];
    const player   = String(row[CFG.lootPlayerCol    - 1] || '').trim();
    const rawDate  = row[CFG.lootDateCol             - 1];
    const item     = String(row[3]                        || '').trim().replace(/^\[|\]$/g, ''); // col D, strip brackets
    const instance = String(row[CFG.lootInstanceCol  - 1] || '').trim();
    if (!player || !item) continue;

    const name = normName(player.split('-')[0]);
    if (!name) continue;

    const diffRaw    = instance.split('-').pop().trim().toLowerCase();
    const difficulty = diffRaw === 'mythic' ? 'Mythic' : diffRaw === 'heroic' ? 'Heroic' : 'Other';
    const date       = rawDate instanceof Date
      ? Utilities.formatDate(rawDate, Session.getScriptTimeZone(), 'MMM d, yyyy')
      : String(rawDate || '').trim();

    if (!result[name]) result[name] = { count: 0, heroicCount: 0, mythicCount: 0, items: [] };
    result[name].count++;
    if (difficulty === 'Heroic') result[name].heroicCount++;
    else if (difficulty === 'Mythic') result[name].mythicCount++;
    result[name].items.push({ name: item, difficulty: difficulty, date: date });
  }

  return result;
}

function getBisAllowedPlayers() {
  const val = PropertiesService.getScriptProperties().getProperty('bisAllowedPlayers');
  try { return JSON.parse(val || '[]'); } catch(e) { return []; }
}

function setBisAllowedPlayers(arr) {
  PropertiesService.getScriptProperties().setProperty('bisAllowedPlayers', JSON.stringify(arr));
}

function getPlayerNotes() {
  const val = PropertiesService.getScriptProperties().getProperty('playerNotes');
  try { return JSON.parse(val || '{}'); } catch(e) { return {}; }
}

function setPlayerNotes(notes) {
  PropertiesService.getScriptProperties().setProperty('playerNotes', JSON.stringify(notes));
}

function roleToPriority(role) {
  if (role === 'Tank')  return 3;
  if (role === 'Heal')  return 4;
  return 5; // Melee / Ranged / DPS
}

function updateRosterField(nameRealm, field, value) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CFG.rosterSheet);
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  for (let i = CFG.rosterDataStart - 1; i < data.length; i++) {
    const rowPlayer = String(data[i][CFG.rosterPlayerCol - 1] || '').trim();
    if (rowPlayer.toLowerCase() !== nameRealm.toLowerCase()) continue;
    const sheetRow = i + 1;
    if (field === 'isTrial') {
      sheet.getRange(sheetRow, CFG.rosterTrialCol).setValue(value === true || value === 'true');
    } else if (field === 'role') {
      sheet.getRange(sheetRow, CFG.rosterRoleCol).setValue(String(value || ''));
      // Update priority unless player is Raid Leader (1) or Officer (2)
      const currentPriority = Number(data[i][CFG.rosterPriorityCol - 1] || 0);
      if (currentPriority !== 1 && currentPriority !== 2) {
        sheet.getRange(sheetRow, CFG.rosterPriorityCol).setValue(roleToPriority(String(value)));
      }
    } else if (field === 'isBench') {
      if (value === true || value === 'true') {
        sheet.getRange(sheetRow, CFG.rosterPriorityCol).setValue(6);
      } else {
        const role = String(data[i][CFG.rosterRoleCol - 1] || '').trim();
        sheet.getRange(sheetRow, CFG.rosterPriorityCol).setValue(roleToPriority(role));
      }
    }
    return;
  }
}

function writeBiSSubmission(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CFG.bisResponsesSheet);
  if (!sheet) {
    sheet = ss.insertSheet(CFG.bisResponsesSheet);
    sheet.appendRow(['Timestamp', 'Name-Realm', 'BiS List Link', 'Notes', 'Status']);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([
    new Date(),
    data.nameRealm || '',
    data.bisLink   || '',
    data.notes     || '',
    'Pending'
  ]);

  // Remove player from individual allow list now that they've submitted
  const nameRealm = String(data.nameRealm || '');
  if (nameRealm) {
    const allowed = getBisAllowedPlayers().filter(function(n) { return n !== nameRealm; });
    setBisAllowedPlayers(allowed);
  }
}

function getBiSSubmissions(statusFilter) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CFG.bisResponsesSheet);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data    = sheet.getDataRange().getValues();
  const results = [];
  for (let i = 1; i < data.length; i++) {
    const row    = data[i];
    const status = String(row[4] || '').trim();
    if (statusFilter && status !== statusFilter) continue;
    if (!row[1] || !row[2]) continue;
    const ts = row[0] instanceof Date
      ? Utilities.formatDate(row[0], Session.getScriptTimeZone(), 'MMM d, yyyy HH:mm')
      : String(row[0] || '');
    results.push({
      rowIndex:  i + 1,
      timestamp: ts,
      nameRealm: String(row[1] || ''),
      bisLink:   String(row[2] || ''),
      notes:     String(row[3] || ''),
      status:    status
    });
  }
  return results.reverse();
}

function updateBiSStatus(row, status) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CFG.bisResponsesSheet);
  if (!sheet) return;
  sheet.getRange(row, 5).setValue(status);
}

function updateBisLinkInRoster(nameRealm, url) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CFG.rosterSheet);
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  for (let i = CFG.rosterDataStart - 1; i < data.length; i++) {
    const row       = data[i];
    const rowPlayer = String(row[CFG.rosterPlayerCol - 1] || '').trim();
    if (rowPlayer.toLowerCase() === nameRealm.toLowerCase()) {
      sheet.getRange(i + 1, CFG.rosterBisLinkCol).setValue(url);
      return;
    }
  }
}

function clearRosterCache() {
  CacheService.getScriptCache().remove('rosterPayload');
  SpreadsheetApp.getUi().alert('Roster page cache cleared. The next page load will fetch fresh data.');
}

function testAttendanceDetails() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = {};
  for (const sheet of ss.getSheets()) {
    sheets[sheet.getName()] = sheet;
  }

  const sheet = sheets[CFG.attendanceSheet];
  if (!sheet) { Logger.log('Sheet not found'); return; }

  Logger.log('Sheet found, rows: ' + sheet.getLastRow());

  const data = sheet.getDataRange().getValues();
  Logger.log('Row 2: ' + data[1].join(' | '));
  Logger.log('Col A row 2: ' + data[1][0]);
  Logger.log('Col B row 2: ' + data[1][1]);
  Logger.log('Col C row 2: ' + data[1][2]);

  const result = getAttendanceDetails(sheets);
  Logger.log('Result keys: ' + Object.keys(result).join(', '));
  Logger.log('Result: ' + JSON.stringify(result).slice(0, 500));
}

function testAttendanceRows() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Attendance');
  const data  = sheet.getDataRange().getValues();

  var count = 0;
  for (var i = 1; i < data.length && count < 10; i++) {
    var row = data[i];
    if (row[0] || row[1] || row[2]) {
      Logger.log('Row ' + (i+1) + ': A=' + row[0] + ' | B=' + row[1] + ' | C=' + row[2]);
      count++;
    }
  }
}
