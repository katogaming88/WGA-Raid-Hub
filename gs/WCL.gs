// ════════════════════════════════════════════════════════════════════════════
// WCL — WarcraftLogs Performance Score Fetcher
// ════════════════════════════════════════════════════════════════════════════


// ── Entry Point ───────────────────────────────────────────────────────────────

function refreshPerformanceScores() {
  try {
    Logger.log('Starting WCL performance fetch...');

    const token = getAccessToken();
    if (!token) throw new Error('Failed to get WCL access token. Check Client ID and Secret.');

    const allReports = getRecentReports(token, TREND_REPORTS);
    if (!allReports || allReports.length === 0) throw new Error('No matching Phoenix reports found.');
    Logger.log(`Found ${allReports.length} reports.`);

    const recentReports = allReports.slice(0, RECENT_REPORTS);
    const trendReports  = allReports;

    const recentData = collectPlayerData(token, recentReports);
    const trendData  = collectPlayerData(token, trendReports);

    writeDualScores(recentData, trendData);

    SpreadsheetApp.getUi().alert(
      '✅ WCL Performance Scores Updated!\n\n' +
      `Column J = Recent Score (last ${RECENT_REPORTS} reports)\n` +
      `Column K = Trend Score (last ${TREND_REPORTS} reports)\n\n` +
      'Review both columns before committing.'
    );

  } catch (e) {
    Logger.log('Error: ' + e.message);
    SpreadsheetApp.getUi().alert('❌ Error: ' + e.message);
  }
}


// ── Performance Helpers ───────────────────────────────────────────────────────

function collectPlayerData(token, reports) {
  const playerData = {};

  for (const report of reports) {
    Logger.log(`Processing: ${report.title} (${report.code})`);
    const fightData = getReportRankings(token, report.code);
    if (!fightData) continue;

    for (const fight of fightData) {
      if (!fight.roles) continue;

      for (const roleKey of ['dps', 'healers', 'tanks']) {
        const entries = fight.roles[roleKey]?.characters || [];
        for (const character of entries) {
          const name    = character.name;
          const ilvlPct = character.bracketPercent;
          if (!name || ilvlPct == null || ilvlPct === 0) continue;

          const expectedRole = getRole(name);
          if (expectedRole === 'tank')                             continue;
          if (expectedRole === 'healer' && roleKey !== 'healers') continue;
          if (expectedRole === 'dps'    && roleKey !== 'dps')     continue;

          if (!playerData[name]) playerData[name] = { ilvlPercentages: [] };
          playerData[name].ilvlPercentages.push(ilvlPct);
        }
      }
    }
  }

  return playerData;
}

function calcScore(ilvlPercentages) {
  if (!ilvlPercentages || ilvlPercentages.length === 0) return null;
  const avg = ilvlPercentages.reduce((a, b) => a + b, 0) / ilvlPercentages.length;
  return Math.round((avg / 10) * 100) / 100;
}

