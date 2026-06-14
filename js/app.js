var WEB_APP_URL  = 'https://script.google.com/macros/s/AKfycbxrQdQGqbBTELWm7huWChdbES0ry7WFZetlELWuEdI0T6lfbXEzrqx9Vo5yA-b9dW4y7A/exec';
var OFFICER_PASS = 'phoenix2'; // change this
var VERSION      = '1.3.0';
var DATA         = null;
var activeFilters = {};
var activeSort = { key: null, dir: 1 };
var selectedOfficerPlayer = null;
var activeDiffFilter = 'all';

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
  document.querySelectorAll('.nav-item').forEach(function(b) { b.classList.remove('active'); });
  document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
  event.target.classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
  if (name === 'conflicts')  buildConflicts();
  if (name === 'fairness')   buildFairness();
  if (name === 'attendance') buildAttendanceTab();
  if (name === 'priority')   buildPriorityTab();
}

// -- Load data --------------------------------------------------------------
function loadData() {
  window._rosterCallback = function(data) {
    try {
      if (data.error) throw new Error(data.error);
      DATA = data;
      DATA._loadedAt = new Date();
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

// -- Cache ------------------------------------------------------------------
function clearCache() {
  var btn = document.getElementById('clearCacheBtn');
  btn.disabled = true;
  btn.textContent = 'Clearing...';

  var cbName = '_clearCacheCallback';
  window[cbName] = function(data) {
    delete window[cbName];
    if (data && data.success) {
      btn.textContent = 'Cleared!';
      setTimeout(function() {
        btn.textContent = 'Clear Cache';
        btn.disabled = false;
      }, 2000);
    } else {
      btn.textContent = 'Error';
      setTimeout(function() {
        btn.textContent = 'Clear Cache';
        btn.disabled = false;
      }, 2000);
    }
  };

  var script = document.createElement('script');
  script.src = WEB_APP_URL + '?action=clearCache&callback=' + cbName;
  script.onerror = function() {
    delete window[cbName];
    btn.textContent = 'Error';
    setTimeout(function() {
      btn.textContent = 'Clear Cache';
      btn.disabled = false;
    }, 2000);
  };
  document.head.appendChild(script);
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
  if (s==='NECK'||s==='RING'||s==='RING 1'||s==='RING 2') return 'var(--ranged)';
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
      var li_obj  = lootEntry.items[li];
      var li_name = typeof li_obj === 'string' ? li_obj : li_obj.name;
      var li_diff = typeof li_obj === 'object' && li_obj.difficulty ? li_obj.difficulty : '';
      lootItemsHTML += '<div style="font-size:1rem;color:var(--text);padding:0.3rem 0;border-bottom:1px solid var(--border);">'+li_name+(li_diff?' <span style="font-size:0.7rem;color:var(--text-muted);">('+li_diff+')</span>':'')+'</div>';
    }
  }

  // BiS link
  var bisHTML = player.bisLink
    ? '<div class="bis-row"><div class="bis-dot yes"></div><a class="bis-link" href="'+player.bisLink+'" target="_blank" rel="noopener">View BiS list →</a></div>'
    : '<div class="bis-row"><div class="bis-dot no"></div><span class="bis-none">No BiS list submitted yet</span></div>';

  // Build received lookup from loot history
  var receivedMap = {};
  if (lootEntry && lootEntry.items) {
    for (var ri = 0; ri < lootEntry.items.length; ri++) {
      var ri_obj  = lootEntry.items[ri];
      var ri_name = typeof ri_obj === 'string' ? ri_obj : ri_obj.name;
      var ri_key  = normalise(ri_name);
      if (!receivedMap[ri_key]) receivedMap[ri_key] = [];
      receivedMap[ri_key].push(typeof ri_obj === 'object' ? ri_obj : { name: ri_name });
    }
  }

  // Priority
  var bisItems = getBisItems(player.firstName);
  var rows = '';
  for (var bi = 0; bi < bisItems.length; bi++) {
    var entry    = bisItems[bi];
    var item     = entry.item, bisSlot = entry.slot;
    var rank     = getRank(player.firstName, item);
    var slot     = (DATA.itemSlots||{})[item] || bisSlot || '';
    var isGen    = (item==='M+'||item==='Crafted'||item==='Catalyst');
    var received = receivedMap[normalise(item)] || null;
    rows += '<div class="priority-row' + (received ? ' bis-received' : '') + '" style="grid-template-columns:auto auto 1fr' + (received ? ' auto' : '') + ';">';
    rows += isGen ? '<span style="font-size:0.72rem;color:var(--text-dim);min-width:40px;text-align:center;">—</span>' : rankPillHTML(rank);
    rows += '<span class="priority-item-slot" style="color:'+getSlotColor(slot)+';">'+slot+'</span>';
    rows += '<span class="priority-item-name" style="text-align:right;" title="'+item+'">'+item+'</span>';
    if (received) {
      var badges = '';
      for (var rv = 0; rv < received.length; rv++) {
        var rv_diff = received[rv].difficulty || '';
        var rv_date = received[rv].date || '';
        badges += '<span class="bis-received-badge">' + (rv_diff ? rv_diff + ' · ' : '') + rv_date + '</span>';
      }
      rows += '<div style="display:flex;flex-direction:column;gap:2px;align-items:flex-end;">' + badges + '</div>';
    }
    rows += '</div>';
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
      '<div class="profile-section" onclick="var l=document.getElementById(\'loot-list-'+player.firstName+'\');l.style.display=l.style.display===\'none\'?\'grid\':\'none\';" style="cursor:pointer;">' +
        '<div class="section-label" style="display:flex;justify-content:space-between;align-items:center;">Items Received <span style="font-size:0.7rem;color:var(--text-dim);">tap to expand</span></div>' +
        '<div style="font-size:1.1rem;font-weight:600;color:var(--gold);">'+lootCount+' item'+(lootCount!==1?'s':'')+' this tier</div>' +
        '<div id="loot-list-'+player.firstName+'" style="display:none;margin-top:0.75rem;grid-template-columns:1fr 1fr;gap:0 1rem;">'+lootItemsHTML+'</div>' +
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
  buildStatsBar();
  buildRosterTable();
  if (DATA._loadedAt) {
    var t = DATA._loadedAt;
    var h = t.getHours(), m = t.getMinutes();
    var ts = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    var el = document.getElementById('dataTimestamp');
    if (el) el.textContent = 'Data as of ' + ts;
  }
}

function buildStatsBar() {
  var roster  = DATA.roster || [];
  var raiders = roster.filter(function(p) { return !p.isBench; });
  var totalAttend = 0, attendCount = 0, bisCount = 0;
  for (var i = 0; i < raiders.length; i++) {
    var p = raiders[i];
    var pct = parseInt(p.attendance);
    if (!isNaN(pct)) { totalAttend += pct; attendCount++; }
    if (p.bisLink) bisCount++;
  }
  var avgAttend = attendCount ? Math.round(totalAttend / attendCount) : 0;
  var avgColor = attendColor(avgAttend);
  var totalItems = 0;
  var lootMap = DATA.lootCounts || {};
  var lootKeys = Object.keys(lootMap);
  for (var j = 0; j < lootKeys.length; j++) { if (lootMap[lootKeys[j]]) totalItems += lootMap[lootKeys[j]].count || 0; }

  document.getElementById('officerStats').innerHTML =
    '<div class="stat-card"><div class="stat-value">'+raiders.length+'</div><div class="stat-label">Raiders</div></div>' +
    '<div class="stat-card"><div class="stat-value" style="color:'+avgColor+';">'+avgAttend+'%</div><div class="stat-label">Avg Attendance</div></div>' +
    '<div class="stat-card"><div class="stat-value">'+totalItems+'</div><div class="stat-label">Items Distributed</div></div>' +
    '<div class="stat-card"><div class="stat-value">'+bisCount+'<span style="font-size:1.2rem;color:var(--text-muted);">/'+raiders.length+'</span></div><div class="stat-label">BiS Submitted</div></div>';
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
      var barPct = pct + '%';
      html += '<tr class="player-row'+(selectedOfficerPlayer===p.firstName?' selected':'')+'" onclick="officerSelectPlayer(\''+p.firstName+'\')" data-player="'+p.firstName+'">' +
        '<td><div class="player-name-cell">' +
          '<div class="mini-avatar" style="background:rgba(0,0,0,0.25);color:'+roleColor+';border:2px solid '+roleColor+';">'+name.slice(0,2).toUpperCase()+'</div>' +
          '<span style="font-weight:600;color:var(--text);">'+name+'</span>' +
          (p.firstName!==name?'<span style="font-size:0.82rem;color:var(--text-muted);">('+p.firstName+')</span>':'') +
        '</div></td>' +
        '<td><div class="attend-mini-cell"><span class="attend-mini" style="color:'+color+';">'+(p.attendance||'—')+'</span>' +
          (pct?'<div class="attend-mini-bar-wrap"><div class="attend-mini-bar" style="width:'+barPct+';background:'+color+';"></div></div>':'') +
        '</div></td>' +
        '<td>'+lootCount+'</td>' +
        '<td>'+(hasBis?'<span style="color:var(--heal);font-size:1.1rem;">✓</span>':'<span style="color:var(--text-dim);">—</span>')+'</td>' +
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
      var lootEntry = getLootEntry(pName);
      var received = false, receivedDiff = '';
      if (lootEntry && lootEntry.items) {
        for (var m = 0; m < lootEntry.items.length; m++) {
          var itemObj  = lootEntry.items[m];
          var itemName = typeof itemObj === 'string' ? itemObj : itemObj.name;
          if (normalise(itemName) === normalise(item)) {
            received     = true;
            receivedDiff = typeof itemObj === 'object' ? itemObj.difficulty : '';
            break;
          }
        }
      }
      var badge = received ? ' <span class="received-badge">Received' + (receivedDiff ? ' (' + receivedDiff + ')' : '') + '</span>' : '';
      html += '<span class="conflict-player-tag'+(isRanked?' ranked':'')+(received?' received':'')+'">'+display+(isRanked?' #'+(rankPos+1):'')+badge+'</span>';
    }
    html += '</div></div>';
  }
  if (!html) html = '<p style="color:var(--text);padding:1rem;">No BiS data found.</p>';
  document.getElementById('conflictsContent').innerHTML = html;
}

