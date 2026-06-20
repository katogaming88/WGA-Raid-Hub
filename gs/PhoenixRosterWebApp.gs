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
  rosterJoinDateCol: 13,  // M - Join Date (YYYY-MM-DD string)
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

  // ── Pending Roster tab ───────────────────────────────────────────
  applicantsSheet:   'Pending Roster',

  // ── Self Received Requests tab ────────────────────────────────────
  selfReceivedSheet: 'Self Received Requests',

  // ── BiS Responses tab ────────────────────────────────────────────────
  bisResponsesSheet: 'BiS Responses',

  // ── M+ Exclusion Requests tab ─────────────────────────────────────
  mPlusExclusionSheet: 'M+ Exclusion Requests',

  // ── Officer Audit Log tab ────────────────────────────────────────
  auditLogSheet:      'Officer Audit Log',

  // ── Loot Sheet ───────────────────────────────────────────────────
  lootSheet:         'Loot Data',
  lootPlayerCol:     1,  // A - Player (Name-Realm)
  lootDateCol:       2,  // B - Date
  lootInstanceCol:   10, // J - Instance (e.g. "The Voidspire-Heroic")
  lootDataStart:     2,  // First Data row (row 1 = headers)
  pastedLootSheet:   'Pasted Loot', // Season | Player | Date | Item Name | Instance

  // ── Attendance Sheet ───────────────────────────────────────────────────
  attendanceSheet:  'Attendance',
  attendNameCol:    2,  // B - Player First Name
  attendStatusCol:  3,  // C - Status
  attendDateCol:    1,  // A - Raid Date
  attendDataStart:  2,  // First data row
};

var BOT_BASE_URL = 'http://129.80.178.227:3000';
var BOT_WEBHOOK_SECRET = 'teamPhoenixPPCBot';

function sendToBot(path, payload) {
  try {
    var options = {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-webhook-secret': BOT_WEBHOOK_SECRET },
      payload: payload,
      muteHttpExceptions: true
    };
    var response = UrlFetchApp.fetch(BOT_BASE_URL + path, options);
    if (response.getResponseCode() !== 200) {
      Logger.log('Bot error on ' + path + ': ' + response.getResponseCode() + ' - ' + response.getContentText());
    }
  } catch (err) {
    Logger.log('sendToBot failed for ' + path + ': ' + err);
  }
}

