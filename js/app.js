var WEB_APP_URL  = 'https://script.google.com/macros/s/AKfycbxrQdQGqbBTELWm7huWChdbES0ry7WFZetlELWuEdI0T6lfbXEzrqx9Vo5yA-b9dW4y7A/exec';
var OFFICER_PASS = 'phoenix2'; // change this
var DATA         = null;
var activeFilters = {};
var activeSort = { key: null, dir: 1 };
var selectedOfficerPlayer = null;

function normalise(str) {
  return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// -- Views ------------------------------------------------------------------
function showView(name) {
  document.getElementById('loadingMsg').style.display = 'none';
  ['landingView','profileViewWrap','officerViewWrap'].forEach(function(id) {
    document.getElementById(id).classList.remove('active');
  });
  if (name === 'landing') document.getElementById('landingView').classList.add('active');
  if (name === 'profile') document.getElementById('profileViewWrap').classList.add('active');
  if (name === 'officer') document.getElementById('officerViewWrap').classList.add('active');
}

// -- Tabs -------------------------------------------------------------------
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
  document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
  event.target.classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
  if (name === 'conflicts')  buildConflicts();
  if (name === 'fairness')   buildFairness();
  if (name === 'attendance') buildAttendanceTab();
}

// -- Load data --------------------------------------------------------------
function loadData() {
  window._rosterCallback = function(data) {
    try {
      if (data.error) throw new Error(data.error);
      DATA = data;
      populateDropdown();
      if (sessionStorage.getItem('phoenix_officer') === '1') {
        buildOfficerDashboard();
        showView('officer');
      } else {
        showView('landing');
      }
    } catch (e) {
      document.getElementById('loadingMsg').className = 'state-msg error';
      document.getElementById('loadingMsg').innerHTML = 'Could not load roster data. ' + e.message;
    }
  };
  var script = document.createElement('script');
  script.src = WEB_APP_URL + '?callback=_rosterCallback';
  script.onerror = function() {
    document.getElementById('loadingMsg').className = 'state-msg error';
    document.getElementById('loadingMsg').innerHTML = 'Could not load roster data.';
  };
  document.head.appendChild(script);
  setTimeout(function() {
    if (!DATA) {
      document.getElementById('loadingMsg').className = 'state-msg error';
      document.getElementById('loadingMsg').innerHTML = 'Request timed out.';
    }
  }, 15000);
}

