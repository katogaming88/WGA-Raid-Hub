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

  saveTeamSetting({ bisSubmissionsOpen: open }, true).then(
    function () {
      if (btn) btn.disabled = false;
      if (DATA) DATA.bisSubmissionsOpen = open;
      writeAuditLog(open ? 'BiS Submissions Opened' : 'BiS Submissions Closed', null, null, null);
      renderBisToggle();
    },
    function () {
      if (btn) btn.disabled = false;
      renderBisToggle();
    }
  );
}

// Distinct from the 'bis' feature flag (whole tab hidden vs. just editing
// paused) and from bisSubmissionsOpen (that gates the BiS Source submit form,
// this gates the wishlist's own status buttons/notes) -- same toggle shape
// as both, just its own team_settings.config key.
function renderWishlistToggle() {
  var badge = document.getElementById('wishlistStatusBadge');
  var btn = document.getElementById('wishlistToggleBtn');
  if (!badge || !btn) return;
  var open = wishlistOpen();
  badge.textContent = open ? 'OPEN' : 'CLOSED';
  badge.className = 'signup-status-badge ' + (open ? 'signup-status-open' : 'signup-status-closed');
  btn.textContent = open ? 'Close Wishlist Editing' : 'Open Wishlist Editing';
}

function toggleWishlistOpen() {
  setWishlistOpen(!wishlistOpen());
}

function setWishlistOpen(open) {
  var btn = document.getElementById('wishlistToggleBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  saveTeamSetting({ wishlistOpen: open }, true).then(
    function () {
      if (btn) btn.disabled = false;
      if (DATA) DATA.wishlistOpen = open;
      writeAuditLog(open ? 'Wishlist Editing Opened' : 'Wishlist Editing Closed', null, null, null);
      renderWishlistToggle();
    },
    function () {
      if (btn) btn.disabled = false;
      renderWishlistToggle();
    }
  );
}

