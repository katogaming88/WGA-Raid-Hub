// Officer roster tab: table, filters, add/remove player, player settings

var statItemsDiff = 'all';

function setStatItemsDiff(diff) {
  statItemsDiff = diff;
  buildStatsBar();
}

function buildStatsBar() {
  var roster = DATA.roster || [];
  var raiders = roster.filter(function (p) {
    return !p.isBench;
  });
  var totalAttend = 0,
    attendCount = 0,
    bisCount = 0;
  for (var i = 0; i < raiders.length; i++) {
    var p = raiders[i];
    var pct = parseInt(p.attendance);
    if (!isNaN(pct)) {
      totalAttend += pct;
      attendCount++;
    }
    if (p.bisLink) bisCount++;
  }
  var avgAttend = attendCount ? Math.round(totalAttend / attendCount) : 0;
  var avgColor = attendColor(avgAttend);
  var totalItems = 0;
  var lootMap = DATA.lootCounts || {};
  var lootKeys = Object.keys(lootMap);
  var countField = statItemsDiff === 'heroic' ? 'heroicCount' : statItemsDiff === 'mythic' ? 'mythicCount' : 'count';
  for (var j = 0; j < lootKeys.length; j++) {
    if (lootMap[lootKeys[j]]) totalItems += lootMap[lootKeys[j]][countField] || 0;
  }
  var nextDiff = statItemsDiff === 'all' ? 'heroic' : statItemsDiff === 'heroic' ? 'mythic' : 'all';
  var diffLabel = statItemsDiff === 'heroic' ? 'Heroic' : statItemsDiff === 'mythic' ? 'Mythic' : 'All';
  var diffTip =
    statItemsDiff === 'heroic'
      ? 'Heroic loot entries tracked'
      : statItemsDiff === 'mythic'
        ? 'Mythic loot entries tracked'
        : 'Total loot entries tracked across all difficulties';
  var cycleBadge =
    '<button class="stat-diff-cycle" onclick="setStatItemsDiff(\'' + nextDiff + '\')">' + diffLabel + '</button>';

  document.getElementById('officerStats').innerHTML =
    '<div class="stat-card" data-tip="Active roster members — bench players excluded"><div class="stat-value">' +
    raiders.length +
    '</div><div class="stat-label">Raiders</div></div>' +
    '<div class="stat-card" data-tip="Average attendance % across active raiders this season"><div class="stat-value" style="color:' +
    avgColor +
    ';">' +
    avgAttend +
    '%</div><div class="stat-label">Avg Attendance</div></div>' +
    '<div class="stat-card" style="position:relative;" data-tip="' +
    diffTip +
    '">' +
    cycleBadge +
    '<div class="stat-value">' +
    totalItems +
    '</div><div class="stat-label">Items Distributed</div></div>' +
    '<div class="stat-card" data-tip="Raiders with an approved BiS list link on file"><div class="stat-value">' +
    bisCount +
    '<span style="font-size:1.2rem;color:var(--text-muted);">/' +
    raiders.length +
    '</span></div><div class="stat-label">BiS Submitted</div></div>';
}

function toggleFilter(name) {
  activeFilters[name] = !activeFilters[name];
  document.getElementById('chip-' + name).classList.toggle('active', activeFilters[name]);
  buildRosterTable();
}

