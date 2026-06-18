var WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxrQdQGqbBTELWm7huWChdbES0ry7WFZetlELWuEdI0T6lfbXEzrqx9Vo5yA-b9dW4y7A/exec';
var VERSION = '2.7.0';
var DATA = null;

var WOW_REALMS = [
  // NA
  'Aegwynn', 'Aggramar', 'Akama', 'Alexstrasza', 'Alleria', 'Altar of Storms', 'Alterac Mountains',
  'Andorhal', 'Anetheron', 'Antonidas', "Anub'arak", 'Anvilmar', 'Arathor', 'Archimonde',
  'Area 52', 'Argent Dawn', 'Arthas', 'Arygos', 'Auchindoun', 'Azgalor', 'Azjol-Nerub', 'Azralon',
  'Azshara', 'Azuremyst', 'Baelgun', 'Black Dragonflight', 'Blackhand', 'Blackrock',
  'Blackwater Raiders', 'Blackwing Lair', "Blade's Edge", 'Bladefist', 'Bleeding Hollow',
  'Blood Furnace', 'Bloodhoof', 'Bloodscalp', 'Bonechewer', 'Borean Tundra', 'Boulderfist',
  'Bronze Dragonflight', 'Bronzebeard', 'Burning Blade', 'Burning Legion', 'Cairne',
  'Cenarion Circle', 'Cenarius', "Cho'gall", 'Chromaggus', 'Crushridge', 'Daggerspine', 'Dalaran',
  'Dalvengyr', 'Dark Iron', 'Darrowmere', 'Dawnbringer', 'Deathwing', 'Demon Soul', 'Destromath',
  'Detheroc', 'Doomhammer', 'Dragonblight', 'Dragonmaw', "Drak'Tharon", "Drak'thul",
  'Drenden', 'Dunemaul', 'Durotan', 'Duskwood', 'Earthen Ring', 'Echo Isles', 'Eitrigg',
  "Eldre'Thalas", 'Elune', 'Emerald Dream', 'Eonar', 'Eredar', 'Executus', 'Exodar', 'Farstriders',
  'Feathermoon', 'Fenris', 'Fizzcrank', 'Frostmane', 'Frostwolf', 'Garithos', 'Garona', 'Garrosh',
  'Ghostlands', 'Gilneas', 'Gnomeregan', 'Gorefiend', 'Greymane', 'Grizzly Hills', "Gul'dan",
  'Gurubashi', 'Hakkar', 'Haomarush', 'Hellscream', 'Hydraxis', 'Hyjal', 'Icecrown',
  'Illidan', 'Jaedenar', "Kael'thas", 'Kalecgos', 'Kargath', "Kel'Thuzad",
  'Khaz Modan', "Kil'jaeden", 'Kilrogg', 'Kirin Tor', 'Korgath', 'Korialstrasz',
  'Kul Tiras', 'Laughing Skull', 'Lethon', 'Lightbringer', "Lightning's Blade", 'Lightninghoof',
  'Llane', 'Lothar', 'Madoran', 'Maelstrom', 'Magtheridon', 'Maiev', "Mal'Ganis", 'Malorne',
  'Malygos', 'Mannoroth', 'Medivh', 'Misha', "Mok'Nathal", 'Moon Guard', 'Moonrunner', "Mug'thol",
  'Muradin', 'Nathrezim', 'Nazgrel', 'Nazjatar', 'Nesingwary', 'Norgannon', 'Nordrassil',
  'Onyxia', 'Perenolde', 'Proudmoore', "Quel'dorei", 'Ravenholdt', 'Rexxar',
  'Rivendare', 'Runetotem', 'Scarlet Crusade', 'Scilla', "Sen'jin", 'Sentinels', 'Shadow Council',
  'Shadowmoon', 'Shadowsong', 'Shattered Halls', 'Shattered Hand', "Shu'halo", 'Silver Hand',
  'Silvermoon', 'Sisters of Elune', 'Skullcrusher', 'Skywall', 'Smolderthorn', 'Spinebreaker',
  'Spirestone', 'Staghelm', 'Steamwheedle Cartel', 'Stonemaul', 'Stormrage', 'Stormreaver',
  'Stormscale', 'Sulfuras', 'Tanaris', 'Terenas', 'Terokkar', 'Thorium Brotherhood', 'Thrall',
  'Thunderhorn', 'Thunderlord', 'Tichondrius', 'Tirion', 'Tortheldrin', 'Trollbane', 'Turalyon',
  'Twisting Nether', 'Uther', 'Vashj', 'Velen', 'Venture Co', 'Whisperwind', 'Wildhammer',
  'Windrunner', 'Winterhoof', 'Wyrmrest Accord', 'Ysera', 'Ysondre', 'Zangarmarsh', "Zul'jin",
  'Zuluhed',
  // OCE
  "Aman'Thul", 'Barthilas', 'Caelestrasz', "Dath'Remar", 'Dreadmaul', 'Frostmourne',
  'Gundrak', "Jubei'Thos", "Khaz'goroth", 'Nagrand', 'Saurfang', 'Thaurissan'
].sort();

var CLASS_SPECS = {
  'Death Knight': { specs: ['Blood', 'Frost', 'Unholy'], roles: ['Tank', 'DPS'] },
  'Demon Hunter': { specs: ['Havoc', 'Vengeance', 'Devourer'], roles: ['Tank', 'DPS'] },
  'Druid': { specs: ['Balance', 'Feral', 'Guardian', 'Restoration'], roles: ['Tank', 'Healer', 'DPS'] },
  'Evoker': { specs: ['Augmentation', 'Devastation', 'Preservation'], roles: ['Healer', 'DPS'] },
  'Hunter': { specs: ['Beast Mastery', 'Marksmanship', 'Survival'], roles: null },
  'Mage': { specs: ['Arcane', 'Fire', 'Frost'], roles: null },
  'Monk': { specs: ['Brewmaster', 'Mistweaver', 'Windwalker'], roles: ['Tank', 'Healer', 'DPS'] },
  'Paladin': { specs: ['Holy', 'Protection', 'Retribution'], roles: ['Tank', 'Healer', 'DPS'] },
  'Priest': { specs: ['Discipline', 'Holy', 'Shadow'], roles: ['Healer', 'DPS'] },
  'Rogue': { specs: ['Assassination', 'Outlaw', 'Subtlety'], roles: null },
  'Shaman': { specs: ['Elemental', 'Enhancement', 'Restoration'], roles: ['Healer', 'DPS'] },
  'Warlock': { specs: ['Affliction', 'Demonology', 'Destruction'], roles: null },
  'Warrior': { specs: ['Arms', 'Fury', 'Protection'], roles: ['Tank', 'DPS'] }
};

var CLASS_COLORS = {
  'Death Knight': '#C41E3A',
  'Demon Hunter': '#A330C9',
  'Druid': '#FF7C0A',
  'Evoker': '#33937F',
  'Hunter': '#AAD372',
  'Mage': '#3FC7EB',
  'Monk': '#00FF98',
  'Paladin': '#F48CBA',
  'Priest': '#FFFFFF',
  'Rogue': '#FFF468',
  'Shaman': '#0070DD',
  'Warlock': '#8788EE',
  'Warrior': '#C69B3A'
};

function classColor(cls) {
  return CLASS_COLORS[cls] || 'var(--text)';
}

