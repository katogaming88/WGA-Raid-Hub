function renderBisToggle() {
  var badge = document.getElementById('bisStatusBadge');
  var btn = document.getElementById('bisToggleBtn');
  if (!badge || !btn) return;
  var open = bisSubmissionsOpen();
  badge.textContent = open ? 'OPEN' : 'CLOSED';
  badge.className = 'signup-status-badge ' + (open ? 'signup-status-open' : 'signup-status-closed');
  btn.textContent = open ? 'Close Submissions' : 'Open Submissions';
}

function toggleBisSubmissionsOpen() {
  setBisSubmissionsOpen(!bisSubmissionsOpen());
}

function setBisSubmissionsOpen(open) {
  var btn = document.getElementById('bisToggleBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  jsonpRequest(WEB_APP_URL + '?action=setBisSubmissionsOpen&value=' + (open ? 'true' : 'false'), function(err, result) {
    if (btn) btn.disabled = false;
    if (!err) { if (DATA) DATA.bisSubmissionsOpen = open; }
    renderBisToggle();
  });
}

function buildBisTab() {
  var container = document.getElementById('bisContainer');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">Loading submissions...</p>';

  jsonpRequest(WEB_APP_URL + '?action=getPendingBiS', function(err, result) {
    if (err) {
      var c = document.getElementById('bisContainer');
      if (c) c.innerHTML = '<p style="color:var(--melee);font-size:1rem;margin-top:1.5rem;">' + err.message + '</p>';
      return;
    }
    renderBisSubmissions(result.submissions || []);
  });
}

function renderBisSubmissions(submissions) {
  var container = document.getElementById('bisContainer');
  if (!container) return;
  if (!submissions.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No pending BiS submissions.</p>';
    return;
  }
  var html = '<div style="margin-top:1.5rem;">' +
    '<div style="font-size:0.9rem;letter-spacing:0.16em;text-transform:uppercase;color:var(--text-muted);font-weight:600;margin-bottom:0.75rem;">' +
    submissions.length + ' pending submission' + (submissions.length !== 1 ? 's' : '') + '</div>';
  submissions.forEach(function (s) {
    html +=
      '<div class="request-card" data-row="' + s.rowIndex + '" data-name-realm="' + s.nameRealm.replace(/"/g, '&quot;') + '" data-bis-link="' + s.bisLink.replace(/"/g, '&quot;') + '">' +
      '<div class="request-card-header">' +
      '<span class="request-player">' + s.nameRealm + '</span>' +
      '<span class="signup-response-time">' + s.timestamp + '</span>' +
      '</div>' +
      '<div class="request-item" style="word-break:break-all;margin-top:0.35rem;">' +
      '<a href="' + s.bisLink + '" target="_blank" rel="noopener" style="color:var(--gold);font-size:1rem;">' + s.bisLink + '</a>' +
      '</div>' +
      (s.notes ? '<div style="font-size:0.97rem;color:var(--text);margin-top:0.6rem;padding-top:0.6rem;border-top:1px solid var(--border);">' + s.notes + '</div>' : '') +
      '<div style="display:flex;gap:0.5rem;margin-top:0.75rem;">' +
      '<button class="btn request-approve-btn" onclick="approveBisSubmission(' + s.rowIndex + ', this)">Approve</button>' +
      '<button class="btn request-reject-btn" onclick="rejectBisSubmission(' + s.rowIndex + ', this)">Reject</button>' +
      '</div>' +
      '</div>';
  });
  container.innerHTML = html + '</div>';
}

function approveBisSubmission(rowIndex, btnEl) {
  var card = document.querySelector('.request-card[data-row="' + rowIndex + '"]');
  var nameRealm = card ? card.getAttribute('data-name-realm') : '';
  var bisLink = card ? card.getAttribute('data-bis-link') : '';
  btnEl.disabled = true;
  btnEl.textContent = '...';
  var data = { row: rowIndex, nameRealm: nameRealm, url: bisLink };
  jsonpRequest(WEB_APP_URL + '?action=approveBiS&data=' + encodeURIComponent(JSON.stringify(data)), function(err, result) {
    if (err || (result && result.error)) { btnEl.disabled = false; btnEl.textContent = 'Approve'; return; }
    if (card) card.remove();
    checkEmptyBisSubmissions();
  });
}

function rejectBisSubmission(rowIndex, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = '...';
  jsonpRequest(WEB_APP_URL + '?action=rejectBiS&row=' + rowIndex, function(err, result) {
    if (err || (result && result.error)) { btnEl.disabled = false; btnEl.textContent = 'Reject'; return; }
    var card = document.querySelector('.request-card[data-row="' + rowIndex + '"]');
    if (card) card.remove();
    checkEmptyBisSubmissions();
  });
}

