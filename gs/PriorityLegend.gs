// ════════════════════════════════════════════════════════════════════════════
// PRIORITY LEGEND — Writes the scoring key to the Priority Generator tab
// ════════════════════════════════════════════════════════════════════════════

function writePriorityGeneratorLegend() {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const genSheet = ss.getSheetByName(PRIO_GEN_SHEET_NAME);

  if (!genSheet) {
    SpreadsheetApp.getUi().alert(`Sheet "${PRIO_GEN_SHEET_NAME}" not found.`);
    return;
  }

  function pct(val) {
    return '× ' + Math.round(val * 1000) / 10 + '%';
  }

  function example(val) {
    return 'e.g. 8.0 → ' + Math.round(8.0 * val * 10) / 10;
  }

  function combinedNote(roleLabel, roleVal, statusLabel, statusVal) {
    const combined = Math.round(roleVal * statusVal * 1000) / 10;
    return roleLabel + ' (' + pct(roleVal) + ') combined with ' + statusLabel + ' (' + pct(statusVal) + ') = ' + combined + '% effective multiplier.';
  }

  const tank      = ROLE_SCORE_MULTIPLIERS['tank'];
  const heal      = ROLE_SCORE_MULTIPLIERS['heal'];
  const bench     = BENCH_MULTIPLIER;
  const trial     = TRIAL_MULTIPLIER;
  const benchRole = BENCH_ROLE_MULTIPLIER;
  const trialRole = TRIAL_ROLE_MULTIPLIER;

  const lootLegend = [
    { color: '#FFF176', label: '  Normal received' },
    { color: '#FFB74D', label: '  Heroic received' },
    { color: '#EF9A9A', label: '  Mythic received' },
    { color: '#FFFFFF', label: '  Not received'    },
  ];

  const baseMultipliers = [
    {
      label: '  Tank (role)',
      value: pct(tank),
      note:  'Base role multiplier applied to all tanks.',
    },
    {
      label: '  Heal (role)',
      value: pct(heal),
      note:  'Base role multiplier applied to all healers.',
    },
    {
      label: '  Trial (status)',
      value: pct(trial),
      note:  'Base status multiplier applied to trial DPS. Stacked with role multiplier for trial tanks and healers.',
    },
    {
      label: '  Bench (status)',
      value: pct(bench),
      note:  'Base status multiplier applied to bench DPS. Stacked with role multiplier for bench tanks and healers.',
    },
    {
      label: '  Trial + Role (stacking)',
      value: pct(trialRole),
      note:  'Additional stacking multiplier applied on top of the role multiplier for trial tanks and healers.',
    },
    {
      label: '  Bench + Role (stacking)',
      value: pct(benchRole),
      note:  'Additional stacking multiplier applied on top of the role multiplier for bench tanks and healers.',
    },
  ];

  const effectiveMultipliers = [
    {
      label: '  DPS (Main)',
      value: pct(1.0),
      ex:    example(1.0),
      note:  'Main roster DPS receive full priority as throughput is the primary factor in progression.',
    },
    {
      label: '  Trial DPS',
      value: pct(trial),
      ex:    example(trial),
      note:  'Trials are eligible for loot but ranked below main roster DPS until their raid spot is confirmed.',
    },
    {
      label: '  Heal (Main)',
      value: pct(heal),
      ex:    example(heal),
      note:  'Healers are prioritized above tanks as they directly enable the tanks and raid to survive, but ranked below DPS as throughput remains the primary progression factor.',
    },
    {
      label: '  Tank (Main)',
      value: pct(tank),
      ex:    example(tank),
      note:  'Tanks receive the lowest base priority as most progression is a DPS check. Gear has less direct impact on clearing content.',
    },
    {
      label: '  Bench DPS',
      value: pct(bench),
      ex:    example(bench),
      note:  'Bench players receive lower priority than active raiders to reward consistent attendance.',
    },
    {
      label: '  Trial Heal',
      value: pct(heal * trialRole),
      ex:    example(heal * trialRole),
      note:  combinedNote('Heal (Main)', heal, 'Trial', trialRole),
    },
    {
      label: '  Trial Tank',
      value: pct(tank * trialRole),
      ex:    example(tank * trialRole),
      note:  combinedNote('Tank (Main)', tank, 'Trial', trialRole),
    },
    {
      label: '  Bench Heal',
      value: pct(heal * benchRole),
      ex:    example(heal * benchRole),
      note:  combinedNote('Heal (Main)', heal, 'Bench', benchRole),
    },
    {
      label: '  Bench Tank',
      value: pct(tank * benchRole),
      ex:    example(tank * benchRole),
      note:  combinedNote('Tank (Main)', tank, 'Bench', benchRole),
    },
  ];

  // ── Write loot legend — column H starting at row 7 ────────────────────

  for (let i = 0; i < lootLegend.length; i++) {
    const cell = genSheet.getRange(7 + i, 8);
    cell.setValue(lootLegend[i].label);
    cell.setBackground(lootLegend[i].color);
    cell.setFontSize(9);
    cell.setFontColor('#3A3A38');
    cell.setVerticalAlignment('middle');
    cell.setHorizontalAlignment('left');
    cell.setFontWeight('normal');
    cell.setFontStyle('normal');
    cell.clearNote();
    genSheet.setRowHeight(7 + i, 18);
  }

  // ── Gap row ───────────────────────────────────────────────────────────

  let currentLegendRow = 11;
  genSheet.getRange(currentLegendRow, 8, 1, 3).clearContent().setBackground(null).clearNote();
  genSheet.setRowHeight(currentLegendRow, 8);
  currentLegendRow++;

  // ── Base multipliers header ───────────────────────────────────────────

  const baseHeader = genSheet.getRange(currentLegendRow, 8, 1, 3);
  baseHeader.breakApart();
  baseHeader.merge();
  baseHeader.setValue('  Base Multipliers');
  baseHeader.setBackground('#1A1A1A');
  baseHeader.setFontColor('#FFFFFF');
  baseHeader.setFontSize(9);
  baseHeader.setFontWeight('bold');
  baseHeader.setVerticalAlignment('middle');
  baseHeader.setHorizontalAlignment('left');
  genSheet.setRowHeight(currentLegendRow, 18);
  currentLegendRow++;

  for (let i = 0; i < baseMultipliers.length; i++) {
    const bg = i % 2 === 0 ? '#F8F7F4' : '#FFFFFF';

    const labelCell = genSheet.getRange(currentLegendRow, 8);
    labelCell.setValue(baseMultipliers[i].label);
    labelCell.setBackground(bg);
    labelCell.setFontSize(9);
    labelCell.setFontColor('#3A3A38');
    labelCell.setVerticalAlignment('middle');
    labelCell.setHorizontalAlignment('left');
    labelCell.setFontWeight('normal');
    labelCell.setFontStyle('normal');
    labelCell.setNote(baseMultipliers[i].note);

    const valueCell = genSheet.getRange(currentLegendRow, 9);
    valueCell.setValue(baseMultipliers[i].value);
    valueCell.setBackground(bg);
    valueCell.setFontSize(9);
    valueCell.setFontColor('#3A3A38');
    valueCell.setVerticalAlignment('middle');
    valueCell.setHorizontalAlignment('left');
    valueCell.setFontWeight('normal');
    valueCell.setFontStyle('normal');
    valueCell.clearNote();

    const exCell = genSheet.getRange(currentLegendRow, 10);
    exCell.setValue('');
    exCell.setBackground(bg);
    exCell.clearNote();

    genSheet.setRowHeight(currentLegendRow, 18);
    currentLegendRow++;
  }

  // ── Gap row ───────────────────────────────────────────────────────────

  genSheet.getRange(currentLegendRow, 8, 1, 3).clearContent().setBackground(null).clearNote();
  genSheet.setRowHeight(currentLegendRow, 8);
  currentLegendRow++;

  // ── Effective multipliers header ──────────────────────────────────────

  const effHeader = genSheet.getRange(currentLegendRow, 8, 1, 3);
  effHeader.breakApart();
  effHeader.merge();
  effHeader.setValue('  Effective Multipliers (example based on raw score of 8.0)');
  effHeader.setBackground('#1A1A1A');
  effHeader.setFontColor('#FFFFFF');
  effHeader.setFontSize(9);
  effHeader.setFontWeight('bold');
  effHeader.setVerticalAlignment('middle');
  effHeader.setHorizontalAlignment('left');
  genSheet.setRowHeight(currentLegendRow, 18);
  currentLegendRow++;

  for (let i = 0; i < effectiveMultipliers.length; i++) {
    const bg = i % 2 === 0 ? '#F8F7F4' : '#FFFFFF';

    const labelCell = genSheet.getRange(currentLegendRow, 8);
    labelCell.setValue(effectiveMultipliers[i].label);
    labelCell.setBackground(bg);
    labelCell.setFontSize(9);
    labelCell.setFontColor('#3A3A38');
    labelCell.setVerticalAlignment('middle');
    labelCell.setHorizontalAlignment('left');
    labelCell.setFontWeight('normal');
    labelCell.setFontStyle('normal');
    labelCell.setNote(effectiveMultipliers[i].note);

    const valueCell = genSheet.getRange(currentLegendRow, 9);
    valueCell.setValue(effectiveMultipliers[i].value);
    valueCell.setBackground(bg);
    valueCell.setFontSize(9);
    valueCell.setFontColor('#3A3A38');
    valueCell.setVerticalAlignment('middle');
    valueCell.setHorizontalAlignment('left');
    valueCell.setFontWeight('normal');
    valueCell.setFontStyle('normal');
    valueCell.clearNote();

    const exCell = genSheet.getRange(currentLegendRow, 10);
    exCell.setValue(effectiveMultipliers[i].ex);
    exCell.setBackground(bg);
    exCell.setFontSize(9);
    exCell.setFontColor('#888888');
    exCell.setVerticalAlignment('middle');
    exCell.setHorizontalAlignment('left');
    exCell.setFontWeight('normal');
    exCell.setFontStyle('italic');
    exCell.clearNote();

    genSheet.setRowHeight(currentLegendRow, 18);
    currentLegendRow++;
  }

  SpreadsheetApp.getUi().alert('✅ Legend written.');
}