function classHexToRgba(hex, a) {
  var r = parseInt(hex.slice(1, 3), 16);
  var g = parseInt(hex.slice(3, 5), 16);
  var b = parseInt(hex.slice(5, 7), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}

function classBadgeStyle(cls) {
  var hex = CLASS_COLORS[cls];
  if (!hex) return '';
  return 'color:' + hex + ';background:' + classHexToRgba(hex, 0.1) + ';border-color:' + classHexToRgba(hex, 0.25) + ';';
}

function normalise(str) {
  return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// -- Data loading -----------------------------------------------------------
// onSuccess is called after DATA is populated; each page passes its own boot fn.
function loadData(onSuccess) {
  window._rosterCallback = function (data) {
    try {
      if (data.error) throw new Error(data.error);
      DATA = data;
      DATA._loadedAt = new Date();
      onSuccess();
    } catch (e) {
      document.getElementById('loadingMsg').className = 'state-msg error';
      document.getElementById('loadingMsg').innerHTML = 'Could not load roster data. ' + e.message;
    }
  };
  var script = document.createElement('script');
  script.src = WEB_APP_URL + '?callback=_rosterCallback';
  script.onerror = function () {
    document.getElementById('loadingMsg').className = 'state-msg error';
    document.getElementById('loadingMsg').innerHTML = 'Could not load roster data.';
  };
  document.head.appendChild(script);
  setTimeout(function () {
    if (!DATA) {
      document.getElementById('loadingMsg').className = 'state-msg error';
      document.getElementById('loadingMsg').innerHTML = 'Request timed out.';
    }
  }, 15000);
}

// -- Data helpers -----------------------------------------------------------
function getRank(firstName, itemName) {
  var list = (DATA.priorityOrder || {})[itemName];
  if (!list) return null;
  var norm = normalise(firstName);
  for (var i = 0; i < list.length; i++) { if (normalise(list[i]) === norm) return i + 1; }
  return null;
}

function getBisItems(firstName) {
  var bisMap = DATA.bisList || {};
  var norm = normalise(firstName);
  var key = null;
  var keys = Object.keys(bisMap);
  for (var i = 0; i < keys.length; i++) { if (normalise(keys[i]) === norm) { key = keys[i]; break; } }
  var entries = key ? bisMap[key] : [];
  return entries.map(function (e) { return (typeof e === 'string') ? { item: e, slot: '' } : e; });
}

function getSelfReceivedItems(firstName) {
  var map = DATA.selfReceived || {};
  var norm = normalise(firstName);
  var keys = Object.keys(map);
  for (var i = 0; i < keys.length; i++) {
    if (normalise(keys[i]) === norm) return map[keys[i]];
  }
  return [];
}

function refreshBisCompletion(firstName) {
  var el = document.getElementById('bis-completion-' + firstName);
  if (!el) return;
  var bisItems     = getBisItems(firstName);
  if (!bisItems.length) return;
  var selfRecItems = getSelfReceivedItems(firstName);
  var selfRecMap   = {};
  for (var i = 0; i < selfRecItems.length; i++) selfRecMap[normalise(selfRecItems[i].item)] = true;
  var lootEntry = getLootEntry(firstName);
  var receivedMap = {};
  if (lootEntry && lootEntry.items) {
    for (var j = 0; j < lootEntry.items.length; j++) {
      var n = typeof lootEntry.items[j] === 'string' ? lootEntry.items[j] : lootEntry.items[j].name;
      receivedMap[normalise(n)] = true;
    }
  }
  var count = 0;
  for (var k = 0; k < bisItems.length; k++) {
    if (receivedMap[normalise(bisItems[k].item)] || selfRecMap[normalise(bisItems[k].item)]) count++;
  }
  var pct = Math.round((count / bisItems.length) * 100);
  el.innerHTML = '<span style="color:var(--gold-light);font-weight:600;">' + pct + '%</span><span style="color:var(--text-muted);font-weight:400;"> (' + count + '/' + bisItems.length + ')</span>';
}

function getLootEntry(firstName) {
  var lootMap = DATA.lootCounts || {};
  var norm = normalise(firstName);
  var keys = Object.keys(lootMap);
  for (var i = 0; i < keys.length; i++) { if (normalise(keys[i]) === norm) return lootMap[keys[i]]; }
  return null;
}

// -- Render helpers ---------------------------------------------------------
function rankPillHTML(rank) {
  if (rank === null) return '<span style="font-size:0.97rem;color:var(--text-dim);min-width:40px;text-align:center;">-</span>';
  var t = Math.min((rank - 1) / 14, 1);
  var rv = Math.round(214 + (100 - 214) * t), gv = Math.round(163 + (100 - 163) * t), bv = Math.round(68 + (100 - 68) * t);
  var a = Math.max(0.08, 0.18 - t * 0.1);
  var c = 'rgb(' + rv + ',' + gv + ',' + bv + ')', bg = 'rgba(' + rv + ',' + gv + ',' + bv + ',' + a + ')', bd = 'rgba(' + rv + ',' + gv + ',' + bv + ',' + Math.max(0.2, 0.4 - t * 0.2) + ')';
  return '<span class="rank-pill" style="background:' + bg + ';color:' + c + ';border:1px solid ' + bd + ';">#' + rank + '</span>';
}

function lookupItemSlot(itemName) {
  var slots = DATA.itemSlots || {};
  if (slots[itemName]) return slots[itemName];
  for (var key in slots) {
    if (key.indexOf(itemName) === 0) return slots[key];
  }
  return '';
}

function getSlotColor(slot) {
  var s = (slot || '').toUpperCase();
  if (s === 'TRINKET' || s === 'TRINKET 1' || s === 'TRINKET 2') return 'var(--gold)';
  if (s === 'NECK' || s === 'RING' || s === 'RING 1' || s === 'RING 2') return 'var(--ranged)';
  if (s === '1H/2H' || s === 'OH') return 'var(--melee)';
  if (['HEAD', 'SHOULDERS', 'CHEST', 'GLOVES', 'LEGS', 'CLOAK', 'BRACERS', 'BELT', 'BOOTS'].indexOf(s) >= 0) return 'var(--tank)';
  return 'var(--text)';
}

function attendColor(pct) { return pct >= 90 ? 'var(--heal)' : pct >= 75 ? 'var(--gold)' : 'var(--melee)'; }

// -- BiS state helpers ------------------------------------------------------
function bisSubmissionsOpen() {
  return !!(DATA && DATA.bisSubmissionsOpen);
}

function bisAllowedFor(nameRealm) {
  var allowed = DATA && DATA.bisAllowedPlayers;
  return !!(allowed && allowed.indexOf(nameRealm) !== -1);
}

// -- BiS form actions (used from profile on both pages) --------------------
function toggleBisForm(firstName) {
  var form = document.getElementById('bisForm-' + firstName);
  if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

// -- M+ exclusion form actions ---------------------------------------------
function toggleMPlusForm(firstName) {
  var form = document.getElementById('mplusForm-' + firstName);
  if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

function submitMPlusExclusionForm(nameRealm, firstName) {
  var urlEl = document.getElementById('mplusUrl-' + firstName);
  var notesEl = document.getElementById('mplusNotes-' + firstName);
  var formEl = document.getElementById('mplusForm-' + firstName);
  if (!urlEl || !urlEl.value.trim()) { if (urlEl) urlEl.style.borderColor = 'var(--melee)'; return; }
  var data = { nameRealm: nameRealm, raiderioUrl: urlEl.value.trim(), notes: notesEl ? notesEl.value.trim() : '' };
  if (formEl) formEl.innerHTML = '<p style="font-size:0.95rem;color:var(--text-muted);padding:0.5rem 0;">Submitting...</p>';
  var cbName = '_submitMPlusCb' + firstName.replace(/[^a-zA-Z0-9]/g, '_');
  window[cbName] = function (result) {
    delete window[cbName];
    if (result && result.success) {
      if (formEl) formEl.innerHTML = '<p style="font-size:0.95rem;color:var(--text-muted);padding:0.5rem 0;">Request submitted! An officer will review it shortly.</p>';
    } else {
      if (formEl) formEl.innerHTML = '<p style="font-size:0.95rem;color:var(--melee);padding:0.5rem 0;">Failed to submit. Try again.</p>';
    }
  };
  var script = document.createElement('script');
  script.onerror = function () {
    delete window[cbName];
    if (formEl) formEl.innerHTML = '<p style="font-size:0.95rem;color:var(--melee);padding:0.5rem 0;">Failed to submit. Try again.</p>';
  };
  script.src = WEB_APP_URL + '?action=submitMPlusExclusion&data=' + encodeURIComponent(JSON.stringify(data)) + '&callback=' + cbName;
  document.head.appendChild(script);
}

function submitBiSForm(nameRealm, firstName) {
  var urlEl = document.getElementById('bisUrl-' + firstName);
  var notesEl = document.getElementById('bisNotes-' + firstName);
  if (!urlEl || !urlEl.value.trim()) { if (urlEl) urlEl.style.borderColor = 'var(--melee)'; return; }
  var data = { nameRealm: nameRealm, bisLink: urlEl.value.trim(), notes: notesEl ? notesEl.value.trim() : '' };
  var formEl = document.getElementById('bisForm-' + firstName);
  if (formEl) formEl.innerHTML = '<p style="font-size:0.95rem;color:var(--text-muted);padding:0.5rem 0;">Submitting...</p>';
  var cbName = '_submitBisCb' + firstName.replace(/[^a-zA-Z0-9]/g, '_');
  window[cbName] = function (result) {
    delete window[cbName];
    if (formEl) {
      formEl.innerHTML = result.error
        ? '<p style="font-size:0.95rem;color:var(--melee);padding:0.5rem 0;">Failed to submit. Try again.</p>'
        : '<p style="font-size:0.95rem;color:var(--text-muted);padding:0.5rem 0;">Submitted -- pending officer review.</p>';
    }
  };
  var script = document.createElement('script');
  script.onerror = function () {
    delete window[cbName];
    if (formEl) formEl.innerHTML = '<p style="font-size:0.95rem;color:var(--melee);padding:0.5rem 0;">Failed to submit. Try again.</p>';
  };
  script.src = WEB_APP_URL + '?action=submitBiS&data=' + encodeURIComponent(JSON.stringify(data)) + '&callback=' + cbName;
  document.head.appendChild(script);
}

function officerUpdateBisLink(nameRealm, firstName) {
  var urlEl = document.getElementById('bisUrl-' + firstName);
  if (!urlEl || !urlEl.value.trim()) { if (urlEl) urlEl.style.borderColor = 'var(--melee)'; return; }
  var data = { nameRealm: nameRealm, url: urlEl.value.trim() };
  var formEl = document.getElementById('bisForm-' + firstName);
  if (formEl) formEl.innerHTML = '<p style="font-size:0.95rem;color:var(--text-muted);padding:0.5rem 0;">Saving...</p>';
  var cbName = '_updateBisCb' + firstName.replace(/[^a-zA-Z0-9]/g, '_');
  window[cbName] = function (result) {
    delete window[cbName];
    if (formEl) {
      formEl.innerHTML = result.error
        ? '<p style="font-size:0.95rem;color:var(--melee);padding:0.5rem 0;">Failed to save. Try again.</p>'
        : '<p style="font-size:0.95rem;color:var(--text-muted);padding:0.5rem 0;">BiS link updated. Clear cache to refresh.</p>';
    }
  };
  var script = document.createElement('script');
  script.onerror = function () {
    delete window[cbName];
    if (formEl) formEl.innerHTML = '<p style="font-size:0.95rem;color:var(--melee);padding:0.5rem 0;">Failed to save. Try again.</p>';
  };
  script.src = WEB_APP_URL + '?action=updateBisLink&data=' + encodeURIComponent(JSON.stringify(data)) + '&callback=' + cbName;
  document.head.appendChild(script);
}

function updateBisAllowDiv(nameRealm, firstName) {
  var divEl = document.getElementById('bisAllowDiv-' + firstName);
  if (!divEl) return;
  var allowed = bisAllowedFor(nameRealm);
  divEl.innerHTML = '';
  var btn = document.createElement('button');
  btn.className = 'btn btn-muted';
  btn.style.cssText = 'font-size:0.92rem;padding:0.25rem 0.75rem;';
  if (allowed) {
    btn.textContent = 'Revoke BiS Access';
    btn.onclick = function () { revokeBisForPlayer(nameRealm, firstName); };
    var badge = document.createElement('span');
    badge.style.cssText = 'font-size:0.9rem;color:var(--heal);margin-left:0.5rem;';
    badge.textContent = 'Submission open';
    divEl.appendChild(btn);
    divEl.appendChild(badge);
  } else {
    btn.textContent = 'Allow BiS Submission';
    btn.onclick = function () { allowBisForPlayer(nameRealm, firstName); };
    divEl.appendChild(btn);
  }
}

function allowBisForPlayer(nameRealm, firstName) {
  var divEl = document.getElementById('bisAllowDiv-' + firstName);
  if (divEl) divEl.innerHTML = '<span style="font-size:0.95rem;color:var(--text-muted);">Saving...</span>';
  var cbName = '_allowBisCb' + firstName.replace(/[^a-zA-Z0-9]/g, '_');
  window[cbName] = function (result) {
    delete window[cbName];
    if (result && result.success && DATA) DATA.bisAllowedPlayers = result.bisAllowedPlayers;
    updateBisAllowDiv(nameRealm, firstName);
  };
  var script = document.createElement('script');
  script.onerror = function () { delete window[cbName]; updateBisAllowDiv(nameRealm, firstName); };
  script.src = WEB_APP_URL + '?action=allowBisForPlayer&data=' + encodeURIComponent(JSON.stringify({ nameRealm: nameRealm })) + '&callback=' + cbName;
  document.head.appendChild(script);
}

function revokeBisForPlayer(nameRealm, firstName) {
  var divEl = document.getElementById('bisAllowDiv-' + firstName);
  if (divEl) divEl.innerHTML = '<span style="font-size:0.95rem;color:var(--text-muted);">Saving...</span>';
  var cbName = '_revokeBisCb' + firstName.replace(/[^a-zA-Z0-9]/g, '_');
  window[cbName] = function (result) {
    delete window[cbName];
    if (result && result.success && DATA) DATA.bisAllowedPlayers = result.bisAllowedPlayers;
    updateBisAllowDiv(nameRealm, firstName);
  };
  var script = document.createElement('script');
  script.onerror = function () { delete window[cbName]; updateBisAllowDiv(nameRealm, firstName); };
  script.src = WEB_APP_URL + '?action=revokeBisForPlayer&data=' + encodeURIComponent(JSON.stringify({ nameRealm: nameRealm })) + '&callback=' + cbName;
  document.head.appendChild(script);
}

// -- Self-received (raider marks item from profile) ------------------------
function showSelfReceivedForm(firstName, item, slot, rowId, defaultSource, isOfficer) {
  if (event) event.stopPropagation();
  var formEl = document.getElementById('form-' + rowId);
  if (!formEl) return;
  if (formEl.style.display !== 'none') { formEl.style.display = 'none'; return; }
  var sources = ['M+', 'Great Vault', 'Crafted', 'Catalyst', 'World Drop', 'Other'];
  var opts = '<option value="">-- How did you get it? --</option>';
  for (var si = 0; si < sources.length; si++) {
    opts += '<option value="' + sources[si] + '"' + (sources[si] === defaultSource ? ' selected' : '') + '>' + sources[si] + '</option>';
  }
  var fnSafe   = firstName.replace(/'/g, "\\'");
  var itemSafe = item.replace(/'/g, "\\'");
  var slotSafe = slot.replace(/'/g, "\\'");
  var submitFn = isOfficer
    ? 'submitDirectMarkReceived(\'' + fnSafe + '\',\'' + itemSafe + '\',\'' + slotSafe + '\',\'' + rowId + '\')'
    : 'submitSelfReceivedRequest(\'' + fnSafe + '\',\'' + itemSafe + '\',\'' + slotSafe + '\',\'' + rowId + '\')';
  var submitLabel = isOfficer ? 'Mark received' : 'Submit request';
  var noteText    = isOfficer ? '' : '<p class="self-received-note">An officer will review and approve this. Once approved it will appear on your profile.</p>';
  var formHtml =
    '<div class="self-received-form-inner" onclick="event.stopPropagation()">' +
    '<select class="self-received-source" id="src-' + rowId + '">' + opts + '</select>' +
    '<textarea class="self-received-notes" id="notes-' + rowId + '" placeholder="Notes (optional)" rows="2"></textarea>' +
    '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
    '<button class="btn btn-gold" style="font-size:0.92rem;padding:0.3rem 0.8rem;" onclick="event.stopPropagation();' + submitFn + '">' + submitLabel + '</button>' +
    '<button class="btn btn-muted" style="font-size:0.92rem;padding:0.3rem 0.8rem;" onclick="event.stopPropagation();document.getElementById(\'form-' + rowId + '\').style.display=\'none\'">Cancel</button>' +
    '</div>' +
    noteText +
    '</div>';
  formEl.innerHTML = formHtml;
  formEl.style.display = 'block';
}

function submitSelfReceivedRequest(firstName, item, slot, rowId) {
  var sourceEl = document.getElementById('src-' + rowId);
  var notesEl = document.getElementById('notes-' + rowId);
  if (!sourceEl || !sourceEl.value) { if (sourceEl) sourceEl.style.borderColor = 'var(--melee)'; return; }
  var data = { player: firstName, item: item, slot: slot, source: sourceEl.value, notes: notesEl ? notesEl.value : '' };
  var formEl = document.getElementById('form-' + rowId);
  if (formEl) formEl.innerHTML = '<p style="font-size:0.95rem;color:var(--text-muted);padding:0.5rem 0;">Submitting...</p>';
  var cbName = '_selfRecCb' + rowId.replace(/[^a-zA-Z0-9]/g, '_');
  window[cbName] = function (result) {
    delete window[cbName];
    if (formEl) {
      if (result.error) {
        formEl.innerHTML = '<p style="font-size:0.95rem;color:var(--melee);padding:0.5rem 0;">Failed to submit. Try again.</p>';
      } else {
        formEl.innerHTML = '<p style="font-size:0.95rem;color:var(--text-muted);padding:0.5rem 0;">Request submitted -- pending officer approval.</p>';
        var btn = document.querySelector('#bisrow-' + firstName + '-' + rowId.split('-').pop() + ' .mark-received-btn');
        if (btn) btn.style.display = 'none';
      }
    }
  };
  var script = document.createElement('script');
  script.onerror = function () {
    delete window[cbName];
    if (formEl) formEl.innerHTML = '<p style="font-size:0.95rem;color:var(--melee);padding:0.5rem 0;">Failed to submit. Try again.</p>';
  };
  script.src = WEB_APP_URL + '?action=requestSelfReceived&data=' + encodeURIComponent(JSON.stringify(data)) + '&callback=' + cbName;
  document.head.appendChild(script);
}

function submitDirectMarkReceived(firstName, item, slot, rowId) {
  var sourceEl = document.getElementById('src-' + rowId);
  var notesEl  = document.getElementById('notes-' + rowId);
  if (!sourceEl || !sourceEl.value) { if (sourceEl) sourceEl.style.borderColor = 'var(--melee)'; return; }
  var source  = sourceEl.value;
  var data    = { player: firstName, item: item, slot: slot, source: source, notes: notesEl ? notesEl.value : '' };
  var formEl  = document.getElementById('form-' + rowId);
  if (formEl) formEl.innerHTML = '<p style="font-size:0.95rem;color:var(--text-muted);padding:0.5rem 0;">Saving...</p>';
  var cbName = '_directRecCb' + rowId.replace(/[^a-zA-Z0-9]/g, '_');
  window[cbName] = function(result) {
    delete window[cbName];
    if (formEl) {
      if (result.error) {
        formEl.innerHTML = '<p style="font-size:0.95rem;color:var(--melee);padding:0.5rem 0;">Failed. Try again.</p>';
      } else {
        formEl.style.display = 'none';
        var rowEl = document.getElementById(rowId);
        if (rowEl) {
          rowEl.classList.add('bis-received');
          var btn = rowEl.querySelector('.mark-received-btn');
          if (btn) btn.outerHTML = '<span class="bis-self-received-badge">' + source + '</span>';
        }
        if (DATA && DATA.selfReceived) {
          if (!DATA.selfReceived[firstName]) DATA.selfReceived[firstName] = [];
          DATA.selfReceived[firstName].push({ item: item, slot: slot, source: source });
        }
        refreshBisCompletion(firstName);
      }
    }
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    if (formEl) formEl.innerHTML = '<p style="font-size:0.95rem;color:var(--melee);padding:0.5rem 0;">Failed. Try again.</p>';
  };
  script.src = WEB_APP_URL + '?action=directMarkReceived&data=' + encodeURIComponent(JSON.stringify(data)) + '&callback=' + cbName;
  document.head.appendChild(script);
}

// -- Player profile (shared between public and officer pages) --------------
// backTo: 'landing' = public page, 'officer' = officer page
// container: optional DOM element to render into (officer inline panel);
//            if omitted renders into #profileView (public page)
function renderProfile(firstName, backTo, container) {
  var norm = normalise(firstName);
  var player = null;
  for (var i = 0; i < DATA.roster.length; i++) { if (normalise(DATA.roster[i].firstName) === norm) { player = DATA.roster[i]; break; } }
  if (!player) return;

  var displayName = player.nick || player.firstName;
  var initials = displayName.slice(0, 2).toUpperCase();
  var classLine = player.class ? '<span class="badge badge-class" style="' + classBadgeStyle(player.class) + '">' + (player.spec || player.class) + '</span>' : '';
  var trialBadge = player.isTrial ? '<span class="badge badge-trial">Trial</span>' : '';
  var benchBadge = player.isBench ? '<span class="badge" style="background:rgba(255,255,255,0.04);color:var(--text);border:1px solid var(--border);">Bench</span>' : '';

  // Attendance
  var attendPct = player.attendance || '-';
  var barWidth = player.attendance || '0%';
  var attendDetail = (DATA.attendanceDetails || {})[player.firstName] || [];
  var hasPenalties = attendDetail.length > 0;
  var attendExtra = '';
  if (hasPenalties) {
    attendExtra += '<div id="attend-detail-' + player.firstName + '" style="display:none;margin-top:0.75rem;flex-direction:column;gap:0.3rem;">';
    for (var ai = 0; ai < attendDetail.length; ai++) {
      var ae = attendDetail[ai];
      var sc = ae.status === 'No Show' ? 'var(--melee)' : 'var(--gold)';
      attendExtra += '<div style="display:flex;justify-content:space-between;font-size:1rem;padding:0.25rem 0;border-bottom:1px solid var(--border);">';
      attendExtra += '<span style="color:var(--text);">' + ae.date + '</span>';
      attendExtra += '<span style="color:' + sc + ';font-weight:600;">' + ae.status + '</span></div>';
    }
    attendExtra += '</div>';
  }

  // Loot
  var lootEntry = getLootEntry(player.firstName);
  var lootCount = lootEntry ? lootEntry.count : 0;
  var lootItemsHTML = '';
  var lastItems = [];
  if (lootEntry && lootEntry.items && lootEntry.items.length > 0) {
    var sortedLoot = lootEntry.items.slice().sort(function(a, b) {
      return new Date(b.date) - new Date(a.date);
    });
    var lastDate = sortedLoot[0].date;
    for (var ld = 0; ld < sortedLoot.length; ld++) {
      if (sortedLoot[ld].date === lastDate) lastItems.push(sortedLoot[ld]);
      else break;
    }
    for (var li = 0; li < lootEntry.items.length; li++) {
      var li_obj = lootEntry.items[li];
      var li_name = typeof li_obj === 'string' ? li_obj : li_obj.name;
      var li_diff = typeof li_obj === 'object' && li_obj.difficulty ? li_obj.difficulty : '';
      var li_date = typeof li_obj === 'object' && li_obj.date ? li_obj.date : '';
      var li_slot = lookupItemSlot(li_name);
      var li_sub = (li_slot ? '<span style="color:' + getSlotColor(li_slot) + ';">' + li_slot + '</span>' : '') + (li_slot && li_diff ? ' - ' : '') + (li_diff ? '<span>' + li_diff + '</span>' : '') + ((li_slot || li_diff) && li_date ? ' - ' : '') + (li_date ? '<span>' + li_date + '</span>' : '');
      lootItemsHTML += '<div style="font-size:1rem;color:var(--text);padding:0.3rem 0;border-bottom:1px solid var(--border);">' + li_name + (li_sub ? '<div style="font-size:0.88rem;color:var(--text-muted);margin-top:0.1rem;">' + li_sub + '</div>' : '') + '</div>';
    }
  }

  // BiS link
  var bisStatusHTML = player.bisLink
    ? '<div class="bis-row"><div class="bis-dot yes"></div><a class="bis-link" href="' + player.bisLink + '" target="_blank" rel="noopener">View BiS Source</a></div>'
    : '<div class="bis-row"><div class="bis-dot no"></div><span class="bis-none">No BiS list submitted yet</span></div>';

  var bisActionHTML;
  if (backTo === 'officer') {
    var bisAllowed = bisAllowedFor(player.nameRealm);
    bisActionHTML =
      '<div style="margin-top:0.75rem;">' +
      '<button class="btn btn-muted" style="font-size:0.92rem;padding:0.3rem 0.8rem;" onclick="toggleBisForm(\'' + player.firstName.replace(/'/g, "\\'") + '\')">Update BiS Link</button>' +
      '<div id="bisForm-' + player.firstName + '" style="display:none;margin-top:0.75rem;">' +
      '<input type="url" id="bisUrl-' + player.firstName + '" placeholder="Paste BiS list URL" class="self-received-source" style="max-width:100%;font-size:1rem;">' +
      '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
      '<button class="btn request-approve-btn" onclick="officerUpdateBisLink(\'' + player.nameRealm.replace(/'/g, "\\'") + '\',\'' + player.firstName.replace(/'/g, "\\'") + '\')">Save</button>' +
      '<button class="btn btn-muted" style="font-size:0.92rem;padding:0.25rem 0.75rem;" onclick="document.getElementById(\'bisForm-' + player.firstName + '\').style.display=\'none\'">Cancel</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div id="bisAllowDiv-' + player.firstName + '" style="margin-top:0.5rem;"></div>';
  } else if (bisSubmissionsOpen() || bisAllowedFor(player.nameRealm)) {
    var bisBtnLabel = player.bisLink ? 'Update BiS List' : 'Submit BiS List';
    bisActionHTML =
      '<div style="margin-top:0.75rem;">' +
      '<button class="btn btn-muted" style="font-size:0.92rem;padding:0.3rem 0.8rem;" onclick="toggleBisForm(\'' + player.firstName.replace(/'/g, "\\'") + '\')">' + bisBtnLabel + '</button>' +
      '<div id="bisForm-' + player.firstName + '" style="display:none;margin-top:0.75rem;">' +
      '<input type="url" id="bisUrl-' + player.firstName + '" placeholder="Paste your BiS list URL" class="self-received-source" style="max-width:100%;font-size:1rem;">' +
      '<textarea id="bisNotes-' + player.firstName + '" placeholder="Notes (optional)" rows="2" class="self-received-notes" style="max-width:100%;margin-top:0.4rem;"></textarea>' +
      '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
      '<button class="btn btn-gold" style="font-size:0.92rem;padding:0.3rem 0.8rem;" onclick="submitBiSForm(\'' + player.nameRealm.replace(/'/g, "\\'") + '\',\'' + player.firstName.replace(/'/g, "\\'") + '\')">Submit</button>' +
      '<button class="btn btn-muted" style="font-size:0.92rem;padding:0.3rem 0.8rem;" onclick="document.getElementById(\'bisForm-' + player.firstName + '\').style.display=\'none\'">Cancel</button>' +
      '</div>' +
      '<p class="self-received-note">An officer will review your submission. Once approved it will appear on your profile.</p>' +
      '</div>' +
      '</div>';
  } else {
    bisActionHTML = '';
  }
  var bisHTML = bisStatusHTML + bisActionHTML;

  // M+ exclusion section
  var mplusHTML = '';
  if (backTo === 'officer') {
    mplusHTML = '';
  } else if (player.mPlusExcluded) {
    mplusHTML =
      '<div style="display:flex;align-items:center;gap:0.5rem;">' +
      '<span class="signup-status-badge signup-status-open" style="font-size:0.8rem;">Excluded</span>' +
      '<span style="font-size:0.92rem;color:var(--text-muted);">No longer required to do weekly M+ dungeons.</span>' +
      '</div>' +
      (player.mPlusNote
        ? '<div style="font-size:0.92rem;color:var(--text);margin-top:0.4rem;font-style:italic;">' + player.mPlusNote + '</div>'
        : '');
  } else {
    if (DATA && DATA.mPlusExclusionsOpen) {
      var fnMplus = player.firstName.replace(/'/g, "\\'");
      var nrMplus = player.nameRealm.replace(/'/g, "\\'");
      mplusHTML =
        '<button class="btn btn-muted" style="font-size:0.92rem;padding:0.3rem 0.8rem;" onclick="toggleMPlusForm(\'' + fnMplus + '\')">Request M+ Exclusion</button>' +
        '<div id="mplusForm-' + player.firstName + '" style="display:none;margin-top:0.75rem;">' +
        '<div style="font-size:0.92rem;color:var(--text-muted);margin-bottom:0.5rem;">Submit your Raider.io profile to request exclusion from dungeon loot priority.</div>' +
        '<input type="url" id="mplusUrl-' + player.firstName + '" placeholder="https://raider.io/characters/..." class="self-received-source" style="max-width:100%;font-size:1rem;">' +
        '<textarea id="mplusNotes-' + player.firstName + '" placeholder="Notes (optional)" rows="2" class="self-received-notes" style="max-width:100%;margin-top:0.4rem;"></textarea>' +
        '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
        '<button class="btn btn-gold" style="font-size:0.92rem;padding:0.3rem 0.8rem;" onclick="submitMPlusExclusionForm(\'' + nrMplus + '\',\'' + fnMplus + '\')">Submit</button>' +
        '<button class="btn btn-muted" style="font-size:0.92rem;padding:0.3rem 0.8rem;" onclick="document.getElementById(\'mplusForm-' + player.firstName + '\').style.display=\'none\'">Cancel</button>' +
        '</div>' +
        '<p class="self-received-note">An officer will review your request. Once approved you will no longer need to do the required weekly M+ dungeons.</p>' +
        '</div>';
    } else {
      mplusHTML = '<span style="font-size:0.92rem;color:var(--text-muted);">M+ exclusion requests are currently closed.</span>';
    }
  }

  // Build received lookup from loot history
  var receivedMap = {};
  if (lootEntry && lootEntry.items) {
    for (var ri = 0; ri < lootEntry.items.length; ri++) {
      var ri_obj = lootEntry.items[ri];
      var ri_name = typeof ri_obj === 'string' ? ri_obj : ri_obj.name;
      var ri_key = normalise(ri_name);
      if (!receivedMap[ri_key]) receivedMap[ri_key] = [];
      receivedMap[ri_key].push(typeof ri_obj === 'object' ? ri_obj : { name: ri_name });
    }
  }

  // Self-received (officer-approved) lookup
  var selfRecItems = getSelfReceivedItems(player.firstName);
  var selfRecMap = {};
  for (var sr = 0; sr < selfRecItems.length; sr++) {
    selfRecMap[normalise(selfRecItems[sr].item)] = selfRecItems[sr];
  }

  // Priority list
  var bisItems = getBisItems(player.firstName);
  var rows = '';
  for (var bi = 0; bi < bisItems.length; bi++) {
    var entry = bisItems[bi];
    var item = entry.item, bisSlot = entry.slot;
    var rank = getRank(player.firstName, item);
    var slot = (DATA.itemSlots || {})[item] || bisSlot || '';
    var isGen = (item === 'M+' || item === 'Crafted' || item === 'Catalyst');
    var received = receivedMap[normalise(item)] || null;
    var selfRec = selfRecMap[normalise(item)] || null;
    var isReceived = received || selfRec;
    var rowId = 'bisrow-' + player.firstName + '-' + bi;
    rows += '<div class="priority-row' + (isReceived ? ' bis-received' : '') + '" id="' + rowId + '" style="grid-template-columns:auto auto 1fr auto;">';
    rows += isGen ? '<span style="font-size:0.97rem;color:var(--text-dim);min-width:40px;text-align:center;">-</span>' : rankPillHTML(rank);
    rows += '<span class="priority-item-slot" style="color:' + getSlotColor(slot) + ';">' + slot + '</span>';
    rows += '<span class="priority-item-name" style="text-align:right;" title="' + item + '">' + item + '</span>';
    if (received) {
      var badges = '';
      for (var rv = 0; rv < received.length; rv++) {
        var rv_diff = received[rv].difficulty || '';
        var rv_date = received[rv].date || '';
        badges += '<span class="bis-received-badge">' + (rv_diff ? rv_diff + ' - ' : '') + rv_date + '</span>';
      }
      rows += '<div style="display:flex;flex-direction:column;gap:2px;align-items:flex-end;">' + badges + '</div>';
    } else if (selfRec) {
      rows += '<span class="bis-self-received-badge">' + (selfRec.source || 'Self-reported') + '</span>';
    } else {
      var defaultSrc  = isGen ? item : '';
      var officerFlag = backTo === 'officer' ? 'true' : 'false';
      rows += '<button class="mark-received-btn" onclick="event.stopPropagation();showSelfReceivedForm(\'' +
        player.firstName.replace(/'/g, "\\'") + '\',\'' + item.replace(/'/g, "\\'") + '\',\'' + slot.replace(/'/g, "\\'") + '\',\'' + rowId + '\',\'' + defaultSrc.replace(/'/g, "\\'") + '\',' + officerFlag + ')">Mark received</button>';
    }
    rows += '</div>';
    rows += '<div class="self-received-form" id="form-' + rowId + '" style="display:none;"></div>';
  }
  var bisReceivedCount = 0;
  for (var bci = 0; bci < bisItems.length; bci++) {
    var bci_key = normalise(bisItems[bci].item);
    if (receivedMap[bci_key] || selfRecMap[bci_key]) bisReceivedCount++;
  }
  var bisCompletionHTML = bisItems.length
    ? '<span id="bis-completion-' + player.firstName + '" style="font-size:0.95rem;"><span style="color:var(--gold-light);font-weight:600;">' + Math.round((bisReceivedCount / bisItems.length) * 100) + '%</span><span style="color:var(--text-muted);font-weight:400;"> (' + bisReceivedCount + '/' + bisItems.length + ')</span></span>'
    : '';

  var fullyBisBadge = (bisItems.length > 0 && bisReceivedCount === bisItems.length)
    ? '<span class="badge" style="background:rgba(212,175,55,0.15);color:var(--gold);border:1px solid rgba(212,175,55,0.45);font-weight:700;">Fully BiS</span>'
    : '';

  var priorityHTML = bisItems.length
    ? '<div class="priority-list">' +
    '<div class="priority-row" style="grid-template-columns:auto auto 1fr;background:transparent;border:none;padding:0.2rem 0.8rem;">' +
    '<span style="font-size:0.9rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text);">Prio</span>' +
    '<span style="font-size:0.9rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text);">Slot</span>' +
    '<span style="font-size:0.9rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text);text-align:right;">Item / Source</span>' +
    '</div>' + rows + '</div>'
    : '<p class="no-items-msg">No BiS items on record yet.</p>';

  var backLabel = backTo === 'officer' ? '<- Back to dashboard' : '<- Back to roster';
  var backAction = backTo === 'officer'
    ? 'var ir=document.getElementById(\'inlineProfileRow\');if(ir)ir.remove();selectedOfficerPlayer=null;document.querySelectorAll(\'.player-row\').forEach(function(r){r.classList.remove(\'selected\')});'
    : 'showView(\'landing\');document.getElementById(\'playerSelect\').value=\'\';';

  var officerActionsHTML = '';
  if (backTo === 'officer') {
    var currentNote = ((DATA && DATA.playerNotes) || {})[player.nameRealm] || '';
    var fnSafe = player.firstName.replace(/'/g, "\\'");
    var nrSafe = player.nameRealm.replace(/'/g, "\\'");
    officerActionsHTML =
      '<div class="profile-section">' +
      '<div class="section-label" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" onclick="var d=document.getElementById(\'player-settings-' + fnSafe + '\');var hint=document.getElementById(\'player-settings-hint-' + fnSafe + '\');var open=d.style.display!==\'none\';d.style.display=open?\'none\':\'\';hint.textContent=open?\'click to expand\':\'click to collapse\';">Player Settings<span id="player-settings-hint-' + fnSafe + '" style="font-size:0.95rem;color:var(--text-dim);">click to expand</span></div>' +
      '<div id="player-settings-' + fnSafe + '" style="display:none;">' +
      '<div style="display:flex;flex-direction:column;gap:0.75rem;margin-top:0.5rem;">' +
      '<div style="display:flex;align-items:center;gap:0.75rem;">' +
      '<span style="font-size:0.92rem;color:var(--text-muted);min-width:3.5rem;">Role</span>' +
      '<select id="roleSelect-' + player.firstName + '" class="self-received-source" style="font-size:0.92rem;padding:0.25rem 0.5rem;max-width:10rem;" onchange="savePlayerField(\'' + nrSafe + '\',\'' + fnSafe + '\',\'role\',this.value)">' +
      '<option value="Tank"' + (player.role === 'Tank' ? ' selected' : '') + '>Tank</option>' +
      '<option value="Heal"' + (player.role === 'Heal' ? ' selected' : '') + '>Heal</option>' +
      '<option value="Melee"' + (player.role === 'Melee' ? ' selected' : '') + '>Melee</option>' +
      '<option value="Ranged"' + (player.role === 'Ranged' ? ' selected' : '') + '>Ranged</option>' +
      '</select>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:0.75rem;">' +
      '<span style="font-size:0.92rem;color:var(--text-muted);min-width:3.5rem;">Trial</span>' +
      '<button id="trialToggle-' + player.firstName + '" class="btn ' + (player.isTrial ? 'btn-gold' : 'btn-muted') + '" style="font-size:0.88rem;padding:0.25rem 0.75rem;" onclick="togglePlayerTrial(\'' + nrSafe + '\',\'' + fnSafe + '\')">' + (player.isTrial ? 'Remove Trial' : 'Mark as Trial') + '</button>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:0.75rem;">' +
      '<span style="font-size:0.92rem;color:var(--text-muted);min-width:3.5rem;">Bench</span>' +
      '<button id="benchToggle-' + player.firstName + '" class="btn ' + (player.isBench ? 'btn-gold' : 'btn-muted') + '" style="font-size:0.88rem;padding:0.25rem 0.75rem;" onclick="togglePlayerBench(\'' + nrSafe + '\',\'' + fnSafe + '\')">' + (player.isBench ? 'Remove from Bench' : 'Move to Bench') + '</button>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:0.75rem;">' +
      '<span style="font-size:0.92rem;color:var(--text-muted);min-width:3.5rem;">M+ Excl.</span>' +
      '<button id="mplusExclToggle-' + player.firstName + '" class="btn ' + (player.mPlusExcluded ? 'btn-gold' : 'btn-muted') + '" style="font-size:0.88rem;padding:0.25rem 0.75rem;" onclick="toggleMPlusExcluded(\'' + nrSafe + '\',\'' + fnSafe + '\')">' + (player.mPlusExcluded ? 'Remove Exclusion' : 'Mark as Excluded') + '</button>' +
      '</div>' +
      '<div id="playerSettingsMsg-' + player.firstName + '" style="font-size:0.92rem;color:var(--text-muted);min-height:1.2rem;"></div>' +
      '<div style="display:flex;align-items:center;gap:0.75rem;padding-top:0.25rem;border-top:1px solid var(--border);margin-top:0.5rem;">' +
      '<span style="font-size:0.92rem;color:var(--text-muted);min-width:3.5rem;">Remove</span>' +
      '<button id="removePlayerBtn-' + player.firstName + '" class="btn btn-danger" style="font-size:0.88rem;padding:0.25rem 0.75rem;" onclick="confirmRemovePlayer(\'' + nrSafe + '\',\'' + fnSafe + '\')">Remove Player</button>' +
      '<div id="removePlayerConfirm-' + player.firstName + '" style="display:none;gap:0.5rem;align-items:center;">' +
      '<span style="font-size:0.92rem;color:var(--melee);">Confirm?</span>' +
      '<button class="btn btn-danger" style="font-size:0.88rem;padding:0.25rem 0.75rem;" onclick="executeRemovePlayer(\'' + nrSafe + '\',\'' + fnSafe + '\')">Yes, Remove</button>' +
      '<button class="btn btn-muted" style="font-size:0.88rem;padding:0.25rem 0.75rem;" onclick="cancelRemovePlayer(\'' + fnSafe + '\')">Cancel</button>' +
      '</div>' +
      '<span id="removePlayerMsg-' + player.firstName + '" style="display:none;font-size:0.92rem;"></span>' +
      '</div>' +
      '</div>' +
      '<div style="margin-top:1rem;">' +
      '<div style="font-size:0.88rem;color:var(--text-muted);margin-bottom:0.35rem;text-transform:uppercase;letter-spacing:0.08em;">Officer Notes</div>' +
      '<textarea id="playerNote-' + player.firstName + '" rows="3" class="self-received-notes" style="width:100%;box-sizing:border-box;font-size:0.92rem;">' + currentNote.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</textarea>' +
      '<div style="display:flex;gap:0.5rem;margin-top:0.4rem;align-items:center;">' +
      '<button class="btn btn-muted" style="font-size:0.88rem;padding:0.25rem 0.75rem;" onclick="savePlayerNote(\'' + nrSafe + '\',\'' + fnSafe + '\')">Save Note</button>' +
      '<span id="playerNoteMsg-' + player.firstName + '" style="font-size:0.92rem;color:var(--text-muted);"></span>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>';
  }

  var html =
    '<div class="profile-card">' +
    '<div class="role-bar role-bar-' + player.role + '"></div>' +
    '<div style="padding:0.6rem 1.25rem;border-bottom:1px solid var(--border);">' +
    '<button onclick="' + backAction + '" style="background:none;border:none;color:var(--text);font-family:\'Rajdhani\',sans-serif;font-size:0.9rem;letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;padding:0;">' + backLabel + '</button>' +
    '</div>' +
    '<div class="profile-header">' +
    '<div class="profile-avatar avatar-' + player.role + '">' + initials + '</div>' +
    '<div class="profile-identity">' +
    '<div class="profile-name">' + displayName + '</div>' +
    '<div class="profile-realm">' + player.firstName + '-' + player.realm + '</div>' +
    '<div class="profile-badges"><span class="badge badge-' + player.role + '">' + player.role + '</span>' + trialBadge + benchBadge + classLine + fullyBisBadge + '</div>' +
    '</div>' +
    '</div>' +
    '<div class="profile-section"' +
    (backTo === 'officer'
      ? ' onclick="loadAttendanceHistory(\'' + player.firstName.replace(/'/g, "\\'") + '\')" style="cursor:pointer;"'
      : (hasPenalties ? ' onclick="var d=document.getElementById(\'attend-detail-' + player.firstName + '\');d.style.display=d.style.display===\'none\'?\'flex\':\'none\';" style="cursor:pointer;"' : '')) + '>' +
    '<div class="section-label" style="display:flex;justify-content:space-between;align-items:center;">Attendance' +
    (backTo === 'officer'
      ? '<span class="attend-history-hint" style="font-size:0.95rem;color:var(--text-dim);">click to expand</span>'
      : (hasPenalties ? '<span style="font-size:0.95rem;color:var(--text-dim);">click to expand</span>' : '')) +
    '</div>' +
    '<div class="attend-row"><div class="attend-bar-wrap"><div class="attend-bar" style="width:' + barWidth + '"></div></div><span class="attend-label">' + attendPct + '</span></div>' +
    (backTo === 'officer'
      ? '<div id="attend-history-' + player.firstName + '" style="display:none;margin-top:0.6rem;"></div>'
      : attendExtra) +
    '</div>' +
    '<div class="profile-section" onclick="var l=document.getElementById(\'loot-list-' + player.firstName + '\');l.style.display=l.style.display===\'none\'?\'grid\':\'none\';" style="cursor:pointer;">' +
    '<div class="section-label" style="display:flex;justify-content:space-between;align-items:center;">Items Received <span style="font-size:0.95rem;color:var(--text-dim);">click to expand</span></div>' +
    '<div style="font-size:1.1rem;font-weight:600;color:var(--gold);">' + lootCount + ' item' + (lootCount !== 1 ? 's' : '') + ' this tier</div>' +
    (lastItems.length
      ? (function() {
          var lastDate = lastItems[0].date || '';
          var itemLines = '';
          for (var lx = 0; lx < lastItems.length; lx++) {
            var lxi = lastItems[lx];
            var lxColor = lxi.difficulty === 'Mythic' ? '#b085f0' : lxi.difficulty === 'Heroic' ? '#4dd9e0' : 'var(--gold)';
            itemLines += '<div' + (lx > 0 ? ' style="margin-top:0.3rem;padding-top:0.3rem;border-top:1px solid var(--border);"' : '') + '>' +
              '<div style="font-size:1rem;color:' + lxColor + ';font-weight:600;">' + lxi.name + '</div>' +
              (lxi.difficulty ? '<div style="font-size:0.88rem;color:var(--text-muted);margin-top:0.1rem;">' + lxi.difficulty + '</div>' : '') +
              '</div>';
          }
          return '<div style="margin-top:0.6rem;padding:0.5rem 0.75rem;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:4px;display:flex;align-items:center;justify-content:space-between;" onclick="event.stopPropagation();">' +
            '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:0.8rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:0.25rem;">Last received' + (lastDate ? ' - ' + lastDate : '') + '</div>' +
            itemLines +
            '</div>' +
            '<span style="font-size:1.8rem;font-weight:700;color:var(--gold);line-height:1;margin-left:0.75rem;">&#8679;</span>' +
            '</div>';
        })()
      : '') +
    '<div id="loot-list-' + player.firstName + '" style="display:none;margin-top:0.75rem;grid-template-columns:1fr 1fr;gap:0 1rem;">' + lootItemsHTML + '</div>' +
    '</div>' +
    '<div class="profile-section"><div class="section-label">BiS Link</div>' + bisHTML + '</div>' +
    '<div class="profile-section" onclick="var l=document.getElementById(\'prio-list-' + player.firstName + '\');l.style.display=l.style.display===\'none\'?\'block\':\'none\';" style="cursor:pointer;">' +
    '<div class="section-label" style="display:flex;justify-content:space-between;align-items:center;">BiS List' + bisCompletionHTML + '<span style="font-size:0.95rem;color:var(--text-dim);">click to expand</span></div>' +
    '<div id="prio-list-' + player.firstName + '" style="display:none;">' + priorityHTML + '</div>' +
    '</div>' +
    (mplusHTML ? '<div class="profile-section"><div class="section-label">M+ Exclusion</div>' + mplusHTML + '</div>' : '') +
    officerActionsHTML +
    '</div>';

  if (container) { container.innerHTML = html; }
  else { document.getElementById('profileView').innerHTML = html; }
  if (backTo === 'officer') updateBisAllowDiv(player.nameRealm, player.firstName);
}

function loadAttendanceHistory(firstName) {
  var content = document.getElementById('attend-history-' + firstName);
  if (!content) return;
  var hint = content.parentNode ? content.parentNode.querySelector('.attend-history-hint') : null;

  if (content.style.display !== 'none') {
    content.style.display = 'none';
    if (hint) hint.textContent = 'click to expand';
    return;
  }

  if (content.dataset.loaded) {
    content.style.display = 'block';
    if (hint) hint.textContent = 'click to collapse';
    return;
  }

  content.innerHTML = '<span style="color:var(--text-muted);font-size:0.95rem;padding:0.5rem 0;display:block;">Loading...</span>';
  content.style.display = 'block';

  var cbName = '_attendHistCb' + firstName.replace(/[^a-zA-Z0-9]/g, '_');
  window[cbName] = function(result) {
    delete window[cbName];
    content.dataset.loaded = '1';
    if (hint) hint.textContent = 'click to collapse';

    var history = (result && result.history) || [];
    history = history.slice().reverse();

    if (!history.length) {
      content.innerHTML = '<p style="color:var(--text-muted);font-size:0.95rem;padding:0.5rem 0;">No attendance records found.</p>';
      return;
    }

    var counts = {};
    for (var i = 0; i < history.length; i++) {
      var s = history[i].status;
      counts[s] = (counts[s] || 0) + 1;
    }

    function statusColor(s) {
      if (s === 'Present') return 'var(--heal)';
      if (s === 'Late')    return 'var(--gold)';
      if (s === 'No Show') return 'var(--melee)';
      return 'var(--gold-light)';
    }

    var summaryParts = [];
    var order = ['Present', 'Late', 'No Show', 'Excused'];
    for (var oi = 0; oi < order.length; oi++) {
      var st = order[oi];
      if (counts[st]) summaryParts.push('<span style="color:' + statusColor(st) + ';">' + counts[st] + ' ' + st + '</span>');
    }
    var otherKeys = Object.keys(counts).filter(function(k) { return order.indexOf(k) === -1; });
    for (var ok = 0; ok < otherKeys.length; ok++) {
      summaryParts.push('<span style="color:var(--text-muted);">' + counts[otherKeys[ok]] + ' ' + otherKeys[ok] + '</span>');
    }

    var html = '<div style="font-size:0.88rem;color:var(--text-muted);margin-bottom:0.6rem;display:flex;gap:0.5rem;flex-wrap:wrap;">' + summaryParts.join('<span style="color:var(--border-mid);">|</span>') + '</div>';
    html += '<div style="max-height:260px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;">';
    for (var j = 0; j < history.length; j++) {
      var entry = history[j];
      html += '<div style="display:flex;justify-content:space-between;font-size:0.95rem;padding:0.28rem 0.75rem;border-bottom:1px solid var(--border);">';
      html += '<span style="color:var(--text);">' + entry.date + '</span>';
      html += '<span style="color:' + statusColor(entry.status) + ';font-weight:600;">' + entry.status + '</span>';
      html += '</div>';
    }
    html += '</div>';
    content.innerHTML = html;
  };

  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    content.innerHTML = '<p style="color:var(--melee);font-size:0.95rem;padding:0.5rem 0;">Failed to load. Try again.</p>';
  };
  script.src = WEB_APP_URL + '?action=getPlayerAttendanceFull&firstName=' + encodeURIComponent(firstName) + '&callback=' + cbName;
  document.head.appendChild(script);
}
