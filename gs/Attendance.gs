// ════════════════════════════════════════════════════════════════════════════
// ATTENDANCE CONFIG
// ════════════════════════════════════════════════════════════════════════════

const ROSTER_PLAYER_DATA_START = 4;
const BENCH_SORT_KEY_PREFIX    = 6;

const ATTENDANCE_SHEET_NAME  = 'Attendance';
const ATTENDANCE_COL         = 4;
const SEASON_REPORT_LIMIT    = 50;
const ALT_RUN_KEYWORD        = 'Alt';

const ATTENDANCE_WEIGHTS = {
  'Present':        1.0,
  'Bench':          1.0,
  'Medical Leave':  1.0,
  'Excused':        0.8,
  'No Show':        0.0,
  'Not on Roster':  null,
};


// ════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY
// ════════════════════════════════════════════════════════════════════════════

function refreshAttendance() {
  try {
    const result = refreshAttendanceCore();
    SpreadsheetApp.getUi().alert(
      'Attendance Updated!\n\n' +
      `${result.mainNights} main raid nights found this season\n` +
      `${result.excluded} report(s) excluded (alt runs / wrong zone) -- see bottom of Attendance sheet\n\n` +
      'Fill in Bench / Excused / No Show for any blank rows, then run\n' +
      '"Commit Attendance Scores -> Column D"'
    );
  } catch (e) {
    Logger.log('Error: ' + e.message);
    SpreadsheetApp.getUi().alert('Error: ' + e.message);
  }
}

function refreshAttendanceCore() {
  Logger.log('Starting WCL attendance fetch...');

  const token = getAccessToken();
  if (!token) throw new Error('Failed to get WCL access token. Check Client ID and Secret.');

  const allReports = getSeasonReports(token);
  if (!allReports || allReports.length === 0) throw new Error('No matching Phoenix reports found.');
  Logger.log(`Fetched ${allReports.length} total reports.`);

  const rosterData  = getRosterData();
  const rosterNames = rosterData.map(r => r.firstName);
  const rosterSet   = new Set(rosterNames.map(n => n.toLowerCase()));

  const reportDetails = collectAllReportDetails(token, allReports, rosterSet);
  const currentZoneId = detectCurrentZone(reportDetails);
  if (!currentZoneId) throw new Error('Could not determine current raid zone. Check WCL reports.');
  Logger.log(`Current season zone ID: ${currentZoneId}`);

  const mainNights = [];
  const excluded   = [];

  for (const detail of reportDetails) {
    if (detail.zoneId !== currentZoneId) {
      excluded.push({ ...detail, reason: `Wrong zone (zone ${detail.zoneId})` });
    } else if (detail.title.includes(ALT_RUN_KEYWORD)) {
      excluded.push({ ...detail, reason: `Alt run (title contains "${ALT_RUN_KEYWORD}")` });
    } else {
      mainNights.push(detail);
    }
  }

  Logger.log(`Main nights: ${mainNights.length} | Excluded: ${excluded.length}`);

  writeAttendanceToSheet(mainNights, excluded, rosterData);

  return { mainNights: mainNights.length, excluded: excluded.length };
}


// ════════════════════════════════════════════════════════════════════════════
// REPORT FETCHING
// ════════════════════════════════════════════════════════════════════════════

function getSeasonReports(token) {
  const query = `
    query {
      reportData {
        reports(guildID: ${GUILD_TAG_ID}, limit: ${SEASON_REPORT_LIMIT}) {
          data { code title startTime endTime }
        }
      }
    }
  `;
  const result = wclQuery(token, query);
  if (!result) return [];
  const allReports = result.data?.reportData?.reports?.data || [];
  return allReports.filter(r => r.title);
}

function collectAllReportDetails(token, reports, rosterSet) {
  const details = [];

  for (const report of reports) {
    Logger.log(`Fetching details for: ${report.title} (${report.code})`);

    const zoneId      = getReportZone(token, report.code);
    const players     = getReportParticipants(token, report.code);
    const rosterCount = [...players].filter(n => rosterSet.has(n.toLowerCase())).length;

    details.push({
      code:        report.code,
      title:       report.title,
      date:        formatReportDate(report.startTime),
      startTime:   report.startTime,
      zoneId,
      players,
      rosterCount,
    });

    Logger.log(`  → zone: ${zoneId} | participants: ${players.size}`);
  }

  return details.sort((a, b) => b.startTime - a.startTime);
}

