var ARMOR_SLOT_ORDER = ['HEAD', 'SHOULDERS', 'CHEST', 'GLOVES', 'LEGS', 'CLOAK', 'BRACERS', 'BELT', 'BOOTS'];

function fetchExportString() {
  var btn = document.getElementById('prioExportLoadBtn');
  var body = document.getElementById('prioExportBody');
  var area = document.getElementById('prioExportStr');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Loading...';
  }

  jsonpRequest(WEB_APP_URL + '?action=getExportString', function (err, result) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Regenerate';
    }
    var str = !err && result && result.exportString ? result.exportString : '';
    area.value = str;
    area.placeholder = err
      ? err.message
      : str
        ? ''
        : 'No export string found. Run Export Priority Data from the spreadsheet first.';
    body.style.display = '';
  });
}

function copyExportString() {
  var area = document.getElementById('prioExportStr');
  var msg = document.getElementById('prioExportCopyMsg');
  if (!area || !area.value) return;
  navigator.clipboard.writeText(area.value).then(function () {
    if (msg) {
      msg.style.display = '';
      setTimeout(function () {
        msg.style.display = 'none';
      }, 2000);
    }
  });
}

function _hasAnyPriority(entry) {
  if (!entry) return false;
  return 'heroic' in entry || 'mythic' in entry;
}

function _isFullyManaged(entry) {
  if (!entry) return false;
  return 'heroic' in entry && 'mythic' in entry;
}

function getUnmanagedItems() {
  var prioOrder = DATA.priorityOrder || {};
  var itemSlots = DATA.itemSlots || {};
  var seen = {};
  var result = [];
  Object.keys(prioOrder).forEach(function (item) {
    if ((itemSlots[item] || '').toLowerCase() === 'slot') return;
    if (!_isFullyManaged(prioOrder[item])) {
      seen[item] = true;
      result.push(item);
    }
  });
  Object.keys(itemSlots).forEach(function (item) {
    if (seen[item]) return;
    if ((itemSlots[item] || '').toLowerCase() === 'slot') return;
    if (!_isFullyManaged(prioOrder[item])) result.push(item);
  });
  return result.sort(function (a, b) {
    return a.localeCompare(b);
  });
}

