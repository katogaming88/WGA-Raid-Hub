// ════════════════════════════════════════════════════════════════════════════
// WGA Raid Hub — Roster Web App
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
  prioritySheet:         'Priority Order',
  priorityDifficultyCol: 1,  // A -- Difficulty (Heroic / Mythic)
  priorityItemCol:       2,
  priorityRankStart:     3,
  priorityDataStart:     2,

  // ── Item Lookup tab ───────────────────────────────────────────────────
  itemLookupSheet:    'Item Lookup',
  itemNameCol:        1,
  itemSlotCol:        3,
  itemArmorTypeCol:   4,
  itemSortIdCol:      5,
  itemBossCol:        6,
  itemDataStart:      3,

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

  // ── Settings tab ─────────────────────────────────────────────────
  settingsSheet:       'Settings',

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

var HAS_HEROIC_MULTIPLIER            = 0.85; // mythic prio penalty for players who already have the heroic version
var HAS_CHAMPION_MULTIPLIER          = 1.07; // mythic prio small bonus for players who only have the champion (normal) version
var HAS_NEITHER_MULTIPLIER           = 1.15; // mythic prio bonus for players who have no version of the item at all
var HAS_CHAMPION_FOR_HEROIC_MULT     = 0.90; // heroic prio penalty for players who already have the champion (normal) version