function getReportZone(token, reportCode) {
  const query = `
    query {
      reportData {
        report(code: "${reportCode}") {
          zone { id }
        }
      }
    }
  `;
  const result = wclQuery(token, query);
  return result?.data?.reportData?.report?.zone?.id ?? null;
}

function getReportParticipants(token, reportCode) {
  const players   = new Set();
  const fightData = getReportRankings(token, reportCode);

  if (fightData && fightData.length > 0) {
    for (const fight of fightData) {
      if (!fight.roles) continue;
      for (const roleKey of ['dps', 'healers', 'tanks']) {
        const entries = fight.roles[roleKey]?.characters || [];
        for (const character of entries) {
          if (character.name) players.add(character.name.split('-')[0]);
        }
      }
    }
  }

  // Always supplement with masterData to catch players not in ranked fights
  const combatants = getReportCombatants(token, reportCode);
  for (const name of combatants) players.add(name);

  return players;
}

function detectCurrentZone(reportDetails) {
  for (const detail of reportDetails) {
    if (detail.zoneId) return detail.zoneId;
  }
  return null;
}


// ════════════════════════════════════════════════════════════════════════════
// WRITE ATTENDANCE SHEET
// ════════════════════════════════════════════════════════════════════════════

function writeAttendanceToSheet(mainNights, excluded, rosterData) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(ATTENDANCE_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(ATTENDANCE_SHEET_NAME);
    Logger.log('Created Attendance sheet.');
  }

  const existingEntries = readExistingAttendance(sheet);

  const rosterNames = rosterData.map(r => r.firstName);
  const benchSet    = new Set(rosterData.filter(r => r.isBench).map(r => r.firstName.toLowerCase()));

  const mainRows         = [
    ['Raid Date', 'Player (First Name)', 'Status', 'Source', 'Notes', 'Exclude Report'],
  ];
  const reportHeaderRows = new Set();
  const playerRows       = new Set();

  for (const night of mainNights) {
    const { date, title, players } = night;

    reportHeaderRows.add(mainRows.length + 1);
    const headerKey   = `__exclude__|${title}  (${date})`;
    const wasExcluded = existingEntries[headerKey] === true;
    mainRows.push([`${title}  (${date})`, '', '', '', '', wasExcluded]);

    const presentRoster = [...players]
      .filter(n => rosterNames.some(r => r.toLowerCase() === n.toLowerCase()))
      .sort();

    for (const firstName of presentRoster) {
      const key    = `${date}|${firstName}`;
      const status = existingEntries[key] || 'Present';
      const source = existingEntries[key] ? 'Officer' : 'WCL';
      playerRows.add(mainRows.length + 1);
      mainRows.push([date, firstName, status, source, '', '']);
    }

    for (const firstName of [...rosterNames].sort()) {
      const inWCL = [...players].some(p => p.toLowerCase() === firstName.toLowerCase());
      if (inWCL) continue;
      const key           = `${date}|${firstName}`;
      const officerStatus = existingEntries[key];
      if (officerStatus) {
        playerRows.add(mainRows.length + 1);
        mainRows.push([date, firstName, officerStatus, 'Officer', '', '']);
      } else if (benchSet.has(firstName.toLowerCase())) {
        playerRows.add(mainRows.length + 1);
        mainRows.push([date, firstName, 'Bench', 'Auto (Bench)', '', '']);
      } else {
        playerRows.add(mainRows.length + 1);
        mainRows.push([date, firstName, '', 'Officer', '', '']);
      }
    }
  }

  const excludedRows = [
    ['', '', '', '', '', ''],
    ['── Excluded Reports ──────────────────────────────────────', '', '', '', '', ''],
    ['Report Title', 'Date', 'Reason', 'Roster Members Found', '', ''],
  ];

  if (excluded.length === 0) {
    excludedRows.push(['(none)', '', '', '', '', '']);
  } else {
    for (const ex of excluded) {
      excludedRows.push([ex.title, ex.date, ex.reason, ex.rosterCount, '', '']);
    }
  }

  const allRows = [...mainRows, ...excludedRows];

  sheet.clearContents();
  sheet.clearFormats();
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();
  sheet.getRange(1, 1, allRows.length, 6).setValues(allRows);

  formatAttendanceSheet(sheet, mainRows.length, allRows.length, reportHeaderRows, playerRows);

  Logger.log(`Attendance sheet written: ${mainRows.length - 1} main rows, ${excluded.length} excluded reports.`);
}


// ════════════════════════════════════════════════════════════════════════════
// COMMIT ATTENDANCE SCORES → COLUMN D
// ════════════════════════════════════════════════════════════════════════════