function checkEmptyBisSubmissions() {
  var container = document.getElementById('bisContainer');
  if (container && !container.querySelector('.request-card')) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No pending BiS submissions.</p>';
  }
  updateNavBadges();
}

// ── BiS Lists sub-tab ────────────────────────────────────────────────────────

var _bisListEditor = null; // { firstName, nameRealm, items: [{item, slot}] }
var _bisListSearch = '';

function buildBisListsTab() {
  var container = document.getElementById('bis-lists-container');
  if (!container) return;

  var roster = DATA.roster || [];
  var order = ['Tank', 'Heal', 'Melee', 'Ranged', 'Bench'];
  var labels = { Tank: 'Tanks', Heal: 'Healers', Melee: 'Melee', Ranged: 'Ranged', Bench: 'Bench' };
  var groups = { Tank: [], Heal: [], Melee: [], Ranged: [], Bench: [] };

  for (var i = 0; i < roster.length; i++) {
    var p = roster[i];
    if (p.isBench) groups['Bench'].push(p);
    else if (groups[p.role]) groups[p.role].push(p);
  }

  var html = '<table class="roster-table" style="margin-top:0.25rem;">' +
    '<thead><tr><th>Player</th><th>Class / Spec</th><th>BiS Items</th><th></th></tr></thead><tbody>';

  for (var r = 0; r < order.length; r++) {
    var role = order[r];
    var players = groups[role];
    if (!players.length) continue;
    players.sort(function (a, b) { return (a.nick || a.firstName).localeCompare(b.nick || b.firstName); });
    html += '<tr class="group-header"><td colspan="4">' + labels[role] + '</td></tr>';

    for (var j = 0; j < players.length; j++) {
      var p = players[j];
      var bisCount = getBisItems(p.firstName).length;
      var roleColor = p.role === 'Tank' ? 'var(--tank)' : p.role === 'Heal' ? 'var(--heal)' : p.role === 'Ranged' ? 'var(--ranged)' : 'var(--melee)';
      var dispName = p.nick || p.firstName;
      var isEditing = _bisListEditor && _bisListEditor.firstName === p.firstName;
      var fnSafe = p.firstName.replace(/'/g, "\\'");
      var nrSafe = p.nameRealm.replace(/'/g, "\\'");

      html +=
        '<tr id="bis-player-row-' + p.firstName + '">' +
        '<td><div class="player-name-cell">' +
        '<div class="mini-avatar" style="background:rgba(0,0,0,0.25);color:' + roleColor + ';border:2px solid ' + roleColor + ';">' + dispName.slice(0, 2).toUpperCase() + '</div>' +
        '<div style="display:flex;flex-direction:column;gap:0.1rem;">' +
        '<span style="font-weight:600;color:var(--text);">' + dispName + '</span>' +
        (p.firstName !== dispName ? '<span style="font-size:0.9rem;color:var(--text-muted);">(' + p.firstName + ')</span>' : '') +
        '</div>' +
        '</div></td>' +
        '<td>' + (p.class ? '<span class="badge badge-class" style="' + classBadgeStyle(p.class) + ';">' + (p.spec || p.class) + '</span>' : '<span style="color:var(--text-dim);">-</span>') + '</td>' +
        '<td><span style="color:' + (bisCount > 0 ? 'var(--gold)' : 'var(--text-dim)') + ';font-weight:600;">' + bisCount + '</span></td>' +
        '<td><button class="btn ' + (isEditing ? 'btn-gold' : 'btn-muted') + '" style="font-size:0.85rem;padding:0.2rem 0.65rem;" ' +
        'onclick="toggleBisListEditor(\'' + fnSafe + '\',\'' + nrSafe + '\')">' + (isEditing ? 'Close' : 'Edit') + '</button></td>' +
        '</tr>' +
        '<tr id="bis-editor-row-' + p.firstName + '" style="display:' + (isEditing ? '' : 'none') + ';">' +
        '<td colspan="4" style="padding:0.75rem 1rem 0.75rem 1.25rem;background:rgba(0,0,0,0.12);border-top:none;">' +
        '<div id="bis-editor-panel-' + p.firstName + '">' + (isEditing ? bisEditorHTML() : '') + '</div>' +
        '</td>' +
        '</tr>';
    }
  }

  html += '</tbody></table>';
  container.innerHTML = html;

  if (_bisListEditor) {
    var searchEl = document.getElementById('bisListSearchInput');
    if (searchEl) {
      searchEl.value = _bisListSearch;
      searchEl.addEventListener('blur', function () {
        setTimeout(function () {
          var dd = document.getElementById('bisListDropdown');
          if (dd) dd.style.display = 'none';
        }, 150);
      });
      if (_bisListSearch) bisListOnInput();
    }
  }
}

function toggleBisListEditor(firstName, nameRealm) {
  if (_bisListEditor && _bisListEditor.firstName === firstName) {
    _bisListEditor = null;
    _bisListSearch = '';
  } else {
    _bisListEditor = { firstName: firstName, nameRealm: nameRealm, items: getBisItems(firstName).slice() };
    _bisListSearch = '';
  }
  buildBisListsTab();
}

function bisEditorHTML() {
  if (!_bisListEditor) return '';
  var items = _bisListEditor.items;
  var html = '<div style="margin-bottom:0.6rem;">';

  // BiS link (from roster)
  var player = null;
  var roster = DATA.roster || [];
  var norm = normalise(_bisListEditor.firstName);
  for (var pi = 0; pi < roster.length; pi++) {
    if (normalise(roster[pi].firstName) === norm) { player = roster[pi]; break; }
  }
  var bisLink = player && player.bisLink;
  html += '<div style="font-size:0.88rem;color:var(--text-muted);margin-bottom:0.5rem;">BiS Source: ' +
    (bisLink
      ? '<a href="' + bisLink + '" target="_blank" rel="noopener" style="color:var(--gold);">' + bisLink + '</a>'
      : '<span style="color:var(--text-dim);">none</span>') +
    '</div>';

  if (items.length) {
    html += '<div style="display:flex;flex-direction:column;gap:0.2rem;margin-bottom:0.6rem;">';
    for (var i = 0; i < items.length; i++) {
      var slot = items[i].slot || '';
      var item = items[i].item || '';
      var slotC = getSlotColor(slot);
      html +=
        '<div style="display:flex;align-items:center;gap:0.5rem;font-size:0.95rem;padding:0.15rem 0;">' +
        '<span style="min-width:5rem;color:' + slotC + ';font-size:0.85rem;">' + slot + '</span>' +
        '<span style="flex:1;color:var(--text);">' + item + '</span>' +
        '<button class="btn btn-muted" style="font-size:0.78rem;padding:1px 7px;color:var(--melee);" ' +
        'onclick="removeBisListItem(' + i + ')">x</button>' +
        '</div>';
    }
    html += '</div>';
  } else {
    html += '<p style="color:var(--text-muted);font-size:0.92rem;margin:0 0 0.6rem;">No items yet -- search below to add.</p>';
  }

  html +=
    '<div style="position:relative;margin-bottom:0.5rem;">' +
    '<input type="text" id="bisListSearchInput" placeholder="Search items to add..." ' +
    'class="self-received-source" style="width:100%;box-sizing:border-box;font-size:0.95rem;" ' +
    'oninput="bisListOnInput()" autocomplete="off">' +
    '<div id="bisListDropdown" style="display:none;position:absolute;top:100%;left:0;right:0;' +
    'background:var(--bg-card);border:1px solid var(--border);border-radius:4px;z-index:100;' +
    'max-height:200px;overflow-y:auto;"></div>' +
    '</div>' +
    '<div style="display:flex;gap:0.5rem;align-items:center;">' +
    '<button class="btn request-approve-btn" onclick="saveBisListItems()">Save</button>' +
    '<button class="btn btn-muted" style="font-size:0.92rem;padding:0.25rem 0.75rem;" onclick="cancelBisListEditor()">Cancel</button>' +
    '<span id="bisListSaveMsg" style="font-size:0.92rem;color:var(--text-muted);"></span>' +
    '</div>';

  html += '</div>';
  return html;
}

function refreshBisEditorPanel() {
  if (!_bisListEditor) return;
  var panel = document.getElementById('bis-editor-panel-' + _bisListEditor.firstName);
  if (!panel) return;
  panel.innerHTML = bisEditorHTML();
  var searchEl = document.getElementById('bisListSearchInput');
  if (searchEl) {
    searchEl.value = _bisListSearch;
    searchEl.addEventListener('blur', function () {
      setTimeout(function () {
        var dd = document.getElementById('bisListDropdown');
        if (dd) dd.style.display = 'none';
      }, 150);
    });
    if (_bisListSearch) bisListOnInput();
  }
}

function removeBisListItem(index) {
  if (!_bisListEditor) return;
  _bisListEditor.items.splice(index, 1);
  refreshBisEditorPanel();
}

var BIS_UNIVERSAL_SLOTS = { 'Trinket': true, 'Ring': true, 'Neck': true, 'Back': true, 'Wrist': true, 'Cloak': true };
var BIS_ARMOR_TYPES     = { 'Plate': true, 'Mail': true, 'Leather': true, 'Cloth': true };

function bisListOnInput() {
  _bisListSearch = (document.getElementById('bisListSearchInput') || {}).value || '';
  var dropdown = document.getElementById('bisListDropdown');
  if (!dropdown) return;
  var query = normalise(_bisListSearch.trim());
  if (!query) { dropdown.style.display = 'none'; return; }

  var allItems = Object.keys(DATA.itemSlots || {});
  var existing = {};
  if (_bisListEditor) {
    for (var e = 0; e < _bisListEditor.items.length; e++) existing[normalise(_bisListEditor.items[e].item)] = true;
  }

  // Determine player armor type for filtering
  var playerArmorType = null;
  if (_bisListEditor) {
    var roster = DATA.roster || [];
    var edNorm = normalise(_bisListEditor.firstName);
    for (var pi = 0; pi < roster.length; pi++) {
      if (normalise(roster[pi].firstName) === edNorm) {
        playerArmorType = (CLASS_ARMOR_TYPE || {})[roster[pi].class] || null;
        break;
      }
    }
  }

  var itemArmorTypes = DATA.itemArmorTypes || {};
  var itemSlots      = DATA.itemSlots      || {};

  var matches = [];
  for (var i = 0; i < allItems.length; i++) {
    var name      = allItems[i];
    var slot      = itemSlots[name]      || '';
    var armorType = itemArmorTypes[name] || '';

    // Armor type filter: only applies when item has a recognised armor type (Plate/Mail/Leather/Cloth).
    // Shields, off-hands, weapons, etc. have non-standard types and are always shown.
    if (playerArmorType && BIS_ARMOR_TYPES[armorType] && !BIS_UNIVERSAL_SLOTS[slot] && armorType !== playerArmorType) continue;

    // Text filter: match item name or slot name
    if (normalise(name).indexOf(query) === -1 && normalise(slot).indexOf(query) === -1) continue;

    matches.push(name);
    if (matches.length >= 10) break;
  }

  if (!matches.length) { dropdown.style.display = 'none'; return; }

  dropdown.innerHTML = matches.map(function (name) {
    var slot    = itemSlots[name] || '';
    var already = existing[normalise(name)];
    return '<div class="realm-option" style="display:flex;gap:0.5rem;align-items:center;' + (already ? 'opacity:0.45;pointer-events:none;' : '') + '" ' +
      'onmousedown="bisListPickItem(\'' + name.replace(/'/g, "\\'") + '\',\'' + slot.replace(/'/g, "\\'") + '\')">' +
      '<span style="min-width:5rem;font-size:0.85rem;color:' + getSlotColor(slot) + ';">' + slot + '</span>' +
      '<span>' + name + '</span>' +
      (already ? '<span style="font-size:0.8rem;color:var(--text-dim);margin-left:auto;">already added</span>' : '') +
      '</div>';
  }).join('');
  dropdown.style.display = 'block';
}

function bisListPickItem(itemName, slot) {
  if (!_bisListEditor) return;
  for (var i = 0; i < _bisListEditor.items.length; i++) {
    if (_bisListEditor.items[i].item === itemName) return;
  }
  _bisListEditor.items.push({ item: itemName, slot: slot });
  _bisListSearch = '';
  refreshBisEditorPanel();
}

function cancelBisListEditor() {
  _bisListEditor = null;
  _bisListSearch = '';
  buildBisListsTab();
}

function saveBisListItems() {
  if (!_bisListEditor) return;
  var msgEl = document.getElementById('bisListSaveMsg');
  if (msgEl) msgEl.textContent = 'Saving...';
  var nameRealm = _bisListEditor.nameRealm;
  var firstName = _bisListEditor.firstName;
  var items = _bisListEditor.items.slice();
  jsonpRequest(WEB_APP_URL + '?action=setBisItems&data=' +
    encodeURIComponent(JSON.stringify({ nameRealm: nameRealm, items: items })).replace(/'/g, '%27'),
  function(err, result) {
    if (err || (result && result.error)) {
      var msg = document.getElementById('bisListSaveMsg');
      if (msg) msg.textContent = err ? err.message : 'Failed: ' + result.error;
      return;
    }
    if (DATA && DATA.bisList) {
      var norm = normalise(firstName);
      var keys = Object.keys(DATA.bisList);
      var key = firstName;
      for (var k = 0; k < keys.length; k++) { if (normalise(keys[k]) === norm) { key = keys[k]; break; } }
      DATA.bisList[key] = items;
    }
    _bisListEditor = null;
    _bisListSearch = '';
    buildBisListsTab();
  });
}