function doGet(e) {
  try {
    const cache    = CacheService.getScriptCache();
    const props    = PropertiesService.getScriptProperties();
    const action   = e && e.parameter && e.parameter.action;
    const callback = e && e.parameter && e.parameter.callback;

    if (action === 'clearCache') {
      cache.remove('rosterCore');
      cache.remove('rosterHeavy');
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'getAuditLog') {
      return jsonpResponse(callback, { entries: getAuditLog() });
    }

    if (action === 'getExportString') {
      const ss         = SpreadsheetApp.getActiveSpreadsheet();
      const itemLookup = buildItemLookup(ss);
      const players    = buildPlayersObject(ss, itemLookup);
      const priority   = buildPriorityObject(ss, itemLookup);
      const encoded    = Utilities.base64Encode(JSON.stringify({ players, priority }), Utilities.Charset.UTF_8);
      const expSheet   = ss.getSheetByName('Export');
      if (expSheet) expSheet.getRange('A11').setValue(encoded);
      appendAuditLog('Export String Generated', '', '', '');
      return jsonpResponse(callback, { exportString: encoded });
    }

    if (action === 'getPlayerAttendanceFull') {
      const firstName = String(e.parameter.firstName || '').trim();
      if (!firstName) return jsonpResponse(callback, { error: 'Missing firstName' });
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheets = {};
      for (const sheet of ss.getSheets()) { sheets[sheet.getName()] = sheet; }
      const full = getFullAttendanceDetails(sheets);
      return jsonpResponse(callback, { history: full[firstName] || [] });
    }

    if (action === 'setSignupsOpen') {
      const open = e.parameter.value === 'true';
      props.setProperty('signupsOpen', open ? 'true' : 'false');
      cache.remove('rosterCore');
      appendAuditLog(open ? 'Signups Opened' : 'Signups Closed', '', '', '');
      return jsonpResponse(callback, { success: true, signupsOpen: open });
    }

    if (action === 'setBisSubmissionsOpen') {
      const open = e.parameter.value === 'true';
      props.setProperty('bisSubmissionsOpen', open ? 'true' : 'false');
      cache.remove('rosterCore');
      appendAuditLog(open ? 'BiS Submissions Opened' : 'BiS Submissions Closed', '', '', '');
      return jsonpResponse(callback, { success: true, bisSubmissionsOpen: open });
    }

    if (action === 'setMPlusExclusionsOpen') {
      const open = e.parameter.value === 'true';
      props.setProperty('mPlusExclusionsOpen', open ? 'true' : 'false');
      cache.remove('rosterCore');
      appendAuditLog(open ? 'M+ Exclusions Opened' : 'M+ Exclusions Closed', '', '', '');
      return jsonpResponse(callback, { success: true, mPlusExclusionsOpen: open });
    }

    if (action === 'syncAttendancePct') {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheets = {};
      for (const sheet of ss.getSheets()) { sheets[sheet.getName()] = sheet; }
      const seasonStart = props.getProperty('seasonStart') || '';
      const joinDateMap = buildJoinDateMap(sheets);
      const attendMap   = buildAttendanceMap(sheets, seasonStart, joinDateMap);
      const rosterSheet = sheets[CFG.rosterSheet];
      if (rosterSheet) {
        const data = rosterSheet.getDataRange().getValues();
        for (let i = CFG.rosterDataStart - 1; i < data.length; i++) {
          const nameRealm = String(data[i][CFG.rosterPlayerCol - 1] || '').trim();
          if (!nameRealm) continue;
          const firstName = nameRealm.split('-')[0].trim();
          const pct = attendMap[firstName] || '';
          rosterSheet.getRange(i + 1, 3).setValue(pct);
        }
      }
      cache.remove('rosterCore');
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'refreshAttendanceWCL') {
      try {
        const result = refreshAttendanceCore();
        appendAuditLog('Attendance Refreshed (WCL)', '', '', `${result.mainNights} nights, ${result.excluded} excluded`);
        return jsonpResponse(callback, { success: true, mainNights: result.mainNights, excluded: result.excluded });
      } catch (err) {
        return jsonpResponse(callback, { success: false, error: err.message });
      }
    }

    if (action === 'commitAttendanceScores') {
      try {
        const result = commitAttendanceScoresCore();
        appendAuditLog('Attendance Scores Committed', '', '', `${result.committed} players, ${result.totalRaids} nights`);
        return jsonpResponse(callback, { success: true, committed: result.committed, totalRaids: result.totalRaids });
      } catch (err) {
        return jsonpResponse(callback, { success: false, error: err.message });
      }
    }

    if (action === 'getAttendanceGrid') {
      try {
        const grid = getAttendanceSheetGrid();
        return jsonpResponse(callback, { success: true, raids: grid.raids });
      } catch (err) {
        return jsonpResponse(callback, { success: false, error: err.message });
      }
    }

    if (action === 'setAttendanceStatus') {
      const data = JSON.parse(decodeURIComponent(e.parameter.data || '{}'));
      try {
        setAttendanceStatusInSheet(data.date, data.firstName, data.status);
        appendAuditLog('Attendance Status Set', data.firstName, data.oldStatus || '', data.status);
        return jsonpResponse(callback, { success: true });
      } catch (err) {
        return jsonpResponse(callback, { success: false, error: err.message });
      }
    }

    if (action === 'setSeasonStart') {
      const val = String(e.parameter.value || '').trim();
      props.setProperty('seasonStart', val);
      cache.remove('rosterCore');
      cache.remove('rosterHeavy');
      appendAuditLog('Season Start Set', '', '', val);
      return jsonpResponse(callback, { success: true, seasonStart: val });
    }

    if (action === 'setSeasonName') {
      const val = String(e.parameter.value || '').trim();
      props.setProperty('seasonName', val);
      cache.remove('rosterCore');
      appendAuditLog('Season Name Set', '', '', val);
      return jsonpResponse(callback, { success: true, seasonName: val });
    }

    if (action === 'setSeasonEnd') {
      const val = String(e.parameter.value || '').trim();
      props.setProperty('seasonEnd', val);
      cache.remove('rosterCore');
      appendAuditLog('Season End Set', '', '', val);
      return jsonpResponse(callback, { success: true, seasonEnd: val });
    }

    if (action === 'archiveSeason') {
      const seasonName  = props.getProperty('seasonName')  || '';
      const seasonStart = props.getProperty('seasonStart') || '';
      const seasonEnd   = props.getProperty('seasonEnd')   || '';
      const history     = JSON.parse(props.getProperty('seasonHistory') || '[]');
      history.push({ name: seasonName, start: seasonStart, end: seasonEnd });
      props.setProperty('seasonHistory', JSON.stringify(history));
      props.deleteProperty('seasonName');
      props.deleteProperty('seasonStart');
      props.deleteProperty('seasonEnd');
      cache.remove('rosterCore');
      cache.remove('rosterHeavy');
      appendAuditLog('Season Archived', '', '', seasonName);
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'submitSignup') {
      const data = JSON.parse(decodeURIComponent(e.parameter.data || '{}'));
      writeSignup(data);
      sendToBot('/signup', JSON.stringify({
        charName:    data.charName    || '',
        realm:       data.realm       || '',
        className:   data.className   || '',
        mainSpec:    data.mainSpec    || '',
        offSpecs:    (data.offSpecs || []).join(', '),
        role:        data.role        || '',
        discord:     data.discord     || '',
        notes:       data.notes       || '',
        submittedAt: new Date().toISOString()
      }));
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'getSignups') {
      return jsonpResponse(callback, { signups: getSignupResponses() });
    }

    if (action === 'requestSelfReceived') {
      const data = JSON.parse(decodeURIComponent(e.parameter.data || '{}'));
      // TODO(auth): once Discord OAuth ships, bypass officer approval for verified players:
      //   if (isPlayerVerified(data.player)) { approveSelfReceivedDirect(data); cache.remove('rosterHeavy'); return jsonpResponse(callback, { success: true }); }
      writeSelfReceivedRequest(data);
      sendToBot('/selfreceived', JSON.stringify({
        player:      data.player  || '',
        item:        data.item    || '',
        slot:        data.slot    || '',
        source:      data.source  || '',
        notes:       data.notes   || '',
        submittedAt: new Date().toISOString()
      }));
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'getPendingRequests') {
      return jsonpResponse(callback, { requests: getSelfReceivedRequests('Pending') });
    }

    if (action === 'directMarkReceived') {
      const data = JSON.parse(decodeURIComponent(e.parameter.data || '{}'));
      writeSelfReceivedRequest(data, 'Approved');
      cache.remove('rosterHeavy');
      appendAuditLog('Loot Marked Received', String(data.player || ''), '', String(data.item || ''));
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'approveRequest') {
      const row = parseInt(e.parameter.row, 10);
      if (isNaN(row) || row < 2) return jsonpResponse(callback, { error: 'Invalid row' });
      const reqData = getSelfReceivedRowSummary(row);
      updateRequestStatus(row, 'Approved');
      cache.remove('rosterHeavy');
      appendAuditLog('Self-Received Approved', reqData.player, '', reqData.item);
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'rejectRequest') {
      const row = parseInt(e.parameter.row, 10);
      if (isNaN(row) || row < 2) return jsonpResponse(callback, { error: 'Invalid row' });
      const reqData = getSelfReceivedRowSummary(row);
      updateRequestStatus(row, 'Rejected');
      appendAuditLog('Self-Received Rejected', reqData.player, '', reqData.item);
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'submitBiS') {
      const data = JSON.parse(decodeURIComponent(e.parameter.data || '{}'));
      writeBiSSubmission(data);
      sendToBot('/bis', JSON.stringify({
        nameRealm:   data.nameRealm || '',
        bisLink:     data.bisLink   || '',
        notes:       data.notes     || '',
        submittedAt: new Date().toISOString()
      }));
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
      const oldUrl = getRosterBisLink(nameRealm);
      updateBisLinkInRoster(nameRealm, url);
      updateBiSStatus(row, 'Approved');
      cache.remove('rosterHeavy');
      appendAuditLog('BiS Approved', nameRealm, oldUrl, url);
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'rejectBiS') {
      const row = parseInt(e.parameter.row, 10);
      if (isNaN(row) || row < 2) return jsonpResponse(callback, { error: 'Invalid row' });
      const nameRealm = getBiSNameRealmFromRow(row);
      updateBiSStatus(row, 'Rejected');
      appendAuditLog('BiS Rejected', nameRealm, '', '');
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
      cache.remove('rosterCore');
      appendAuditLog('BiS Submission Enabled', nameRealm, '', '');
      return jsonpResponse(callback, { success: true, bisAllowedPlayers: allowed });
    }

    if (action === 'revokeBisForPlayer') {
      const data      = JSON.parse(decodeURIComponent(e.parameter.data || '{}'));
      const nameRealm = String(data.nameRealm || '');
      const allowed   = getBisAllowedPlayers().filter(function(n) { return n !== nameRealm; });
      setBisAllowedPlayers(allowed);
      cache.remove('rosterCore');
      appendAuditLog('BiS Submission Revoked', nameRealm, '', '');
      return jsonpResponse(callback, { success: true, bisAllowedPlayers: allowed });
    }

    if (action === 'updateBisLink') {
      const data      = JSON.parse(decodeURIComponent(e.parameter.data || '{}'));
      const nameRealm = String(data.nameRealm || '');
      const url       = String(data.url || '');
      const oldUrl    = getRosterBisLink(nameRealm);
      updateBisLinkInRoster(nameRealm, url);
      cache.remove('rosterHeavy');
      appendAuditLog('BiS Link Updated', nameRealm, oldUrl, url);
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'updatePlayerField') {
      const data      = JSON.parse(decodeURIComponent(e.parameter.data || '{}'));
      const nameRealm = String(data.nameRealm || '');
      const field     = String(data.field     || '');
      const value     = data.value;
      if (!nameRealm || !field) return jsonpResponse(callback, { error: 'Missing params' });
      const oldVal = getRosterFieldValue(nameRealm, field);
      updateRosterField(nameRealm, field, value);
      cache.remove('rosterCore');
      const actionLabel = field === 'spec'     ? 'Spec Changed'
                        : field === 'class'    ? 'Class Changed'
                        : field === 'isTrial'  ? 'Trial Status Changed'
                        : field === 'role'     ? 'Role Changed'
                        : field === 'isBench'  ? 'Bench Status Changed'
                        : field === 'joinDate' ? 'Join Date Changed'
                        : 'Field Changed: ' + field;
      appendAuditLog(actionLabel, nameRealm, oldVal, String(value));
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'renamePlayer') {
      const data         = JSON.parse(decodeURIComponent(e.parameter.data || '{}'));
      const oldNameRealm = String(data.oldNameRealm || '').trim();
      const newNameRealm = String(data.newNameRealm || '').trim();
      if (!oldNameRealm || !newNameRealm) return jsonpResponse(callback, { error: 'Missing params' });
      renamePlayerInRoster(oldNameRealm, newNameRealm);
      cache.remove('rosterCore');
      appendAuditLog('Player Renamed', oldNameRealm, oldNameRealm, newNameRealm);
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'savePlayerNote') {
      const data      = JSON.parse(decodeURIComponent(e.parameter.data || '{}'));
      const nameRealm = String(data.nameRealm || '');
      const note      = String(data.note      || '');
      if (!nameRealm) return jsonpResponse(callback, { error: 'Missing nameRealm' });
      const notes   = getPlayerNotes();
      const oldNote = notes[nameRealm] || '';
      if (note) { notes[nameRealm] = note; } else { delete notes[nameRealm]; }
      setPlayerNotes(notes);
      appendAuditLog('Officer Note Changed', nameRealm, oldNote, note);
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'addPlayer') {
      const data = JSON.parse(decodeURIComponent(e.parameter.data || '{}'));
      addPlayerToRoster(data);
      cache.remove('rosterCore');
      const details = [data.class, data.spec, data.role].filter(Boolean).join(' ');
      appendAuditLog('Player Added', String(data.nameRealm || ''), '', details);
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'removePlayer') {
      const data      = JSON.parse(decodeURIComponent(e.parameter.data || '{}'));
      const nameRealm = String(data.nameRealm || '').trim();
      if (!nameRealm) return jsonpResponse(callback, { error: 'Missing nameRealm' });
      removePlayerFromRoster(nameRealm);
      cache.remove('rosterCore');
      appendAuditLog('Player Removed', nameRealm, '', '');
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

    if (action === 'approveSignup') {
      const row = parseInt(e.parameter.row, 10);
      if (isNaN(row) || row < 2) return jsonpResponse(callback, { error: 'Invalid row' });
      const ss    = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(CFG.responsesSheet);
      if (!sheet) return jsonpResponse(callback, { error: 'Sheet not found' });
      const rowData = sheet.getRange(row, 1, 1, 9).getValues()[0];
      writeToApplicants({
        charName:  String(rowData[1] || ''),
        realm:     String(rowData[2] || ''),
        className: String(rowData[3] || ''),
        mainSpec:  String(rowData[4] || ''),
        offSpecs:  String(rowData[5] || ''),
        role:      String(rowData[6] || ''),
        discord:   String(rowData[7] || ''),
        notes:     String(rowData[8] || '')
      });
      updateSignupStatus(row, 'Approved');
      const signupName = rowData[2] ? rowData[1] + '-' + rowData[2] : String(rowData[1] || '');
      appendAuditLog('Signup Approved', signupName, '', '');
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'denySignup') {
      const row = parseInt(e.parameter.row, 10);
      if (isNaN(row) || row < 2) return jsonpResponse(callback, { error: 'Invalid row' });
      const signupName = getSignupNameFromRow(row);
      updateSignupStatus(row, 'Denied');
      appendAuditLog('Signup Denied', signupName, '', '');
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'submitMPlusExclusion') {
      const data = JSON.parse(decodeURIComponent(e.parameter.data || '{}'));
      writeMPlusExclusionRequest(data);
      sendToBot('/mplus', JSON.stringify({
        nameRealm:   data.nameRealm   || '',
        raiderioUrl: data.raiderioUrl || '',
        notes:       data.notes       || '',
        submittedAt: new Date().toISOString()
      }));
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'getPendingRoster') {
      return jsonpResponse(callback, { entries: getPendingRosterEntries() });
    }

    if (action === 'removePendingRoster') {
      const row = parseInt(e.parameter.row, 10);
      if (isNaN(row) || row < 2) return jsonpResponse(callback, { error: 'Invalid row' });
      const ss    = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(CFG.applicantsSheet);
      if (!sheet) return jsonpResponse(callback, { error: 'Sheet not found' });
      sheet.deleteRow(row);
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'setMPlusExcluded') {
      const nameRealm = String(e.parameter.nameRealm || '').trim();
      const excluded  = e.parameter.value === 'true';
      if (!nameRealm) return jsonpResponse(callback, { error: 'Missing nameRealm' });
      const list = getMPlusManualExcluded().filter(function(n) { return n !== nameRealm; });
      if (excluded) list.push(nameRealm);
      setMPlusManualExcluded(list);
      cache.remove('rosterCore');
      appendAuditLog(excluded ? 'M+ Exclusion Toggled On' : 'M+ Exclusion Toggled Off', nameRealm, '', '');
      return jsonpResponse(callback, { success: true, excluded: excluded });
    }

    if (action === 'clearAllMPlusExclusions') {
      setMPlusManualExcluded([]);
      const exSheet = ss.getSheetByName(CFG.mPlusExclusionSheet);
      if (exSheet && exSheet.getLastRow() >= 2) {
        const exData = exSheet.getDataRange().getValues();
        for (let i = 1; i < exData.length; i++) {
          if (String(exData[i][4] || '').trim() === 'Approved') {
            exSheet.getRange(i + 1, 5).setValue('Reset');
          }
        }
      }
      cache.remove('rosterCore');
      appendAuditLog('All M+ Exclusions Cleared', '', '', '');
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'getMPlusExclusions') {
      return jsonpResponse(callback, { submissions: getMPlusExclusionRequests('Pending') });
    }

    if (action === 'approveMPlusExclusion') {
      const data      = JSON.parse(decodeURIComponent(e.parameter.data || '{}'));
      const row       = parseInt(data.row, 10);
      const nameRealm = String(data.nameRealm || '');
      const note      = String(data.note || '');
      if (isNaN(row) || row < 2) return jsonpResponse(callback, { error: 'Invalid row' });
      updateMPlusExclusionStatus(row, 'Approved');
      if (note) {
        const exSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CFG.mPlusExclusionSheet);
        if (exSheet) exSheet.getRange(row, 6).setValue(note);
      }
      cache.remove('rosterCore');
      appendAuditLog('M+ Exclusion Approved', nameRealm, '', note || '');
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'rejectMPlusExclusion') {
      const row = parseInt(e.parameter.row, 10);
      if (isNaN(row) || row < 2) return jsonpResponse(callback, { error: 'Invalid row' });
      const nameRealm = getMPlusNameRealmFromRow(row);
      updateMPlusExclusionStatus(row, 'Rejected');
      appendAuditLog('M+ Exclusion Rejected', nameRealm, '', '');
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'getPendingCounts') {
      return jsonpResponse(callback, {
        signups:       getSignupResponses().filter(s => s.status === 'Pending' || !s.status).length,
        pendingRoster: getPendingRosterEntries().length,
        bis:           getBiSSubmissions('Pending').length,
        mplus:         getMPlusExclusionRequests('Pending').length,
        requests:      getSelfReceivedRequests('Pending').length
      });
    }

    if (action === 'getPastedLootSummary') {
      const lss = SpreadsheetApp.getActiveSpreadsheet();
      return jsonpResponse(callback, getPastedLootSummary(lss));
    }

    if (action === 'appendLootRows') {
      const season = String(e.parameter.season || '').trim();
      const rows   = JSON.parse(decodeURIComponent(e.parameter.rows || '[]'));
      if (!Array.isArray(rows) || rows.length === 0) return jsonpResponse(callback, { success: true, written: 0, skipped: 0 });
      const lss    = SpreadsheetApp.getActiveSpreadsheet();
      const result = appendLootRowsToSheet(season, rows, lss);
      cache.remove('rosterHeavy');
      return jsonpResponse(callback, { success: true, written: result.written, skipped: result.skipped });
    }

    if (action === 'clearAllPastedLoot') {
      const lss   = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = lss.getSheetByName(CFG.pastedLootSheet);
      if (sheet && sheet.getLastRow() >= 2) {
        sheet.deleteRows(2, sheet.getLastRow() - 1);
      }
      cache.remove('rosterHeavy');
      appendAuditLog('Pasted Loot Cleared', '', '', '');
      return jsonpResponse(callback, { success: true });
    }

    const chunk = e && e.parameter && e.parameter.chunk;

    if (chunk === 'core') {
      const coreJson = cache.get('rosterCore') || (() => {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const sheets = {};
        for (const sheet of ss.getSheets()) { sheets[sheet.getName()] = sheet; }
        const fresh = JSON.stringify(buildCorePayload(sheets, PropertiesService.getScriptProperties()));
        cache.put('rosterCore', fresh, 300);
        return fresh;
      })();
      if (callback) {
        return ContentService.createTextOutput(callback + '(' + coreJson + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
      }
      return ContentService.createTextOutput(coreJson).setMimeType(ContentService.MimeType.JSON);
    }

    if (chunk === 'heavy') {
      const heavyJson = cache.get('rosterHeavy') || (() => {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const sheets = {};
        for (const sheet of ss.getSheets()) { sheets[sheet.getName()] = sheet; }
        const fresh = JSON.stringify(buildHeavyPayload(sheets));
        cache.put('rosterHeavy', fresh, 900);
        return fresh;
      })();
      if (callback) {
        return ContentService.createTextOutput(callback + '(' + heavyJson + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
      }
      return ContentService.createTextOutput(heavyJson).setMimeType(ContentService.MimeType.JSON);
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
      notes:     String(row[8] || ''),
      status:    String(row[9] || 'Pending')
    });
  }
  return results.reverse();
}

function writeSignup(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CFG.responsesSheet);
  if (!sheet) {
    sheet = ss.insertSheet(CFG.responsesSheet);
    sheet.appendRow(['Timestamp', 'Character', 'Realm', 'Class', 'Main Spec', 'Off Specs', 'Role', 'Discord', 'Notes', 'Status']);
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
    data.notes     || '',
    'Pending'
  ]);
}