function commitAttendanceScores() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Commit Attendance Scores',
    'This calculates each player\'s attendance score across ALL main raid nights\n' +
    'this season and writes it to column D (Attendance) in the Scoring sheet.\n\n' +
    'Weights:  Present = 1.0  |  Bench = 1.0  |  Medical Leave = 1.0  |  Excused = 0.8  |  No Show = 0.0\n' +
    'Blank status rows are treated as No Show.\n\n' +
    'Are you sure?',
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return;

  try {
    const result = commitAttendanceScoresCore();
    ui.alert(
      `Done -- ${result.committed} Attendance scores written to column D.\n` +
      `Denominator: ${result.totalRaids} main raid nights this season.`
    );
  } catch (e) {
    ui.alert('Error: ' + e.message);
  }
}

function commitAttendanceScoresCore() {
  const ss           = SpreadsheetApp.getActiveSpreadsheet();
  const attSheet     = ss.getSheetByName(ATTENDANCE_SHEET_NAME);
  const scoringSheet = ss.getSheetByName(SCORING_SHEET_NAME);

  if (!attSheet)     throw new Error('Attendance sheet not found. Run "Refresh Attendance" first.');
  if (!scoringSheet) throw new Error(`Sheet "${SCORING_SHEET_NAME}" not found.`);

  const lastRow = attSheet.getLastRow();
  const attData = attSheet.getRange(1, 1, lastRow, 6).getValues();

  const raidDates     = new Set();
  const playerWeights = {};
  let   skipDate      = null;

  for (let i = 1; i < attData.length; i++) {
    const [date, firstName, status, , , excludeFlag] = attData[i];

    if (String(date).startsWith('──') || String(date) === 'Report Title') break;
    if (!date && !firstName) continue;

    if (!firstName) {
      if (excludeFlag === true) {
        const match = String(date).match(/\((\d{4}-\d{2}-\d{2})\)/);
        skipDate = match ? match[1] : null;
        Logger.log(`Excluding report from scoring: ${date}`);
      } else {
        skipDate = null;
      }
      continue;
    }

    if (skipDate && String(date) === skipDate) continue;
    if (!date || !firstName) continue;
    if (!status) continue;

    const weight = ATTENDANCE_WEIGHTS[status];
    if (weight === null || weight === undefined) continue;

    raidDates.add(String(date));
    if (!playerWeights[firstName]) playerWeights[firstName] = { weights: [], nights: new Set() };
    playerWeights[firstName].weights.push(weight);
    playerWeights[firstName].nights.add(String(date));
  }

  const totalRaids = raidDates.size;
  Logger.log(`Scoring attendance: ${totalRaids} raid nights this season.`);

  if (totalRaids === 0) throw new Error('No raid nights found in the Attendance sheet. Run the refresh first.');

  let committed = 0;
  for (let row = PLAYER_DATA_START; row <= PLAYER_DATA_END; row++) {
    const cellValue = scoringSheet.getRange(row, PLAYER_COL).getValue();
    if (!cellValue || String(cellValue).trim() === '') continue;

    const firstName  = cellValue.toString().split('-')[0];
    const playerData = playerWeights[firstName];

    if (!playerData || playerData.weights.length === 0) {
      Logger.log(`No attendance data for ${firstName} -- skipping.`);
      continue;
    }

    const playerNights = playerData.nights.size;
    const sum          = playerData.weights.reduce((a, b) => a + b, 0);
    const score        = Math.min(Math.round((sum / playerNights) * 10 * 100) / 100, 10);

    const cell = scoringSheet.getRange(row, ATTENDANCE_COL);
    cell.setValue(score).setNumberFormat('0.00');

    if      (score >= 9.5) cell.setBackground('#B7E1CD');
    else if (score >= 8.0) cell.setBackground('#FFF2CC');
    else                   cell.setBackground('#F4CCCC');

    cell.setNote(
      `${playerData.weights.length} night(s) scored / ${playerNights} applicable nights\n` +
      `(${totalRaids} total season nights)\n` +
      'Present=1.0 | Bench=1.0 | Medical Leave=1.0 | Excused=0.8 | No Show=0.0 | Not on Roster=excluded'
    );

    committed++;
  }

  return { committed, totalRaids };
}


// ════════════════════════════════════════════════════════════════════════════
// WCL HELPER — combatants fallback
// ════════════════════════════════════════════════════════════════════════════

function getReportCombatants(token, reportCode) {
  const query = `
    query {
      reportData {
        report(code: "${reportCode}") {
          masterData {
            actors(type: "Player") { name }
          }
        }
      }
    }
  `;
  const result = wclQuery(token, query);
  const actors = result?.data?.reportData?.report?.masterData?.actors || [];
  return actors.map(a => a.name.split('-')[0]).filter(Boolean);
}


