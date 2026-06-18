var ARMOR_SLOT_ORDER = ['HEAD','SHOULDERS','CHEST','GLOVES','LEGS','CLOAK','BRACERS','BELT','BOOTS'];

function getUnmanagedItems() {
  var prioOrder = DATA.priorityOrder || {};
  var itemSlots = DATA.itemSlots     || {};
  var seen = {};
  var result = [];
  Object.keys(prioOrder).forEach(function(item) {
    if ((itemSlots[item] || '').toLowerCase() === 'slot') return;
    if (!prioOrder[item] || prioOrder[item].length === 0) { seen[item] = true; result.push(item); }
  });
  Object.keys(itemSlots).forEach(function(item) {
    if (seen[item]) return;
    if ((itemSlots[item] || '').toLowerCase() === 'slot') return;
    if (!prioOrder[item] || prioOrder[item].length === 0) result.push(item);
  });
  return result.sort(function(a, b) { return a.localeCompare(b); });
}

function updateUnmanagedBadge() {
  var count    = getUnmanagedItems().length;
  var navBadge = document.getElementById('prioNavBadge');
  var subBadge = document.getElementById('prioSubBadge');
  if (navBadge) { navBadge.textContent = count; navBadge.style.display = count > 0 ? '' : 'none'; }
  if (subBadge) { subBadge.textContent = count; subBadge.style.display = count > 0 ? '' : 'none'; }
}

function buildUnmanagedTab() {
  var itemSlots = DATA.itemSlots || {};
  var items     = getUnmanagedItems();
  var el        = document.getElementById('unmanagedContent');
  if (!el) return;
  if (!items.length) {
    el.innerHTML = '<p style="color:var(--heal);padding:1rem;">All items have at least one player ranked.</p>';
    return;
  }
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
  var GROUP_ORDER  = ['Trinket', 'Armor', 'Weapon', 'Jewelry', 'Other'];
  var GROUP_LABELS = { Trinket: 'Trinkets', Armor: 'Armor', Weapon: 'Weapons', Jewelry: 'Jewelry', Other: 'Other' };
  var html  = '<p style="font-size:0.88rem;color:var(--text-muted);margin-bottom:1rem;">' + items.length + ' item' + (items.length === 1 ? '' : 's') + ' with no players ranked yet.</p>';
  var secId = 0;
  for (var g = 0; g < GROUP_ORDER.length; g++) {
    var groupKey = GROUP_ORDER[g];
    var gid = 'unmanaged-sec-' + (secId++);
    if (groupKey === 'Armor') {
      var hasArmor = false;
      for (var si = 0; si < ARMOR_SLOT_ORDER.length; si++) {
        if (groups.Armor[ARMOR_SLOT_ORDER[si]] && groups.Armor[ARMOR_SLOT_ORDER[si]].length) { hasArmor = true; break; }
      }
      if (!hasArmor) continue;
      html += '<div class="prio-section-header prio-collapsible" onclick="togglePrioSection(\'' + gid + '\')">' + GROUP_LABELS.Armor + '<span class="prio-chevron">-</span></div>';
      html += '<div id="' + gid + '">';
      for (var si = 0; si < ARMOR_SLOT_ORDER.length; si++) {
        var slotKey   = ARMOR_SLOT_ORDER[si];
        var slotItems = groups.Armor[slotKey];
        if (!slotItems || !slotItems.length) continue;
        var sid = 'unmanaged-sec-' + (secId++);
        html += '<div class="prio-sub-header prio-collapsible" style="color:' + getSlotColor(slotKey) + ';" onclick="togglePrioSection(\'' + sid + '\')">' + slotKey.charAt(0) + slotKey.slice(1).toLowerCase() + '<span class="prio-chevron">-</span></div>';
        html += '<div id="' + sid + '">';
        for (var k = 0; k < slotItems.length; k++) html += renderUnmanagedItem(slotItems[k], itemSlots[slotItems[k]]);
        html += '</div>';
      }
      html += '</div>';
    } else {
      if (!groups[groupKey].length) continue;
      html += '<div class="prio-section-header prio-collapsible" onclick="togglePrioSection(\'' + gid + '\')">' + GROUP_LABELS[groupKey] + '<span class="prio-chevron">-</span></div>';
      html += '<div id="' + gid + '">';
      for (var k = 0; k < groups[groupKey].length; k++) html += renderUnmanagedItem(groups[groupKey][k], itemSlots[groups[groupKey][k]]);
      html += '</div>';
    }
  }
  el.innerHTML = html;
}

function renderUnmanagedItem(item, slot) {
  var out = '<div class="prio-item">';
  out += '<div class="prio-item-header">';
  out += '<span class="prio-item-name">' + item + '</span>';
  if (slot) out += '<span class="prio-item-slot" style="color:' + getSlotColor(slot) + ';">' + slot + '</span>';
  out += '<span class="prio-item-count" style="color:#c0392b;">No rankings</span>';
  out += '</div></div>';
  return out;
}

function togglePrioSection(id) {
  var el      = document.getElementById(id);
  var chevron = event.currentTarget.querySelector('.prio-chevron');
  var collapsed = el.style.display === 'none';
  el.style.display = collapsed ? '' : 'none';
  if (chevron) chevron.textContent = collapsed ? '-' : '+';
}

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

  var GROUP_ORDER  = ['Trinket', 'Armor', 'Weapon', 'Jewelry', 'Other'];
  var GROUP_LABELS = { Trinket: 'Trinkets', Armor: 'Armor', Weapon: 'Weapons', Jewelry: 'Jewelry', Other: 'Other' };

  var html  = '';
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
        var slotKey   = ARMOR_SLOT_ORDER[si];
        var slotItems = groups.Armor[slotKey];
        if (!slotItems || !slotItems.length) continue;
        var sid = 'prio-sec-' + (secId++);
        html += '<div class="prio-sub-header prio-collapsible" style="color:' + getSlotColor(slotKey) + ';" onclick="togglePrioSection(\'' + sid + '\')">' + slotKey.charAt(0) + slotKey.slice(1).toLowerCase() + '<span class="prio-chevron">-</span></div>';
        html += '<div id="' + sid + '">';
        for (var k = 0; k < slotItems.length; k++) html += renderItem(slotItems[k]);
        html += '</div>';
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