function doGet(e) {
  try {
    const cache    = CacheService.getScriptCache();
    const props    = PropertiesService.getScriptProperties();
    const action   = e && e.parameter && e.parameter.action;
    const callback = e && e.parameter && e.parameter.callback;
    // Prefer a Discord session token (old cached frontends still send one) and
    // fall back to an explicit changedBy the Supabase-auth frontend passes,
    // since the mapped session no longer carries a token (#364).
    _currentChangedBy =
      resolveChangedBy(String(e && e.parameter && e.parameter.token || '')) ||
      String((e && e.parameter && e.parameter.changedBy) || '');

    if (action === 'clearCache') {
      cache.remove('rosterCore');
      cache.remove('rosterHeavy');
      cache.remove('rosterPayload');
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

    if (action === 'refreshWclPerformance') {
      try {
        const result = refreshWclPerformanceCore();
        appendAuditLog('WCL Performance Refreshed', '', '', `${result.updated} players updated, ${result.recentReports} recent / ${result.trendReports} trend reports`);
        return jsonpResponse(callback, { success: true, updated: result.updated, scores: result.scores, recentReports: result.recentReports, trendReports: result.trendReports });
      } catch (err) {
        return jsonpResponse(callback, { success: false, error: err.message });
      }
    }

    if (action === 'setManualScore') {
      const firstName = String(e.parameter.firstName || '').trim();
      const score     = parseFloat(e.parameter.score);
      if (!firstName)   return jsonpResponse(callback, { success: false, error: 'Missing firstName' });
      if (isNaN(score)) return jsonpResponse(callback, { success: false, error: 'Invalid score' });
      try {
        setManualScoreCore(firstName, score);
        appendAuditLog('Manual Score Set', firstName, '', score.toFixed(2));
        return jsonpResponse(callback, { success: true });
      } catch (err) {
        return jsonpResponse(callback, { success: false, error: err.message });
      }
    }

    if (action === 'commitPerformanceScores') {
      try {
        const result = commitPerformanceScoresCore();
        appendAuditLog('Performance Scores Committed', '', '', `${result.committed} players`);
        return jsonpResponse(callback, { success: true, committed: result.committed });
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

    if (action === 'setReportExcluded') {
      const date     = String(e.parameter.date     || '').trim();
      const excluded = e.parameter.excluded === 'true';
      if (!date) return jsonpResponse(callback, { success: false, error: 'Missing date' });
      try {
        setReportExcludedInSheet(date, excluded);
        appendAuditLog(excluded ? 'Report Excluded' : 'Report Exclusion Removed', date, '', '');
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

    if (action === 'setTrialThresholds') {
      const weeks  = Math.max(1,  Math.min(52,  parseInt(e.parameter.weeks)  || 4));
      const attend = Math.max(0,  Math.min(100, parseInt(e.parameter.attend) || 75));
      props.setProperty('trialWeeks',  String(weeks));
      props.setProperty('trialAttend', String(attend));
      cache.remove('rosterCore');
      appendAuditLog('Trial Thresholds Set', '', '', weeks + ' wk / ' + attend + '%');
      return jsonpResponse(callback, { success: true, trialWeeks: weeks, trialAttend: attend });
    }

    if (action === 'setSeasonEnd') {
      const val = String(e.parameter.value || '').trim();
      props.setProperty('seasonEnd', val);
      cache.remove('rosterCore');
      appendAuditLog('Season End Set', '', '', val);
      return jsonpResponse(callback, { success: true, seasonEnd: val });
    }

    if (action === 'saveRaidProgression') {
      let raids = [];
      try { raids = JSON.parse(decodeURIComponent(String(e.parameter.data || ''))); } catch (parseErr) { Logger.log('saveRaidProgression parse error: ' + parseErr); }
      if (!Array.isArray(raids)) return jsonpResponse(callback, { error: 'Invalid data' });
      props.setProperty('raidProgression', JSON.stringify(raids));
      cache.remove('rosterCore');
      appendAuditLog('Raid Progression Saved', '', '', raids.length + ' raid(s)');
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'getWclZoneEncounters') {
      const zoneId = parseInt(e.parameter.zoneId, 10);
      if (!zoneId || isNaN(zoneId)) return jsonpResponse(callback, { error: 'Missing or invalid zoneId' });
      try {
        const token = getAccessToken();
        if (!token) throw new Error('Failed to get WCL access token');
        const query = `query { worldData { zone(id: ${zoneId}) { name encounters { id name } } } }`;
        const result = wclQuery(token, query);
        const zone = result && result.data && result.data.worldData && result.data.worldData.zone;
        if (!zone) throw new Error('Zone not found');
        return jsonpResponse(callback, { success: true, zoneName: zone.name, encounters: zone.encounters || [] });
      } catch (err) {
        return jsonpResponse(callback, { error: err.message });
      }
    }

    if (action === 'fetchWclProgression') {
      const zoneId = parseInt(e.parameter.zoneId, 10);
      if (!zoneId || isNaN(zoneId)) return jsonpResponse(callback, { error: 'Missing or invalid zoneId' });
      try {
        return jsonpResponse(callback, fetchWclProgressionData(zoneId));
      } catch (err) {
        return jsonpResponse(callback, { error: err.message });
      }
    }

    if (action === 'archiveSeason') {
      const seasonName      = props.getProperty('seasonName')      || '';
      const seasonStart     = props.getProperty('seasonStart')     || '';
      const seasonEnd       = props.getProperty('seasonEnd')       || '';
      const raidProgression = JSON.parse(props.getProperty('raidProgression') || '[]');
      const history         = JSON.parse(props.getProperty('seasonHistory') || '[]');

      // Capture a read-only roster snapshot before clearing the season
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheets = {};
      for (const sheet of ss.getSheets()) { sheets[sheet.getName()] = sheet; }
      const rosterPlayers = getRoster(sheets, seasonStart);
      const snapshot = rosterPlayers.map(function(p) {
        return {
          nameRealm:  p.nameRealm,
          role:       p.role,
          isTrial:    p.isTrial,
          isBench:    p.isBench,
          joinDate:   p.joinDate,
          attendance: p.attendance
        };
      });
      const snapshotKey = 'rosterSnapshot_' + Date.now();
      props.setProperty(snapshotKey, JSON.stringify(snapshot));

      history.push({ name: seasonName, start: seasonStart, end: seasonEnd, raids: raidProgression, snapshotKey: snapshotKey });
      props.setProperty('seasonHistory', JSON.stringify(history));
      props.deleteProperty('seasonName');
      props.deleteProperty('seasonStart');
      props.deleteProperty('seasonEnd');
      props.deleteProperty('raidProgression');
      clearBisListSheet(ss);
      cache.remove('rosterCore');
      cache.remove('rosterHeavy');
      appendAuditLog('Season Archived', '', '', seasonName);
      return jsonpResponse(callback, { success: true, snapshotKey: snapshotKey });
    }

    if (action === 'unarchiveSeason') {
      const index   = parseInt(e.parameter.index, 10);
      const history = JSON.parse(props.getProperty('seasonHistory') || '[]');
      if (isNaN(index) || index < 0 || index >= history.length) {
        return jsonpResponse(callback, { error: 'Invalid season index' });
      }
      const season = history.splice(index, 1)[0];
      props.setProperty('seasonHistory',    JSON.stringify(history));
      props.setProperty('seasonName',       season.name  || '');
      props.setProperty('seasonStart',      season.start || '');
      props.setProperty('seasonEnd',        season.end   || '');
      props.setProperty('raidProgression',  JSON.stringify(season.raids || []));
      cache.remove('rosterCore');
      cache.remove('rosterHeavy');
      appendAuditLog('Season Unarchived', '', '', season.name || '');
      return jsonpResponse(callback, { success: true, season: season });
    }

    if (action === 'getRosterSnapshot') {
      const key = String(e.parameter.key || '').trim();
      if (!key || key.indexOf('rosterSnapshot_') !== 0) return jsonpResponse(callback, { error: 'Invalid key' });
      const val = props.getProperty(key);
      if (!val) return jsonpResponse(callback, { players: [] });
      try {
        return jsonpResponse(callback, { players: JSON.parse(val) });
      } catch (_) {
        return jsonpResponse(callback, { players: [] });
      }
    }

    // ── Admin actions ──────────────────────────────────────────────────────

    if (action === 'getAdminProperties') {
      const history    = JSON.parse(props.getProperty('seasonHistory')    || '[]');
      const raids      = JSON.parse(props.getProperty('raidProgression')  || '[]');
      return jsonpResponse(callback, {
        seasonName:           props.getProperty('seasonName')          || '',
        seasonStart:          props.getProperty('seasonStart')         || '',
        seasonEnd:            props.getProperty('seasonEnd')           || '',
        seasonHistoryCount:   history.length,
        raidProgressionCount: raids.length,
        signupsOpen:          props.getProperty('signupsOpen')         || 'false',
        bisSubmissionsOpen:   props.getProperty('bisSubmissionsOpen')  || 'false',
        mPlusExclusionsOpen:  props.getProperty('mPlusExclusionsOpen') || 'false',
      });
    }

    if (action === 'dangerClearSeasonHistory') {
      props.deleteProperty('seasonHistory');
      cache.remove('rosterCore');
      appendAuditLog('DANGER: Season History Cleared', '', '', '');
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'dangerClearSheet') {
      const sheetName = String(e.parameter.sheet || '').trim();
      const allowed   = ['Loot Data', 'Pasted Loot', 'BiS Responses', 'Roster Responses',
                         'M+ Exclusion Requests', 'Pending Roster', 'Self Received Requests'];
      if (!allowed.includes(sheetName)) return jsonpResponse(callback, { error: 'Sheet not permitted' });
      const ss    = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(sheetName);
      if (!sheet) return jsonpResponse(callback, { error: 'Sheet not found: ' + sheetName });
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
      cache.remove('rosterCore');
      cache.remove('rosterHeavy');
      appendAuditLog('DANGER: Sheet Cleared', sheetName, '', '');
      return jsonpResponse(callback, { success: true });
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
      const data         = JSON.parse(decodeURIComponent(e.parameter.data || '{}'));
      const sessionToken = String(e.parameter.sessionToken || '').trim();
      // Auto-approve when the submitting raider is Discord-authenticated as the same character.
      // The token validation confirms identity server-side; no client-side trust is needed.
      let autoApproved = false;
      if (sessionToken) {
        const session = validateDiscordSession(sessionToken);
        if (session.valid && session.nameRealm) {
          const sessionFirst = session.nameRealm.split('-')[0].trim().toLowerCase();
          const playerFirst  = String(data.player || '').split('-')[0].trim().toLowerCase();
          if (sessionFirst && sessionFirst === playerFirst) {
            writeSelfReceivedRequest(data, 'Approved');
            cache.remove('rosterHeavy');
            appendAuditLog('Loot Marked Received (self)', String(data.player || ''), '', String(data.item || ''));
            autoApproved = true;
          }
        }
      }
      if (!autoApproved) {
        writeSelfReceivedRequest(data);
      }
      return jsonpResponse(callback, { success: true, autoApproved: autoApproved });
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

    if (action === 'setBisItems') {
      const data      = JSON.parse(decodeURIComponent(e.parameter.data || '{}'));
      const nameRealm = String(data.nameRealm || '').trim();
      const items     = Array.isArray(data.items) ? data.items : [];
      if (!nameRealm) return jsonpResponse(callback, { error: 'Missing nameRealm' });
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      setBisItemsForPlayer(ss, nameRealm, items);
      cache.remove('rosterHeavy');
      appendAuditLog('BiS List Updated', nameRealm, '', String(items.length) + ' items');
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
      const rowData    = sheet.getRange(row, 1, 1, 12).getValues()[0];
      const charName   = String(rowData[1] || '');
      const realm      = String(rowData[2] || '');
      const signupName = realm ? charName + '-' + realm : charName;
      const mainSwap   = String(rowData[10] || '').trim();
      const season     = String(rowData[11] || '').trim() || getActiveSignupSeason();

      writeToApplicants({
        charName:    charName,
        realm:       realm,
        className:   String(rowData[3] || ''),
        mainSpec:    String(rowData[4] || ''),
        offSpecs:    String(rowData[5] || ''),
        role:        String(rowData[6] || ''),
        discord:     String(rowData[7] || ''),
        notes:       String(rowData[8] || ''),
        mainSwap:    mainSwap,
        season:      season,
        submittedAt: rowData[0] instanceof Date ? rowData[0].toISOString() : String(rowData[0] || '')
      });
      updateSignupStatus(row, 'Approved');
      appendAuditLog('Signup Approved', signupName, '', '');

      // Main swap: if set and on the roster, remove the old character and clear their Discord claim
      if (mainSwap) {
        const sheets = {};
        for (const s of ss.getSheets()) { sheets[s.getName()] = s; }
        const rData2 = ss.getSheetByName(CFG.rosterSheet).getDataRange().getValues();
        let swapOnRoster = false;
        for (let i = CFG.rosterDataStart - 1; i < rData2.length; i++) {
          const existing = String(rData2[i][CFG.rosterPlayerCol - 1] || '').trim();
          if (existing.toLowerCase() === mainSwap.toLowerCase()) { swapOnRoster = true; break; }
        }
        if (swapOnRoster) {
          removePlayerFromRoster(mainSwap);
          clearDiscordClaimForNameRealm(ss, props, mainSwap);
          appendAuditLog('Main Swap: Old Character Removed', mainSwap, '', signupName);
        }
      }

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
      const data      = JSON.parse(decodeURIComponent(e.parameter.data || '{}'));
      const row       = parseInt(data.row || e.parameter.row, 10);
      const note      = String(data.note || '');
      if (isNaN(row) || row < 2) return jsonpResponse(callback, { error: 'Invalid row' });
      const nameRealm = getMPlusNameRealmFromRow(row);
      updateMPlusExclusionStatus(row, 'Rejected');
      if (note) {
        const exSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CFG.mPlusExclusionSheet);
        if (exSheet) exSheet.getRange(row, 6).setValue(note);
      }
      cache.remove('rosterCore');
      appendAuditLog('M+ Exclusion Rejected', nameRealm, '', note || '');
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'getMissingSignups') {
      return jsonpResponse(callback, { missing: getMissingSignups() });
    }

    if (action === 'pushPendingToRoster') {
      const removeAbsent = e.parameter.removeAbsent === 'true';
      const result = pushPendingToRoster(removeAbsent);
      cache.remove('rosterCore');
      cache.remove('rosterHeavy');
      return jsonpResponse(callback, result);
    }

    if (action === 'setActiveSignupSeason') {
      const season = String(e.parameter.season || '').trim();
      if (!season) return jsonpResponse(callback, { error: 'Missing season' });
      setActiveSignupSeason(season);
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

    if (action === 'generatePriorityOrder') {
      const itemName   = String(e.parameter.item       || '').trim();
      const difficulty = String(e.parameter.difficulty || 'Heroic').trim();
      if (!itemName) return jsonpResponse(callback, { error: 'Missing item' });
      return jsonpResponse(callback, generatePriorityForItem(itemName, difficulty));
    }

    if (action === 'savePriorityOrder') {
      const itemName   = String(e.parameter.item       || '').trim();
      const difficulty = String(e.parameter.difficulty || 'Heroic').trim();
      if (!itemName) return jsonpResponse(callback, { error: 'Missing item' });
      let players = [];
      try { players = JSON.parse(decodeURIComponent(e.parameter.players || '[]')); } catch (_) { players = []; }
      if (!Array.isArray(players)) return jsonpResponse(callback, { error: 'Invalid players' });
      const result = savePriorityOrderForItem(itemName, difficulty, players);
      if (result.success) {
        cache.remove('rosterHeavy');
        appendAuditLog('Priority Order Saved (' + difficulty + ')', itemName, '', players.filter(Boolean).join(', '));
      }
      return jsonpResponse(callback, result);
    }

    // ── Officer management actions ────────────────────────────────────────

    if (action === 'addOfficer') {
      const discordId = String(e.parameter.discordId || '').trim();
      if (!discordId) return jsonpResponse(callback, { success: false, error: 'Missing discordId' });
      const officers = getOfficerIds().filter(function(id) { return id !== discordId; });
      officers.push(discordId);
      props.setProperty('officerDiscordIds', officers.join(','));
      cache.remove('rosterCore');
      const username = String(e.parameter.username || discordId);
      appendAuditLog('Officer Granted', username, '', discordId);
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'removeOfficer') {
      const discordId = String(e.parameter.discordId || '').trim();
      if (!discordId) return jsonpResponse(callback, { success: false, error: 'Missing discordId' });
      const officers = getOfficerIds().filter(function(id) { return id !== discordId; });
      props.setProperty('officerDiscordIds', officers.join(','));
      cache.remove('rosterCore');
      const username = String(e.parameter.username || discordId);
      appendAuditLog('Officer Revoked', username, '', discordId);
      return jsonpResponse(callback, { success: true });
    }

    // ── Discord OAuth actions ─────────────────────────────────────────────
    // discordOAuthCallback (Discord token exchange, DISCORD_CLIENT_ID/SECRET)
    // and the discordCallback route that called it are retired (#222):
    // discord-callback.html was deleted when login moved to Supabase Auth's
    // Discord provider (#363), so nothing has created a new discordSession_*
    // token since. validateDiscordSession/claimCharacterForSession stay --
    // resolveChangedBy() and requestSelfReceived's sessionToken param still
    // call validateDiscordSession for any pre-#363 session that might still
    // be live, even though no code path can mint a new one anymore.

    if (action === 'validateDiscordSession') {
      const token = String(e.parameter.token || '').trim();
      if (!token) return jsonpResponse(callback, { valid: false });
      return jsonpResponse(callback, validateDiscordSession(token));
    }

    if (action === 'claimCharacter') {
      const token     = String(e.parameter.token     || '').trim();
      const nameRealm = String(e.parameter.nameRealm || '').trim();
      if (!token || !nameRealm) return jsonpResponse(callback, { success: false, error: 'Missing params' });
      try {
        const result = claimCharacterForSession(token, nameRealm);
        if (result.success) cache.remove('rosterCore');
        return jsonpResponse(callback, result);
      } catch (err) {
        Logger.log('claimCharacter error: ' + err);
        return jsonpResponse(callback, { success: false, error: err.message });
      }
    }

    if (action === 'discordLogout') {
      const token = String(e.parameter.token || '').trim();
      if (token) {
        try { props.deleteProperty('discordSession_' + token); } catch (delErr) { Logger.log('discordLogout delete error: ' + delErr); }
      }
      return jsonpResponse(callback, { success: true });
    }

    if (action === 'removeDiscordClaim') {
      const nameRealm = String(e.parameter.nameRealm || '').trim();
      if (!nameRealm) return jsonpResponse(callback, { success: false, error: 'Missing nameRealm' });
      try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const claimsSheet = ss.getSheetByName('Discord Claims');
        if (claimsSheet) {
          const claimData = claimsSheet.getDataRange().getValues();
          for (let i = claimData.length - 1; i >= 1; i--) {
            if (String(claimData[i][2]).trim() === nameRealm) {
              claimsSheet.deleteRow(i + 1);
            }
          }
        }
        const allProps = props.getProperties();
        Object.keys(allProps).forEach(function(key) {
          if (key.indexOf('discordSession_') !== 0) return;
          try {
            const sess = JSON.parse(allProps[key]);
            if (sess && sess.nameRealm === nameRealm) {
              sess.nameRealm = null;
              props.setProperty(key, JSON.stringify(sess));
            }
          } catch (e) { Logger.log('removeDiscordClaim session error: ' + e); }
        });
        cache.remove('rosterCore');
        return jsonpResponse(callback, { success: true });
      } catch (err) {
        return jsonpResponse(callback, { success: false, error: err.message });
      }
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
      status:    String(row[9] || 'Pending'),
      mainSwap:  String(row[10] || ''),
      season:    String(row[11] || '')
    });
  }
  return results.reverse();
}

function writeSignup(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CFG.responsesSheet);
  if (!sheet) {
    sheet = ss.insertSheet(CFG.responsesSheet);
    sheet.appendRow(['Timestamp', 'Character', 'Realm', 'Class', 'Main Spec', 'Off Specs', 'Role', 'Discord', 'Notes', 'Status', 'Main Swap', 'Season']);
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
    'Pending',
    data.mainSwap  || '',
    getActiveSignupSeason()
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
  const seasonHistory       = JSON.parse(scriptProps.getProperty('seasonHistory')       || '[]');
  const raidProgression     = JSON.parse(scriptProps.getProperty('raidProgression')     || '[]');
  const trialWeeks          = parseInt(scriptProps.getProperty('trialWeeks'))  || 4;
  const trialAttend         = parseInt(scriptProps.getProperty('trialAttend')) || 75;
  const signupSeason        = getActiveSignupSeason();
  return {
    generatedAt:          new Date().toISOString(),
    signupsOpen:          signupsOpen,
    bisSubmissionsOpen:   bisSubmissionsOpen,
    mPlusExclusionsOpen:  mPlusExclusionsOpen,
    seasonStart:          seasonStart,
    seasonName:           seasonName,
    seasonEnd:            seasonEnd,
    seasonHistory:        seasonHistory,
    raidProgression:      raidProgression,
    trialWeeks:           trialWeeks,
    trialAttend:          trialAttend,
    signupSeason:         signupSeason,
    bisAllowedPlayers:    getBisAllowedPlayers(),
    playerNotes:          getPlayerNotes(),
    discordClaims:        getDiscordClaims(sheets),
    officerDiscordIds:    getOfficerIds(),
    roster:               getRoster(sheets, seasonStart),
  };
}

function buildHeavyPayload(sheets) {
  return {
    generatedAt:            new Date().toISOString(),
    priorityOrder:          getPriorityOrder(sheets),
    bisList:                getBisList(sheets),
    // itemSlots/itemArmorTypes/itemBosses retired (#391): the site reads the
    // item catalog from Supabase items/item_bosses exclusively. getItemSlots/
    // getItemArmorTypes/getItemBosses are left defined but unused, matching
    // how prior write migrations retired GAS handlers only once the whole
    // phase shipped.
    // lootCounts retired (#209): the site reads loot from Supabase rclc_loot.
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
  const rejected = {}; // key -> officer note (most recent rejection per player)
  const sheet = sheets[CFG.mPlusExclusionSheet];
  if (sheet && sheet.getLastRow() >= 2) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const status    = String(data[i][4] || '').trim();
      const nameRealm = String(data[i][1] || '').trim();
      const note      = String(data[i][5] || '').trim();
      if (!nameRealm) continue;
      const key = nameRealm.toLowerCase();
      if (status === 'Approved') {
        excluded[key] = true;
        if (note) notes[key] = note;
      } else if (status === 'Rejected') {
        rejected[key] = note; // later rows overwrite earlier, so last = most recent
      }
    }
  }
  // From manual overrides
  for (const nr of getMPlusManualExcluded()) {
    if (nr) excluded[nr.toLowerCase()] = true;
  }
  return { excluded, notes, rejected };
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
  const mPlusRejectedMap = mPlusData.rejected;

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
    const mPlusExcluded      = !!mPlusExcludedSet[nameRealm.toLowerCase()];
    const mPlusNote          = mPlusNoteMap[nameRealm.toLowerCase()] || '';
    const mPlusRejected      = !mPlusExcluded && (mPlusRejectedMap[nameRealm.toLowerCase()] !== undefined);
    const mPlusRejectionNote = mPlusRejected ? (mPlusRejectedMap[nameRealm.toLowerCase()] || '') : '';

    if (!role) continue;

    players.push({ nameRealm, firstName, realm, isTrial, isBench, attendance: attendMap[firstName] || '', nick, class: charClass, spec, role, bisLink, joinDate, mPlusExcluded, mPlusNote, mPlusRejected, mPlusRejectionNote });
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

    const rawDiff = String(row[CFG.priorityDifficultyCol - 1] || '').trim();
    const diff    = rawDiff ? rawDiff.toLowerCase() : 'heroic';

    const ranked = [];
    for (let c = CFG.priorityRankStart - 1; c < row.length; c++) {
      const val = String(row[c] || '').trim();
      if (val) ranked.push(val.split('-')[0].trim());
    }
    if (!result[itemName]) result[itemName] = {};
    result[itemName][diff] = ranked;
  }

  return result;
}

function generatePriorityForItem(itemName, difficulty) {
  const diff = (difficulty || 'Heroic').toLowerCase(); // 'heroic' or 'mythic'
  const ss   = SpreadsheetApp.getActiveSpreadsheet();

  // BiS players for this item -- returns Name-Realm strings from BiS sheet header row
  const bisPlayers = getBiSPlayersForItem(ss, itemName);
  if (bisPlayers.length === 0) return { players: [], warning: 'No BiS players found for this item' };

  // Check who already received this item at each difficulty
  const recipients = getItemRecipients(ss, itemName);

  // Build role / bench / trial maps using CFG column references (not PriorityGenerator constants,
  // which point at stale column positions from an older Roster layout)
  const rosterSheet = ss.getSheetByName(CFG.rosterSheet);
  const roleMap     = {};
  const benchSet    = new Set();
  const trialSet    = new Set();

  if (rosterSheet) {
    const rData = rosterSheet.getDataRange().getValues();
    for (let i = CFG.rosterDataStart - 1; i < rData.length; i++) {
      const nameRealm = String(rData[i][CFG.rosterPlayerCol - 1] || '').trim();
      if (!nameRealm) continue;
      const firstName = nameRealm.split('-')[0].trim().toLowerCase();
      const role      = String(rData[i][CFG.rosterRoleCol    - 1] || '').trim().toLowerCase();
      const isTrial   = rData[i][CFG.rosterTrialCol - 1] === true;
      const sortKey   = String(rData[i][CFG.rosterSortKeyCol - 1] || '').trim();
      const isBench   = String(Math.floor(Number(sortKey) / 1000)) === '6';
      if (role)    roleMap[firstName] = role;
      if (isTrial) trialSet.add(firstName);
      if (isBench) benchSet.add(firstName);
    }
  }

  // WCL performance score (col E) for DPS; attendance score (col D) for tanks/healers
  const scoringSheet   = ss.getSheetByName(CFG.scoringSheet);
  const scoreMap       = {};
  const attendScoreMap = {};

  if (scoringSheet) {
    const sData = scoringSheet.getDataRange().getValues();
    for (let i = CFG.scoringDataStart - 1; i < sData.length; i++) {
      const nameRealm = String(sData[i][CFG.scoringPlayerCol - 1] || '').trim();
      if (!nameRealm) continue;
      const firstName = nameRealm.split('-')[0].trim().toLowerCase();
      const wclScore  = sData[i][4];                        // column E -- WCL performance
      const attend    = sData[i][CFG.scoringAttendCol - 1]; // column D -- attendance 1-10
      if (typeof wclScore === 'number' && wclScore > 0) scoreMap[firstName]       = Math.round(wclScore * 10) / 10;
      if (typeof attend   === 'number' && attend   > 0) attendScoreMap[firstName] = Math.round(attend   * 10) / 10;
    }
  }

  const ROLE_MULTI = { tank: 0.50, heal: 0.75, melee: 1.0, ranged: 1.0 };
  const rows = [];

  bisPlayers.forEach(function(player) {
    const firstNameOrig = player.split('-')[0].trim();
    const firstName     = firstNameOrig.toLowerCase();
    // normaliseName strips diacritics so "Twañ" matches "twan" in the recipients sets
    const firstNameNorm = normaliseName(firstNameOrig);

    // Mythic receipt = fully done with the item, excluded from all prio
    if (recipients.mythic.has(firstNameNorm)) return;
    // Heroic receipt = excluded from heroic prio, but still eligible (penalized) for mythic
    if (diff === 'heroic' && recipients.heroic.has(firstNameNorm)) return;

    const role         = roleMap[firstName]  || '';
    const isTankOrHeal = role === 'tank' || role === 'heal';
    const rawScore     = isTankOrHeal
      ? (attendScoreMap[firstName] !== undefined ? attendScoreMap[firstName] : null)
      : (scoreMap[firstName] || null);
    const isBench    = benchSet.has(firstName);
    const isTrial    = trialSet.has(firstName);
    const roleMul   = ROLE_MULTI[role] !== undefined ? ROLE_MULTI[role] : 1.0;
    const hasHeroic       = diff === 'mythic' && recipients.heroic.has(firstNameNorm);
    const hasChampionOnly = diff === 'mythic' && recipients.champion.has(firstNameNorm) && !recipients.heroic.has(firstNameNorm);

    let finalMul    = roleMul;
    let statusLabel = '';
    if (isBench && isTankOrHeal) {
      finalMul    = roleMul * BENCH_ROLE_MULTIPLIER;
      statusLabel = 'Bench';
    } else if (isTrial && isTankOrHeal) {
      finalMul    = roleMul * TRIAL_ROLE_MULTIPLIER;
      statusLabel = 'Trial';
    } else if (isBench) {
      finalMul    = BENCH_MULTIPLIER;
      statusLabel = 'Bench';
    } else if (isTrial) {
      finalMul    = TRIAL_MULTIPLIER;
      statusLabel = 'Trial';
    }

    if (hasHeroic) {
      finalMul    = finalMul * HAS_HEROIC_MULTIPLIER;
      statusLabel = statusLabel ? statusLabel + ', Has Heroic' : 'Has Heroic';
    }

    if (hasChampionOnly) {
      finalMul    = finalMul * HAS_CHAMPION_MULTIPLIER;
      statusLabel = statusLabel ? statusLabel + ', Has Champion' : 'Has Champion';
    }

    // Heroic prio penalty for players who already have the champion (normal) version
    if (diff === 'heroic' && recipients.champion.has(firstNameNorm)) {
      finalMul    = finalMul * HAS_CHAMPION_FOR_HEROIC_MULT;
      statusLabel = statusLabel ? statusLabel + ', Has Champion' : 'Has Champion';
    }

    const hasNeither = diff === 'mythic' && !recipients.heroic.has(firstNameNorm) && !recipients.champion.has(firstNameNorm);
    if (hasNeither) {
      finalMul    = finalMul * HAS_NEITHER_MULTIPLIER;
      statusLabel = statusLabel ? statusLabel + ', No Version' : 'No Version';
    }

    const weightedTotal = rawScore !== null
      ? Math.round(rawScore * finalMul * 10) / 10
      : null;

    rows.push({
      firstName:     firstNameOrig,
      weightedTotal: weightedTotal,
      role:          role,
      statusLabel:   statusLabel,
      sortScore:     weightedTotal !== null ? weightedTotal : -1,
    });
  });

  rows.sort(function(a, b) { return b.sortScore - a.sortScore; });
  return { players: rows };
}

function savePriorityOrderForItem(itemName, difficulty, rankedPlayers) {
  const diff  = difficulty || 'Heroic';
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CFG.prioritySheet);
  if (!sheet) return { error: 'Priority Order sheet not found' };

  const data = sheet.getDataRange().getValues();
  let targetRow = -1;

  for (let i = CFG.priorityDataStart - 1; i < data.length; i++) {
    const rowDiff = String(data[i][CFG.priorityDifficultyCol - 1] || '').trim();
    const rowItem = String(data[i][CFG.priorityItemCol        - 1] || '').trim();
    const diffMatch = rowDiff.toLowerCase() === diff.toLowerCase()
                   || (!rowDiff && diff.toLowerCase() === 'heroic');
    if (rowItem.toLowerCase() === itemName.toLowerCase() && diffMatch) {
      targetRow = i + 1;
      break;
    }
  }

  if (targetRow === -1) {
    targetRow = Math.max(sheet.getLastRow() + 1, CFG.priorityDataStart);
    sheet.getRange(targetRow, CFG.priorityDifficultyCol).setValue(diff);
    sheet.getRange(targetRow, CFG.priorityItemCol).setValue(itemName);
  }

  const maxRanks = 10;
  const values   = [];
  for (let i = 0; i < maxRanks; i++) values.push(String(rankedPlayers[i] || ''));
  sheet.getRange(targetRow, CFG.priorityRankStart, 1, maxRanks).setValues([values]);

  return { success: true };
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

function setBisItemsForPlayer(ss, nameRealm, items) {
  const sheet = ss.getSheetByName(CFG.bisSheet);
  if (!sheet) throw new Error('BiS List sheet not found');

  const firstName  = nameRealm.split('-')[0].trim();
  const data       = sheet.getDataRange().getValues();
  const headerRow  = data[CFG.bisHeaderRow - 1];

  // Find or create the player's column
  let playerCol = -1;
  for (let c = CFG.bisPlayerStartCol - 1; c < headerRow.length; c++) {
    const h = String(headerRow[c] || '').trim();
    if (h.split('-')[0].trim().toLowerCase() === firstName.toLowerCase()) {
      playerCol = c;
      break;
    }
  }
  if (playerCol === -1) {
    playerCol = headerRow.length;
    sheet.getRange(CFG.bisHeaderRow, playerCol + 1).setValue(nameRealm);
  }

  // Clear existing data for this player
  const lastRow = sheet.getLastRow();
  if (lastRow >= CFG.bisDataStart) {
    sheet.getRange(CFG.bisDataStart, playerCol + 1, lastRow - CFG.bisDataStart + 1, 1).clearContent();
  }

  if (!items || !items.length) return;

  // Reload data (header write may have shifted values)
  const fresh = sheet.getDataRange().getValues();

  // Build slot -> [1-based row numbers] map
  const slotRows = {};
  for (let i = CFG.bisDataStart - 1; i < fresh.length; i++) {
    const slot = String(fresh[i][CFG.bisSlotCol - 1] || '').trim();
    if (!slot) continue;
    if (!slotRows[slot]) slotRows[slot] = [];
    slotRows[slot].push(i + 1);
  }

  // Write items; append new slot rows for any overflow or unknown slots
  const slotUsed = {};
  for (const entry of items) {
    const item = String(entry.item || '').trim();
    const slot = String(entry.slot || '').trim();
    if (!item) continue;
    const rows     = slotRows[slot] || [];
    const used     = slotUsed[slot] || 0;
    if (used < rows.length) {
      sheet.getRange(rows[used], playerCol + 1).setValue(item);
    } else {
      // Append a new row for this slot
      const newRow = sheet.getLastRow() + 1;
      if (slot) sheet.getRange(newRow, CFG.bisSlotCol).setValue(slot);
      sheet.getRange(newRow, playerCol + 1).setValue(item);
      if (!slotRows[slot]) slotRows[slot] = [];
      slotRows[slot].push(newRow);
    }
    slotUsed[slot] = (slotUsed[slot] || 0) + 1;
  }
}

function clearBisListSheet(ss) {
  const sheet = ss.getSheetByName(CFG.bisSheet);
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < CFG.bisDataStart || lastCol < CFG.bisPlayerStartCol) return;
  sheet.getRange(CFG.bisDataStart, CFG.bisPlayerStartCol, lastRow - CFG.bisDataStart + 1, lastCol - CFG.bisPlayerStartCol + 1).clearContent();
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

function getItemArmorTypes(sheets) {
  const sheet = sheets[CFG.itemLookupSheet];
  if (!sheet) return {};

  const data   = sheet.getDataRange().getValues();
  const result = {};

  for (let i = CFG.itemDataStart - 1; i < data.length; i++) {
    const row       = data[i];
    const name      = String(row[CFG.itemNameCol - 1]      || '').trim();
    const armorType = String(row[CFG.itemArmorTypeCol - 1] || '').trim();
    if (name && armorType) result[name] = armorType;
  }

  return result;
}

function getItemRecipients(ss, itemName) {
  var heroic    = new Set();
  var mythic    = new Set();
  var champion  = new Set();
  var itemLower = itemName.toLowerCase();

  function normName(str) {
    return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }
  function getDiff(instance) {
    var d = String(instance || '').split('-').pop().trim().toLowerCase();
    return d === 'mythic' ? 'mythic' : d === 'heroic' ? 'heroic' : d === 'normal' ? 'champion' : null;
  }

  const pastedSheet = ss.getSheetByName(CFG.pastedLootSheet);
  if (pastedSheet && pastedSheet.getLastRow() >= 2) {
    const pd = pastedSheet.getDataRange().getValues();
    for (let i = 1; i < pd.length; i++) {
      const player = normName(String(pd[i][2] || '').split('-')[0]);
      const item   = String(pd[i][4] || '').trim().toLowerCase();
      const diff   = getDiff(pd[i][5]);
      if (player && item === itemLower && diff) {
        if (diff === 'heroic') heroic.add(player); else if (diff === 'champion') champion.add(player); else mythic.add(player);
      }
    }
  }

  const lootSheet = ss.getSheetByName(CFG.lootSheet);
  if (lootSheet) {
    const ld = lootSheet.getDataRange().getValues();
    for (let i = CFG.lootDataStart - 1; i < ld.length; i++) {
      const player = normName(String(ld[i][CFG.lootPlayerCol - 1] || '').split('-')[0]);
      const item   = String(ld[i][3] || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
      const diff   = getDiff(ld[i][CFG.lootInstanceCol - 1]);
      if (player && item === itemLower && diff) {
        if (diff === 'heroic') heroic.add(player); else if (diff === 'champion') champion.add(player); else mythic.add(player);
      }
    }
  }

  // Self Received Requests (officer Mark Received + player self-reports)
  // Source is prefixed with difficulty: "Heroic: Great Vault" or "Mythic: M+".
  // Entries without a prefix (legacy) default to mythic.
  const selfSheet = ss.getSheetByName(CFG.selfReceivedSheet);
  if (selfSheet && selfSheet.getLastRow() >= 2) {
    const sd = selfSheet.getDataRange().getValues();
    for (let i = 1; i < sd.length; i++) {
      const status = String(sd[i][6] || '').trim();
      if (status !== 'Approved') continue;
      const player = normName(String(sd[i][1] || '').split('-')[0]);
      const item   = String(sd[i][2] || '').trim().toLowerCase();
      const source = String(sd[i][4] || '').trim().toLowerCase();
      if (!player || item !== itemLower) continue;
      if (source.indexOf('heroic:') === 0)                                            { heroic.add(player); }
      else if (source.indexOf('champion:') === 0 || source.indexOf('normal:') === 0) { champion.add(player); }
      else                                                                             { mythic.add(player); }
    }
  }

  return { heroic: heroic, mythic: mythic, champion: champion };
}

function getItemBosses(sheets) {
  const sheet = sheets[CFG.itemLookupSheet];
  if (!sheet) return {};

  const data   = sheet.getDataRange().getValues();
  const result = {};

  for (let i = CFG.itemDataStart - 1; i < data.length; i++) {
    const row  = data[i];
    const name = String(row[CFG.itemNameCol  - 1] || '').trim();
    const boss = String(row[CFG.itemBossCol  - 1] || '').trim();
    if (name && boss) result[name] = boss;
  }

  return result;
}

// getLootCounts() retired (#209): the loot feed reads from Supabase rclc_loot.
// The Pasted Loot sheet (below) and the Loot Data IMPORTRANGE tab stay: the
// officer paste flow and the priority generator's received-items check still
// consume them until their own migration phases.

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
    const m = s.match(/^(\d{4})[/-](\d{2})[/-](\d{2})/);
    return m ? m[1] + '-' + m[2] + '-' + m[3] : s.substring(0, 10);
  }

  // Parse a date string into a real Date object so setValues() stores a native date cell.
  // Uses local-date construction (year, month, day) to avoid UTC midnight rollover.
  function parseDateObj(raw) {
    const s = String(raw || '').trim();
    const m = s.match(/^(\d{4})[/-](\d{2})[/-](\d{2})/);
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
  return 5; // Melee / Ranged
}

const SPEC_ROLE_MAP = {
  'Arcane': 'Ranged', 'Fire': 'Ranged',
  'Affliction': 'Ranged', 'Demonology': 'Ranged', 'Destruction': 'Ranged',
  'Beast Mastery': 'Ranged', 'Marksmanship': 'Ranged', 'Survival': 'Melee',
  'Balance': 'Ranged', 'Shadow': 'Ranged', 'Elemental': 'Ranged',
  'Augmentation': 'Ranged', 'Devastation': 'Ranged', 'Devourer': 'Ranged',
  'Assassination': 'Melee', 'Outlaw': 'Melee', 'Subtlety': 'Melee',
  'Feral': 'Melee', 'Windwalker': 'Melee', 'Retribution': 'Melee',
  'Enhancement': 'Melee', 'Havoc': 'Melee', 'Arms': 'Melee', 'Fury': 'Melee',
  'Frost': 'Melee', 'Unholy': 'Melee',
  'Blood': 'Tank', 'Guardian': 'Tank', 'Brewmaster': 'Tank',
  'Protection': 'Tank', 'Vengeance': 'Tank',
  'Restoration': 'Heal', 'Mistweaver': 'Heal', 'Holy': 'Heal',
  'Discipline': 'Heal', 'Preservation': 'Heal',
};

function resolveRaidRole(role, spec) {
  if (role === 'DPS' || role === 'Healer' || role === '') {
    return SPEC_ROLE_MAP[spec] || 'Melee';
  }
  return role || 'Melee';
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

function clearDiscordClaimForNameRealm(ss, props, nameRealm) {
  const claimsSheet = ss.getSheetByName('Discord Claims');
  if (claimsSheet) {
    const claimData = claimsSheet.getDataRange().getValues();
    for (let i = claimData.length - 1; i >= 1; i--) {
      if (String(claimData[i][2] || '').trim().toLowerCase() === nameRealm.toLowerCase()) {
        claimsSheet.deleteRow(i + 1);
      }
    }
  }
  const allProps = props.getProperties();
  Object.keys(allProps).forEach(function(key) {
    if (key.indexOf('discordSession_') !== 0) return;
    try {
      const sess = JSON.parse(allProps[key]);
      if (sess && sess.nameRealm && sess.nameRealm.toLowerCase() === nameRealm.toLowerCase()) {
        sess.nameRealm = null;
        props.setProperty(key, JSON.stringify(sess));
      }
    } catch (e) { Logger.log('clearDiscordClaim session error: ' + e); }
  });
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
    sheet.appendRow(['Character-Realm', 'Class', 'Main Spec', 'Off Specs', 'Role', 'Discord', 'Mainswap', 'Notes', 'Season', 'Submitted At', 'Approved At', 'Status']);
    sheet.setFrozenRows(1);
  }

  const nameRealm   = (data.charName || '') + (data.realm ? '-' + data.realm : '');
  const approvedAt  = new Date();
  const newRow      = [
    nameRealm,
    data.className  || '',
    data.mainSpec   || '',
    data.offSpecs   || '',
    data.role       || '',
    data.discord    || '',
    data.mainSwap   || '',
    data.notes      || '',
    data.season     || getActiveSignupSeason(),
    data.submittedAt || '',
    approvedAt,
    'Pending'
  ];

  // Upsert: update existing Pending row for this player if one exists
  if (sheet.getLastRow() >= 2) {
    const existing = sheet.getDataRange().getValues();
    for (let i = 1; i < existing.length; i++) {
      const rowNR  = String(existing[i][0] || '').trim();
      const status = String(existing[i][11] || '').trim();
      if (rowNR.toLowerCase() === nameRealm.toLowerCase() && status !== 'Pushed') {
        sheet.getRange(i + 1, 1, 1, 12).setValues([newRow]);
        return;
      }
    }
  }

  sheet.appendRow(newRow);
}

function getPendingRosterEntries() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CFG.applicantsSheet);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const data    = sheet.getDataRange().getValues();
  const results = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    // Legacy rows had Timestamp in col A — detect and skip that offset
    const o = (row[0] instanceof Date) ? 1 : 0;
    if (!row[0 + o]) continue;
    const status = String(row[11 + o] || '').trim();
    if (status === 'Pushed') continue;
    results.push({
      rowIndex:    i + 1,
      nameRealm:   String(row[0 + o]  || ''),
      className:   String(row[1 + o]  || ''),
      mainSpec:    String(row[2 + o]  || ''),
      offSpecs:    String(row[3 + o]  || ''),
      role:        String(row[4 + o]  || ''),
      discord:     String(row[5 + o]  || ''),
      mainSwap:    String(row[6 + o]  || ''),
      notes:       String(row[7 + o]  || ''),
      season:      String(row[8 + o]  || ''),
      submittedAt: String(row[9 + o]  || ''),
      approvedAt:  String(row[10 + o] || ''),
      status:      status || 'Pending'
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

// Set once per doGet() invocation from the Discord session token; falls back when changedBy is not explicitly passed.
var _currentChangedBy = '';

function appendAuditLog(action, target, oldVal, newVal, changedBy) {
  try {
    const sheet = ensureAuditLogSheet();
    const by = changedBy !== undefined ? changedBy : _currentChangedBy;
    sheet.appendRow([
      new Date(),
      by || '',
      action || '',
      target || '',
      oldVal !== undefined && oldVal !== null ? String(oldVal) : '',
      newVal !== undefined && newVal !== null ? String(newVal) : ''
    ]);
  } catch (err) {
    Logger.log('appendAuditLog error: ' + err);
  }
}

function resolveChangedBy(token) {
  if (!token) return '';
  try {
    var sess = validateDiscordSession(token);
    return (sess && sess.valid && sess.username) ? sess.username : '';
  } catch (_) { return ''; }
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

// ── Settings helpers ──────────────────────────────────────────────────────────

function getActiveSignupSeason() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CFG.settingsSheet);
  if (!sheet || sheet.getLastRow() < 2) return '';
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === 'signupseason') {
      return String(data[i][1] || '').trim();
    }
  }
  return '';
}