// ════════════════════════════════════════════════════════════════════════════
// SHEET HELPERS
// ════════════════════════════════════════════════════════════════════════════

function readExistingAttendance(sheet) {
  const entries = {};
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return entries;

  const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  for (const [rawDate, firstName, status, source, , excludeFlag] of data) {
    if (!rawDate) continue;
    if (String(rawDate).startsWith('──') || String(rawDate) === 'Report Title') break;

    let date;
    if (rawDate instanceof Date) {
      date = Utilities.formatDate(rawDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } else {
      date = String(rawDate);
    }

    if (!firstName) {
      if (excludeFlag === true) entries[`__exclude__|${date}`] = true;
      continue;
    }
    if (status) {
      entries[`${date}|${firstName}`] = status;
    }
  }
  return entries;
}

function getRosterData() {
  const ss           = SpreadsheetApp.getActiveSpreadsheet();
  const scoringSheet = ss.getSheetByName(SCORING_SHEET_NAME);
  const rosterSheet  = ss.getSheetByName(ROSTER_SHEET_NAME);

  const benchSet = new Set();
  if (rosterSheet) {
    const lastRow = rosterSheet.getLastRow();
    if (lastRow >= ROSTER_PLAYER_DATA_START) {
      const rosterData = rosterSheet.getRange(ROSTER_PLAYER_DATA_START, ROSTER_PLAYER_COL, lastRow - ROSTER_PLAYER_DATA_START + 1, ROSTER_SORT_KEY_COL - ROSTER_PLAYER_COL + 1).getValues();
      for (const row of rosterData) {
        const fullName = row[0];
        const sortKey  = row[ROSTER_SORT_KEY_COL - ROSTER_PLAYER_COL];
        if (!fullName) continue;
        if (Math.floor(Number(sortKey) / 1000) === BENCH_SORT_KEY_PREFIX) {
          benchSet.add(fullName.toString().split('-')[0].toLowerCase());
        }
      }
    }
  }
  Logger.log(`Bench players: ${[...benchSet].join(', ')}`);

  const roster = [];
  for (let row = PLAYER_DATA_START; row <= PLAYER_DATA_END; row++) {
    const cellValue = scoringSheet.getRange(row, PLAYER_COL).getValue();
    if (!cellValue || String(cellValue).trim() === '') continue;
    const firstName = cellValue.toString().split('-')[0];
    roster.push({ firstName, isBench: benchSet.has(firstName.toLowerCase()) });
  }
  return roster;
}

function formatAttendanceSheet(sheet, mainSectionRows, totalRows, reportHeaderRows, playerRows) {
  sheet.getRange(1, 1, 1, 6)
       .setFontWeight('bold')
       .setBackground('#434343')
       .setFontColor('#FFFFFF')
       .setHorizontalAlignment('center');

  sheet.setColumnWidth(1, 120);
  sheet.setColumnWidth(2, 160);
  sheet.setColumnWidth(3, 110);
  sheet.setColumnWidth(4, 90);
  sheet.setColumnWidth(5, 220);
  sheet.setColumnWidth(6, 110);

  if (mainSectionRows > 1) {
    const statusRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['Present', 'Bench', 'Medical Leave', 'Excused', 'No Show', 'Not on Roster'], true)
      .setAllowInvalid(false)
      .build();

    const statuses = sheet.getRange(2, 3, mainSectionRows - 1, 1).getValues();
    const sources  = sheet.getRange(2, 4, mainSectionRows - 1, 1).getValues();

    for (let i = 0; i < statuses.length; i++) {
      const sheetRow   = i + 2;
      const statusCell = sheet.getRange(sheetRow, 3);

      if (reportHeaderRows && reportHeaderRows.has(sheetRow)) {
        sheet.getRange(sheetRow, 1, 1, 6)
             .setBackground('#2C4770')
             .setFontColor('#FFFFFF')
             .setFontWeight('bold')
             .setFontStyle('normal');
        sheet.getRange(sheetRow, 6).insertCheckboxes();
        continue;
      }

      if (!playerRows.has(sheetRow)) continue;

      statusCell.setDataValidation(statusRule);
      const status    = statuses[i][0];
      const sourceVal = sources[i][0];
      if      (status === 'Present')                                statusCell.setBackground('#B7E1CD');
      else if (status === 'Bench' && sourceVal === 'Auto (Bench)')  statusCell.setBackground('#D4E6F1');
      else if (status === 'Bench')                                  statusCell.setBackground('#CFE2F3');
      else if (status === 'Medical Leave')                          statusCell.setBackground('#D0E9FF');
      else if (status === 'Excused')                                statusCell.setBackground('#FFF2CC');
      else if (status === 'No Show')                                statusCell.setBackground('#F4CCCC');
      else if (status === 'Not on Roster')                          statusCell.setBackground('#E8DEF8');
      else                                                          statusCell.setBackground('#EFEFEF');
    }
  }

  const spacerRow         = mainSectionRows + 1;
  const dividerLabelRow   = mainSectionRows + 2;
  const excludedHeaderRow = mainSectionRows + 3;

  if (spacerRow <= totalRows)         sheet.getRange(spacerRow, 1, 1, 6).setBackground('#FFFFFF');
  if (dividerLabelRow <= totalRows)   sheet.getRange(dividerLabelRow, 1, 1, 6).setBackground('#EFEFEF').setFontStyle('italic').setFontColor('#666666');
  if (excludedHeaderRow <= totalRows) sheet.getRange(excludedHeaderRow, 1, 1, 6).setFontWeight('bold').setBackground('#F4CCCC').setFontColor('#000000');

  sheet.setFrozenRows(1);
}