function populateBossFilters() {
  var itemBosses = DATA.itemBosses || {};
  var bosses = [];
  var seen = {};
  Object.keys(itemBosses).forEach(function (item) {
    var b = itemBosses[item];
    if (b && !seen[b]) {
      seen[b] = true;
      bosses.push(b);
    }
  });
  bosses.sort(function (a, b) {
    return a.localeCompare(b);
  });
  var opts =
    '<option value="">All Bosses</option>' +
    bosses
      .map(function (b) {
        return '<option value="' + b.replace(/"/g, '&quot;') + '">' + b + '</option>';
      })
      .join('');
  var el1 = document.getElementById('prioBossFilter');
  var el2 = document.getElementById('unmanagedBossFilter');
  if (el1) el1.innerHTML = opts;
  if (el2) el2.innerHTML = opts;
}

function updateUnmanagedBadge() {
  var count = getUnmanagedItems().length;
  var navBadge = document.getElementById('prioNavBadge');
  var subBadge = document.getElementById('prioSubBadge');
  if (navBadge) {
    navBadge.textContent = count;
    navBadge.style.display = count > 0 ? '' : 'none';
  }
  if (subBadge) {
    subBadge.textContent = count;
    subBadge.style.display = count > 0 ? '' : 'none';
  }
}

function buildUnmanagedTab() {
  var itemSlots = DATA.itemSlots || {};
  var itemBosses = DATA.itemBosses || {};
  var searchTerm = normalise((document.getElementById('unmanagedSearch') || {}).value || '');
  var bossFilter = ((document.getElementById('unmanagedBossFilter') || {}).value || '').toLowerCase();
  var items = getUnmanagedItems().filter(function (item) {
    if (searchTerm && normalise(item).indexOf(searchTerm) === -1) return false;
    if (bossFilter && (itemBosses[item] || '').toLowerCase() !== bossFilter) return false;
    return true;
  });
  var el = document.getElementById('unmanagedContent');
  if (!el) return;
  if (!items.length) {
    el.innerHTML = '<p style="color:var(--heal);padding:1rem;">All items have been configured.</p>';
    return;
  }
  var groups = { Trinket: [], Armor: {}, Weapon: [], Jewelry: [], Other: [] };
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var slot = itemSlots[item] || '';
    var group = getItemGroup(slot);
    if (group === 'Armor') {
      var s = slot.toUpperCase();
      if (!groups.Armor[s]) groups.Armor[s] = [];
      groups.Armor[s].push(item);
    } else {
      groups[group].push(item);
    }
  }
  var GROUP_ORDER = ['Trinket', 'Armor', 'Weapon', 'Jewelry', 'Other'];
  var GROUP_LABELS = { Trinket: 'Trinkets', Armor: 'Armor', Weapon: 'Weapons', Jewelry: 'Jewelry', Other: 'Other' };
  var html =
    '<p style="font-size:0.88rem;color:var(--text-muted);margin-bottom:1rem;">' +
    items.length +
    ' item' +
    (items.length === 1 ? '' : 's') +
    ' with no players ranked yet.</p>';
  var secId = 0;
  for (var g = 0; g < GROUP_ORDER.length; g++) {
    var groupKey = GROUP_ORDER[g];
    var gid = 'unmanaged-sec-' + secId++;
    if (groupKey === 'Armor') {
      var hasArmor = false;
      for (var si = 0; si < ARMOR_SLOT_ORDER.length; si++) {
        if (groups.Armor[ARMOR_SLOT_ORDER[si]] && groups.Armor[ARMOR_SLOT_ORDER[si]].length) {
          hasArmor = true;
          break;
        }
      }
      if (!hasArmor) continue;
      html +=
        '<div class="prio-section-header prio-collapsible" onclick="togglePrioSection(\'' +
        gid +
        '\')">' +
        GROUP_LABELS.Armor +
        '<span class="prio-chevron">-</span></div>';
      html += '<div id="' + gid + '">';
      for (var si = 0; si < ARMOR_SLOT_ORDER.length; si++) {
        var slotKey = ARMOR_SLOT_ORDER[si];
        var slotItems = groups.Armor[slotKey];
        if (!slotItems || !slotItems.length) continue;
        var sid = 'unmanaged-sec-' + secId++;
        html +=
          '<div class="prio-sub-header prio-collapsible" style="color:' +
          getSlotColor(slotKey) +
          ';" onclick="togglePrioSection(\'' +
          sid +
          '\')">' +
          slotKey.charAt(0) +
          slotKey.slice(1).toLowerCase() +
          '<span class="prio-chevron">-</span></div>';
        html += '<div id="' + sid + '">';
        for (var k = 0; k < slotItems.length; k++) html += renderUnmanagedItem(slotItems[k], itemSlots[slotItems[k]]);
        html += '</div>';
      }
      html += '</div>';
    } else {
      if (!groups[groupKey].length) continue;
      html +=
        '<div class="prio-section-header prio-collapsible" onclick="togglePrioSection(\'' +
        gid +
        '\')">' +
        GROUP_LABELS[groupKey] +
        '<span class="prio-chevron">-</span></div>';
      html += '<div id="' + gid + '">';
      for (var k = 0; k < groups[groupKey].length; k++)
        html += renderUnmanagedItem(groups[groupKey][k], itemSlots[groups[groupKey][k]]);
      html += '</div>';
    }
  }
  el.innerHTML = html;
}

