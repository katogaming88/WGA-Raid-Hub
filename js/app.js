var WEB_APP_URL  = 'https://script.google.com/macros/s/AKfycbxrQdQGqbBTELWm7huWChdbES0ry7WFZetlELWuEdI0T6lfbXEzrqx9Vo5yA-b9dW4y7A/exec';
var OFFICER_PASS = 'phoenix2'; // change this
var VERSION      = '1.6.0';
var DATA         = null;
var activeFilters = {};
var activeSort = { key: null, dir: 1 };
var selectedOfficerPlayer = null;
var activeDiffFilter = 'all';
var signupStep = 1;
var signupData = {};

var WOW_REALMS = [
  // NA
  'Aegwynn','Aggramar','Akama','Alexstrasza','Alleria','Altar of Storms','Alterac Mountains',
  'Andorhal','Anetheron','Antonidas',"Anub'arak",'Anvilmar','Arathor','Archimonde',
  'Area 52','Argent Dawn','Arthas','Arygos','Auchindoun','Azgalor','Azjol-Nerub','Azralon',
  'Azshara','Azuremyst','Baelgun','Black Dragonflight','Blackhand','Blackrock',
  'Blackwater Raiders','Blackwing Lair',"Blade's Edge",'Bladefist','Bleeding Hollow',
  'Blood Furnace','Bloodhoof','Bloodscalp','Bonechewer','Borean Tundra','Boulderfist',
  'Bronze Dragonflight','Bronzebeard','Burning Blade','Burning Legion','Cairne',
  'Cenarion Circle','Cenarius',"Cho'gall",'Chromaggus','Crushridge','Daggerspine','Dalaran',
  'Dalvengyr','Dark Iron','Darrowmere','Dawnbringer','Deathwing','Demon Soul','Destromath',
  'Detheroc','Doomhammer','Dragonblight','Dragonmaw',"Drak'Tharon","Drak'thul",
  'Drenden','Dunemaul','Durotan','Duskwood','Earthen Ring','Echo Isles','Eitrigg',
  "Eldre'Thalas",'Elune','Emerald Dream','Eonar','Eredar','Executus','Exodar','Farstriders',
  'Feathermoon','Fenris','Fizzcrank','Frostmane','Frostwolf','Garithos','Garona','Garrosh',
  'Ghostlands','Gilneas','Gnomeregan','Gorefiend','Greymane','Grizzly Hills',"Gul'dan",
  'Gurubashi','Hakkar','Haomarush','Hellscream','Hydraxis','Hyjal','Icecrown',
  'Illidan','Jaedenar',"Kael'thas",'Kalecgos','Kargath',"Kel'Thuzad",
  'Khaz Modan',"Kil'jaeden",'Kilrogg','Kirin Tor','Korgath','Korialstrasz',
  'Kul Tiras','Laughing Skull','Lethon','Lightbringer',"Lightning's Blade",'Lightninghoof',
  'Llane','Lothar','Madoran','Maelstrom','Magtheridon','Maiev',"Mal'Ganis",'Malorne',
  'Malygos','Mannoroth','Medivh','Misha',"Mok'Nathal",'Moon Guard','Moonrunner',"Mug'thol",
  'Muradin','Nathrezim','Nazgrel','Nazjatar','Nesingwary','Norgannon','Nordrassil',
  'Onyxia','Perenolde','Proudmoore',"Quel'dorei",'Ravenholdt','Rexxar',
  'Rivendare','Runetotem','Scarlet Crusade','Scilla',"Sen'jin",'Sentinels','Shadow Council',
  'Shadowmoon','Shadowsong','Shattered Halls','Shattered Hand',"Shu'halo",'Silver Hand',
  'Silvermoon','Sisters of Elune','Skullcrusher','Skywall','Smolderthorn','Spinebreaker',
  'Spirestone','Staghelm','Steamwheedle Cartel','Stonemaul','Stormrage','Stormreaver',
  'Stormscale','Sulfuras','Tanaris','Terenas','Terokkar','Thorium Brotherhood','Thrall',
  'Thunderhorn','Thunderlord','Tichondrius','Tirion','Tortheldrin','Trollbane','Turalyon',
  'Twisting Nether','Uther','Vashj','Velen','Venture Co','Whisperwind','Wildhammer',
  'Windrunner','Winterhoof','Wyrmrest Accord','Ysera','Ysondre','Zangarmarsh',"Zul'jin",
  'Zuluhed',
  // OCE
  "Aman'Thul",'Barthilas','Caelestrasz',"Dath'Remar",'Dreadmaul','Frostmourne',
  'Gundrak',"Jubei'Thos","Khaz'goroth",'Nagrand','Saurfang','Thaurissan'
].sort();

var CLASS_SPECS = {
  'Death Knight': { specs: ['Blood','Frost','Unholy'],                   roles: ['Tank','DPS'] },
  'Demon Hunter': { specs: ['Havoc','Vengeance','Devourer'],             roles: ['Tank','DPS'] },
  'Druid':        { specs: ['Balance','Feral','Guardian','Restoration'], roles: ['Tank','Healer','DPS'] },
  'Evoker':       { specs: ['Augmentation','Devastation','Preservation'],roles: ['Healer','DPS'] },
  'Hunter':       { specs: ['Beast Mastery','Marksmanship','Survival'],  roles: null },
  'Mage':         { specs: ['Arcane','Fire','Frost'],                    roles: null },
  'Monk':         { specs: ['Brewmaster','Mistweaver','Windwalker'],     roles: ['Tank','Healer','DPS'] },
  'Paladin':      { specs: ['Holy','Protection','Retribution'],          roles: ['Tank','Healer','DPS'] },
  'Priest':       { specs: ['Discipline','Holy','Shadow'],               roles: ['Healer','DPS'] },
  'Rogue':        { specs: ['Assassination','Outlaw','Subtlety'],        roles: null },
  'Shaman':       { specs: ['Elemental','Enhancement','Restoration'],    roles: ['Healer','DPS'] },
  'Warlock':      { specs: ['Affliction','Demonology','Destruction'],    roles: null },
  'Warrior':      { specs: ['Arms','Fury','Protection'],                 roles: ['Tank','DPS'] }
};

var CLASS_COLORS = {
  'Death Knight': '#C41E3A',
  'Demon Hunter': '#A330C9',
  'Druid':        '#FF7C0A',
  'Evoker':       '#33937F',
  'Hunter':       '#AAD372',
  'Mage':         '#3FC7EB',
  'Monk':         '#00FF98',
  'Paladin':      '#F48CBA',
  'Priest':       '#FFFFFF',
  'Rogue':        '#FFF468',
  'Shaman':       '#0070DD',
  'Warlock':      '#8788EE',
  'Warrior':      '#C69B3A'
};

function classColor(cls) {
  return CLASS_COLORS[cls] || 'var(--text)';
}

function classHexToRgba(hex, a) {
  var r = parseInt(hex.slice(1,3), 16);
  var g = parseInt(hex.slice(3,5), 16);
  var b = parseInt(hex.slice(5,7), 16);
  return 'rgba('+r+','+g+','+b+','+a+')';
}

function classBadgeStyle(cls) {
  var hex = CLASS_COLORS[cls];
  if (!hex) return '';
  return 'color:'+hex+';background:'+classHexToRgba(hex,0.1)+';border-color:'+classHexToRgba(hex,0.25)+';';
}

