function buildConflicts() {
  var bisList   = DATA.bisList        || {};
  var prioOrder = DATA.priorityOrder  || {};
  var itemMap   = {};

  var playerKeys = Object.keys(bisList);
  for (var i = 0; i < playerKeys.length; i++) {
    var firstName = playerKeys[i];
    var items = bisList[firstName];
    for (var j = 0; j < items.length; j++) {
      var itemName = typeof items[j] === 'string' ? items[j] : items[j].item;
      if (itemName === 'M+' || itemName === 'Crafted' || itemName === 'Catalyst') continue;
      if (!itemMap[itemName]) itemMap[itemName] = [];
      itemMap[itemName].push(firstName);
    }
  }

  // Build over-allocation map: players who hold rank 1 on 2+ item/difficulty combos.
  // Keys are normalised first names for reliable case-insensitive matching.
  var overAllocMap = {}; // normKey -> { rawName: string, assignments: [{item, diff}] }
  Object.keys(prioOrder).forEach(function(iName) {
    var iEntry = prioOrder[iName] || {};
    ['heroic', 'mythic'].forEach(function(diff) {
      var ranked = iEntry[diff] || [];
      if (ranked.length > 0 && ranked[0]) {
        var raw = ranked[0];
        var key = normalise(raw);
        if (!overAllocMap[key]) overAllocMap[key] = { rawName: raw, assignments: [] };
        overAllocMap[key].assignments.push({ item: iName, diff: diff });
      }
    });
  });

  var overAllocSet = {}; // normKey -> true, only players with 2+ assignments
  Object.keys(overAllocMap).forEach(function(key) {
    if (overAllocMap[key].assignments.length >= 2) overAllocSet[key] = true;
  });

  var sorted = Object.keys(itemMap).sort(function(a, b) { return itemMap[b].length - itemMap[a].length; });

  var html = '<div style="display:flex;align-items:center;margin-bottom:0.75rem;">' +
    '<span class="section-label" style="margin-bottom:0;">Contested Items' +
    '<button class="help-btn" onclick="toggleHelp(\'help-loot-conflicts\')" title="Show help">?</button>' +
    '</span></div>' +
    '<div id="help-loot-conflicts" class="help-tip" style="margin-top:0;margin-bottom:0.75rem;">' +
    'Items that appear in two or more players\' BiS lists, sorted by how many players want them.<br>' +
    'Each card shows the players who want the item and their current priority rank (if assigned).' +
    ' Ranks show H (Heroic) or M (Mythic). Players tagged <strong>!</strong> hold 1st priority on multiple items.' +
    ' Items with no priority set also appear in <strong>Unmanaged Items</strong> on the Priority tab.' +
    '</div>';

  // Over-allocation banner
  var overAllocKeys = Object.keys(overAllocSet).sort();
  if (overAllocKeys.length > 0) {
    html += '<div class="prio-overalloc-banner">';
    html += '<div class="prio-overalloc-title">Priority Over-Allocation (' +
      overAllocKeys.length + ' player' + (overAllocKeys.length !== 1 ? 's' : '') + ')</div>';
    html += '<div class="prio-overalloc-list">';
    overAllocKeys.forEach(function(key) {
      var oa = overAllocMap[key];
      var pData = null;
      for (var k = 0; k < DATA.roster.length; k++) {
        if (normalise(DATA.roster[k].firstName) === key) { pData = DATA.roster[k]; break; }
      }
      var display = pData ? (pData.nick || pData.firstName) : oa.rawName;
      var itemTags = oa.assignments.map(function(a) {
        return '<span class="prio-overalloc-item">' + a.item +
          ' <span class="prio-overalloc-diff">' + a.diff + '</span></span>';
      }).join('');
      html += '<div class="prio-overalloc-player">' +
        '<span class="prio-overalloc-name">' + display + '</span>' + itemTags + '</div>';
    });
    html += '</div></div>';
  }

  for (var i = 0; i < sorted.length; i++) {
    var item    = sorted[i];
    var players = itemMap[item];
    var slot    = (DATA.itemSlots || {})[item] || '';
    var iEntry  = prioOrder[item] || {};

    // Build rank lookup for this item: normKey -> [{diff, pos}]
    var rankInfo = {};
    ['heroic', 'mythic'].forEach(function(diff) {
      var ranked = iEntry[diff] || [];
      ranked.forEach(function(r, idx) {
        var key = normalise(r);
        if (!rankInfo[key]) rankInfo[key] = [];
        rankInfo[key].push({ diff: diff, pos: idx });
      });
    });

    html += '<div class="conflict-item">';
    html += '<div class="conflict-item-name">';
    html += '<span>' + item + '</span>';
    if (slot) html += '<span style="font-size:0.97rem;color:' + getSlotColor(slot) + ';text-transform:uppercase;letter-spacing:0.08em;">' + slot + '</span>';
    html += '<span class="conflict-count">' + players.length + ' player' + (players.length !== 1 ? 's' : '') + '</span>';
    html += '</div>';
    html += '<div class="conflict-players">';

    for (var j = 0; j < players.length; j++) {
      var pName = players[j];
      var pKey  = normalise(pName);
      var pData = null;
      for (var k = 0; k < DATA.roster.length; k++) {
        if (normalise(DATA.roster[k].firstName) === pKey) { pData = DATA.roster[k]; break; }
      }
      var display = pData ? (pData.nick || pData.firstName) : pName;

      var info        = rankInfo[pKey] || [];
      var isRanked    = info.length > 0;
      var isFirstPrio = info.some(function(x) { return x.pos === 0; });
      var isOverAlloc = overAllocSet[pKey] || false;

      var seasonItems = getSeasonLootItems(pName);
      var received = false, receivedDiff = '';
      for (var m = 0; m < seasonItems.length; m++) {
        var itemObj = seasonItems[m];
        var iName   = typeof itemObj === 'string' ? itemObj : itemObj.name;
        if (normalise(iName) === normalise(item)) {
          received     = true;
          receivedDiff = typeof itemObj === 'object' ? itemObj.difficulty : '';
          break;
        }
      }

      var rankLabel = '';
      if (info.length > 0) {
        var parts = info.map(function(x) { return '#' + (x.pos + 1) + (x.diff === 'mythic' ? 'M' : 'H'); });
        rankLabel = ' ' + parts.join('/');
      }

      var badge = received
        ? ' <span class="received-badge">Received' + (receivedDiff ? ' (' + receivedDiff + ')' : '') + '</span>'
        : '';
      var overAllocBadge = (isOverAlloc && isFirstPrio && !received)
        ? ' <span class="overalloc-badge">!</span>'
        : '';

      var classes = 'conflict-player-tag' +
        (isRanked    ? ' ranked'         : '') +
        (received    ? ' received'       : '') +
        (isOverAlloc && isFirstPrio ? ' over-allocated' : '');

      html += '<span class="' + classes + '">' + display + rankLabel + overAllocBadge + badge + '</span>';
    }

    html += '</div></div>';
  }

  if (sorted.length === 0) html += '<p style="color:var(--text);padding:1rem;">No BiS data found.</p>';
  document.getElementById('conflictsContent').innerHTML = html;
}
