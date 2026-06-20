function buildBenchFairness() {
  var el = document.getElementById('benchFairnessContent');
  if (!el) return;

  if (!Array.isArray(_attendanceGrid) || !_attendanceGrid.length) {
    el.innerHTML = '<p style="color:var(--text-muted);padding:0.5rem 0;">No attendance data. Run "Refresh from WCL" on the Attendance tab first.</p>';
    return;
  }

  var roster     = DATA.roster || [];
  var roleOrder  = ['Tank', 'Heal', 'Melee', 'Ranged', 'Bench'];
  var roleLabels = { Tank: 'Tanks', Heal: 'Healers', Melee: 'Melee', Ranged: 'Ranged', Bench: 'Bench' };
  var roleColors = { Tank: 'var(--tank)', Heal: 'var(--heal)', Melee: 'var(--melee)', Ranged: 'var(--ranged)', Bench: 'var(--text-dim)' };

  var benchCounts = {};
  var raidCounts  = {};
  var range       = getSeasonDateRange();

  for (var i = 0; i < _attendanceGrid.length; i++) {
    var raid = _attendanceGrid[i];
    if (raid.excluded) continue;
    // Filter to active season window when dates are present
    if (raid.date) {
      if (range.start && raid.date < range.start) continue;
      if (range.end   && raid.date > range.end)   continue;
    }
    for (var j = 0; j < raid.players.length; j++) {
      var p    = raid.players[j];
      var name = p.name;
      if (!raidCounts[name]) { raidCounts[name] = 0; benchCounts[name] = 0; }
      raidCounts[name]++;
      if (p.status === 'Bench') benchCounts[name]++;
    }
  }

  var rosterMap = {};
  for (var i = 0; i < roster.length; i++) {
    rosterMap[roster[i].firstName] = roster[i];
  }

  var allEntries = [];
  var names      = Object.keys(raidCounts);
  for (var i = 0; i < names.length; i++) {
    var name   = names[i];
    var player = rosterMap[name];
    var role   = player ? (player.isBench ? 'Bench' : player.role) : null;
    if (!role) continue;
    var benched = benchCounts[name] || 0;
    var total   = raidCounts[name]  || 0;
    var rate    = total > 0 ? Math.round((benched / total) * 100) : 0;
    allEntries.push({ name: (player.nick || name), role: role, benched: benched, total: total, rate: rate });
  }

  var maxBenched = 0;
  var totalBenched = 0;
  for (var i = 0; i < allEntries.length; i++) {
    if (allEntries[i].benched > maxBenched) maxBenched = allEntries[i].benched;
    totalBenched += allEntries[i].benched;
  }
  if (maxBenched === 0) maxBenched = 1;
  var avg    = allEntries.length ? totalBenched / allEntries.length : 0;
  var avgPct = Math.round((avg / maxBenched) * 100) + '%';

  var grouped = {};
  for (var i = 0; i < roleOrder.length; i++) grouped[roleOrder[i]] = [];
  for (var i = 0; i < allEntries.length; i++) {
    if (grouped[allEntries[i].role]) grouped[allEntries[i].role].push(allEntries[i]);
  }
  for (var r = 0; r < roleOrder.length; r++) {
    grouped[roleOrder[r]].sort(function(a, b) { return b.benched - a.benched; });
  }

  var html = '<div style="display:flex;align-items:center;margin-bottom:0.75rem;">' +
    '<span class="section-label" style="margin-bottom:0;">Bench Fairness<button class="help-btn" onclick="toggleHelp(\'help-bench-fairness\')" title="Show help">?</button></span>' +
    '</div>' +
    '<div id="help-bench-fairness" class="help-tip" style="margin-top:0;margin-bottom:0.75rem;">' +
    'Shows how many times each raider has been benched, grouped by role and sorted from most to fewest. The vertical line marks the raid average.<br>' +
    'Bench rate (%) = times benched / total raid nights that player appeared. Use this to ensure rotation is spread fairly across willing raiders.' +
    '</div>';

  for (var r = 0; r < roleOrder.length; r++) {
    var role    = roleOrder[r];
    var players = grouped[role];
    if (!players.length) continue;
    var color = roleColors[role];
    html += '<div class="fairness-section-header" style="color:' + color + ';">' + roleLabels[role] + '</div>';
    for (var i = 0; i < players.length; i++) {
      var e     = players[i];
      var width = Math.round((e.benched / maxBenched) * 100) + '%';
      html += '<div class="fairness-row">';
      html += '<span style="font-size:0.9rem;color:var(--text);font-weight:500;">' + e.name + '</span>';
      html += '<div class="fairness-bar-wrap"><div class="fairness-bar" style="width:' + width + ';background:' + color + ';"></div><div class="fairness-avg-line" style="left:' + avgPct + ';"></div></div>';
      html += '<span class="fairness-count">' + e.benched + '<span style="font-size:0.75rem;color:var(--text-muted);font-weight:400;margin-left:3px;">(' + e.rate + '%)</span></span>';
      html += '</div>';
    }
  }

  html += '<div class="fairness-avg-legend"><span class="fairness-avg-line-swatch"></span>Avg: ' + Math.round(avg * 10) / 10 + ' bench nights</div>';
  el.innerHTML = html;
}
