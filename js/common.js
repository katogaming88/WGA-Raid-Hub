// @ts-check
var TEAMS = {
  phoenix: {
    gasUrl:
      'https://script.google.com/macros/s/AKfycbxrQdQGqbBTELWm7huWChdbES0ry7WFZetlELWuEdI0T6lfbXEzrqx9Vo5yA-b9dW4y7A/exec',
    name: 'Phoenix',
    officerPass: 'phoenix2',
    supabaseTeamId: 1
  },
  hellfire: {
    gasUrl:
      'https://script.google.com/macros/s/AKfycbwIpnJyZDwWr5MmWIv7iyaDZ0OajPTFePMTYfIy8WG7jhg7pakQTvTVSM3SLihrKxBb/exec',
    name: 'Hellfire Rollers',
    officerPass: 'hellfire2',
    supabaseTeamId: 2
  },
  // No GAS deployment -- Immolation was created directly in Supabase, unlike
  // Phoenix/Hellfire's pre-migration Sheets. Known limitation: loadData()
  // (js/common.js) still loads its core/heavy chunks from gasUrl regardless
  // of migration progress elsewhere, so the site won't actually load data for
  // this team until enough of that pipeline is GAS-independent. This entry
  // just gives team-switching/claims code something to point at.
  immolation: {
    gasUrl: '',
    name: 'Immolation',
    officerPass: 'immolation2026',
    supabaseTeamId: 3
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
var VERSION = '3.32.8';

// Supabase client. The publishable key is public by design (it maps to the
// anon role); RLS is the security boundary, see docs/RLS.md. The guard keeps
// the JSONP site fully working if the CDN script fails to load.
var SUPABASE_URL = 'https://kxgjqnpwfklbgrxdgmmv.supabase.co';
var SUPABASE_ANON_KEY = 'sb_publishable_OdTUOR0Do1ThdKUPBh5inA_OWq78POC';
var supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// Two-statement pattern for officer writes: the caller performs its own
// insert/update against a table RLS already permits, then calls this to log
// it, since audit_log has no direct client write path (write_audit_log(),
// #214). Failing to log doesn't undo the write; surfaced via console.warn.
function writeAuditLog(action, targetType, targetId, detail) {
  if (!supabaseClient) return Promise.resolve();
  return supabaseClient
    .rpc('write_audit_log', {
      p_team_id: _teamCfg.supabaseTeamId,
      p_action: action,
      p_target_type: targetType || null,
      p_target_id: targetId == null ? null : targetId,
      p_detail: detail == null ? null : String(detail)
    })
    .then(function (result) {
      if (result.error) console.warn('Failed to write audit log entry.', result.error.message);
    });
}

// Audit-log attribution for the officer writes still served by Apps Script.
// Before the Supabase login swap (#211) this sent the Discord session token,
// which GAS turned into the acting officer's name. The mapped session no
// longer carries a token, so it now sends the resolved username directly as
// changedBy. Same trust level as before: the GAS write actions are
// unauthenticated either way, this is attribution, not authorization (#364).
function _getAuditChangedByParam() {
  try {
    var s = typeof getDiscordSession === 'function' && getDiscordSession();
    return s && s.username ? '&changedBy=' + encodeURIComponent(s.username) : '';
  } catch (_) {
    return '';
  }
}

var DATA = null;
var ACTIVE_SEASON = null; // null = All Seasons; set by officer.js when a season is selected

function switchTeam(slug) {
  if (!(slug in TEAMS)) return;
  // Copy Discord session to the destination team's key so login persists across the switch.
  // Sessions are keyed per-team in localStorage but the token is valid globally server-side.
  try {
    var srcKey = 'wga_discord_' + TEAM_SLUG;
    var dstKey = 'wga_discord_' + slug;
    if (srcKey !== dstKey) {
      var raw = localStorage.getItem(srcKey);
      if (raw) localStorage.setItem(dstKey, raw);
    }
  } catch (_) {}
  sessionStorage.setItem('wga_team', slug);
  location.href = location.pathname;
}

function initTeamUI() {
  var suffix = document.title.split(' -- ')[1] || '';
  document.title = TEAM_NAME + (suffix ? ' -- ' + suffix : '');
  var nameEl = document.getElementById('headerTeamName');
  if (nameEl) nameEl.textContent = TEAM_NAME;
  ['teamSwitcherSelect', 'officerPromptTeamSelect', 'claimModalTeamSelect'].forEach(function (id) {
    var sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '';
    Object.keys(TEAMS).forEach(function (slug) {
      var opt = document.createElement('option');
      opt.value = slug;
      opt.textContent = TEAMS[slug].name;
      if (slug === TEAM_SLUG) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.onchange = /** @this {HTMLSelectElement} */ function () {
      switchTeam(this.value);
    };
  });
}

function jsonpRequest(url, callback, timeoutMs) {
  var ms = timeoutMs || 90000;
  var cbName = '_cb_' + Date.now() + '_' + Math.floor(Math.random() * 1e9);
  var timer;
  var done = false;

  function finish(err, result) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    delete window[cbName];
    callback(err, result);
  }

  window[cbName] = function (result) {
    finish(null, result);
  };

  timer = setTimeout(function () {
    finish(new Error('Request timed out. GAS may still be processing -- try again in a moment.'), null);
  }, ms);

  var script = document.createElement('script');
  script.onerror = function () {
    finish(new Error('Request failed. Check your connection.'), null);
  };
  if (url.indexOf(WEB_APP_URL) === 0) url += _getAuditChangedByParam();
  script.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'callback=' + cbName;
  document.head.appendChild(script);
}

var WOW_REALMS = [
  // NA
  'Aegwynn',
  'Aggramar',
  'Akama',
  'Alexstrasza',
  'Alleria',
  'Altar of Storms',
  'Alterac Mountains',
  'Andorhal',
  'Anetheron',
  'Antonidas',
  "Anub'arak",
  'Anvilmar',
  'Arathor',
  'Archimonde',
  'Area 52',
  'Argent Dawn',
  'Arthas',
  'Arygos',
  'Auchindoun',
  'Azgalor',
  'Azjol-Nerub',
  'Azralon',
  'Azshara',
  'Azuremyst',
  'Baelgun',
  'Black Dragonflight',
  'Blackhand',
  'Blackrock',
  'Blackwater Raiders',
  'Blackwing Lair',
  "Blade's Edge",
  'Bladefist',
  'Bleeding Hollow',
  'Blood Furnace',
  'Bloodhoof',
  'Bloodscalp',
  'Bonechewer',
  'Borean Tundra',
  'Boulderfist',
  'Bronze Dragonflight',
  'Bronzebeard',
  'Burning Blade',
  'Burning Legion',
  'Cairne',
  'Cenarion Circle',
  'Cenarius',
  "Cho'gall",
  'Chromaggus',
  'Crushridge',
  'Daggerspine',
  'Dalaran',
  'Dalvengyr',
  'Dark Iron',
  'Darrowmere',
  'Dawnbringer',
  'Deathwing',
  'Demon Soul',
  'Destromath',
  'Detheroc',
  'Doomhammer',
  'Dragonblight',
  'Dragonmaw',
  "Drak'Tharon",
  "Drak'thul",
  'Drenden',
  'Dunemaul',
  'Durotan',
  'Duskwood',
  'Earthen Ring',
  'Echo Isles',
  'Eitrigg',
  "Eldre'Thalas",
  'Elune',
  'Emerald Dream',
  'Eonar',
  'Eredar',
  'Executus',
  'Exodar',
  'Farstriders',
  'Feathermoon',
  'Fenris',
  'Fizzcrank',
  'Frostmane',
  'Frostwolf',
  'Garithos',
  'Garona',
  'Garrosh',
  'Ghostlands',
  'Gilneas',
  'Gnomeregan',
  'Gorefiend',
  'Greymane',
  'Grizzly Hills',
  "Gul'dan",
  'Gurubashi',
  'Hakkar',
  'Haomarush',
  'Hellscream',
  'Hydraxis',
  'Hyjal',
  'Icecrown',
  'Illidan',
  'Jaedenar',
  "Kael'thas",
  'Kalecgos',
  'Kargath',
  "Kel'Thuzad",
  'Khaz Modan',
  "Kil'jaeden",
  'Kilrogg',
  'Kirin Tor',
  'Korgath',
  'Korialstrasz',
  'Kul Tiras',
  'Laughing Skull',
  'Lethon',
  'Lightbringer',
  "Lightning's Blade",
  'Lightninghoof',
  'Llane',
  'Lothar',
  'Madoran',
  'Maelstrom',
  'Magtheridon',
  'Maiev',
  "Mal'Ganis",
  'Malorne',
  'Malygos',
  'Mannoroth',
  'Medivh',
  'Misha',
  "Mok'Nathal",
  'Moon Guard',
  'Moonrunner',
  "Mug'thol",
  'Muradin',
  'Nathrezim',
  'Nazgrel',
  'Nazjatar',
  'Nesingwary',
  'Norgannon',
  'Nordrassil',
  'Onyxia',
  'Perenolde',
  'Proudmoore',
  "Quel'dorei",
  'Ravenholdt',
  'Rexxar',
  'Rivendare',
  'Runetotem',
  'Scarlet Crusade',
  'Scilla',
  "Sen'jin",
  'Sentinels',
  'Shadow Council',
  'Shadowmoon',
  'Shadowsong',
  'Shattered Halls',
  'Shattered Hand',
  "Shu'halo",
  'Silver Hand',
  'Silvermoon',
  'Sisters of Elune',
  'Skullcrusher',
  'Skywall',
  'Smolderthorn',
  'Spinebreaker',
  'Spirestone',
  'Staghelm',
  'Steamwheedle Cartel',
  'Stonemaul',
  'Stormrage',
  'Stormreaver',
  'Stormscale',
  'Sulfuras',
  'Tanaris',
  'Terenas',
  'Terokkar',
  'Thorium Brotherhood',
  'Thrall',
  'Thunderhorn',
  'Thunderlord',
  'Tichondrius',
  'Tirion',
  'Tortheldrin',
  'Trollbane',
  'Turalyon',
  'Twisting Nether',
  'Uther',
  'Vashj',
  'Velen',
  'Venture Co',
  'Whisperwind',
  'Wildhammer',
  'Windrunner',
  'Winterhoof',
  'Wyrmrest Accord',
  'Ysera',
  'Ysondre',
  'Zangarmarsh',
  "Zul'jin",
  'Zuluhed',
  // OCE
  "Aman'Thul",
  'Barthilas',
  'Caelestrasz',
  "Dath'Remar",
  'Dreadmaul',
  'Frostmourne',
  'Gundrak',
  "Jubei'Thos",
  "Khaz'goroth",
  'Nagrand',
  'Saurfang',
  'Thaurissan'
].sort();

var CLASS_SPECS = {
  'Death Knight': { specs: ['Blood', 'Frost', 'Unholy'], roles: ['Tank', 'DPS'] },
  'Demon Hunter': { specs: ['Havoc', 'Vengeance', 'Devourer'], roles: ['Tank', 'DPS'] },
  Druid: { specs: ['Balance', 'Feral', 'Guardian', 'Restoration'], roles: ['Tank', 'Healer', 'DPS'] },
  Evoker: { specs: ['Augmentation', 'Devastation', 'Preservation'], roles: ['Healer', 'DPS'] },
  Hunter: { specs: ['Beast Mastery', 'Marksmanship', 'Survival'], roles: ['Melee', 'Ranged'] },
  Mage: { specs: ['Arcane', 'Fire', 'Frost'], roles: null, role: 'Ranged' },
  Monk: { specs: ['Brewmaster', 'Mistweaver', 'Windwalker'], roles: ['Tank', 'Healer', 'DPS'] },
  Paladin: { specs: ['Holy', 'Protection', 'Retribution'], roles: ['Tank', 'Healer', 'DPS'] },
  Priest: { specs: ['Discipline', 'Holy', 'Shadow'], roles: ['Healer', 'DPS'] },
  Rogue: { specs: ['Assassination', 'Outlaw', 'Subtlety'], roles: null, role: 'Melee' },
  Shaman: { specs: ['Elemental', 'Enhancement', 'Restoration'], roles: ['Healer', 'DPS'] },
  Warlock: { specs: ['Affliction', 'Demonology', 'Destruction'], roles: null, role: 'Ranged' },
  Warrior: { specs: ['Arms', 'Fury', 'Protection'], roles: ['Tank', 'DPS'] }
};

// Returns an error string if the character name is invalid, otherwise null.
function validateCharName(name) {
  if (!name) return 'Please enter your character name.';
  if (name.length < 2 || name.length > 12) return 'Character name must be 2-12 characters.';
  if (!/^[A-Z]/.test(name)) return 'Character name must start with a capital letter (e.g. Katorri).';
  if (/[A-Z]/.test(name.slice(1)))
    return (
      'Character name can only have one capital letter (the first). Did you mean ' +
      name[0] +
      name.slice(1).toLowerCase() +
      '?'
    );
  return null;
}

// Returns { value: normalizedNameRealm } or { error } for a free-typed "Name-Realm" string.
function validateMainSwap(nameRealm) {
  if (!nameRealm) return { error: 'Please enter your current character as Name-Realm.' };
  var normalized = nameRealm.trim().replace(/\s*-\s*/g, '-');
  var idx = normalized.indexOf('-');
  if (idx === -1) return { error: 'Enter your current character as Name-Realm (e.g. Katorri-Khaz Modan).' };

  var name = normalized.slice(0, idx);
  var realm = normalized.slice(idx + 1);

  var nameErr = validateCharName(name);
  if (nameErr) return { error: nameErr };

  var matchedRealm = WOW_REALMS.filter(function (r) {
    return r.toLowerCase() === realm.toLowerCase();
  })[0];
  if (!matchedRealm)
    return { error: 'Realm "' + realm + '" not recognized. Please check spelling (e.g. Katorri-Khaz Modan).' };

  return { value: name + '-' + matchedRealm };
}

// Maps each spec to its raid role. Used to resolve 'DPS' -> 'Melee'/'Ranged'.
var SPEC_ROLE = {
  Arcane: 'Ranged',
  Fire: 'Ranged',
  Affliction: 'Ranged',
  Demonology: 'Ranged',
  Destruction: 'Ranged',
  'Beast Mastery': 'Ranged',
  Marksmanship: 'Ranged',
  Survival: 'Melee',
  Balance: 'Ranged',
  Shadow: 'Ranged',
  Elemental: 'Ranged',
  Augmentation: 'Ranged',
  Devastation: 'Ranged',
  Devourer: 'Ranged',
  Assassination: 'Melee',
  Outlaw: 'Melee',
  Subtlety: 'Melee',
  Feral: 'Melee',
  Windwalker: 'Melee',
  Retribution: 'Melee',
  Enhancement: 'Melee',
  Havoc: 'Melee',
  Arms: 'Melee',
  Fury: 'Melee',
  Frost: 'Melee',
  Unholy: 'Melee',
  Blood: 'Tank',
  Guardian: 'Tank',
  Brewmaster: 'Tank',
  Protection: 'Tank',
  Vengeance: 'Tank',
  Restoration: 'Heal',
  Mistweaver: 'Heal',
  Holy: 'Heal',
  Discipline: 'Heal',
  Preservation: 'Heal'
};

var CLASS_ARMOR_TYPE = {
  'Death Knight': 'Plate',
  'Demon Hunter': 'Leather',
  Druid: 'Leather',
  Evoker: 'Mail',
  Hunter: 'Mail',
  Mage: 'Cloth',
  Monk: 'Leather',
  Paladin: 'Plate',
  Priest: 'Cloth',
  Rogue: 'Leather',
  Shaman: 'Mail',
  Warlock: 'Cloth',
  Warrior: 'Plate'
};

var CLASS_COLORS = {
  'Death Knight': '#C41E3A',
  'Demon Hunter': '#A330C9',
  Druid: '#FF7C0A',
  Evoker: '#33937F',
  Hunter: '#AAD372',
  Mage: '#3FC7EB',
  Monk: '#00FF98',
  Paladin: '#F48CBA',
  Priest: '#FFFFFF',
  Rogue: '#FFF468',
  Shaman: '#0070DD',
  Warlock: '#8788EE',
  Warrior: '#C69B3A'
};

// MN buff/debuff/utility map -- update here when class abilities change
var RAID_BUFFS = [
  { name: 'Mark of the Wild', classes: ['Druid'] },
  { name: 'Arcane Intellect', classes: ['Mage'] },
  { name: 'Battle Shout', classes: ['Warrior'] },
  { name: 'Power Word: Fortitude', classes: ['Priest'] },
  { name: "Hunter's Mark", classes: ['Hunter'] },
  { name: 'Blessing of the Bronze', classes: ['Evoker'] },
  { name: 'Skyfury', classes: ['Shaman'] },
  { name: 'Devotion Aura', classes: ['Paladin'] }
];

var BOSS_DEBUFFS = [
  { name: 'Mystic Touch', classes: ['Monk'] },
  { name: 'Chaos Brand', classes: ['Demon Hunter'] },
  { name: 'Atrophic Poison', classes: ['Rogue'] }
];

var RAID_UTILITY = [
  { name: 'Heroism / Bloodlust', classes: ['Shaman', 'Mage', 'Hunter', 'Evoker'] },
  { name: 'Combat Res', classes: ['Druid', 'Warlock', 'Paladin', 'Death Knight'] },
  { name: 'Healthstone', classes: ['Warlock'] },
  { name: 'Gateway', classes: ['Warlock'] },
  { name: 'Death Grip', classes: ['Death Knight'] },
  { name: 'Mass Grip', classes: ['Death Knight'], specs: ['Blood'] },
  { name: 'Life Grip / Rescue', classes: ['Priest', 'Evoker'] },
  { name: 'Blessing of Protection', classes: ['Paladin'] },
  { name: 'Darkness', classes: ['Demon Hunter'] },
  { name: 'Zephyr', classes: ['Evoker'] }
];

// players: array of objects; classField/specField/nameField: key names on each object
function computeBuffCoverage(players, classField, specField, nameField) {
  var allBuffs = RAID_BUFFS.concat(BOSS_DEBUFFS).concat(RAID_UTILITY);
  var result = {};
  allBuffs.forEach(function (buff) {
    result[buff.name] = { count: 0, providers: [] };
    players.forEach(function (p) {
      var cls = p[classField] || '';
      var spec = p[specField] || '';
      if (buff.classes.indexOf(cls) === -1) return;
      if (buff.specs && buff.specs.indexOf(spec) === -1) return;
      result[buff.name].count++;
      result[buff.name].providers.push(p[nameField] || cls);
    });
  });
  return result;
}

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
  return (
    'color:' + hex + ';background:' + classHexToRgba(hex, 0.1) + ';border-color:' + classHexToRgba(hex, 0.25) + ';'
  );
}

function normalise(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

// -- Data loading -----------------------------------------------------------

// Public roster reads come from Supabase (#208); Apps Script keeps computing
// attendance from the Attendance sheet (scoring.attendance_pct stays empty
// until the WCL sync lands) and all four M+ fields (they derive from the
// requests flow, which is officer-gated to anon and migrates at Phase 5),
// so those merge in from the JSONP core payload. Resolves to the players
// rows, or null on any failure so the caller falls back to the JSONP roster.
function fetchSupabaseRoster() {
  if (!supabaseClient) return Promise.resolve(null);
  var query = supabaseClient
    .from('players')
    .select(
      'id, name_realm, nickname, is_trial, is_bench, bis_link, bis_allowed, m_plus_excluded, m_plus_note, join_date, classes_specs(class, spec, role)'
    )
    .eq('team_id', _teamCfg.supabaseTeamId)
    .is('archived_at', null)
    .order('name_realm')
    .then(function (result) {
      if (result.error) {
        console.warn('Supabase roster query failed, using Apps Script roster.', result.error.message);
        return null;
      }
      return result.data && result.data.length ? result.data : null;
    })
    .catch(function (err) {
      console.warn('Supabase roster query failed, using Apps Script roster.', err);
      return null;
    });
  var timeout = new Promise(function (resolve) {
    setTimeout(function () {
      resolve(null);
    }, 10000);
  });
  return Promise.race([query, timeout]);
}

// Most recent rejected mplus_exclusion_requests row per player (#405).
// players has no rejected/rejection-note columns of its own -- a rejection is
// only ever a request-table event, so "is this player currently showing a
// rejection badge" is derived live from the latest request instead of a
// persisted flag. Resolves to a plain object keyed by player_id, or {} on any
// failure so a player simply shows no rejection badge rather than blocking
// the roster load.
function fetchSupabaseMPlusRejections() {
  if (!supabaseClient) return Promise.resolve({});
  return supabaseClient
    .from('mplus_exclusion_requests')
    .select('player_id, officer_notes, submitted_at')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .eq('status', 'rejected')
    .order('submitted_at', { ascending: false })
    .then(function (result) {
      if (result.error) return {};
      var byPlayer = {};
      (result.data || []).forEach(function (row) {
        // Ordered newest-first: keep only the first (most recent) row seen per player.
        if (row.player_id != null && !(row.player_id in byPlayer)) {
          byPlayer[row.player_id] = row.officer_notes || '';
        }
      });
      return byPlayer;
    })
    .catch(function () {
      return {};
    });
}

/**
 * Maps Supabase players rows to the roster shape the Apps Script core payload
 * emits (see getRoster() in gs/wgaWebApp.gs), so no render code changes.
 * @param {any[]} rows - players rows with embedded classes_specs
 * @param {any[]} [jsonpRoster] - the Apps Script roster from the core payload
 * @param {Object} [mplusRejections] - player_id -> rejection note, from fetchSupabaseMPlusRejections()
 * @returns {any[]}
 */
function mapSupabaseRoster(rows, jsonpRoster, mplusRejections) {
  var jsonpByName = {};
  (jsonpRoster || []).forEach(function (p) {
    if (p && p.nameRealm) jsonpByName[String(p.nameRealm).toLowerCase()] = p;
  });
  mplusRejections = mplusRejections || {};
  var players = [];
  (rows || []).forEach(function (row) {
    var nameRealm = String(row.name_realm || '').trim();
    if (!nameRealm) return;
    var cs = row.classes_specs || {};
    // Mirror getRoster(): a row without a role is not a roster entry.
    if (!cs.role) return;
    var parts = nameRealm.split('-');
    var jsonpRow = jsonpByName[nameRealm.toLowerCase()] || {};
    var mPlusExcluded = !!row.m_plus_excluded;
    var mPlusRejected = !mPlusExcluded && row.id in mplusRejections;
    players.push({
      id: row.id,
      nameRealm: nameRealm,
      firstName: parts[0].trim(),
      realm: parts.slice(1).join('-').trim(),
      isTrial: !!row.is_trial,
      isBench: !!row.is_bench,
      attendance: jsonpRow.attendance || '',
      nick: row.nickname || '',
      class: cs.class || '',
      spec: cs.spec || '',
      role: cs.role,
      bisLink: row.bis_link || '',
      bisAllowed: !!row.bis_allowed,
      joinDate: row.join_date || '',
      mPlusExcluded: mPlusExcluded,
      mPlusNote: row.m_plus_note || '',
      mPlusRejected: mPlusRejected,
      mPlusRejectionNote: mPlusRejected ? mplusRejections[row.id] : ''
    });
  });
  return players;
}

// Interim season display map (#209): rclc_loot.season stores the community
// shorthand ('MID1', decided on #320), while the season filter and the Apps
// Script payloads use the sheet's display names. Translate on read until the
// seasons vocabulary consolidates when season state moves off the sheet
// (Phase 5). Unknown codes pass through unchanged.
/** @type {Object<string, string>} */
var SEASON_LABELS = { MID1: 'Midnight Season 1' };

// Reverse of SEASON_LABELS: Apps Script's display name (DATA.seasonName,
// officer-typed free text in Season Settings) -> the shorthand code Supabase
// write paths need (scoring.season/priority_order.season/rclc_loot.season).
// Falls through to the input unchanged for a season not yet in SEASON_LABELS
// (or one an officer already set to the shorthand directly), same
// unknown-codes-pass-through behavior as the forward map.
function seasonCodeForDisplay(displayName) {
  for (var code in SEASON_LABELS) {
    if (SEASON_LABELS[code] === displayName) return code;
  }
  return displayName;
}

// Public loot reads come from Supabase (#209): all seasons for the team,
// newest first, paged past PostgREST's 1000-row cap. Resolves to the combined
// rows, or null on any failure/empty -- the Apps Script no longer serves
// lootCounts (retired #358, redeployed #210), so a failure here means an
// empty loot feed, not a fallback to the old source.
function fetchSupabaseLoot() {
  if (!supabaseClient) return Promise.resolve(null);
  var PAGE = 1000;
  /**
   * @param {number} from
   * @param {any[]} acc
   * @returns {Promise<any[]|null>}
   */
  function fetchPage(from, acc) {
    return supabaseClient
      .from('rclc_loot')
      .select('track, season, awarded_at, items(name), players(name_realm)')
      .eq('team_id', _teamCfg.supabaseTeamId)
      .order('awarded_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + PAGE - 1)
      .then(function (/** @type {{data: any[]|null, error: {message: string}|null}} */ result) {
        if (result.error) {
          console.warn('Supabase loot query failed.', result.error.message);
          return null;
        }
        var rows = result.data || [];
        var all = acc.concat(rows);
        if (rows.length < PAGE) return all.length ? all : null;
        return fetchPage(from + PAGE, all);
      });
  }
  var query = fetchPage(0, []).catch(function (err) {
    console.warn('Supabase loot query failed.', err);
    return null;
  });
  var timeout = new Promise(function (resolve) {
    setTimeout(function () {
      resolve(null);
    }, 10000);
  });
  return Promise.race([query, timeout]);
}

/**
 * Rebuilds the Apps Script getLootCounts() shape from rclc_loot rows so no
 * render code changes: diacritic-stripped lowercase first-name keys, entries
 * carrying count/heroicCount/mythicCount and per-item difficulty labels
 * ('Heroic'/'Mythic'/'Other' -- the UI vocabulary for the Hero/Myth/Champion
 * tracks), display dates formatted in the sheet's timezone, and seasons shown
 * under their display names. Rows without a linked player are skipped; the
 * import stubs departed characters, so every historical row stays attributed
 * (docs/database-decisions.md, 2026-07-08).
 * @param {any[]} rows - rclc_loot rows with embedded items and players
 * @returns {Object<string, {count: number, heroicCount: number, mythicCount: number, items: any[]}>}
 */
function mapSupabaseLoot(rows) {
  /** @type {Object<string, {count: number, heroicCount: number, mythicCount: number, items: any[]}>} */
  var result = {};
  /** @type {Object<string, string>} */
  var keyOwners = {};
  var dateFormat = new Intl.DateTimeFormat('en-US', {
    // The Apps Script feed formatted award dates in the sheet's timezone;
    // browser-local formatting would shift dates across midnight elsewhere.
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
  (rows || []).forEach(function (row) {
    var nameRealm = row.players && row.players.name_realm ? String(row.players.name_realm) : '';
    if (!nameRealm) return;
    var key = normalise(nameRealm.split('-')[0]);
    if (!key) return;
    if (keyOwners[key] && keyOwners[key] !== nameRealm) {
      // Two characters sharing a first name merge under one key, exactly like
      // the Apps Script feed did; the rows keep their true player links, so
      // the durable fix is re-keying the display by identity, not data repair.
      console.warn(
        'Loot display key collision: ' + keyOwners[key] + ' and ' + nameRealm + ' both map to "' + key + '"'
      );
    } else {
      keyOwners[key] = nameRealm;
    }
    var difficulty = row.track === 'Hero' ? 'Heroic' : row.track === 'Myth' ? 'Mythic' : 'Other';
    var date = '';
    if (row.awarded_at) {
      var d = new Date(row.awarded_at);
      if (!isNaN(d.getTime())) date = dateFormat.format(d);
    }
    if (!result[key]) result[key] = { count: 0, heroicCount: 0, mythicCount: 0, items: [] };
    var entry = result[key];
    entry.count++;
    if (difficulty === 'Heroic') entry.heroicCount++;
    else if (difficulty === 'Mythic') entry.mythicCount++;
    entry.items.push({
      name: row.items && row.items.name ? row.items.name : 'Unknown Item',
      difficulty: difficulty,
      date: date,
      season: SEASON_LABELS[row.season] || row.season || ''
    });
  });
  return result;
}

// BiS list reads come from Supabase (#217): bis_items has no team_id column
// of its own (derives team through the player_id FK, docs/database-decisions.md),
// so filtering by team requires an inner join through players. Resolves to
// the raw rows, or null on any failure so the caller falls back to the Apps
// Script heavy chunk's bisList.
function fetchSupabaseBisItems() {
  if (!supabaseClient) return Promise.resolve(null);
  var query = supabaseClient
    .from('bis_items')
    .select('player_id, item_id, obtained, slot, items(name, slot, is_placeholder), players!inner(name_realm, team_id)')
    .eq('players.team_id', _teamCfg.supabaseTeamId)
    .then(function (result) {
      if (result.error) {
        console.warn('Supabase BiS items query failed, using Apps Script BiS list.', result.error.message);
        return null;
      }
      return result.data && result.data.length ? result.data : null;
    })
    .catch(function (err) {
      console.warn('Supabase BiS items query failed, using Apps Script BiS list.', err);
      return null;
    });
  var timeout = new Promise(function (resolve) {
    setTimeout(function () {
      resolve(null);
    }, 10000);
  });
  return Promise.race([query, timeout]);
}

/**
 * Maps bis_items rows to the DATA.bisList shape the Apps Script heavy chunk
 * emits (firstName -> array of {item, slot} entries), so no render code
 * changes. Keys by the same raw firstName derivation mapSupabaseRoster()
 * uses, since tab-conflicts.js/tab-priority.js index DATA.bisList[firstName]
 * directly against the roster's firstName rather than going through
 * getBisItems()'s normalised lookup. Carries obtained/playerId/itemId so the
 * BiS Lists editor (tab-bis.js) can write back without a second lookup.
 * @param {any[]} rows - bis_items rows with embedded items and players
 * @returns {Object<string, {item: string, slot: string, dbSlot: string|null, obtained: boolean, playerId: number, itemId: number}[]>}
 */
function mapSupabaseBisItems(rows) {
  /** @type {Object<string, {item: string, slot: string, dbSlot: string|null, obtained: boolean, playerId: number, itemId: number}[]>} */
  var map = {};
  (rows || []).forEach(function (row) {
    var players = row.players || {};
    var nameRealm = String(players.name_realm || '').trim();
    if (!nameRealm) return;
    var firstName = nameRealm.split('-')[0].trim();
    var itemRow = row.items || {};
    if (!itemRow.name) return;
    if (!map[firstName]) map[firstName] = [];
    map[firstName].push({
      item: itemRow.name,
      // bis_items.slot is the canonical BIS_SLOTS row an officer assigned
      // this entry to (js/tabs/tab-bis.js, #393 follow-up) -- every row added
      // through that editor carries one now, real items included, since
      // "Finger"/"Trinket" alone can't say which of the two numbered slots an
      // item is for. Falls back to the item's own catalog slot only for
      // legacy real-item rows added before this existed; placeholder rows
      // (M+/Crafted/Catalyst) never fall back, since items.slot is the
      // literal 'Placeholder' sentinel for those (items.slot is NOT NULL).
      slot: row.slot || (itemRow.is_placeholder ? '' : itemRow.slot || ''),
      // The raw bis_items.slot column value -- tab-bis.js needs this, not the
      // display slot above, to target the exact row on delete/update now that
      // more than one row can share an item_id (distinguished by slot).
      dbSlot: row.slot || null,
      obtained: !!row.obtained,
      playerId: row.player_id,
      itemId: row.item_id
    });
  });
  return map;
}

// Priority order reads come from Supabase (#220). priority_order carries its
// own team_id (unlike bis_items), so no join-through-players filter is
// needed. Not season-filtered here -- same reason fetchSupabaseLoot() isn't:
// this promise fires before DATA.seasonName is known (in parallel with the
// core chunk), so the season filter is applied downstream in
// mapSupabasePriorityOrder() once DATA is populated. Resolves to the raw
// rows, or null on any failure/empty so the caller falls back to the Apps
// Script heavy chunk's priorityOrder.
function fetchSupabasePriorityOrder() {
  if (!supabaseClient) return Promise.resolve(null);
  var query = supabaseClient
    .from('priority_order')
    .select('item_id, track, rank, season, items(name), players(name_realm)')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .then(function (result) {
      if (result.error) {
        console.warn('Supabase priority_order query failed, using Apps Script priority order.', result.error.message);
        return null;
      }
      return result.data && result.data.length ? result.data : null;
    })
    .catch(function (err) {
      console.warn('Supabase priority_order query failed, using Apps Script priority order.', err);
      return null;
    });
  var timeout = new Promise(function (resolve) {
    setTimeout(function () {
      resolve(null);
    }, 10000);
  });
  return Promise.race([query, timeout]);
}

/**
 * Maps priority_order rows (filtered to the current season) to the
 * DATA.priorityOrder shape the Apps Script heavy chunk emits:
 * {itemName: {heroic: [firstName...], mythic: [firstName...]}}, ordered by
 * rank -- so tab-priority.js's render functions need no changes.
 * @param {any[]} rows - priority_order rows with embedded items and players
 * @param {string} seasonCode - current season's shorthand code (e.g. 'MID1') to filter rows to --
 *   NOT DATA.seasonName directly, which is Apps Script's free-text display label; pass it through
 *   seasonCodeForDisplay() first, same as priority_order.season/scoring.season/rclc_loot.season all store.
 * @returns {Object<string, {heroic?: string[], mythic?: string[]}>}
 */
function mapSupabasePriorityOrder(rows, seasonCode) {
  /** @type {Object<string, {heroic?: string[], mythic?: string[]}>} */
  var result = {};
  (rows || [])
    .filter(function (row) {
      return row.season === seasonCode;
    })
    .sort(function (a, b) {
      return a.rank - b.rank;
    })
    .forEach(function (row) {
      var itemName = row.items && row.items.name ? String(row.items.name).trim() : '';
      var nameRealm = row.players && row.players.name_realm ? String(row.players.name_realm) : '';
      if (!itemName || !nameRealm) return;
      var diff = row.track === 'Myth' ? 'mythic' : row.track === 'Hero' ? 'heroic' : null;
      if (!diff) return;
      var firstName = nameRealm.split('-')[0].trim();
      if (!result[itemName]) result[itemName] = {};
      if (!result[itemName][diff]) result[itemName][diff] = [];
      result[itemName][diff].push(firstName);
    });
  return result;
}

// Season config reads come from Supabase (#221): team_settings.config is the
// one jsonb blob holding everything that used to be Script Properties keys
// (season name/dates/history, raid progression, trial thresholds, the
// signup/BiS/M+ toggles, the active signup season). Fires in parallel with
// the core chunk, same as fetchSupabaseRoster(); applyTeamSettingsToData()
// overlays it onto DATA once both are in, falling back to whatever the Apps
// Script core payload already put there (still Script Properties, until the
// live rows are backfilled) if the row is missing or a key isn't set yet.
function fetchSupabaseSettings() {
  if (!supabaseClient) return Promise.resolve(null);
  var query = supabaseClient
    .from('team_settings')
    .select('config')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .maybeSingle()
    .then(function (result) {
      if (result.error) {
        console.warn('Supabase team_settings query failed, using Apps Script season config.', result.error.message);
        return null;
      }
      return result.data ? result.data.config : null;
    })
    .catch(function (err) {
      console.warn('Supabase team_settings query failed, using Apps Script season config.', err);
      return null;
    });
  var timeout = new Promise(function (resolve) {
    setTimeout(function () {
      resolve(null);
    }, 10000);
  });
  return Promise.race([query, timeout]);
}

var SEASON_CONFIG_KEYS = [
  'seasonName',
  'seasonStart',
  'seasonEnd',
  'seasonHistory',
  'raidProgression',
  'trialWeeks',
  'trialAttend',
  'signupsOpen',
  'bisSubmissionsOpen',
  'mPlusExclusionsOpen'
];

/**
 * Overlays team_settings.config onto DATA, key by key, so a config missing a
 * given key (not backfilled yet, or a brand-new team) keeps whatever the Apps
 * Script core payload already set for it instead of clobbering it with
 * undefined. activeSignupSeason maps to DATA.signupSeason, matching the Apps
 * Script field name tab-season.js already reads/writes.
 * @param {any} data - the DATA object being built from the core chunk
 * @param {Object|null} config - team_settings.config, or null if the query failed/found nothing
 */
function applyTeamSettingsToData(data, config) {
  if (!config) return;
  SEASON_CONFIG_KEYS.forEach(function (key) {
    if (config[key] !== undefined) data[key] = config[key];
  });
  if (config.activeSignupSeason !== undefined) data.signupSeason = config.activeSignupSeason;
}

/**
 * Merges p_updates into team_settings.config for the current team and
 * returns the new config, mirroring the old jsonpRequest(...&action=set...)
 * callback pattern but via the set_team_setting RPC (#221). Restricted to
 * team_leader/site_admin by the "Team leaders write settings" RLS policy.
 * @param {Object} updates
 * @returns {Promise<Object>}
 */
function saveTeamSetting(updates) {
  return supabaseClient
    .rpc('set_team_setting', { p_team_id: _teamCfg.supabaseTeamId, p_updates: updates })
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);
      return result.data;
    });
}

// Item catalog reads come exclusively from Supabase (#391): the GAS "Item
// Lookup" sheet is retired as a data source for the web app now that
// scripts/fetch-items.js seeds items/item_bosses from Wowhead every tier
// (docs/updating-fetch-items-for-new-tier.md). items is a global,
// un-team-scoped reference table -- no auth needed, RLS already permits
// public read. Resolves to the raw rows, or null on any failure/empty so
// the caller renders an empty catalog rather than silently serving stale
// GAS data.
function fetchSupabaseItems() {
  if (!supabaseClient) return Promise.resolve(null);
  var query = supabaseClient
    .from('items')
    .select('id, name, slot, armor_type, is_placeholder')
    .then(function (result) {
      if (result.error) {
        console.warn('Supabase items query failed.', result.error.message);
        return null;
      }
      return result.data && result.data.length ? result.data : null;
    })
    .catch(function (err) {
      console.warn('Supabase items query failed.', err);
      return null;
    });
  var timeout = new Promise(function (resolve) {
    setTimeout(function () {
      resolve(null);
    }, 10000);
  });
  return Promise.race([query, timeout]);
}

// item_bosses shares the same retirement (#391): joined through items for
// the item name, since tab-priority.js's boss filter indexes DATA.itemBosses
// by item name. Resolves to the raw rows, or null on any failure/empty.
function fetchSupabaseItemBosses() {
  if (!supabaseClient) return Promise.resolve(null);
  var query = supabaseClient
    .from('item_bosses')
    .select('boss, items(name)')
    .then(function (result) {
      if (result.error) {
        console.warn('Supabase item_bosses query failed.', result.error.message);
        return null;
      }
      return result.data && result.data.length ? result.data : null;
    })
    .catch(function (err) {
      console.warn('Supabase item_bosses query failed.', err);
      return null;
    });
  var timeout = new Promise(function (resolve) {
    setTimeout(function () {
      resolve(null);
    }, 10000);
  });
  return Promise.race([query, timeout]);
}

// Builds the DATA.itemSlots/itemArmorTypes maps (name -> slot / name ->
// armor_type) straight from Supabase's items rows -- no GAS merge, per #391.
// Placeholder rows (M+, Crafted, Catalyst -- items.slot is NOT NULL, so those
// stand-ins store the literal string 'Placeholder' since they name a loot
// source rather than a gear slot) map to '' here rather than surfacing that
// sentinel as if it were a real slot name in the UI.
function buildItemMaps(rows) {
  var itemSlots = {};
  var itemArmorTypes = {};
  var itemPlaceholders = {};
  var itemIds = {};
  (rows || []).forEach(function (row) {
    var name = String(row.name || '').trim();
    if (!name) return;
    itemSlots[name] = row.is_placeholder ? '' : row.slot || '';
    if (row.armor_type) itemArmorTypes[name] = row.armor_type;
    if (row.is_placeholder) itemPlaceholders[name] = true;
    if (row.id != null) itemIds[name] = row.id;
  });
  return { itemSlots: itemSlots, itemArmorTypes: itemArmorTypes, itemPlaceholders: itemPlaceholders, itemIds: itemIds };
}

// Maps item_bosses rows (joined through items) to the DATA.itemBosses shape
// the GAS heavy chunk used to emit: item name -> single boss string.
function mapSupabaseItemBosses(rows) {
  var map = {};
  (rows || []).forEach(function (row) {
    var name = row.items && row.items.name ? String(row.items.name).trim() : '';
    var boss = String(row.boss || '').trim();
    if (name && boss) map[name] = boss;
  });
  return map;
}

// onCoreReady fires once the fast core chunk is loaded and the page can render.
// onHeavyReady (optional) fires once loot/attendance/BiS/priority data arrives.
function loadData(onCoreReady, onHeavyReady) {
  var loadingEl = document.getElementById('loadingMsg');
  function showError(msg) {
    if (loadingEl) {
      loadingEl.className = 'state-msg error';
      loadingEl.innerHTML = msg;
    }
  }

  // Fired in parallel with the core chunk; the core callback waits for it.
  var rosterPromise = fetchSupabaseRoster();
  // Fired alongside; the core callback waits for it before overlaying season config.
  var settingsPromise = fetchSupabaseSettings();
  // Fired alongside; the core callback waits for it before mapping the roster's M+ rejection badges.
  var mplusRejectionsPromise = fetchSupabaseMPlusRejections();
  // Fired alongside; the heavy callback waits for it before setting lootCounts.
  var lootPromise = fetchSupabaseLoot();
  // Fired alongside; the heavy callback waits for it before setting bisList.
  var bisItemsPromise = fetchSupabaseBisItems();
  // Fired alongside; the heavy callback waits for it before setting itemSlots.
  var itemsPromise = fetchSupabaseItems();
  // Fired alongside; the heavy callback waits for it before setting itemBosses.
  var itemBossesPromise = fetchSupabaseItemBosses();
  // Fired alongside; the heavy callback waits for it before setting priorityOrder.
  var priorityOrderPromise = fetchSupabasePriorityOrder();

  window._rosterCoreCallback = function (data) {
    delete window._rosterCoreCallback;
    if (data.error) {
      showError('Could not load roster data. ' + data.error);
      return;
    }
    Promise.all([rosterPromise, settingsPromise, mplusRejectionsPromise]).then(function (results) {
      var rows = results[0];
      var settingsConfig = results[1];
      var mplusRejections = results[2];
      var mapped = rows ? mapSupabaseRoster(rows, data.roster, mplusRejections) : null;
      if (mapped && mapped.length) data.roster = mapped;
      applyTeamSettingsToData(data, settingsConfig);
      DATA = data;
      DATA._loadedAt = new Date();
      try {
        onCoreReady();
      } catch (e) {
        showError('Could not load roster data. ' + e.message);
        return;
      }

      var heavyScript = document.createElement('script');
      heavyScript.onerror = function () {
        delete window._rosterHeavyCallback;
      };
      window._rosterHeavyCallback = function (heavy) {
        delete window._rosterHeavyCallback;
        if (!heavy || heavy.error) return;
        Promise.all([lootPromise, bisItemsPromise, itemsPromise, itemBossesPromise, priorityOrderPromise]).then(
          function (results) {
            var lootRows = results[0];
            var bisRows = results[1];
            var itemRows = results[2];
            var itemBossRows = results[3];
            var priorityRows = results[4];
            var mappedLoot = lootRows ? mapSupabaseLoot(lootRows) : null;
            DATA.lootCounts = mappedLoot || {};
            DATA.attendanceDetails = heavy.attendanceDetails;
            DATA.rawAttendanceData = heavy.rawAttendanceData;
            DATA.recentAttendanceTrend = heavy.recentAttendanceTrend;
            var mappedBis = bisRows ? mapSupabaseBisItems(bisRows) : null;
            DATA.bisList = mappedBis && Object.keys(mappedBis).length ? mappedBis : heavy.bisList;
            var mappedPriority = priorityRows
              ? mapSupabasePriorityOrder(priorityRows, seasonCodeForDisplay(DATA.seasonName || ''))
              : null;
            DATA.priorityOrder =
              mappedPriority && Object.keys(mappedPriority).length ? mappedPriority : heavy.priorityOrder;
            var itemMaps = buildItemMaps(itemRows);
            DATA.itemSlots = itemMaps.itemSlots;
            DATA.itemArmorTypes = itemMaps.itemArmorTypes;
            DATA.itemPlaceholders = itemMaps.itemPlaceholders;
            DATA.itemIds = itemMaps.itemIds;
            DATA.itemBosses = mapSupabaseItemBosses(itemBossRows);
            DATA.selfReceived = heavy.selfReceived;
            if (typeof populateBossFilters === 'function') populateBossFilters();
            if (onHeavyReady) onHeavyReady();
          }
        );
      };
      heavyScript.src = WEB_APP_URL + '?chunk=heavy&callback=_rosterHeavyCallback';
      document.head.appendChild(heavyScript);
    });
  };

  var coreScript = document.createElement('script');
  coreScript.onerror = function () {
    delete window._rosterCoreCallback;
    showError('Could not load roster data.');
  };
  coreScript.src = WEB_APP_URL + '?chunk=core&callback=_rosterCoreCallback';
  document.head.appendChild(coreScript);

  setTimeout(function () {
    if (!DATA) {
      showError('Request timed out.');
    }
  }, 15000);
}

// -- Data helpers -----------------------------------------------------------
function getRank(firstName, itemName) {
  var list = (DATA.priorityOrder || {})[itemName];
  if (!list) return null;
  var norm = normalise(firstName);
  for (var i = 0; i < list.length; i++) {
    if (normalise(list[i]) === norm) return i + 1;
  }
  return null;
}

function getBisItems(firstName) {
  var bisMap = DATA.bisList || {};
  var norm = normalise(firstName);
  var key = null;
  var keys = Object.keys(bisMap);
  for (var i = 0; i < keys.length; i++) {
    if (normalise(keys[i]) === norm) {
      key = keys[i];
      break;
    }
  }
  var entries = key ? bisMap[key] : [];
  return entries.map(function (e) {
    return typeof e === 'string' ? { item: e, slot: '' } : e;
  });
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
  el.innerHTML =
    '<span style="color:var(--gold-light);font-weight:600;">' +
    pct +
    '%</span><span style="color:var(--text-muted);font-weight:400;"> (' +
    count +
    '/' +
    bisItems.length +
    ')</span>';
}

function getLootEntry(firstName) {
  var lootMap = DATA.lootCounts || {};
  var norm = normalise(firstName);
  var keys = Object.keys(lootMap);
  for (var i = 0; i < keys.length; i++) {
    if (normalise(keys[i]) === norm) return lootMap[keys[i]];
  }
  return null;
}

function getSeasonLootItems(firstName) {
  var entry = getLootEntry(firstName);
  var items = (entry && entry.items) || [];
  if (!ACTIVE_SEASON) return items;
  return items.filter(function (item) {
    return item.season === ACTIVE_SEASON;
  });
}

function getSeasonLootEntry(firstName) {
  if (!ACTIVE_SEASON) return getLootEntry(firstName);
  var items = getSeasonLootItems(firstName);
  var heroic = 0,
    mythic = 0;
  for (var i = 0; i < items.length; i++) {
    if (items[i].difficulty === 'Heroic') heroic++;
    else if (items[i].difficulty === 'Mythic') mythic++;
  }
  return { count: items.length, heroicCount: heroic, mythicCount: mythic, items: items };
}

// -- Render helpers ---------------------------------------------------------
function rankPillHTML(rank) {
  if (rank === null)
    return '<span style="font-size:0.97rem;color:var(--text-dim);min-width:40px;text-align:center;">-</span>';
  var t = Math.min((rank - 1) / 14, 1);
  var rv = Math.round(214 + (100 - 214) * t),
    gv = Math.round(163 + (100 - 163) * t),
    bv = Math.round(68 + (100 - 68) * t);
  var a = Math.max(0.08, 0.18 - t * 0.1);
  var c = 'rgb(' + rv + ',' + gv + ',' + bv + ')',
    bg = 'rgba(' + rv + ',' + gv + ',' + bv + ',' + a + ')',
    bd = 'rgba(' + rv + ',' + gv + ',' + bv + ',' + Math.max(0.2, 0.4 - t * 0.2) + ')';
  return (
    '<span class="rank-pill" style="background:' +
    bg +
    ';color:' +
    c +
    ';border:1px solid ' +
    bd +
    ';">#' +
    rank +
    '</span>'
  );
}

function lookupItemSlot(itemName) {
  var slots = DATA.itemSlots || {};
  if (slots[itemName]) return slots[itemName];
  for (var key in slots) {
    if (key.indexOf(itemName) === 0) return slots[key];
  }
  return '';
}

// Slot vocabulary matches items.slot / BIS_SLOTS (js/tabs/tab-bis.js), the
// Supabase-native naming fetch-items.js seeds -- singular, "Finger"/"Hands"/
// "Feet" etc, not the old GAS sheet's plural "Shoulders"/"Gloves"/"Boots".
function getSlotColor(slot) {
  var s = (slot || '').toUpperCase();
  if (s === 'TRINKET' || s === 'TRINKET 1' || s === 'TRINKET 2') return 'var(--gold)';
  if (s === 'NECK' || s === 'FINGER' || s === 'FINGER 1' || s === 'FINGER 2') return 'var(--ranged)';
  if (['WEAPON', 'TWO-HAND', 'ONE-HAND', 'RANGED', 'OFF HAND'].indexOf(s) >= 0) return 'var(--melee)';
  if (['HEAD', 'SHOULDER', 'CHEST', 'HANDS', 'LEGS', 'BACK', 'WRIST', 'WAIST', 'FEET'].indexOf(s) >= 0)
    return 'var(--tank)';
  return 'var(--text)';
}

function attendColor(pct) {
  return pct >= 95 ? 'var(--heal)' : pct >= 75 ? 'var(--gold)' : 'var(--melee)';
}

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
    tip.style.cssText =
      'position:fixed;background:var(--bg-elevated);border:1px solid var(--border-mid);border-radius:4px;padding:0.45rem 0.7rem;font-size:0.8rem;color:var(--text-muted);white-space:nowrap;pointer-events:none;z-index:200;font-family:Rajdhani,sans-serif;letter-spacing:0.03em;';
    document.body.appendChild(tip);
  }
  tip.textContent = text;
  tip.style.display = 'block';
  tip.style.left = evt.clientX + 12 + 'px';
  tip.style.top = evt.clientY - 32 + 'px';
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
  var monthMap = {},
    monthOrder = [];
  var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (var i = 0; i < nights.length; i++) {
    var key = nights[i].date.substring(0, 7); // "yyyy-MM"
    if (!monthMap[key]) {
      monthMap[key] = [];
      monthOrder.push(key);
    }
    monthMap[key].push(nights[i]);
  }

  // Fall back to per-night dots if only one month of data
  if (monthOrder.length <= 1) {
    /** @type {number} */
    var n = nights.length;
    var W = Math.max(300, n * 24),
      H = 56,
      PAD = 6,
      R = 4;
    // Shared with the per-month branch below (var hoists to function scope):
    // per-night points carry `night`, per-month points carry `m`.
    /** @type {{x: number, y: number, night?: any, m?: any}[]} */
    var points = [];
    for (var i = 0; i < n; i++) {
      var x = n === 1 ? W / 2 : PAD + (i / (n - 1)) * (W - PAD * 2);
      var y = PAD + (1 - attendTrendValue(nights[i].status)) * (H - PAD * 2);
      points.push({ x: x, y: y, night: nights[i] });
    }
    var lineStr = points
      .map(function (p) {
        return p.x.toFixed(1) + ',' + p.y.toFixed(1);
      })
      .join(' ');
    var svg =
      '<svg width="' +
      W +
      '" height="' +
      H +
      '" viewBox="0 0 ' +
      W +
      ' ' +
      H +
      '" style="display:block;overflow:visible;">';
    svg +=
      '<polyline points="' +
      lineStr +
      '" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>';
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      var tip = p.night.date + ': ' + p.night.status;
      svg +=
        '<g style="cursor:default;" onmouseover="showAttendTip(event,' +
        "'" +
        tip +
        "')" +
        '" onmouseout="hideAttendTip()">';
      svg +=
        '<circle cx="' +
        p.x.toFixed(1) +
        '" cy="' +
        p.y.toFixed(1) +
        '" r="' +
        R +
        '" fill="' +
        attendTrendColor(p.night.status) +
        '"/>';
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
  var W = Math.max(200, n * 64),
    H = 56,
    PAD = 16,
    R = 7;

  /** @type {{x: number, y: number, night?: any, m?: any}[]} */
  var points = [];
  for (var i = 0; i < n; i++) {
    var x = n === 1 ? W / 2 : PAD + (i / (n - 1)) * (W - PAD * 2);
    var y = PAD + (1 - months[i].avg) * (H - PAD * 2);
    points.push({ x: x, y: y, m: months[i] });
  }

  var lineStr = points
    .map(function (p) {
      return p.x.toFixed(1) + ',' + p.y.toFixed(1);
    })
    .join(' ');

  var svg =
    '<svg width="' +
    W +
    '" height="' +
    (H + 18) +
    '" viewBox="0 0 ' +
    W +
    ' ' +
    (H + 18) +
    '" style="display:block;overflow:visible;">';
  svg +=
    '<polyline points="' +
    lineStr +
    '" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>';
  for (var i = 0; i < points.length; i++) {
    var p = points[i];
    var col = attendTrendMonthColor(p.m.avg);
    var tip = p.m.label + ': ' + p.m.pct + '% (' + p.m.count + ' raid' + (p.m.count !== 1 ? 's' : '') + ')';
    svg +=
      '<g style="cursor:default;" onmouseover="showAttendTip(event,' +
      "'" +
      tip +
      "')" +
      '" onmouseout="hideAttendTip()">';
    svg += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + R + '" fill="' + col + '"/>';
    svg +=
      '<text x="' +
      p.x.toFixed(1) +
      '" y="' +
      (H + 14) +
      '" text-anchor="middle" font-size="10" fill="rgba(255,255,255,0.45)" font-family="sans-serif">' +
      p.m.label.split(' ')[0] +
      '</text>';
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

// Shared by both pages (index.html's signup/claim flow and officer.html's
// BiS toggle) -- lives here rather than signup.js since only index.html
// loads that file.
function findRosterPlayerByNameRealm(nameRealm) {
  if (!nameRealm || !window.DATA || !DATA.roster) return null;
  var key = nameRealm.toLowerCase();
  for (var i = 0; i < DATA.roster.length; i++) {
    if ((DATA.roster[i].nameRealm || '').toLowerCase() === key) return DATA.roster[i];
  }
  return null;
}

// -- BiS state helpers ------------------------------------------------------
function bisSubmissionsOpen() {
  return !!(DATA && DATA.bisSubmissionsOpen);
}

// bis_allowed lives on players (#404) so the officer-write RLS rule already
// covering that table gates the toggle, instead of the team_leader-only
// set_team_setting() path a team_settings array would have required.
function bisAllowedFor(nameRealm) {
  var player = findRosterPlayerByNameRealm(nameRealm);
  return !!(player && player.bisAllowed);
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
  var urlEl = /** @type {HTMLInputElement} */ (document.getElementById('mplusUrl-' + firstName));
  var notesEl = /** @type {HTMLTextAreaElement} */ (document.getElementById('mplusNotes-' + firstName));
  var formEl = document.getElementById('mplusForm-' + firstName);
  if (!urlEl || !urlEl.value.trim()) {
    if (urlEl) urlEl.style.borderColor = 'var(--melee)';
    return;
  }
  if (formEl)
    formEl.innerHTML = '<p style="font-size:0.95rem;color:var(--text-muted);padding:0.5rem 0;">Submitting...</p>';

  if (!supabaseClient) {
    if (formEl)
      formEl.innerHTML =
        '<p style="font-size:0.95rem;color:var(--melee);padding:0.5rem 0;">Failed to submit. Try again.</p>';
    return;
  }

  supabaseClient
    .rpc('submit_mplus_exclusion', {
      p_team_id: _teamCfg.supabaseTeamId,
      p_name_realm: nameRealm,
      p_raiderio_url: urlEl.value.trim(),
      p_reason: notesEl ? notesEl.value.trim() : ''
    })
    .then(function (result) {
      if (formEl) {
        formEl.innerHTML = result.error
          ? '<p style="font-size:0.95rem;color:var(--melee);padding:0.5rem 0;">Failed to submit. Try again.</p>'
          : '<p style="font-size:0.95rem;color:var(--text-muted);padding:0.5rem 0;">Request submitted! An officer will review it shortly.</p>';
      }
    });
}

function submitBiSForm(nameRealm, firstName) {
  var urlEl = /** @type {HTMLInputElement} */ (document.getElementById('bisUrl-' + firstName));
  var notesEl = /** @type {HTMLTextAreaElement} */ (document.getElementById('bisNotes-' + firstName));
  if (!urlEl || !urlEl.value.trim()) {
    if (urlEl) urlEl.style.borderColor = 'var(--melee)';
    return;
  }
  var formEl = document.getElementById('bisForm-' + firstName);
  if (formEl)
    formEl.innerHTML = '<p style="font-size:0.95rem;color:var(--text-muted);padding:0.5rem 0;">Submitting...</p>';

  if (!supabaseClient) {
    if (formEl)
      formEl.innerHTML =
        '<p style="font-size:0.95rem;color:var(--melee);padding:0.5rem 0;">Failed to submit. Try again.</p>';
    return;
  }

  supabaseClient
    .rpc('submit_bis_link', {
      p_team_id: _teamCfg.supabaseTeamId,
      p_name_realm: nameRealm,
      p_bis_link: urlEl.value.trim(),
      p_player_note: notesEl ? notesEl.value.trim() : ''
    })
    .then(function (result) {
      if (formEl) {
        formEl.innerHTML = result.error
          ? '<p style="font-size:0.95rem;color:var(--melee);padding:0.5rem 0;">Failed to submit. Try again.</p>'
          : '<p style="font-size:0.95rem;color:var(--text-muted);padding:0.5rem 0;">Submitted -- pending officer review.</p>';
      }
    });
}

function officerUpdateBisLink(nameRealm, firstName) {
  var urlEl = /** @type {HTMLInputElement} */ (document.getElementById('bisUrl-' + firstName));
  if (!urlEl || !urlEl.value.trim()) {
    if (urlEl) urlEl.style.borderColor = 'var(--melee)';
    return;
  }
  var url = urlEl.value.trim();
  var formEl = document.getElementById('bisForm-' + firstName);
  if (formEl) formEl.innerHTML = '<p style="font-size:0.95rem;color:var(--text-muted);padding:0.5rem 0;">Saving...</p>';

  if (!supabaseClient) {
    if (formEl)
      formEl.innerHTML =
        '<p style="font-size:0.95rem;color:var(--melee);padding:0.5rem 0;">Failed to save. Try again.</p>';
    return;
  }

  var player = findRosterPlayerByNameRealm(nameRealm);
  supabaseClient
    .from('players')
    .update({ bis_link: url })
    .eq('team_id', _teamCfg.supabaseTeamId)
    .eq('name_realm', nameRealm)
    .then(function (result) {
      if (result.error) {
        if (formEl)
          formEl.innerHTML =
            '<p style="font-size:0.95rem;color:var(--melee);padding:0.5rem 0;">Failed to save. Try again.</p>';
        return;
      }
      if (formEl)
        formEl.innerHTML =
          '<p style="font-size:0.95rem;color:var(--text-muted);padding:0.5rem 0;">BiS link updated. Clear cache to refresh.</p>';
      writeAuditLog('BiS Link Updated', 'players', player ? player.id : null, url);
    });
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
    btn.onclick = function () {
      revokeBisForPlayer(nameRealm, firstName);
    };
    var badge = document.createElement('span');
    badge.style.cssText = 'font-size:0.9rem;color:var(--heal);margin-left:0.5rem;';
    badge.textContent = 'Submission open';
    divEl.appendChild(btn);
    divEl.appendChild(badge);
  } else {
    btn.textContent = 'Allow BiS Submission';
    btn.onclick = function () {
      allowBisForPlayer(nameRealm, firstName);
    };
    divEl.appendChild(btn);
  }
}

function setBisAllowedForPlayer(nameRealm, firstName, allowed) {
  var divEl = document.getElementById('bisAllowDiv-' + firstName);
  if (divEl) divEl.innerHTML = '<span style="font-size:0.95rem;color:var(--text-muted);">Saving...</span>';

  if (!supabaseClient) {
    updateBisAllowDiv(nameRealm, firstName);
    return;
  }

  var player = findRosterPlayerByNameRealm(nameRealm);
  supabaseClient
    .from('players')
    .update({ bis_allowed: allowed })
    .eq('team_id', _teamCfg.supabaseTeamId)
    .eq('name_realm', nameRealm)
    .then(function (result) {
      if (!result.error && player) player.bisAllowed = allowed;
      if (!result.error) {
        writeAuditLog(
          allowed ? 'BiS Submission Enabled' : 'BiS Submission Revoked',
          'players',
          player ? player.id : null,
          null
        );
      }
      updateBisAllowDiv(nameRealm, firstName);
    });
}

function allowBisForPlayer(nameRealm, firstName) {
  setBisAllowedForPlayer(nameRealm, firstName, true);
}

function revokeBisForPlayer(nameRealm, firstName) {
  setBisAllowedForPlayer(nameRealm, firstName, false);
}

// -- Self-received (raider marks item from profile) ------------------------
function showSelfReceivedForm(firstName, item, slot, rowId, defaultSource, isOfficer) {
  if (event) event.stopPropagation();
  var formEl = document.getElementById('form-' + rowId);
  if (!formEl) return;
  if (formEl.style.display !== 'none') {
    formEl.style.display = 'none';
    return;
  }
  var sources = ['M+', 'Great Vault', 'Crafted', 'Catalyst', 'Bonus Roll', 'Other'];
  var opts = '<option value="">-- How did you get it? --</option>';
  for (var si = 0; si < sources.length; si++) {
    opts +=
      '<option value="' +
      sources[si] +
      '"' +
      (sources[si] === defaultSource ? ' selected' : '') +
      '>' +
      sources[si] +
      '</option>';
  }
  var fnSafe = firstName.replace(/'/g, "\\'");
  var itemSafe = item.replace(/'/g, "\\'");
  var slotSafe = slot.replace(/'/g, "\\'");
  var submitFn = isOfficer
    ? "submitDirectMarkReceived('" + fnSafe + "','" + itemSafe + "','" + slotSafe + "','" + rowId + "')"
    : "submitSelfReceivedRequest('" + fnSafe + "','" + itemSafe + "','" + slotSafe + "','" + rowId + "')";
  var submitLabel = isOfficer ? 'Mark received' : 'Submit request';
  var noteText = isOfficer
    ? ''
    : '<p class="self-received-note">An officer will review and approve this. Once approved it will appear on your profile.</p>';
  var formHtml =
    '<div class="self-received-form-inner" onclick="event.stopPropagation()">' +
    '<div style="display:flex;gap:0.5rem;margin-bottom:0.4rem;">' +
    '<select id="diff-' +
    rowId +
    '" class="self-received-source" style="flex:0 0 auto;width:auto;">' +
    '<option value="Mythic" selected>Mythic</option>' +
    '<option value="Heroic">Heroic</option>' +
    '<option value="Champion">Champion (Normal)</option>' +
    '</select>' +
    '<select class="self-received-source" id="src-' +
    rowId +
    '" style="flex:1;">' +
    opts +
    '</select>' +
    '</div>' +
    '<textarea class="self-received-notes" id="notes-' +
    rowId +
    '" placeholder="Notes (optional)" rows="2"></textarea>' +
    '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
    '<button class="btn btn-gold" style="font-size:0.92rem;padding:0.3rem 0.8rem;" onclick="event.stopPropagation();' +
    submitFn +
    '">' +
    submitLabel +
    '</button>' +
    '<button class="btn btn-muted" style="font-size:0.92rem;padding:0.3rem 0.8rem;" onclick="event.stopPropagation();document.getElementById(\'form-' +
    rowId +
    "').style.display='none'\">Cancel</button>" +
    '</div>' +
    noteText +
    '</div>';
  formEl.innerHTML = formHtml;
  formEl.style.display = 'block';
}

function submitSelfReceivedRequest(firstName, item, slot, rowId) {
  var sourceEl = /** @type {HTMLSelectElement} */ (document.getElementById('src-' + rowId));
  var notesEl = /** @type {HTMLTextAreaElement} */ (document.getElementById('notes-' + rowId));
  var diffEl = /** @type {HTMLSelectElement} */ (document.getElementById('diff-' + rowId));
  if (!sourceEl || !sourceEl.value) {
    if (sourceEl) sourceEl.style.borderColor = 'var(--melee)';
    return;
  }
  var diff = diffEl ? diffEl.value : 'Mythic';
  var source = diff + ': ' + sourceEl.value;
  var data = { player: firstName, item: item, slot: slot, source: source, notes: notesEl ? notesEl.value : '' };
  var formEl = document.getElementById('form-' + rowId);
  if (formEl)
    formEl.innerHTML = '<p style="font-size:0.95rem;color:var(--text-muted);padding:0.5rem 0;">Submitting...</p>';
  var cbName = '_selfRecCb' + rowId.replace(/[^a-zA-Z0-9]/g, '_');
  window[cbName] = function (result) {
    delete window[cbName];
    if (formEl) {
      if (result.error) {
        formEl.innerHTML =
          '<p style="font-size:0.95rem;color:var(--melee);padding:0.5rem 0;">Failed to submit. Try again.</p>';
      } else if (result.autoApproved) {
        formEl.innerHTML =
          '<p style="font-size:0.95rem;color:var(--text-muted);padding:0.5rem 0;">Marked as received.</p>';
        var btn = /** @type {HTMLElement} */ (
          document.querySelector('#bisrow-' + firstName + '-' + rowId.split('-').pop() + ' .mark-received-btn')
        );
        if (btn) btn.style.display = 'none';
      } else {
        formEl.innerHTML =
          '<p style="font-size:0.95rem;color:var(--text-muted);padding:0.5rem 0;">Request submitted -- pending officer approval.</p>';
        var btn = /** @type {HTMLElement} */ (
          document.querySelector('#bisrow-' + firstName + '-' + rowId.split('-').pop() + ' .mark-received-btn')
        );
        if (btn) btn.style.display = 'none';
      }
    }
  };
  // Include the Discord session token so GAS can auto-approve for verified raiders.
  var sessionToken = '';
  try {
    var ds = typeof getDiscordSession === 'function' ? getDiscordSession() : null;
    if (ds && ds.token) sessionToken = ds.token;
  } catch (_) {}
  var script = document.createElement('script');
  script.onerror = function () {
    delete window[cbName];
    if (formEl)
      formEl.innerHTML =
        '<p style="font-size:0.95rem;color:var(--melee);padding:0.5rem 0;">Failed to submit. Try again.</p>';
  };
  script.src =
    WEB_APP_URL +
    '?action=requestSelfReceived&data=' +
    encodeURIComponent(JSON.stringify(data)) +
    (sessionToken ? '&sessionToken=' + encodeURIComponent(sessionToken) : '') +
    '&callback=' +
    cbName;
  document.head.appendChild(script);
}

function submitDirectMarkReceived(firstName, item, slot, rowId) {
  var sourceEl = /** @type {HTMLSelectElement} */ (document.getElementById('src-' + rowId));
  var notesEl = /** @type {HTMLTextAreaElement} */ (document.getElementById('notes-' + rowId));
  var diffEl = /** @type {HTMLSelectElement} */ (document.getElementById('diff-' + rowId));
  if (!sourceEl || !sourceEl.value) {
    if (sourceEl) sourceEl.style.borderColor = 'var(--melee)';
    return;
  }
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
    if (formEl)
      formEl.innerHTML = '<p style="font-size:0.95rem;color:var(--melee);padding:0.5rem 0;">Failed. Try again.</p>';
  };
  script.src =
    WEB_APP_URL +
    '?action=directMarkReceived&data=' +
    encodeURIComponent(JSON.stringify(data)) +
    _getAuditChangedByParam() +
    '&callback=' +
    cbName;
  document.head.appendChild(script);
}

// -- Player profile (shared between public and officer pages) --------------
// backTo: 'landing' = public page, 'officer' = officer page
// container: optional DOM element to render into (officer inline panel);
//            if omitted renders into #profileView (public page)
function renderProfile(firstName, backTo, container) {
  var norm = normalise(firstName);
  var player = null;
  for (var i = 0; i < DATA.roster.length; i++) {
    if (normalise(DATA.roster[i].firstName) === norm) {
      player = DATA.roster[i];
      break;
    }
  }
  if (!player) return;

  var displayName = player.nick || player.firstName;
  var initials = displayName.slice(0, 2).toUpperCase();
  var classLine = player.class
    ? '<span class="badge badge-class" style="' +
      classBadgeStyle(player.class) +
      '">' +
      (player.spec || player.class) +
      '</span>'
    : '';
  var trialBadge = player.isTrial ? '<span class="badge badge-trial">Trial</span>' : '';
  var benchBadge = player.isBench
    ? '<span class="badge" style="background:rgba(255,255,255,0.04);color:var(--text);border:1px solid var(--border);">Bench</span>'
    : '';

  // Attendance
  var attendPct = player.attendance || '-';
  var barWidth = player.attendance || '0%';
  var attendDetail = (DATA.attendanceDetails || {})[player.firstName] || [];
  var hasPenalties = attendDetail.length > 0;
  var attendExtra = '';
  if (hasPenalties) {
    attendExtra +=
      '<div id="attend-detail-' +
      player.firstName +
      '" style="display:none;margin-top:0.75rem;flex-direction:column;gap:0.3rem;">';
    for (var ai = 0; ai < attendDetail.length; ai++) {
      var ae = attendDetail[ai];
      var sc = ae.status === 'No Show' ? 'var(--melee)' : 'var(--gold)';
      attendExtra +=
        '<div style="display:flex;justify-content:space-between;font-size:1rem;padding:0.25rem 0;border-bottom:1px solid var(--border);">';
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
      return new Date(b.date).getTime() - new Date(a.date).getTime();
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
      var li_sub =
        (li_slot ? '<span style="color:' + getSlotColor(li_slot) + ';">' + li_slot + '</span>' : '') +
        (li_slot && li_diff ? ' - ' : '') +
        (li_diff ? '<span>' + li_diff + '</span>' : '') +
        ((li_slot || li_diff) && li_date ? ' - ' : '') +
        (li_date ? '<span>' + li_date + '</span>' : '');
      lootItemsHTML +=
        '<div style="font-size:1rem;color:var(--text);padding:0.3rem 0;border-bottom:1px solid var(--border);">' +
        li_name +
        (li_sub
          ? '<div style="font-size:0.88rem;color:var(--text-muted);margin-top:0.1rem;">' + li_sub + '</div>'
          : '') +
        '</div>';
    }
  }

  // BiS link
  var bisStatusHTML = player.bisLink
    ? '<div class="bis-row"><div class="bis-dot yes"></div><a class="bis-link" href="' +
      player.bisLink +
      '" target="_blank" rel="noopener">View BiS Source</a></div>'
    : '<div class="bis-row"><div class="bis-dot no"></div><span class="bis-none">No BiS list submitted yet</span></div>';

  var bisActionHTML;
  if (backTo === 'officer') {
    var bisAllowed = bisAllowedFor(player.nameRealm);
    bisActionHTML =
      '<div style="margin-top:0.75rem;">' +
      '<button class="btn btn-muted" style="font-size:0.92rem;padding:0.3rem 0.8rem;" onclick="toggleBisForm(\'' +
      player.firstName.replace(/'/g, "\\'") +
      '\')">Update BiS Link</button>' +
      '<div id="bisForm-' +
      player.firstName +
      '" style="display:none;margin-top:0.75rem;">' +
      '<input type="url" id="bisUrl-' +
      player.firstName +
      '" placeholder="Paste BiS list URL" class="self-received-source" style="max-width:100%;font-size:1rem;">' +
      '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
      '<button class="btn request-approve-btn" onclick="officerUpdateBisLink(\'' +
      player.nameRealm.replace(/'/g, "\\'") +
      "','" +
      player.firstName.replace(/'/g, "\\'") +
      '\')">Save</button>' +
      '<button class="btn btn-muted" style="font-size:0.92rem;padding:0.25rem 0.75rem;" onclick="document.getElementById(\'bisForm-' +
      player.firstName +
      "').style.display='none'\">Cancel</button>" +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div id="bisAllowDiv-' +
      player.firstName +
      '" style="margin-top:0.5rem;"></div>';
  } else if (bisSubmissionsOpen() || bisAllowedFor(player.nameRealm)) {
    var bisBtnLabel = player.bisLink ? 'Update BiS List' : 'Submit BiS List';
    bisActionHTML =
      '<div style="margin-top:0.75rem;">' +
      '<button class="btn btn-muted" style="font-size:0.92rem;padding:0.3rem 0.8rem;" onclick="toggleBisForm(\'' +
      player.firstName.replace(/'/g, "\\'") +
      '\')">' +
      bisBtnLabel +
      '</button>' +
      '<div id="bisForm-' +
      player.firstName +
      '" style="display:none;margin-top:0.75rem;">' +
      '<input type="url" id="bisUrl-' +
      player.firstName +
      '" placeholder="Paste your BiS list URL" class="self-received-source" style="max-width:100%;font-size:1rem;">' +
      '<textarea id="bisNotes-' +
      player.firstName +
      '" placeholder="Notes (optional)" rows="2" class="self-received-notes" style="max-width:100%;margin-top:0.4rem;"></textarea>' +
      '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
      '<button class="btn btn-gold" style="font-size:0.92rem;padding:0.3rem 0.8rem;" onclick="submitBiSForm(\'' +
      player.nameRealm.replace(/'/g, "\\'") +
      "','" +
      player.firstName.replace(/'/g, "\\'") +
      '\')">Submit</button>' +
      '<button class="btn btn-muted" style="font-size:0.92rem;padding:0.3rem 0.8rem;" onclick="document.getElementById(\'bisForm-' +
      player.firstName +
      "').style.display='none'\">Cancel</button>" +
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
        ? '<div style="font-size:0.92rem;color:var(--text);margin-top:0.4rem;font-style:italic;">' +
          player.mPlusNote +
          '</div>'
        : '');
  } else if (player.mPlusRejected) {
    var fnMplusR = player.firstName.replace(/'/g, "\\'");
    var nrMplusR = player.nameRealm.replace(/'/g, "\\'");
    mplusHTML =
      '<div style="display:flex;align-items:center;gap:0.5rem;">' +
      '<span class="signup-status-badge signup-status-closed" style="font-size:0.8rem;">Rejected</span>' +
      '<span style="font-size:0.92rem;color:var(--text-muted);">Your M+ exclusion request was not approved.</span>' +
      '</div>' +
      (player.mPlusRejectionNote
        ? '<div style="margin-top:0.5rem;padding:0.4rem 0.6rem;background:rgba(255,124,92,0.08);border-left:3px solid var(--melee);border-radius:3px;font-size:0.92rem;color:var(--text);font-style:italic;">' +
          player.mPlusRejectionNote +
          '</div>'
        : '');
    if (DATA && DATA.mPlusExclusionsOpen) {
      mplusHTML +=
        '<div style="margin-top:0.75rem;">' +
        '<button class="btn btn-muted" style="font-size:0.92rem;padding:0.3rem 0.8rem;" onclick="toggleMPlusForm(\'' +
        fnMplusR +
        '\')">Re-submit Request</button>' +
        '<div id="mplusForm-' +
        player.firstName +
        '" style="display:none;margin-top:0.75rem;">' +
        '<div style="font-size:0.92rem;color:var(--text-muted);margin-bottom:0.5rem;">Submit your Raider.io profile to request exclusion from dungeon loot priority.</div>' +
        '<input type="url" id="mplusUrl-' +
        player.firstName +
        '" placeholder="https://raider.io/characters/..." class="self-received-source" style="max-width:100%;font-size:1rem;">' +
        '<textarea id="mplusNotes-' +
        player.firstName +
        '" placeholder="Notes (optional)" rows="2" class="self-received-notes" style="max-width:100%;margin-top:0.4rem;"></textarea>' +
        '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
        '<button class="btn btn-gold" style="font-size:0.92rem;padding:0.3rem 0.8rem;" onclick="submitMPlusExclusionForm(\'' +
        nrMplusR +
        "','" +
        fnMplusR +
        '\')">Submit</button>' +
        '<button class="btn btn-muted" style="font-size:0.92rem;padding:0.3rem 0.8rem;" onclick="document.getElementById(\'mplusForm-' +
        player.firstName +
        "').style.display='none'\">Cancel</button>" +
        '</div>' +
        '<p class="self-received-note">An officer will review your request. Once approved you will no longer need to do the required weekly M+ dungeons.</p>' +
        '</div>' +
        '</div>';
    }
  } else {
    if (DATA && DATA.mPlusExclusionsOpen) {
      var fnMplus = player.firstName.replace(/'/g, "\\'");
      var nrMplus = player.nameRealm.replace(/'/g, "\\'");
      mplusHTML =
        '<button class="btn btn-muted" style="font-size:0.92rem;padding:0.3rem 0.8rem;" onclick="toggleMPlusForm(\'' +
        fnMplus +
        '\')">Request M+ Exclusion</button>' +
        '<div id="mplusForm-' +
        player.firstName +
        '" style="display:none;margin-top:0.75rem;">' +
        '<div style="font-size:0.92rem;color:var(--text-muted);margin-bottom:0.5rem;">Submit your Raider.io profile to request exclusion from dungeon loot priority.</div>' +
        '<input type="url" id="mplusUrl-' +
        player.firstName +
        '" placeholder="https://raider.io/characters/..." class="self-received-source" style="max-width:100%;font-size:1rem;">' +
        '<textarea id="mplusNotes-' +
        player.firstName +
        '" placeholder="Notes (optional)" rows="2" class="self-received-notes" style="max-width:100%;margin-top:0.4rem;"></textarea>' +
        '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
        '<button class="btn btn-gold" style="font-size:0.92rem;padding:0.3rem 0.8rem;" onclick="submitMPlusExclusionForm(\'' +
        nrMplus +
        "','" +
        fnMplus +
        '\')">Submit</button>' +
        '<button class="btn btn-muted" style="font-size:0.92rem;padding:0.3rem 0.8rem;" onclick="document.getElementById(\'mplusForm-' +
        player.firstName +
        "').style.display='none'\">Cancel</button>" +
        '</div>' +
        '<p class="self-received-note">An officer will review your request. Once approved you will no longer need to do the required weekly M+ dungeons.</p>' +
        '</div>';
    } else {
      mplusHTML =
        '<span style="font-size:0.92rem;color:var(--text-muted);">M+ exclusion requests are currently closed.</span>';
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
    var item = entry.item,
      bisSlot = entry.slot;
    var rank = getRank(player.firstName, item);
    var slot = (DATA.itemSlots || {})[item] || bisSlot || '';
    var isGen = item === 'M+' || item === 'Crafted' || item === 'Catalyst';
    var received = receivedMap[normalise(item)] || null;
    var selfRec = selfRecMap[normalise(item)] || null;
    var isReceived = received || selfRec;
    var rowId = 'bisrow-' + player.firstName + '-' + bi;
    rows +=
      '<div class="priority-row' +
      (isReceived ? ' bis-received' : '') +
      '" id="' +
      rowId +
      '" style="grid-template-columns:auto auto 1fr auto;">';
    rows += isGen
      ? '<span style="font-size:0.97rem;color:var(--text-dim);min-width:40px;text-align:center;">-</span>'
      : rankPillHTML(rank);
    rows += '<span class="priority-item-slot" style="color:' + getSlotColor(slot) + ';">' + slot + '</span>';
    rows += '<span class="priority-item-name" style="text-align:right;" title="' + item + '">' + item + '</span>';
    var defaultSrc = isGen ? item : '';
    var isOfficer = backTo === 'officer';
    var officerFlag = isOfficer ? 'true' : 'false';
    var markRecvBtn =
      '<button class="mark-received-btn" style="font-size:0.78rem;padding:2px 7px;margin-top:2px;" onclick="event.stopPropagation();showSelfReceivedForm(\'' +
      player.firstName.replace(/'/g, "\\'") +
      "','" +
      item.replace(/'/g, "\\'") +
      "','" +
      slot.replace(/'/g, "\\'") +
      "','" +
      rowId +
      "','" +
      defaultSrc.replace(/'/g, "\\'") +
      "'," +
      officerFlag +
      ')">Mark received</button>';
    if (received) {
      var badges = '';
      for (var rv = 0; rv < received.length; rv++) {
        var rv_diff = received[rv].difficulty || '';
        var rv_date = received[rv].date || '';
        badges += '<span class="bis-received-badge">' + (rv_diff ? rv_diff + ' - ' : '') + rv_date + '</span>';
      }
      rows +=
        '<div style="display:flex;flex-direction:column;gap:2px;align-items:flex-end;">' +
        badges +
        (isOfficer ? markRecvBtn : '') +
        '</div>';
    } else if (selfRec) {
      rows +=
        '<div style="display:flex;flex-direction:column;gap:2px;align-items:flex-end;"><span class="bis-self-received-badge">' +
        (selfRec.source || 'Self-reported') +
        '</span>' +
        (isOfficer ? markRecvBtn : '') +
        '</div>';
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
    ? '<span id="bis-completion-' +
      player.firstName +
      '" style="font-size:0.95rem;"><span style="color:var(--gold-light);font-weight:600;">' +
      Math.round((bisReceivedCount / bisItems.length) * 100) +
      '%</span><span style="color:var(--text-muted);font-weight:400;"> (' +
      bisReceivedCount +
      '/' +
      bisItems.length +
      ')</span></span>'
    : '';

  var fullyBisBadge =
    bisItems.length > 0 && bisReceivedCount === bisItems.length
      ? '<span class="badge" style="background:rgba(212,175,55,0.15);color:var(--gold);border:1px solid rgba(212,175,55,0.45);font-weight:700;">Fully BiS</span>'
      : '';

  var priorityHTML = bisItems.length
    ? '<div class="priority-list">' +
      '<div class="priority-row" style="grid-template-columns:auto auto 1fr;background:transparent;border:none;padding:0.2rem 0.8rem;">' +
      '<span style="font-size:0.9rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text);">Prio</span>' +
      '<span style="font-size:0.9rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text);">Slot</span>' +
      '<span style="font-size:0.9rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text);text-align:right;">Item / Source</span>' +
      '</div>' +
      rows +
      '</div>'
    : '<p class="no-items-msg">No BiS items on record yet.</p>';

  var backLabel = backTo === 'officer' ? '<- Back to dashboard' : '<- Back to roster';
  var backAction =
    backTo === 'officer'
      ? "var ir=document.getElementById('inlineProfileRow');if(ir)ir.remove();selectedOfficerPlayer=null;document.querySelectorAll('.player-row').forEach(function(r){r.classList.remove('selected')});"
      : "showView('landing');document.getElementById('playerSelect').value='';";

  var officerActionsHTML = '';
  if (backTo === 'officer') {
    var currentNote = ((DATA && DATA.playerNotes) || {})[player.nameRealm] || '';
    var fnSafe = player.firstName.replace(/'/g, "\\'");
    var nrSafe = player.nameRealm.replace(/'/g, "\\'");
    var classKeys = Object.keys(CLASS_SPECS).sort();
    var classOptHtml = '<option value="">-- Select class --</option>';
    for (var ci = 0; ci < classKeys.length; ci++) {
      classOptHtml +=
        '<option value="' +
        classKeys[ci] +
        '"' +
        (player.class === classKeys[ci] ? ' selected' : '') +
        '>' +
        classKeys[ci] +
        '</option>';
    }
    var specOptHtml = '<option value="">-- Select spec --</option>';
    if (player.class && CLASS_SPECS[player.class]) {
      var specList = CLASS_SPECS[player.class].specs;
      for (var si = 0; si < specList.length; si++) {
        specOptHtml +=
          '<option value="' +
          specList[si] +
          '"' +
          (player.spec === specList[si] ? ' selected' : '') +
          '>' +
          specList[si] +
          '</option>';
      }
    }
    var realmOptHtml = '';
    for (var ri = 0; ri < WOW_REALMS.length; ri++) {
      realmOptHtml +=
        '<option value="' +
        WOW_REALMS[ri] +
        '"' +
        (player.realm === WOW_REALMS[ri] ? ' selected' : '') +
        '>' +
        WOW_REALMS[ri] +
        '</option>';
    }
    officerActionsHTML =
      '<div class="profile-section">' +
      '<div class="section-label" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" onclick="var d=document.getElementById(\'player-settings-' +
      fnSafe +
      "');var hint=document.getElementById('player-settings-hint-" +
      fnSafe +
      "');var open=d.style.display!=='none';d.style.display=open?'none':'';hint.textContent=open?'click to expand':'click to collapse';\">Player Settings<span id=\"player-settings-hint-" +
      fnSafe +
      '" style="font-size:0.95rem;color:var(--text-dim);">click to expand</span></div>' +
      '<div id="player-settings-' +
      fnSafe +
      '" style="display:none;">' +
      '<div style="display:flex;flex-direction:column;gap:0.75rem;margin-top:0.5rem;">' +
      '<div style="display:flex;align-items:center;gap:0.75rem;">' +
      '<span style="font-size:0.92rem;color:var(--text-muted);min-width:3.5rem;">Role</span>' +
      '<span style="font-size:0.92rem;color:var(--text);">' +
      (player.role || '-') +
      '</span>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:0.75rem;">' +
      '<span style="font-size:0.92rem;color:var(--text-muted);min-width:3.5rem;">Class</span>' +
      '<select id="classSelect-' +
      player.firstName +
      '" class="self-received-source" style="font-size:0.92rem;padding:0.25rem 0.5rem;max-width:12rem;" onchange="officerUpdateClass(\'' +
      nrSafe +
      "','" +
      fnSafe +
      '\',this.value)">' +
      classOptHtml +
      '</select>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:0.75rem;">' +
      '<span style="font-size:0.92rem;color:var(--text-muted);min-width:3.5rem;">Spec</span>' +
      '<select id="specSelect-' +
      player.firstName +
      '" class="self-received-source" style="font-size:0.92rem;padding:0.25rem 0.5rem;max-width:12rem;" onchange="officerSaveClassSpec(\'' +
      nrSafe +
      "','" +
      fnSafe +
      '\',this.value)">' +
      specOptHtml +
      '</select>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">' +
      '<span style="font-size:0.92rem;color:var(--text-muted);min-width:3.5rem;">Name</span>' +
      '<input type="text" id="editNameInput-' +
      player.firstName +
      '" value="' +
      player.firstName +
      '" class="self-received-source" style="font-size:0.92rem;padding:0.25rem 0.5rem;max-width:9rem;">' +
      '<select id="editRealmSelect-' +
      player.firstName +
      '" class="self-received-source" style="font-size:0.92rem;padding:0.25rem 0.5rem;max-width:10rem;">' +
      realmOptHtml +
      '</select>' +
      '<button class="btn btn-muted" style="font-size:0.88rem;padding:0.25rem 0.75rem;" onclick="officerRenamePlayer(\'' +
      nrSafe +
      "','" +
      fnSafe +
      '\')">Save</button>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:0.75rem;">' +
      '<span style="font-size:0.92rem;color:var(--text-muted);min-width:3.5rem;">Trial</span>' +
      '<button id="trialToggle-' +
      player.firstName +
      '" class="btn ' +
      (player.isTrial ? 'btn-gold' : 'btn-muted') +
      '" style="font-size:0.88rem;padding:0.25rem 0.75rem;" onclick="togglePlayerTrial(\'' +
      nrSafe +
      "','" +
      fnSafe +
      '\')">' +
      (player.isTrial ? 'Remove Trial' : 'Mark as Trial') +
      '</button>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:0.75rem;">' +
      '<span style="font-size:0.92rem;color:var(--text-muted);min-width:3.5rem;">Bench</span>' +
      '<button id="benchToggle-' +
      player.firstName +
      '" class="btn ' +
      (player.isBench ? 'btn-gold' : 'btn-muted') +
      '" style="font-size:0.88rem;padding:0.25rem 0.75rem;" onclick="togglePlayerBench(\'' +
      nrSafe +
      "','" +
      fnSafe +
      '\')">' +
      (player.isBench ? 'Remove from Bench' : 'Move to Bench') +
      '</button>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:0.75rem;">' +
      '<span style="font-size:0.92rem;color:var(--text-muted);min-width:3.5rem;">M+ Excl.</span>' +
      '<button id="mplusExclToggle-' +
      player.firstName +
      '" class="btn ' +
      (player.mPlusExcluded ? 'btn-gold' : 'btn-muted') +
      '" style="font-size:0.88rem;padding:0.25rem 0.75rem;" onclick="toggleMPlusExcluded(\'' +
      nrSafe +
      "','" +
      fnSafe +
      '\')">' +
      (player.mPlusExcluded ? 'Remove Exclusion' : 'Mark as Excluded') +
      '</button>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:0.75rem;">' +
      '<span style="font-size:0.92rem;color:var(--text-muted);min-width:3.5rem;">Joined</span>' +
      '<input type="date" id="joinDateInput-' +
      player.firstName +
      '" value="' +
      (player.joinDate || '') +
      '" class="self-received-source" style="font-size:0.92rem;padding:0.25rem 0.5rem;max-width:12rem;">' +
      '<button class="btn btn-muted" style="font-size:0.88rem;padding:0.25rem 0.75rem;" onclick="saveJoinDate(\'' +
      nrSafe +
      "','" +
      fnSafe +
      '\')">Save</button>' +
      '</div>' +
      '<div id="playerSettingsMsg-' +
      player.firstName +
      '" style="font-size:0.92rem;color:var(--text-muted);min-height:1.2rem;"></div>' +
      '<div style="display:flex;align-items:center;gap:0.75rem;padding-top:0.25rem;border-top:1px solid var(--border);margin-top:0.5rem;">' +
      '<span style="font-size:0.92rem;color:var(--text-muted);min-width:3.5rem;">Remove</span>' +
      '<button id="removePlayerBtn-' +
      player.firstName +
      '" class="btn btn-danger" style="font-size:0.88rem;padding:0.25rem 0.75rem;" onclick="confirmRemovePlayer(\'' +
      nrSafe +
      "','" +
      fnSafe +
      '\')">Remove Player</button>' +
      '<div id="removePlayerConfirm-' +
      player.firstName +
      '" style="display:none;gap:0.5rem;align-items:center;">' +
      '<span style="font-size:0.92rem;color:var(--melee);">Confirm?</span>' +
      '<button class="btn btn-danger" style="font-size:0.88rem;padding:0.25rem 0.75rem;" onclick="executeRemovePlayer(\'' +
      nrSafe +
      "','" +
      fnSafe +
      '\')">Yes, Remove</button>' +
      '<button class="btn btn-muted" style="font-size:0.88rem;padding:0.25rem 0.75rem;" onclick="cancelRemovePlayer(\'' +
      fnSafe +
      '\')">Cancel</button>' +
      '</div>' +
      '<span id="removePlayerMsg-' +
      player.firstName +
      '" style="display:none;font-size:0.92rem;"></span>' +
      '</div>' +
      '</div>' +
      '<div style="margin-top:1rem;">' +
      '<div style="font-size:0.88rem;color:var(--text-muted);margin-bottom:0.35rem;text-transform:uppercase;letter-spacing:0.08em;">Officer Notes</div>' +
      '<textarea id="playerNote-' +
      player.firstName +
      '" rows="3" class="self-received-notes" style="width:100%;box-sizing:border-box;font-size:0.92rem;">' +
      currentNote.replace(/</g, '&lt;').replace(/>/g, '&gt;') +
      '</textarea>' +
      '<div style="display:flex;gap:0.5rem;margin-top:0.4rem;align-items:center;">' +
      '<button class="btn btn-muted" style="font-size:0.88rem;padding:0.25rem 0.75rem;" onclick="savePlayerNote(\'' +
      nrSafe +
      "','" +
      fnSafe +
      '\')">Save Note</button>' +
      '<span id="playerNoteMsg-' +
      player.firstName +
      '" style="font-size:0.92rem;color:var(--text-muted);"></span>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>';
  }

  var html =
    '<div class="profile-card">' +
    '<div class="role-bar role-bar-' +
    player.role +
    '"></div>' +
    '<div style="padding:0.6rem 1.25rem;border-bottom:1px solid var(--border);">' +
    '<button onclick="' +
    backAction +
    '" style="background:none;border:none;color:var(--text);font-family:\'Rajdhani\',sans-serif;font-size:0.9rem;letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;padding:0;">' +
    backLabel +
    '</button>' +
    '</div>' +
    '<div class="profile-header">' +
    '<div class="profile-avatar avatar-' +
    player.role +
    '">' +
    initials +
    '</div>' +
    '<div class="profile-identity">' +
    '<div class="profile-name">' +
    displayName +
    '</div>' +
    '<div class="profile-realm">' +
    player.firstName +
    '-' +
    player.realm +
    '</div>' +
    '<div class="profile-badges"><span class="badge badge-' +
    player.role +
    '">' +
    player.role +
    '</span>' +
    trialBadge +
    benchBadge +
    classLine +
    fullyBisBadge +
    '</div>' +
    (player.joinDate
      ? '<div style="font-size:0.9rem;color:var(--text-muted);margin-top:0.35rem;">Joined: ' +
        formatJoinDate(player.joinDate) +
        '</div>'
      : '') +
    '</div>' +
    '</div>' +
    '<div class="profile-section">' +
    '<div class="section-label" style="display:flex;justify-content:space-between;align-items:center;' +
    (backTo === 'officer' || hasPenalties ? 'cursor:pointer;"' : '"') +
    (backTo === 'officer'
      ? ' onclick="loadAttendanceHistory(\'' + player.firstName.replace(/'/g, "\\'") + '\')"'
      : hasPenalties
        ? ' onclick="var d=document.getElementById(\'attend-detail-' +
          player.firstName +
          "');d.style.display=d.style.display==='none'?'flex':'none';\""
        : '') +
    '>Attendance' +
    (backTo === 'officer'
      ? '<span class="attend-history-hint" style="font-size:0.95rem;color:var(--text-dim);">click to expand</span>'
      : hasPenalties
        ? '<span style="font-size:0.95rem;color:var(--text-dim);">click to expand</span>'
        : '') +
    '</div>' +
    '<div class="attend-row"><div class="attend-bar-wrap"><div class="attend-bar" style="width:' +
    barWidth +
    '"></div></div><span class="attend-label">' +
    attendPct +
    '</span></div>' +
    renderAttendTrend(player.firstName) +
    (backTo === 'officer'
      ? '<div id="attend-history-' + player.firstName + '" style="display:none;margin-top:0.6rem;"></div>'
      : attendExtra) +
    '</div>' +
    '<div class="profile-section">' +
    '<div class="section-label" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" onclick="var l=document.getElementById(\'loot-list-' +
    player.firstName +
    "');l.style.display=l.style.display==='none'?'grid':'none';\">Items Received <span style=\"font-size:0.95rem;color:var(--text-dim);\">click to expand</span></div>" +
    '<div style="font-size:1.1rem;font-weight:600;color:var(--gold);">' +
    lootCount +
    ' item' +
    (lootCount !== 1 ? 's' : '') +
    (ACTIVE_SEASON ? ' — ' + ACTIVE_SEASON : ' this tier') +
    '</div>' +
    (lastItems.length
      ? (function () {
          var lastDate = lastItems[0].date || '';
          var itemLines = '';
          for (var lx = 0; lx < lastItems.length; lx++) {
            var lxi = lastItems[lx];
            var lxColor =
              lxi.difficulty === 'Mythic' ? '#b085f0' : lxi.difficulty === 'Heroic' ? '#4dd9e0' : 'var(--gold)';
            itemLines +=
              '<div' +
              (lx > 0 ? ' style="margin-top:0.3rem;padding-top:0.3rem;border-top:1px solid var(--border);"' : '') +
              '>' +
              '<div style="font-size:1rem;color:' +
              lxColor +
              ';font-weight:600;">' +
              lxi.name +
              '</div>' +
              (lxi.difficulty
                ? '<div style="font-size:0.88rem;color:var(--text-muted);margin-top:0.1rem;">' +
                  lxi.difficulty +
                  '</div>'
                : '') +
              '</div>';
          }
          return (
            '<div style="margin-top:0.6rem;padding:0.5rem 0.75rem;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:4px;display:flex;align-items:center;justify-content:space-between;">' +
            '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:0.8rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:0.25rem;">Last received' +
            (lastDate ? ' - ' + lastDate : '') +
            '</div>' +
            itemLines +
            '</div>' +
            '<span style="font-size:1.8rem;font-weight:700;color:var(--gold);line-height:1;margin-left:0.75rem;">&#8679;</span>' +
            '</div>'
          );
        })()
      : '') +
    '<div id="loot-list-' +
    player.firstName +
    '" style="display:none;margin-top:0.75rem;grid-template-columns:1fr 1fr;gap:0 1rem;">' +
    lootItemsHTML +
    '</div>' +
    '</div>' +
    '<div class="profile-section"><div class="section-label">BiS Link</div>' +
    bisHTML +
    '</div>' +
    '<div class="profile-section">' +
    '<div class="section-label" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" onclick="var l=document.getElementById(\'prio-list-' +
    player.firstName +
    "');l.style.display=l.style.display==='none'?'block':'none';\">BiS List" +
    bisCompletionHTML +
    '<span style="font-size:0.95rem;color:var(--text-dim);">click to expand</span></div>' +
    '<div id="prio-list-' +
    player.firstName +
    '" style="display:none;">' +
    priorityHTML +
    '</div>' +
    '</div>' +
    (mplusHTML
      ? '<div class="profile-section"><div class="section-label">M+ Exclusion</div>' + mplusHTML + '</div>'
      : '') +
    officerActionsHTML +
    '</div>';

  if (container) {
    container.innerHTML = html;
  } else {
    document.getElementById('profileView').innerHTML = html;
  }
  if (backTo === 'officer') updateBisAllowDiv(player.nameRealm, player.firstName);
}

// #241 follow-up: reads straight from Supabase's attendance table instead of
// the GAS getPlayerAttendanceFull action, which reads the Attendance Google
// Sheet and has no visibility into writes this card (or the Attendance tab,
// #218) make straight to Supabase -- confirmed via manual testing, a change
// reverted on page reload because the Sheet-sourced read never saw it. The
// full historical import (#320) already backfilled every Sheet row into
// Supabase, so an empty result here means the player genuinely has no
// history, not that the read needs to fall back to GAS; only a query error
// falls back, same convention as fetchSupabaseRoster/BiS/priority_order.
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

  content.innerHTML =
    '<span style="color:var(--text-muted);font-size:0.95rem;padding:0.5rem 0;display:block;">Loading...</span>';
  content.style.display = 'block';

  var norm = normalise(firstName);
  var roster = (DATA && DATA.roster) || [];
  var player = null;
  for (var i = 0; i < roster.length; i++) {
    if (normalise(roster[i].firstName) === norm) {
      player = roster[i];
      break;
    }
  }

  if (!player || !player.id || !supabaseClient) {
    loadAttendanceHistoryFromGAS(firstName, content, hint);
    return;
  }

  supabaseClient
    .from('attendance')
    .select('raid_date, status')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .eq('player_id', player.id)
    .then(function (result) {
      if (result.error) {
        console.warn('Supabase attendance query failed, using Apps Script history.', result.error.message);
        loadAttendanceHistoryFromGAS(firstName, content, hint);
        return;
      }
      content.dataset.loaded = '1';
      if (hint) hint.textContent = 'click to collapse';

      var history = (result.data || []).map(function (row) {
        return { date: row.raid_date, status: row.status };
      });
      history.sort(function (a, b) {
        return b.date < a.date ? -1 : b.date > a.date ? 1 : 0;
      });

      renderAttendanceHistoryCard(firstName, content, history);
    });
}

function loadAttendanceHistoryFromGAS(firstName, content, hint) {
  var cbName = '_attendHistCb' + firstName.replace(/[^a-zA-Z0-9]/g, '_');
  window[cbName] = function (result) {
    delete window[cbName];
    content.dataset.loaded = '1';
    if (hint) hint.textContent = 'click to collapse';

    var history = (result && result.history) || [];
    history = history.slice().sort(function (a, b) {
      return b.date < a.date ? -1 : b.date > a.date ? 1 : 0;
    });

    renderAttendanceHistoryCard(firstName, content, history);
  };

  var script = document.createElement('script');
  script.onerror = function () {
    delete window[cbName];
    content.innerHTML =
      '<p style="color:var(--melee);font-size:0.95rem;padding:0.5rem 0;">Failed to load. Try again.</p>';
  };
  script.src =
    WEB_APP_URL + '?action=getPlayerAttendanceFull&firstName=' + encodeURIComponent(firstName) + '&callback=' + cbName;
  document.head.appendChild(script);
}

// getPlayerAttendanceFull (the source loadAttendanceHistory fetches from) is
// still an Apps Script/Sheets read -- it has no idea about rows written
// straight to Supabase's attendance table, so a GAS re-fetch after
// addAttendanceNight's write would just show the same stale list again. This
// cache lets that write update the rendered card in place instead of relying
// on a round-trip that can never see it.
var _attendHistCache = {};

// #241: renders the existing per-night history (unchanged from before) plus
// an "Add raid night" control for creating a row on a night the player has
// none for at all -- the gap the old card had no way to fill, since every
// row it could show already had to exist first.
function renderAttendanceHistoryCard(firstName, content, history) {
  _attendHistCache[firstName] = history;
  var addControlHtml = '<div id="attend-add-night-' + firstName + '"></div>';

  if (!history.length) {
    content.innerHTML =
      '<p style="color:var(--text-muted);font-size:0.95rem;padding:0.5rem 0;">No attendance records found.</p>' +
      addControlHtml;
    renderAddAttendanceNightControl(firstName, history);
    return;
  }

  var counts = {};
  for (var i = 0; i < history.length; i++) {
    /** @type {string} */
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
    if (counts[st])
      summaryParts.push('<span style="color:' + statusColor(st) + ';">' + counts[st] + ' ' + st + '</span>');
  }
  var otherKeys = Object.keys(counts).filter(function (k) {
    return order.indexOf(k) === -1;
  });
  for (var ok = 0; ok < otherKeys.length; ok++) {
    summaryParts.push(
      '<span style="color:var(--text-muted);">' + counts[otherKeys[ok]] + ' ' + otherKeys[ok] + '</span>'
    );
  }

  var CARD_STATUSES = ['Present', 'Bench', 'Medical Leave', 'Excused', 'Extended Leave', 'No Show', 'Not on Roster'];

  var html =
    '<div style="font-size:0.88rem;color:var(--text-muted);margin-bottom:0.6rem;display:flex;gap:0.5rem;flex-wrap:wrap;">' +
    summaryParts.join('<span style="color:var(--border-mid);">|</span>') +
    '</div>';
  html += '<div style="max-height:260px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;">';
  for (var j = 0; j < history.length; j++) {
    var entry = history[j];
    var isNOR = entry.status === 'Not on Roster';
    html +=
      '<div style="display:flex;justify-content:space-between;align-items:center;font-size:0.95rem;padding:0.28rem 0.75rem;border-bottom:1px solid var(--border);gap:0.5rem;">';
    html += '<span style="color:var(--text);white-space:nowrap;">' + entry.date + '</span>';
    if (isNOR) {
      html += '<span style="color:' + statusColor(entry.status) + ';font-weight:600;">' + entry.status + '</span>';
    } else {
      html += '<div style="display:flex;align-items:center;gap:0.4rem;">';
      html += '<div class="attend-status-wrap">';
      html +=
        '<select class="attend-status-select attend-card-status-select" data-date="' +
        entry.date +
        '" data-name="' +
        firstName +
        '" data-old="' +
        entry.status +
        '" onchange="saveAttendanceFromCard(this)">';
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
  content.innerHTML = html + addControlHtml;
  renderAddAttendanceNightControl(firstName, history);
}

// #241: populates the "Add raid night" control with every raid date the team
// has an attendance row for (from anyone), minus dates this player already
// has a row for (shown above) and minus dates before the player's join date
// (those are backfilled as "Not on Roster" automatically -- see
// backfillNotOnRosterForPlayer in tab-roster.js -- and aren't manual-entry
// candidates).
function renderAddAttendanceNightControl(firstName, history) {
  var container = document.getElementById('attend-add-night-' + firstName);
  if (!container || !supabaseClient) return;

  var norm = normalise(firstName);
  var roster = (DATA && DATA.roster) || [];
  var player = null;
  for (var i = 0; i < roster.length; i++) {
    if (normalise(roster[i].firstName) === norm) {
      player = roster[i];
      break;
    }
  }
  if (!player || !player.id) return;

  var existingDates = {};
  for (var h = 0; h < history.length; h++) existingDates[history[h].date] = true;

  supabaseClient
    .from('attendance')
    .select('raid_date')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .then(function (result) {
      if (result.error) return;
      var seen = {};
      var dates = [];
      (result.data || []).forEach(function (row) {
        var d = row.raid_date;
        if (!d || seen[d] || existingDates[d]) return;
        if (player.joinDate && d < player.joinDate) return;
        seen[d] = true;
        dates.push(d);
      });
      if (!dates.length) return;
      dates.sort();

      var CARD_STATUSES = [
        'Present',
        'Bench',
        'Medical Leave',
        'Excused',
        'Extended Leave',
        'No Show',
        'Not on Roster'
      ];
      var dateOptions = dates
        .map(function (d) {
          return '<option value="' + d + '">' + d + '</option>';
        })
        .join('');
      var statusOptions = CARD_STATUSES.map(function (s) {
        return '<option value="' + s + '">' + s + '</option>';
      }).join('');
      var nameSafe = firstName.replace(/'/g, "\\'");

      container.innerHTML =
        '<div style="display:flex;align-items:center;gap:0.4rem;margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid var(--border);flex-wrap:wrap;">' +
        '<span style="font-size:0.9rem;color:var(--text-muted);">Add raid night:</span>' +
        '<select id="attend-add-date-' +
        firstName +
        '" style="font-size:0.9rem;padding:0.15rem 0.35rem;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);">' +
        dateOptions +
        '</select>' +
        '<select id="attend-add-status-' +
        firstName +
        '" style="font-size:0.9rem;padding:0.15rem 0.35rem;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);">' +
        statusOptions +
        '</select>' +
        '<button class="btn btn-gold" style="font-size:0.85rem;padding:0.2rem 0.6rem;" onclick="addAttendanceNight(\'' +
        nameSafe +
        '\')">Add</button>' +
        '<span id="attend-add-ind-' +
        firstName +
        '" style="font-size:0.85rem;"></span>' +
        '</div>';
    });
}

// #241: creates the attendance row saveAttendanceFromCard's per-row dropdown
// has nothing to edit until it exists -- same upsert + audit log shape, just
// a different entry point (a brand-new date instead of an existing row).
function addAttendanceNight(firstName) {
  var dateSel = /** @type {HTMLSelectElement} */ (document.getElementById('attend-add-date-' + firstName));
  var statusSel = /** @type {HTMLSelectElement} */ (document.getElementById('attend-add-status-' + firstName));
  var ind = document.getElementById('attend-add-ind-' + firstName);
  if (!dateSel || !statusSel) return;
  var date = dateSel.value;
  var status = statusSel.value;
  if (!date || !status) return;

  var norm = normalise(firstName);
  var roster = (DATA && DATA.roster) || [];
  var player = null;
  for (var i = 0; i < roster.length; i++) {
    if (normalise(roster[i].firstName) === norm) {
      player = roster[i];
      break;
    }
  }
  if (!player || !player.id) return;

  dateSel.disabled = true;
  statusSel.disabled = true;
  if (ind) {
    ind.textContent = 'Saving...';
    ind.style.color = 'var(--text-muted)';
  }

  supabaseClient
    .from('attendance')
    .upsert(
      { team_id: _teamCfg.supabaseTeamId, player_id: player.id, raid_date: date, status: status },
      { onConflict: 'team_id,player_id,raid_date' }
    )
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);
      return writeAuditLog('Attendance Status Set', 'players', player.id, '(none) -> ' + status + ' (' + date + ')');
    })
    .then(function () {
      applyNewAttendanceNight(firstName, date, status);
    })
    .catch(function (err) {
      dateSel.disabled = false;
      statusSel.disabled = false;
      console.warn('Failed to add attendance night.', err);
      if (ind) {
        ind.textContent = 'Error';
        ind.style.color = 'var(--melee)';
        setTimeout(function () {
          if (ind) ind.textContent = '';
        }, 3000);
      }
    });
}

// Updates the rendered card in place after a successful add, instead of
// re-fetching history from GAS (which can never see a write that landed
// straight in Supabase -- see the _attendHistCache comment above).
function applyNewAttendanceNight(firstName, date, status) {
  var content = document.getElementById('attend-history-' + firstName);
  if (!content) return;
  var history = (_attendHistCache[firstName] || []).filter(function (e) {
    return e.date !== date;
  });
  history.push({ date: date, status: status });
  history.sort(function (a, b) {
    return b.date < a.date ? -1 : b.date > a.date ? 1 : 0;
  });
  renderAttendanceHistoryCard(firstName, content, history);
}

// Second write path onto the same attendance table setPlayerStatus()
// (js/tabs/tab-attendance.js, #218) covers -- this one fires from the
// player-profile "Attendance" history card instead of the Attendance tab's
// per-night grid. Same Supabase upsert + audit log shape as that one.
function saveAttendanceFromCard(selectEl) {
  var date = selectEl.getAttribute('data-date');
  var firstName = selectEl.getAttribute('data-name');
  var status = selectEl.value;
  var oldStatus = selectEl.getAttribute('data-old');
  var indicator =
    selectEl.parentElement && selectEl.parentElement.parentElement
      ? selectEl.parentElement.parentElement.querySelector('.attend-save-ind')
      : null;

  if (!status) return;

  var norm = normalise(firstName);
  var roster = (DATA && DATA.roster) || [];
  var player = null;
  for (var i = 0; i < roster.length; i++) {
    if (normalise(roster[i].firstName) === norm) {
      player = roster[i];
      break;
    }
  }
  if (!player || !player.id) {
    selectEl.value = oldStatus || '';
    if (indicator) {
      indicator.textContent = 'Error';
      indicator.style.color = 'var(--melee)';
      setTimeout(function () {
        if (indicator) indicator.textContent = '';
      }, 3000);
    }
    return;
  }

  selectEl.disabled = true;
  if (indicator) {
    indicator.textContent = 'Saving...';
    indicator.style.color = 'var(--text-muted)';
  }

  supabaseClient
    .from('attendance')
    .upsert(
      { team_id: _teamCfg.supabaseTeamId, player_id: player.id, raid_date: date, status: status },
      { onConflict: 'team_id,player_id,raid_date' }
    )
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);
      return writeAuditLog('Attendance Status Set', 'players', player.id, (oldStatus || '(none)') + ' -> ' + status);
    })
    .then(function () {
      selectEl.disabled = false;
      selectEl.setAttribute('data-old', status);
      if (indicator) {
        indicator.textContent = 'Saved';
        indicator.style.color = 'var(--heal)';
        setTimeout(function () {
          if (indicator) indicator.textContent = '';
        }, 2000);
      }
    })
    .catch(function (err) {
      selectEl.disabled = false;
      selectEl.value = oldStatus || '';
      console.warn('Failed to save attendance status.', err);
      if (indicator) {
        indicator.textContent = 'Error';
        indicator.style.color = 'var(--melee)';
        setTimeout(function () {
          if (indicator) indicator.textContent = '';
        }, 3000);
      }
    });
}
