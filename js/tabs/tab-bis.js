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
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  jsonpRequest(
    WEB_APP_URL + '?action=setBisSubmissionsOpen&value=' + (open ? 'true' : 'false'),
    function (err, result) {
      if (btn) btn.disabled = false;
      if (!err) {
        if (DATA) DATA.bisSubmissionsOpen = open;
      }
      renderBisToggle();
    }
  );
}

function buildBisTab() {
  var container = document.getElementById('bisContainer');
  if (!container) return;
  container.innerHTML =
    '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">Loading submissions...</p>';

  jsonpRequest(WEB_APP_URL + '?action=getPendingBiS', function (err, result) {
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
    container.innerHTML =
      '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No pending BiS submissions.</p>';
    return;
  }
  var html =
    '<div style="margin-top:1.5rem;">' +
    '<div style="font-size:0.9rem;letter-spacing:0.16em;text-transform:uppercase;color:var(--text-muted);font-weight:600;margin-bottom:0.75rem;">' +
    submissions.length +
    ' pending submission' +
    (submissions.length !== 1 ? 's' : '') +
    '</div>';
  submissions.forEach(function (s) {
    html +=
      '<div class="request-card" data-row="' +
      s.rowIndex +
      '" data-name-realm="' +
      s.nameRealm.replace(/"/g, '&quot;') +
      '" data-bis-link="' +
      s.bisLink.replace(/"/g, '&quot;') +
      '">' +
      '<div class="request-card-header">' +
      '<span class="request-player">' +
      s.nameRealm +
      '</span>' +
      '<span class="signup-response-time">' +
      s.timestamp +
      '</span>' +
      '</div>' +
      '<div class="request-item" style="word-break:break-all;margin-top:0.35rem;">' +
      '<a href="' +
      s.bisLink +
      '" target="_blank" rel="noopener" style="color:var(--gold);font-size:1rem;">' +
      s.bisLink +
      '</a>' +
      '</div>' +
      (s.notes
        ? '<div style="font-size:0.97rem;color:var(--text);margin-top:0.6rem;padding-top:0.6rem;border-top:1px solid var(--border);">' +
          s.notes +
          '</div>'
        : '') +
      '<div style="display:flex;gap:0.5rem;margin-top:0.75rem;">' +
      '<button class="btn request-approve-btn" onclick="approveBisSubmission(' +
      s.rowIndex +
      ', this)">Approve</button>' +
      '<button class="btn request-reject-btn" onclick="rejectBisSubmission(' +
      s.rowIndex +
      ', this)">Reject</button>' +
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
  jsonpRequest(
    WEB_APP_URL + '?action=approveBiS&data=' + encodeURIComponent(JSON.stringify(data)),
    function (err, result) {
      if (err || (result && result.error)) {
        btnEl.disabled = false;
        btnEl.textContent = 'Approve';
        return;
      }
      if (card) card.remove();
      checkEmptyBisSubmissions();
    }
  );
}

function rejectBisSubmission(rowIndex, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = '...';
  jsonpRequest(WEB_APP_URL + '?action=rejectBiS&row=' + rowIndex, function (err, result) {
    if (err || (result && result.error)) {
      btnEl.disabled = false;
      btnEl.textContent = 'Reject';
      return;
    }
    var card = document.querySelector('.request-card[data-row="' + rowIndex + '"]');
    if (card) card.remove();
    checkEmptyBisSubmissions();
  });
}

function checkEmptyBisSubmissions() {
  var container = document.getElementById('bisContainer');
  if (container && !container.querySelector('.request-card')) {
    container.innerHTML =
      '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No pending BiS submissions.</p>';
  }
  updateNavBadges();
}

// ── BiS Lists sub-tab (Supabase, #217) ───────────────────────────────────────
//
// Every add/remove/mark-obtained writes straight to bis_items and logs itself
// via writeAuditLog() (#214) -- no staged "Save" step, since the backend
// supports true per-row writes now (unlike the old GAS setBisItems, which
// only rewrote a player's whole BiS column at once). getBisItems(firstName)
// (js/common.js) is the live source of truth; DATA.bisList is patched in
// place after each successful write instead of re-fetching. Audit entries use
// target_type 'players' (not 'bis_items') so TARGET still resolves to the
// character name even after a row is deleted -- a bis_items id would go
// stale the moment "remove" runs, since resolveAuditTargetNames() (tab-audit.js)
// only ever looks the row up by a still-existing primary key.

var _bisListEditor = null; // { firstName, nameRealm }
var _bisListSearch = '';

function bisFindRosterPlayer(firstName) {
  var norm = normalise(firstName);
  var roster = (DATA && DATA.roster) || [];
  for (var i = 0; i < roster.length; i++) {
    if (normalise(roster[i].firstName) === norm) return roster[i];
  }
  return null;
}

// bis_items keys on (player_id, item_id); items aren't looked up by id
// anywhere on the client yet, so resolve by exact name match (items.name has
// a unique index) the same way #216 resolved classes_specs.
function resolveItemId(itemName) {
  return supabaseClient
    .from('items')
    .select('id')
    .eq('name', itemName)
    .maybeSingle()
    .then(function (result) {
      if (result.error || !result.data) throw new Error('Unknown item: ' + itemName);
      return result.data.id;
    });
}

function bisItemAuditDetail(itemName, slot) {
  return [slot, itemName].filter(Boolean).join(' ');
}

// DATA.bisList's key may not be an exact case match for the roster's
// firstName (mirrors the same normalise-based lookup getBisItems() already
// does); falls back to firstName itself for a player's first-ever BiS entry.
function bisListKeyFor(firstName) {
  var bisMap = DATA.bisList || {};
  var norm = normalise(firstName);
  var keys = Object.keys(bisMap);
  for (var i = 0; i < keys.length; i++) {
    if (normalise(keys[i]) === norm) return keys[i];
  }
  return firstName;
}

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

  var html =
    '<table class="roster-table" style="margin-top:0.25rem;">' +
    '<thead><tr><th>Player</th><th>Class / Spec</th><th>BiS Items</th><th></th></tr></thead><tbody>';

  for (var r = 0; r < order.length; r++) {
    var role = order[r];
    var players = groups[role];
    if (!players.length) continue;
    players.sort(function (a, b) {
      return (a.nick || a.firstName).localeCompare(b.nick || b.firstName);
    });
    html += '<tr class="group-header"><td colspan="4">' + labels[role] + '</td></tr>';

    for (var j = 0; j < players.length; j++) {
      var p = players[j];
      var bisCount = getBisItems(p.firstName).length;
      var roleColor =
        p.role === 'Tank'
          ? 'var(--tank)'
          : p.role === 'Heal'
            ? 'var(--heal)'
            : p.role === 'Ranged'
              ? 'var(--ranged)'
              : 'var(--melee)';
      var dispName = p.nick || p.firstName;
      var isEditing = _bisListEditor && _bisListEditor.firstName === p.firstName;
      var fnSafe = p.firstName.replace(/'/g, "\\'");
      var nrSafe = p.nameRealm.replace(/'/g, "\\'");

      html +=
        '<tr id="bis-player-row-' +
        p.firstName +
        '">' +
        '<td><div class="player-name-cell">' +
        '<div class="mini-avatar" style="background:rgba(0,0,0,0.25);color:' +
        roleColor +
        ';border:2px solid ' +
        roleColor +
        ';">' +
        dispName.slice(0, 2).toUpperCase() +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:0.1rem;">' +
        '<span style="font-weight:600;color:var(--text);">' +
        dispName +
        '</span>' +
        (p.firstName !== dispName
          ? '<span style="font-size:0.9rem;color:var(--text-muted);">(' + p.firstName + ')</span>'
          : '') +
        '</div>' +
        '</div></td>' +
        '<td>' +
        (p.class
          ? '<span class="badge badge-class" style="' +
            classBadgeStyle(p.class) +
            ';">' +
            (p.spec || p.class) +
            '</span>'
          : '<span style="color:var(--text-dim);">-</span>') +
        '</td>' +
        '<td><span style="color:' +
        (bisCount > 0 ? 'var(--gold)' : 'var(--text-dim)') +
        ';font-weight:600;">' +
        bisCount +
        '</span></td>' +
        '<td><button class="btn ' +
        (isEditing ? 'btn-gold' : 'btn-muted') +
        '" style="font-size:0.85rem;padding:0.2rem 0.65rem;" ' +
        'onclick="toggleBisListEditor(\'' +
        fnSafe +
        "','" +
        nrSafe +
        '\')">' +
        (isEditing ? 'Close' : 'Edit') +
        '</button></td>' +
        '</tr>' +
        '<tr id="bis-editor-row-' +
        p.firstName +
        '" style="display:' +
        (isEditing ? '' : 'none') +
        ';">' +
        '<td colspan="4" style="padding:0.75rem 1rem 0.75rem 1.25rem;background:rgba(0,0,0,0.12);border-top:none;">' +
        '<div id="bis-editor-panel-' +
        p.firstName +
        '">' +
        (isEditing ? bisEditorHTML() : '') +
        '</div>' +
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
    _bisListEditor = { firstName: firstName, nameRealm: nameRealm };
    _bisListSearch = '';
  }
  _bisPendingPlaceholder = null;
  buildBisListsTab();
}

function bisEditorHTML() {
  if (!_bisListEditor) return '';
  var items = getBisItems(_bisListEditor.firstName);
  var html = '<div style="margin-bottom:0.6rem;">';

  // BiS link (from roster)
  var player = bisFindRosterPlayer(_bisListEditor.firstName);
  var bisLink = player && player.bisLink;
  html +=
    '<div style="font-size:0.88rem;color:var(--text-muted);margin-bottom:0.5rem;">BiS Source: ' +
    (bisLink
      ? '<a href="' + bisLink + '" target="_blank" rel="noopener" style="color:var(--gold);">' + bisLink + '</a>'
      : '<span style="color:var(--text-dim);">none</span>') +
    '</div>';

  if (items.length) {
    html += '<div style="display:flex;flex-direction:column;gap:0.2rem;margin-bottom:0.6rem;">';
    for (var i = 0; i < items.length; i++) {
      var slot = items[i].slot || '';
      var item = items[i].item || '';
      var obtained = !!items[i].obtained;
      var slotC = getSlotColor(slot);
      html +=
        '<div style="display:flex;align-items:center;gap:0.5rem;font-size:0.95rem;padding:0.15rem 0;">' +
        '<span style="min-width:5rem;color:' +
        slotC +
        ';font-size:0.85rem;">' +
        slot +
        '</span>' +
        '<span style="flex:1;color:var(--text);' +
        (obtained ? 'text-decoration:line-through;opacity:0.7;' : '') +
        '">' +
        item +
        '</span>' +
        '<label style="display:flex;align-items:center;gap:0.3rem;font-size:0.82rem;color:var(--text-muted);cursor:pointer;white-space:nowrap;">' +
        '<input type="checkbox" ' +
        (obtained ? 'checked' : '') +
        ' onchange="toggleBisItemObtained(' +
        i +
        ', this.checked)">Obtained</label>' +
        '<button class="btn btn-muted" style="font-size:0.78rem;padding:1px 7px;color:var(--melee);" ' +
        'onclick="removeBisListItem(' +
        i +
        ')">x</button>' +
        '</div>';
    }
    html += '</div>';
  } else {
    html +=
      '<p style="color:var(--text-muted);font-size:0.92rem;margin:0 0 0.6rem;">No items yet -- search below to add.</p>';
  }

  if (_bisPendingPlaceholder) {
    html +=
      '<div style="display:flex;gap:0.5rem;align-items:center;margin-bottom:0.5rem;">' +
      '<span style="font-size:0.9rem;color:var(--text-muted);">Which slot is "' +
      _bisPendingPlaceholder +
      '" for?</span>' +
      '<select id="bisPlaceholderSlotSelect" class="self-received-source" style="font-size:0.9rem;">' +
      PLACEHOLDER_SLOT_OPTIONS.map(function (s) {
        return '<option value="' + s + '">' + s + '</option>';
      }).join('') +
      '</select>' +
      '<button class="btn btn-gold" style="font-size:0.85rem;padding:0.2rem 0.65rem;" ' +
      'onclick="bisListConfirmPlaceholder(document.getElementById(\'bisPlaceholderSlotSelect\').value)">Add</button>' +
      '<button class="btn btn-muted" style="font-size:0.85rem;padding:0.2rem 0.65rem;" ' +
      'onclick="bisListCancelPlaceholder()">Cancel</button>' +
      '</div>';
  } else {
    html +=
      '<div style="position:relative;margin-bottom:0.5rem;">' +
      '<input type="text" id="bisListSearchInput" placeholder="Search items to add..." ' +
      'class="self-received-source" style="width:100%;box-sizing:border-box;font-size:0.95rem;" ' +
      'oninput="bisListOnInput()" autocomplete="off">' +
      '<div id="bisListDropdown" style="display:none;position:absolute;top:100%;left:0;right:0;' +
      'background:var(--bg-card);border:1px solid var(--border);border-radius:4px;z-index:100;' +
      'max-height:200px;overflow-y:auto;"></div>' +
      '</div>';
  }
  html +=
    '<div style="display:flex;gap:0.5rem;align-items:center;">' +
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

// A placeholder item (M+/Crafted/Catalyst) can now have more than one row per
// player, distinguished only by bis_items.slot (#391 follow-up, e.g. two
// Finger slots both aimed at "M+") -- .eq('item_id', ...) alone would match
// every one of them. entry.dbSlot is the raw column value (null for every
// real item, since only placeholder rows ever get one written).
function bisSlotFilter(query, dbSlot) {
  return dbSlot ? query.eq('slot', dbSlot) : query.is('slot', null);
}

function removeBisListItem(index) {
  if (!_bisListEditor) return;
  var entry = getBisItems(_bisListEditor.firstName)[index];
  var player = bisFindRosterPlayer(_bisListEditor.firstName);
  if (!entry || !player || !player.id || entry.itemId == null) return;
  var msgEl = document.getElementById('bisListSaveMsg');
  if (msgEl) msgEl.textContent = 'Removing...';
  bisSlotFilter(
    supabaseClient.from('bis_items').delete().eq('player_id', player.id).eq('item_id', entry.itemId),
    entry.dbSlot
  )
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);
      return writeAuditLog('BiS Item Removed', 'players', player.id, bisItemAuditDetail(entry.item, entry.slot));
    })
    .then(function () {
      var key = bisListKeyFor(_bisListEditor.firstName);
      if (DATA.bisList && DATA.bisList[key]) {
        DATA.bisList[key] = DATA.bisList[key].filter(function (e) {
          return !(e.itemId === entry.itemId && (e.dbSlot || null) === (entry.dbSlot || null));
        });
      }
      // Rebuilds the whole tab, not just refreshBisEditorPanel() -- the row's
      // own BiS-count badge needs to move too, since this is already committed
      // state rather than a pending draft.
      buildBisListsTab();
    })
    .catch(function (err) {
      var msg = document.getElementById('bisListSaveMsg');
      if (msg) msg.textContent = 'Failed: ' + err.message;
    });
}

function toggleBisItemObtained(index, checked) {
  if (!_bisListEditor) return;
  var entry = getBisItems(_bisListEditor.firstName)[index];
  var player = bisFindRosterPlayer(_bisListEditor.firstName);
  if (!entry || !player || !player.id || entry.itemId == null) return;
  var msgEl = document.getElementById('bisListSaveMsg');
  if (msgEl) msgEl.textContent = 'Saving...';
  bisSlotFilter(
    supabaseClient.from('bis_items').update({ obtained: checked }).eq('player_id', player.id).eq('item_id', entry.itemId),
    entry.dbSlot
  )
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);
      var detail =
        (checked ? 'Marked obtained: ' : 'Marked not obtained: ') + bisItemAuditDetail(entry.item, entry.slot);
      return writeAuditLog('BiS Item Obtained Changed', 'players', player.id, detail);
    })
    .then(function () {
      // entry is the same object reference stored in DATA.bisList (getBisItems()
      // returns object entries as-is, not copies), so this mutation persists.
      entry.obtained = checked;
      var msg = document.getElementById('bisListSaveMsg');
      if (msg) msg.textContent = '';
    })
    .catch(function (err) {
      var msg = document.getElementById('bisListSaveMsg');
      if (msg) msg.textContent = 'Failed: ' + err.message;
      refreshBisEditorPanel();
    });
}

var BIS_UNIVERSAL_SLOTS = { Trinket: true, Ring: true, Neck: true, Back: true, Wrist: true, Cloak: true };
var BIS_ARMOR_TYPES = { Plate: true, Mail: true, Leather: true, Cloth: true };

function bisListOnInput() {
  _bisListSearch = (document.getElementById('bisListSearchInput') || {}).value || '';
  var dropdown = document.getElementById('bisListDropdown');
  if (!dropdown) return;
  var query = normalise(_bisListSearch.trim());
  if (!query) {
    dropdown.style.display = 'none';
    return;
  }

  var allItems = Object.keys(DATA.itemSlots || {});
  var existing = {};
  if (_bisListEditor) {
    var currentItems = getBisItems(_bisListEditor.firstName);
    for (var e = 0; e < currentItems.length; e++) existing[normalise(currentItems[e].item)] = true;
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
  var itemSlots = DATA.itemSlots || {};

  var matches = [];
  for (var i = 0; i < allItems.length; i++) {
    var name = allItems[i];
    var slot = itemSlots[name] || '';
    var armorType = itemArmorTypes[name] || '';

    // Armor type filter: only applies when item has a recognised armor type (Plate/Mail/Leather/Cloth).
    // Shields, off-hands, weapons, etc. have non-standard types and are always shown.
    if (playerArmorType && BIS_ARMOR_TYPES[armorType] && !BIS_UNIVERSAL_SLOTS[slot] && armorType !== playerArmorType)
      continue;

    // Text filter: match item name or slot name
    if (normalise(name).indexOf(query) === -1 && normalise(slot).indexOf(query) === -1) continue;

    matches.push(name);
    if (matches.length >= 10) break;
  }

  if (!matches.length) {
    dropdown.style.display = 'none';
    return;
  }

  var itemPlaceholders = DATA.itemPlaceholders || {};

  dropdown.innerHTML = matches
    .map(function (name) {
      var slot = itemSlots[name] || '';
      var isPlaceholder = !!itemPlaceholders[name];
      // Placeholder items can be added more than once (a different slot each
      // time), so "already added" only disables real items -- a placeholder
      // duplicate is caught at slot-confirm time instead (bisListConfirmPlaceholder).
      var already = existing[normalise(name)] && !isPlaceholder;
      var onPick = isPlaceholder
        ? "bisListPickPlaceholderItem('" + name.replace(/'/g, "\\'") + "')"
        : "bisListPickItem('" + name.replace(/'/g, "\\'") + "','" + slot.replace(/'/g, "\\'") + "')";
      return (
        '<div class="realm-option" style="display:flex;gap:0.5rem;align-items:center;' +
        (already ? 'opacity:0.45;pointer-events:none;' : '') +
        '" ' +
        'onmousedown="' +
        onPick +
        '">' +
        '<span style="min-width:5rem;font-size:0.85rem;color:' +
        getSlotColor(slot) +
        ';">' +
        slot +
        '</span>' +
        '<span>' +
        name +
        '</span>' +
        (already ? '<span style="font-size:0.8rem;color:var(--text-dim);margin-left:auto;">already added</span>' : '') +
        '</div>'
      );
    })
    .join('');
  dropdown.style.display = 'block';
}

function bisListPickItem(itemName, slot) {
  if (!_bisListEditor) return;
  var existing = getBisItems(_bisListEditor.firstName);
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].item === itemName) return;
  }
  var player = bisFindRosterPlayer(_bisListEditor.firstName);
  if (!player || !player.id) return;
  var firstName = _bisListEditor.firstName;
  _bisListSearch = '';
  var msgEl = document.getElementById('bisListSaveMsg');
  if (msgEl) msgEl.textContent = 'Adding...';
  resolveItemId(itemName)
    .then(function (itemId) {
      return supabaseClient
        .from('bis_items')
        .insert({ player_id: player.id, item_id: itemId })
        .then(function (result) {
          if (result.error) throw new Error(result.error.message);
          return writeAuditLog('BiS Item Added', 'players', player.id, bisItemAuditDetail(itemName, slot)).then(
            function () {
              return itemId;
            }
          );
        });
    })
    .then(function (itemId) {
      var key = bisListKeyFor(firstName);
      if (!DATA.bisList) DATA.bisList = {};
      if (!DATA.bisList[key]) DATA.bisList[key] = [];
      DATA.bisList[key].push({
        item: itemName,
        slot: slot,
        dbSlot: null,
        obtained: false,
        playerId: player.id,
        itemId: itemId
      });
      buildBisListsTab();
    })
    .catch(function (err) {
      var msg = document.getElementById('bisListSaveMsg');
      if (msg) msg.textContent = 'Failed: ' + err.message;
    });
}

// Placeholder items (M+/Crafted/Catalyst) name a loot source, not a gear
// slot, so bisListPickItem's one-click add doesn't apply -- the officer picks
// which slot this particular placeholder is standing in for first (#391
// follow-up), which also lets the same placeholder appear twice for a player
// (e.g. both Finger slots aimed at "M+"), distinguished by that chosen slot.
var PLACEHOLDER_SLOT_OPTIONS = [
  'Head',
  'Neck',
  'Shoulder',
  'Back',
  'Chest',
  'Wrist',
  'Hands',
  'Waist',
  'Legs',
  'Feet',
  'Finger 1',
  'Finger 2',
  'Trinket 1',
  'Trinket 2',
  'Weapon',
  'Off Hand'
];

var _bisPendingPlaceholder = null; // item name awaiting a slot choice, or null

function bisListPickPlaceholderItem(itemName) {
  _bisPendingPlaceholder = itemName;
  _bisListSearch = '';
  var dropdown = document.getElementById('bisListDropdown');
  if (dropdown) dropdown.style.display = 'none';
  refreshBisEditorPanel();
}

function bisListCancelPlaceholder() {
  _bisPendingPlaceholder = null;
  refreshBisEditorPanel();
}

function bisListConfirmPlaceholder(slot) {
  if (!_bisPendingPlaceholder || !_bisListEditor || !slot) return;
  var itemName = _bisPendingPlaceholder;
  var existing = getBisItems(_bisListEditor.firstName);
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].item === itemName && (existing[i].dbSlot || '') === slot) {
      var dupMsg = document.getElementById('bisListSaveMsg');
      if (dupMsg) dupMsg.textContent = itemName + ' (' + slot + ') is already on this list.';
      return;
    }
  }
  var player = bisFindRosterPlayer(_bisListEditor.firstName);
  if (!player || !player.id) return;
  var firstName = _bisListEditor.firstName;
  _bisPendingPlaceholder = null;
  var msgEl = document.getElementById('bisListSaveMsg');
  if (msgEl) msgEl.textContent = 'Adding...';
  resolveItemId(itemName)
    .then(function (itemId) {
      return supabaseClient
        .from('bis_items')
        .insert({ player_id: player.id, item_id: itemId, slot: slot })
        .then(function (result) {
          if (result.error) throw new Error(result.error.message);
          return writeAuditLog('BiS Item Added', 'players', player.id, bisItemAuditDetail(itemName, slot)).then(
            function () {
              return itemId;
            }
          );
        });
    })
    .then(function (itemId) {
      var key = bisListKeyFor(firstName);
      if (!DATA.bisList) DATA.bisList = {};
      if (!DATA.bisList[key]) DATA.bisList[key] = [];
      DATA.bisList[key].push({
        item: itemName,
        slot: slot,
        dbSlot: slot,
        obtained: false,
        playerId: player.id,
        itemId: itemId
      });
      buildBisListsTab();
    })
    .catch(function (err) {
      var msg = document.getElementById('bisListSaveMsg');
      if (msg) msg.textContent = 'Failed: ' + err.message;
    });
}