function writeSelfReceivedRequest(data, status) {
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
    status || 'Pending'
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

function buildCorePayload(sheets, scriptProps) {
  const signupsOpen         = scriptProps.getProperty('signupsOpen')         === 'true';
  const bisSubmissionsOpen  = scriptProps.getProperty('bisSubmissionsOpen')  === 'true';
  const mPlusExclusionsOpen = scriptProps.getProperty('mPlusExclusionsOpen') === 'true';
  const seasonStart         = scriptProps.getProperty('seasonStart')         || '';
  const seasonName          = scriptProps.getProperty('seasonName')          || '';
  const seasonEnd           = scriptProps.getProperty('seasonEnd')           || '';
  const seasonHistory       = JSON.parse(scriptProps.getProperty('seasonHistory') || '[]');
  return {
    generatedAt:          new Date().toISOString(),
    signupsOpen:          signupsOpen,
    bisSubmissionsOpen:   bisSubmissionsOpen,
    mPlusExclusionsOpen:  mPlusExclusionsOpen,
    seasonStart:          seasonStart,
    seasonName:           seasonName,
    seasonEnd:            seasonEnd,
    seasonHistory:        seasonHistory,
    bisAllowedPlayers:    getBisAllowedPlayers(),
    playerNotes:          getPlayerNotes(),
    roster:               getRoster(sheets, seasonStart),
  };
}

function buildHeavyPayload(sheets) {
  return {
    generatedAt:            new Date().toISOString(),
    priorityOrder:          getPriorityOrder(sheets),
    bisList:                getBisList(sheets),
    itemSlots:              getItemSlots(sheets),
    lootCounts:             getLootCounts(sheets),
    attendanceDetails:      getAttendanceDetails(sheets),
    rawAttendanceData:      getRawAttendanceData(sheets),
    recentAttendanceTrend:  getRecentAttendanceTrend(sheets),
    selfReceived:           getSelfReceived(sheets),
  };
}

function buildPayload() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = {};
  for (const sheet of ss.getSheets()) {
    sheets[sheet.getName()] = sheet;
  }
  const scriptProps = PropertiesService.getScriptProperties();
  const core  = buildCorePayload(sheets, scriptProps);
  const heavy = buildHeavyPayload(sheets);
  return Object.assign({}, core, heavy);
}