function normalise(str) {
  return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// -- Views ------------------------------------------------------------------
function showView(name) {
  document.getElementById('loadingMsg').style.display = 'none';
  ['landingView','profileViewWrap','officerViewWrap','signupViewWrap'].forEach(function(id) {
    document.getElementById(id).classList.remove('active');
  });
  if (name === 'landing') { document.getElementById('landingView').classList.add('active'); renderSignupLandingLink(); }
  if (name === 'profile') document.getElementById('profileViewWrap').classList.add('active');
  if (name === 'officer') document.getElementById('officerViewWrap').classList.add('active');
  if (name === 'signup')  document.getElementById('signupViewWrap').classList.add('active');
}

// -- Tabs -------------------------------------------------------------------
function switchTab(name) {
  document.querySelectorAll('.nav-item').forEach(function(b) { b.classList.remove('active'); });
  document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
  event.target.classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
  if (name === 'conflicts')  buildConflicts();
  if (name === 'fairness')   buildFairness();
  if (name === 'attendance') buildAttendanceTab();
  if (name === 'priority')   buildPriorityTab();
  if (name === 'signups')    buildSignupsTab();
  if (name === 'requests')   buildRequestsTab();
  if (name === 'bis')        buildBisTab();
}

// -- Load data --------------------------------------------------------------
function loadData() {
  window._rosterCallback = function(data) {
    try {
      if (data.error) throw new Error(data.error);
      DATA = data;
      DATA._loadedAt = new Date();
      populateDropdown();
      if (sessionStorage.getItem('phoenix_officer') === '1') {
        buildOfficerDashboard();
        showView('officer');
      } else {
        showView('landing');
      }
    } catch (e) {
      document.getElementById('loadingMsg').className = 'state-msg error';
      document.getElementById('loadingMsg').innerHTML = 'Could not load roster data. ' + e.message;
    }
  };
  var script = document.createElement('script');
  script.src = WEB_APP_URL + '?callback=_rosterCallback';
  script.onerror = function() {
    document.getElementById('loadingMsg').className = 'state-msg error';
    document.getElementById('loadingMsg').innerHTML = 'Could not load roster data.';
  };
  document.head.appendChild(script);
  setTimeout(function() {
    if (!DATA) {
      document.getElementById('loadingMsg').className = 'state-msg error';
      document.getElementById('loadingMsg').innerHTML = 'Request timed out.';
    }
  }, 15000);
}

// -- Cache ------------------------------------------------------------------
function clearCache() {
  var btn = document.getElementById('clearCacheBtn');
  btn.disabled = true;
  btn.textContent = 'Clearing...';

  var cbName = '_clearCacheCallback';
  window[cbName] = function(data) {
    delete window[cbName];
    if (data && data.success) {
      btn.textContent = 'Cleared!';
      setTimeout(function() {
        btn.textContent = 'Clear Cache';
        btn.disabled = false;
      }, 2000);
    } else {
      btn.textContent = 'Error';
      setTimeout(function() {
        btn.textContent = 'Clear Cache';
        btn.disabled = false;
      }, 2000);
    }
  };

  var script = document.createElement('script');
  script.src = WEB_APP_URL + '?action=clearCache&callback=' + cbName;
  script.onerror = function() {
    delete window[cbName];
    btn.textContent = 'Error';
    setTimeout(function() {
      btn.textContent = 'Clear Cache';
      btn.disabled = false;
    }, 2000);
  };
  document.head.appendChild(script);
}

// -- Dropdown ---------------------------------------------------------------
function populateDropdown() {
  var sel    = document.getElementById('playerSelect');
  var order  = ['Tank','Heal','Melee','Ranged'];
  var labels = { Tank:'🛡 Tanks', Heal:'💚 Healers', Melee:'⚔️ Melee', Ranged:'🏹 Ranged' };
  var groups = { Tank:[], Heal:[], Melee:[], Ranged:[] };
  for (var i = 0; i < DATA.roster.length; i++) {
    var p = DATA.roster[i];
    if (!p.isBench && groups[p.role]) groups[p.role].push(p);
  }
  for (var r = 0; r < order.length; r++) {
    var role = order[r];
    var players = groups[role];
    if (!players.length) continue;
    players.sort(function(a,b) { return (a.nick||a.firstName).localeCompare(b.nick||b.firstName); });
    var group = document.createElement('optgroup');
    group.label = labels[role];
    for (var j = 0; j < players.length; j++) {
      var p = players[j];
      var opt = document.createElement('option');
      opt.value = p.firstName;
      opt.textContent = p.nick ? p.nick + ' (' + p.firstName + ')' : p.firstName;
      group.appendChild(opt);
    }
    sel.appendChild(group);
  }
}

document.getElementById('playerSelect').addEventListener('change', function(e) {
  if (e.target.value) { showView('profile'); renderProfile(e.target.value, 'landing'); }
});

// -- Officer prompt ---------------------------------------------------------
function showOfficerPrompt() {
  document.getElementById('officerPassword').value = '';
  document.getElementById('officerError').style.display = 'none';
  document.getElementById('officerPrompt').classList.add('active');
  setTimeout(function() { document.getElementById('officerPassword').focus(); }, 50);
}
function hideOfficerPrompt() { document.getElementById('officerPrompt').classList.remove('active'); }
function submitOfficerPassword() {
  if (document.getElementById('officerPassword').value === OFFICER_PASS) {
    sessionStorage.setItem('phoenix_officer','1');
    hideOfficerPrompt();
    buildOfficerDashboard();
    showView('officer');
  } else {
    document.getElementById('officerError').style.display = '';
  }
}
function officerLogout() { sessionStorage.removeItem('phoenix_officer'); showView('landing'); }

// -- Helpers ----------------------------------------------------------------
function getRank(firstName, itemName) {
  var list = (DATA.priorityOrder || {})[itemName];
  if (!list) return null;
  var norm = normalise(firstName);
  for (var i = 0; i < list.length; i++) { if (normalise(list[i]) === norm) return i + 1; }
  return null;
}
function getBisItems(firstName) {
  var bisMap = DATA.bisList || {};
  var norm   = normalise(firstName);
  var key    = null;
  var keys   = Object.keys(bisMap);
  for (var i = 0; i < keys.length; i++) { if (normalise(keys[i]) === norm) { key = keys[i]; break; } }
  var entries = key ? bisMap[key] : [];
  return entries.map(function(e) { return (typeof e === 'string') ? {item:e,slot:''} : e; });
}
function getSelfReceivedItems(firstName) {
  var map  = DATA.selfReceived || {};
  var norm = normalise(firstName);
  var keys = Object.keys(map);
  for (var i = 0; i < keys.length; i++) {
    if (normalise(keys[i]) === norm) return map[keys[i]];
  }
  return [];
}

function getLootEntry(firstName) {
  var lootMap = DATA.lootCounts || {};
  var norm    = normalise(firstName);
  var keys    = Object.keys(lootMap);
  for (var i = 0; i < keys.length; i++) { if (normalise(keys[i]) === norm) return lootMap[keys[i]]; }
  return null;
}
function rankPillHTML(rank) {
  if (rank === null) return '<span style="font-size:0.97rem;color:var(--text-dim);min-width:40px;text-align:center;">—</span>';
  var t  = Math.min((rank-1)/14, 1);
  var rv = Math.round(214+(100-214)*t), gv = Math.round(163+(100-163)*t), bv = Math.round(68+(100-68)*t);
  var a  = Math.max(0.08, 0.18-t*0.1);
  var c  = 'rgb('+rv+','+gv+','+bv+')', bg = 'rgba('+rv+','+gv+','+bv+','+a+')', bd = 'rgba('+rv+','+gv+','+bv+','+ Math.max(0.2,0.4-t*0.2)+')';
  return '<span class="rank-pill" style="background:'+bg+';color:'+c+';border:1px solid '+bd+';">#'+rank+'</span>';
}
function getSlotColor(slot) {
  var s = (slot||'').toUpperCase();
  if (s==='TRINKET'||s==='TRINKET 1'||s==='TRINKET 2') return 'var(--gold)';
  if (s==='NECK'||s==='RING'||s==='RING 1'||s==='RING 2') return 'var(--ranged)';
  if (s==='1H/2H'||s==='OH')                            return 'var(--melee)';
  if (['HEAD','SHOULDERS','CHEST','GLOVES','LEGS','CLOAK','BRACERS','BELT','BOOTS'].indexOf(s)>=0) return 'var(--tank)';
  return 'var(--text)';
}
function attendColor(pct) { return pct>=90?'var(--heal)':pct>=75?'var(--gold)':'var(--melee)'; }

// -- Render profile ---------------------------------------------------------
function renderProfile(firstName, backTo, container) {
  var norm   = normalise(firstName);
  var player = null;
  for (var i = 0; i < DATA.roster.length; i++) { if (normalise(DATA.roster[i].firstName)===norm) { player=DATA.roster[i]; break; } }
  if (!player) return;

  var displayName = player.nick || player.firstName;
  var initials    = displayName.slice(0,2).toUpperCase();
  var classLine   = player.class ? '<span class="badge badge-class" style="'+classBadgeStyle(player.class)+'">'+player.class+(player.spec?' · '+player.spec:'')+'</span>' : '';
  var trialBadge  = player.isTrial ? '<span class="badge badge-trial">Trial</span>' : '';
  var benchBadge  = player.isBench ? '<span class="badge" style="background:rgba(255,255,255,0.04);color:var(--text);border:1px solid var(--border);">Bench</span>' : '';

  // Attendance
  var attendPct    = player.attendance || '—';
  var barWidth     = player.attendance || '0%';
  var attendDetail = (DATA.attendanceDetails || {})[player.firstName] || [];
  var hasPenalties = attendDetail.length > 0;
  var attendExtra  = '';
  if (hasPenalties) {
    attendExtra += '<div id="attend-detail-'+player.firstName+'" style="display:none;margin-top:0.75rem;flex-direction:column;gap:0.3rem;">';
    for (var ai = 0; ai < attendDetail.length; ai++) {
      var ae = attendDetail[ai];
      var sc = ae.status==='No Show'?'var(--melee)':'var(--gold)';
      attendExtra += '<div style="display:flex;justify-content:space-between;font-size:1rem;padding:0.25rem 0;border-bottom:1px solid var(--border);">';
      attendExtra += '<span style="color:var(--text);">'+ae.date+'</span>';
      attendExtra += '<span style="color:'+sc+';font-weight:600;">'+ae.status+'</span></div>';
    }
    attendExtra += '</div>';
  }

  // Loot
  var lootEntry     = getLootEntry(player.firstName);
  var lootCount     = lootEntry ? lootEntry.count : 0;
  var lootItemsHTML = '';
  if (lootEntry && lootEntry.items) {
    for (var li = 0; li < lootEntry.items.length; li++) {
      var li_obj  = lootEntry.items[li];
      var li_name = typeof li_obj === 'string' ? li_obj : li_obj.name;
      var li_diff = typeof li_obj === 'object' && li_obj.difficulty ? li_obj.difficulty : '';
      lootItemsHTML += '<div style="font-size:1rem;color:var(--text);padding:0.3rem 0;border-bottom:1px solid var(--border);">'+li_name+(li_diff?' <span style="font-size:0.95rem;color:var(--text-muted);">('+li_diff+')</span>':'')+'</div>';
    }
  }

  // BiS link
  var bisStatusHTML = player.bisLink
    ? '<div class="bis-row"><div class="bis-dot yes"></div><a class="bis-link" href="'+player.bisLink+'" target="_blank" rel="noopener">View BiS list →</a></div>'
    : '<div class="bis-row"><div class="bis-dot no"></div><span class="bis-none">No BiS list submitted yet</span></div>';

  var bisActionHTML;
  if (backTo === 'officer') {
    var bisAllowed = bisAllowedFor(player.nameRealm);
    bisActionHTML =
      '<div style="margin-top:0.75rem;">' +
        '<button class="btn btn-muted" style="font-size:0.92rem;padding:0.3rem 0.8rem;" onclick="toggleBisForm(\''+player.firstName.replace(/'/g,"\\'")+'\')">Update BiS Link</button>' +
        '<div id="bisForm-'+player.firstName+'" style="display:none;margin-top:0.75rem;">' +
          '<input type="url" id="bisUrl-'+player.firstName+'" placeholder="Paste BiS list URL" class="self-received-source" style="max-width:100%;font-size:1rem;">' +
          '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
            '<button class="btn request-approve-btn" onclick="officerUpdateBisLink(\''+player.nameRealm.replace(/'/g,"\\'")+'\',\''+player.firstName.replace(/'/g,"\\'")+'\')">Save</button>' +
            '<button class="btn btn-muted" style="font-size:0.92rem;padding:0.25rem 0.75rem;" onclick="document.getElementById(\'bisForm-'+player.firstName+'\').style.display=\'none\'">Cancel</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div id="bisAllowDiv-'+player.firstName+'" style="margin-top:0.5rem;"></div>';
  } else if (bisSubmissionsOpen() || bisAllowedFor(player.nameRealm)) {
    var bisBtnLabel = player.bisLink ? 'Update BiS List' : 'Submit BiS List';
    bisActionHTML =
      '<div style="margin-top:0.75rem;">' +
        '<button class="btn btn-muted" style="font-size:0.92rem;padding:0.3rem 0.8rem;" onclick="toggleBisForm(\''+player.firstName.replace(/'/g,"\\'")+'\')">'+bisBtnLabel+'</button>' +
        '<div id="bisForm-'+player.firstName+'" style="display:none;margin-top:0.75rem;">' +
          '<input type="url" id="bisUrl-'+player.firstName+'" placeholder="Paste your BiS list URL" class="self-received-source" style="max-width:100%;font-size:1rem;">' +
          '<textarea id="bisNotes-'+player.firstName+'" placeholder="Notes (optional)" rows="2" class="self-received-notes" style="max-width:100%;margin-top:0.4rem;"></textarea>' +
          '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
            '<button class="btn btn-gold" style="font-size:0.92rem;padding:0.3rem 0.8rem;" onclick="submitBiSForm(\''+player.nameRealm.replace(/'/g,"\\'")+'\',\''+player.firstName.replace(/'/g,"\\'")+'\')">Submit</button>' +
            '<button class="btn btn-muted" style="font-size:0.92rem;padding:0.3rem 0.8rem;" onclick="document.getElementById(\'bisForm-'+player.firstName+'\').style.display=\'none\'">Cancel</button>' +
          '</div>' +
          '<p class="self-received-note">An officer will review your submission. Once approved it will appear on your profile.</p>' +
        '</div>' +
      '</div>';
  } else {
    bisActionHTML = '';
  }
  var bisHTML = bisStatusHTML + bisActionHTML;

  // Build received lookup from loot history
  var receivedMap = {};
  if (lootEntry && lootEntry.items) {
    for (var ri = 0; ri < lootEntry.items.length; ri++) {
      var ri_obj  = lootEntry.items[ri];
      var ri_name = typeof ri_obj === 'string' ? ri_obj : ri_obj.name;
      var ri_key  = normalise(ri_name);
      if (!receivedMap[ri_key]) receivedMap[ri_key] = [];
      receivedMap[ri_key].push(typeof ri_obj === 'object' ? ri_obj : { name: ri_name });
    }
  }

  // Self-received (officer-approved) lookup
  var selfRecItems = getSelfReceivedItems(player.firstName);
  var selfRecMap   = {};
  for (var sr = 0; sr < selfRecItems.length; sr++) {
    selfRecMap[normalise(selfRecItems[sr].item)] = selfRecItems[sr];
  }

  // Priority
  var bisItems = getBisItems(player.firstName);
  var rows = '';
  for (var bi = 0; bi < bisItems.length; bi++) {
    var entry    = bisItems[bi];
    var item     = entry.item, bisSlot = entry.slot;
    var rank     = getRank(player.firstName, item);
    var slot     = (DATA.itemSlots||{})[item] || bisSlot || '';
    var isGen    = (item==='M+'||item==='Crafted'||item==='Catalyst');
    var received = receivedMap[normalise(item)] || null;
    var selfRec  = selfRecMap[normalise(item)] || null;
    var isReceived = received || selfRec;
    var rowId    = 'bisrow-' + player.firstName + '-' + bi;
    rows += '<div class="priority-row' + (isReceived ? ' bis-received' : '') + '" id="' + rowId + '" style="grid-template-columns:auto auto 1fr auto;">';
    rows += isGen ? '<span style="font-size:0.97rem;color:var(--text-dim);min-width:40px;text-align:center;">-</span>' : rankPillHTML(rank);
    rows += '<span class="priority-item-slot" style="color:'+getSlotColor(slot)+';">'+slot+'</span>';
    rows += '<span class="priority-item-name" style="text-align:right;" title="'+item+'">'+item+'</span>';
    if (received) {
      var badges = '';
      for (var rv = 0; rv < received.length; rv++) {
        var rv_diff = received[rv].difficulty || '';
        var rv_date = received[rv].date || '';
        badges += '<span class="bis-received-badge">' + (rv_diff ? rv_diff + ' · ' : '') + rv_date + '</span>';
      }
      rows += '<div style="display:flex;flex-direction:column;gap:2px;align-items:flex-end;">' + badges + '</div>';
    } else if (selfRec) {
      rows += '<span class="bis-self-received-badge">' + (selfRec.source || 'Self-reported') + '</span>';
    } else if (!isGen) {
      rows += '<button class="mark-received-btn" onclick="event.stopPropagation();showSelfReceivedForm(\'' +
        player.firstName.replace(/'/g, "\\'") + '\',\'' + item.replace(/'/g, "\\'") + '\',\'' + slot.replace(/'/g, "\\'") + '\',\'' + rowId + '\')">Mark received</button>';
    } else {
      rows += '<span></span>';
    }
    rows += '</div>';
    rows += '<div class="self-received-form" id="form-' + rowId + '" style="display:none;"></div>';
  }
  var priorityHTML = bisItems.length
    ? '<div class="priority-list">' +
        '<div class="priority-row" style="grid-template-columns:auto auto 1fr;background:transparent;border:none;padding:0.2rem 0.8rem;">' +
          '<span style="font-size:0.9rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text);">Prio</span>' +
          '<span style="font-size:0.9rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text);">Slot</span>' +
          '<span style="font-size:0.9rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text);text-align:right;">Item / Source</span>' +
        '</div>' + rows + '</div>'
    : '<p class="no-items-msg">No BiS items on record yet.</p>';

  var backLabel  = backTo==='officer' ? '← Back to dashboard' : '← Back to roster';
  var backAction = backTo==='officer'
    ? 'document.getElementById(\'officerProfile\').innerHTML=\'\';selectedOfficerPlayer=null;document.querySelectorAll(\'.player-row\').forEach(function(r){r.classList.remove(\'selected\')});'
    : 'showView(\'landing\');document.getElementById(\'playerSelect\').value=\'\';';

  var html =
    '<div class="profile-card">' +
      '<div class="role-bar role-bar-'+player.role+'"></div>' +
      '<div style="padding:0.6rem 1.25rem;border-bottom:1px solid var(--border);">' +
        '<button onclick="'+backAction+'" style="background:none;border:none;color:var(--text);font-family:\'Rajdhani\',sans-serif;font-size:0.9rem;letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;padding:0;">'+backLabel+'</button>' +
      '</div>' +
      '<div class="profile-header">' +
        '<div class="profile-avatar avatar-'+player.role+'">'+initials+'</div>' +
        '<div class="profile-identity">' +
          '<div class="profile-name">'+displayName+'</div>' +
          '<div class="profile-realm">'+player.firstName+'-'+player.realm+'</div>' +
          '<div class="profile-badges"><span class="badge badge-'+player.role+'">'+player.role+'</span>'+trialBadge+benchBadge+classLine+'</div>' +
        '</div>' +
      '</div>' +
      '<div class="profile-section"'+(hasPenalties?' onclick="var d=document.getElementById(\'attend-detail-'+player.firstName+'\');d.style.display=d.style.display===\'none\'?\'flex\':\'none\';" style="cursor:pointer;"':'')+'>' +
        '<div class="section-label" style="display:flex;justify-content:space-between;align-items:center;">Attendance'+(hasPenalties?'<span style="font-size:0.95rem;color:var(--text-dim);">tap to expand</span>':'')+'</div>' +
        '<div class="attend-row"><div class="attend-bar-wrap"><div class="attend-bar" style="width:'+barWidth+'"></div></div><span class="attend-label">'+attendPct+'</span></div>' +
        attendExtra +
      '</div>' +
      '<div class="profile-section" onclick="var l=document.getElementById(\'loot-list-'+player.firstName+'\');l.style.display=l.style.display===\'none\'?\'grid\':\'none\';" style="cursor:pointer;">' +
        '<div class="section-label" style="display:flex;justify-content:space-between;align-items:center;">Items Received <span style="font-size:0.95rem;color:var(--text-dim);">tap to expand</span></div>' +
        '<div style="font-size:1.1rem;font-weight:600;color:var(--gold);">'+lootCount+' item'+(lootCount!==1?'s':'')+' this tier</div>' +
        '<div id="loot-list-'+player.firstName+'" style="display:none;margin-top:0.75rem;grid-template-columns:1fr 1fr;gap:0 1rem;">'+lootItemsHTML+'</div>' +
      '</div>' +
      '<div class="profile-section"><div class="section-label">BiS List</div>'+bisHTML+'</div>' +
      '<div class="profile-section" onclick="var l=document.getElementById(\'prio-list-'+player.firstName+'\');l.style.display=l.style.display===\'none\'?\'block\':\'none\';" style="cursor:pointer;">' +
        '<div class="section-label" style="display:flex;justify-content:space-between;align-items:center;">Loot Priority <span style="font-size:0.95rem;color:var(--text-dim);">tap to expand</span></div>' +
        '<div id="prio-list-'+player.firstName+'" style="display:none;">'+priorityHTML+'</div>' +
      '</div>' +
    '</div>';

  if (container) { container.innerHTML = html; }
  else { document.getElementById('profileView').innerHTML = html; }
  if (backTo === 'officer') updateBisAllowDiv(player.nameRealm, player.firstName);
}

// -- Season Signup ----------------------------------------------------------
function signupsOpen() {
  return !!(DATA && DATA.signupsOpen);
}

function setSignupsOpen(open) {
  var btn = document.getElementById('signupToggleBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  var cbName = '_setSignupsOpenCb';
  window[cbName] = function(result) {
    delete window[cbName];
    if (btn) btn.disabled = false;
    if (result && result.success) {
      if (DATA) DATA.signupsOpen = result.signupsOpen;
    }
    renderSignupToggle();
    renderSignupLandingLink();
  };

  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    if (btn) { btn.disabled = false; }
    renderSignupToggle();
  };
  script.src = WEB_APP_URL + '?action=setSignupsOpen&value=' + (open ? 'true' : 'false') + '&callback=' + cbName;
  document.head.appendChild(script);
}

function renderSignupLandingLink() {
  var el = document.getElementById('signupLink');
  if (el) el.style.display = signupsOpen() ? '' : 'none';
}

function showSignupView() {
  signupStep = 1;
  signupData = {};
  showView('signup');
  renderSignupStep();
}

function renderSignupStep() {
  var container = document.getElementById('signupForm');
  var html = '';

  if (signupStep === 1) {
    html =
      '<div class="signup-step-label">Step 1 of 4</div>' +
      '<h2 class="signup-step-title">Sign Up for Next Season</h2>' +
      '<p class="signup-step-desc">Enter your exact in-game character name and select your realm.</p>' +
      '<div class="signup-field">' +
        '<span class="signup-label">Character Name</span>' +
        '<input type="text" id="signupCharName" class="signup-input" placeholder="Katorri" value="' + (signupData.charName || '') + '" autocomplete="off">' +
      '</div>' +
      '<div class="signup-field">' +
        '<span class="signup-label">Realm</span>' +
        '<div class="realm-combobox">' +
          '<input type="text" id="signupRealm" class="signup-input realm-input" placeholder="Type to search..." autocomplete="off" value="' + (signupData.realm || '') + '">' +
          '<div class="realm-dropdown" id="realmDropdown"></div>' +
        '</div>' +
      '</div>' +
      '<p id="signupError" class="signup-error"></p>' +
      '<div class="signup-actions">' +
        '<button class="btn btn-muted" onclick="showView(\'landing\')">Cancel</button>' +
        '<button class="btn btn-gold" onclick="signupNext()">Next</button>' +
      '</div>';

  } else if (signupStep === 2) {
    html =
      '<div class="signup-step-label">Step 2 of 4</div>' +
      '<h2 class="signup-step-title">Select Your Class</h2>' +
      '<div class="signup-class-grid">';
    Object.keys(CLASS_SPECS).forEach(function(cls) {
      var hex = CLASS_COLORS[cls] || '#888888';
      var sel = signupData.className === cls ? ' signup-class-btn-selected' : '';
      html += '<button class="signup-class-btn' + sel + '" style="--cls-color:' + hex + ';" onclick="signupSelectClass(\'' + cls.replace(/'/g, "\\'") + '\')">' + cls + '</button>';
    });
    html +=
      '</div>' +
      '<p id="signupError" class="signup-error"></p>' +
      '<div class="signup-actions">' +
        '<button class="btn btn-muted" onclick="signupBack()">Back</button>' +
      '</div>';

  } else if (signupStep === 3) {
    var specData = CLASS_SPECS[signupData.className];
    var clsColor = CLASS_COLORS[signupData.className] || 'var(--gold-light)';
    html =
      '<div class="signup-step-label">Step 3 of 4</div>' +
      '<h2 class="signup-step-title" style="color:' + clsColor + ';">' + signupData.className + '</h2>' +
      '<div class="signup-field">' +
        '<span class="signup-label">Main Spec</span>' +
        '<div class="signup-radio-group">';
    specData.specs.forEach(function(s) {
      html += '<label class="signup-radio-label"><input type="radio" name="mainSpec" value="' + s + '"' + (signupData.mainSpec === s ? ' checked' : '') + ' onchange="updateOffSpecList()">' + s + '</label>';
    });
    html +=
        '</div>' +
      '</div>' +
      '<div class="signup-field">' +
        '<span class="signup-label">Off Spec <span class="signup-optional">(optional -- select all that apply)</span></span>' +
        '<div class="signup-checkbox-group" id="offSpecGroup">' + buildOffSpecHTML(specData.specs, signupData.mainSpec, signupData.offSpecs) + '</div>' +
      '</div>';
    if (specData.roles) {
      html +=
        '<div class="signup-field">' +
          '<span class="signup-label">Primary Role</span>' +
          '<div class="signup-radio-group">';
      specData.roles.forEach(function(r) {
        html += '<label class="signup-radio-label"><input type="radio" name="primaryRole" value="' + r + '"' + (signupData.role === r ? ' checked' : '') + '>' + r + '</label>';
      });
      html += '</div></div>';
    }
    html +=
      '<p id="signupError" class="signup-error"></p>' +
      '<div class="signup-actions">' +
        '<button class="btn btn-muted" onclick="signupBack()">Back</button>' +
        '<button class="btn btn-gold" onclick="signupNext()">Next</button>' +
      '</div>';

  } else if (signupStep === 4) {
    html =
      '<div class="signup-step-label">Step 4 of 4</div>' +
      '<h2 class="signup-step-title">Additional Information</h2>' +
      '<div class="signup-field">' +
        '<span class="signup-label">Discord Name <span class="signup-optional">(optional -- only if different from your character name)</span></span>' +
        '<input type="text" id="signupDiscord" class="signup-input" placeholder="YourDiscord" value="' + (signupData.discord || '') + '">' +
      '</div>' +
      '<div class="signup-field">' +
        '<span class="signup-label">Anything else officers should know? <span class="signup-optional">(optional)</span></span>' +
        '<textarea id="signupNotes" class="signup-textarea" placeholder="e.g. applying as a trial, recently changed mains, availability caveats...">' + (signupData.notes || '') + '</textarea>' +
      '</div>' +
      '<p id="signupError" class="signup-error"></p>' +
      '<div class="signup-actions">' +
        '<button class="btn btn-muted" onclick="signupBack()">Back</button>' +
        '<button class="btn btn-gold" id="signupSubmitBtn" onclick="submitSignup()">Submit</button>' +
      '</div>';

  } else if (signupStep === 5) {
    html =
      '<div class="signup-confirm">' +
        '<div class="signup-confirm-check">&#10003;</div>' +
        '<h2 class="signup-step-title">Signup Submitted</h2>' +
        '<p class="signup-step-desc">Your signup has been submitted. Officers will review your application and be in touch. If you need to update anything, message Katorri or Rod on Discord -- do not resubmit without officer approval.</p>' +
        '<button class="btn btn-gold" onclick="showView(\'landing\')" style="margin-top:1.5rem;">Back to Roster</button>' +
      '</div>';
  }

  container.innerHTML = html;
  if (signupStep === 1) initRealmCombobox();
  var firstInput = container.querySelector('input[type="text"]');
  if (firstInput) setTimeout(function() { firstInput.focus(); }, 50);
}

function initRealmCombobox() {
  var input    = document.getElementById('signupRealm');
  var dropdown = document.getElementById('realmDropdown');
  if (!input || !dropdown) return;

  function showMatches(query) {
    var q = query.toLowerCase().trim();
    if (!q) { dropdown.style.display = 'none'; return; }
    var matches = WOW_REALMS.filter(function(r) {
      return r.toLowerCase().indexOf(q) !== -1;
    }).slice(0, 12);
    if (!matches.length) { dropdown.style.display = 'none'; return; }
    dropdown.innerHTML = matches.map(function(r) {
      return '<div class="realm-option" onmousedown="pickRealm(\'' + r.replace(/'/g, "\\'") + '\')">' + r + '</div>';
    }).join('');
    dropdown.style.display = 'block';
  }

  input.addEventListener('input', function() { showMatches(this.value); });
  input.addEventListener('focus', function() { showMatches(this.value); });
  input.addEventListener('blur',  function() { setTimeout(function() { dropdown.style.display = 'none'; }, 150); });
}

function pickRealm(realm) {
  var input = document.getElementById('signupRealm');
  if (input) input.value = realm;
  var dropdown = document.getElementById('realmDropdown');
  if (dropdown) dropdown.style.display = 'none';
  signupData.realm = realm;
}

function buildOffSpecHTML(specs, mainSpec, selectedOffSpecs) {
  var html = '';
  specs.filter(function(s) { return s !== mainSpec; }).forEach(function(s) {
    var checked = selectedOffSpecs && selectedOffSpecs.indexOf(s) !== -1 ? ' checked' : '';
    html += '<label class="signup-checkbox-label"><input type="checkbox" name="offSpec" value="' + s + '"' + checked + '>' + s + '</label>';
  });
  return html;
}

function updateOffSpecList() {
  var mainSpecEl = document.querySelector('input[name="mainSpec"]:checked');
  var mainSpec   = mainSpecEl ? mainSpecEl.value : '';
  var specData   = CLASS_SPECS[signupData.className];
  var group      = document.getElementById('offSpecGroup');
  if (!group || !specData) return;
  var currentChecked = Array.prototype.map.call(
    document.querySelectorAll('input[name="offSpec"]:checked'),
    function(el) { return el.value; }
  );
  group.innerHTML = buildOffSpecHTML(specData.specs, mainSpec, currentChecked);
}

function signupSelectClass(cls) {
  signupData.className = cls;
  signupData.mainSpec  = '';
  signupData.offSpecs  = [];
  signupData.role      = '';
  signupStep = 3;
  renderSignupStep();
}

function signupNext() {
  if (signupStep === 1) {
    var charName = (document.getElementById('signupCharName').value || '').trim();
    var realm    = (document.getElementById('signupRealm').value || '').trim();
    if (!charName) {
      document.getElementById('signupError').textContent = 'Please enter your character name.';
      return;
    }
    if (!realm) {
      document.getElementById('signupError').textContent = 'Please select your realm.';
      return;
    }
    signupData.charName = charName;
    signupData.realm    = realm;
    signupStep = 2;

  } else if (signupStep === 3) {
    var mainSpecEl  = document.querySelector('input[name="mainSpec"]:checked');
    var offSpecEls  = document.querySelectorAll('input[name="offSpec"]:checked');
    var roleEl      = document.querySelector('input[name="primaryRole"]:checked');
    var specData    = CLASS_SPECS[signupData.className];
    if (!mainSpecEl) {
      document.getElementById('signupError').textContent = 'Please select your main spec.';
      return;
    }
    if (specData.roles && !roleEl) {
      document.getElementById('signupError').textContent = 'Please select your primary role.';
      return;
    }
    signupData.mainSpec  = mainSpecEl.value;
    signupData.offSpecs  = Array.prototype.map.call(offSpecEls, function(el) { return el.value; });
    signupData.role      = roleEl ? roleEl.value : null;
    signupStep = 4;

  } else {
    signupStep++;
  }
  renderSignupStep();
}

function signupBack() {
  if (signupStep === 3) {
    signupStep = 2;
  } else if (signupStep > 1) {
    signupStep--;
  }
  renderSignupStep();
}

function submitSignup() {
  signupData.discord     = (document.getElementById('signupDiscord').value || '').trim();
  signupData.notes       = (document.getElementById('signupNotes').value || '').trim();
  signupData.submittedAt = new Date().toISOString();

  var btn = document.getElementById('signupSubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }

  var cbName = '_submitSignupCb';
  window[cbName] = function(result) {
    delete window[cbName];
    if (result && result.success) {
      signupStep = 5;
      renderSignupStep();
    } else {
      if (btn) { btn.disabled = false; btn.textContent = 'Submit'; }
      var err = document.getElementById('signupError');
      if (err) err.textContent = 'Submission failed. Please try again or contact an officer on Discord.';
    }
  };

  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    if (btn) { btn.disabled = false; btn.textContent = 'Submit'; }
    var err = document.getElementById('signupError');
    if (err) err.textContent = 'Submission failed. Please try again or contact an officer on Discord.';
  };
  script.src = WEB_APP_URL + '?action=submitSignup&data=' + encodeURIComponent(JSON.stringify(signupData)) + '&callback=' + cbName;
  document.head.appendChild(script);
}

function buildSignupsTab() {
  renderSignupToggle();
  var container = document.getElementById('signupsResponsesContainer');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">Loading submissions...</p>';

  var cbName = '_getSignupsCb';
  window[cbName] = function(result) {
    delete window[cbName];
    renderSignupResponses(result.signups || []);
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    var c = document.getElementById('signupsResponsesContainer');
    if (c) c.innerHTML = '<p style="color:var(--melee);font-size:1rem;margin-top:1.5rem;">Failed to load submissions.</p>';
  };
  script.src = WEB_APP_URL + '?action=getSignups&callback=' + cbName;
  document.head.appendChild(script);
}

function renderSignupResponses(signups) {
  var container = document.getElementById('signupsResponsesContainer');
  if (!container) return;

  if (!signups.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No signups submitted yet.</p>';
    return;
  }

  var html = '<div style="margin-top:1.5rem;">' +
    '<div style="font-size:0.9rem;letter-spacing:0.16em;text-transform:uppercase;color:var(--text-muted);font-weight:600;margin-bottom:0.75rem;">' +
    signups.length + ' submission' + (signups.length !== 1 ? 's' : '') + '</div>';

  signups.forEach(function(s) {
    var clsColor = classColor(s.className);
    html += '<div class="signup-response-card" data-row="' + s.rowIndex + '">' +
      '<div class="signup-response-header">' +
        '<span class="signup-response-name">' + s.charName + '-' + s.realm + '</span>' +
        '<div style="display:flex;align-items:center;gap:0.75rem;">' +
          '<span class="signup-response-time">' + s.timestamp + '</span>' +
          '<button class="signup-delete-btn" onclick="deleteSignupRow(' + s.rowIndex + ', this)" title="Delete signup">x</button>' +
        '</div>' +
      '</div>' +
      '<div style="font-size:1rem;color:' + clsColor + ';margin-top:0.35rem;font-weight:600;">' +
        s.className + ' &middot; ' + s.mainSpec +
        (s.offSpecs ? '<span style="color:var(--text-muted);font-weight:400;"> / ' + s.offSpecs + '</span>' : '') +
      '</div>';
    if (s.role) html += '<div style="font-size:0.92rem;color:var(--text-muted);margin-top:0.2rem;">Role: <span style="color:var(--text);">' + s.role + '</span></div>';
    if (s.discord) html += '<div style="font-size:0.92rem;color:var(--text-muted);margin-top:0.2rem;">Discord: <span style="color:var(--text);">' + s.discord + '</span></div>';
    if (s.notes) html += '<div style="font-size:0.97rem;color:var(--text);margin-top:0.6rem;padding-top:0.6rem;border-top:1px solid var(--border);">' + s.notes + '</div>';
    html += '</div>';
  });

  container.innerHTML = html + '</div>';
}

function deleteSignupRow(rowIndex, btnEl) {
  if (!confirm('Delete this signup? This cannot be undone.')) return;
  btnEl.disabled = true;
  btnEl.textContent = '...';
  var cbName = '_deleteSignupCb' + rowIndex;
  window[cbName] = function(result) {
    delete window[cbName];
    if (result.error) { btnEl.disabled = false; btnEl.textContent = 'x'; return; }
    var card = document.querySelector('.signup-response-card[data-row="' + rowIndex + '"]');
    if (card) card.remove();
    var container = document.getElementById('signupsResponsesContainer');
    if (container && !container.querySelector('.signup-response-card')) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No signups submitted yet.</p>';
    }
  };
  var script = document.createElement('script');
  script.onerror = function() { delete window[cbName]; btnEl.disabled = false; btnEl.textContent = 'x'; };
  script.src = WEB_APP_URL + '?action=deleteSignup&row=' + rowIndex + '&callback=' + cbName;
  document.head.appendChild(script);
}

function showSelfReceivedForm(firstName, item, slot, rowId) {
  if (event) event.stopPropagation();
  var formEl = document.getElementById('form-' + rowId);
  if (!formEl) return;
  if (formEl.style.display !== 'none') { formEl.style.display = 'none'; return; }
  var formHtml =
    '<div class="self-received-form-inner" onclick="event.stopPropagation()">' +
      '<select class="self-received-source" id="src-' + rowId + '">' +
        '<option value="">-- How did you get it? --</option>' +
        '<option value="M+">M+</option>' +
        '<option value="Great Vault">Great Vault</option>' +
        '<option value="Crafted">Crafted</option>' +
        '<option value="Catalyst">Catalyst</option>' +
        '<option value="World Drop">World Drop</option>' +
        '<option value="Other">Other</option>' +
      '</select>' +
      '<textarea class="self-received-notes" id="notes-' + rowId + '" placeholder="Notes (optional)" rows="2"></textarea>' +
      '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
        '<button class="btn btn-gold" style="font-size:0.92rem;padding:0.3rem 0.8rem;" onclick="event.stopPropagation();submitSelfReceivedRequest(\'' +
          firstName.replace(/'/g, "\\'") + '\',\'' + item.replace(/'/g, "\\'") + '\',\'' + slot.replace(/'/g, "\\'") + '\',\'' + rowId + '\')">Submit request</button>' +
        '<button class="btn btn-muted" style="font-size:0.92rem;padding:0.3rem 0.8rem;" onclick="event.stopPropagation();document.getElementById(\'form-' + rowId + '\').style.display=\'none\'">Cancel</button>' +
      '</div>' +
      '<p class="self-received-note">An officer will review and approve this. Once approved it will appear on your profile.</p>' +
    '</div>';
  formEl.innerHTML = formHtml;
  formEl.style.display = 'block';
}

function submitSelfReceivedRequest(firstName, item, slot, rowId) {
  var sourceEl = document.getElementById('src-' + rowId);
  var notesEl  = document.getElementById('notes-' + rowId);
  if (!sourceEl || !sourceEl.value) { sourceEl && (sourceEl.style.borderColor = 'var(--melee)'); return; }
  var data = { player: firstName, item: item, slot: slot, source: sourceEl.value, notes: notesEl ? notesEl.value : '' };
  var formEl = document.getElementById('form-' + rowId);
  if (formEl) formEl.innerHTML = '<p style="font-size:0.95rem;color:var(--text-muted);padding:0.5rem 0;">Submitting...</p>';
  var cbName = '_selfRecCb' + rowId.replace(/[^a-zA-Z0-9]/g, '_');
  window[cbName] = function(result) {
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
  script.onerror = function() {
    delete window[cbName];
    if (formEl) formEl.innerHTML = '<p style="font-size:0.95rem;color:var(--melee);padding:0.5rem 0;">Failed to submit. Try again.</p>';
  };
  script.src = WEB_APP_URL + '?action=requestSelfReceived&data=' + encodeURIComponent(JSON.stringify(data)) + '&callback=' + cbName;
  document.head.appendChild(script);
}

function buildRequestsTab() {
  var container = document.getElementById('requestsContainer');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">Loading requests...</p>';
  var cbName = '_getPendingReqCb';
  window[cbName] = function(result) {
    delete window[cbName];
    renderPendingRequests(result.requests || []);
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    var c = document.getElementById('requestsContainer');
    if (c) c.innerHTML = '<p style="color:var(--melee);font-size:1rem;margin-top:1.5rem;">Failed to load requests.</p>';
  };
  script.src = WEB_APP_URL + '?action=getPendingRequests&callback=' + cbName;
  document.head.appendChild(script);
}

function renderPendingRequests(requests) {
  var container = document.getElementById('requestsContainer');
  if (!container) return;
  if (!requests.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No pending requests.</p>';
    return;
  }
  var html = '<div style="margin-top:1.5rem;">' +
    '<div style="font-size:0.9rem;letter-spacing:0.16em;text-transform:uppercase;color:var(--text-muted);font-weight:600;margin-bottom:0.75rem;">' +
    requests.length + ' pending request' + (requests.length !== 1 ? 's' : '') + '</div>';
  requests.forEach(function(r) {
    html += '<div class="request-card" data-row="' + r.rowIndex + '">' +
      '<div class="request-card-header">' +
        '<span class="request-player">' + r.player + '</span>' +
        '<span class="signup-response-time">' + r.timestamp + '</span>' +
      '</div>' +
      '<div class="request-item">' + r.item + (r.slot ? ' <span style="color:var(--text-muted);font-weight:400;">(' + r.slot + ')</span>' : '') + '</div>' +
      '<div style="font-size:0.92rem;color:var(--text-muted);margin-top:0.2rem;">Source: <span style="color:var(--text);">' + r.source + '</span></div>' +
      (r.notes ? '<div style="font-size:0.97rem;color:var(--text);margin-top:0.6rem;padding-top:0.6rem;border-top:1px solid var(--border);">' + r.notes + '</div>' : '') +
      '<div style="display:flex;gap:0.5rem;margin-top:0.75rem;">' +
        '<button class="btn request-approve-btn" onclick="approveRequest(' + r.rowIndex + ', this)">Approve</button>' +
        '<button class="btn request-reject-btn" onclick="rejectRequest(' + r.rowIndex + ', this)">Reject</button>' +
      '</div>' +
    '</div>';
  });
  container.innerHTML = html + '</div>';
}

function approveRequest(rowIndex, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = '...';
  var cbName = '_approveReqCb' + rowIndex;
  window[cbName] = function(result) {
    delete window[cbName];
    if (result.error) { btnEl.disabled = false; btnEl.textContent = 'Approve'; return; }
    var card = document.querySelector('.request-card[data-row="' + rowIndex + '"]');
    if (card) card.remove();
    checkEmptyRequests();
  };
  var script = document.createElement('script');
  script.onerror = function() { delete window[cbName]; btnEl.disabled = false; btnEl.textContent = 'Approve'; };
  script.src = WEB_APP_URL + '?action=approveRequest&row=' + rowIndex + '&callback=' + cbName;
  document.head.appendChild(script);
}

function rejectRequest(rowIndex, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = '...';
  var cbName = '_rejectReqCb' + rowIndex;
  window[cbName] = function(result) {
    delete window[cbName];
    if (result.error) { btnEl.disabled = false; btnEl.textContent = 'Reject'; return; }
    var card = document.querySelector('.request-card[data-row="' + rowIndex + '"]');
    if (card) card.remove();
    checkEmptyRequests();
  };
  var script = document.createElement('script');
  script.onerror = function() { delete window[cbName]; btnEl.disabled = false; btnEl.textContent = 'Reject'; };
  script.src = WEB_APP_URL + '?action=rejectRequest&row=' + rowIndex + '&callback=' + cbName;
  document.head.appendChild(script);
}

function checkEmptyRequests() {
  var container = document.getElementById('requestsContainer');
  if (container && !container.querySelector('.request-card')) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No pending requests.</p>';
  }
}

// -- BiS submission (raider) and direct update (officer) --------------------
function toggleBisForm(firstName) {
  var form = document.getElementById('bisForm-' + firstName);
  if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

function submitBiSForm(nameRealm, firstName) {
  var urlEl   = document.getElementById('bisUrl-' + firstName);
  var notesEl = document.getElementById('bisNotes-' + firstName);
  if (!urlEl || !urlEl.value.trim()) { if (urlEl) urlEl.style.borderColor = 'var(--melee)'; return; }
  var data   = { nameRealm: nameRealm, bisLink: urlEl.value.trim(), notes: notesEl ? notesEl.value.trim() : '' };
  var formEl = document.getElementById('bisForm-' + firstName);
  if (formEl) formEl.innerHTML = '<p style="font-size:0.95rem;color:var(--text-muted);padding:0.5rem 0;">Submitting...</p>';
  var cbName = '_submitBisCb' + firstName.replace(/[^a-zA-Z0-9]/g, '_');
  window[cbName] = function(result) {
    delete window[cbName];
    if (formEl) {
      formEl.innerHTML = result.error
        ? '<p style="font-size:0.95rem;color:var(--melee);padding:0.5rem 0;">Failed to submit. Try again.</p>'
        : '<p style="font-size:0.95rem;color:var(--text-muted);padding:0.5rem 0;">Submitted -- pending officer review.</p>';
    }
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    if (formEl) formEl.innerHTML = '<p style="font-size:0.95rem;color:var(--melee);padding:0.5rem 0;">Failed to submit. Try again.</p>';
  };
  script.src = WEB_APP_URL + '?action=submitBiS&data=' + encodeURIComponent(JSON.stringify(data)) + '&callback=' + cbName;
  document.head.appendChild(script);
}

function officerUpdateBisLink(nameRealm, firstName) {
  var urlEl = document.getElementById('bisUrl-' + firstName);
  if (!urlEl || !urlEl.value.trim()) { if (urlEl) urlEl.style.borderColor = 'var(--melee)'; return; }
  var data   = { nameRealm: nameRealm, url: urlEl.value.trim() };
  var formEl = document.getElementById('bisForm-' + firstName);
  if (formEl) formEl.innerHTML = '<p style="font-size:0.95rem;color:var(--text-muted);padding:0.5rem 0;">Saving...</p>';
  var cbName = '_updateBisCb' + firstName.replace(/[^a-zA-Z0-9]/g, '_');
  window[cbName] = function(result) {
    delete window[cbName];
    if (formEl) {
      formEl.innerHTML = result.error
        ? '<p style="font-size:0.95rem;color:var(--melee);padding:0.5rem 0;">Failed to save. Try again.</p>'
        : '<p style="font-size:0.95rem;color:var(--text-muted);padding:0.5rem 0;">BiS link updated. Clear cache to refresh.</p>';
    }
  };
  var script = document.createElement('script');
  script.onerror = function() {
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
    btn.onclick = function() { revokeBisForPlayer(nameRealm, firstName); };
    var badge = document.createElement('span');
    badge.style.cssText = 'font-size:0.9rem;color:var(--heal);margin-left:0.5rem;';
    badge.textContent = 'Submission open';
    divEl.appendChild(btn);
    divEl.appendChild(badge);
  } else {
    btn.textContent = 'Allow BiS Submission';
    btn.onclick = function() { allowBisForPlayer(nameRealm, firstName); };
    divEl.appendChild(btn);
  }
}

function allowBisForPlayer(nameRealm, firstName) {
  var divEl = document.getElementById('bisAllowDiv-' + firstName);
  if (divEl) divEl.innerHTML = '<span style="font-size:0.95rem;color:var(--text-muted);">Saving...</span>';
  var cbName = '_allowBisCb' + firstName.replace(/[^a-zA-Z0-9]/g, '_');
  window[cbName] = function(result) {
    delete window[cbName];
    if (result && result.success && DATA) DATA.bisAllowedPlayers = result.bisAllowedPlayers;
    updateBisAllowDiv(nameRealm, firstName);
  };
  var script = document.createElement('script');
  script.onerror = function() { delete window[cbName]; updateBisAllowDiv(nameRealm, firstName); };
  script.src = WEB_APP_URL + '?action=allowBisForPlayer&data=' + encodeURIComponent(JSON.stringify({ nameRealm: nameRealm })) + '&callback=' + cbName;
  document.head.appendChild(script);
}

function revokeBisForPlayer(nameRealm, firstName) {
  var divEl = document.getElementById('bisAllowDiv-' + firstName);
  if (divEl) divEl.innerHTML = '<span style="font-size:0.95rem;color:var(--text-muted);">Saving...</span>';
  var cbName = '_revokeBisCb' + firstName.replace(/[^a-zA-Z0-9]/g, '_');
  window[cbName] = function(result) {
    delete window[cbName];
    if (result && result.success && DATA) DATA.bisAllowedPlayers = result.bisAllowedPlayers;
    updateBisAllowDiv(nameRealm, firstName);
  };
  var script = document.createElement('script');
  script.onerror = function() { delete window[cbName]; updateBisAllowDiv(nameRealm, firstName); };
  script.src = WEB_APP_URL + '?action=revokeBisForPlayer&data=' + encodeURIComponent(JSON.stringify({ nameRealm: nameRealm })) + '&callback=' + cbName;
  document.head.appendChild(script);
}

// -- BiS Submissions tab (officer) ------------------------------------------
function buildBisTab() {
  var container = document.getElementById('bisContainer');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">Loading submissions...</p>';
  var cbName = '_getPendingBisCb';
  window[cbName] = function(result) {
    delete window[cbName];
    renderBisSubmissions(result.submissions || []);
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    var c = document.getElementById('bisContainer');
    if (c) c.innerHTML = '<p style="color:var(--melee);font-size:1rem;margin-top:1.5rem;">Failed to load submissions.</p>';
  };
  script.src = WEB_APP_URL + '?action=getPendingBiS&callback=' + cbName;
  document.head.appendChild(script);
}

function renderBisSubmissions(submissions) {
  var container = document.getElementById('bisContainer');
  if (!container) return;
  if (!submissions.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No pending BiS submissions.</p>';
    return;
  }
  var html = '<div style="margin-top:1.5rem;">' +
    '<div style="font-size:0.9rem;letter-spacing:0.16em;text-transform:uppercase;color:var(--text-muted);font-weight:600;margin-bottom:0.75rem;">' +
    submissions.length + ' pending submission' + (submissions.length !== 1 ? 's' : '') + '</div>';
  submissions.forEach(function(s) {
    html +=
      '<div class="request-card" data-row="' + s.rowIndex + '" data-name-realm="' + s.nameRealm.replace(/"/g,'&quot;') + '" data-bis-link="' + s.bisLink.replace(/"/g,'&quot;') + '">' +
        '<div class="request-card-header">' +
          '<span class="request-player">' + s.nameRealm + '</span>' +
          '<span class="signup-response-time">' + s.timestamp + '</span>' +
        '</div>' +
        '<div class="request-item" style="word-break:break-all;margin-top:0.35rem;">' +
          '<a href="' + s.bisLink + '" target="_blank" rel="noopener" style="color:var(--gold);font-size:1rem;">' + s.bisLink + '</a>' +
        '</div>' +
        (s.notes ? '<div style="font-size:0.97rem;color:var(--text);margin-top:0.6rem;padding-top:0.6rem;border-top:1px solid var(--border);">' + s.notes + '</div>' : '') +
        '<div style="display:flex;gap:0.5rem;margin-top:0.75rem;">' +
          '<button class="btn request-approve-btn" onclick="approveBisSubmission(' + s.rowIndex + ', this)">Approve</button>' +
          '<button class="btn request-reject-btn" onclick="rejectBisSubmission(' + s.rowIndex + ', this)">Reject</button>' +
        '</div>' +
      '</div>';
  });
  container.innerHTML = html + '</div>';
}

function approveBisSubmission(rowIndex, btnEl) {
  var card      = document.querySelector('.request-card[data-row="' + rowIndex + '"]');
  var nameRealm = card ? card.getAttribute('data-name-realm') : '';
  var bisLink   = card ? card.getAttribute('data-bis-link')   : '';
  btnEl.disabled = true;
  btnEl.textContent = '...';
  var data   = { row: rowIndex, nameRealm: nameRealm, url: bisLink };
  var cbName = '_approveBisCb' + rowIndex;
  window[cbName] = function(result) {
    delete window[cbName];
    if (result.error) { btnEl.disabled = false; btnEl.textContent = 'Approve'; return; }
    if (card) card.remove();
    checkEmptyBisSubmissions();
  };
  var script = document.createElement('script');
  script.onerror = function() { delete window[cbName]; btnEl.disabled = false; btnEl.textContent = 'Approve'; };
  script.src = WEB_APP_URL + '?action=approveBiS&data=' + encodeURIComponent(JSON.stringify(data)) + '&callback=' + cbName;
  document.head.appendChild(script);
}

function rejectBisSubmission(rowIndex, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = '...';
  var cbName = '_rejectBisCb' + rowIndex;
  window[cbName] = function(result) {
    delete window[cbName];
    if (result.error) { btnEl.disabled = false; btnEl.textContent = 'Reject'; return; }
    var card = document.querySelector('.request-card[data-row="' + rowIndex + '"]');
    if (card) card.remove();
    checkEmptyBisSubmissions();
  };
  var script = document.createElement('script');
  script.onerror = function() { delete window[cbName]; btnEl.disabled = false; btnEl.textContent = 'Reject'; };
  script.src = WEB_APP_URL + '?action=rejectBiS&row=' + rowIndex + '&callback=' + cbName;
  document.head.appendChild(script);
}

function checkEmptyBisSubmissions() {
  var container = document.getElementById('bisContainer');
  if (container && !container.querySelector('.request-card')) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No pending BiS submissions.</p>';
  }
}

function renderSignupToggle() {
  var badge = document.getElementById('signupStatusBadge');
  var btn   = document.getElementById('signupToggleBtn');
  if (!badge || !btn) return;
  var open = signupsOpen();
  badge.textContent = open ? 'OPEN' : 'CLOSED';
  badge.className = 'signup-status-badge ' + (open ? 'signup-status-open' : 'signup-status-closed');
  btn.textContent = open ? 'Close Signups' : 'Open Signups';
}

function toggleSignupsOpen() {
  setSignupsOpen(!signupsOpen());
}

function bisSubmissionsOpen() {
  return !!(DATA && DATA.bisSubmissionsOpen);
}

function bisAllowedFor(nameRealm) {
  var allowed = DATA && DATA.bisAllowedPlayers;
  return !!(allowed && allowed.indexOf(nameRealm) !== -1);
}

function setBisSubmissionsOpen(open) {
  var btn = document.getElementById('bisToggleBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  var cbName = '_setBisOpenCb';
  window[cbName] = function(result) {
    delete window[cbName];
    if (btn) btn.disabled = false;
    if (DATA) DATA.bisSubmissionsOpen = open;
    renderBisToggle();
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    if (btn) btn.disabled = false;
    renderBisToggle();
  };
  script.src = WEB_APP_URL + '?action=setBisSubmissionsOpen&value=' + (open ? 'true' : 'false') + '&callback=' + cbName;
  document.head.appendChild(script);
}

function renderBisToggle() {
  var badge = document.getElementById('bisStatusBadge');
  var btn   = document.getElementById('bisToggleBtn');
  if (!badge || !btn) return;
  var open = bisSubmissionsOpen();
  badge.textContent = open ? 'OPEN' : 'CLOSED';
  badge.className = 'signup-status-badge ' + (open ? 'signup-status-open' : 'signup-status-closed');
  btn.textContent = open ? 'Close Submissions' : 'Open Submissions';
}

function toggleBisSubmissionsOpen() {
  setBisSubmissionsOpen(!bisSubmissionsOpen());
}

// -- Officer dashboard ------------------------------------------------------
function buildOfficerDashboard() {
  buildStatsBar();
  buildRosterTable();
  renderSignupToggle();
  renderBisToggle();
  if (DATA._loadedAt) {
    var t = DATA._loadedAt;
    var h = t.getHours(), m = t.getMinutes();
    var ts = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    var el = document.getElementById('dataTimestamp');
    if (el) el.textContent = 'Data as of ' + ts;
  }
}

function buildStatsBar() {
  var roster  = DATA.roster || [];
  var raiders = roster.filter(function(p) { return !p.isBench; });
  var totalAttend = 0, attendCount = 0, bisCount = 0;
  for (var i = 0; i < raiders.length; i++) {
    var p = raiders[i];
    var pct = parseInt(p.attendance);
    if (!isNaN(pct)) { totalAttend += pct; attendCount++; }
    if (p.bisLink) bisCount++;
  }
  var avgAttend = attendCount ? Math.round(totalAttend / attendCount) : 0;
  var avgColor = attendColor(avgAttend);
  var totalItems = 0;
  var lootMap = DATA.lootCounts || {};
  var lootKeys = Object.keys(lootMap);
  for (var j = 0; j < lootKeys.length; j++) { if (lootMap[lootKeys[j]]) totalItems += lootMap[lootKeys[j]].count || 0; }

  document.getElementById('officerStats').innerHTML =
    '<div class="stat-card"><div class="stat-value">'+raiders.length+'</div><div class="stat-label">Raiders</div></div>' +
    '<div class="stat-card"><div class="stat-value" style="color:'+avgColor+';">'+avgAttend+'%</div><div class="stat-label">Avg Attendance</div></div>' +
    '<div class="stat-card"><div class="stat-value">'+totalItems+'</div><div class="stat-label">Items Distributed</div></div>' +
    '<div class="stat-card"><div class="stat-value">'+bisCount+'<span style="font-size:1.2rem;color:var(--text-muted);">/'+raiders.length+'</span></div><div class="stat-label">BiS Submitted</div></div>';
}

// -- Filters ----------------------------------------------------------------
function toggleFilter(name) {
  activeFilters[name] = !activeFilters[name];
  document.getElementById('chip-'+name).classList.toggle('active', activeFilters[name]);
  buildRosterTable();
}

function toggleRole(role) {
  var current = activeFilters.role;
  activeFilters.role = (current === role) ? null : role;
  ['Tank','Heal','Melee','Ranged'].forEach(function(r) {
    document.getElementById('chip-role-'+r).classList.toggle('active', activeFilters.role === r);
  });
  buildRosterTable();
}

function toggleSort(key) {
  if (activeSort.key === key) {
    activeSort.dir *= -1;
  } else {
    activeSort.key = key;
    activeSort.dir = 1;
  }
  ['name','attendance','items'].forEach(function(k) {
    var chip = document.getElementById('chip-sort-' + k);
    var isActive = activeSort.key === k;
    chip.classList.toggle('active', isActive);
    chip.textContent = { name:'Name', attendance:'Attendance', items:'Items' }[k] + (isActive ? (activeSort.dir === 1 ? ' ^' : ' v') : '');
  });
  buildRosterTable();
}

// -- Roster table -----------------------------------------------------------
function buildRosterTable() {
  var order  = ['Tank','Heal','Melee','Ranged','Bench'];
  var labels = { Tank:'🛡 Tanks', Heal:'💚 Healers', Melee:'⚔️ Melee', Ranged:'🏹 Ranged', Bench:'🪑 Bench' };
  var groups = { Tank:[], Heal:[], Melee:[], Ranged:[], Bench:[] };

  var searchTerm  = normalise((document.getElementById('rosterSearch')  || {}).value || '');
  var bisItemTerm = normalise((document.getElementById('bisItemSearch') || {}).value || '');

  for (var i = 0; i < DATA.roster.length; i++) {
    var p = DATA.roster[i];
    if (activeFilters.lowAttend && (parseInt(p.attendance)||0) >= 90) continue;
    if (activeFilters.noBis && p.bisLink) continue;
    if (activeFilters.trial && !p.isTrial) continue;
    if (activeFilters.bench && !p.isBench) continue;
    if (activeFilters.role && p.role !== activeFilters.role) continue;
    if (searchTerm && normalise(p.nick||'').indexOf(searchTerm) === -1 && normalise(p.firstName||'').indexOf(searchTerm) === -1) continue;
    if (bisItemTerm) {
      var bisItems = getBisItems(p.firstName);
      var hasBisMatch = false;
      for (var bi = 0; bi < bisItems.length; bi++) {
        if (normalise(bisItems[bi].item).indexOf(bisItemTerm) !== -1) { hasBisMatch = true; break; }
      }
      if (!hasBisMatch) continue;
    }
    if (p.isBench) groups['Bench'].push(p);
    else if (groups[p.role]) groups[p.role].push(p);
  }

  var sortFn;
  if (activeSort.key === 'name') {
    sortFn = function(a,b) { return activeSort.dir * (a.nick||a.firstName).localeCompare(b.nick||b.firstName); };
  } else if (activeSort.key === 'attendance') {
    sortFn = function(a,b) { return activeSort.dir * ((parseInt(a.attendance)||0) - (parseInt(b.attendance)||0)); };
  } else if (activeSort.key === 'items') {
    sortFn = function(a,b) {
      var ac = (getLootEntry(a.firstName)||{count:0}).count;
      var bc = (getLootEntry(b.firstName)||{count:0}).count;
      return activeSort.dir * (ac - bc);
    };
  } else {
    sortFn = function(a,b) { return (a.nick||a.firstName).localeCompare(b.nick||b.firstName); };
  }

  for (var r = 0; r < order.length; r++) {
    groups[order[r]].sort(sortFn);
  }

  var html = '<thead><tr><th>Player</th><th>Attendance</th><th>Items</th><th>BiS Link</th><th>Status</th></tr></thead><tbody>';
  var totalRows = 0;

  for (var r = 0; r < order.length; r++) {
    var role    = order[r];
    var players = groups[role];
    if (!players.length) continue;
    html += '<tr class="group-header"><td colspan="5">'+labels[role]+'</td></tr>';
    for (var j = 0; j < players.length; j++) {
      var p         = players[j];
      var name      = p.nick || p.firstName;
      var pct       = parseInt(p.attendance) || 0;
      var color     = attendColor(pct);
      var lootEntry = getLootEntry(p.firstName);
      var lootCount = lootEntry ? lootEntry.count : 0;
      var hasBis    = !!p.bisLink;
      var roleColor = p.role==='Tank'?'var(--tank)':p.role==='Heal'?'var(--heal)':p.role==='Ranged'?'var(--ranged)':'var(--melee)';
      var statusTags = '';
      if (p.isTrial) statusTags += '<span class="tag tag-trial">Trial</span> ';
      if (p.isBench) statusTags += '<span class="tag tag-bench">Bench</span>';
      if (!statusTags) statusTags = '<span style="color:var(--text);">—</span>';
      var barPct = pct + '%';
      var clsColor = classColor(p.class);
      html += '<tr class="player-row'+(selectedOfficerPlayer===p.firstName?' selected':'')+'" onclick="officerSelectPlayer(\''+p.firstName+'\')" data-player="'+p.firstName+'">' +
        '<td><div class="player-name-cell">' +
          '<div class="mini-avatar" style="background:rgba(0,0,0,0.25);color:'+roleColor+';border:2px solid '+roleColor+';">'+name.slice(0,2).toUpperCase()+'</div>' +
          '<div style="display:flex;flex-direction:column;gap:0.1rem;">' +
            '<div style="display:flex;align-items:center;gap:0.4rem;">' +
              '<span style="font-weight:600;color:var(--text);">'+name+'</span>' +
              (p.firstName!==name?'<span style="font-size:0.95rem;color:var(--text-muted);">('+p.firstName+')</span>':'') +
            '</div>' +
            (p.class?'<span style="font-size:1rem;color:'+clsColor+';letter-spacing:0.03em;">'+p.class+(p.spec?' · '+p.spec:'')+'</span>':'') +
          '</div>' +
        '</div></td>' +
        '<td><div class="attend-mini-cell"><span class="attend-mini" style="color:'+color+';">'+(p.attendance||'—')+'</span>' +
          (pct?'<div class="attend-mini-bar-wrap"><div class="attend-mini-bar" style="width:'+barPct+';background:'+color+';"></div></div>':'') +
        '</div></td>' +
        '<td>'+lootCount+'</td>' +
        '<td>'+(hasBis?'<span style="color:var(--heal);font-size:1.1rem;">✓</span>':'<span style="color:var(--text-dim);">—</span>')+'</td>' +
        '<td>'+statusTags+'</td>' +
        '</tr>';
      totalRows++;
    }
  }
  if (totalRows === 0) html += '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:2rem;">No players match the current filters.</td></tr>';
  html += '</tbody>';
  document.getElementById('rosterTable').innerHTML = html;

  var countEl = document.getElementById('bisItemCount');
  if (countEl) {
    countEl.textContent = bisItemTerm ? totalRows + ' player' + (totalRows !== 1 ? 's' : '') : '';
  }
}

function officerSelectPlayer(firstName) {
  selectedOfficerPlayer = firstName;
  buildRosterTable();
  var container = document.getElementById('officerProfile');
  renderProfile(firstName, 'officer', container);
  container.scrollIntoView({ behavior:'smooth', block:'start' });
}

// -- BiS Conflicts ----------------------------------------------------------
function buildConflicts() {
  var bisList  = DATA.bisList || {};
  var prioOrder = DATA.priorityOrder || {};
  var itemMap  = {};

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
      var pName  = players[j];
      var pData  = null;
      for (var k = 0; k < DATA.roster.length; k++) { if (normalise(DATA.roster[k].firstName)===normalise(pName)) { pData=DATA.roster[k]; break; } }
      var display = pData ? (pData.nick || pData.firstName) : pName;
      var rankPos = ranked.findIndex ? ranked.findIndex(function(r){return normalise(r)===normalise(pName);}) : -1;
      var isRanked = rankPos >= 0;
      var lootEntry = getLootEntry(pName);
      var received = false, receivedDiff = '';
      if (lootEntry && lootEntry.items) {
        for (var m = 0; m < lootEntry.items.length; m++) {
          var itemObj  = lootEntry.items[m];
          var itemName = typeof itemObj === 'string' ? itemObj : itemObj.name;
          if (normalise(itemName) === normalise(item)) {
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

// -- Loot Fairness ----------------------------------------------------------
function setDiffFilter(val) {
  activeDiffFilter = val;
  ['all','heroic','mythic'].forEach(function(v) {
    var el = document.getElementById('diff-chip-' + v);
    if (el) el.classList.toggle('active', v === val);
  });
  buildFairness();
}

function buildFairness() {
  var roster  = DATA.roster || [];
  var roleOrder  = ['Tank','Heal','Melee','Ranged','Bench'];
  var roleLabels = { Tank:'Tanks', Heal:'Healers', Melee:'Melee', Ranged:'Ranged', Bench:'Bench' };
  var roleColors = { Tank:'var(--tank)', Heal:'var(--heal)', Melee:'var(--melee)', Ranged:'var(--ranged)', Bench:'var(--text-dim)' };

  var allEntries = [];
  for (var i = 0; i < roster.length; i++) {
    var p     = roster[i];
    var entry = getLootEntry(p.firstName);
    var count = 0;
    if (entry) {
      if (activeDiffFilter === 'heroic')      count = entry.heroicCount || 0;
      else if (activeDiffFilter === 'mythic') count = entry.mythicCount || 0;
      else                                    count = entry.count || 0;
    }
    allEntries.push({ name: p.nick||p.firstName, count: count, role: p.isBench?'Bench':p.role });
  }
  var max = 0, totalCount = 0;
  for (var i = 0; i < allEntries.length; i++) { if (allEntries[i].count > max) max = allEntries[i].count; totalCount += allEntries[i].count; }
  if (max === 0) max = 1;
  var avg = allEntries.length ? totalCount / allEntries.length : 0;
  var avgPct = Math.round((avg / max) * 100) + '%';

  var grouped = {};
  for (var i = 0; i < roleOrder.length; i++) grouped[roleOrder[i]] = [];
  for (var i = 0; i < allEntries.length; i++) {
    var e = allEntries[i];
    if (grouped[e.role]) grouped[e.role].push(e);
  }
  for (var r = 0; r < roleOrder.length; r++) {
    grouped[roleOrder[r]].sort(function(a,b) { return b.count - a.count; });
  }

  var html = '';
  for (var r = 0; r < roleOrder.length; r++) {
    var role    = roleOrder[r];
    var players = grouped[role];
    if (!players.length) continue;
    var color = roleColors[role];
    html += '<div class="fairness-section-header" style="color:'+color+';">'+roleLabels[role]+'</div>';
    for (var i = 0; i < players.length; i++) {
      var e     = players[i];
      var width = Math.round((e.count/max)*100) + '%';
      html += '<div class="fairness-row">';
      html += '<span style="font-size:0.9rem;color:var(--text);font-weight:500;">'+e.name+'</span>';
      html += '<div class="fairness-bar-wrap"><div class="fairness-bar" style="width:'+width+';background:'+color+';"></div><div class="fairness-avg-line" style="left:'+avgPct+';"></div></div>';
      html += '<span class="fairness-count">'+e.count+'</span>';
      html += '</div>';
    }
  }
  var diffLabel = activeDiffFilter === 'heroic' ? 'Heroic' : activeDiffFilter === 'mythic' ? 'Mythic' : 'All';
  html += '<div class="fairness-avg-legend"><span class="fairness-avg-line-swatch"></span>'+diffLabel+' avg: '+Math.round(avg)+' items</div>';
  document.getElementById('fairnessContent').innerHTML = html;
}

// -- Attendance tab ---------------------------------------------------------
function buildAttendanceTab() {
  var details = DATA.attendanceDetails || {};
  var roster  = DATA.roster || [];
  var THRESHOLD = parseInt((document.getElementById('attendThreshold') || {value:'90'}).value) || 90;

  var below = [];
  for (var i = 0; i < roster.length; i++) {
    var p   = roster[i];
    var pct = parseInt(p.attendance) || 0;
    if (pct <= THRESHOLD) below.push(p);
  }
  below.sort(function(a,b) { return (parseInt(a.attendance)||0) - (parseInt(b.attendance)||0); });

  var html = '';
  if (!below.length) {
    html = '<p style="color:var(--text);padding:1rem;">All raiders are at or above '+THRESHOLD+'% attendance.</p>';
  } else {
    html += '<p style="font-size:1rem;color:var(--text);margin-bottom:1rem;">'+below.length+' raider'+(below.length!==1?'s':'')+' at or below '+THRESHOLD+'% attendance</p>';
    for (var i = 0; i < below.length; i++) {
      var p       = below[i];
      var name    = p.nick || p.firstName;
      var pct     = parseInt(p.attendance) || 0;
      var color   = attendColor(pct);
      var penalty = details[p.firstName] || [];

      html += '<div class="attend-player-row">';
      html += '<div class="attend-player-header">';
      html += '<span class="attend-player-name">'+name+(p.firstName!==name?' <span style="font-size:0.95rem;color:var(--text-muted);">('+p.firstName+')</span>':'')+'</span>';
      html += '<span style="font-size:1rem;font-weight:700;color:'+color+';">'+( p.attendance||'—')+'</span>';
      html += '</div>';

      html += '<div class="attend-row" style="margin-bottom:0.5rem;">';
      html += '<div class="attend-bar-wrap"><div class="attend-bar" style="width:'+(p.attendance||'0%')+';background:'+color+';"></div></div>';
      html += '</div>';

      if (penalty.length) {
        html += '<div class="attend-penalty-list">';
        for (var j = 0; j < penalty.length; j++) {
          var ae = penalty[j];
          var sc = ae.status==='No Show'?'var(--melee)':'var(--gold)';
          html += '<div class="attend-penalty-entry">';
          html += '<span style="color:var(--text);">'+ae.date+'</span>';
          html += '<span style="color:'+sc+';font-weight:600;">'+ae.status+'</span>';
          html += '</div>';
        }
        html += '</div>';
      }
      html += '</div>';
    }
  }
  document.getElementById('attendanceContent').innerHTML = html;
}

// -- Priority tab -----------------------------------------------------------
function togglePrioSection(id) {
  var el = document.getElementById(id);
  var chevron = event.currentTarget.querySelector('.prio-chevron');
  var collapsed = el.style.display === 'none';
  el.style.display = collapsed ? '' : 'none';
  if (chevron) chevron.textContent = collapsed ? '-' : '+';
}

var ARMOR_SLOT_ORDER = ['HEAD','SHOULDERS','CHEST','GLOVES','LEGS','CLOAK','BRACERS','BELT','BOOTS'];

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

  // Group items
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

  var GROUP_ORDER = ['Trinket', 'Armor', 'Weapon', 'Jewelry', 'Other'];
  var GROUP_LABELS = { Trinket: 'Trinkets', Armor: 'Armor', Weapon: 'Weapons', Jewelry: 'Jewelry', Other: 'Other' };

  var html = '';
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
        var slotKey = ARMOR_SLOT_ORDER[si];
        var slotItems = groups.Armor[slotKey];
        if (!slotItems || !slotItems.length) continue;
        html += '<div class="prio-sub-header" style="color:' + getSlotColor(slotKey) + ';">' + slotKey.charAt(0) + slotKey.slice(1).toLowerCase() + '</div>';
        for (var k = 0; k < slotItems.length; k++) html += renderItem(slotItems[k]);
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

document.querySelectorAll('.footer').forEach(function(el) {
  el.innerHTML = 'We Go Again · Team Phoenix · v' + VERSION + ' · <a class="footer-link" href="https://github.com/katogaming88/Phoenix-Roster/blob/main/CHANGELOG.md" target="_blank" rel="noopener">Changelog</a>';
});

loadData();