function formatReportDate(startTime) {
  const d = new Date(startTime);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}


// ════════════════════════════════════════════════════════════════════════════
// DEBUG
// ════════════════════════════════════════════════════════════════════════════

function debugAttendanceSheet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ATTENDANCE_SHEET_NAME);
  if (!sheet) { SpreadsheetApp.getUi().alert('Attendance sheet not found.'); return; }

  const lastRow = sheet.getLastRow();
  const data    = sheet.getRange(1, 1, Math.min(lastRow, 20), 5).getValues();
  const lines   = data.map((r, i) => `Row ${i + 1}: ${r.join(' | ')}`);
  SpreadsheetApp.getUi().alert(lines.join('\n'));
}

function debugExistingAttendance() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ATTENDANCE_SHEET_NAME);
  const entries = readExistingAttendance(sheet);
  const lines = Object.entries(entries).slice(0, 30).map(([k, v]) => `${k} -> ${v}`);
  SpreadsheetApp.getUi().alert(lines.join('\n'));
}


// ════════════════════════════════════════════════════════════════════════════
// WEB APP HELPERS
// ════════════════════════════════════════════════════════════════════════════

function getAttendanceSheetGrid() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ATTENDANCE_SHEET_NAME);
  if (!sheet) return { raids: [] };

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { raids: [] };

  const data = sheet.getRange(1, 1, lastRow, 6).getValues();

  const raids       = [];
  let   currentRaid = null;

  for (let i = 1; i < data.length; i++) {
    const [rawDate, firstName, status, source, , excludeFlag] = data[i];

    let dateStr;
    if (rawDate instanceof Date) {
      dateStr = Utilities.formatDate(rawDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } else {
      dateStr = String(rawDate || '');
    }

    if (!dateStr && !firstName) continue;
    if (String(dateStr).startsWith('──') || String(dateStr) === 'Report Title') break;

    if (!firstName) {
      const match = String(dateStr).match(/\((\d{4}-\d{2}-\d{2})\)/);
      const date  = match ? match[1] : dateStr;
      currentRaid = { date, title: dateStr, excluded: excludeFlag === true, players: [] };
      raids.push(currentRaid);
    } else if (currentRaid) {
      currentRaid.players.push({
        name:   String(firstName),
        status: String(status || ''),
        source: String(source || ''),
      });
    }
  }

  return { raids };
}

function setAttendanceStatusInSheet(date, firstName, status) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ATTENDANCE_SHEET_NAME);
  if (!sheet) throw new Error('Attendance sheet not found.');

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('Attendance sheet is empty.');

  const data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();

  for (let i = 0; i < data.length; i++) {
    const [rawDate, rowFirstName] = data[i];
    const rowDate = rawDate instanceof Date
      ? Utilities.formatDate(rawDate, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : String(rawDate || '');

    if (String(rowDate).startsWith('──') || String(rowDate) === 'Report Title') break;

    if (rowDate === date && String(rowFirstName || '').trim() === firstName) {
      const sheetRow = i + 2;
      sheet.getRange(sheetRow, 3).setValue(status);
      sheet.getRange(sheetRow, 4).setValue('Officer');
      return;
    }
  }

  throw new Error(`Row not found for ${date} / ${firstName}.`);
}
