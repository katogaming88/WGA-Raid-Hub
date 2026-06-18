// ════════════════════════════════════════════════════════════════════════════
// MENU
// ════════════════════════════════════════════════════════════════════════════

function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('Phoenix Prio Loot')
    .addItem('Export priority data…', 'exportPriorityData')
    .addSeparator()
    .addItem('Run Priority Generator', 'runPriorityGenerator')
    .addItem('Highlight received items', 'highlightReceivedInPriorityOrder')
    .addItem('Create Prio Gen Legend', 'writePriorityGeneratorLegend')
    .addSeparator()
    .addItem('Debug Upgrade Map', 'debugUpgradeMap')
    .addItem('Debug Role Map', 'debugRoleMap')
    .addItem('Debug Bench Set', 'debugBenchSet')
    .addSeparator()
    .addItem('Fill dropdowns for selected item row', 'fillDropdownsForSelectedRow')
    .addItem('Fill dropdowns for ALL item rows', 'fillAllPriorityDropdowns')
    .addItem('Set BiS List slot dropdowns', 'setBiSDropdowns')
    .addSeparator()
    .addItem('Rebuild About tab', 'createAboutTab')
    .addSeparator()
    .addItem('Clear Roster Page Cache', 'clearRosterCache')
    .addToUi();

  ui.createMenu('⚔ Team Phoenix')
    .addItem('Refresh WCL Performance Scores',  'refreshPerformanceScores')
    .addItem('Commit Draft Scores → Performance',   'commitDraftScores')
    .addSeparator()
    .addItem('Refresh Attendance',              'refreshAttendance')
    .addItem('Commit Attendance Scores → Column D', 'commitAttendanceScores')
    .addSeparator()
    .addItem('Debug Scoring Rows',     'debugScoringRows')
    .addItem('Debug Attendance Sheet', 'debugAttendanceSheet')
    .addToUi();
}