function toggleRole(role) {
  var current = activeFilters.role;
  activeFilters.role = current === role ? null : role;
  ['Tank', 'Heal', 'Melee', 'Ranged'].forEach(function (r) {
    document.getElementById('chip-role-' + r).classList.toggle('active', activeFilters.role === r);
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
  ['name', 'attendance', 'items'].forEach(function (k) {
    var chip = document.getElementById('chip-sort-' + k);
    var isActive = activeSort.key === k;
    chip.classList.toggle('active', isActive);
    chip.textContent =
      { name: 'Name', attendance: 'Attendance', items: 'Items' }[k] +
      (isActive ? (activeSort.dir === 1 ? ' ^' : ' v') : '');
  });
  buildRosterTable();
}

function buildRosterTable() {
  var order = ['Tank', 'Heal', 'Melee', 'Ranged', 'Bench'];
  var labels = { Tank: 'Tanks', Heal: 'Healers', Melee: 'Melee', Ranged: 'Ranged', Bench: 'Bench' };
  var groups = { Tank: [], Heal: [], Melee: [], Ranged: [], Bench: [] };

  var searchTerm = normalise((document.getElementById('rosterSearch') || {}).value || '');
  var bisItemTerm = normalise((document.getElementById('bisItemSearch') || {}).value || '');

  for (var i = 0; i < DATA.roster.length; i++) {
    var p = DATA.roster[i];
    if (activeFilters.lowAttend && (parseInt(p.attendance) || 0) >= 95) continue;
    if (activeFilters.noBis && p.bisLink) continue;
    if (activeFilters.trial && !p.isTrial) continue;
    if (activeFilters.bench && !p.isBench) continue;
    if (activeFilters.role && p.role !== activeFilters.role) continue;
    if (
      searchTerm &&
      normalise(p.nick || '').indexOf(searchTerm) === -1 &&
      normalise(p.firstName || '').indexOf(searchTerm) === -1
    )
      continue;
    if (bisItemTerm) {
      var bisItems = getBisItems(p.firstName);
      var hasBisMatch = false;
      for (var bi = 0; bi < bisItems.length; bi++) {
        if (normalise(bisItems[bi].item).indexOf(bisItemTerm) !== -1) {
          hasBisMatch = true;
          break;
        }
      }
      if (!hasBisMatch) continue;
    }
    if (p.isBench) groups['Bench'].push(p);
    else if (groups[p.role]) groups[p.role].push(p);
  }

  var sortFn;
  if (activeSort.key === 'name') {
    sortFn = function (a, b) {
      return activeSort.dir * (a.nick || a.firstName).localeCompare(b.nick || b.firstName);
    };
  } else if (activeSort.key === 'attendance') {
    sortFn = function (a, b) {
      return (
        activeSort.dir * ((parseFloat(getDisplayAttendancePct(a)) || 0) - (parseFloat(getDisplayAttendancePct(b)) || 0))
      );
    };
  } else if (activeSort.key === 'items') {
    sortFn = function (a, b) {
      var ac = (getSeasonLootEntry(a.firstName) || { count: 0 }).count;
      var bc = (getSeasonLootEntry(b.firstName) || { count: 0 }).count;
      return activeSort.dir * (ac - bc);
    };
  } else {
    sortFn = function (a, b) {
      return (a.nick || a.firstName).localeCompare(b.nick || b.firstName);
    };
  }
  for (var r = 0; r < order.length; r++) {
    groups[order[r]].sort(sortFn);
  }

  var html =
    '<thead><tr><th>Player</th><th>Attendance</th><th>Items</th><th>BiS Link</th><th>M+ Excl.</th><th>Status</th><th><button class="btn btn-gold" style="font-size:0.82rem;padding:0.25rem 0.75rem;white-space:nowrap;" onclick="showAddPlayerModal()">+ Add Player</button></th></tr></thead><tbody>';
  var totalRows = 0;

  for (var r = 0; r < order.length; r++) {
    var role = order[r];
    var players = groups[role];
    if (!players.length) continue;
    html += '<tr class="group-header"><td colspan="7">' + labels[role] + '</td></tr>';
    for (var j = 0; j < players.length; j++) {
      var p = players[j];
      var name = p.nick || p.firstName;
      var att = getDisplayAttendancePct(p);
      var pct = parseFloat(att) || 0;
      var color = attendColor(pct);
      var lootEntry = getSeasonLootEntry(p.firstName);
      var lootCount = lootEntry ? lootEntry.count : 0;
      var hasBis = !!p.bisLink;
      var roleColor =
        p.role === 'Tank'
          ? 'var(--tank)'
          : p.role === 'Heal'
            ? 'var(--heal)'
            : p.role === 'Ranged'
              ? 'var(--ranged)'
              : 'var(--melee)';
      var statusTags = '';
      if (p.isTrial) statusTags += '<span class="tag tag-trial">Trial</span> ';
      if (p.isBench) statusTags += '<span class="tag tag-bench">Bench</span>';
      if (!statusTags) statusTags = '<span style="color:var(--text);">-</span>';
      var barPct = pct.toFixed(1) + '%';
      var clsColor = classColor(p.class);
      html +=
        '<tr class="player-row' +
        (selectedOfficerPlayer === p.firstName ? ' selected' : '') +
        '" onclick="officerSelectPlayer(\'' +
        p.firstName +
        '\')" data-player="' +
        p.firstName +
        '">' +
        '<td><div class="player-name-cell">' +
        '<div class="mini-avatar" style="background:rgba(0,0,0,0.25);color:' +
        roleColor +
        ';border:2px solid ' +
        roleColor +
        ';">' +
        name.slice(0, 2).toUpperCase() +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:0.1rem;">' +
        '<div style="display:flex;align-items:center;gap:0.4rem;">' +
        '<span style="font-weight:600;color:var(--text);">' +
        name +
        '</span>' +
        (p.firstName !== name
          ? '<span style="font-size:0.95rem;color:var(--text-muted);">(' + p.firstName + ')</span>'
          : '') +
        '</div>' +
        (p.class
          ? '<span class="badge badge-class" style="' +
            classBadgeStyle(p.class) +
            ';align-self:flex-start;">' +
            (p.spec || p.class) +
            '</span>'
          : '') +
        (p.joinDate
          ? '<span style="font-size:0.82rem;color:var(--text-dim);">Joined: ' + formatJoinDate(p.joinDate) + '</span>'
          : '') +
        '</div>' +
        '</div></td>' +
        '<td><div class="attend-mini-cell"><span class="attend-mini" style="color:' +
        color +
        ';">' +
        (att || '-') +
        '</span>' +
        (pct
          ? '<div class="attend-mini-bar-wrap"><div class="attend-mini-bar" style="width:' +
            barPct +
            ';background:' +
            color +
            ';"></div></div>'
          : '') +
        '</div></td>' +
        '<td>' +
        lootCount +
        '</td>' +
        '<td>' +
        (hasBis
          ? '<span style="color:var(--heal);font-size:1.1rem;">&#10003;</span>'
          : '<span style="color:var(--text-dim);">-</span>') +
        '</td>' +
        '<td>' +
        (p.mPlusExcluded
          ? '<span style="color:var(--heal);font-size:1.1rem;">&#10003;</span>'
          : '<span style="color:var(--text-dim);">-</span>') +
        '</td>' +
        '<td>' +
        statusTags +
        '</td>' +
        '<td></td>' +
        '</tr>';
      totalRows++;
    }
  }
  if (totalRows === 0)
    html +=
      '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:2rem;">No players match the current filters.</td></tr>';
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

// Re-renders the currently open player card after buildRosterTable() wipes the
// table HTML. Called from onHeavyReady and rebuildSeasonFilteredViews so the
// card stays open and picks up freshly loaded data (loot, BiS, etc.).
function reopenSelectedPlayer() {
  if (!selectedOfficerPlayer) return;
  var playerRow = document.querySelector('.player-row[data-player="' + selectedOfficerPlayer + '"]');
  if (!playerRow) return;
  var inlineRow = document.createElement('tr');
  inlineRow.id = 'inlineProfileRow';
  var inlineCell = document.createElement('td');
  inlineCell.colSpan = 7;
  inlineCell.style.padding = '0';
  inlineCell.style.border = 'none';
  inlineRow.appendChild(inlineCell);
  playerRow.parentNode.insertBefore(inlineRow, playerRow.nextSibling);
  renderProfile(selectedOfficerPlayer, 'officer', inlineCell);
}

// -- Add player modal -------------------------------------------------------
function showAddPlayerModal() {
  document.getElementById('addPlayerName').value = '';
  document.getElementById('addPlayerRealm').value = '';
  document.getElementById('addPlayerNick').value = '';
  document.getElementById('addPlayerClass').value = '';
  document.getElementById('addPlayerSpec').innerHTML = '<option value="">-- Select spec --</option>';
  document.getElementById('addPlayerRole').value = 'Melee';
  document.getElementById('addPlayerTrial').checked = false;
  document.getElementById('addPlayerError').style.display = 'none';

  var today = new Date();
  var mm = today.getMonth() + 1;
  var dd = today.getDate();
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
  setTimeout(function () {
    document.getElementById('addPlayerName').focus();
  }, 50);
}

function hideAddPlayerModal() {
  var apdd = document.getElementById('addPlayerRealmDropdown');
  if (apdd) apdd.style.display = 'none';
  document.getElementById('addPlayerModal').classList.remove('active');
}

function initAddPlayerRealmCombobox() {
  var input = document.getElementById('addPlayerRealm');
  var dropdown = document.getElementById('addPlayerRealmDropdown');
  if (!input || !dropdown) return;

  function showMatches(query) {
    var q = query.toLowerCase().trim();
    if (!q) {
      dropdown.style.display = 'none';
      return;
    }
    var matches = WOW_REALMS.filter(function (r) {
      return r.toLowerCase().indexOf(q) !== -1;
    }).slice(0, 12);
    if (!matches.length) {
      dropdown.style.display = 'none';
      return;
    }
    dropdown.innerHTML = matches
      .map(function (r) {
        return (
          '<div class="realm-option" onmousedown="pickAddPlayerRealm(\'' +
          r.replace(/'/g, "\\'") +
          '\')">' +
          r +
          '</div>'
        );
      })
      .join('');
    dropdown.style.display = 'block';
  }

  input.addEventListener('input', function () {
    showMatches(this.value);
  });
  input.addEventListener('focus', function () {
    showMatches(this.value);
  });
  input.addEventListener('blur', function () {
    setTimeout(function () {
      dropdown.style.display = 'none';
    }, 150);
  });
}

function pickAddPlayerRealm(realm) {
  var input = document.getElementById('addPlayerRealm');
  if (input) input.value = realm;
  var dropdown = document.getElementById('addPlayerRealmDropdown');
  if (dropdown) dropdown.style.display = 'none';
}

function addPlayerClassChanged() {
  var cls = document.getElementById('addPlayerClass').value;
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
  if (roles) {
    roleSel.value = roles[0] === 'Healer' ? 'Heal' : roles[0];
  }
}

function submitAddPlayer() {
  var nameVal = (document.getElementById('addPlayerName').value || '').trim();
  var realmVal = (document.getElementById('addPlayerRealm').value || '').trim();
  var nickVal = (document.getElementById('addPlayerNick').value || '').trim();
  var cls = document.getElementById('addPlayerClass').value;
  var spec = document.getElementById('addPlayerSpec').value;
  var role = document.getElementById('addPlayerRole').value;
  var isTrial = document.getElementById('addPlayerTrial').checked;
  var errEl = document.getElementById('addPlayerError');

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
      if (normalise(DATA.roster[i].nameRealm) === normalise(nameRealm)) {
        duplicate = true;
        break;
      }
    }
  }
  if (duplicate) {
    errEl.textContent = nameRealm + ' is already on the roster.';
    errEl.style.display = '';
    return;
  }

  errEl.style.display = 'none';
  var submitBtn = document.querySelector('#addPlayerModal .btn-gold');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Adding...';
  }

  var data = {
    nameRealm: nameRealm,
    nick: nickVal,
    class: cls,
    spec: spec,
    role: role,
    isTrial: isTrial,
    joinDate: joinDateVal
  };
  jsonpRequest(
    WEB_APP_URL + '?action=addPlayer&data=' + encodeURIComponent(JSON.stringify(data)).replace(/'/g, '%27'),
    function (err, result) {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Add Player';
      }
      if (err || (result && result.error)) {
        errEl.textContent = err ? err.message : 'Failed to add player: ' + result.error;
        errEl.style.display = '';
        window._pendingRosterOnSuccess = null;
        return;
      }
      if (DATA && DATA.roster) {
        var parts = nameRealm.split('-');
        DATA.roster.push({
          nameRealm: nameRealm,
          firstName: parts[0],
          realm: parts.slice(1).join('-'),
          nick: nickVal,
          class: cls,
          spec: spec,
          role: role,
          isTrial: isTrial,
          isBench: false,
          attendance: '',
          bisLink: '',
          joinDate: joinDateVal
        });
      }
      hideAddPlayerModal();
      buildOfficerDashboard();
      if (typeof window._pendingRosterOnSuccess === 'function') {
        window._pendingRosterOnSuccess();
        window._pendingRosterOnSuccess = null;
      }
    }
  );
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
  if (msgEl) {
    msgEl.textContent = 'Removing...';
    msgEl.style.color = 'var(--text-muted)';
    msgEl.style.display = '';
  }

  jsonpRequest(
    WEB_APP_URL +
      '?action=removePlayer&data=' +
      encodeURIComponent(JSON.stringify({ nameRealm: nameRealm })).replace(/'/g, '%27'),
    function (err, result) {
      if (err || (result && result.error)) {
        if (msgEl) {
          msgEl.textContent = err ? err.message : 'Failed: ' + result.error;
          msgEl.style.color = 'var(--melee)';
        }
        return;
      }
      if (DATA && DATA.roster) {
        DATA.roster = DATA.roster.filter(function (p) {
          return p.nameRealm !== nameRealm;
        });
      }
      document.getElementById('officerProfile').innerHTML = '';
      selectedOfficerPlayer = null;
      buildOfficerDashboard();
    }
  );
}

// -- Player settings --------------------------------------------------------
function savePlayerField(nameRealm, firstName, field, value) {
  var msgEl = document.getElementById('playerSettingsMsg-' + firstName);
  if (msgEl) msgEl.textContent = 'Saving...';
  jsonpRequest(
    WEB_APP_URL +
      '?action=updatePlayerField&data=' +
      encodeURIComponent(JSON.stringify({ nameRealm: nameRealm, field: field, value: value })),
    function (err, result) {
      if (!err && result && result.success && DATA) {
        var player = DATA.roster.find(function (p) {
          return p.nameRealm === nameRealm;
        });
        if (player) player[field] = value;
        if (field === 'joinDate') buildTrialPromoAlert();
      }
      if (msgEl) {
        msgEl.textContent = err || (result && result.error) ? 'Failed to save.' : 'Saved.';
        setTimeout(function () {
          if (msgEl) msgEl.textContent = '';
        }, 2000);
      }
    }
  );
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
  var realmSel = document.getElementById('editRealmSelect-' + firstName);
  if (!nameInput || !realmSel) return;
  var newName = nameInput.value.trim();
  var newRealm = realmSel.value;
  if (!newName || !newRealm) return;
  var newNameRealm = newName + '-' + newRealm;
  if (newNameRealm.toLowerCase() === nameRealm.toLowerCase()) return;
  var msgEl = document.getElementById('playerSettingsMsg-' + firstName);
  if (msgEl) msgEl.textContent = 'Saving...';
  jsonpRequest(
    WEB_APP_URL +
      '?action=renamePlayer&data=' +
      encodeURIComponent(JSON.stringify({ oldNameRealm: nameRealm, newNameRealm: newNameRealm })),
    function (err, result) {
      if (!err && result && result.success && DATA) {
        var player = DATA.roster.find(function (p) {
          return p.nameRealm === nameRealm;
        });
        if (player) {
          player.nameRealm = newNameRealm;
          player.firstName = newName;
          player.realm = newRealm;
        }
        selectedOfficerPlayer = null;
        var inlineRow = document.getElementById('inlineProfileRow');
        if (inlineRow) inlineRow.remove();
        buildRosterTable();
      }
      if (msgEl) {
        msgEl.textContent = err || (result && result.error) ? 'Failed to save.' : 'Saved.';
        setTimeout(function () {
          if (msgEl) msgEl.textContent = '';
        }, 2000);
      }
    }
  );
}

function togglePlayerTrial(nameRealm, firstName) {
  var player =
    DATA &&
    DATA.roster.find(function (p) {
      return p.nameRealm === nameRealm;
    });
  if (!player) return;
  var newVal = !player.isTrial;
  var btn = document.getElementById('trialToggle-' + firstName);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }
  jsonpRequest(
    WEB_APP_URL +
      '?action=updatePlayerField&data=' +
      encodeURIComponent(JSON.stringify({ nameRealm: nameRealm, field: 'isTrial', value: newVal })),
    function (err, result) {
      if (!err && result && result.success && DATA) {
        var p = DATA.roster.find(function (p) {
          return p.nameRealm === nameRealm;
        });
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
        msgEl.textContent = err || (result && result.error) ? 'Failed to save.' : 'Saved.';
        setTimeout(function () {
          if (msgEl) msgEl.textContent = '';
        }, 2000);
      }
    }
  );
}

function togglePlayerBench(nameRealm, firstName) {
  var player =
    DATA &&
    DATA.roster.find(function (p) {
      return p.nameRealm === nameRealm;
    });
  if (!player) return;
  var newVal = !player.isBench;
  var btn = document.getElementById('benchToggle-' + firstName);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }
  jsonpRequest(
    WEB_APP_URL +
      '?action=updatePlayerField&data=' +
      encodeURIComponent(JSON.stringify({ nameRealm: nameRealm, field: 'isBench', value: newVal })),
    function (err, result) {
      if (!err && result && result.success && DATA) {
        var p = DATA.roster.find(function (p) {
          return p.nameRealm === nameRealm;
        });
        if (p) p.isBench = newVal;
      }
      if (btn) {
        btn.disabled = false;
        btn.className = 'btn ' + (newVal ? 'btn-gold' : 'btn-muted');
        btn.textContent = newVal ? 'Remove from Bench' : 'Move to Bench';
      }
      var msgEl = document.getElementById('playerSettingsMsg-' + firstName);
      if (msgEl) {
        msgEl.textContent = err || (result && result.error) ? 'Failed to save.' : 'Saved.';
        setTimeout(function () {
          if (msgEl) msgEl.textContent = '';
        }, 2000);
      }
    }
  );
}