function getMPlusManualExcluded() {
  const val = PropertiesService.getScriptProperties().getProperty('mPlusManualExcluded');
  try { return JSON.parse(val || '[]'); } catch(e) { return []; }
}

function setMPlusManualExcluded(arr) {
  PropertiesService.getScriptProperties().setProperty('mPlusManualExcluded', JSON.stringify(arr));
}

function getApprovedMPlusExcludedSet(sheets) {
  const excluded = {};
  const notes    = {};
  // From approved requests
  const sheet = sheets[CFG.mPlusExclusionSheet];
  if (sheet && sheet.getLastRow() >= 2) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const status    = String(data[i][4] || '').trim();
      const nameRealm = String(data[i][1] || '').trim();
      const note      = String(data[i][5] || '').trim();
      if (status === 'Approved' && nameRealm) {
        excluded[nameRealm.toLowerCase()] = true;
        if (note) notes[nameRealm.toLowerCase()] = note;
      }
    }
  }
  // From manual overrides
  for (const nr of getMPlusManualExcluded()) {
    if (nr) excluded[nr.toLowerCase()] = true;
  }
  return { excluded, notes };
}

function buildJoinDateMap(sheets) {
  const sheet = sheets[CFG.rosterSheet];
  if (!sheet) return {};
  const data = sheet.getDataRange().getValues();
  const map  = {};
  for (let i = CFG.rosterDataStart - 1; i < data.length; i++) {
    const nameRealm = String(data[i][CFG.rosterPlayerCol - 1] || '').trim();
    if (!nameRealm) continue;
    const firstName   = nameRealm.split('-')[0].trim();
    const rawJoinDate = data[i][CFG.rosterJoinDateCol - 1];
    map[firstName] = rawJoinDate instanceof Date
      ? Utilities.formatDate(rawJoinDate, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : String(rawJoinDate || '').trim();
  }
  return map;
}

function buildAttendanceMap(sheets, seasonStart, joinDateMap) {
  const sheet = sheets[CFG.attendanceSheet];
  if (!sheet) return {};

  const data        = sheet.getDataRange().getValues();
  const raidDateSet = new Set();
  const playerData  = {};
  var skipReport    = false;

  for (let i = CFG.attendDataStart - 1; i < data.length; i++) {
    const row     = data[i];
    const rawDate = row[CFG.attendDateCol   - 1];
    const name    = String(row[CFG.attendNameCol   - 1] || '').trim();
    const status  = String(row[CFG.attendStatusCol - 1] || '').trim();
    const exclude = row[5];
    const dateStr = String(rawDate || '').trim();

    if (dateStr.startsWith('──') || dateStr === 'Report Title') break;

    if (!name) {
      skipReport = (exclude === true);
      continue;
    }

    if (skipReport || !rawDate || !status) continue;

    const formattedDate = rawDate instanceof Date
      ? Utilities.formatDate(rawDate, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : dateStr;

    if (seasonStart && formattedDate < seasonStart) continue;

    raidDateSet.add(formattedDate);
    if (!playerData[name]) playerData[name] = [];
    playerData[name].push({ date: formattedDate, status });
  }

  const raidDates = Array.from(raidDateSet);
  const attendMap = {};
  const allNames  = new Set([...Object.keys(joinDateMap), ...Object.keys(playerData)]);

  for (const firstName of allNames) {
    const joinDate       = joinDateMap[firstName] || '';
    const effectiveStart = (joinDate && (!seasonStart || joinDate > seasonStart)) ? joinDate : seasonStart;
    const eligible       = effectiveStart ? raidDates.filter(d => d >= effectiveStart) : raidDates;
    if (!eligible.length) continue;

    const rows         = playerData[firstName] || [];
    const eligibleRows = rows.filter(r => !effectiveStart || r.date >= effectiveStart);
    const norDates     = new Set(eligibleRows.filter(r => r.status === 'Not on Roster').map(r => r.date));
    const countable    = eligible.filter(d => !norDates.has(d)).length;
    if (!countable) continue;

    const sum = eligibleRows.reduce((acc, r) => {
      if (r.status === 'Not on Roster') return acc;
      const w = ATTENDANCE_WEIGHTS[r.status];
      return acc + (w != null ? w : 0);
    }, 0);
    const pct = Math.round((sum / countable) * 1000) / 10;
    attendMap[firstName] = pct.toFixed(1) + '%';
  }

  return attendMap;
}

function getRoster(sheets, seasonStart) {
  const sheet = sheets[CFG.rosterSheet];
  if (!sheet) return [];

  const mPlusData        = getApprovedMPlusExcludedSet(sheets);
  const mPlusExcludedSet = mPlusData.excluded;
  const mPlusNoteMap     = mPlusData.notes;

  const data = sheet.getDataRange().getValues();

  // First pass: build join date map needed for attendance computation
  const joinDateMap = {};
  for (let i = CFG.rosterDataStart - 1; i < data.length; i++) {
    const nameRealm = String(data[i][CFG.rosterPlayerCol - 1] || '').trim();
    if (!nameRealm) continue;
    const firstName   = nameRealm.split('-')[0].trim();
    const rawJoinDate = data[i][CFG.rosterJoinDateCol - 1];
    joinDateMap[firstName] = rawJoinDate instanceof Date
      ? Utilities.formatDate(rawJoinDate, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : String(rawJoinDate || '').trim();
  }

  // Compute attendance from Attendance sheet, respecting season start and join dates
  const attendMap = buildAttendanceMap(sheets, seasonStart || '', joinDateMap);
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
    const bisLink       = String(row[CFG.rosterBisLinkCol  - 1] || '').trim();
    const rawJoinDate   = row[CFG.rosterJoinDateCol - 1];
    const joinDate      = rawJoinDate instanceof Date
                          ? Utilities.formatDate(rawJoinDate, Session.getScriptTimeZone(), 'yyyy-MM-dd')
                          : String(rawJoinDate || '').trim();
    const sortKey       = String(row[CFG.rosterSortKeyCol  - 1] || '').trim();
    const isBench       = String(Math.floor(Number(sortKey) / 1000)) === '6';
    const mPlusExcluded = !!mPlusExcludedSet[nameRealm.toLowerCase()];
    const mPlusNote     = mPlusNoteMap[nameRealm.toLowerCase()] || '';

    if (!role) continue;

    players.push({ nameRealm, firstName, realm, isTrial, isBench, attendance: attendMap[firstName] || '', nick, class: charClass, spec, role, bisLink, joinDate, mPlusExcluded, mPlusNote });
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
    const exclude = row[5]; // column F -- Exclude Report checkbox

    const dateStr = String(rawDate || '').trim();

    if (dateStr.startsWith('──') || dateStr === 'Report Title') break;

    if (!name) {
      skipReport = (exclude === true);
      continue;
    }

    if (skipReport) continue;
    if (!rawDate || !status) continue;
    if (!penalizing.has(status)) continue;

    const formattedDate = rawDate instanceof Date
      ? Utilities.formatDate(rawDate, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : dateStr;

    if (!result[name]) result[name] = [];
    result[name].push({ date: formattedDate, status });
  }

  return result;
}

function getRawAttendanceData(sheets) {
  const joinDateMap = buildJoinDateMap(sheets);
  const sheet       = sheets[CFG.attendanceSheet];
  if (!sheet) return { raidDates: [], players: {}, joinDates: {} };

  const data        = sheet.getDataRange().getValues();
  const raidDateSet = new Set();
  const players     = {};
  var   skipReport  = false;

  for (let i = CFG.attendDataStart - 1; i < data.length; i++) {
    const row     = data[i];
    const rawDate = row[CFG.attendDateCol   - 1];
    const name    = String(row[CFG.attendNameCol   - 1] || '').trim();
    const status  = String(row[CFG.attendStatusCol - 1] || '').trim();
    const exclude = row[5];
    const dateStr = String(rawDate || '').trim();

    if (dateStr.startsWith('──') || dateStr === 'Report Title') break;
    if (!name) { skipReport = (exclude === true); continue; }
    if (skipReport || !rawDate || !status) continue;

    const formattedDate = rawDate instanceof Date
      ? Utilities.formatDate(rawDate, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : dateStr;

    raidDateSet.add(formattedDate);
    if (!players[name]) players[name] = [];
    players[name].push({ date: formattedDate, status });
  }

  return {
    raidDates: Array.from(raidDateSet).sort(),
    players:   players,
    joinDates: joinDateMap,
  };
}

function getRecentAttendanceTrend(sheets) {
  const sheet = sheets[CFG.attendanceSheet];
  if (!sheet) return {};

  const data   = sheet.getDataRange().getValues();
  const result = {};
  var   skipReport = false;

  for (let i = CFG.attendDataStart - 1; i < data.length; i++) {
    const row     = data[i];
    const rawDate = row[CFG.attendDateCol   - 1];
    const name    = String(row[CFG.attendNameCol   - 1] || '').trim();
    const status  = String(row[CFG.attendStatusCol - 1] || '').trim();
    const exclude = row[5];

    const dateStr = String(rawDate || '').trim();
    if (dateStr.startsWith('──') || dateStr === 'Report Title') break;

    if (!name) {
      skipReport = (exclude === true);
      continue;
    }

    if (skipReport) continue;
    if (!rawDate || !status || status === 'Not on Roster') continue;

    const formattedDate = (rawDate instanceof Date)
      ? Utilities.formatDate(rawDate, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : dateStr;

    if (!result[name]) result[name] = [];
    result[name].push({ date: formattedDate, status });
  }

  return result;
}

function getFullAttendanceDetails(sheets) {
  const seasonStart = PropertiesService.getScriptProperties().getProperty('seasonStart') || '';
  const joinDateMap = buildJoinDateMap(sheets);

  const sheet = sheets[CFG.attendanceSheet];
  if (!sheet) return {};

  const data       = sheet.getDataRange().getValues();
  const result     = {};
  var   skipReport = false;

  for (let i = CFG.attendDataStart - 1; i < data.length; i++) {
    const row     = data[i];
    const rawDate = row[CFG.attendDateCol    - 1];
    const name    = String(row[CFG.attendNameCol    - 1] || '').trim();
    const status  = String(row[CFG.attendStatusCol  - 1] || '').trim();
    const exclude = row[5];

    const dateStr = String(rawDate || '').trim();

    if (dateStr.startsWith('──') || dateStr === 'Report Title') break;

    if (!name) {
      skipReport = (exclude === true);
      continue;
    }

    if (skipReport) continue;
    if (!rawDate || !status) continue;

    var formattedDate;
    if (rawDate instanceof Date) {
      formattedDate = Utilities.formatDate(rawDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } else {
      formattedDate = dateStr;
    }

    // Label raids before effective start as "Not on Roster" so officers see the full timeline
    const joinDate       = joinDateMap[name] || '';
    const effectiveStart = (joinDate && (!seasonStart || joinDate > seasonStart)) ? joinDate : seasonStart;
    const entryStatus    = (effectiveStart && formattedDate < effectiveStart) ? 'Not on Roster' : status;

    if (!result[name]) result[name] = [];
    result[name].push({ date: formattedDate, status: entryStatus });
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
  const result  = {};
  const seenKeys = new Set(); // cross-source dedup: name|item|date

  function normName(str) {
    return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  function addEntry(name, item, difficulty, date, season) {
    const key = name + '|' + item.toLowerCase() + '|' + date;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    if (!result[name]) result[name] = { count: 0, heroicCount: 0, mythicCount: 0, items: [] };
    result[name].count++;
    if (difficulty === 'Heroic') result[name].heroicCount++;
    else if (difficulty === 'Mythic') result[name].mythicCount++;
    result[name].items.push({ name: item, difficulty: difficulty, date: date, season: season || '' });
  }

  // Read from Pasted Loot sheet first (RCLC import via officer dashboard) so its
  // entries take priority when deduplicating against the IMPORTRANGE source below.
  // Columns: A=Season, B=RCLC ID, C=Player, D=Date, E=Item Name, F=Instance
  const pastedSheet = sheets[CFG.pastedLootSheet];
  if (pastedSheet && pastedSheet.getLastRow() >= 2) {
    const pastedData = pastedSheet.getDataRange().getValues();
    for (let i = 1; i < pastedData.length; i++) {
      const row      = pastedData[i];
      const season   = String(row[0] || '').trim();
      const player   = String(row[2] || '').trim();
      const rawDate  = row[3];
      const date     = rawDate instanceof Date
        ? Utilities.formatDate(rawDate, Session.getScriptTimeZone(), 'MMM d, yyyy')
        : String(rawDate || '').trim();
      const item     = String(row[4] || '').trim();
      const instance = String(row[5] || '').trim();
      if (!player || !instance) continue;

      const name = normName(player.split('-')[0]);
      if (!name) continue;

      const diffRaw    = instance.split('-').pop().trim().toLowerCase();
      const difficulty = diffRaw === 'mythic' ? 'Mythic' : diffRaw === 'heroic' ? 'Heroic' : 'Other';

      addEntry(name, item || 'Unknown Item', difficulty, date, season);
    }
  }

  // Read from Loot Data sheet (IMPORTRANGE source). Entries already seen in
  // Pasted Loot are skipped automatically via the seenKeys set.
  const sheet = sheets[CFG.lootSheet];
  if (sheet) {
    const data = sheet.getDataRange().getValues();
    for (let i = CFG.lootDataStart - 1; i < data.length; i++) {
      const row      = data[i];
      const player   = String(row[CFG.lootPlayerCol   - 1] || '').trim();
      const rawDate  = row[CFG.lootDateCol            - 1];
      const item     = String(row[3]                       || '').trim().replace(/^\[|\]$/g, '');
      const instance = String(row[CFG.lootInstanceCol - 1] || '').trim();
      if (!player || !item) continue;

      const name = normName(player.split('-')[0]);
      if (!name) continue;

      const diffRaw    = instance.split('-').pop().trim().toLowerCase();
      const difficulty = diffRaw === 'mythic' ? 'Mythic' : diffRaw === 'heroic' ? 'Heroic' : 'Other';
      const date       = rawDate instanceof Date
        ? Utilities.formatDate(rawDate, Session.getScriptTimeZone(), 'MMM d, yyyy')
        : String(rawDate || '').trim();

      addEntry(name, item, difficulty, date);
    }
  }

  return result;
}

function ensurePastedLootSheet(ss) {
  let sheet = ss.getSheetByName(CFG.pastedLootSheet);
  if (!sheet) {
    sheet = ss.insertSheet(CFG.pastedLootSheet);
    sheet.getRange(1, 1, 1, 6).setValues([['Season', 'RCLC ID', 'Player', 'Date', 'Item Name', 'Instance']]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getPastedLootSummary(ss) {
  const sheet = ss.getSheetByName(CFG.pastedLootSheet);
  if (!sheet || sheet.getLastRow() < 2) return { count: 0, lastDate: '' };
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
  let lastTs   = 0;
  let lastDate = '';
  for (let i = 0; i < data.length; i++) {
    const raw = data[i][3]; // col D = Date
    if (raw instanceof Date) {
      if (raw.getTime() > lastTs) {
        lastTs   = raw.getTime();
        lastDate = Utilities.formatDate(raw, Session.getScriptTimeZone(), 'MMM d, yyyy');
      }
    } else {
      const d = String(raw || '').trim();
      if (d > lastDate) lastDate = d;
    }
  }
  return { count: data.length, lastDate: lastDate };
}

function appendLootRowsToSheet(season, rows, ss) {
  const sheet = ensurePastedLootSheet(ss);
  const tz    = Session.getScriptTimeZone();

  // Normalize any date value (Date object or "YYYY/MM/DD" / "YYYY-MM-DD" string) to "YYYY-MM-DD".
  function normDateKey(raw) {
    if (raw instanceof Date) return Utilities.formatDate(raw, tz, 'yyyy-MM-dd');
    const s = String(raw || '').trim();
    const m = s.match(/^(\d{4})[\/\-](\d{2})[\/\-](\d{2})/);
    return m ? m[1] + '-' + m[2] + '-' + m[3] : s.substring(0, 10);
  }

  // Parse a date string into a real Date object so setValues() stores a native date cell.
  // Uses local-date construction (year, month, day) to avoid UTC midnight rollover.
  function parseDateObj(raw) {
    const s = String(raw || '').trim();
    const m = s.match(/^(\d{4})[\/\-](\d{2})[\/\-](\d{2})/);
    if (m) return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    return s; // fallback: store as-is
  }

  // Build dedup sets: RCLC IDs (col B) and composite player|item|instance|date keys
  const existingIds  = new Set();
  const existingKeys = new Set();
  if (sheet.getLastRow() >= 2) {
    const data = sheet.getRange(2, 2, sheet.getLastRow() - 1, 5).getValues(); // cols B-F
    for (let i = 0; i < data.length; i++) {
      const id       = String(data[i][0] || '').trim();
      const player   = String(data[i][1] || '').trim();
      const dateKey  = normDateKey(data[i][2]);
      const itemName = String(data[i][3] || '').trim();
      const instance = String(data[i][4] || '').trim();
      if (id) existingIds.add(id);
      existingKeys.add(player + '|' + itemName + '|' + instance + '|' + dateKey);
    }
  }

  const toWrite = [];
  for (let i = 0; i < rows.length; i++) {
    const r        = rows[i];
    const id       = String(r.id       || '').trim();
    const player   = String(r.player   || '').trim();
    const dateKey  = normDateKey(r.date);
    const itemName = String(r.itemName || '').trim();
    const instance = String(r.instance || '').trim();
    const compKey  = player + '|' + itemName + '|' + instance + '|' + dateKey;

    if ((id && existingIds.has(id)) || existingKeys.has(compKey)) continue;

    if (id) existingIds.add(id);
    existingKeys.add(compKey);
    toWrite.push([season, id, player, parseDateObj(r.date), itemName, instance]);
  }

  if (toWrite.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, toWrite.length, 6).setValues(toWrite);
  }

  return { written: toWrite.length, skipped: rows.length - toWrite.length };
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
    if (field === 'spec') {
      sheet.getRange(sheetRow, CFG.rosterSpecCol).setValue(String(value || ''));
    } else if (field === 'class') {
      sheet.getRange(sheetRow, CFG.rosterClassCol).setValue(String(value || ''));
    } else if (field === 'isTrial') {
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
    } else if (field === 'joinDate') {
      sheet.getRange(sheetRow, CFG.rosterJoinDateCol).setValue(String(value || ''));
    }
    return;
  }
}

function renamePlayerInRoster(oldNameRealm, newNameRealm) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Update Roster sheet
  const rosterSheet = ss.getSheetByName(CFG.rosterSheet);
  if (!rosterSheet) return;
  const rosterData = rosterSheet.getDataRange().getValues();
  let found = false;
  for (let i = CFG.rosterDataStart - 1; i < rosterData.length; i++) {
    const rowPlayer = String(rosterData[i][CFG.rosterPlayerCol - 1] || '').trim();
    if (rowPlayer.toLowerCase() !== oldNameRealm.toLowerCase()) continue;
    rosterSheet.getRange(i + 1, CFG.rosterPlayerCol).setValue(newNameRealm);
    found = true;
    break;
  }
  if (!found) return;

  // Migrate officer notes keyed by nameRealm
  const notes = getPlayerNotes();
  if (notes[oldNameRealm] !== undefined) {
    notes[newNameRealm] = notes[oldNameRealm];
    delete notes[oldNameRealm];
    setPlayerNotes(notes);
  }

  const oldFirstName = oldNameRealm.split('-')[0].trim();
  const newFirstName = newNameRealm.split('-')[0].trim();
  if (oldFirstName.toLowerCase() === newFirstName.toLowerCase()) return;

  // firstName changed: update Attendance sheet (col B = firstName)
  const attendSheet = ss.getSheetByName(CFG.attendanceSheet);
  if (attendSheet && attendSheet.getLastRow() >= CFG.attendDataStart) {
    const attendData = attendSheet.getDataRange().getValues();
    for (let i = CFG.attendDataStart - 1; i < attendData.length; i++) {
      const cell = String(attendData[i][CFG.attendNameCol - 1] || '').trim();
      if (cell.toLowerCase() === oldFirstName.toLowerCase()) {
        attendSheet.getRange(i + 1, CFG.attendNameCol).setValue(newFirstName);
      }
    }
  }

  // firstName changed: update Pasted Loot sheet (col C = "Name-Realm", keyed by firstName)
  const pastedSheet = ss.getSheetByName(CFG.pastedLootSheet);
  if (pastedSheet && pastedSheet.getLastRow() >= 2) {
    const pastedData = pastedSheet.getDataRange().getValues();
    for (let i = 1; i < pastedData.length; i++) {
      const cell  = String(pastedData[i][2] || '').trim();
      const parts = cell.split('-');
      if (parts[0].toLowerCase() === oldFirstName.toLowerCase()) {
        const updatedPlayer = newFirstName + (parts.length > 1 ? '-' + parts.slice(1).join('-') : '');
        pastedSheet.getRange(i + 1, 3).setValue(updatedPlayer);
      }
    }
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

function addPlayerToRoster(data) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CFG.rosterSheet);
  if (!sheet) return;

  const nameRealm = String(data.nameRealm || '').trim();
  if (!nameRealm) return;
  const isTrial  = data.isTrial === true || data.isTrial === 'true';
  const nick     = String(data.nick     || '').trim();
  const cls      = String(data.class    || '').trim();
  const spec     = String(data.spec     || '').trim();
  const role     = String(data.role     || 'Melee').trim();
  const priority = roleToPriority(role);

  // Find the last row that has a valid role in col H, then write to the row after it.
  // Scanning col H (not col D) avoids being fooled by legend/note rows that have text
  // in the player-name column but are not actual player entries.
  const VALID_ROLES = new Set(['Tank', 'Heal', 'Melee', 'Ranged']);
  const lastRow = sheet.getLastRow();
  const colH    = sheet.getRange(CFG.rosterDataStart, CFG.rosterRoleCol,
                    lastRow - CFG.rosterDataStart + 1, 1).getValues();
  let targetRow = CFG.rosterDataStart;
  for (let r = 0; r < colH.length; r++) {
    if (VALID_ROLES.has(String(colH[r][0] || '').trim())) {
      targetRow = CFG.rosterDataStart + r + 1;
    }
  }

  const now      = new Date();
  const todayStr = now.getFullYear() + '-' +
                   String(now.getMonth() + 1).padStart(2, '0') + '-' +
                   String(now.getDate()).padStart(2, '0');
  const rawJoin  = String(data.joinDate || '').trim();
  const joinDate = /^\d{4}-\d{2}-\d{2}$/.test(rawJoin) ? rawJoin : todayStr;

  // Write only the columns this app owns — don't touch col A or any formula columns.
  sheet.getRange(targetRow, CFG.rosterTrialCol).setValue(isTrial);
  sheet.getRange(targetRow, CFG.rosterPlayerCol).setValue(nameRealm);
  sheet.getRange(targetRow, CFG.rosterNickCol).setValue(nick);
  sheet.getRange(targetRow, CFG.rosterClassCol).setValue(cls);
  sheet.getRange(targetRow, CFG.rosterSpecCol).setValue(spec);
  sheet.getRange(targetRow, CFG.rosterRoleCol).setValue(role);
  sheet.getRange(targetRow, CFG.rosterPriorityCol).setValue(priority);
  sheet.getRange(targetRow, CFG.rosterJoinDateCol).setValue(joinDate);
}

function removePlayerFromRoster(nameRealm) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CFG.rosterSheet);
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  for (let i = CFG.rosterDataStart - 1; i < data.length; i++) {
    const rowPlayer = String(data[i][CFG.rosterPlayerCol - 1] || '').trim();
    if (rowPlayer.toLowerCase() === nameRealm.toLowerCase()) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
}

function clearRosterCache() {
  const cache = CacheService.getScriptCache();
  cache.remove('rosterCore');
  cache.remove('rosterHeavy');
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

// ── Signup helpers ────────────────────────────────────────────────────────────

function updateSignupStatus(row, status) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CFG.responsesSheet);
  if (!sheet) return;
  sheet.getRange(row, 10).setValue(status);
}

function writeToApplicants(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CFG.applicantsSheet);
  if (!sheet) {
    sheet = ss.insertSheet(CFG.applicantsSheet);
    sheet.appendRow(['Character-Realm', 'Class', 'Main Spec', 'Off Specs', 'Role', 'Discord']);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([
    (data.charName || '') + (data.realm ? '-' + data.realm : ''),
    data.className || '',
    data.mainSpec  || '',
    data.offSpecs  || '',
    data.role      || '',
    data.discord   || ''
  ]);
}

function getPendingRosterEntries() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CFG.applicantsSheet);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const data    = sheet.getDataRange().getValues();
  const results = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    // Old format had Timestamp in col A; detect by checking if col A is a Date
    const o = (row[0] instanceof Date) ? 1 : 0;
    if (!row[0 + o]) continue;
    results.push({
      rowIndex:  i + 1,
      nameRealm: String(row[0 + o] || ''),
      className: String(row[1 + o] || ''),
      mainSpec:  String(row[2 + o] || ''),
      offSpecs:  String(row[3 + o] || ''),
      role:      String(row[4 + o] || ''),
      discord:   String(row[5 + o] || '')
    });
  }
  return results.reverse();
}

// ── M+ Exclusion helpers ──────────────────────────────────────────────────────

function writeMPlusExclusionRequest(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CFG.mPlusExclusionSheet);
  if (!sheet) {
    sheet = ss.insertSheet(CFG.mPlusExclusionSheet);
    sheet.appendRow(['Timestamp', 'Name-Realm', 'Raider.io URL', 'Notes', 'Status', 'Officer Note']);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([
    new Date(),
    data.nameRealm   || '',
    data.raiderioUrl || '',
    data.notes       || '',
    'Pending'
  ]);
}

function getMPlusExclusionRequests(statusFilter) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CFG.mPlusExclusionSheet);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data    = sheet.getDataRange().getValues();
  const results = [];
  for (let i = 1; i < data.length; i++) {
    const row    = data[i];
    const status = String(row[4] || '').trim();
    if (statusFilter && status !== statusFilter) continue;
    if (!row[1]) continue;
    const ts = row[0] instanceof Date
      ? Utilities.formatDate(row[0], Session.getScriptTimeZone(), 'MMM d, yyyy HH:mm')
      : String(row[0] || '');
    results.push({
      rowIndex:    i + 1,
      timestamp:   ts,
      nameRealm:   String(row[1] || ''),
      raiderioUrl: String(row[2] || ''),
      notes:       String(row[3] || ''),
      status:      status,
      officerNote: String(row[5] || '')
    });
  }
  return results.reverse();
}

function updateMPlusExclusionStatus(row, status) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CFG.mPlusExclusionSheet);
  if (!sheet) return;
  sheet.getRange(row, 5).setValue(status);
}

