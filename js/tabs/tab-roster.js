// Officer roster tab: table, filters, add/remove player, player settings

var statItemsDiff = 'all';

function setStatItemsDiff(diff) {
  statItemsDiff = diff;
  buildStatsBar();
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
  var avgColor  = attendColor(avgAttend);
  var totalItems = 0;
  var lootMap = DATA.lootCounts || {};
  var lootKeys = Object.keys(lootMap);
  var countField = statItemsDiff === 'heroic' ? 'heroicCount' : statItemsDiff === 'mythic' ? 'mythicCount' : 'count';
  for (var j = 0; j < lootKeys.length; j++) { if (lootMap[lootKeys[j]]) totalItems += lootMap[lootKeys[j]][countField] || 0; }
  var nextDiff  = statItemsDiff === 'all' ? 'heroic' : statItemsDiff === 'heroic' ? 'mythic' : 'all';
  var diffLabel = statItemsDiff === 'heroic' ? 'Heroic' : statItemsDiff === 'mythic' ? 'Mythic' : 'All';
  var diffTip   = statItemsDiff === 'heroic' ? 'Heroic loot entries tracked' : statItemsDiff === 'mythic' ? 'Mythic loot entries tracked' : 'Total loot entries tracked across all difficulties';
  var cycleBadge = '<button class="stat-diff-cycle" onclick="setStatItemsDiff(\''+nextDiff+'\')">'+diffLabel+'</button>';

  document.getElementById('officerStats').innerHTML =
    '<div class="stat-card" data-tip="Active roster members — bench players excluded"><div class="stat-value">'+raiders.length+'</div><div class="stat-label">Raiders</div></div>' +
    '<div class="stat-card" data-tip="Average attendance % across active raiders this season"><div class="stat-value" style="color:'+avgColor+';">'+avgAttend+'%</div><div class="stat-label">Avg Attendance</div></div>' +
    '<div class="stat-card" style="position:relative;" data-tip="'+diffTip+'">'+cycleBadge+'<div class="stat-value">'+totalItems+'</div><div class="stat-label">Items Distributed</div></div>' +
    '<div class="stat-card" data-tip="Raiders with an approved BiS list link on file"><div class="stat-value">'+bisCount+'<span style="font-size:1.2rem;color:var(--text-muted);">/'+raiders.length+'</span></div><div class="stat-label">BiS Submitted</div></div>';
}

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
  if (activeSort.key === key) { activeSort.dir *= -1; }
  else { activeSort.key = key; activeSort.dir = 1; }
  ['name','attendance','items'].forEach(function(k) {
    var chip = document.getElementById('chip-sort-' + k);
    var isActive = activeSort.key === k;
    chip.classList.toggle('active', isActive);
    chip.textContent = { name:'Name', attendance:'Attendance', items:'Items' }[k] + (isActive ? (activeSort.dir === 1 ? ' ^' : ' v') : '');
  });
  buildRosterTable();
}