function renderUnmanagedItem(item, slot) {
  var boss = (DATA.itemBosses || {})[item] || '';
  var itemEnc = encodeURIComponent(item).replace(/'/g, '%27');
  var entry = (DATA.priorityOrder || {})[item] || {};
  var hasHeroic = 'heroic' in entry;
  var hasMythic = 'mythic' in entry;
  var out = '<div class="prio-item">';
  out += '<div class="prio-item-header">';
  out += '<span class="prio-item-name">' + item + '</span>';
  if (slot) out += '<span class="prio-item-slot" style="color:' + getSlotColor(slot) + ';">' + slot + '</span>';
  if (boss)
    out += '<span class="prio-item-slot" style="color:var(--text-muted);font-size:0.82rem;">' + boss + '</span>';
  out +=
    '<span class="prio-item-count" style="color:#c0392b;">' +
    (!hasHeroic && !hasMythic ? 'No rankings' : 'Incomplete') +
    '</span>';
  out += '<span style="margin-left:auto;display:flex;gap:6px;">';
  if (!hasHeroic)
    out +=
      '<button class="btn btn-muted" style="font-size:0.8rem;padding:2px 10px;" onclick="openPrioEditModal(decodeURIComponent(\'' +
      itemEnc +
      "'),'" +
      (slot || '') +
      "',true,'heroic')\">Set Heroic</button>";
  if (!hasMythic)
    out +=
      '<button class="btn btn-muted" style="font-size:0.8rem;padding:2px 10px;" onclick="openPrioEditModal(decodeURIComponent(\'' +
      itemEnc +
      "'),'" +
      (slot || '') +
      "',true,'mythic')\">Set Mythic</button>";
  out += '</span>';
  out += '</div></div>';
  return out;
}

function togglePrioSection(id) {
  var el = document.getElementById(id);
  var chevron = event.currentTarget.querySelector('.prio-chevron');
  var collapsed = el.style.display === 'none';
  el.style.display = collapsed ? '' : 'none';
  if (chevron) chevron.textContent = collapsed ? '-' : '+';
}

function getItemGroup(slot) {
  var s = (slot || '').toUpperCase();
  if (s === 'TRINKET' || s === 'TRINKET 1' || s === 'TRINKET 2') return 'Trinket';
  if (s === '1H/2H' || s === 'OH') return 'Weapon';
  if (s === 'NECK' || s === 'RING' || s === 'RING 1' || s === 'RING 2') return 'Jewelry';
  if (ARMOR_SLOT_ORDER.indexOf(s) >= 0) return 'Armor';
  return 'Other';
}

function buildPriorityTab() {
  var prioOrder = DATA.priorityOrder || {};
  var itemSlots = DATA.itemSlots || {};
  var itemBosses = DATA.itemBosses || {};
  var roster = DATA.roster || [];

  var rosterMap = {};
  for (var i = 0; i < roster.length; i++) {
    rosterMap[normalise(roster[i].firstName)] = roster[i];
  }

  var prioSearchTerm = normalise((document.getElementById('prioSearch') || {}).value || '');
  var bossFilter = ((document.getElementById('prioBossFilter') || {}).value || '').toLowerCase();
  var hideEmpty = !!(document.getElementById('prioHideEmpty') || {}).checked;
  var items = Object.keys(prioOrder)
    .filter(function (i) {
      if ((itemSlots[i] || '').toLowerCase() === 'slot') return false;
      if (!_hasAnyPriority(prioOrder[i])) return false;
      if (prioSearchTerm && normalise(i).indexOf(prioSearchTerm) === -1) return false;
      if (bossFilter && (itemBosses[i] || '').toLowerCase() !== bossFilter) return false;
      return true;
    })
    .sort(function (a, b) {
      return a.localeCompare(b);
    });

  if (!items.length) {
    document.getElementById('priorityContent').innerHTML =
      '<p style="color:var(--text);padding:1rem;">No priority data found.</p>';
    return;
  }

  var groups = { Trinket: [], Armor: {}, Weapon: [], Jewelry: [], Other: [] };
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var slot = itemSlots[item] || '';
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
    var entry = prioOrder[item];
    if (!entry) return '';
    var slot = itemSlots[item] || '';
    var boss = itemBosses[item] || '';
    var itemEnc = encodeURIComponent(item).replace(/'/g, '%27');
    var out = '';
    var DIFFS = ['heroic', 'mythic'];
    for (var d = 0; d < DIFFS.length; d++) {
      var diff = DIFFS[d];
      var ranked = entry[diff];
      if (ranked === undefined || ranked === null) continue;
      if (hideEmpty && !ranked.length) continue;
      var diffLabel = diff === 'heroic' ? 'Heroic' : 'Mythic';
      out += '<div class="prio-item">';
      out += '<div class="prio-item-header">';
      out += '<span class="prio-item-name">' + item + '</span>';
      out += '<span class="prio-diff-badge prio-diff-' + diff + '">' + diffLabel + '</span>';
      if (slot) out += '<span class="prio-item-slot" style="color:' + getSlotColor(slot) + ';">' + slot + '</span>';
      if (boss)
        out += '<span class="prio-item-slot" style="color:var(--text-muted);font-size:0.82rem;">' + boss + '</span>';
      if (!ranked.length) {
        out +=
          '<span class="prio-item-count" style="color:var(--text-muted);font-style:italic;">Nobody assigned</span>';
        out +=
          '<button class="btn btn-muted" style="margin-left:auto;font-size:0.8rem;padding:2px 10px;" onclick="openPrioEditModal(decodeURIComponent(\'' +
          itemEnc +
          "'),'" +
          (slot || '') +
          "',false,'" +
          diff +
          '\')">Edit</button>';
        out += '</div></div>';
        continue;
      }
      out += '<span class="prio-item-count">' + ranked.length + ' ranked</span>';
      out +=
        '<button class="btn btn-muted" style="margin-left:auto;font-size:0.8rem;padding:2px 10px;" onclick="openPrioEditModal(decodeURIComponent(\'' +
        itemEnc +
        "'),'" +
        (slot || '') +
        "',false,'" +
        diff +
        '\')">Edit</button>';
      out += '</div><div class="prio-ranked-list">';
      for (var j = 0; j < ranked.length; j++) {
        var firstName = ranked[j];
        var player = rosterMap[normalise(firstName)];
        var display = player ? player.nick || player.firstName : firstName;
        var role = player ? player.role : '';
        var roleColor =
          role === 'Tank'
            ? 'var(--tank)'
            : role === 'Heal'
              ? 'var(--heal)'
              : role === 'Ranged'
                ? 'var(--ranged)'
                : role === 'Melee'
                  ? 'var(--melee)'
                  : 'var(--text)';
        out += '<div class="prio-rank-row">';
        out += '<span class="prio-rank-num">' + (j + 1) + '</span>';
        out += '<span class="prio-rank-name" style="color:' + roleColor + ';">' + display + '</span>';
        if (role) out += '<span class="prio-role-badge prio-role-' + role + '">' + role.toUpperCase() + '</span>';
        out += '</div>';
      }
      out += '</div></div>';
    }
    return out;
  }

  var GROUP_ORDER = ['Trinket', 'Armor', 'Weapon', 'Jewelry', 'Other'];
  var GROUP_LABELS = { Trinket: 'Trinkets', Armor: 'Armor', Weapon: 'Weapons', Jewelry: 'Jewelry', Other: 'Other' };

  var html = '';
  var secId = 0;
  for (var g = 0; g < GROUP_ORDER.length; g++) {
    var groupKey = GROUP_ORDER[g];
    var gid = 'prio-sec-' + secId++;
    if (groupKey === 'Armor') {
      var hasArmor = false;
      for (var si = 0; si < ARMOR_SLOT_ORDER.length; si++) {
        if (groups.Armor[ARMOR_SLOT_ORDER[si]] && groups.Armor[ARMOR_SLOT_ORDER[si]].length) {
          hasArmor = true;
          break;
        }
      }
      if (!hasArmor) continue;
      html +=
        '<div class="prio-section-header prio-collapsible" onclick="togglePrioSection(\'' +
        gid +
        '\')">' +
        GROUP_LABELS.Armor +
        '<span class="prio-chevron">-</span></div>';
      html += '<div id="' + gid + '">';
      for (var si = 0; si < ARMOR_SLOT_ORDER.length; si++) {
        var slotKey = ARMOR_SLOT_ORDER[si];
        var slotItems = groups.Armor[slotKey];
        if (!slotItems || !slotItems.length) continue;
        var sid = 'prio-sec-' + secId++;
        html +=
          '<div class="prio-sub-header prio-collapsible" style="color:' +
          getSlotColor(slotKey) +
          ';" onclick="togglePrioSection(\'' +
          sid +
          '\')">' +
          slotKey.charAt(0) +
          slotKey.slice(1).toLowerCase() +
          '<span class="prio-chevron">-</span></div>';
        html += '<div id="' + sid + '">';
        for (var k = 0; k < slotItems.length; k++) html += renderItem(slotItems[k]);
        html += '</div>';
      }
      html += '</div>';
    } else {
      if (!groups[groupKey].length) continue;
      html +=
        '<div class="prio-section-header prio-collapsible" onclick="togglePrioSection(\'' +
        gid +
        '\')">' +
        GROUP_LABELS[groupKey] +
        '<span class="prio-chevron">-</span></div>';
      html += '<div id="' + gid + '">';
      for (var k = 0; k < groups[groupKey].length; k++) html += renderItem(groups[groupKey][k]);
      html += '</div>';
    }
  }

  document.getElementById('priorityContent').innerHTML = html;
}

// -- Priority Edit Modal --

var PRIO_EDIT = {
  item: '',
  slot: '',
  difficulty: 'Heroic',
  ranked: [],
  showAllRoster: false,
  dragSrcIdx: -1,
  scores: {}
};

function openPrioEditModal(item, slot, autoGenerate, difficulty) {
  var diff = (difficulty || 'heroic').toLowerCase();
  var diffCap = diff === 'mythic' ? 'Mythic' : 'Heroic';
  var entry = (DATA.priorityOrder || {})[item] || {};
  PRIO_EDIT.item = item;
  PRIO_EDIT.slot = slot;
  PRIO_EDIT.difficulty = diffCap;
  PRIO_EDIT.ranked = (entry[diff] || []).slice();
  PRIO_EDIT.showAllRoster = false;
  PRIO_EDIT.dragSrcIdx = -1;
  PRIO_EDIT.scores = {};

  document.getElementById('prioEditTitle').textContent = item;
  var slotEl = document.getElementById('prioEditSlot');
  slotEl.textContent = slot;
  slotEl.style.color = slot ? getSlotColor(slot) : '';
  document.getElementById('prioEditError').style.display = 'none';
  document.getElementById('prioEditVersionWarning').style.display = 'none';
  document.getElementById('prioEditStatus').textContent = '';
  document.getElementById('prioEditShowAllBtn').textContent = 'Show all roster';
  document.getElementById('prioEditPoolLabel').textContent = 'BiS Players';

  prioEditSetDiffToggle(diff);
  prioEditRenderList();
  prioEditRenderPool();
  document.getElementById('prioEditModal').classList.add('active');

  if (autoGenerate) prioEditGenerate();
}

function prioEditSetDiffToggle(diff) {
  var heroicBtn = document.getElementById('prioEditDiffHeroic');
  var mythicBtn = document.getElementById('prioEditDiffMythic');
  if (heroicBtn) heroicBtn.classList.toggle('active', diff === 'heroic');
  if (mythicBtn) mythicBtn.classList.toggle('active', diff === 'mythic');
}

function prioEditSwitchDiff(diff) {
  var diffCap = diff === 'mythic' ? 'Mythic' : 'Heroic';
  PRIO_EDIT.difficulty = diffCap;
  var entry = (DATA.priorityOrder || {})[PRIO_EDIT.item] || {};
  PRIO_EDIT.ranked = (entry[diff] || []).slice();
  PRIO_EDIT.scores = {};
  PRIO_EDIT.showAllRoster = false;
  document.getElementById('prioEditShowAllBtn').textContent = 'Show all roster';
  document.getElementById('prioEditPoolLabel').textContent = 'BiS Players';
  document.getElementById('prioEditStatus').textContent = '';
  document.getElementById('prioEditError').style.display = 'none';
  document.getElementById('prioEditVersionWarning').style.display = 'none';
  prioEditSetDiffToggle(diff);
  prioEditRenderList();
  prioEditRenderPool();
}

function closePrioEditModal() {
  document.getElementById('prioEditModal').classList.remove('active');
}

function prioEditGetBisPlayers() {
  var bisList = DATA.bisList || {};
  var itemLower = PRIO_EDIT.item.toLowerCase();
  var result = [];
  Object.keys(bisList).forEach(function (firstName) {
    var items = bisList[firstName] || [];
    for (var i = 0; i < items.length; i++) {
      if ((items[i].item || '').toLowerCase() === itemLower) {
        result.push(firstName);
        break;
      }
    }
  });
  return result;
}

function prioEditUpdateVersionWarning() {
  var el = document.getElementById('prioEditVersionWarning');
  if (!el) return;
  var scores = PRIO_EDIT.scores || {};
  var ranked = PRIO_EDIT.ranked;
  var seenHasHeroic = false;
  var warn = false;
  for (var i = 0; i < ranked.length; i++) {
    var s = scores[ranked[i]];
    var label = s ? s.statusLabel || '' : '';
    if (label.indexOf('Has Heroic') !== -1) {
      seenHasHeroic = true;
    }
    if (seenHasHeroic && label.indexOf('No Version') !== -1) {
      warn = true;
      break;
    }
  }
  el.style.display = warn ? '' : 'none';
}

function prioEditRenderList() {
  var list = document.getElementById('prioEditList');
  var ranked = PRIO_EDIT.ranked;
  var roster = DATA.roster || [];
  var rosterMap = {};
  roster.forEach(function (p) {
    rosterMap[normalise(p.firstName)] = p;
  });

  document.getElementById('prioEditCount').textContent = ranked.length ? '(' + ranked.length + ')' : '';

  if (!ranked.length) {
    list.innerHTML = '<div class="prio-drag-list-empty">No players ranked yet. Add from the right.</div>';
    return;
  }

  var html = '';
  for (var i = 0; i < ranked.length; i++) {
    var firstName = ranked[i];
    var player = rosterMap[normalise(firstName)];
    var display = player ? player.nick || player.firstName : firstName;
    var role = player ? player.role : '';
    var roleColor = getRoleColor(role);
    html +=
      '<div class="prio-drag-item" draggable="true"' +
      ' data-idx="' +
      i +
      '"' +
      ' ondragstart="prioEditDragStart(event,' +
      i +
      ')"' +
      ' ondragover="prioEditDragOver(event,' +
      i +
      ')"' +
      ' ondrop="prioEditDrop(event,' +
      i +
      ')"' +
      ' ondragend="prioEditDragEnd(event)"' +
      '>';
    html += '<span class="prio-drag-handle">&#8942;&#8942;</span>';
    html += '<span class="prio-drag-rank">' + (i + 1) + '</span>';
    html += '<span class="prio-drag-name" style="color:' + roleColor + ';">' + display + '</span>';
    if (role) html += '<span class="prio-role-badge prio-role-' + role + '">' + role.toUpperCase() + '</span>';
    var scoreData = PRIO_EDIT.scores && PRIO_EDIT.scores[firstName];
    if (scoreData) {
      if (scoreData.weightedTotal !== null && scoreData.weightedTotal !== undefined) {
        html +=
          '<span style="font-size:0.78rem;color:var(--text-muted);margin-left:4px;">Score: ' +
          scoreData.weightedTotal +
          '</span>';
      }
      if (scoreData.statusLabel) {
        html +=
          '<span style="font-size:0.75rem;color:var(--text-muted);font-style:italic;margin-left:2px;">(' +
          scoreData.statusLabel +
          ')</span>';
      }
    }
    html += '<button class="prio-drag-remove" onclick="prioEditRemove(' + i + ')" title="Remove">&times;</button>';
    html += '</div>';
  }
  list.innerHTML = html;
  prioEditUpdateVersionWarning();
}

function prioEditRenderPool() {
  var pool = document.getElementById('prioEditPool');
  var ranked = PRIO_EDIT.ranked;
  var roster = DATA.roster || [];
  var rosterMap = {};
  roster.forEach(function (p) {
    rosterMap[normalise(p.firstName)] = p;
  });

  var rankedSet = {};
  ranked.forEach(function (n) {
    rankedSet[normalise(n)] = true;
  });

  var candidates;
  if (PRIO_EDIT.showAllRoster) {
    candidates = roster.map(function (p) {
      return p.firstName;
    });
  } else {
    candidates = prioEditGetBisPlayers();
  }

  var isMythic = PRIO_EDIT.difficulty === 'Mythic';
  var lootCounts = DATA.lootCounts || {};
  var itemLower = PRIO_EDIT.item.toLowerCase();

  var available = candidates.filter(function (n) {
    return !rankedSet[normalise(n)];
  });
  available.sort(function (a, b) {
    return a.localeCompare(b);
  });

  if (!available.length) {
    pool.innerHTML =
      '<div style="font-size:0.82rem;color:var(--text-muted);font-style:italic;padding:0.3rem 0;">All ' +
      (PRIO_EDIT.showAllRoster ? 'roster' : 'BiS') +
      ' players added.</div>';
    return;
  }

  var html = '';
  for (var i = 0; i < available.length; i++) {
    var firstName = available[i];
    var player = rosterMap[normalise(firstName)];
    var display = player ? player.nick || player.firstName : firstName;
    var role = player ? player.role : '';
    var nEnc = encodeURIComponent(firstName);
    var hasHeroic = false;
    if (isMythic) {
      var loot = lootCounts[firstName.toLowerCase()] || null;
      if (loot && loot.items) {
        for (var j = 0; j < loot.items.length; j++) {
          if (loot.items[j].name.toLowerCase() === itemLower && loot.items[j].difficulty === 'Heroic') {
            hasHeroic = true;
            break;
          }
        }
      }
    }
    html += '<div class="prio-pool-item" onclick="prioEditAdd(decodeURIComponent(\'' + nEnc + '\'))">';
    html += '<span class="prio-pool-name">' + display + '</span>';
    if (role) html += '<span class="prio-role-badge prio-role-' + role + '">' + role.toUpperCase() + '</span>';
    if (hasHeroic) html += '<span class="prio-diff-badge prio-diff-heroic" title="Has Heroic version">H</span>';
    html += '<span class="prio-pool-add">+</span>';
    html += '</div>';
  }
  pool.innerHTML = html;
}

function prioEditAdd(firstName) {
  if (PRIO_EDIT.ranked.length >= 10) {
    document.getElementById('prioEditStatus').textContent = 'Maximum 10 players per item.';
    return;
  }
  if (PRIO_EDIT.ranked.indexOf(firstName) === -1) {
    PRIO_EDIT.ranked.push(firstName);
    document.getElementById('prioEditStatus').textContent = '';
    prioEditRenderList();
    prioEditRenderPool();
  }
}

function prioEditRemove(idx) {
  PRIO_EDIT.ranked.splice(idx, 1);
  document.getElementById('prioEditStatus').textContent = '';
  prioEditRenderList();
  prioEditRenderPool();
}

function prioEditToggleAllRoster() {
  PRIO_EDIT.showAllRoster = !PRIO_EDIT.showAllRoster;
  document.getElementById('prioEditShowAllBtn').textContent = PRIO_EDIT.showAllRoster
    ? 'Show BiS only'
    : 'Show all roster';
  document.getElementById('prioEditPoolLabel').textContent = PRIO_EDIT.showAllRoster ? 'All Roster' : 'BiS Players';
  prioEditRenderPool();
}

// -- Drag-and-drop --

function prioEditDragStart(e, idx) {
  PRIO_EDIT.dragSrcIdx = idx;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function prioEditDragOver(e, idx) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  var items = document.querySelectorAll('#prioEditList .prio-drag-item');
  items.forEach(function (el) {
    el.classList.remove('drag-over');
  });
  if (idx !== PRIO_EDIT.dragSrcIdx) e.currentTarget.classList.add('drag-over');
}

function prioEditDrop(e, toIdx) {
  e.preventDefault();
  var fromIdx = PRIO_EDIT.dragSrcIdx;
  if (fromIdx === toIdx || fromIdx < 0) return;
  var moved = PRIO_EDIT.ranked.splice(fromIdx, 1)[0];
  PRIO_EDIT.ranked.splice(toIdx, 0, moved);
  PRIO_EDIT.dragSrcIdx = -1;
  prioEditRenderList();
}

function prioEditDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('#prioEditList .prio-drag-item').forEach(function (el) {
    el.classList.remove('drag-over');
  });
  PRIO_EDIT.dragSrcIdx = -1;
}