function writeDualScores(recentData, trendData) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SCORING_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${SCORING_SHEET_NAME}" not found`);

  sheet.getRange(PLAYER_DATA_START, DRAFT_SCORE_COL, PLAYER_DATA_END - PLAYER_DATA_START + 1, 2)
    .clearContent()
    .setBackground(null);

  const recentHeader = sheet.getRange(3, DRAFT_SCORE_COL);
  recentHeader.setValue(`Recent Score\n(last ${RECENT_REPORTS} reports)`);
  recentHeader.setFontWeight('bold').setBackground('#FFF2CC').setHorizontalAlignment('center').setWrap(true);

  const trendHeader = sheet.getRange(3, TREND_SCORE_COL);
  trendHeader.setValue(`Trend Score\n(last ${TREND_REPORTS} reports)`);
  trendHeader.setFontWeight('bold').setBackground('#D9EAD3').setHorizontalAlignment('center').setWrap(true);

  for (let row = PLAYER_DATA_START; row <= PLAYER_DATA_END; row++) {
    const cellValue = sheet.getRange(row, PLAYER_COL).getValue();
    if (!cellValue || String(cellValue).trim() === '') continue;

    const firstName = cellValue.toString().split('-')[0];
    const role      = getRole(firstName);

    const recentCell = sheet.getRange(row, DRAFT_SCORE_COL);
    const trendCell  = sheet.getRange(row, TREND_SCORE_COL);

    if (role === 'tank') {
      recentCell.setValue('Manual').setBackground('#CFE2F3');
      trendCell.setValue('Manual').setBackground('#CFE2F3');
      continue;
    }

    const recentScore = calcScore(recentData[firstName]?.ilvlPercentages);
    const trendScore  = calcScore(trendData[firstName]?.ilvlPercentages);
    const recentCount = recentData[firstName]?.ilvlPercentages?.length || 0;
    const trendCount  = trendData[firstName]?.ilvlPercentages?.length || 0;

    if (recentScore !== null) {
      recentCell.setValue(recentScore).setNumberFormat('0.00').setBackground('#FFF2CC');
      recentCell.setNote(`${recentCount} fight(s) across last ${RECENT_REPORTS} reports`);
    } else if (trendScore !== null) {
      recentCell.setValue(trendScore).setNumberFormat('0.00').setBackground('#E8D5F5');
      recentCell.setNote(`No recent data — using trend score instead (${trendCount} fight(s) across last ${TREND_REPORTS} reports)`);
    } else {
      recentCell.setValue('No data').setBackground('#F4CCCC');
    }

    if (trendScore !== null) {
      let trendBg = '#D9EAD3';
      if (recentScore !== null) {
        if (trendScore > recentScore + 0.5)      trendBg = '#FCE5CD';
        else if (recentScore > trendScore + 0.5) trendBg = '#B7E1CD';
      }
      trendCell.setValue(trendScore).setNumberFormat('0.00').setBackground(trendBg);
      trendCell.setNote(`${trendCount} fight(s) across last ${TREND_REPORTS} reports`);
    } else {
      trendCell.setValue('No data').setBackground('#F4CCCC');
    }
  }

  Logger.log('Dual scores written successfully.');
}

function commitDraftScores() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Commit Draft Scores',
    'This will copy Recent Scores (column J) into the Performance column (C).\n\n' +
    'Cells marked "No data" or "Manual" will be skipped.\n\nAre you sure?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) return;

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SCORING_SHEET_NAME);
  let committed = 0;

  for (let row = PLAYER_DATA_START; row <= PLAYER_DATA_END; row++) {
    const cellValue = sheet.getRange(row, PLAYER_COL).getValue();
    if (!cellValue || String(cellValue).trim() === '') continue;

    const firstName = cellValue.toString().split('-')[0];
    if (getRole(firstName) === 'tank') continue;

    const draftValue = sheet.getRange(row, DRAFT_SCORE_COL).getValue();
    if (!draftValue || draftValue === 'No data' || draftValue === 'Manual' || draftValue === '') continue;

    sheet.getRange(row, PERF_COL).setValue(draftValue);
    sheet.getRange(row, DRAFT_SCORE_COL).setBackground('#D9EAD3');
    committed++;
  }

  ui.alert(`✅ Done — ${committed} Performance scores updated from Recent Score.`);
}


// ── WCL Shared Helpers (used by both WCL.gs and Attendance.gs) ───────────────

function setWCLCredentials() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('WCL_CLIENT_ID',     '');
  props.setProperty('WCL_CLIENT_SECRET', '');
  Logger.log('WCL credentials saved to Script Properties.');
}