function buildBisTab() {
  var container = document.getElementById('bisContainer');
  if (!container) return;
  container.innerHTML =
    '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">Loading submissions...</p>';

  if (!supabaseClient) {
    container.innerHTML =
      '<p style="color:var(--melee);font-size:1rem;margin-top:1.5rem;">Not connected to Supabase.</p>';
    return;
  }

  // team-read-guard: the pending queue only, drained by officers.
  supabaseClient
    .from('bis_requests')
    .select('id, bis_link, player_note, submitted_at, players(name_realm)')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .eq('status', 'pending')
    .order('submitted_at', { ascending: false })
    .then(function (result) {
      if (result.error) {
        var c = document.getElementById('bisContainer');
        if (c)
          c.innerHTML =
            '<p style="color:var(--melee);font-size:1rem;margin-top:1.5rem;">' + result.error.message + '</p>';
        return;
      }
      var submissions = (result.data || []).map(function (row) {
        var nameRealm = (row.players && row.players.name_realm) || '';
        var bisLink = row.bis_link || '';
        var rosterPlayer = findRosterPlayerByNameRealm(nameRealm);
        return {
          id: row.id,
          nameRealm: nameRealm,
          bisLink: bisLink,
          notes: row.player_note || '',
          timestamp: formatDateTime(row.submitted_at),
          // #278: the link on file didn't change -- this is a "recheck the
          // items behind it" flag, not a new-link submission.
          sameLink: !!(rosterPlayer && rosterPlayer.bisLink && rosterPlayer.bisLink === bisLink)
        };
      });
      renderBisSubmissions(submissions);
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
    localTimeZoneNote() +
    '<div style="margin-top:1.5rem;">' +
    '<div style="font-size:1.02rem;letter-spacing:0.16em;text-transform:uppercase;color:var(--text-muted);font-weight:600;margin-bottom:0.75rem;">' +
    submissions.length +
    ' pending submission' +
    (submissions.length !== 1 ? 's' : '') +
    '</div>';
  submissions.forEach(function (s) {
    html +=
      '<div class="request-card" data-row="' +
      s.id +
      '" data-name-realm="' +
      s.nameRealm.replace(/"/g, '&quot;') +
      '" data-bis-link="' +
      s.bisLink.replace(/"/g, '&quot;') +
      '">' +
      '<div class="request-card-header">' +
      '<span class="request-player">' +
      s.nameRealm +
      '</span>' +
      (s.sameLink
        ? '<span class="signup-status-badge signup-status-open" style="margin-left:0.5rem;">Same link -- items changed</span>'
        : '') +
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
        ? '<div style="font-size:1rem;color:var(--text);margin-top:0.6rem;padding-top:0.6rem;border-top:1px solid var(--border);">' +
          s.notes +
          '</div>'
        : '') +
      // #607: BiS approvals stay excluded for a guild-officer-only visitor.
      (window._guildOfficerAccessLevel === 'guild'
        ? ''
        : '<div style="display:flex;gap:0.5rem;margin-top:0.75rem;">' +
          '<button class="btn request-approve-btn" onclick="approveBisSubmission(' +
          s.id +
          ",'" +
          s.nameRealm.replace(/'/g, "\\'") +
          '\', this)">Approve</button>' +
          '<button class="btn request-reject-btn" onclick="rejectBisSubmission(' +
          s.id +
          ",'" +
          s.nameRealm.replace(/'/g, "\\'") +
          '\', this)">Reject</button>' +
          '</div>') +
      '</div>';
  });
  container.innerHTML = html + '</div>';
}

// Mirrors tab-mplus.js's approveMPlusExclusion: swaps the Approve/Reject
// pair for an inline optional note field before confirming, same as
// rejectBisSubmission below.
function approveBisSubmission(requestId, nameRealm, btnEl) {
  // #607: BiS link request approvals are excluded for a guild-officer-only
  // visitor -- the BiS Manager tab itself stays visible (lists/notes are
  // fine), but this approval sub-surface is not (RLS blocks the underlying
  // bis_requests write regardless).
  if (window._guildOfficerAccessLevel === 'guild') return;
  var actionsDiv = btnEl.parentNode;
  var noteId = '_bisApproveNote' + requestId;
  var nrSafe = nameRealm.replace(/'/g, "\\'");
  actionsDiv.innerHTML =
    '<div style="width:100%;">' +
    '<div style="font-size:1.04rem;color:var(--text-muted);margin-bottom:0.4rem;">Officer note (optional):</div>' +
    '<textarea id="' +
    noteId +
    '" rows="2" placeholder="e.g. Looks good, nice upgrades this tier" style="width:100%;box-sizing:border-box;background:var(--bg-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:0.4rem 0.5rem;font-size:1rem;resize:vertical;"></textarea>' +
    '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
    '<button id="_bisApproveConfirm' +
    requestId +
    '" class="btn request-approve-btn" style="font-size:1rem;padding:0.25rem 0.75rem;">Approve</button>' +
    '<button id="_bisApproveCancel' +
    requestId +
    '" class="btn btn-muted" style="font-size:1rem;padding:0.25rem 0.75rem;">Cancel</button>' +
    '</div>' +
    '</div>';

  var noteInput = document.getElementById(noteId);
  var confirmBtn = document.getElementById('_bisApproveConfirm' + requestId);
  var cancelBtn = document.getElementById('_bisApproveCancel' + requestId);

  if (cancelBtn) {
    cancelBtn.addEventListener('click', function () {
      actionsDiv.innerHTML =
        '<button class="btn request-approve-btn" onclick="approveBisSubmission(' +
        requestId +
        ",'" +
        nrSafe +
        '\', this)">Approve</button>' +
        '<button class="btn request-reject-btn" onclick="rejectBisSubmission(' +
        requestId +
        ",'" +
        nrSafe +
        '\', this)">Reject</button>';
    });
  }

  if (confirmBtn) {
    confirmBtn.addEventListener('click', function () {
      var note = noteInput ? noteInput.value.trim() : '';
      confirmApproveBisSubmission(requestId, nameRealm, note, confirmBtn);
    });
  }
}

// Writes both bis_requests.status and players.bis_link -- two separate
// officer-writable tables, no RPC needed (mirrors the direct-write pattern
// tab-roster.js already uses). Not atomic, but a failure between the two
// calls just leaves the request pending for a retry -- no partial state an
// officer could act on incorrectly.
function confirmApproveBisSubmission(requestId, nameRealm, note, btnEl) {
  var card = document.querySelector('.request-card[data-row="' + requestId + '"]');
  var bisLink = card ? card.getAttribute('data-bis-link') : '';
  btnEl.disabled = true;
  btnEl.textContent = '...';

  supabaseClient
    .from('bis_requests')
    .update({ status: 'approved', officer_notes: note || null })
    .eq('id', requestId)
    .eq('team_id', _teamCfg.supabaseTeamId)
    .then(function (result) {
      if (result.error) {
        btnEl.disabled = false;
        btnEl.textContent = 'Approve';
        return;
      }
      var player = findRosterPlayerByNameRealm(nameRealm);
      supabaseClient
        .from('players')
        .update({ bis_link: bisLink })
        .eq('team_id', _teamCfg.supabaseTeamId)
        .eq('name_realm', nameRealm)
        .then(function (playerResult) {
          if (playerResult.error) {
            btnEl.disabled = false;
            btnEl.textContent = 'Approve';
            return;
          }
          writeAuditLog('BiS Approved', 'players', player ? player.id : null, bisLink);
          if (player) notifyPlayer(player.id, 'Your BiS list link was approved.');
          if (card) card.remove();
          checkEmptyBisSubmissions();
        });
    });
}

// Mirrors tab-mplus.js's rejectMPlusExclusion/confirmRejectMPlusExclusion:
// swaps the Approve/Reject pair for an inline note field so an officer can
// leave a reason before confirming, rather than rejecting blind.
function rejectBisSubmission(requestId, nameRealm, btnEl) {
  // #607: see approveBisSubmission above.
  if (window._guildOfficerAccessLevel === 'guild') return;
  var actionsDiv = btnEl.parentNode;
  var noteId = '_bisRejectNote' + requestId;
  var nrSafe = nameRealm.replace(/'/g, "\\'");
  actionsDiv.innerHTML =
    '<div style="width:100%;">' +
    '<div style="font-size:1.04rem;color:var(--text-muted);margin-bottom:0.4rem;">Rejection reason (optional, shown to raider):</div>' +
    '<textarea id="' +
    noteId +
    '" rows="2" placeholder="e.g. Link is broken, please resubmit" style="width:100%;box-sizing:border-box;background:var(--bg-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:0.4rem 0.5rem;font-size:1rem;resize:vertical;"></textarea>' +
    '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
    '<button id="_bisRejectConfirm' +
    requestId +
    '" class="btn btn-danger" style="font-size:1rem;padding:0.25rem 0.75rem;">Reject</button>' +
    '<button id="_bisRejectCancel' +
    requestId +
    '" class="btn btn-muted" style="font-size:1rem;padding:0.25rem 0.75rem;">Cancel</button>' +
    '</div>' +
    '</div>';

  var noteInput = document.getElementById(noteId);
  var confirmBtn = document.getElementById('_bisRejectConfirm' + requestId);
  var cancelBtn = document.getElementById('_bisRejectCancel' + requestId);

  if (cancelBtn) {
    cancelBtn.addEventListener('click', function () {
      actionsDiv.innerHTML =
        '<button class="btn request-approve-btn" onclick="approveBisSubmission(' +
        requestId +
        ', this)">Approve</button>' +
        '<button class="btn request-reject-btn" onclick="rejectBisSubmission(' +
        requestId +
        ",'" +
        nrSafe +
        '\', this)">Reject</button>';
    });
  }

  if (confirmBtn) {
    confirmBtn.addEventListener('click', function () {
      var note = noteInput ? noteInput.value.trim() : '';
      confirmRejectBisSubmission(requestId, nameRealm, note, confirmBtn);
    });
  }
}

function confirmRejectBisSubmission(requestId, nameRealm, note, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = '...';
  var card = document.querySelector('.request-card[data-row="' + requestId + '"]');

  supabaseClient
    .from('bis_requests')
    .update({ status: 'rejected', officer_notes: note || null })
    .eq('id', requestId)
    .eq('team_id', _teamCfg.supabaseTeamId)
    .then(function (result) {
      if (result.error) {
        btnEl.disabled = false;
        btnEl.textContent = 'Reject';
        return;
      }
      var player = findRosterPlayerByNameRealm(nameRealm);
      writeAuditLog('BiS Rejected', 'players', player ? player.id : null, note || null);
      if (player) {
        notifyPlayer(player.id, 'Your BiS list link was rejected.' + (note ? ' Reason: ' + note : ''));
      }
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

// ── BiS Lists sub-tab ───────────────────────────────────────────────────
//
// A per-player count of wishlist BiS tags (item_preferences, the only BiS
// source since #935) with the Incomplete Wishlists badge from
// tab-priority.js. The slot vocabulary below is shared with that file's
// completeness check.

// Every row a BiS list can have an opinion about. Finger/Trinket get two
// rows each since a player can want a different item in each -- items.slot
// itself only ever says "Finger" or "Trinket" (fetch-items.js has no notion
// of which of the two), so the tagged row is what distinguishes them.
var BIS_SLOTS = [
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

// Maps an items.slot catalog value to the BIS_SLOTS row(s) an item with that
// slot can fill. Both sides now speak the same vocabulary: items.slot holds the
// canonical Wowhead/in-game slot name, so most entries are a straight 1:1 and
// the old synonym half of this map (Boots -> Feet, Gloves -> Hands, Belt ->
// Waist, Bracers -> Wrist, Cloak -> Back, Shoulders -> Shoulder, Ring ->
// Finger) is gone with the hand-typed spreadsheet vocabulary it translated.
//
// What remains is the one mapping that is irreducible: an item's slot is a
// *type* (a ring fits either finger; a trinket either trinket slot), while a
// BIS_SLOTS row is a *position*. Only the raider's tag can say which, so
// Finger/Trinket fan out to both numbered rows.
//
// Weapons collapse to the single Weapon row: this app has never modeled 2H vs
// 1H+OH as different BiS slots. 'Held In Off-hand' is Wowhead's own name for
// the off-hand-only items (tomes, orbs) that share the Off Hand row with
// shields. Slotless catalog values -- 'Placeholder' (M+/Crafted/Catalyst) and
// 'Curio' (a class-set trade token, not equippable) -- map to no row on
// purpose: nothing about them names a gear position.
var BIS_CATALOG_SLOT_TO_ROWS = {
  Head: ['Head'],
  Neck: ['Neck'],
  Shoulder: ['Shoulder'],
  Back: ['Back'],
  Chest: ['Chest'],
  Wrist: ['Wrist'],
  Hands: ['Hands'],
  Waist: ['Waist'],
  Legs: ['Legs'],
  Feet: ['Feet'],
  Finger: ['Finger 1', 'Finger 2'],
  Trinket: ['Trinket 1', 'Trinket 2'],
  'One-Hand': ['Weapon'],
  'Two-Hand': ['Weapon'],
  Ranged: ['Weapon'],
  'Off Hand': ['Off Hand'],
  'Held In Off-hand': ['Off Hand']
};

var BIS_ARMOR_TYPES = { Plate: true, Mail: true, Leather: true, Cloth: true };
// Rows for which armor-type filtering doesn't apply -- trinkets/jewelry/
// cloaks have no armor type, and both weapon rows accept any class' gear.
// Wrist is deliberately NOT here -- bracers are real armor (Cloth/Leather/
// Mail/Plate) like Chest/Legs/etc., not jewelry -- confirmed every Wrist row
// in the catalog carries a real armor_type. Including it here was a bug: it
// showed every armor type's bracers to every class. Mirrors
// js/wishlist.js's WISHLIST_UNIVERSAL_ROWS.
var BIS_UNIVERSAL_ROWS = {
  Neck: true,
  Back: true,
  'Finger 1': true,
  'Finger 2': true,
  'Trinket 1': true,
  'Trinket 2': true,
  Weapon: true,
  'Off Hand': true
};

// Mirrors js/wishlist.js's WISHLIST_MAIN_STAT_ROWS -- Trinket/Weapon/Off Hand
// carry a main stat (Strength/Agility/Intellect) even without an armor_type;
// Neck/Back/Wrist/Finger never roll one in this expansion's itemization.
var BIS_MAIN_STAT_ROWS = { 'Trinket 1': true, 'Trinket 2': true, Weapon: true, 'Off Hand': true };

function buildBisListsTab() {
  var container = document.getElementById('bis-lists-container');
  if (!container) return;

  var roster = DATA.roster || [];
  var order = ['Tank', 'Heal', 'Melee', 'Ranged', 'Bench'];
  var labels = { Tank: 'Tanks', Heal: 'Healers', Melee: 'Melee', Ranged: 'Ranged', Bench: 'Bench' };
  var groups = { Tank: [], Heal: [], Melee: [], Ranged: [], Bench: [] };

  // Wishlist completeness (#515) -- getIncompleteWishlists() is defined in
  // tab-priority.js, loaded after this file, but that only matters for
  // parse-time references; by the time this function actually runs (a tab
  // switch, well after page load) it's available. A per-player missing-slot
  // badge here replaces the standalone "big block of missing" banner that
  // used to sit under the Wishlist Editing toggle.
  var incompleteWishlists =
    typeof getIncompleteWishlists === 'function' ? getIncompleteWishlists() : { count: 0, raiders: [] };
  var missingByNameRealm = {};
  incompleteWishlists.raiders.forEach(function (r) {
    missingByNameRealm[r.nameRealm] = r;
  });

  for (var i = 0; i < roster.length; i++) {
    var rp = roster[i];
    if (rp.isBench) groups['Bench'].push(rp);
    else if (groups[rp.role]) groups[rp.role].push(rp);
  }

  var html =
    '<table class="roster-table" style="margin-top:0.25rem;">' +
    '<thead><tr><th>Player</th><th>Class / Spec</th><th>BiS Items</th></tr></thead><tbody>';

  for (var r = 0; r < order.length; r++) {
    var role = order[r];
    var players = groups[role];
    if (!players.length) continue;
    players.sort(function (a, b) {
      return (a.nick || a.firstName).localeCompare(b.nick || b.firstName);
    });
    html += '<tr class="group-header"><td colspan="3">' + labels[role] + '</td></tr>';

    for (var j = 0; j < players.length; j++) {
      var p = players[j];
      var bisCount = mergedBisItemsForNameRealm(p.nameRealm).length;
      var roleColor =
        p.role === 'Tank'
          ? 'var(--tank)'
          : p.role === 'Heal'
            ? 'var(--heal)'
            : p.role === 'Ranged'
              ? 'var(--ranged)'
              : 'var(--melee)';
      var dispName = p.nick || p.firstName;
      var missingInfo = missingByNameRealm[p.nameRealm];
      var missingRows = missingInfo && missingInfo.missingRows;
      var missingCounts = (missingInfo && missingInfo.missingCounts) || {};
      var missingTotal = missingRows
        ? missingRows.reduce(function (sum, row) {
            return sum + (missingCounts[row] || 0);
          }, 0)
        : 0;

      html +=
        '<tr id="bis-player-row-' +
        p.nameRealm +
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
          ? '<span style="font-size:1.02rem;color:var(--text-muted);">(' + p.firstName + ')</span>'
          : '') +
        (missingRows
          ? '<span style="font-size:0.85em;color:var(--melee);cursor:default;" title="Wishlist missing: ' +
            missingRows
              .map(function (row) {
                return row + ' (' + missingCounts[row] + ')';
              })
              .join(', ')
              .replace(/"/g, '&quot;') +
            '">Wishlist incomplete (' +
            missingTotal +
            ')</span>'
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
        '</tr>';
    }
  }

  html += '</tbody></table>';
  container.innerHTML = html;
}

// Own copy of js/wishlist.js's wishlistBucketRealItems() -- officer.html and
// index.html are separate script bundles (see js/wishlist.js's file-header
// comment), so this can't be shared directly. Buckets every real
// (non-placeholder), in-season-scope catalog item into its BIS_SLOTS row(s),
// scoped to the given player's armor type/main stat/role/class. Used by
// tab-priority.js's item-level wishlist completeness check (#515
// follow-up), which needs every eligible item per row.
function bisEligibleRealItemsBySlot(playerArmorType, playerMainStat, playerRole, playerClass) {
  var itemSlots = DATA.itemSlots || {};
  var itemArmorTypes = DATA.itemArmorTypes || {};
  var itemMainStats = DATA.itemMainStats || {};
  var itemWeaponSubtypes = DATA.itemWeaponSubtypes || {};
  var itemPlaceholders = DATA.itemPlaceholders || {};
  var tierTokenMap = DATA.tierTokenMap || {};
  var tierResolvedItemNames = DATA.tierResolvedItemNames || {};

  var buckets = {};
  BIS_SLOTS.forEach(function (s) {
    buckets[s] = [];
  });

  Object.keys(itemSlots).forEach(function (name) {
    // Resolved tier items are only ever reachable by their token's
    // substitution below -- listing them here too would show the same class
    // piece twice (same as js/wishlist.js's wishlistBucketRealItems).
    if (tierResolvedItemNames[name]) return;
    if (itemPlaceholders[name]) return;
    if (!isItemInSeasonScope(name)) return;

    var catalogSlot = itemSlots[name] || '';
    var rows = (BIS_CATALOG_SLOT_TO_ROWS[catalogSlot] || []).slice();
    // Dual-wield classes (DUAL_WIELD_CLASSES, js/common.js) get an extra
    // carve-out: a 'One-Hand' item is also a valid Off Hand row candidate,
    // mirroring js/wishlist.js's wishlistBucketRealItems fan-out.
    if (catalogSlot === 'One-Hand' && playerClass && DUAL_WIELD_CLASSES[playerClass]) {
      rows.push('Off Hand');
    }

    var armorType = itemArmorTypes[name] || '';
    var mainStats = itemMainStats[name] || [];
    var weaponSubtype = itemWeaponSubtypes[name] || '';

    rows.forEach(function (row) {
      if (playerArmorType && BIS_ARMOR_TYPES[armorType] && !BIS_UNIVERSAL_ROWS[row] && armorType !== playerArmorType)
        return;
      if (playerMainStat && BIS_MAIN_STAT_ROWS[row] && mainStats.length && mainStats.indexOf(playerMainStat) === -1)
        return;
      // #636: mirrors js/wishlist.js's HEALER_ONLY_TRINKETS/TANK_ONLY_TRINKETS
      // check -- a role-restricted trinket's effect is useless outside that
      // role even when its stats match. playerRole gate matches every other
      // filter above: an unknown role shows everything rather than guessing.
      if (playerRole && (row === 'Trinket 1' || row === 'Trinket 2')) {
        if (HEALER_ONLY_TRINKETS[name] && playerRole !== 'Heal') return;
        if (TANK_ONLY_TRINKETS[name] && playerRole !== 'Tank') return;
      }
      var isDualWieldOffHand = row === 'Off Hand' && catalogSlot === 'One-Hand';
      // #609: mirrors js/wishlist.js's CLASS_WEAPON_TYPES/CLASS_SHIELD_USERS
      // check. weapon_subtype only exists for Weapon-slot items and Shields --
      // other Off Hand items (tomes/orbs) have none and stay unfiltered here.
      // Null/unbackfilled weapon_subtype also stays unfiltered, matching every
      // other filter's "unknown shows everything" convention.
      if (playerClass && (row === 'Weapon' || isDualWieldOffHand) && weaponSubtype) {
        var allowedWeaponTypes = ((CLASS_WEAPON_TYPES || {})[playerClass] || {})[catalogSlot] || [];
        if (allowedWeaponTypes.indexOf(weaponSubtype) === -1) return;
      }
      if (playerClass && row === 'Off Hand' && weaponSubtype === 'Shield' && !CLASS_SHIELD_USERS[playerClass]) return;

      // Tier-token substitution: the row shows the class piece, rankName keeps
      // the token, which is what item_preferences stores.
      var displayName = name;
      if (playerClass && tierTokenMap[name] && tierTokenMap[name][playerClass]) {
        displayName = tierTokenMap[name][playerClass];
      }
      buckets[row].push({ name: displayName, itemId: (DATA.itemIds || {})[name], rankName: name });
    });
  });

  Object.keys(buckets).forEach(function (row) {
    buckets[row].sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
  });

  return buckets;
}