// -- Loot Fairness ----------------------------------------------------------
function setDiffFilter(val) {
  activeDiffFilter = val;
  ['all','heroic','mythic'].forEach(function(v) {
    var el = document.getElementById('diff-chip-' + v);
    if (el) el.classList.toggle('active', v === val);
  });
  buildFairness();
}

function buildFairness() {
  var roster  = DATA.roster || [];
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
  var avg = allEntries.length ? totalCount / allEntries.length : 0;
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

// -- Attendance tab ---------------------------------------------------------
function buildAttendanceTab() {
  var details = DATA.attendanceDetails || {};
  var roster  = DATA.roster || [];
  var THRESHOLD = parseInt((document.getElementById('attendThreshold') || {value:'90'}).value) || 90;

  var below = [];
  for (var i = 0; i < roster.length; i++) {
    var p   = roster[i];
    var pct = parseInt(p.attendance) || 0;
    if (pct <= THRESHOLD) below.push(p);
  }
  below.sort(function(a,b) { return (parseInt(a.attendance)||0) - (parseInt(b.attendance)||0); });

  var html = '';
  if (!below.length) {
    html = '<p style="color:var(--text);padding:1rem;">All raiders are at or above '+THRESHOLD+'% attendance.</p>';
  } else {
    html += '<p style="font-size:0.88rem;color:var(--text);margin-bottom:1rem;">'+below.length+' raider'+(below.length!==1?'s':'')+' at or below '+THRESHOLD+'% attendance</p>';
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

// -- Priority tab -----------------------------------------------------------
function togglePrioSection(id) {
  var el = document.getElementById(id);
  var chevron = event.currentTarget.querySelector('.prio-chevron');
  var collapsed = el.style.display === 'none';
  el.style.display = collapsed ? '' : 'none';
  if (chevron) chevron.textContent = collapsed ? '-' : '+';
}

var ARMOR_SLOT_ORDER = ['HEAD','SHOULDERS','CHEST','GLOVES','LEGS','CLOAK','BRACERS','BELT','BOOTS'];

function getItemGroup(slot) {
  var s = (slot || '').toUpperCase();
  if (s === 'TRINKET' || s === 'TRINKET 1' || s === 'TRINKET 2') return 'Trinket';
  if (s === '1H/2H' || s === 'OH')                               return 'Weapon';
  if (s === 'NECK' || s === 'RING' || s === 'RING 1' || s === 'RING 2') return 'Jewelry';
  if (ARMOR_SLOT_ORDER.indexOf(s) >= 0)                          return 'Armor';
  return 'Other';
}

function buildPriorityTab() {
  var prioOrder = DATA.priorityOrder || {};
  var itemSlots = DATA.itemSlots     || {};
  var roster    = DATA.roster        || [];

  var rosterMap = {};
  for (var i = 0; i < roster.length; i++) {
    rosterMap[normalise(roster[i].firstName)] = roster[i];
  }

  var prioSearchTerm = normalise((document.getElementById('prioSearch') || {}).value || '');
  var items = Object.keys(prioOrder).filter(function(i) {
    if ((itemSlots[i] || '').toLowerCase() === 'slot') return false;
    if (prioSearchTerm && normalise(i).indexOf(prioSearchTerm) === -1) return false;
    return true;
  }).sort(function(a, b) { return a.localeCompare(b); });

  if (!items.length) {
    document.getElementById('priorityContent').innerHTML = '<p style="color:var(--text);padding:1rem;">No priority data found.</p>';
    return;
  }

  // Group items
  var groups = { Trinket: [], Armor: {}, Weapon: [], Jewelry: [], Other: [] };
  for (var i = 0; i < items.length; i++) {
    var item  = items[i];
    var slot  = itemSlots[item] || '';
    var group = getItemGroup(slot);
    if (group === 'Armor') {
      var s = slot.toUpperCase();
      if (!groups.Armor[s]) groups.Armor[s] = [];
      groups.Armor[s].push(item);
    } else {
      groups[group].push(item);
    }
  }

  function renderItem(item) {
    var ranked = prioOrder[item];
    if (!ranked || !ranked.length) return '';
    var slot = itemSlots[item] || '';
    var out  = '<div class="prio-item">';
    out += '<div class="prio-item-header">';
    out += '<span class="prio-item-name">' + item + '</span>';
    if (slot) out += '<span class="prio-item-slot" style="color:' + getSlotColor(slot) + ';">' + slot + '</span>';
    out += '<span class="prio-item-count">' + ranked.length + ' ranked</span>';
    out += '</div><div class="prio-ranked-list">';
    for (var j = 0; j < ranked.length; j++) {
      var firstName = ranked[j];
      var player    = rosterMap[normalise(firstName)];
      var display   = player ? (player.nick || player.firstName) : firstName;
      var role      = player ? player.role : '';
      var roleColor = role === 'Tank' ? 'var(--tank)' : role === 'Heal' ? 'var(--heal)' : role === 'Ranged' ? 'var(--ranged)' : role === 'Melee' ? 'var(--melee)' : 'var(--text)';
      out += '<div class="prio-rank-row">';
      out += '<span class="prio-rank-num">' + (j + 1) + '</span>';
      out += '<span class="prio-rank-name" style="color:' + roleColor + ';">' + display + '</span>';
      if (role) out += '<span class="prio-role-badge prio-role-' + role + '">' + role.toUpperCase() + '</span>';
      out += '</div>';
    }
    out += '</div></div>';
    return out;
  }

  var GROUP_ORDER = ['Trinket', 'Armor', 'Weapon', 'Jewelry', 'Other'];
  var GROUP_LABELS = { Trinket: 'Trinkets', Armor: 'Armor', Weapon: 'Weapons', Jewelry: 'Jewelry', Other: 'Other' };

  var html = '';
  var secId = 0;
  for (var g = 0; g < GROUP_ORDER.length; g++) {
    var groupKey = GROUP_ORDER[g];
    var gid = 'prio-sec-' + (secId++);
    if (groupKey === 'Armor') {
      var hasArmor = false;
      for (var si = 0; si < ARMOR_SLOT_ORDER.length; si++) {
        if (groups.Armor[ARMOR_SLOT_ORDER[si]] && groups.Armor[ARMOR_SLOT_ORDER[si]].length) { hasArmor = true; break; }
      }
      if (!hasArmor) continue;
      html += '<div class="prio-section-header prio-collapsible" onclick="togglePrioSection(\'' + gid + '\')">' + GROUP_LABELS.Armor + '<span class="prio-chevron">-</span></div>';
      html += '<div id="' + gid + '">';
      for (var si = 0; si < ARMOR_SLOT_ORDER.length; si++) {
        var slotKey = ARMOR_SLOT_ORDER[si];
        var slotItems = groups.Armor[slotKey];
        if (!slotItems || !slotItems.length) continue;
        html += '<div class="prio-sub-header" style="color:' + getSlotColor(slotKey) + ';">' + slotKey.charAt(0) + slotKey.slice(1).toLowerCase() + '</div>';
        for (var k = 0; k < slotItems.length; k++) html += renderItem(slotItems[k]);
      }
      html += '</div>';
    } else {
      if (!groups[groupKey].length) continue;
      html += '<div class="prio-section-header prio-collapsible" onclick="togglePrioSection(\'' + gid + '\')">' + GROUP_LABELS[groupKey] + '<span class="prio-chevron">-</span></div>';
      html += '<div id="' + gid + '">';
      for (var k = 0; k < groups[groupKey].length; k++) html += renderItem(groups[groupKey][k]);
      html += '</div>';
    }
  }

  document.getElementById('priorityContent').innerHTML = html;
}

document.querySelectorAll('.footer').forEach(function(el) {
  el.textContent = 'We Go Again · Team Phoenix · v' + VERSION;
});

loadData();