function toggleMPlusExcluded(nameRealm, firstName) {
  var player =
    DATA &&
    DATA.roster.find(function (p) {
      return p.nameRealm === nameRealm;
    });
  if (!player) return;
  var newVal = !player.mPlusExcluded;
  var btn = document.getElementById('mplusExclToggle-' + firstName);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }
  jsonpRequest(
    WEB_APP_URL +
      '?action=setMPlusExcluded&nameRealm=' +
      encodeURIComponent(nameRealm) +
      '&value=' +
      (newVal ? 'true' : 'false'),
    function (err, result) {
      if (!err && result && result.success && DATA) {
        var p = DATA.roster.find(function (p) {
          return p.nameRealm === nameRealm;
        });
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
        msgEl.textContent = err || (result && result.error) ? 'Failed to save.' : 'Saved.';
        setTimeout(function () {
          if (msgEl) msgEl.textContent = '';
        }, 2000);
      }
    }
  );
}

function savePlayerNote(nameRealm, firstName) {
  var noteEl = document.getElementById('playerNote-' + firstName);
  var msgEl = document.getElementById('playerNoteMsg-' + firstName);
  if (!noteEl) return;
  var note = noteEl.value.trim();
  if (msgEl) msgEl.textContent = 'Saving...';
  jsonpRequest(
    WEB_APP_URL +
      '?action=savePlayerNote&data=' +
      encodeURIComponent(JSON.stringify({ nameRealm: nameRealm, note: note })),
    function (err, result) {
      if (!err && result && result.success && DATA) {
        if (!DATA.playerNotes) DATA.playerNotes = {};
        if (note) {
          DATA.playerNotes[nameRealm] = note;
        } else {
          delete DATA.playerNotes[nameRealm];
        }
      }
      if (msgEl) {
        msgEl.textContent = err || (result && result.error) ? 'Failed to save.' : 'Saved.';
        setTimeout(function () {
          if (msgEl) msgEl.textContent = '';
        }, 2000);
      }
    }
  );
}