function getAccessToken() {
  const props       = PropertiesService.getScriptProperties();
  const clientId     = props.getProperty('WCL_CLIENT_ID');
  const clientSecret = props.getProperty('WCL_CLIENT_SECRET');
  const credentials  = Utilities.base64Encode(`${clientId}:${clientSecret}`);
  const response = UrlFetchApp.fetch('https://www.warcraftlogs.com/oauth/token', {
    method: 'post',
    headers: { 'Authorization': `Basic ${credentials}` },
    payload: { grant_type: 'client_credentials' },
    muteHttpExceptions: true
  });
  const data = JSON.parse(response.getContentText());
  if (!data.access_token) { Logger.log('Token response: ' + response.getContentText()); return null; }
  return data.access_token;
}

function getRecentReports(token, limit) {
  const query = `
    query {
      reportData {
        reports(guildID: ${GUILD_TAG_ID}, limit: 20) {
          data { code title startTime endTime }
        }
      }
    }
  `;
  const result = wclQuery(token, query);
  if (!result) return [];
  const allReports = result.data?.reportData?.reports?.data || [];
  return allReports.slice(0, limit);
}

function getReportRankings(token, reportCode) {
  let fights = fetchRankingsForDifficulty(token, reportCode, MYTHIC_DIFF);
  if (!fights || fights.length === 0) {
    Logger.log(`No mythic data for ${reportCode}, falling back to heroic`);
    fights = fetchRankingsForDifficulty(token, reportCode, HEROIC_DIFF);
  }
  return fights;
}

function fetchRankingsForDifficulty(token, reportCode, difficulty) {
  const query = `
    query {
      reportData {
        report(code: "${reportCode}") {
          rankings(difficulty: ${difficulty})
        }
      }
    }
  `;
  const result = wclQuery(token, query);
  if (!result) return [];
  const rankingsRaw = result.data?.reportData?.report?.rankings;
  if (!rankingsRaw) return [];
  try {
    const rankings = typeof rankingsRaw === 'string' ? JSON.parse(rankingsRaw) : rankingsRaw;
    return rankings?.data || [];
  } catch (e) {
    Logger.log('Failed to parse rankings JSON: ' + e.message);
    return [];
  }
}

function wclQuery(token, query) {
  try {
    const response = UrlFetchApp.fetch('https://www.warcraftlogs.com/api/v2/client', {
      method: 'post',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      payload: JSON.stringify({ query }),
      muteHttpExceptions: true
    });
    const data = JSON.parse(response.getContentText());
    if (data.errors) { Logger.log('GraphQL errors: ' + JSON.stringify(data.errors)); return null; }
    return data;
  } catch (e) {
    Logger.log('Request failed: ' + e.message);
    return null;
  }
}

var _roleMap = null;

function buildRoleMap() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CFG.rosterSheet);
  const map   = {};
  if (!sheet) return map;
  const data = sheet.getDataRange().getValues();
  for (let i = CFG.rosterDataStart - 1; i < data.length; i++) {
    const nameRealm = String(data[i][CFG.rosterPlayerCol - 1] || '').trim();
    if (!nameRealm) continue;
    const firstName = nameRealm.split('-')[0].trim().toLowerCase();
    const role      = String(data[i][CFG.rosterRoleCol - 1] || '').trim();
    if (role === 'Tank')                          map[firstName] = 'tank';
    else if (role === 'Heal')                     map[firstName] = 'healer';
    else if (role === 'Melee' || role === 'Ranged') map[firstName] = 'dps';
  }
  return map;
}

function getRole(firstName) {
  if (!_roleMap) _roleMap = buildRoleMap();
  return _roleMap[firstName.toLowerCase()] || 'dps';
}

function debugScoringRows() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SCORING_SHEET_NAME);
  const lines = [];
  for (let row = PLAYER_DATA_START; row <= PLAYER_DATA_END; row++) {
    const cellValue = sheet.getRange(row, PLAYER_COL).getValue();
    lines.push(`Row ${row}: "${cellValue}" (type: ${typeof cellValue})`);
  }
  SpreadsheetApp.getUi().alert(lines.join('\n'));
}