// -- Dropdown ---------------------------------------------------------------
function populateDropdown() {
  var sel    = document.getElementById('playerSelect');
  var order  = ['Tank','Heal','Melee','Ranged'];
  var labels = { Tank:'🛡 Tanks', Heal:'💚 Healers', Melee:'⚔️ Melee', Ranged:'🏹 Ranged' };
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

document.getElementById('playerSelect').addEventListener('change', function(e) {
  if (e.target.value) { showView('profile'); renderProfile(e.target.value, 'landing'); }
});

// -- Officer prompt ---------------------------------------------------------
function showOfficerPrompt() {
  document.getElementById('officerPassword').value = '';
  document.getElementById('officerError').style.display = 'none';
  document.getElementById('officerPrompt').classList.add('active');
  setTimeout(function() { document.getElementById('officerPassword').focus(); }, 50);
}
function hideOfficerPrompt() { document.getElementById('officerPrompt').classList.remove('active'); }
function submitOfficerPassword() {
  if (document.getElementById('officerPassword').value === OFFICER_PASS) {
    sessionStorage.setItem('phoenix_officer','1');
    hideOfficerPrompt();
    buildOfficerDashboard();
    showView('officer');
  } else {
    document.getElementById('officerError').style.display = '';
  }
}
function officerLogout() { sessionStorage.removeItem('phoenix_officer'); showView('landing'); }

// -- Helpers ----------------------------------------------------------------
function getRank(firstName, itemName) {
  var list = (DATA.priorityOrder || {})[itemName];
  if (!list) return null;
  var norm = normalise(firstName);
  for (var i = 0; i < list.length; i++) { if (normalise(list[i]) === norm) return i + 1; }
  return null;
}
function getBisItems(firstName) {
  var bisMap = DATA.bisList || {};
  var norm   = normalise(firstName);
  var key    = null;
  var keys   = Object.keys(bisMap);
  for (var i = 0; i < keys.length; i++) { if (normalise(keys[i]) === norm) { key = keys[i]; break; } }
  var entries = key ? bisMap[key] : [];
  return entries.map(function(e) { return (typeof e === 'string') ? {item:e,slot:''} : e; });
}
function getLootEntry(firstName) {
  var lootMap = DATA.lootCounts || {};
  var norm    = normalise(firstName);
  var keys    = Object.keys(lootMap);
  for (var i = 0; i < keys.length; i++) { if (normalise(keys[i]) === norm) return lootMap[keys[i]]; }
  return null;
}
function rankPillHTML(rank) {
  if (rank === null) return '<span style="font-size:0.72rem;color:var(--text-dim);min-width:40px;text-align:center;">—</span>';
  var t  = Math.min((rank-1)/14, 1);
  var rv = Math.round(214+(100-214)*t), gv = Math.round(163+(100-163)*t), bv = Math.round(68+(100-68)*t);
  var a  = Math.max(0.08, 0.18-t*0.1);
  var c  = 'rgb('+rv+','+gv+','+bv+')', bg = 'rgba('+rv+','+gv+','+bv+','+a+')', bd = 'rgba('+rv+','+gv+','+bv+','+ Math.max(0.2,0.4-t*0.2)+')';
  return '<span class="rank-pill" style="background:'+bg+';color:'+c+';border:1px solid '+bd+';">#'+rank+'</span>';
}
function getSlotColor(slot) {
  var s = (slot||'').toUpperCase();
  if (s==='TRINKET'||s==='TRINKET 1'||s==='TRINKET 2') return 'var(--gold)';
  if (s==='NECK'||s==='RING 1'||s==='RING 2')          return 'var(--ranged)';
  if (s==='1H/2H'||s==='OH')                            return 'var(--melee)';
  if (['HEAD','SHOULDERS','CHEST','GLOVES','LEGS','CLOAK','BRACERS','BELT','BOOTS'].indexOf(s)>=0) return 'var(--tank)';
  return 'var(--text)';
}
function attendColor(pct) { return pct>=90?'var(--heal)':pct>=75?'var(--gold)':'var(--melee)'; }

// -- Render profile ---------------------------------------------------------
function renderProfile(firstName, backTo, container) {
  var norm   = normalise(firstName);
  var player = null;
  for (var i = 0; i < DATA.roster.length; i++) { if (normalise(DATA.roster[i].firstName)===norm) { player=DATA.roster[i]; break; } }
  if (!player) return;

  var displayName = player.nick || player.firstName;
  var initials    = displayName.slice(0,2).toUpperCase();
  var classLine   = player.class ? '<span class="badge badge-class">'+player.class+(player.spec?' · '+player.spec:'')+'</span>' : '';
  var trialBadge  = player.isTrial ? '<span class="badge badge-trial">Trial</span>' : '';
  var benchBadge  = player.isBench ? '<span class="badge" style="background:rgba(255,255,255,0.04);color:var(--text);border:1px solid var(--border);">Bench</span>' : '';

  // Attendance
  var attendPct    = player.attendance || '—';
  var barWidth     = player.attendance || '0%';
  var attendDetail = (DATA.attendanceDetails || {})[player.firstName] || [];
  var hasPenalties = attendDetail.length > 0;
  var attendExtra  = '';
  if (hasPenalties) {
    attendExtra += '<div id="attend-detail-'+player.firstName+'" style="display:none;margin-top:0.75rem;flex-direction:column;gap:0.3rem;">';
    for (var ai = 0; ai < attendDetail.length; ai++) {
      var ae = attendDetail[ai];
      var sc = ae.status==='No Show'?'var(--melee)':'var(--gold)';
      attendExtra += '<div style="display:flex;justify-content:space-between;font-size:1rem;padding:0.25rem 0;border-bottom:1px solid var(--border);">';
      attendExtra += '<span style="color:var(--text);">'+ae.date+'</span>';
      attendExtra += '<span style="color:'+sc+';font-weight:600;">'+ae.status+'</span></div>';
    }
    attendExtra += '</div>';
  }

  // Loot
  var lootEntry     = getLootEntry(player.firstName);
  var lootCount     = lootEntry ? lootEntry.count : 0;
  var lootItemsHTML = '';
  if (lootEntry && lootEntry.items) {
    for (var li = 0; li < lootEntry.items.length; li++) {
      lootItemsHTML += '<div style="font-size:0.88rem;color:var(--text);padding:0.3rem 0;border-bottom:1px solid var(--border);">'+lootEntry.items[li]+'</div>';
    }
  }

  // BiS link
  var bisHTML = player.bisLink
    ? '<div class="bis-row"><div class="bis-dot yes"></div><a class="bis-link" href="'+player.bisLink+'" target="_blank" rel="noopener">View BiS list →</a></div>'
    : '<div class="bis-row"><div class="bis-dot no"></div><span class="bis-none">No BiS list submitted yet</span></div>';

  // Priority
  var bisItems = getBisItems(player.firstName);
  var rows = '';
  for (var bi = 0; bi < bisItems.length; bi++) {
    var entry = bisItems[bi];
    var item  = entry.item, bisSlot = entry.slot;
    var rank  = getRank(player.firstName, item);
    var slot  = (DATA.itemSlots||{})[item] || bisSlot || '';
    var isGen = (item==='M+'||item==='Crafted'||item==='Catalyst');
    rows += '<div class="priority-row" style="grid-template-columns:auto auto 1fr;">';
    rows += isGen ? '<span style="font-size:0.72rem;color:var(--text-dim);min-width:40px;text-align:center;">—</span>' : rankPillHTML(rank);
    rows += '<span class="priority-item-slot" style="color:'+getSlotColor(slot)+';">'+slot+'</span>';
    rows += '<span class="priority-item-name" style="text-align:right;" title="'+item+'">'+item+'</span></div>';
  }
  var priorityHTML = bisItems.length
    ? '<div class="priority-list">' +
        '<div class="priority-row" style="grid-template-columns:auto auto 1fr;background:transparent;border:none;padding:0.2rem 0.8rem;">' +
          '<span style="font-size:0.9rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text);">Prio</span>' +
          '<span style="font-size:0.9rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text);">Slot</span>' +
          '<span style="font-size:0.9rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text);text-align:right;">Item / Source</span>' +
        '</div>' + rows + '</div>'
    : '<p class="no-items-msg">No BiS items on record yet.</p>';

  var backLabel  = backTo==='officer' ? '← Back to dashboard' : '← Back to roster';
  var backAction = backTo==='officer'
    ? 'document.getElementById(\'officerProfile\').innerHTML=\'\';selectedOfficerPlayer=null;document.querySelectorAll(\'.player-row\').forEach(function(r){r.classList.remove(\'selected\')});'
    : 'showView(\'landing\');document.getElementById(\'playerSelect\').value=\'\';';

  var html =
    '<div class="profile-card">' +
      '<div class="role-bar role-bar-'+player.role+'"></div>' +
      '<div style="padding:0.6rem 1.25rem;border-bottom:1px solid var(--border);">' +
        '<button onclick="'+backAction+'" style="background:none;border:none;color:var(--text);font-family:\'Rajdhani\',sans-serif;font-size:0.78rem;letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;padding:0;">'+backLabel+'</button>' +
      '</div>' +
      '<div class="profile-header">' +
        '<div class="profile-avatar avatar-'+player.role+'">'+initials+'</div>' +
        '<div class="profile-identity">' +
          '<div class="profile-name">'+displayName+'</div>' +
          '<div class="profile-realm">'+player.firstName+'-'+player.realm+'</div>' +
          '<div class="profile-badges"><span class="badge badge-'+player.role+'">'+player.role+'</span>'+trialBadge+benchBadge+classLine+'</div>' +
        '</div>' +
      '</div>' +
      '<div class="profile-section"'+(hasPenalties?' onclick="var d=document.getElementById(\'attend-detail-'+player.firstName+'\');d.style.display=d.style.display===\'none\'?\'flex\':\'none\';" style="cursor:pointer;"':'')+'>' +
        '<div class="section-label" style="display:flex;justify-content:space-between;align-items:center;">Attendance'+(hasPenalties?'<span style="font-size:0.7rem;color:var(--text-dim);">tap to expand</span>':'')+'</div>' +
        '<div class="attend-row"><div class="attend-bar-wrap"><div class="attend-bar" style="width:'+barWidth+'"></div></div><span class="attend-label">'+attendPct+'</span></div>' +
        attendExtra +
      '</div>' +
      '<div class="profile-section" onclick="var l=document.getElementById(\'loot-list-'+player.firstName+'\');l.style.display=l.style.display===\'none\'?\'flex\':\'none\';" style="cursor:pointer;">' +
        '<div class="section-label" style="display:flex;justify-content:space-between;align-items:center;">Items Received <span style="font-size:0.7rem;color:var(--text-dim);">tap to expand</span></div>' +
        '<div style="font-size:1.1rem;font-weight:600;color:var(--gold);">'+lootCount+' item'+(lootCount!==1?'s':'')+' this tier</div>' +
        '<div id="loot-list-'+player.firstName+'" style="display:none;margin-top:0.75rem;flex-direction:column;gap:0.35rem;">'+lootItemsHTML+'</div>' +
      '</div>' +
      '<div class="profile-section"><div class="section-label">BiS List</div>'+bisHTML+'</div>' +
      '<div class="profile-section" onclick="var l=document.getElementById(\'prio-list-'+player.firstName+'\');l.style.display=l.style.display===\'none\'?\'block\':\'none\';" style="cursor:pointer;">' +
        '<div class="section-label" style="display:flex;justify-content:space-between;align-items:center;">Loot Priority <span style="font-size:0.7rem;color:var(--text-dim);">tap to expand</span></div>' +
        '<div id="prio-list-'+player.firstName+'" style="display:none;">'+priorityHTML+'</div>' +
      '</div>' +
    '</div>';

  if (container) { container.innerHTML = html; }
  else { document.getElementById('profileView').innerHTML = html; }
}

// -- Officer dashboard ------------------------------------------------------
function buildOfficerDashboard() {
  buildRosterTable();
}

// -- Filters ----------------------------------------------------------------
function toggleFilter(name) {
  activeFilters[name] = !activeFilters[name];
  document.getElementById('chip-'+name).classList.toggle('active', activeFilters[name]);
  buildRosterTable();
}

function toggleRole(role) {
  var current = activeFilters.role;
  activeFilters.role = (current === role) ? null : role;
  ['Tank','Heal','Melee','Ranged'].forEach(function(r) {
    document.getElementById('chip-role-'+r).classList.toggle('active', activeFilters.role === r);
  });
  buildRosterTable();
}

function toggleSort(key) {
  if (activeSort.key === key) {
    activeSort.dir *= -1;
  } else {
    activeSort.key = key;
    activeSort.dir = 1;
  }
  ['name','attendance','items'].forEach(function(k) {
    var chip = document.getElementById('chip-sort-' + k);
    var isActive = activeSort.key === k;
    chip.classList.toggle('active', isActive);
    chip.textContent = { name:'Name', attendance:'Attendance', items:'Items' }[k] + (isActive ? (activeSort.dir === 1 ? ' ^' : ' v') : '');
  });
  buildRosterTable();
}

// -- Roster table -----------------------------------------------------------
function buildRosterTable() {
  var order  = ['Tank','Heal','Melee','Ranged','Bench'];
  var labels = { Tank:'🛡 Tanks', Heal:'💚 Healers', Melee:'⚔️ Melee', Ranged:'🏹 Ranged', Bench:'🪑 Bench' };
  var groups = { Tank:[], Heal:[], Melee:[], Ranged:[], Bench:[] };

  var searchTerm  = normalise((document.getElementById('rosterSearch')  || {}).value || '');
  var bisItemTerm = normalise((document.getElementById('bisItemSearch') || {}).value || '');

  for (var i = 0; i < DATA.roster.length; i++) {
    var p = DATA.roster[i];
    if (activeFilters.lowAttend && (parseInt(p.attendance)||0) >= 90) continue;
    if (activeFilters.noBis && p.bisLink) continue;
    if (activeFilters.trial && !p.isTrial) continue;
    if (activeFilters.bench && !p.isBench) continue;
    if (activeFilters.role && p.role !== activeFilters.role) continue;
    if (searchTerm && normalise(p.nick||'').indexOf(searchTerm) === -1 && normalise(p.firstName||'').indexOf(searchTerm) === -1) continue;
    if (bisItemTerm) {
      var bisItems = getBisItems(p.firstName);
      var hasBisMatch = false;
      for (var bi = 0; bi < bisItems.length; bi++) {
        if (normalise(bisItems[bi].item).indexOf(bisItemTerm) !== -1) { hasBisMatch = true; break; }
      }
      if (!hasBisMatch) continue;
    }
    if (p.isBench) groups['Bench'].push(p);
    else if (groups[p.role]) groups[p.role].push(p);
  }

  var sortFn;
  if (activeSort.key === 'name') {
    sortFn = function(a,b) { return activeSort.dir * (a.nick||a.firstName).localeCompare(b.nick||b.firstName); };
  } else if (activeSort.key === 'attendance') {
    sortFn = function(a,b) { return activeSort.dir * ((parseInt(a.attendance)||0) - (parseInt(b.attendance)||0)); };
  } else if (activeSort.key === 'items') {
    sortFn = function(a,b) {
      var ac = (getLootEntry(a.firstName)||{count:0}).count;
      var bc = (getLootEntry(b.firstName)||{count:0}).count;
      return activeSort.dir * (ac - bc);
    };
  } else {
    sortFn = function(a,b) { return (a.nick||a.firstName).localeCompare(b.nick||b.firstName); };
  }

  for (var r = 0; r < order.length; r++) {
    groups[order[r]].sort(sortFn);
  }

  var html = '<thead><tr><th>Player</th><th>Attendance</th><th>Items</th><th>BiS Link</th><th>Status</th></tr></thead><tbody>';
  var totalRows = 0;

  for (var r = 0; r < order.length; r++) {
    var role    = order[r];
    var players = groups[role];
    if (!players.length) continue;
    html += '<tr class="group-header"><td colspan="5">'+labels[role]+'</td></tr>';
    for (var j = 0; j < players.length; j++) {
      var p         = players[j];
      var name      = p.nick || p.firstName;
      var pct       = parseInt(p.attendance) || 0;
      var color     = attendColor(pct);
      var lootEntry = getLootEntry(p.firstName);
      var lootCount = lootEntry ? lootEntry.count : 0;
      var hasBis    = !!p.bisLink;
      var roleColor = p.role==='Tank'?'var(--tank)':p.role==='Heal'?'var(--heal)':p.role==='Ranged'?'var(--ranged)':'var(--melee)';
      var statusTags = '';
      if (p.isTrial) statusTags += '<span class="tag tag-trial">Trial</span> ';
      if (p.isBench) statusTags += '<span class="tag tag-bench">Bench</span>';
      if (!statusTags) statusTags = '<span style="color:var(--text);">—</span>';
      html += '<tr class="player-row'+(selectedOfficerPlayer===p.firstName?' selected':'')+'" onclick="officerSelectPlayer(\''+p.firstName+'\')" data-player="'+p.firstName+'">' +
        '<td><div class="player-name-cell">' +
          '<div class="mini-avatar" style="background:rgba(0,0,0,0.2);color:'+roleColor+';border:1px solid '+roleColor+'33;">'+name.slice(0,2).toUpperCase()+'</div>' +
          '<span style="font-weight:600;color:var(--text);">'+name+'</span>' +
          (p.firstName!==name?'<span style="font-size:0.82rem;color:var(--text-muted);">('+p.firstName+')</span>':'') +
        '</div></td>' +
        '<td><span class="attend-mini" style="color:'+color+';">'+(p.attendance||'—')+'</span></td>' +
        '<td>'+lootCount+'</td>' +
        '<td>'+(hasBis?'<span style="color:var(--heal);">✓</span>':'<span style="color:var(--text);">—</span>')+'</td>' +
        '<td>'+statusTags+'</td>' +
        '</tr>';
      totalRows++;
    }
  }
  if (totalRows === 0) html += '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:2rem;">No players match the current filters.</td></tr>';
  html += '</tbody>';
  document.getElementById('rosterTable').innerHTML = html;

  var countEl = document.getElementById('bisItemCount');
  if (countEl) {
    countEl.textContent = bisItemTerm ? totalRows + ' player' + (totalRows !== 1 ? 's' : '') : '';
  }
}

function officerSelectPlayer(firstName) {
  selectedOfficerPlayer = firstName;
  buildRosterTable();
  var container = document.getElementById('officerProfile');
  renderProfile(firstName, 'officer', container);
  container.scrollIntoView({ behavior:'smooth', block:'start' });
}

// -- BiS Conflicts ----------------------------------------------------------
function buildConflicts() {
  var bisList  = DATA.bisList || {};
  var prioOrder = DATA.priorityOrder || {};
  var itemMap  = {};

  var playerKeys = Object.keys(bisList);
  for (var i = 0; i < playerKeys.length; i++) {
    var firstName = playerKeys[i];
    var items     = bisList[firstName];
    for (var j = 0; j < items.length; j++) {
      var itemName = typeof items[j] === 'string' ? items[j] : items[j].item;
      if (itemName === 'M+' || itemName === 'Crafted' || itemName === 'Catalyst') continue;
      if (!itemMap[itemName]) itemMap[itemName] = [];
      itemMap[itemName].push(firstName);
    }
  }

  var sorted = Object.keys(itemMap).sort(function(a,b) { return itemMap[b].length - itemMap[a].length; });

  var html = '';
  for (var i = 0; i < sorted.length; i++) {
    var item    = sorted[i];
    var players = itemMap[item];
    var slot    = (DATA.itemSlots||{})[item] || '';
    var ranked  = prioOrder[item] || [];
    html += '<div class="conflict-item">';
    html += '<div class="conflict-item-name">';
    html += '<span>'+item+'</span>';
    if (slot) html += '<span style="font-size:0.72rem;color:'+getSlotColor(slot)+';text-transform:uppercase;letter-spacing:0.08em;">'+slot+'</span>';
    html += '<span class="conflict-count">'+players.length+' player'+(players.length!==1?'s':'')+'</span>';
    html += '</div>';
    html += '<div class="conflict-players">';
    for (var j = 0; j < players.length; j++) {
      var pName  = players[j];
      var pData  = null;
      for (var k = 0; k < DATA.roster.length; k++) { if (normalise(DATA.roster[k].firstName)===normalise(pName)) { pData=DATA.roster[k]; break; } }
      var display = pData ? (pData.nick || pData.firstName) : pName;
      var rankPos = ranked.findIndex ? ranked.findIndex(function(r){return normalise(r)===normalise(pName);}) : -1;
      var isRanked = rankPos >= 0;
      html += '<span class="conflict-player-tag'+(isRanked?' ranked':'')+'">'+display+(isRanked?' #'+(rankPos+1):'')+'</span>';
    }
    html += '</div></div>';
  }
  if (!html) html = '<p style="color:var(--text);padding:1rem;">No BiS data found.</p>';
  document.getElementById('conflictsContent').innerHTML = html;
}

// -- Loot Fairness ----------------------------------------------------------
function buildFairness() {
  var roster  = DATA.roster || [];

  var entries = [];
  for (var i = 0; i < roster.length; i++) {
    var p     = roster[i];
    var entry = getLootEntry(p.firstName);
    entries.push({ name: p.nick||p.firstName, firstName: p.firstName, count: entry?entry.count:0, role: p.role, isBench: p.isBench });
  }
  entries.sort(function(a,b) { return b.count - a.count; });

  var max = entries.length ? entries[0].count : 1;
  if (max === 0) max = 1;

  var html = '<div style="margin-bottom:1rem;">' +
    '<div class="fairness-row" style="border-bottom:1px solid var(--border-mid);padding-bottom:0.5rem;margin-bottom:0.5rem;">' +
      '<span style="font-size:0.78rem;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--text);">Player</span>' +
      '<span style="font-size:0.78rem;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--text);">Items received</span>' +
      '<span style="font-size:0.78rem;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--text);text-align:right;">#</span>' +
    '</div>';

  for (var i = 0; i < entries.length; i++) {
    var e     = entries[i];
    var width = Math.round((e.count/max)*100) + '%';
    var color = e.isBench ? 'var(--text-dim)' : e.role==='Tank'?'var(--tank)':e.role==='Heal'?'var(--heal)':e.role==='Ranged'?'var(--ranged)':'var(--melee)';
    html += '<div class="fairness-row">';
    html += '<span style="font-size:0.95rem;color:var(--text);font-weight:500;">'+e.name+'</span>';
    html += '<div class="fairness-bar-wrap"><div class="fairness-bar" style="width:'+width+';background:'+color+';"></div></div>';
    html += '<span class="fairness-count">'+e.count+'</span>';
    html += '</div>';
  }
  html += '</div>';
  document.getElementById('fairnessContent').innerHTML = html;
}

// -- Attendance tab ---------------------------------------------------------
function buildAttendanceTab() {
  var details = DATA.attendanceDetails || {};
  var roster  = DATA.roster || [];
  var THRESHOLD = 90;

  var below = [];
  for (var i = 0; i < roster.length; i++) {
    var p   = roster[i];
    var pct = parseInt(p.attendance) || 0;
    if (pct < THRESHOLD) below.push(p);
  }
  below.sort(function(a,b) { return (parseInt(a.attendance)||0) - (parseInt(b.attendance)||0); });

  var html = '';
  if (!below.length) {
    html = '<p style="color:var(--text);padding:1rem;">All raiders are at or above '+THRESHOLD+'% attendance.</p>';
  } else {
    html += '<p style="font-size:0.88rem;color:var(--text);margin-bottom:1rem;">'+below.length+' raider'+(below.length!==1?'s':'')+' below '+THRESHOLD+'% attendance</p>';
    for (var i = 0; i < below.length; i++) {
      var p       = below[i];
      var name    = p.nick || p.firstName;
      var pct     = parseInt(p.attendance) || 0;
      var color   = attendColor(pct);
      var penalty = details[p.firstName] || [];

      html += '<div class="attend-player-row">';
      html += '<div class="attend-player-header">';
      html += '<span class="attend-player-name">'+name+(p.firstName!==name?' <span style="font-size:0.82rem;color:var(--text-muted);">('+p.firstName+')</span>':'')+'</span>';
      html += '<span style="font-size:1rem;font-weight:700;color:'+color+';">'+( p.attendance||'—')+'</span>';
      html += '</div>';

      html += '<div class="attend-row" style="margin-bottom:0.5rem;">';
      html += '<div class="attend-bar-wrap"><div class="attend-bar" style="width:'+(p.attendance||'0%')+';background:'+color+';"></div></div>';
      html += '</div>';

      if (penalty.length) {
        html += '<div class="attend-penalty-list">';
        for (var j = 0; j < penalty.length; j++) {
          var ae = penalty[j];
          var sc = ae.status==='No Show'?'var(--melee)':'var(--gold)';
          html += '<div class="attend-penalty-entry">';
          html += '<span style="color:var(--text);">'+ae.date+'</span>';
          html += '<span style="color:'+sc+';font-weight:600;">'+ae.status+'</span>';
          html += '</div>';
        }
        html += '</div>';
      }
      html += '</div>';
    }
  }
  document.getElementById('attendanceContent').innerHTML = html;
}

loadData();