// -- Trial promotion tracking (#78) ----------------------------------------

var PROMO_THRESHOLDS = { weeks: 4, attend: 75 };

function buildTrialPromoAlert() {
  var el = document.getElementById('trialPromoAlert');
  if (!el) return;

  if (DATA && DATA.trialWeeks != null) PROMO_THRESHOLDS.weeks = DATA.trialWeeks;
  if (DATA && DATA.trialAttend != null) PROMO_THRESHOLDS.attend = DATA.trialAttend;

  var minDays = PROMO_THRESHOLDS.weeks * 7;
  var minAttend = PROMO_THRESHOLDS.attend;
  var today = new Date();
  var todayMs = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());

  var ready = [];
  var roster = DATA.roster || [];
  for (var i = 0; i < roster.length; i++) {
    var p = roster[i];
    if (!p.isTrial || !p.joinDate) continue;
    var pct = parseInt(p.attendance);
    if (isNaN(pct) || pct < minAttend) continue;
    var parts = p.joinDate.split('-');
    if (parts.length < 3) continue;
    var joinMs = Date.UTC(+parts[0], +parts[1] - 1, +parts[2]);
    var ageDays = Math.floor((todayMs - joinMs) / 86400000);
    if (ageDays < minDays) continue;
    ready.push({ p: p, ageDays: ageDays, ageWeeks: Math.floor(ageDays / 7) });
  }

  if (!ready.length) {
    el.innerHTML = '';
    return;
  }

  ready.sort(function (a, b) {
    return b.ageDays - a.ageDays;
  });

  var html = '<div class="trial-promo-card">';
  html += '<div class="trial-promo-header">';
  html += '<span class="trial-promo-title">Trial Promotions</span>';
  html += '<span class="trial-promo-count">' + ready.length + ' ready for review</span>';
  html += '</div>';
  html +=
    '<p style="font-size:0.85rem;color:var(--text-muted);margin:0 0 0.75rem;">Thresholds: ' +
    PROMO_THRESHOLDS.weeks +
    ' wk on roster, ' +
    PROMO_THRESHOLDS.attend +
    '% attendance. Adjust in Season Settings.</p>';

  html +=
    '<table class="trial-promo-table"><thead><tr><th>Player</th><th>On Roster</th><th>Attendance</th><th></th></tr></thead><tbody>';
  for (var j = 0; j < ready.length; j++) {
    var r = ready[j];
    var p = r.p;
    var name = p.nick || p.firstName;
    var aColor = attendColor(parseInt(p.attendance));
    var roleColor =
      p.role === 'Tank'
        ? 'var(--tank)'
        : p.role === 'Heal'
          ? 'var(--heal)'
          : p.role === 'Ranged'
            ? 'var(--ranged)'
            : 'var(--melee)';
    var nrSafe = p.nameRealm.replace(/'/g, "\\'");
    var fnSafe = p.firstName.replace(/'/g, "\\'");
    html +=
      '<tr class="trial-promo-row" onclick="officerSelectPlayer(\'' + fnSafe + '\')" title="Open player profile">';
    html += '<td><div class="player-name-cell">';
    html +=
      '<div class="mini-avatar" style="background:rgba(0,0,0,0.25);color:' +
      roleColor +
      ';border:2px solid ' +
      roleColor +
      ';">' +
      name.slice(0, 2).toUpperCase() +
      '</div>';
    html += '<div style="display:flex;flex-direction:column;gap:0.1rem;">';
    html += '<span style="font-weight:600;color:var(--text);">' + name + '</span>';
    if (p.class)
      html +=
        '<span class="badge badge-class" style="' +
        classBadgeStyle(p.class) +
        ';align-self:flex-start;">' +
        (p.spec || p.class) +
        '</span>';
    html += '</div></div></td>';
    html += '<td style="color:var(--gold-light);font-weight:600;">' + r.ageWeeks + ' wk</td>';
    html += '<td><span style="color:' + aColor + ';font-weight:700;">' + (p.attendance || '-') + '</span></td>';
    html +=
      '<td><button class="btn btn-gold" style="font-size:0.82rem;padding:0.2rem 0.6rem;white-space:nowrap;" onclick="event.stopPropagation();promoteTrialPlayer(\'' +
      nrSafe +
      "','" +
      fnSafe +
      '\',this)">Promote</button></td>';
    html += '</tr>';
  }
  html += '</tbody></table></div>';

  el.innerHTML = html;
}

function promoteTrialPlayer(nameRealm, firstName, btn) {
  var player = null;
  var roster = (DATA && DATA.roster) || [];
  for (var i = 0; i < roster.length; i++) {
    if (roster[i].nameRealm === nameRealm) {
      player = roster[i];
      break;
    }
  }
  if (!player || !player.isTrial) return;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Promoting...';
  }

  jsonpRequest(
    WEB_APP_URL +
      '?action=updatePlayerField&data=' +
      encodeURIComponent(JSON.stringify({ nameRealm: nameRealm, field: 'isTrial', value: false })),
    function (err, result) {
      if (!err && result && result.success) {
        player.isTrial = false;
        buildTrialPromoAlert();
        buildRosterTable();
        var trialBtn = document.getElementById('trialToggle-' + firstName);
        if (trialBtn) {
          trialBtn.textContent = 'Mark as Trial';
          trialBtn.classList.remove('btn-gold');
          trialBtn.classList.add('btn-muted');
        }
      } else {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Promote';
        }
      }
    }
  );
}