function buildRosterTable() {
  var order  = ['Tank','Heal','Melee','Ranged','Bench'];
  var labels = { Tank:'Tanks', Heal:'Healers', Melee:'Melee', Ranged:'Ranged', Bench:'Bench' };
  var groups = { Tank:[], Heal:[], Melee:[], Ranged:[], Bench:[] };

  var searchTerm  = normalise((document.getElementById('rosterSearch')  || {}).value || '');
  var bisItemTerm = normalise((document.getElementById('bisItemSearch') || {}).value || '');

  for (var i = 0; i < DATA.roster.length; i++) {
    var p = DATA.roster[i];
    if (activeFilters.lowAttend && (parseInt(p.attendance)||0) >= 95) continue;
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
  for (var r = 0; r < order.length; r++) { groups[order[r]].sort(sortFn); }

  var html = '<thead><tr><th>Player</th><th>Attendance</th><th>Items</th><th>BiS Link</th><th>M+ Excl.</th><th>Status</th><th><button class="btn btn-gold" style="font-size:0.82rem;padding:0.25rem 0.75rem;white-space:nowrap;" onclick="showAddPlayerModal()">+ Add Player</button></th></tr></thead><tbody>';
  var totalRows = 0;

  for (var r = 0; r < order.length; r++) {
    var role    = order[r];
    var players = groups[role];
    if (!players.length) continue;
    html += '<tr class="group-header"><td colspan="7">'+labels[role]+'</td></tr>';
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
      if (!statusTags) statusTags = '<span style="color:var(--text);">-</span>';
      var barPct   = pct + '%';
      var clsColor = classColor(p.class);
      html += '<tr class="player-row'+(selectedOfficerPlayer===p.firstName?' selected':'')+'" onclick="officerSelectPlayer(\''+p.firstName+'\')" data-player="'+p.firstName+'">' +
        '<td><div class="player-name-cell">' +
          '<div class="mini-avatar" style="background:rgba(0,0,0,0.25);color:'+roleColor+';border:2px solid '+roleColor+';">'+name.slice(0,2).toUpperCase()+'</div>' +
          '<div style="display:flex;flex-direction:column;gap:0.1rem;">' +
            '<div style="display:flex;align-items:center;gap:0.4rem;">' +
              '<span style="font-weight:600;color:var(--text);">'+name+'</span>' +
              (p.firstName!==name?'<span style="font-size:0.95rem;color:var(--text-muted);">('+p.firstName+')</span>':'') +
            '</div>' +
            (p.class?'<span class="badge badge-class" style="'+classBadgeStyle(p.class)+';align-self:flex-start;">'+(p.spec||p.class)+'</span>':'') +
            (p.joinDate?'<span style="font-size:0.82rem;color:var(--text-dim);">Joined: '+formatJoinDate(p.joinDate)+'</span>':'') +
          '</div>' +
        '</div></td>' +
        '<td><div class="attend-mini-cell"><span class="attend-mini" style="color:'+color+';">'+(p.attendance||'-')+'</span>' +
          (pct?'<div class="attend-mini-bar-wrap"><div class="attend-mini-bar" style="width:'+barPct+';background:'+color+';"></div></div>':'') +
        '</div></td>' +
        '<td>'+lootCount+'</td>' +
        '<td>'+(hasBis?'<span style="color:var(--heal);font-size:1.1rem;">&#10003;</span>':'<span style="color:var(--text-dim);">-</span>')+'</td>' +
        '<td>'+(p.mPlusExcluded?'<span style="color:var(--heal);font-size:1.1rem;">&#10003;</span>':'<span style="color:var(--text-dim);">-</span>')+'</td>' +
        '<td>'+statusTags+'</td>' +
        '<td></td>' +
        '</tr>';
      totalRows++;
    }
  }
  if (totalRows === 0) html += '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:2rem;">No players match the current filters.</td></tr>';
  html += '</tbody>';
  document.getElementById('rosterTable').innerHTML = html;

  var countEl = document.getElementById('bisItemCount');
  if (countEl) countEl.textContent = bisItemTerm ? totalRows + ' player' + (totalRows !== 1 ? 's' : '') : '';
}

