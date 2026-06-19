// Public page: view switching, player dropdown, boot
function showView(name) {
  document.getElementById('loadingMsg').style.display = 'none';
  ['landingView','profileViewWrap','signupViewWrap'].forEach(function(id) {
    document.getElementById(id).classList.remove('active');
  });
  if (name === 'landing') { document.getElementById('landingView').classList.add('active'); renderSignupLandingLink(); }
  if (name === 'profile') document.getElementById('profileViewWrap').classList.add('active');
  if (name === 'signup')  document.getElementById('signupViewWrap').classList.add('active');
}

function populateDropdown() {
  var sel    = document.getElementById('playerSelect');
  var order  = ['Tank','Heal','Melee','Ranged'];
  var labels = { Tank:'Tanks', Heal:'Healers', Melee:'Melee', Ranged:'Ranged' };
  var groups = { Tank:[], Heal:[], Melee:[], Ranged:[] };
  for (var i = 0; i < DATA.roster.length; i++) {
    var p = DATA.roster[i];
    if (!p.isBench && groups[p.role]) groups[p.role].push(p);
  }
  for (var r = 0; r < order.length; r++) {
    var role = order[r];
    var players = groups[role];
    if (!players.length) continue;
    players.sort(function(a,b) { return (a.nick||a.firstName).localeCompare(b.nick||b.firstName); });
    var group = document.createElement('optgroup');
    group.label = labels[role];
    for (var j = 0; j < players.length; j++) {
      var p = players[j];
      var opt = document.createElement('option');
      opt.value = p.firstName;
      opt.textContent = p.nick ? p.nick + ' (' + p.firstName + ')' : p.firstName;
      group.appendChild(opt);
    }
    sel.appendChild(group);
  }
}

function renderSignupLandingLink() {
  var el = document.getElementById('signupLink');
  if (el) el.style.display = (DATA && DATA.signupsOpen) ? '' : 'none';
}

document.getElementById('playerSelect').addEventListener('change', function(e) {
  if (e.target.value) { showView('profile'); renderProfile(e.target.value, 'landing'); }
});

function buildPublicStats() {
  var loot       = DATA.lootCounts || {};
  var totalItems = 0;
  var keys       = Object.keys(loot);
  for (var i = 0; i < keys.length; i++) totalItems += loot[keys[i]].count || 0;

  var el = document.getElementById('landingStats');
  if (!el) return;
  el.innerHTML =
    '<div class="pub-stat"><span class="pub-stat-num">' + (DATA.roster || []).length + '</span><span class="pub-stat-label">Raiders</span></div>' +
    '<div class="pub-stat"><span class="pub-stat-num">' + totalItems + '</span><span class="pub-stat-label">Items This Tier</span></div>';
}

function buildRecentLoot() {
  var loot   = DATA.lootCounts || {};
  var roster = DATA.roster     || [];

  var nameMap = {};
  for (var i = 0; i < roster.length; i++) {
    nameMap[normalise(roster[i].firstName)] = roster[i].nick || roster[i].firstName;
  }

  var all  = [];
  var keys = Object.keys(loot);
  for (var i = 0; i < keys.length; i++) {
    var key     = keys[i];
    var items   = loot[key].items || [];
    var display = nameMap[key] || (key.charAt(0).toUpperCase() + key.slice(1));
    for (var j = 0; j < items.length; j++) {
      all.push({ player: display, item: items[j].name, difficulty: items[j].difficulty, date: items[j].date, _d: new Date(items[j].date) });
    }
  }

  all.sort(function(a, b) { return b._d - a._d; });
  var recent = all.slice(0, 10);

  var el = document.getElementById('landingLoot');
  if (!el || !recent.length) return;

  var html = '<div class="pub-loot-title">Recent Loot</div>';
  for (var i = 0; i < recent.length; i++) {
    var e         = recent[i];
    var diffClass = e.difficulty === 'Mythic' ? 'diff-mythic' : e.difficulty === 'Heroic' ? 'diff-heroic' : 'diff-other';
    html +=
      '<div class="pub-loot-row">' +
        '<span class="pub-loot-player">' + e.player + '</span>' +
        '<span class="pub-loot-item">' + e.item + '</span>' +
        '<span class="pub-loot-diff ' + diffClass + '">' + e.difficulty + '</span>' +
        '<span class="pub-loot-date">' + e.date + '</span>' +
      '</div>';
  }
  el.innerHTML = html;
}

// Boot
loadData(
  function() {
    populateDropdown();
    buildPublicStats();
    showView('landing');
  },
  function() {
    buildPublicStats();
    buildRecentLoot();
    var sel         = document.getElementById('playerSelect');
    var profileWrap = document.getElementById('profileViewWrap');
    if (sel && sel.value && profileWrap && profileWrap.classList.contains('active')) {
      renderProfile(sel.value, 'landing');
    }
  }
);