initAddPlayerRealmCombobox();

// ── Buff / debuff coverage (compact) ─────────────────────────────────────────

function buildRosterBuffCoverage() {
  var el = document.getElementById('rosterBuffCoverage');
  if (!el) return;
  var raiders = (DATA.roster || []).filter(function (p) {
    return !p.isBench;
  });
  var coverage = computeBuffCoverage(raiders, 'class', 'spec', 'firstName');

  var sections = [
    { label: 'Raid Buffs', buffs: RAID_BUFFS },
    { label: 'Boss Debuffs', buffs: BOSS_DEBUFFS },
    { label: 'Utility', buffs: RAID_UTILITY }
  ];

  var html =
    '<div style="margin-bottom:0.75rem;padding:0.7rem 0.85rem;background:var(--bg-alt);' +
    'border:1px solid var(--border);border-radius:6px;">' +
    '<span style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.12em;' +
    'color:var(--text-muted);font-weight:700;display:block;margin-bottom:0.5rem;">Buff Coverage</span>';

  sections.forEach(function (sec) {
    html +=
      '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:0.25rem;margin-bottom:0.4rem;">' +
      '<span style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.08em;' +
      'color:var(--text-dim);font-weight:600;min-width:4.5rem;">' +
      sec.label +
      '</span>';
    sec.buffs.forEach(function (buff) {
      var data = coverage[buff.name] || { count: 0, providers: [] };
      var count = data.count;
      var indicator, color;
      if (count >= 2) {
        indicator = '&#10003;';
        color = 'var(--heal)';
      } else if (count === 1) {
        indicator = '!';
        color = 'var(--gold-light)';
      } else {
        indicator = '&#10007;';
        color = 'var(--melee)';
      }
      html +=
        '<span style="display:inline-flex;align-items:center;gap:0.2rem;background:var(--bg);' +
        'border:1px solid var(--border);border-radius:4px;padding:0.1rem 0.4rem;' +
        'font-size:0.77rem;cursor:default;">' +
        '<span style="color:' +
        color +
        ';font-weight:700;">' +
        indicator +
        '</span>' +
        '<span style="color:var(--text-muted);">' +
        buff.name +
        '</span>' +
        '</span>';
    });
    html += '</div>';
  });

  html += '</div>';
  el.innerHTML = html;
}

