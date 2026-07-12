var activeDiffFilter = 'all';

function setDiffFilter(val) {
  activeDiffFilter = val;
  ['all', 'heroic', 'mythic'].forEach(function (v) {
    var el = document.getElementById('diff-chip-' + v);
    if (el) el.classList.toggle('active', v === val);
  });
  buildFairness();
}

function buildFairness() {
  var roster = DATA.roster || [];
  var roleOrder = ['Tank', 'Heal', 'Melee', 'Ranged', 'Bench'];
  var roleLabels = { Tank: 'Tanks', Heal: 'Healers', Melee: 'Melee', Ranged: 'Ranged', Bench: 'Bench' };
  var roleColors = {
    Tank: 'var(--tank)',
    Heal: 'var(--heal)',
    Melee: 'var(--melee)',
    Ranged: 'var(--ranged)',
    Bench: 'var(--text-dim)'
  };

  var allEntries = [];
  for (var i = 0; i < roster.length; i++) {
    var p = roster[i];
    var entry = getSeasonLootEntry(p.firstName);
    var count = 0;
    if (entry) {
      if (activeDiffFilter === 'heroic') count = entry.heroicCount || 0;
      else if (activeDiffFilter === 'mythic') count = entry.mythicCount || 0;
      else count = entry.count || 0;
    }
    allEntries.push({ name: p.nick || p.firstName, count: count, role: p.isBench ? 'Bench' : p.role });
  }

  var max = 0,
    totalCount = 0;
  for (var i = 0; i < allEntries.length; i++) {
    if (allEntries[i].count > max) max = allEntries[i].count;
    totalCount += allEntries[i].count;
  }
  if (max === 0) max = 1;
  var avg = allEntries.length ? totalCount / allEntries.length : 0;
  var avgPct = Math.round((avg / max) * 100) + '%';

  var grouped = {};
  for (var i = 0; i < roleOrder.length; i++) grouped[roleOrder[i]] = [];
  for (var i = 0; i < allEntries.length; i++) {
    var e = allEntries[i];
    if (grouped[e.role]) grouped[e.role].push(e);
  }
  for (var r = 0; r < roleOrder.length; r++) {
    grouped[roleOrder[r]].sort(function (a, b) {
      return b.count - a.count;
    });
  }

  var html =
    '<div style="display:flex;align-items:center;margin-bottom:0.75rem;">' +
    '<span class="section-label" style="margin-bottom:0;">Loot Fairness<button class="help-btn" onclick="toggleHelp(\'help-loot-fairness\')" title="Show help">?</button></span>' +
    '</div>' +
    '<div id="help-loot-fairness" class="help-tip" style="margin-top:0;margin-bottom:0.75rem;">' +
    'Shows how many items each raider has received, grouped by role and sorted from most to fewest. The vertical line marks the raid average for the selected difficulty.<br>' +
    'Use the <strong>All / Heroic / Mythic</strong> difficulty filter above to scope the view. Use this alongside Contested Items to inform priority decisions for contested loot.' +
    '</div>';
  for (var r = 0; r < roleOrder.length; r++) {
    var role = roleOrder[r];
    var players = grouped[role];
    if (!players.length) continue;
    var color = roleColors[role];
    html += '<div class="fairness-section-header" style="color:' + color + ';">' + roleLabels[role] + '</div>';
    for (var i = 0; i < players.length; i++) {
      var e = players[i];
      var width = Math.round((e.count / max) * 100) + '%';
      html += '<div class="fairness-row">';
      html += '<span style="font-size:1.02rem;color:var(--text);font-weight:500;">' + e.name + '</span>';
      html +=
        '<div class="fairness-bar-wrap"><div class="fairness-bar" style="width:' +
        width +
        ';background:' +
        color +
        ';"></div><div class="fairness-avg-line" style="left:' +
        avgPct +
        ';"></div></div>';
      html += '<span class="fairness-count">' + e.count + '</span>';
      html += '</div>';
    }
  }
  var diffLabel = activeDiffFilter === 'heroic' ? 'Heroic' : activeDiffFilter === 'mythic' ? 'Mythic' : 'All';
  var seasonLabel = ACTIVE_SEASON ? ' &mdash; ' + ACTIVE_SEASON : ' &mdash; All Seasons';
  html +=
    '<div class="fairness-avg-legend"><span class="fairness-avg-line-swatch"></span>' +
    diffLabel +
    ' avg: ' +
    Math.round(avg) +
    ' items' +
    seasonLabel +
    '</div>';
  document.getElementById('fairnessContent').innerHTML = html;
}
