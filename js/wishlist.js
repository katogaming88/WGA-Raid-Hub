// Raider-facing item wishlist (#515 Phase 1). Raiders tag catalog items with
// a self-reported priority tier (bis/good/ok/catalyst/pass) so officers get
// backup-option signal that bis_items (one officer-curated pick per slot)
// has no way to express. Own file since officer.html (where tab-bis.js's
// officer 16-slot grid lives) and index.html are separate script bundles.
//
// Rendered as a profile-section inside renderProfile() (js/common.js), same
// self-service pattern as js/streamers.js's ownStreamerSectionHTML() -- only
// on the public/self profile view (backTo === 'landing'), and only when the
// logged-in session's own claimed character matches the profile being
// viewed. There's no separate nav tab; a raider's wishlist isn't something a
// visitor browsing the roster should stumble into on someone else's profile.
//
// Depends on: common.js (supabaseClient, DATA, normalise, renderProfile),
// discord.js (getDiscordSession).

var _wishlistPlayerId = null;
var _wishlistPlayerFirstName = null; // kept alongside _wishlistPlayerId so writes can re-render via renderProfile()
var _wishlistPrefs = null; // array of {id, item_id, status, note, slot} once fetched, else null while loading
var _wishlistSaving = {}; // 'itemId|slot' -> true while a write is in flight, to disable that row's buttons

var WISHLIST_STATUSES = [
  { value: 'bis', label: 'BiS' },
  { value: 'good', label: 'Good' },
  { value: 'ok', label: 'OK' },
  { value: 'catalyst', label: 'Catalyst Only' },
  { value: 'pass', label: 'Pass' }
];