function officerSelectPlayer(firstName) {
  var existingRow = document.getElementById('inlineProfileRow');

  // Toggle closed if clicking the already-open player
  if (selectedOfficerPlayer === firstName && existingRow) {
    selectedOfficerPlayer = null;
    existingRow.remove();
    buildRosterTable();
    return;
  }

  selectedOfficerPlayer = firstName;
  buildRosterTable();

  // Remove any existing inline row (buildRosterTable wipes the tbody but keep this as safety)
  existingRow = document.getElementById('inlineProfileRow');
  if (existingRow) existingRow.remove();

  var playerRow = document.querySelector('.player-row[data-player="' + firstName + '"]');
  if (!playerRow) return;

  var inlineRow = document.createElement('tr');
  inlineRow.id = 'inlineProfileRow';
  var inlineCell = document.createElement('td');
  inlineCell.colSpan = 7;
  inlineCell.style.padding = '0';
  inlineCell.style.border = 'none';
  inlineRow.appendChild(inlineCell);
  playerRow.parentNode.insertBefore(inlineRow, playerRow.nextSibling);

  renderProfile(firstName, 'officer', inlineCell);
  inlineRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// -- Add player modal -------------------------------------------------------
function showAddPlayerModal() {
  document.getElementById('addPlayerName').value  = '';
  document.getElementById('addPlayerRealm').value = '';
  document.getElementById('addPlayerNick').value  = '';
  document.getElementById('addPlayerClass').value = '';
  document.getElementById('addPlayerSpec').innerHTML = '<option value="">-- Select spec --</option>';
  document.getElementById('addPlayerRole').value  = 'Melee';
  document.getElementById('addPlayerTrial').checked = false;
  document.getElementById('addPlayerError').style.display = 'none';

  var today = new Date();
  var mm = today.getMonth() + 1; var dd = today.getDate();
  document.getElementById('addPlayerJoinDate').value =
    today.getFullYear() + '-' + (mm < 10 ? '0' : '') + mm + '-' + (dd < 10 ? '0' : '') + dd;

  var classSel = document.getElementById('addPlayerClass');
  classSel.innerHTML = '<option value="">-- Select class --</option>';
  var classes = Object.keys(CLASS_SPECS).sort();
  for (var i = 0; i < classes.length; i++) {
    var opt = document.createElement('option');
    opt.value = classes[i];
    opt.textContent = classes[i];
    classSel.appendChild(opt);
  }

  var apdd = document.getElementById('addPlayerRealmDropdown');
  if (apdd) apdd.style.display = 'none';

  document.getElementById('addPlayerModal').classList.add('active');
  setTimeout(function() { document.getElementById('addPlayerName').focus(); }, 50);
}

function hideAddPlayerModal() {
  var apdd = document.getElementById('addPlayerRealmDropdown');
  if (apdd) apdd.style.display = 'none';
  document.getElementById('addPlayerModal').classList.remove('active');
}

function initAddPlayerRealmCombobox() {
  var input    = document.getElementById('addPlayerRealm');
  var dropdown = document.getElementById('addPlayerRealmDropdown');
  if (!input || !dropdown) return;

  function showMatches(query) {
    var q = query.toLowerCase().trim();
    if (!q) { dropdown.style.display = 'none'; return; }
    var matches = WOW_REALMS.filter(function(r) {
      return r.toLowerCase().indexOf(q) !== -1;
    }).slice(0, 12);
    if (!matches.length) { dropdown.style.display = 'none'; return; }
    dropdown.innerHTML = matches.map(function(r) {
      return '<div class="realm-option" onmousedown="pickAddPlayerRealm(\'' + r.replace(/'/g, "\\'") + '\')">' + r + '</div>';
    }).join('');
    dropdown.style.display = 'block';
  }

  input.addEventListener('input',  function() { showMatches(this.value); });
  input.addEventListener('focus',  function() { showMatches(this.value); });
  input.addEventListener('blur',   function() { setTimeout(function() { dropdown.style.display = 'none'; }, 150); });
}

function pickAddPlayerRealm(realm) {
  var input = document.getElementById('addPlayerRealm');
  if (input) input.value = realm;
  var dropdown = document.getElementById('addPlayerRealmDropdown');
  if (dropdown) dropdown.style.display = 'none';
}

function addPlayerClassChanged() {
  var cls     = document.getElementById('addPlayerClass').value;
  var specSel = document.getElementById('addPlayerSpec');
  var roleSel = document.getElementById('addPlayerRole');
  specSel.innerHTML = '<option value="">-- Select spec --</option>';
  if (!cls || !CLASS_SPECS[cls]) return;
  var specs = CLASS_SPECS[cls].specs;
  for (var i = 0; i < specs.length; i++) {
    var opt = document.createElement('option');
    opt.value = specs[i];
    opt.textContent = specs[i];
    specSel.appendChild(opt);
  }
  var roles = CLASS_SPECS[cls].roles;
  if (roles) { roleSel.value = roles[0] === 'Healer' ? 'Heal' : roles[0]; }
}

function submitAddPlayer() {
  var nameVal  = (document.getElementById('addPlayerName').value  || '').trim();
  var realmVal = (document.getElementById('addPlayerRealm').value || '').trim();
  var nickVal  = (document.getElementById('addPlayerNick').value  || '').trim();
  var cls      = document.getElementById('addPlayerClass').value;
  var spec     = document.getElementById('addPlayerSpec').value;
  var role     = document.getElementById('addPlayerRole').value;
  var isTrial  = document.getElementById('addPlayerTrial').checked;
  var errEl    = document.getElementById('addPlayerError');

  if (!nameVal || !realmVal || !cls || !spec || !role) {
    errEl.textContent = 'Please fill in all required fields.';
    errEl.style.display = '';
    return;
  }

  var joinDateVal = (document.getElementById('addPlayerJoinDate').value || '').trim();

  var nameRealm = nameVal + '-' + realmVal;
  var duplicate = false;
  if (DATA && DATA.roster) {
    for (var i = 0; i < DATA.roster.length; i++) {
      if (normalise(DATA.roster[i].nameRealm) === normalise(nameRealm)) { duplicate = true; break; }
    }
  }
  if (duplicate) {
    errEl.textContent = nameRealm + ' is already on the roster.';
    errEl.style.display = '';
    return;
  }

  errEl.style.display = 'none';
  var submitBtn = document.querySelector('#addPlayerModal .btn-gold');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Adding...'; }

  var data   = { nameRealm: nameRealm, nick: nickVal, class: cls, spec: spec, role: role, isTrial: isTrial, joinDate: joinDateVal };
  var cbName = '_addPlayerCb';
  window[cbName] = function(result) {
    delete window[cbName];
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Add Player'; }
    if (result && result.error) {
      errEl.textContent = 'Failed to add player: ' + result.error;
      errEl.style.display = '';
      return;
    }
    if (DATA && DATA.roster) {
      var parts = nameRealm.split('-');
      DATA.roster.push({
        nameRealm: nameRealm, firstName: parts[0], realm: parts.slice(1).join('-'),
        nick: nickVal, class: cls, spec: spec, role: role,
        isTrial: isTrial, isBench: false, attendance: '', bisLink: '', joinDate: joinDateVal
      });
    }
    hideAddPlayerModal();
    buildOfficerDashboard();
    if (typeof window._pendingRosterOnSuccess === 'function') {
      window._pendingRosterOnSuccess();
      window._pendingRosterOnSuccess = null;
    }
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Add Player'; }
    errEl.textContent = 'Network error. Try again.';
    errEl.style.display = '';
    window._pendingRosterOnSuccess = null;
  };
  script.src = WEB_APP_URL + '?action=addPlayer&data=' + encodeURIComponent(JSON.stringify(data)).replace(/'/g, '%27') + '&callback=' + cbName;
  document.head.appendChild(script);
}

function confirmRemovePlayer(nameRealm, firstName) {
  var confirmDiv = document.getElementById('removePlayerConfirm-' + firstName);
  if (confirmDiv) confirmDiv.style.display = 'flex';
  var removeBtn = document.getElementById('removePlayerBtn-' + firstName);
  if (removeBtn) removeBtn.style.display = 'none';
}

function cancelRemovePlayer(firstName) {
  var confirmDiv = document.getElementById('removePlayerConfirm-' + firstName);
  if (confirmDiv) confirmDiv.style.display = 'none';
  var removeBtn = document.getElementById('removePlayerBtn-' + firstName);
  if (removeBtn) removeBtn.style.display = '';
}

function executeRemovePlayer(nameRealm, firstName) {
  var msgEl = document.getElementById('removePlayerMsg-' + firstName);
  if (msgEl) { msgEl.textContent = 'Removing...'; msgEl.style.color = 'var(--text-muted)'; msgEl.style.display = ''; }

  var cbName = '_removePlayerCb' + firstName.replace(/[^a-zA-Z0-9]/g, '_');
  window[cbName] = function(result) {
    delete window[cbName];
    if (result && result.error) {
      if (msgEl) { msgEl.textContent = 'Failed: ' + result.error; msgEl.style.color = 'var(--melee)'; }
      return;
    }
    if (DATA && DATA.roster) {
      DATA.roster = DATA.roster.filter(function(p) { return p.nameRealm !== nameRealm; });
    }
    document.getElementById('officerProfile').innerHTML = '';
    selectedOfficerPlayer = null;
    buildOfficerDashboard();
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    if (msgEl) { msgEl.textContent = 'Network error. Try again.'; msgEl.style.color = 'var(--melee)'; }
  };
  script.src = WEB_APP_URL + '?action=removePlayer&data=' + encodeURIComponent(JSON.stringify({ nameRealm: nameRealm })).replace(/'/g, '%27') + '&callback=' + cbName;
  document.head.appendChild(script);
}

// -- Player settings --------------------------------------------------------
function savePlayerField(nameRealm, firstName, field, value) {
  var msgEl = document.getElementById('playerSettingsMsg-' + firstName);
  if (msgEl) msgEl.textContent = 'Saving...';
  var cbName = '_saveFieldCb' + firstName.replace(/[^a-zA-Z0-9]/g, '_');
  window[cbName] = function(result) {
    delete window[cbName];
    if (result && result.success && DATA) {
      var player = DATA.roster.find(function(p) { return p.nameRealm === nameRealm; });
      if (player) player[field] = value;
      if (field === 'joinDate') buildTrialPromoAlert();
    }
    if (msgEl) {
      msgEl.textContent = result && result.error ? 'Failed to save.' : 'Saved.';
      setTimeout(function() { if (msgEl) msgEl.textContent = ''; }, 2000);
    }
  };
  var script = document.createElement('script');
  script.onerror = function() { delete window[cbName]; if (msgEl) msgEl.textContent = 'Failed to save.'; };
  script.src = WEB_APP_URL + '?action=updatePlayerField&data=' + encodeURIComponent(JSON.stringify({ nameRealm: nameRealm, field: field, value: value })) + '&callback=' + cbName;
  document.head.appendChild(script);
}

function saveJoinDate(nameRealm, firstName) {
  var input = document.getElementById('joinDateInput-' + firstName);
  if (!input) return;
  savePlayerField(nameRealm, firstName, 'joinDate', input.value);
}

function officerUpdateClass(nameRealm, firstName, newClass) {
  savePlayerField(nameRealm, firstName, 'class', newClass);
  var specSel = document.getElementById('specSelect-' + firstName);
  if (!specSel) return;
  specSel.innerHTML = '<option value="">-- Select spec --</option>';
  if (newClass && CLASS_SPECS[newClass]) {
    var specs = CLASS_SPECS[newClass].specs;
    for (var i = 0; i < specs.length; i++) {
      var opt = document.createElement('option');
      opt.value = specs[i];
      opt.textContent = specs[i];
      specSel.appendChild(opt);
    }
  }
}

function officerRenamePlayer(nameRealm, firstName) {
  var nameInput = document.getElementById('editNameInput-' + firstName);
  var realmSel  = document.getElementById('editRealmSelect-' + firstName);
  if (!nameInput || !realmSel) return;
  var newName  = nameInput.value.trim();
  var newRealm = realmSel.value;
  if (!newName || !newRealm) return;
  var newNameRealm = newName + '-' + newRealm;
  if (newNameRealm.toLowerCase() === nameRealm.toLowerCase()) return;
  var msgEl = document.getElementById('playerSettingsMsg-' + firstName);
  if (msgEl) msgEl.textContent = 'Saving...';
  var cbName = '_renameCb' + firstName.replace(/[^a-zA-Z0-9]/g, '_');
  window[cbName] = function(result) {
    delete window[cbName];
    if (result && result.success && DATA) {
      var player = DATA.roster.find(function(p) { return p.nameRealm === nameRealm; });
      if (player) {
        player.nameRealm = newNameRealm;
        player.firstName = newName;
        player.realm     = newRealm;
      }
      selectedOfficerPlayer = null;
      var inlineRow = document.getElementById('inlineProfileRow');
      if (inlineRow) inlineRow.remove();
      buildRosterTable();
    }
    if (msgEl) {
      msgEl.textContent = result && result.error ? 'Failed to save.' : 'Saved.';
      setTimeout(function() { if (msgEl) msgEl.textContent = ''; }, 2000);
    }
  };
  var script = document.createElement('script');
  script.onerror = function() { delete window[cbName]; if (msgEl) msgEl.textContent = 'Failed to save.'; };
  script.src = WEB_APP_URL + '?action=renamePlayer&data=' + encodeURIComponent(JSON.stringify({ oldNameRealm: nameRealm, newNameRealm: newNameRealm })) + '&callback=' + cbName;
  document.head.appendChild(script);
}

function togglePlayerTrial(nameRealm, firstName) {
  var player = DATA && DATA.roster.find(function(p) { return p.nameRealm === nameRealm; });
  if (!player) return;
  var newVal = !player.isTrial;
  var btn = document.getElementById('trialToggle-' + firstName);
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  var cbName = '_trialCb' + firstName.replace(/[^a-zA-Z0-9]/g, '_');
  window[cbName] = function(result) {
    delete window[cbName];
    if (result && result.success && DATA) {
      var p = DATA.roster.find(function(p) { return p.nameRealm === nameRealm; });
      if (p) p.isTrial = newVal;
      buildTrialPromoAlert();
    }
    if (btn) {
      btn.disabled = false;
      btn.className = 'btn ' + (newVal ? 'btn-gold' : 'btn-muted');
      btn.textContent = newVal ? 'Remove Trial' : 'Mark as Trial';
    }
    var msgEl = document.getElementById('playerSettingsMsg-' + firstName);
    if (msgEl) {
      msgEl.textContent = result && result.error ? 'Failed to save.' : 'Saved.';
      setTimeout(function() { if (msgEl) msgEl.textContent = ''; }, 2000);
    }
  };
  var script = document.createElement('script');
  script.onerror = function() { delete window[cbName]; if (btn) { btn.disabled = false; } };
  script.src = WEB_APP_URL + '?action=updatePlayerField&data=' + encodeURIComponent(JSON.stringify({ nameRealm: nameRealm, field: 'isTrial', value: newVal })) + '&callback=' + cbName;
  document.head.appendChild(script);
}

function togglePlayerBench(nameRealm, firstName) {
  var player = DATA && DATA.roster.find(function(p) { return p.nameRealm === nameRealm; });
  if (!player) return;
  var newVal = !player.isBench;
  var btn = document.getElementById('benchToggle-' + firstName);
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  var cbName = '_benchCb' + firstName.replace(/[^a-zA-Z0-9]/g, '_');
  window[cbName] = function(result) {
    delete window[cbName];
    if (result && result.success && DATA) {
      var p = DATA.roster.find(function(p) { return p.nameRealm === nameRealm; });
      if (p) p.isBench = newVal;
    }
    if (btn) {
      btn.disabled = false;
      btn.className = 'btn ' + (newVal ? 'btn-gold' : 'btn-muted');
      btn.textContent = newVal ? 'Remove from Bench' : 'Move to Bench';
    }
    var msgEl = document.getElementById('playerSettingsMsg-' + firstName);
    if (msgEl) {
      msgEl.textContent = result && result.error ? 'Failed to save.' : 'Saved.';
      setTimeout(function() { if (msgEl) msgEl.textContent = ''; }, 2000);
    }
  };
  var script = document.createElement('script');
  script.onerror = function() { delete window[cbName]; if (btn) { btn.disabled = false; } };
  script.src = WEB_APP_URL + '?action=updatePlayerField&data=' + encodeURIComponent(JSON.stringify({ nameRealm: nameRealm, field: 'isBench', value: newVal })) + '&callback=' + cbName;
  document.head.appendChild(script);
}

function toggleMPlusExcluded(nameRealm, firstName) {
  var player = DATA && DATA.roster.find(function(p) { return p.nameRealm === nameRealm; });
  if (!player) return;
  var newVal = !player.mPlusExcluded;
  var btn = document.getElementById('mplusExclToggle-' + firstName);
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  var cbName = '_mplusExclCb' + firstName.replace(/[^a-zA-Z0-9]/g, '_');
  window[cbName] = function(result) {
    delete window[cbName];
    if (result && result.success && DATA) {
      var p = DATA.roster.find(function(p) { return p.nameRealm === nameRealm; });
      if (p) p.mPlusExcluded = newVal;
      buildRosterTable();
    }
    var newBtn = document.getElementById('mplusExclToggle-' + firstName);
    if (newBtn) {
      newBtn.disabled = false;
      newBtn.className = 'btn ' + (newVal ? 'btn-gold' : 'btn-muted');
      newBtn.textContent = newVal ? 'Remove Exclusion' : 'Mark as Excluded';
    }
    var msgEl = document.getElementById('playerSettingsMsg-' + firstName);
    if (msgEl) {
      msgEl.textContent = result && result.error ? 'Failed to save.' : 'Saved.';
      setTimeout(function() { if (msgEl) msgEl.textContent = ''; }, 2000);
    }
  };
  var script = document.createElement('script');
  script.onerror = function() { delete window[cbName]; if (btn) { btn.disabled = false; } };
  script.src = WEB_APP_URL + '?action=setMPlusExcluded&nameRealm=' + encodeURIComponent(nameRealm) + '&value=' + (newVal ? 'true' : 'false') + '&callback=' + cbName;
  document.head.appendChild(script);
}

function savePlayerNote(nameRealm, firstName) {
  var noteEl = document.getElementById('playerNote-' + firstName);
  var msgEl  = document.getElementById('playerNoteMsg-' + firstName);
  if (!noteEl) return;
  var note = noteEl.value.trim();
  if (msgEl) msgEl.textContent = 'Saving...';
  var cbName = '_noteCb' + firstName.replace(/[^a-zA-Z0-9]/g, '_');
  window[cbName] = function(result) {
    delete window[cbName];
    if (result && result.success && DATA) {
      if (!DATA.playerNotes) DATA.playerNotes = {};
      if (note) { DATA.playerNotes[nameRealm] = note; } else { delete DATA.playerNotes[nameRealm]; }
    }
    if (msgEl) {
      msgEl.textContent = result && result.error ? 'Failed to save.' : 'Saved.';
      setTimeout(function() { if (msgEl) msgEl.textContent = ''; }, 2000);
    }
  };
  var script = document.createElement('script');
  script.onerror = function() { delete window[cbName]; if (msgEl) msgEl.textContent = 'Failed to save.'; };
  script.src = WEB_APP_URL + '?action=savePlayerNote&data=' + encodeURIComponent(JSON.stringify({ nameRealm: nameRealm, note: note })) + '&callback=' + cbName;
  document.head.appendChild(script);
}

// -- Trial promotion tracking (#78) ----------------------------------------

var PROMO_THRESHOLDS = { weeks: 4, attend: 75 };

function buildTrialPromoAlert() {
  var el = document.getElementById('trialPromoAlert');
  if (!el) return;

  var minDays   = PROMO_THRESHOLDS.weeks * 7;
  var minAttend = PROMO_THRESHOLDS.attend;
  var today     = new Date();
  var todayMs   = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());

  var ready  = [];
  var roster = DATA.roster || [];
  for (var i = 0; i < roster.length; i++) {
    var p = roster[i];
    if (!p.isTrial || !p.joinDate) continue;
    var pct = parseInt(p.attendance);
    if (isNaN(pct) || pct < minAttend) continue;
    var parts = p.joinDate.split('-');
    if (parts.length < 3) continue;
    var joinMs  = Date.UTC(+parts[0], +parts[1] - 1, +parts[2]);
    var ageDays = Math.floor((todayMs - joinMs) / 86400000);
    if (ageDays < minDays) continue;
    ready.push({ p: p, ageDays: ageDays, ageWeeks: Math.floor(ageDays / 7) });
  }

  if (!ready.length) { el.innerHTML = ''; return; }

  ready.sort(function(a, b) { return b.ageDays - a.ageDays; });

  var w = PROMO_THRESHOLDS.weeks;
  var a = PROMO_THRESHOLDS.attend;

  var html = '<div class="trial-promo-card">';
  html += '<div class="trial-promo-header">';
  html += '<span class="trial-promo-title">Trial Promotions</span>';
  html += '<span class="trial-promo-count">'+ready.length+' ready for review</span>';
  html += '</div>';
  html += '<div class="trial-promo-thresholds">';
  html += '<span class="trial-promo-thresh-label">Show trials on roster for at least</span>';
  html += '<input type="number" class="trial-promo-input" id="promoWeeks" value="'+w+'" min="1" max="52" onchange="updatePromoThreshold()">';
  html += '<span class="trial-promo-thresh-label">wk and</span>';
  html += '<input type="number" class="trial-promo-input" id="promoAttend" value="'+a+'" min="0" max="100" onchange="updatePromoThreshold()">';
  html += '<span class="trial-promo-thresh-label">% attendance or above</span>';
  html += '</div>';

  html += '<table class="trial-promo-table"><thead><tr><th>Player</th><th>On Roster</th><th>Attendance</th></tr></thead><tbody>';
  for (var j = 0; j < ready.length; j++) {
    var r         = ready[j];
    var p         = r.p;
    var name      = p.nick || p.firstName;
    var aColor    = attendColor(parseInt(p.attendance));
    var roleColor = p.role==='Tank'?'var(--tank)':p.role==='Heal'?'var(--heal)':p.role==='Ranged'?'var(--ranged)':'var(--melee)';
    html += '<tr class="trial-promo-row" onclick="officerSelectPlayer(\''+p.firstName+'\')" title="Open player profile">';
    html += '<td><div class="player-name-cell">';
    html += '<div class="mini-avatar" style="background:rgba(0,0,0,0.25);color:'+roleColor+';border:2px solid '+roleColor+';">'+name.slice(0,2).toUpperCase()+'</div>';
    html += '<div style="display:flex;flex-direction:column;gap:0.1rem;">';
    html += '<span style="font-weight:600;color:var(--text);">'+name+'</span>';
    if (p.class) html += '<span class="badge badge-class" style="'+classBadgeStyle(p.class)+';align-self:flex-start;">'+(p.spec||p.class)+'</span>';
    html += '</div></div></td>';
    html += '<td style="color:var(--gold-light);font-weight:600;">'+r.ageWeeks+' wk</td>';
    html += '<td><span style="color:'+aColor+';font-weight:700;">'+(p.attendance||'-')+'</span></td>';
    html += '</tr>';
  }
  html += '</tbody></table></div>';

  el.innerHTML = html;
}

function updatePromoThreshold() {
  var w = parseInt(document.getElementById('promoWeeks').value)  || 4;
  var a = parseInt(document.getElementById('promoAttend').value) || 75;
  PROMO_THRESHOLDS.weeks  = Math.max(1,  Math.min(52,  w));
  PROMO_THRESHOLDS.attend = Math.max(0,  Math.min(100, a));
  buildTrialPromoAlert();
}

initAddPlayerRealmCombobox();