// -- Generate suggested order --

function prioEditGenerate() {
  var btn = document.getElementById('prioEditGenBtn');
  var status = document.getElementById('prioEditStatus');
  btn.disabled = true;
  btn.textContent = 'Generating...';
  status.textContent = '';

  var itemId = (DATA.itemIds || {})[PRIO_EDIT.item];
  var track = PRIO_EDIT.difficulty === 'Mythic' ? 'Myth' : 'Hero';
  var season = window.DATA && DATA.seasonName ? DATA.seasonName.trim() : '';

  if (!itemId) {
    btn.disabled = false;
    btn.textContent = 'Suggest Order';
    status.textContent = 'Item not found in catalog.';
    return;
  }

  supabaseClient
    .rpc('generate_priority_order', {
      p_team_id: _teamCfg.supabaseTeamId,
      p_season: season,
      p_item_id: itemId,
      p_track: track
    })
    .then(function (result) {
      btn.disabled = false;
      btn.textContent = 'Suggest Order';
      if (result.error) throw new Error(result.error.message);
      var rows = result.data || [];
      if (!rows.length) {
        status.textContent = 'No BiS players found for this item.';
        return;
      }
      var rosterById = {};
      (DATA.roster || []).forEach(function (p) {
        rosterById[p.id] = p;
      });
      var scoreMap = {};
      var ranked = [];
      rows.forEach(function (r) {
        var player = rosterById[r.player_id];
        var firstName = player ? player.firstName : (r.name_realm || '').split('-')[0].trim();
        scoreMap[firstName] = {
          firstName: firstName,
          weightedTotal: r.weighted_total,
          role: r.role,
          statusLabel: r.status_label || ''
        };
        ranked.push(firstName);
      });
      PRIO_EDIT.scores = scoreMap;
      PRIO_EDIT.ranked = ranked;
      status.textContent = 'Suggested order loaded. Review and adjust as needed.';
      prioEditRenderList();
      prioEditRenderPool();
    })
    .catch(function (err) {
      btn.disabled = false;
      btn.textContent = 'Suggest Order';
      status.textContent = err.message;
    });
}

