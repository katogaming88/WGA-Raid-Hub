var TEAMS = {
  phoenix: {
    gasUrl: 'https://script.google.com/macros/s/AKfycbxrQdQGqbBTELWm7huWChdbES0ry7WFZetlELWuEdI0T6lfbXEzrqx9Vo5yA-b9dW4y7A/exec',
    name: 'Team Phoenix',
    officerPass: 'phoenix2'
  },
  hellfire: {
    gasUrl: 'https://script.google.com/macros/s/AKfycbwIpnJyZDwWr5MmWIv7iyaDZ0OajPTFePMTYfIy8WG7jhg7pakQTvTVSM3SLihrKxBb/exec', // TODO: fill in after Hellfire Rollers deploys their GAS web app
    name: 'Hellfire Rollers',
    officerPass: 'hellfire2' // TODO: fill in
  }
};

var _teamParam = (location.search.match(/[?&]team=([^&]+)/) || [])[1];
if (_teamParam && _teamParam in TEAMS) {
  sessionStorage.setItem('wga_team', _teamParam);
} else {
  _teamParam = sessionStorage.getItem('wga_team') || 'phoenix';
}
var _teamCfg = TEAMS[_teamParam] || TEAMS.phoenix;
var TEAM_SLUG = _teamParam in TEAMS ? _teamParam : 'phoenix';
var TEAM_NAME = _teamCfg.name;
var WEB_APP_URL = _teamCfg.gasUrl;
var VERSION = '2.20.0';
var DATA = null;
var ACTIVE_SEASON = null; // null = All Seasons; set by officer.js when a season is selected

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

