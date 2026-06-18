// ════════════════════════════════════════════════════════════════════════════
// ABOUT — About tab builder
// ════════════════════════════════════════════════════════════════════════════

function createAboutTab() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Remove and recreate for idempotency
  const existing = ss.getSheetByName('About');
  if (existing) ss.deleteSheet(existing);
  const sheet = ss.insertSheet('About');
  ss.moveActiveSheet(1);

  // ── Palette ─────────────────────────────────────────────────────────────
  const C = {
    white:         '#FFFFFF',
    pageBg:        '#F8F7F4',
    headerBg:      '#1A1A1A',
    headerText:    '#FFFFFF',
    sectionBg:     '#F0EEE8',
    cardBg:        '#FFFFFF',
    cardBorder:    '#E0DDD5',
    officerBg:     '#FEF9EE',
    officerBorder: '#F5C842',
    raiderBg:      '#EEF4FE',
    raiderBorder:  '#4A86E8',
    accentLine:    '#CCCCCC',
    labelText:     '#888880',
    bodyText:      '#3A3A38',
    mutedText:     '#6B6B68',
    calloutBg:     '#F0EEE8',
    calloutBorder: '#AAAAAA',
    badgeOfficer:  '#FEF3CD',
    badgeRaider:   '#D6E4FC',
  };

  // ── Column widths ───────────────────────────────────────────────────────
  // Col A = left margin, B–G = content (6 cols), H = right margin
  sheet.setColumnWidth(1, 32);   // A — margin
  sheet.setColumnWidth(2, 130);  // B
  sheet.setColumnWidth(3, 130);  // C
  sheet.setColumnWidth(4, 130);  // D
  sheet.setColumnWidth(5, 130);  // E
  sheet.setColumnWidth(6, 130);  // F
  sheet.setColumnWidth(7, 130);  // G
  sheet.setColumnWidth(8, 32);   // H — margin

  // ── Helpers ─────────────────────────────────────────────────────────────

  function bg(row, col, numRows, numCols, color) {
    sheet.getRange(row, col, numRows, numCols).setBackground(color);
  }

  function write(row, col, numCols, text, opts = {}) {
    const range = sheet.getRange(row, col, 1, numCols);
    if (numCols > 1) range.merge();
    range.setValue(text);
    range.setFontFamily('Arial');
    range.setFontSize(opts.size || 11);
    range.setFontWeight(opts.bold ? 'bold' : 'normal');
    range.setFontColor(opts.color || C.bodyText);
    range.setVerticalAlignment('middle');
    range.setWrap(true);
    if (opts.align)     range.setHorizontalAlignment(opts.align);
    if (opts.italic)    range.setFontStyle('italic');
    if (opts.rowHeight) sheet.setRowHeight(row, opts.rowHeight);
    return range;
  }

  function spacer(row, height = 10) {
    sheet.setRowHeight(row, height);
    bg(row, 1, 1, 8, C.pageBg);
  }

  function divider(row) {
    sheet.setRowHeight(row, 1);
    sheet.getRange(row, 2, 1, 6).setBorder(false, false, true, false, false, false, C.accentLine, SpreadsheetApp.BorderStyle.SOLID);
    bg(row, 1, 1, 8, C.pageBg);
  }

  function sectionLabel(row, text, badgeText) {
    sheet.setRowHeight(row, 22);
    bg(row, 1, 1, 8, C.pageBg);
    const r = sheet.getRange(row, 2, 1, 6);
    r.merge();
    r.setValue(text + (badgeText ? '   › ' + badgeText : ''));
    r.setFontFamily('Arial');
    r.setFontSize(9);
    r.setFontWeight('bold');
    r.setFontColor(C.labelText);
    r.setVerticalAlignment('middle');
  }

  function sheetCard(startRow, col, name, desc) {
    const isOfficerOnly = desc.includes('— Officers only');
    const displayDesc   = desc.replace(' — Officers only', '');
    const nameBg        = isOfficerOnly ? C.officerBg  : C.cardBg;
    const descBg        = isOfficerOnly ? C.officerBg  : C.cardBg;
    const border        = isOfficerOnly ? C.officerBorder : C.cardBorder;

    sheet.setRowHeight(startRow, 18);
    sheet.setRowHeight(startRow + 1, isOfficerOnly ? 42 : 32);

    const nameRange = sheet.getRange(startRow, col, 1, 2);
    nameRange.merge();
    nameRange.setValue(isOfficerOnly ? '🔒 ' + name : name);
    nameRange.setFontFamily('Arial');
    nameRange.setFontSize(10);
    nameRange.setFontWeight('bold');
    nameRange.setFontColor(C.bodyText);
    nameRange.setBackground(nameBg);
    nameRange.setVerticalAlignment('bottom');

    const descRange = sheet.getRange(startRow + 1, col, 1, 2);
    descRange.merge();
    descRange.setValue(displayDesc);
    descRange.setFontFamily('Arial');
    descRange.setFontSize(9);
    descRange.setFontColor(C.mutedText);
    descRange.setBackground(descBg);
    descRange.setVerticalAlignment('top');
    descRange.setWrap(true);

    sheet.getRange(startRow, col, 2, 2)
      .setBorder(true, true, true, true, false, false, border, SpreadsheetApp.BorderStyle.SOLID);
  }

  function officerCard(row, title, body) {
    sheet.setRowHeight(row, 18);
    bg(row, 1, 1, 8, C.pageBg);
    const titleR = sheet.getRange(row, 2, 1, 6);
    titleR.merge();
    titleR.setValue(title);
    titleR.setFontFamily('Arial');
    titleR.setFontSize(10);
    titleR.setFontWeight('bold');
    titleR.setFontColor(C.bodyText);
    titleR.setBackground(C.officerBg);
    titleR.setVerticalAlignment('middle');
    titleR.setBorder(true, true, false, true, false, false, C.officerBorder, SpreadsheetApp.BorderStyle.SOLID);

    const lines      = Math.ceil(body.length / 90);
    const bodyHeight = Math.max(40, lines * 18 + 14);
    sheet.setRowHeight(row + 1, bodyHeight);
    bg(row + 1, 1, 1, 8, C.pageBg);
    const bodyR = sheet.getRange(row + 1, 2, 1, 6);
    bodyR.merge();
    bodyR.setValue(body);
    bodyR.setFontFamily('Arial');
    bodyR.setFontSize(10);
    bodyR.setFontColor(C.mutedText);
    bodyR.setBackground(C.officerBg);
    bodyR.setWrap(true);
    bodyR.setVerticalAlignment('top');
    bodyR.setBorder(false, true, true, true, false, false, C.officerBorder, SpreadsheetApp.BorderStyle.SOLID);

    return row + 2;
  }

  function callout(row, text) {
    const lines = Math.ceil(text.length / 95);
    const h     = Math.max(36, lines * 17 + 12);
    sheet.setRowHeight(row, h);
    bg(row, 1, 1, 8, C.pageBg);
    const r = sheet.getRange(row, 2, 1, 6);
    r.merge();
    r.setValue('ℹ  ' + text);
    r.setFontFamily('Arial');
    r.setFontSize(10);
    r.setFontColor(C.mutedText);
    r.setBackground(C.calloutBg);
    r.setWrap(true);
    r.setVerticalAlignment('middle');
    r.setBorder(false, true, false, false, false, false, C.calloutBorder, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  }

  // ── Page background ──────────────────────────────────────────────────────
  sheet.getRange(1, 1, 120, 8).setBackground(C.pageBg);

  // ── Resolve BiS form URL from named range ────────────────────────────────
  let bisFormUrl = '';
  try {
    const urlRange = ss.getRangeByName('BiSFormURL');
    if (urlRange) bisFormUrl = urlRange.getValue().toString().trim();
  } catch(e) {}

  // ── Header block ─────────────────────────────────────────────────────────
  let r = 1;

  sheet.setRowHeight(r, 10); bg(r, 1, 1, 8, C.headerBg); r++;

  sheet.setRowHeight(r, 16); bg(r, 1, 1, 8, C.headerBg);
  write(r, 2, 6, 'TEAM PHOENIX', { size: 9, bold: true, color: '#888880', align: 'left', rowHeight: 16 });
  sheet.getRange(r, 2, 1, 6).setBackground(C.headerBg);
  r++;

  sheet.setRowHeight(r, 32); bg(r, 1, 1, 8, C.headerBg);
  write(r, 2, 6, 'Loot Priority Sheet', { size: 20, bold: true, color: C.headerText, rowHeight: 32 });
  sheet.getRange(r, 2, 1, 6).setBackground(C.headerBg);
  r++;

  sheet.setRowHeight(r, 22); bg(r, 1, 1, 8, C.headerBg);
  write(r, 2, 6, 'Transparent, data-driven loot distribution for raid progression.', { size: 11, color: '#AAAAAA', rowHeight: 22 });
  sheet.getRange(r, 2, 1, 6).setBackground(C.headerBg);
  r++;

  sheet.setRowHeight(r, 12); bg(r, 1, 1, 8, C.headerBg); r++;

  // ── Raider section ──────────────────────────────────────────────────────
  spacer(r); r++;
  sectionLabel(r, 'FOR RAIDERS', 'Raider'); r++;
  spacer(r, 6); r++;

  write(r, 2, 6, 'What this sheet is', { size: 13, bold: true, rowHeight: 26 });
  bg(r, 1, 1, 8, C.pageBg); r++;

  write(r, 2, 6,
    'This spreadsheet tracks loot priority for our raid team. It uses your BiS list alongside WarcraftLogs performance and attendance data to determine who gets first priority on each item when it drops. The goal is to distribute gear in a way that maximizes raid performance.',
    { size: 10, color: C.mutedText, rowHeight: 52 });
  bg(r, 1, 1, 8, C.pageBg); r++;

  spacer(r, 14); r++;
  write(r, 2, 6, 'What you need to do', { size: 13, bold: true, rowHeight: 26 });
  bg(r, 1, 1, 8, C.pageBg); r++;
  spacer(r, 6); r++;

  const steps = [
    ['1', 'Submit the form with a link to your BiS list (Wowhead, Icy Veins, class discord, personal Raidbots sim, or a reputable class resource). Officers will enter your BiS items into the sheet on your behalf.'],
    ['2', 'BiS lists are set at the start of the tier and do not change. If you genuinely need to update your list, message Katorri or Rod.'],
    ['3', 'Show up. Your priority is set at the start of the tier and is yours to keep — attendance is the only thing that can cost you your spot.'],
  ];

  for (const [num, text] of steps) {
    sheet.setRowHeight(r, 36);
    bg(r, 1, 1, 8, C.pageBg);

    const numCell = sheet.getRange(r, 2);
    numCell.setValue(num);
    numCell.setFontFamily('Arial');
    numCell.setFontSize(9);
    numCell.setFontWeight('bold');
    numCell.setFontColor(C.bodyText);
    numCell.setBackground(C.sectionBg);
    numCell.setHorizontalAlignment('center');
    numCell.setVerticalAlignment('middle');

    const textRange = sheet.getRange(r, 3, 1, 5);
    textRange.merge();
    textRange.setValue(text);
    textRange.setFontFamily('Arial');
    textRange.setFontSize(10);
    textRange.setFontColor(C.mutedText);
    textRange.setBackground(C.pageBg);
    textRange.setWrap(true);
    textRange.setVerticalAlignment('middle');

    sheet.getRange(r, 2, 1, 6)
      .setBorder(false, false, true, false, false, false, C.accentLine, SpreadsheetApp.BorderStyle.SOLID);

    r++;
  }

  spacer(r, 10); r++;

  // BiS form link — shown if URL is available, placeholder if not
  const formLinkText = bisFormUrl
    ? `BiS submission form: ${bisFormUrl}`
    : 'BiS submission form link will appear here once an officer runs Create BiS submission form from the Phoenix Prio Loot menu.';

  sheet.setRowHeight(r, 28);
  bg(r, 1, 1, 8, C.pageBg);
  const formLinkRange = sheet.getRange(r, 2, 1, 6);
  formLinkRange.merge();
  formLinkRange.setValue(formLinkText);
  formLinkRange.setFontFamily('Arial');
  formLinkRange.setFontSize(10);
  formLinkRange.setFontColor(bisFormUrl ? '#1155CC' : C.mutedText);
  formLinkRange.setFontStyle(bisFormUrl ? 'normal' : 'italic');
  formLinkRange.setBackground(C.pageBg);
  formLinkRange.setVerticalAlignment('middle');
  formLinkRange.setWrap(true);
  if (bisFormUrl) {
    formLinkRange.setFontLine('underline');
  }
  r++;
  spacer(r, 6); r++;
  callout(r, 'Need to update your BiS list? Message Katorri or Rod. Do not resubmit the form without officer approval — they will update the sheet directly.');
  r++;

  spacer(r, 14); r++;
  write(r, 2, 6, 'How priority is decided', { size: 13, bold: true, rowHeight: 26 });
  bg(r, 1, 1, 8, C.pageBg); r++;

  write(r, 2, 6,
    'Priority works in two phases.\n\nDuring Heroic progression, priority is set at the start of the tier and stays fixed. Your position on an item is yours to keep — the only things that can change it are receiving the item from raid, or attendance problems. Officers use WoWAudit wishlist data in the RCLootCouncil voting frame to see who already has a lower-difficulty version of an item and factor that in naturally during loot decisions.\n\nOnce the team moves into Mythic, priority is recalculated weekly based on current WarcraftLogs performance scores. The same rules apply for receiving items and attendance, but strong performers will move up and underperformers will move down over time.',
    { size: 10, color: C.mutedText, rowHeight: 120 });
  bg(r, 1, 1, 8, C.pageBg); r++;

  // ── Sheet overview cards ─────────────────────────────────────────────────
  spacer(r, 18); r++;
  sectionLabel(r, 'HOW THE SHEET IS ORGANIZED'); r++;
  spacer(r, 4); r++;

  write(r, 2, 6, '🔒 = Officer-only tab — not visible in the published view', {
    size: 9, color: C.mutedText, italic: true, rowHeight: 18
  });
  bg(r, 1, 1, 8, C.pageBg); r++;

  spacer(r, 8); r++;

  const cards = [
    ['Priority Order',     'Ranked priority list used during raid'],
    ['BiS List',           'Each player\'s top item pick per slot — Officers only'],
    ['Roster',             'Players, roles, and priority scores — Officers only'],
    ['Scoring',            'WCL performance scores (recent + trend) — Officers only'],
    ['Upgrade Values',     'Sim upgrade % values used by officers to inform priority decisions — Officers only'],
    ['Item Lookup',        'Master list of all raid items and slots — Officers only'],
    ['Export',             'Generates the RCLootCouncil import string — Officers only'],
    ['Priority Generator', 'Calculates blended priority scores per item — Officers only'],
  ];

  const cardCols = [2, 4, 6];
  for (let i = 0; i < cards.length; i++) {
    const col = cardCols[i % 3];
    if (i % 3 === 0 && i > 0) r += 3;
    sheetCard(r, col, cards[i][0], cards[i][1]);
  }
  r += 3;

  // ── Officer section ──────────────────────────────────────────────────────
  spacer(r, 20); r++;
  divider(r); r++;
  spacer(r, 10); r++;
  sectionLabel(r, 'FOR OFFICERS', 'Officer'); r++;
  spacer(r, 6); r++;

  write(r, 2, 6, 'Officer workflows', { size: 13, bold: true, rowHeight: 26 });
  bg(r, 1, 1, 8, C.pageBg); r++;

  write(r, 2, 6,
    'All officer actions are in the Phoenix Prio Loot and ⚔ Team Phoenix menus in the top toolbar.',
    { size: 10, color: C.mutedText, rowHeight: 28 });
  bg(r, 1, 1, 8, C.pageBg); r++;

  spacer(r, 10); r++;

  const officerCards = [
    ['Start of tier — setup',
     'Add all raid items to Item Lookup (name, item ID, slot). Run Set BiS List slot dropdowns to apply per-slot filtering. Share the BiS submission form link with raiders and give them a deadline. Once responses are in, review each player\'s submitted BiS list link and manually enter their BiS items into the BiS List tab. Then run the Priority Generator to establish the predetermined priority order for the tier — this becomes the baseline used going forward, with manual adjustments made by officers as the tier progresses.'],
    ['Each raid week — refresh scores',
     'Run Refresh WCL Performance Scores from the ⚔ Team Phoenix menu. Review the draft scores in columns J (Recent) and K (Trend).\n\nDuring Heroic progression: scores are for officer awareness only and do not reorder priority standings. Use them to identify developing attendance issues and make any manual adjustments to the Priority Order tab as needed.\n\nOnce in Mythic progression: commit scores each week by running Commit Draft Scores → Performance — this updates standings and should be followed by running Export priority data and pasting the output into /rcpl import in-game to sync the updated priority list to the RCLootCouncil_PriorityLoot addon.'],
    ['During raid — assigning loot',
     'Do not use the spreadsheet during raid. Loot council members can see who has priority on each item directly in the RCLootCouncil voting frame, based on the priority list exported at the start of the week. The goal is fast, confident loot decisions with no spreadsheet required.'],
    ['Adding new items mid-tier',
     'Add the item to Item Lookup first. Re-run Set BiS List slot dropdowns to refresh BiS List validations. Then add the item to Priority Order and run Fill dropdowns for selected item row for that row.'],
  ];

  for (const [title, body] of officerCards) {
    r = officerCard(r, title, body);
    spacer(r, 8); r++;
    if (title === 'Start of tier — setup') {
      callout(r, 'Do not create a new BiS submission form if one already exists — raiders\' submitted links are tied to the original form. To start fresh, delete the existing form from Google Drive and remove the Form Responses sheet from the spreadsheet first.');
      r++;
      spacer(r, 8); r++;
    }
  }

  spacer(r, 6); r++;
  callout(r, 'Tanks are marked "Manual" in the scoring columns and are never auto-populated by WCL. Update their Performance scores manually based on officer consensus.');
  r++;

  spacer(r, 24); r++;

  // ── Footer ────────────────────────────────────────────────────────────────
  sheet.setRowHeight(r, 1);
  sheet.getRange(r, 2, 1, 6).setBackground(C.accentLine);
  r++;
  spacer(r, 10); r++;

  write(r, 2, 6, 'Last updated by officers via Apps Script › Rebuild About tab', {
    size: 9, color: C.labelText, italic: true, rowHeight: 20
  });
  bg(r, 1, 1, 8, C.pageBg); r++;

  spacer(r, 16); r++;

  // ── Freeze & hide gridlines ───────────────────────────────────────────────
  sheet.setHiddenGridlines(true);
  sheet.setFrozenRows(0);
  sheet.setFrozenColumns(0);

  SpreadsheetApp.getUi().alert('✅ About tab rebuilt and moved to the first tab position.');
}