// ── Officer Audit Log ─────────────────────────────────────────────────────────

function ensureAuditLogSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CFG.auditLogSheet);
  if (!sheet) {
    sheet = ss.insertSheet(CFG.auditLogSheet);
    sheet.appendRow(['Timestamp', 'Changed By', 'Action', 'Target', 'Old Value', 'New Value']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// changedBy: officer identity — empty string until Discord OAuth ships (#25/#46)
function appendAuditLog(action, target, oldVal, newVal, changedBy) {
  try {
    const sheet = ensureAuditLogSheet();
    sheet.appendRow([
      new Date(),
      changedBy || '',
      action || '',
      target || '',
      oldVal !== undefined && oldVal !== null ? String(oldVal) : '',
      newVal !== undefined && newVal !== null ? String(newVal) : ''
    ]);
  } catch (err) {
    Logger.log('appendAuditLog error: ' + err);
  }
}

function getAuditLog() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CFG.auditLogSheet);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
  return rows.reverse().map(function(r) {
    return {
      ts:     r[0] instanceof Date
                ? Utilities.formatDate(r[0], Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm')
                : String(r[0] || ''),
      changedBy: String(r[1] || ''),
      action: String(r[2] || ''),
      target: String(r[3] || ''),
      oldVal: String(r[4] || ''),
      newVal: String(r[5] || '')
    };
  });
}

// ── Audit log read helpers (capture old values before mutations) ───────────────

function getRosterFieldValue(nameRealm, field) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CFG.rosterSheet);
  if (!sheet) return '';
  const data = sheet.getDataRange().getValues();
  for (let i = CFG.rosterDataStart - 1; i < data.length; i++) {
    const rowPlayer = String(data[i][CFG.rosterPlayerCol - 1] || '').trim();
    if (rowPlayer.toLowerCase() !== nameRealm.toLowerCase()) continue;
    if (field === 'spec')     return String(data[i][CFG.rosterSpecCol     - 1] || '');
    if (field === 'class')    return String(data[i][CFG.rosterClassCol    - 1] || '');
    if (field === 'isTrial')  return String(data[i][CFG.rosterTrialCol    - 1] || '');
    if (field === 'role')     return String(data[i][CFG.rosterRoleCol     - 1] || '');
    if (field === 'joinDate') { const v = data[i][CFG.rosterJoinDateCol - 1]; return v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(v || ''); }
    if (field === 'isBench')  return Number(data[i][CFG.rosterPriorityCol - 1] || 0) === 6 ? 'true' : 'false';
    return '';
  }
  return '';
}