// -- Save --

function prioEditSave() {
  var saveBtn = document.getElementById('prioEditSaveBtn');
  var status = document.getElementById('prioEditStatus');
  var errEl = document.getElementById('prioEditError');
  errEl.style.display = 'none';

  var itemId = (DATA.itemIds || {})[PRIO_EDIT.item];
  if (!itemId) {
    errEl.textContent = 'Item not found in catalog.';
    errEl.style.display = '';
    return;
  }

  var rosterMap = {};
  (DATA.roster || []).forEach(function (p) {
    rosterMap[normalise(p.firstName)] = p;
  });
  var playerIds = [];
  for (var i = 0; i < PRIO_EDIT.ranked.length; i++) {
    var player = rosterMap[normalise(PRIO_EDIT.ranked[i])];
    if (!player || !player.id) {
      errEl.textContent = 'Unknown roster player: ' + PRIO_EDIT.ranked[i];
      errEl.style.display = '';
      return;
    }
    playerIds.push(player.id);
  }

  var track = PRIO_EDIT.difficulty === 'Mythic' ? 'Myth' : 'Hero';
  var season = window.DATA && DATA.seasonName ? DATA.seasonName.trim() : '';

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';
  status.textContent = '';

  supabaseClient
    .rpc('save_priority_order', {
      p_team_id: _teamCfg.supabaseTeamId,
      p_season: season,
      p_item_id: itemId,
      p_track: track,
      p_player_ids: playerIds
    })
    .then(function (result) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Priority';
      if (result.error) throw new Error(result.error.message);
      DATA.priorityOrder = DATA.priorityOrder || {};
      if (!DATA.priorityOrder[PRIO_EDIT.item]) DATA.priorityOrder[PRIO_EDIT.item] = {};
      DATA.priorityOrder[PRIO_EDIT.item][PRIO_EDIT.difficulty.toLowerCase()] = PRIO_EDIT.ranked.slice();
      buildPriorityTab();
      buildUnmanagedTab();
      updateUnmanagedBadge();
      closePrioEditModal();
    })
    .catch(function (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Priority';
      errEl.textContent = err.message;
      errEl.style.display = '';
    });
}

function getRoleColor(role) {
  if (role === 'Tank') return 'var(--tank)';
  if (role === 'Heal') return 'var(--heal)';
  if (role === 'Ranged') return 'var(--ranged)';
  if (role === 'Melee') return 'var(--melee)';
  return 'var(--text)';
}
