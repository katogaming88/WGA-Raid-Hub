function buildConflicts() {
  var bisList   = DATA.bisList || {};
  var prioOrder = DATA.priorityOrder || {};
  var itemMap   = {};

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
    if (slot) html += '<span style="font-size:0.97rem;color:'+getSlotColor(slot)+';text-transform:uppercase;letter-spacing:0.08em;">'+slot+'</span>';
    html += '<span class="conflict-count">'+players.length+' player'+(players.length!==1?'s':'')+'</span>';
    html += '</div>';
    html += '<div class="conflict-players">';
    for (var j = 0; j < players.length; j++) {
      var pName   = players[j];
      var pData   = null;
      for (var k = 0; k < DATA.roster.length; k++) { if (normalise(DATA.roster[k].firstName)===normalise(pName)) { pData=DATA.roster[k]; break; } }
      var display = pData ? (pData.nick || pData.firstName) : pName;
      var rankPos = ranked.findIndex ? ranked.findIndex(function(r) { return normalise(r)===normalise(pName); }) : -1;
      var isRanked = rankPos >= 0;
      var lootEntry = getLootEntry(pName);
      var received = false, receivedDiff = '';
      if (lootEntry && lootEntry.items) {
        for (var m = 0; m < lootEntry.items.length; m++) {
          var itemObj  = lootEntry.items[m];
          var iName    = typeof itemObj === 'string' ? itemObj : itemObj.name;
          if (normalise(iName) === normalise(item)) {
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