function setActiveSignupSeason(season) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CFG.settingsSheet);
  if (!sheet) {
    sheet = ss.insertSheet(CFG.settingsSheet);
    sheet.appendRow(['Key', 'Value']);
    sheet.setFrozenRows(1);
  }
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === 'signupseason') {
      sheet.getRange(i + 1, 2).setValue(season);
      return;
    }
  }
  sheet.appendRow(['signupSeason', season]);
}

// ── Signup season helpers ─────────────────────────────────────────────────────

function getMissingSignups() {
  const season   = getActiveSignupSeason();
  const signups  = getSignupResponses();
  const submitted = {};
  signups.forEach(function(s) {
    if (s.season !== season && season) return;
    if (s.status === 'Denied') return;
    const key = (s.charName + '-' + s.realm).toLowerCase().trim();
    submitted[key] = true;
  });

  const ss           = SpreadsheetApp.getActiveSpreadsheet();
  const rosterSheet  = ss.getSheetByName(CFG.rosterSheet);
  const missing      = [];
  if (!rosterSheet) return missing;

  const rData = rosterSheet.getDataRange().getValues();
  for (let i = CFG.rosterDataStart - 1; i < rData.length; i++) {
    const nameRealm = String(rData[i][CFG.rosterPlayerCol - 1] || '').trim();
    if (!nameRealm) continue;
    if (!submitted[nameRealm.toLowerCase()]) {
      missing.push({
        nameRealm:  nameRealm,
        className:  String(rData[i][CFG.rosterClassCol - 1] || ''),
        spec:       String(rData[i][CFG.rosterSpecCol  - 1] || ''),
        role:       String(rData[i][CFG.rosterRoleCol  - 1] || '')
      });
    }
  }
  return missing;
}