function getRosterBisLink(nameRealm) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CFG.rosterSheet);
  if (!sheet) return '';
  const data = sheet.getDataRange().getValues();
  for (let i = CFG.rosterDataStart - 1; i < data.length; i++) {
    const rowPlayer = String(data[i][CFG.rosterPlayerCol - 1] || '').trim();
    if (rowPlayer.toLowerCase() === nameRealm.toLowerCase()) {
      return String(data[i][CFG.rosterBisLinkCol - 1] || '');
    }
  }
  return '';
}

function getBiSNameRealmFromRow(row) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CFG.bisResponsesSheet);
  if (!sheet) return '';
  return String(sheet.getRange(row, 2).getValue() || '');
}

function getMPlusNameRealmFromRow(row) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CFG.mPlusExclusionSheet);
  if (!sheet) return '';
  return String(sheet.getRange(row, 2).getValue() || '');
}

function getSelfReceivedRowSummary(row) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CFG.selfReceivedSheet);
  if (!sheet) return { player: '', item: '' };
  const vals = sheet.getRange(row, 1, 1, 3).getValues()[0];
  return { player: String(vals[1] || ''), item: String(vals[2] || '') };
}

function getSignupNameFromRow(row) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CFG.responsesSheet);
  if (!sheet) return '';
  const vals = sheet.getRange(row, 1, 1, 3).getValues()[0];
  const char  = String(vals[1] || '');
  const realm = String(vals[2] || '');
  return realm ? char + '-' + realm : char;
}