// Mirrors js/tabs/tab-bis.js's BIS_SLOTS / BIS_CATALOG_SLOT_TO_ROWS. Kept as
// a separate copy rather than a shared import -- officer.html and index.html
// load entirely different script sets, so tab-bis.js isn't available here.
// tab-bis.js is the source of truth; update both if the slot vocabulary ever
// changes.
var WISHLIST_SLOTS = [
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
var WISHLIST_CATALOG_SLOT_TO_ROWS = {
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

// Same armor-type scoping as tab-bis.js's search (bisSlotOnInput): rows for
// which armor type doesn't apply (jewelry, cloaks, weapons) skip the filter,
// so a warlock still sees every neck/trinket/weapon option, not just cloth.
var WISHLIST_ARMOR_TYPES = { Plate: true, Mail: true, Leather: true, Cloth: true };
var WISHLIST_UNIVERSAL_ROWS = {
  Neck: true,
  Back: true,
  Wrist: true,
  'Finger 1': true,
  'Finger 2': true,
  'Trinket 1': true,
  'Trinket 2': true,
  Weapon: true,
  'Off Hand': true
};

// Same shape as fetchSupabaseBisItems (js/common.js) -- guard on client,
// 10s race-timeout, warn+null on any failure. RLS already scopes this to the
// caller's own rows, but filtering client-side keeps the query cheap.
function fetchMyItemPreferences(playerId) {
  if (!supabaseClient) return Promise.resolve(null);
  var query = supabaseClient
    .from('item_preferences')
    .select('id, item_id, status, note, slot')
    .eq('player_id', playerId)
    .then(function (result) {
      if (result.error) {
        console.warn('Supabase item_preferences query failed.', result.error.message);
        return null;
      }
      return result.data || [];
    })
    .catch(function (err) {
      console.warn('Supabase item_preferences query failed.', err);
      return null;
    });
  var timeout = new Promise(function (resolve) {
    setTimeout(function () {
      resolve(null);
    }, 10000);
  });
  return Promise.race([query, timeout]);
}

// Called from renderProfile() while building its HTML string -- must return
// synchronously, so a not-yet-loaded fetch shows a loading placeholder and
// re-invokes renderProfile() itself once the data's in (same "re-render the
// same entrypoint after an async load" shape buildWishlistTab used before
// this became a profile section, and the same one bisSlotPickItem's callers
// use for their own local-state patches).
function ownWishlistSectionHTML(player, backTo) {
  if (backTo !== 'landing') return '';
  var session = typeof getDiscordSession === 'function' ? getDiscordSession() : null;
  if (!session || !session.nameRealm || normalise(session.nameRealm) !== normalise(player.nameRealm)) return '';

  if (_wishlistPlayerId !== player.id) {
    _wishlistPlayerId = player.id;
    _wishlistPlayerFirstName = player.firstName;
    _wishlistPrefs = null;
  }

  if (_wishlistPrefs === null) {
    fetchMyItemPreferences(player.id).then(function (rows) {
      _wishlistPrefs = rows || [];
      if (typeof renderProfile === 'function') renderProfile(player.firstName, 'landing');
    });
    return (
      '<div class="profile-section"><div class="section-label">My Wishlist</div>' +
      '<div style="padding:0.75rem 0;"><div class="spinner"></div></div></div>'
    );
  }

  return wishlistSectionBodyHTML(player);
}

// Read-time merge for the profile's BiS List display -- never writes to
// bis_items. A raider's own wishlist "BiS" tag supersedes the officer's pick
// for that same slot category; real items compare by catalog slot (Finger,
// Trinket, ...), since the wishlist has no notion of "which numbered ring"
// the way the officer's grid does -- any BiS-tagged ring supersedes both
// Finger 1 and Finger 2. Placeholders (M+/Crafted/Catalyst) compare by their
// exact tagged BIS_SLOTS row instead, since that's the only thing that
// distinguishes them (they have no catalog slot of their own).
//
// Requires _wishlistPrefs to already be loaded for this player -- called
// from renderProfile() after ownWishlistSectionHTML() has had a chance to
// populate it this render pass. Falls back to "nothing from wishlist yet"
// (not an error) if it hasn't loaded yet, matching ownWishlistSectionHTML's
// own loading-placeholder-then-rerender pattern.
function wishlistBisMergeGroups(player, officerBisItems) {
  if (_wishlistPlayerId !== player.id || _wishlistPrefs === null) {
    return { fromWishlist: [], officerSet: officerBisItems };
  }

  var idToName = {};
  Object.keys((DATA && DATA.itemIds) || {}).forEach(function (name) {
    idToName[DATA.itemIds[name]] = name;
  });
  var itemSlots = (DATA && DATA.itemSlots) || {};
  var itemPlaceholders = (DATA && DATA.itemPlaceholders) || {};

  var coveredCatalogSlots = {};
  var coveredPlaceholderRows = {};
  var fromWishlist = [];

  _wishlistPrefs.forEach(function (p) {
    if (p.status !== 'bis') return;
    var name = idToName[p.item_id];
    if (!name) return;
    var isPlaceholder = !!itemPlaceholders[name];
    if (isPlaceholder) {
      if (p.slot) coveredPlaceholderRows[p.slot] = true;
    } else {
      var catalogSlot = itemSlots[name] || '';
      if (catalogSlot) coveredCatalogSlots[catalogSlot] = true;
    }
    fromWishlist.push({
      item: name,
      slot: isPlaceholder ? p.slot || '' : '',
      dbSlot: '',
      obtained: false,
      playerId: player.id,
      itemId: p.item_id,
      fromWishlist: true
    });
  });

  var officerSet = officerBisItems.filter(function (entry) {
    var isPlaceholder = !!itemPlaceholders[entry.item];
    if (isPlaceholder) {
      var row = entry.dbSlot || entry.slot || '';
      return !coveredPlaceholderRows[row];
    }
    var catalogSlot = itemSlots[entry.item] || '';
    return !(catalogSlot && coveredCatalogSlots[catalogSlot]);
  });

  return { fromWishlist: fromWishlist, officerSet: officerSet };
}

function wishlistPrefFor(itemId, slot) {
  for (var i = 0; i < _wishlistPrefs.length; i++) {
    var p = _wishlistPrefs[i];
    if (p.item_id === itemId && (p.slot || null) === (slot || null)) return p;
  }
  return null;
}

// Buckets every real (non-placeholder) catalog item into its WISHLIST_SLOTS
// row(s) via WISHLIST_CATALOG_SLOT_TO_ROWS, same fan-out tab-bis.js uses for
// Finger/Trinket. Unlike the officer grid (one item per row, search-to-add),
// every matching catalog item is listed so a raider can tag several options
// per slot. Scoped to the raider's own armor type (#515 follow-up) -- a
// warlock (Cloth) never sees Plate/Mail/Leather armor rows, just the
// universal rows (jewelry/cloaks/weapons) plus their own armor type.
function wishlistBucketRealItems(playerArmorType) {
  var itemSlots = (DATA && DATA.itemSlots) || {};
  var itemPlaceholders = (DATA && DATA.itemPlaceholders) || {};
  var itemIds = (DATA && DATA.itemIds) || {};
  var itemArmorTypes = (DATA && DATA.itemArmorTypes) || {};
  var buckets = {};
  WISHLIST_SLOTS.forEach(function (s) {
    buckets[s] = [];
  });

  Object.keys(itemSlots).forEach(function (name) {
    if (itemPlaceholders[name]) return;
    var catalogSlot = itemSlots[name] || '';
    var rows = WISHLIST_CATALOG_SLOT_TO_ROWS[catalogSlot] || [];
    var armorType = itemArmorTypes[name] || '';
    rows.forEach(function (row) {
      if (
        playerArmorType &&
        WISHLIST_ARMOR_TYPES[armorType] &&
        !WISHLIST_UNIVERSAL_ROWS[row] &&
        armorType !== playerArmorType
      )
        return;
      buckets[row].push({ name: name, itemId: itemIds[name] });
    });
  });

  Object.keys(buckets).forEach(function (row) {
    buckets[row].sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
  });

  return buckets;
}

function wishlistPlaceholderNames() {
  var itemPlaceholders = (DATA && DATA.itemPlaceholders) || {};
  return Object.keys(itemPlaceholders).sort();
}

function wishlistStatusButtonsHTML(itemId, slot) {
  var pref = wishlistPrefFor(itemId, slot);
  var current = pref ? pref.status : null;
  var savingKey = itemId + '|' + (slot || '');
  var disabled = _wishlistSaving[savingKey] ? ' disabled' : '';

  return WISHLIST_STATUSES.map(function (s) {
    var active = current === s.value;
    return (
      '<button type="button" class="btn ' +
      (active ? 'btn-gold' : 'btn-muted') +
      '" style="font-size:0.9rem;padding:2px 8px;" ' +
      disabled +
      ' onclick="wishlistSetStatus(' +
      itemId +
      ",'" +
      (slot ? slot.replace(/'/g, "\\'") : '') +
      "','" +
      s.value +
      '\')">' +
      s.label +
      '</button>'
    );
  }).join('');
}

function wishlistNoteHTML(itemId, slot) {
  var pref = wishlistPrefFor(itemId, slot);
  var note = (pref && pref.note) || '';
  var noteId = 'wishlistNote_' + itemId + '_' + (slot || 'none').replace(/\s+/g, '');
  return (
    '<input type="text" id="' +
    noteId +
    '" class="self-received-source" style="width:100%;box-sizing:border-box;font-size:0.92rem;margin-top:0.25rem;" ' +
    'placeholder="Note (optional)" value="' +
    note.replace(/"/g, '&quot;') +
    '" onchange="wishlistSetNote(' +
    itemId +
    ",'" +
    (slot ? slot.replace(/'/g, "\\'") : '') +
    '\',this.value)">'
  );
}

// The icon <img> is drawn from our own items.icon column (populated by
// scripts/fetch-items.js from Wowhead's item XML) rather than depending on
// the Wowhead tooltip widget rendering one -- that widget only works when its
// external script actually loads, which ad-blockers commonly block for
// wow.zamimg.com specifically (#515 follow-up, confirmed live: the widget
// silently no-ops and item names rendered as bare unstyled links). The
// wowhead-class link is kept around the icon+name anyway as a bonus hover
// tooltip for whoever's browser does let it load; index.html sets
// window.whTooltips = {colorLinks:true, iconizeLinks:true} before that
// script, so real rarity coloring layers on top when it works.
function wishlistItemNameHtml(name) {
  var wowId = ((DATA && DATA.itemWowIds) || {})[name];
  var icon = ((DATA && DATA.itemIcons) || {})[name];
  var iconImg = icon
    ? '<img src="https://wow.zamimg.com/images/wow/icons/small/' +
      icon +
      '.jpg" alt="" width="20" height="20" style="border-radius:3px;border:1px solid var(--border);flex-shrink:0;">'
    : '';

  if (wowId == null) {
    return (
      '<span style="display:flex;align-items:center;gap:0.4rem;color:var(--text);flex:1;min-width:10rem;">' +
      iconImg +
      name +
      '</span>'
    );
  }
  return (
    '<a href="https://www.wowhead.com/item=' +
    wowId +
    '" class="wowhead" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:0.4rem;flex:1;min-width:10rem;color:var(--text);text-decoration:none;">' +
    iconImg +
    name +
    '</a>'
  );
}

function wishlistRowHTML(name, itemId, slot, rowIndex) {
  if (itemId == null) return '';
  return (
    '<div style="padding:0.4rem 0.6rem;border-radius:4px;border:1px solid var(--border);background:' +
    (rowIndex % 2 ? 'var(--bg-elevated)' : 'var(--bg-card)') +
    ';margin-bottom:2px;">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;">' +
    wishlistItemNameHtml(name) +
    '<div style="display:flex;gap:0.3rem;flex-wrap:wrap;">' +
    wishlistStatusButtonsHTML(itemId, slot) +
    '</div>' +
    '</div>' +
    wishlistNoteHTML(itemId, slot) +
    '</div>'
  );
}

function wishlistSectionBodyHTML(player) {
  var playerArmorType = (CLASS_ARMOR_TYPE || {})[player && player.class] || null;
  var buckets = wishlistBucketRealItems(playerArmorType);
  var placeholders = wishlistPlaceholderNames();
  var itemIds = (DATA && DATA.itemIds) || {};

  var html =
    '<div class="profile-section"><div class="section-label">My Wishlist' +
    '<button class="help-btn" onclick="toggleHelp(\'help-wishlist-' +
    player.firstName +
    '\')" title="Show help">?</button>' +
    '</div>' +
    '<div id="help-wishlist-' +
    player.firstName +
    '" class="help-tip">Unlike your BiS list (one officer-set pick per slot), tag as many items as you want here -- backups, sidegrades, catalyst-only options, or drops you\'d rather pass on. Officers see both when deciding loot priority.</div>';

  for (var s = 0; s < WISHLIST_SLOTS.length; s++) {
    var slotName = WISHLIST_SLOTS[s];
    var items = buckets[slotName] || [];
    if (!items.length && !placeholders.length) continue;

    html += '<h4 style="margin:0.75rem 0 0.35rem;color:var(--text);">' + slotName + '</h4>';
    html += '<div style="display:flex;flex-direction:column;gap:0;">';

    for (var i = 0; i < items.length; i++) {
      html += wishlistRowHTML(items[i].name, items[i].itemId, null, i);
    }

    // Placeholders (M+/Crafted/Catalyst) apply to every slot -- each gets its
    // own row here, tagged with this slot via item_preferences.slot so the
    // same shared placeholder item can carry a different status per slot.
    for (var p = 0; p < placeholders.length; p++) {
      var phName = placeholders[p];
      html += wishlistRowHTML(phName, itemIds[phName], slotName, items.length + p);
    }

    html += '</div>';
  }

  html +=
    '<div id="wishlistSaveMsg-' +
    player.firstName +
    '" style="font-size:0.95rem;color:var(--text-muted);margin-top:0.5rem;"></div>';
  html += '</div>';
  return html;
}

// Insert-or-update, not .upsert() -- the unique index is on the expression
// coalesce(slot,''), not the raw slot column, so onConflict:'player_id,
// item_id,slot' can't match it (same reason tab-bis.js's bisSlotPickItem
// does a plain insert rather than upserting). Filters an update the same way
// bisSlotFilter() does: .eq('slot', slot) when set, .is('slot', null) when not.
function wishlistUpsert(itemId, slot, patch) {
  if (!_wishlistPlayerId) return;
  var savingKey = itemId + '|' + (slot || '');
  _wishlistSaving[savingKey] = true;
  var msgEl = document.getElementById('wishlistSaveMsg-' + _wishlistPlayerFirstName);
  if (msgEl) msgEl.textContent = 'Saving...';

  var existing = wishlistPrefFor(itemId, slot);

  var request;
  if (existing) {
    var updateQuery = supabaseClient
      .from('item_preferences')
      .update(patch)
      .eq('player_id', _wishlistPlayerId)
      .eq('item_id', itemId);
    updateQuery = slot ? updateQuery.eq('slot', slot) : updateQuery.is('slot', null);
    request = updateQuery.select('id, item_id, status, note, slot');
  } else {
    var row = {
      player_id: _wishlistPlayerId,
      item_id: itemId,
      slot: slot || null,
      status: 'good',
      note: null
    };
    Object.keys(patch).forEach(function (k) {
      row[k] = patch[k];
    });
    request = supabaseClient.from('item_preferences').insert(row).select('id, item_id, status, note, slot');
  }

  request
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);
      var saved = result.data && result.data[0];
      if (saved) {
        if (existing) {
          existing.status = saved.status;
          existing.note = saved.note;
        } else {
          _wishlistPrefs.push(saved);
        }
      }
      delete _wishlistSaving[savingKey];
      if (typeof renderProfile === 'function' && _wishlistPlayerFirstName) {
        renderProfile(_wishlistPlayerFirstName, 'landing');
      }
    })
    .catch(function (err) {
      delete _wishlistSaving[savingKey];
      var msg = document.getElementById('wishlistSaveMsg-' + _wishlistPlayerFirstName);
      if (msg) msg.textContent = 'Failed: ' + err.message;
    });
}

function wishlistSetStatus(itemId, slot, status) {
  wishlistUpsert(itemId, slot || null, { status: status });
}

function wishlistSetNote(itemId, slot, note) {
  wishlistUpsert(itemId, slot || null, { note: note || null });
}
