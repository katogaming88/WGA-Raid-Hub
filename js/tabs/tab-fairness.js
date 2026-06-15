var activeDiffFilter = 'all';

function setDiffFilter(val) {
  activeDiffFilter = val;
  ['all','heroic','mythic'].forEach(function(v) {
    var el = document.getElementById('diff-chip-' + v);
    if (el) el.classList.toggle('active', v === val);
  });
  buildFairness();
}

function buildFairness() {
  var roster     = DATA.roster || [];
  var roleOrder  = ['Tank','Heal','Melee','Ranged','Bench'];
  var roleLabels = { Tank:'Tanks', Heal:'Healers', Melee:'Melee', Ranged:'Ranged', Bench:'Bench' };
  var roleColors = { Tank:'var(--tank)', Heal:'var(--heal)', Melee:'var(--melee)', Ranged:'var(--ranged)', Bench:'var(--text-dim)' };

  var allEntries = [];
  for (var i = 0; i < roster.length; i++) {
    var p     = roster[i];
    var entry = getLootEntry(p.firstName);
    var count = 0;
    if (entry) {
      if (activeDiffFilter === 'heroic')      count = entry.heroicCount || 0;
      else if (activeDiffFilter === 'mythic') count = entry.mythicCount || 0;
      else                                    count = entry.count || 0;
    }
    allEntries.push({ name: p.nick||p.firstName, count: count, role: p.isBench?'Bench':p.role });
  }

  var max = 0, totalCount = 0;
  for (var i = 0; i < allEntries.length; i++) { if (allEntries[i].count > max) max = allEntries[i].count; totalCount += allEntries[i].count; }
  if (max === 0) max = 1;
  var avg    = allEntries.length ? totalCount / allEntries.length : 0;
  var avgPct = Math.round((avg / max) * 100) + '%';

  var grouped = {};
  for (var i = 0; i < roleOrder.length; i++) grouped[roleOrder[i]] = [];
  for (var i = 0; i < allEntries.length; i++) {
    var e = allEntries[i];
    if (grouped[e.role]) grouped[e.role].push(e);
  }
  for (var r = 0; r < roleOrder.length; r++) {
    grouped[roleOrder[r]].sort(function(a,b) { return b.count - a.count; });
  }

  var html = '';
  for (var r = 0; r < roleOrder.length; r++) {
    var role    = roleOrder[r];
    var players = grouped[role];
    if (!players.length) continue;
    var color = roleColors[role];
    html += '<div class="fairness-section-header" style="color:'+color+';">'+roleLabels[role]+'</div>';
    for (var i = 0; i < players.length; i++) {
      var e     = players[i];
      var width = Math.round((e.count/max)*100) + '%';
      html += '<div class="fairness-row">';
      html += '<span style="font-size:0.9rem;color:var(--text);font-weight:500;">'+e.name+'</span>';
      html += '<div class="fairness-bar-wrap"><div class="fairness-bar" style="width:'+width+';background:'+color+';"></div><div class="fairness-avg-line" style="left:'+avgPct+';"></div></div>';
      html += '<span class="fairness-count">'+e.count+'</span>';
      html += '</div>';
    }
  }
  var diffLabel = activeDiffFilter === 'heroic' ? 'Heroic' : activeDiffFilter === 'mythic' ? 'Mythic' : 'All';
  html += '<div class="fairness-avg-legend"><span class="fairness-avg-line-swatch"></span>'+diffLabel+' avg: '+Math.round(avg)+' items</div>';
  document.getElementById('fairnessContent').innerHTML = html;
}