// ── Roster subtabs ────────────────────────────────────────────────────────────

function switchRosterSubTab(name, btnEl) {
  document.querySelectorAll('[id^="roster-subtab-btn-"]').forEach(function (b) {
    b.classList.remove('active');
  });
  if (btnEl) btnEl.classList.add('active');
  ['roster', 'discord'].forEach(function (sub) {
    var el = document.getElementById('roster-sub-' + sub);
    if (el) el.style.display = sub === name ? '' : 'none';
  });
  if (name === 'discord') renderDiscordClaims();
}

// ── Discord Claims ────────────────────────────────────────────────────────────

function renderDiscordClaims() {
  var el = document.getElementById('rosterDiscordClaimsContent');
  if (!el) return;
  var claims = window.DATA && DATA.discordClaims ? DATA.discordClaims : [];
  if (!claims.length) {
    el.innerHTML = '<p style="color:var(--text-muted);font-size:0.9rem;">No characters have been claimed yet.</p>';
    return;
  }
  var officerIds = window.DATA && DATA.officerDiscordIds ? DATA.officerDiscordIds : [];
  var adminBtn = document.getElementById('adminNavBtn');
  var isAdmin = adminBtn && adminBtn.style.display !== 'none';
  var rows = claims
    .slice()
    .sort(function (a, b) {
      return a.nameRealm.localeCompare(b.nameRealm);
    })
    .map(function (c) {
      var date = c.claimedAt ? new Date(c.claimedAt).toLocaleDateString() : '--';
      var isOfficer = officerIds.indexOf(c.discordId) !== -1;
      var roleCell = isOfficer
        ? '<span style="color:var(--heal)">Officer</span>'
        : '<span style="color:var(--text-muted)">Raider</span>';
      var jsonId = JSON.stringify(c.discordId).replace(/"/g, '&quot;');
      var jsonUn = JSON.stringify(c.username).replace(/"/g, '&quot;');
      var jsonNr = JSON.stringify(c.nameRealm).replace(/"/g, '&quot;');
      var actionCell = '';
      if (isAdmin) {
        actionCell = isOfficer
          ? '<button class="btn btn-muted" style="padding:0.2rem 0.6rem;font-size:0.75rem;" onclick="revokeOfficer(' +
            jsonId +
            ',' +
            jsonUn +
            ')">Revoke</button>'
          : '<button class="btn" style="padding:0.2rem 0.6rem;font-size:0.75rem;" onclick="grantOfficer(' +
            jsonId +
            ',' +
            jsonUn +
            ')">Grant Officer</button>';
      } else {
        actionCell =
          '<button class="btn btn-muted" style="padding:0.2rem 0.6rem;font-size:0.75rem;" onclick="removeDiscordClaim(' +
          jsonNr +
          ')">Remove</button>';
      }
      return (
        '<tr>' +
        '<td style="width:25%">' +
        escHtml(c.username) +
        '</td>' +
        '<td style="width:30%">' +
        escHtml(c.nameRealm) +
        '</td>' +
        '<td style="width:15%">' +
        escHtml(date) +
        '</td>' +
        '<td style="width:15%">' +
        roleCell +
        '</td>' +
        '<td style="width:15%;text-align:right">' +
        actionCell +
        '</td>' +
        '</tr>'
      );
    })
    .join('');
  el.innerHTML =
    '<table class="loot-table" style="width:100%;table-layout:fixed;">' +
    '<thead><tr>' +
    '<th style="width:25%;text-align:left">Discord User</th>' +
    '<th style="width:30%;text-align:left">Character</th>' +
    '<th style="width:15%;text-align:left">Claimed</th>' +
    '<th style="width:15%;text-align:left">Role</th>' +
    '<th style="width:15%"></th>' +
    '</tr></thead>' +
    '<tbody>' +
    rows +
    '</tbody>' +
    '</table>';
}

function removeDiscordClaim(nameRealm) {
  if (!confirm('Remove claim for ' + nameRealm + '? The raider will need to re-claim their character on next login.'))
    return;
  jsonpRequest(
    WEB_APP_URL + '?action=removeDiscordClaim&nameRealm=' + encodeURIComponent(nameRealm),
    function (err, result) {
      if (err || !result || !result.success) {
        alert('Failed to remove claim: ' + ((result && result.error) || (err && err.message) || 'Unknown error'));
        return;
      }
      if (window.DATA && DATA.discordClaims) {
        DATA.discordClaims = DATA.discordClaims.filter(function (c) {
          return c.nameRealm !== nameRealm;
        });
      }
      renderDiscordClaims();
    }
  );
}