function pushPendingToRoster(removeAbsent) {
  const ss           = SpreadsheetApp.getActiveSpreadsheet();
  const pendingSheet = ss.getSheetByName(CFG.applicantsSheet);
  const rosterSheet  = ss.getSheetByName(CFG.rosterSheet);
  if (!pendingSheet || !rosterSheet) return { error: 'Sheet not found' };

  // Build current roster map: nameRealm.lower -> rowIndex (1-based)
  const rData      = rosterSheet.getDataRange().getValues();
  const rosterMap  = {};
  for (let i = CFG.rosterDataStart - 1; i < rData.length; i++) {
    const nr = String(rData[i][CFG.rosterPlayerCol - 1] || '').trim();
    if (nr) rosterMap[nr.toLowerCase()] = i + 1;
  }

  // Process each Pending entry
  const pendingData = pendingSheet.getLastRow() >= 2 ? pendingSheet.getDataRange().getValues() : [];
  const pushedKeys  = {};
  let added = 0, updated = 0;

  for (let i = 1; i < pendingData.length; i++) {
    const row    = pendingData[i];
    const o      = (row[0] instanceof Date) ? 1 : 0;
    const status = String(row[11 + o] || '').trim();
    if (status === 'Pushed') continue;
    const nameRealm = String(row[0 + o] || '').trim();
    if (!nameRealm) continue;

    const cls     = String(row[1 + o] || '').trim();
    const spec    = String(row[2 + o] || '').trim();
    const rawRole = String(row[4 + o] || '').trim();
    const role    = resolveRaidRole(rawRole, spec);
    const key     = nameRealm.toLowerCase();
    pushedKeys[key] = true;

    if (rosterMap[key]) {
      // Update existing roster row
      const rRow = rosterMap[key];
      rosterSheet.getRange(rRow, CFG.rosterClassCol).setValue(cls);
      rosterSheet.getRange(rRow, CFG.rosterSpecCol).setValue(spec);
      rosterSheet.getRange(rRow, CFG.rosterRoleCol).setValue(role);
      rosterSheet.getRange(rRow, CFG.rosterPriorityCol).setValue(roleToPriority(role));
      updated++;
    } else {
      // Add as new roster entry
      addPlayerToRoster({ nameRealm: nameRealm, class: cls, spec: spec, role: role, isTrial: false, nick: '' });
      added++;
    }

    // Mark as Pushed in pending sheet
    pendingSheet.getRange(i + 1, 12 + o).setValue('Pushed');
    appendAuditLog('Roster Push: ' + (rosterMap[key] ? 'Updated' : 'Added'), nameRealm, '', '');
  }

  // Optionally remove roster members not in the pending push
  const removed = [];
  if (removeAbsent) {
    for (const nr in rosterMap) {
      if (!pushedKeys[nr]) {
        const nameRealm = String(rData[rosterMap[nr] - 1][CFG.rosterPlayerCol - 1] || '').trim();
        removePlayerFromRoster(nameRealm);
        appendAuditLog('Roster Push: Removed (no signup)', nameRealm, '', '');
        removed.push(nameRealm);
      }
    }
  } else {
    for (const nr in rosterMap) {
      if (!pushedKeys[nr]) {
        const nameRealm = String(rData[rosterMap[nr] - 1][CFG.rosterPlayerCol - 1] || '').trim();
        if (nameRealm) removed.push(nameRealm);
      }
    }
  }

  return { success: true, added: added, updated: updated, removed: removed, removedAbsent: removeAbsent };
}