var CLASS_ARMOR_TYPE = {
  'Death Knight': 'Plate',
  'Demon Hunter': 'Leather',
  'Druid': 'Leather',
  'Evoker': 'Mail',
  'Hunter': 'Mail',
  'Mage': 'Cloth',
  'Monk': 'Leather',
  'Paladin': 'Plate',
  'Priest': 'Cloth',
  'Rogue': 'Leather',
  'Shaman': 'Mail',
  'Warlock': 'Cloth',
  'Warrior': 'Plate'
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
// onCoreReady fires once the fast core chunk is loaded and the page can render.
// onHeavyReady (optional) fires once loot/attendance/BiS/priority data arrives.
function loadData(onCoreReady, onHeavyReady) {
  var loadingEl = document.getElementById('loadingMsg');
  function showError(msg) {
    if (loadingEl) { loadingEl.className = 'state-msg error'; loadingEl.innerHTML = msg; }
  }

  window._rosterCoreCallback = function (data) {
    delete window._rosterCoreCallback;
    if (data.error) { showError('Could not load roster data. ' + data.error); return; }
    DATA = data;
    DATA._loadedAt = new Date();
    try { onCoreReady(); } catch (e) { showError('Could not load roster data. ' + e.message); return; }

    var heavyScript = document.createElement('script');
    heavyScript.onerror = function () { delete window._rosterHeavyCallback; };
    window._rosterHeavyCallback = function (heavy) {
      delete window._rosterHeavyCallback;
      if (!heavy || heavy.error) return;
      DATA.lootCounts = heavy.lootCounts;
      DATA.attendanceDetails = heavy.attendanceDetails;
      DATA.rawAttendanceData = heavy.rawAttendanceData;
      DATA.recentAttendanceTrend = heavy.recentAttendanceTrend;
      DATA.bisList = heavy.bisList;
      DATA.priorityOrder = heavy.priorityOrder;
      DATA.itemSlots = heavy.itemSlots;
      DATA.itemArmorTypes = heavy.itemArmorTypes || {};
      DATA.itemBosses = heavy.itemBosses || {};
      DATA.selfReceived = heavy.selfReceived;
      if (typeof populateBossFilters === 'function') populateBossFilters();
      if (onHeavyReady) onHeavyReady();
    };
    heavyScript.src = WEB_APP_URL + '?chunk=heavy&callback=_rosterHeavyCallback';
    document.head.appendChild(heavyScript);
  };

  var coreScript = document.createElement('script');
  coreScript.onerror = function () {
    delete window._rosterCoreCallback;
    showError('Could not load roster data.');
  };
  coreScript.src = WEB_APP_URL + '?chunk=core&callback=_rosterCoreCallback';
  document.head.appendChild(coreScript);

  setTimeout(function () {
    if (!DATA) { showError('Request timed out.'); }
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
  var bisItems = getBisItems(firstName);
  if (!bisItems.length) return;
  var selfRecItems = getSelfReceivedItems(firstName);
  var selfRecMap = {};
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

function getSeasonLootItems(firstName) {
  var entry = getLootEntry(firstName);
  var items = (entry && entry.items) || [];
  if (!ACTIVE_SEASON) return items;
  return items.filter(function (item) { return item.season === ACTIVE_SEASON; });
}

function getSeasonLootEntry(firstName) {
  if (!ACTIVE_SEASON) return getLootEntry(firstName);
  var items = getSeasonLootItems(firstName);
  var heroic = 0, mythic = 0;
  for (var i = 0; i < items.length; i++) {
    if (items[i].difficulty === 'Heroic') heroic++;
    else if (items[i].difficulty === 'Mythic') mythic++;
  }
  return { count: items.length, heroicCount: heroic, mythicCount: mythic, items: items };
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

function attendColor(pct) { return pct >= 95 ? 'var(--heal)' : pct >= 75 ? 'var(--gold)' : 'var(--melee)'; }

function attendTrendColor(status) {
  if (status === 'Present') return '#52b788';
  if (status === 'Bench') return '#7EC8E3';
  if (status === 'Excused') return '#d4a843';
  if (status === 'Medical Leave') return '#A8DADC';
  if (status === 'No Show') return '#e05252';
  return '#555';
}

function attendTrendValue(status) {
  if (status === 'Present') return 1.0;
  if (status === 'Bench') return 0.85;
  if (status === 'Medical Leave') return 0.7;
  if (status === 'Excused') return 0.5;
  if (status === 'No Show') return 0.0;
  return 0.5;
}

function showAttendTip(evt, text) {
  var tip = document.getElementById('attend-trend-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'attend-trend-tip';
    tip.style.cssText = 'position:fixed;background:var(--bg-elevated);border:1px solid var(--border-mid);border-radius:4px;padding:0.45rem 0.7rem;font-size:0.8rem;color:var(--text-muted);white-space:nowrap;pointer-events:none;z-index:200;font-family:Rajdhani,sans-serif;letter-spacing:0.03em;';
    document.body.appendChild(tip);
  }
  tip.textContent = text;
  tip.style.display = 'block';
  tip.style.left = (evt.clientX + 12) + 'px';
  tip.style.top = (evt.clientY - 32) + 'px';
}

function hideAttendTip() {
  var tip = document.getElementById('attend-trend-tip');
  if (tip) tip.style.display = 'none';
}

function attendTrendMonthColor(avg) {
  if (avg >= 0.9) return '#52b788';
  if (avg >= 0.7) return '#7EC8E3';
  if (avg >= 0.5) return '#d4a843';
  return '#e05252';
}

function renderAttendTrend(firstName) {
  var trend = (DATA.recentAttendanceTrend || {})[firstName];
  if (!trend || !trend.length) return '';

  var nights = trend.slice().reverse(); // oldest left, newest right

  // Aggregate by calendar month
  var monthMap = {}, monthOrder = [];
  var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (var i = 0; i < nights.length; i++) {
    var key = nights[i].date.substring(0, 7); // "yyyy-MM"
    if (!monthMap[key]) { monthMap[key] = []; monthOrder.push(key); }
    monthMap[key].push(nights[i]);
  }

  // Fall back to per-night dots if only one month of data
  if (monthOrder.length <= 1) {
    var n = nights.length;
    var W = Math.max(300, n * 24), H = 56, PAD = 6, R = 4;
    var points = [];
    for (var i = 0; i < n; i++) {
      var x = n === 1 ? W / 2 : PAD + (i / (n - 1)) * (W - PAD * 2);
      var y = PAD + (1 - attendTrendValue(nights[i].status)) * (H - PAD * 2);
      points.push({ x: x, y: y, night: nights[i] });
    }
    var lineStr = points.map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
    var svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" style="display:block;overflow:visible;">';
    svg += '<polyline points="' + lineStr + '" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>';
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      var tip = p.night.date + ': ' + p.night.status;
      svg += '<g style="cursor:default;" onmouseover="showAttendTip(event,' + "'" + tip + "')" + '" onmouseout="hideAttendTip()">';
      svg += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + R + '" fill="' + attendTrendColor(p.night.status) + '"/>';
      svg += '</g>';
    }
    svg += '</svg>';
    return '<div style="overflow-x:auto;overflow-y:hidden;margin-top:0.75rem;">' + svg + '</div>';
  }

  var months = monthOrder.map(function (key) {
    var entries = monthMap[key];
    var sum = 0;
    for (var j = 0; j < entries.length; j++) sum += attendTrendValue(entries[j].status);
    var avg = sum / entries.length;
    var parts = key.split('-');
    var label = MONTH_NAMES[parseInt(parts[1], 10) - 1] + ' ' + parts[0];
    var pct = Math.round(avg * 100);
    return { key: key, label: label, avg: avg, count: entries.length, pct: pct };
  });

  var n = months.length;
  var W = Math.max(200, n * 64), H = 56, PAD = 16, R = 7;

  var points = [];
  for (var i = 0; i < n; i++) {
    var x = n === 1 ? W / 2 : PAD + (i / (n - 1)) * (W - PAD * 2);
    var y = PAD + (1 - months[i].avg) * (H - PAD * 2);
    points.push({ x: x, y: y, m: months[i] });
  }

  var lineStr = points.map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');

  var svg = '<svg width="' + W + '" height="' + (H + 18) + '" viewBox="0 0 ' + W + ' ' + (H + 18) + '" style="display:block;overflow:visible;">';
  svg += '<polyline points="' + lineStr + '" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>';
  for (var i = 0; i < points.length; i++) {
    var p = points[i];
    var col = attendTrendMonthColor(p.m.avg);
    var tip = p.m.label + ': ' + p.m.pct + '% (' + p.m.count + ' raid' + (p.m.count !== 1 ? 's' : '') + ')';
    svg += '<g style="cursor:default;" onmouseover="showAttendTip(event,' + "'" + tip + "')" + '" onmouseout="hideAttendTip()">';
    svg += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + R + '" fill="' + col + '"/>';
    svg += '<text x="' + p.x.toFixed(1) + '" y="' + (H + 14) + '" text-anchor="middle" font-size="10" fill="rgba(255,255,255,0.45)" font-family="sans-serif">' + p.m.label.split(' ')[0] + '</text>';
    svg += '</g>';
  }
  svg += '</svg>';

  return '<div style="overflow-x:auto;overflow-y:hidden;margin-top:0.75rem;">' + svg + '</div>';
}

function formatJoinDate(dateStr) {
  if (!dateStr) return '';
  var parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var m = parseInt(parts[1], 10) - 1;
  if (m < 0 || m > 11) return dateStr;
  return months[m] + ' ' + parseInt(parts[2], 10) + ', ' + parts[0];
}

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
  var sources = ['M+', 'Great Vault', 'Crafted', 'Catalyst', 'Bonus Roll', 'Other'];
  var opts = '<option value="">-- How did you get it? --</option>';
  for (var si = 0; si < sources.length; si++) {
    opts += '<option value="' + sources[si] + '"' + (sources[si] === defaultSource ? ' selected' : '') + '>' + sources[si] + '</option>';
  }
  var fnSafe = firstName.replace(/'/g, "\\'");
  var itemSafe = item.replace(/'/g, "\\'");
  var slotSafe = slot.replace(/'/g, "\\'");
  var submitFn = isOfficer
    ? 'submitDirectMarkReceived(\'' + fnSafe + '\',\'' + itemSafe + '\',\'' + slotSafe + '\',\'' + rowId + '\')'
    : 'submitSelfReceivedRequest(\'' + fnSafe + '\',\'' + itemSafe + '\',\'' + slotSafe + '\',\'' + rowId + '\')';
  var submitLabel = isOfficer ? 'Mark received' : 'Submit request';
  var noteText = isOfficer ? '' : '<p class="self-received-note">An officer will review and approve this. Once approved it will appear on your profile.</p>';
  var formHtml =
    '<div class="self-received-form-inner" onclick="event.stopPropagation()">' +
    '<div style="display:flex;gap:0.5rem;margin-bottom:0.4rem;">' +
    '<select id="diff-' + rowId + '" class="self-received-source" style="flex:0 0 auto;width:auto;">' +
    '<option value="Mythic" selected>Mythic</option>' +
    '<option value="Heroic">Heroic</option>' +
    '</select>' +
    '<select class="self-received-source" id="src-' + rowId + '" style="flex:1;">' + opts + '</select>' +
    '</div>' +
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
  var diffEl = document.getElementById('diff-' + rowId);
  if (!sourceEl || !sourceEl.value) { if (sourceEl) sourceEl.style.borderColor = 'var(--melee)'; return; }
  var diff = diffEl ? diffEl.value : 'Mythic';
  var source = diff + ': ' + sourceEl.value;
  var data = { player: firstName, item: item, slot: slot, source: source, notes: notesEl ? notesEl.value : '' };
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
  var notesEl = document.getElementById('notes-' + rowId);
  var diffEl = document.getElementById('diff-' + rowId);
  if (!sourceEl || !sourceEl.value) { if (sourceEl) sourceEl.style.borderColor = 'var(--melee)'; return; }
  var diff = diffEl ? diffEl.value : 'Mythic';
  var source = diff + ': ' + sourceEl.value;
  var data = { player: firstName, item: item, slot: slot, source: source, notes: notesEl ? notesEl.value : '' };
  var formEl = document.getElementById('form-' + rowId);
  if (formEl) formEl.innerHTML = '<p style="font-size:0.95rem;color:var(--text-muted);padding:0.5rem 0;">Saving...</p>';
  var cbName = '_directRecCb' + rowId.replace(/[^a-zA-Z0-9]/g, '_');
  window[cbName] = function (result) {
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
  script.onerror = function () {
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

  // Loot (season-filtered when ACTIVE_SEASON is set)
  var lootEntry = getSeasonLootEntry(player.firstName);
  var allLootEntry = getLootEntry(player.firstName); // unfiltered, for received map
  var lootCount = lootEntry ? lootEntry.count : 0;
  var lootItemsHTML = '';
  var lastItems = [];
  var seasonLootItems = getSeasonLootItems(player.firstName);
  if (seasonLootItems.length > 0) {
    var sortedLoot = seasonLootItems.slice().sort(function (a, b) {
      return new Date(b.date) - new Date(a.date);
    });
    var lastDate = sortedLoot[0].date;
    for (var ld = 0; ld < sortedLoot.length; ld++) {
      if (sortedLoot[ld].date === lastDate) lastItems.push(sortedLoot[ld]);
      else break;
    }
    for (var li = 0; li < seasonLootItems.length; li++) {
      var li_obj = seasonLootItems[li];
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

  // Build received lookup from full (unfiltered) loot history so BiS markers are always accurate
  var receivedMap = {};
  var receivedItems = (allLootEntry && allLootEntry.items) || [];
  for (var ri = 0; ri < receivedItems.length; ri++) {
    var ri_obj = receivedItems[ri];
    var ri_name = typeof ri_obj === 'string' ? ri_obj : ri_obj.name;
    var ri_key = normalise(ri_name);
    if (!receivedMap[ri_key]) receivedMap[ri_key] = [];
    receivedMap[ri_key].push(typeof ri_obj === 'object' ? ri_obj : { name: ri_name });
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
    var defaultSrc = isGen ? item : '';
    var isOfficer = backTo === 'officer';
    var officerFlag = isOfficer ? 'true' : 'false';
    var markRecvBtn = '<button class="mark-received-btn" style="font-size:0.78rem;padding:2px 7px;margin-top:2px;" onclick="event.stopPropagation();showSelfReceivedForm(\'' +
      player.firstName.replace(/'/g, "\\'") + '\',\'' + item.replace(/'/g, "\\'") + '\',\'' + slot.replace(/'/g, "\\'") + '\',\'' + rowId + '\',\'' + defaultSrc.replace(/'/g, "\\'") + '\',' + officerFlag + ')">Mark received</button>';
    if (received) {
      var badges = '';
      for (var rv = 0; rv < received.length; rv++) {
        var rv_diff = received[rv].difficulty || '';
        var rv_date = received[rv].date || '';
        badges += '<span class="bis-received-badge">' + (rv_diff ? rv_diff + ' - ' : '') + rv_date + '</span>';
      }
      rows += '<div style="display:flex;flex-direction:column;gap:2px;align-items:flex-end;">' + badges + (isOfficer ? markRecvBtn : '') + '</div>';
    } else if (selfRec) {
      rows += '<div style="display:flex;flex-direction:column;gap:2px;align-items:flex-end;"><span class="bis-self-received-badge">' + (selfRec.source || 'Self-reported') + '</span>' + (isOfficer ? markRecvBtn : '') + '</div>';
    } else {
      rows += markRecvBtn;
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
    var classKeys = Object.keys(CLASS_SPECS).sort();
    var classOptHtml = '<option value="">-- Select class --</option>';
    for (var ci = 0; ci < classKeys.length; ci++) {
      classOptHtml += '<option value="' + classKeys[ci] + '"' + (player.class === classKeys[ci] ? ' selected' : '') + '>' + classKeys[ci] + '</option>';
    }
    var specOptHtml = '<option value="">-- Select spec --</option>';
    if (player.class && CLASS_SPECS[player.class]) {
      var specList = CLASS_SPECS[player.class].specs;
      for (var si = 0; si < specList.length; si++) {
        specOptHtml += '<option value="' + specList[si] + '"' + (player.spec === specList[si] ? ' selected' : '') + '>' + specList[si] + '</option>';
      }
    }
    var realmOptHtml = '';
    for (var ri = 0; ri < WOW_REALMS.length; ri++) {
      realmOptHtml += '<option value="' + WOW_REALMS[ri] + '"' + (player.realm === WOW_REALMS[ri] ? ' selected' : '') + '>' + WOW_REALMS[ri] + '</option>';
    }
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
      '<span style="font-size:0.92rem;color:var(--text-muted);min-width:3.5rem;">Class</span>' +
      '<select id="classSelect-' + player.firstName + '" class="self-received-source" style="font-size:0.92rem;padding:0.25rem 0.5rem;max-width:12rem;" onchange="officerUpdateClass(\'' + nrSafe + '\',\'' + fnSafe + '\',this.value)">' + classOptHtml + '</select>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:0.75rem;">' +
      '<span style="font-size:0.92rem;color:var(--text-muted);min-width:3.5rem;">Spec</span>' +
      '<select id="specSelect-' + player.firstName + '" class="self-received-source" style="font-size:0.92rem;padding:0.25rem 0.5rem;max-width:12rem;" onchange="savePlayerField(\'' + nrSafe + '\',\'' + fnSafe + '\',\'spec\',this.value)">' + specOptHtml + '</select>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">' +
      '<span style="font-size:0.92rem;color:var(--text-muted);min-width:3.5rem;">Name</span>' +
      '<input type="text" id="editNameInput-' + player.firstName + '" value="' + player.firstName + '" class="self-received-source" style="font-size:0.92rem;padding:0.25rem 0.5rem;max-width:9rem;">' +
      '<select id="editRealmSelect-' + player.firstName + '" class="self-received-source" style="font-size:0.92rem;padding:0.25rem 0.5rem;max-width:10rem;">' + realmOptHtml + '</select>' +
      '<button class="btn btn-muted" style="font-size:0.88rem;padding:0.25rem 0.75rem;" onclick="officerRenamePlayer(\'' + nrSafe + '\',\'' + fnSafe + '\')">Save</button>' +
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
      '<div style="display:flex;align-items:center;gap:0.75rem;">' +
      '<span style="font-size:0.92rem;color:var(--text-muted);min-width:3.5rem;">Joined</span>' +
      '<input type="date" id="joinDateInput-' + player.firstName + '" value="' + (player.joinDate || '') + '" class="self-received-source" style="font-size:0.92rem;padding:0.25rem 0.5rem;max-width:12rem;">' +
      '<button class="btn btn-muted" style="font-size:0.88rem;padding:0.25rem 0.75rem;" onclick="saveJoinDate(\'' + nrSafe + '\',\'' + fnSafe + '\')">Save</button>' +
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
    (player.joinDate ? '<div style="font-size:0.9rem;color:var(--text-muted);margin-top:0.35rem;">Joined: ' + formatJoinDate(player.joinDate) + '</div>' : '') +
    '</div>' +
    '</div>' +
    '<div class="profile-section">' +
    '<div class="section-label" style="display:flex;justify-content:space-between;align-items:center;' +
    (backTo === 'officer' || hasPenalties ? 'cursor:pointer;"' : '"') +
    (backTo === 'officer'
      ? ' onclick="loadAttendanceHistory(\'' + player.firstName.replace(/'/g, "\\'") + '\')"'
      : (hasPenalties ? ' onclick="var d=document.getElementById(\'attend-detail-' + player.firstName + '\');d.style.display=d.style.display===\'none\'?\'flex\':\'none\';"' : '')) + '>Attendance' +
    (backTo === 'officer'
      ? '<span class="attend-history-hint" style="font-size:0.95rem;color:var(--text-dim);">click to expand</span>'
      : (hasPenalties ? '<span style="font-size:0.95rem;color:var(--text-dim);">click to expand</span>' : '')) +
    '</div>' +
    '<div class="attend-row"><div class="attend-bar-wrap"><div class="attend-bar" style="width:' + barWidth + '"></div></div><span class="attend-label">' + attendPct + '</span></div>' +
    renderAttendTrend(player.firstName) +
    (backTo === 'officer'
      ? '<div id="attend-history-' + player.firstName + '" style="display:none;margin-top:0.6rem;"></div>'
      : attendExtra) +
    '</div>' +
    '<div class="profile-section">' +
    '<div class="section-label" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" onclick="var l=document.getElementById(\'loot-list-' + player.firstName + '\');l.style.display=l.style.display===\'none\'?\'grid\':\'none\';">Items Received <span style="font-size:0.95rem;color:var(--text-dim);">click to expand</span></div>' +
    '<div style="font-size:1.1rem;font-weight:600;color:var(--gold);">' + lootCount + ' item' + (lootCount !== 1 ? 's' : '') + (ACTIVE_SEASON ? ' — ' + ACTIVE_SEASON : ' this tier') + '</div>' +
    (lastItems.length
      ? (function () {
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
        return '<div style="margin-top:0.6rem;padding:0.5rem 0.75rem;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:4px;display:flex;align-items:center;justify-content:space-between;">' +
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
    '<div class="profile-section">' +
    '<div class="section-label" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" onclick="var l=document.getElementById(\'prio-list-' + player.firstName + '\');l.style.display=l.style.display===\'none\'?\'block\':\'none\';">BiS List' + bisCompletionHTML + '<span style="font-size:0.95rem;color:var(--text-dim);">click to expand</span></div>' +
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
  window[cbName] = function (result) {
    delete window[cbName];
    content.dataset.loaded = '1';
    if (hint) hint.textContent = 'click to collapse';

    var history = (result && result.history) || [];
    history = history.slice().sort(function (a, b) { return b.date < a.date ? -1 : b.date > a.date ? 1 : 0; });

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
      if (s === 'Late') return 'var(--gold)';
      if (s === 'No Show') return 'var(--melee)';
      if (s === 'Medical Leave') return '#7EC8E3';
      if (s === 'Not on Roster') return 'var(--text-muted)';
      return 'var(--gold-light)';
    }

    var summaryParts = [];
    var order = ['Present', 'Late', 'No Show', 'Excused', 'Medical Leave'];
    for (var oi = 0; oi < order.length; oi++) {
      var st = order[oi];
      if (counts[st]) summaryParts.push('<span style="color:' + statusColor(st) + ';">' + counts[st] + ' ' + st + '</span>');
    }
    var otherKeys = Object.keys(counts).filter(function (k) { return order.indexOf(k) === -1; });
    for (var ok = 0; ok < otherKeys.length; ok++) {
      summaryParts.push('<span style="color:var(--text-muted);">' + counts[otherKeys[ok]] + ' ' + otherKeys[ok] + '</span>');
    }

    var CARD_STATUSES = ['Present', 'Bench', 'Medical Leave', 'Excused', 'No Show', 'Not on Roster'];

    var html = '<div style="font-size:0.88rem;color:var(--text-muted);margin-bottom:0.6rem;display:flex;gap:0.5rem;flex-wrap:wrap;">' + summaryParts.join('<span style="color:var(--border-mid);">|</span>') + '</div>';
    html += '<div style="max-height:260px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;">';
    for (var j = 0; j < history.length; j++) {
      var entry = history[j];
      var isNOR = entry.status === 'Not on Roster';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;font-size:0.95rem;padding:0.28rem 0.75rem;border-bottom:1px solid var(--border);gap:0.5rem;">';
      html += '<span style="color:var(--text);white-space:nowrap;">' + entry.date + '</span>';
      if (isNOR) {
        html += '<span style="color:' + statusColor(entry.status) + ';font-weight:600;">' + entry.status + '</span>';
      } else {
        html += '<div style="display:flex;align-items:center;gap:0.4rem;">';
        html += '<div class="attend-status-wrap">';
        html += '<select class="attend-status-select attend-card-status-select" data-date="' + entry.date + '" data-name="' + firstName + '" data-old="' + entry.status + '" onchange="saveAttendanceFromCard(this)">';
        for (var k = 0; k < CARD_STATUSES.length; k++) {
          var s = CARD_STATUSES[k];
          html += '<option value="' + s + '"' + (entry.status === s ? ' selected' : '') + '>' + s + '</option>';
        }
        html += '</select></div>';
        html += '<span class="attend-save-ind" style="min-width:40px;text-align:right;"></span>';
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    content.innerHTML = html;
  };

  var script = document.createElement('script');
  script.onerror = function () {
    delete window[cbName];
    content.innerHTML = '<p style="color:var(--melee);font-size:0.95rem;padding:0.5rem 0;">Failed to load. Try again.</p>';
  };
  script.src = WEB_APP_URL + '?action=getPlayerAttendanceFull&firstName=' + encodeURIComponent(firstName) + '&callback=' + cbName;
  document.head.appendChild(script);
}

function saveAttendanceFromCard(selectEl) {
  var date = selectEl.getAttribute('data-date');
  var firstName = selectEl.getAttribute('data-name');
  var status = selectEl.value;
  var oldStatus = selectEl.getAttribute('data-old');
  var indicator = selectEl.parentElement && selectEl.parentElement.parentElement
    ? selectEl.parentElement.parentElement.querySelector('.attend-save-ind')
    : null;

  if (!status) return;
  selectEl.disabled = true;
  if (indicator) { indicator.textContent = 'Saving...'; indicator.style.color = 'var(--text-muted)'; }

  var data = { date: date, firstName: firstName, status: status, oldStatus: oldStatus };
  var cbName = '_saveAttendCardCb_' + Date.now();
  window[cbName] = function (result) {
    delete window[cbName];
    selectEl.disabled = false;
    if (result && result.success) {
      selectEl.setAttribute('data-old', status);
      if (indicator) {
        indicator.textContent = 'Saved';
        indicator.style.color = 'var(--heal)';
        setTimeout(function () { if (indicator) indicator.textContent = ''; }, 2000);
      }
    } else {
      selectEl.value = oldStatus || '';
      if (indicator) {
        indicator.textContent = 'Error';
        indicator.style.color = 'var(--melee)';
        setTimeout(function () { if (indicator) indicator.textContent = ''; }, 3000);
      }
    }
  };
  var script = document.createElement('script');
  script.onerror = function () {
    delete window[cbName];
    selectEl.disabled = false;
    selectEl.value = oldStatus || '';
    if (indicator) { indicator.textContent = 'Error'; indicator.style.color = 'var(--melee)'; }
  };
  script.src = WEB_APP_URL + '?action=setAttendanceStatus&data=' + encodeURIComponent(JSON.stringify(data)) + '&callback=' + cbName;
  document.head.appendChild(script);
}