function fetchWclProgressionData(zoneId) {
  const token = getAccessToken();
  if (!token) throw new Error('Failed to get WCL access token. Check WCL_CLIENT_ID and WCL_CLIENT_SECRET in Script Properties.');

  const query = `
    query {
      reportData {
        reports(guildID: ${GUILD_TAG_ID}, zoneID: ${zoneId}, limit: 100) {
          data {
            startTime
            fights(killType: Kills) {
              encounterID
              name
              difficulty
            }
          }
        }
      }
    }
  `;

  const result = wclQuery(token, query);
  if (!result) throw new Error('WCL query returned no data');

  const reports = (result.data && result.data.reportData && result.data.reportData.reports && result.data.reportData.reports.data) || [];

  const firstKills = {};

  for (var i = 0; i < reports.length; i++) {
    var report = reports[i];
    var fights = report.fights || [];
    for (var j = 0; j < fights.length; j++) {
      var fight = fights[j];
      var encId = fight.encounterID;
      var diff  = fight.difficulty;
      var name  = fight.name || '';
      var ts    = report.startTime;

      if (!firstKills[encId]) firstKills[encId] = { name: name, mythicMs: null, heroicMs: null };
      if (name && !firstKills[encId].name) firstKills[encId].name = name;

      if (diff === 5) {
        if (firstKills[encId].mythicMs === null || ts < firstKills[encId].mythicMs) firstKills[encId].mythicMs = ts;
      } else if (diff === 4) {
        if (firstKills[encId].heroicMs === null || ts < firstKills[encId].heroicMs) firstKills[encId].heroicMs = ts;
      }
    }
  }

  var encIds = Object.keys(firstKills).map(function(id) { return parseInt(id); });
  encIds.sort(function(a, b) { return a - b; });

  var bosses = encIds.map(function(encId) {
    var k = firstKills[encId];
    return {
      encounterID: encId,
      name:        k.name,
      mythicDate:  k.mythicMs ? Utilities.formatDate(new Date(k.mythicMs), Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
      heroicDate:  k.heroicMs ? Utilities.formatDate(new Date(k.heroicMs), Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
    };
  });

  var aotcDate = '';
  if (bosses.length > 0) aotcDate = bosses[bosses.length - 1].heroicDate || '';

  return { success: true, bosses: bosses, aotcDate: aotcDate };
}

// ── Discord OAuth helpers ─────────────────────────────────────────────────────
// The OAuth code exchange (discordTokenExchange/discordApiGet/
// discordOAuthCallback/generateSessionToken, DISCORD_TOKEN_URL/
// DISCORD_API_BASE/DISCORD_REDIRECT_URI, and the DISCORD_CLIENT_ID/
// DISCORD_CLIENT_SECRET Script Properties they read) is retired (#222) --
// see the comment above the removed discordCallback route. Only
// validateDiscordSession survives, for any pre-#363 discordSession_* token
// that might still be presented; DISCORD_SESSION_TTL_DAYS stays with it.

var DISCORD_SESSION_TTL_DAYS = 30;

function validateDiscordSession(token) {
  if (!token) return { valid: false };
  const raw = PropertiesService.getScriptProperties().getProperty('discordSession_' + token);
  if (!raw) return { valid: false };
  var session;
  try { session = JSON.parse(raw); } catch (_) { return { valid: false }; }
  // Expire sessions older than DISCORD_SESSION_TTL_DAYS days
  const created = new Date(session.createdAt || 0);
  const ageMs   = Date.now() - created.getTime();
  if (ageMs > DISCORD_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000) {
    try { PropertiesService.getScriptProperties().deleteProperty('discordSession_' + token); } catch (e) { Logger.log('session expiry delete error: ' + e); }
    return { valid: false };
  }
  const did = session.discordId || '';
  return {
    valid:      true,
    discordId:  did,
    username:   session.username  || '',
    avatar:     session.avatar    || '',
    nameRealm:  session.nameRealm || null,
    isOfficer:  isOfficerDiscordId(did),
    isAdmin:    isAdminDiscordId(did)
  };
}

function claimCharacterForSession(token, nameRealm) {
  const session = validateDiscordSession(token);
  if (!session.valid) return { success: false, error: 'Invalid or expired session' };

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Verify nameRealm exists on the roster
  const rosterSheet = ss.getSheetByName(CFG.rosterSheet);
  if (!rosterSheet) return { success: false, error: 'Roster sheet not found' };
  const rData = rosterSheet.getDataRange().getValues();
  var foundOnRoster = false;
  for (var i = CFG.rosterDataStart - 1; i < rData.length; i++) {
    if (String(rData[i][CFG.rosterPlayerCol - 1] || '').trim().toLowerCase() === nameRealm.toLowerCase()) {
      foundOnRoster = true;
      break;
    }
  }
  if (!foundOnRoster) return { success: false, error: 'Character not found on roster' };

  const sheets = {};
  for (const sheet of ss.getSheets()) { sheets[sheet.getName()] = sheet; }
  const existing = getDiscordClaims(sheets);

  // Enforce one claim per Discord ID
  const existingById = existing.find(function(c) { return c.discordId === session.discordId; });
  if (existingById) return { success: false, error: 'You already have a claim for ' + existingById.nameRealm };

  // Enforce one claim per character
  const existingByChar = existing.find(function(c) {
    return c.nameRealm.toLowerCase() === nameRealm.toLowerCase();
  });
  if (existingByChar) return { success: false, error: nameRealm + ' is already claimed by another Discord user' };

  // Write the claim
  const claimsSheet = ensureDiscordClaimsSheet(ss);
  claimsSheet.appendRow([session.discordId, session.username, nameRealm, new Date().toISOString()]);

  // Update the stored session with the new nameRealm
  const updated = {
    discordId:  session.discordId,
    username:   session.username,
    avatar:     session.avatar,
    nameRealm:  nameRealm,
    createdAt:  new Date().toISOString()  // refresh session age on claim
  };
  PropertiesService.getScriptProperties().setProperty('discordSession_' + token, JSON.stringify(updated));

  const isOfficer = isOfficerDiscordId(session.discordId);
  const isAdmin   = isAdminDiscordId(session.discordId);
  appendAuditLog('Discord Claim Created', nameRealm, '', session.username, 'N/A');
  return { success: true, nameRealm: nameRealm, isOfficer: isOfficer, isAdmin: isAdmin };
}

function getOfficerIds() {
  const val = PropertiesService.getScriptProperties().getProperty('officerDiscordIds') || '';
  return val.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
}

function getAdminIds() {
  const val = PropertiesService.getScriptProperties().getProperty('adminDiscordIds') || '';
  return val.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
}

function isOfficerDiscordId(discordId) {
  if (!discordId) return false;
  const admins   = getAdminIds();
  const officers = getOfficerIds();
  return admins.indexOf(discordId) !== -1 || officers.indexOf(discordId) !== -1;
}

function isAdminDiscordId(discordId) {
  if (!discordId) return false;
  return getAdminIds().indexOf(discordId) !== -1;
}

function ensureDiscordClaimsSheet(ss) {
  var sheet = ss.getSheetByName('Discord Claims');
  if (!sheet) {
    sheet = ss.insertSheet('Discord Claims');
    sheet.appendRow(['Discord ID', 'Discord Username', 'Name-Realm', 'Claimed At']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getDiscordClaims(sheets) {
  const sheet = sheets['Discord Claims'];
  if (!sheet || sheet.getLastRow() < 2) return [];
  const data    = sheet.getDataRange().getValues();
  const results = [];
  for (var i = 1; i < data.length; i++) {
    const discordId  = String(data[i][0] || '').trim();
    const username   = String(data[i][1] || '').trim();
    const nameRealm  = String(data[i][2] || '').trim();
    const claimedAt  = String(data[i][3] || '').trim();
    if (discordId && nameRealm) results.push({ discordId, username, nameRealm, claimedAt });
  }
  return results;
}
