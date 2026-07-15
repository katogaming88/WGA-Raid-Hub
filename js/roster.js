// Public page: view switching, player dropdown, boot
function showView(name) {
  document.getElementById('loadingMsg').style.display = 'none';
  ['landingView', 'profileViewWrap', 'signupViewWrap', 'rosterViewWrap', 'streamersViewWrap', 'helpViewWrap'].forEach(
    function (id) {
      document.getElementById(id).classList.remove('active');
    }
  );
  if (name === 'landing') {
    document.getElementById('landingView').classList.add('active');
    updateSignupNavItem();
  }
  if (name === 'profile') document.getElementById('profileViewWrap').classList.add('active');
  if (name === 'signup') document.getElementById('signupViewWrap').classList.add('active');
  if (name === 'roster') {
    document.getElementById('rosterViewWrap').classList.add('active');
    buildPublicRosterTab();
    buildIncomingRosterSection();
    showRosterSubTab('current');
  }
  if (name === 'streamers') {
    document.getElementById('streamersViewWrap').classList.add('active');
    buildStreamersTab();
  }
  if (name === 'help') document.getElementById('helpViewWrap').classList.add('active');
  ['navHome', 'navSignup', 'navRoster', 'navStreamers', 'navHelp'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  var activeNav = {
    landing: 'navHome',
    profile: 'navHome',
    signup: 'navSignup',
    roster: 'navRoster',
    streamers: 'navStreamers',
    help: 'navHelp'
  }[name];
  if (activeNav) {
    var el = document.getElementById(activeNav);
    if (el) el.classList.add('active');
  }

  // Hide the floating stream widget where it's redundant (Streams tab itself)
  // or just noisy (mid-signup) -- shown everywhere else (landing, roster, profile).
  var widget = document.getElementById('streamWidget');
  if (widget) widget.classList.toggle('stream-widget-hidden', name === 'streamers' || name === 'signup');
}

function populateDropdown() {
  var sel = document.getElementById('playerSelect');
  var order = ['Tank', 'Heal', 'Melee', 'Ranged'];
  var labels = { Tank: 'Tanks', Heal: 'Healers', Melee: 'Melee', Ranged: 'Ranged' };
  var groups = { Tank: [], Heal: [], Melee: [], Ranged: [] };
  for (var i = 0; i < DATA.roster.length; i++) {
    var p = DATA.roster[i];
    if (groups[p.role]) groups[p.role].push(p);
  }
  for (var r = 0; r < order.length; r++) {
    var role = order[r];
    var players = groups[role];
    if (!players.length) continue;
    players.sort(function (a, b) {
      return (a.nick || a.firstName).localeCompare(b.nick || b.firstName);
    });
    var group = document.createElement('optgroup');
    group.label = labels[role];
    for (var j = 0; j < players.length; j++) {
      var player = players[j];
      var opt = document.createElement('option');
      opt.value = player.firstName;
      opt.textContent = player.nick ? player.nick + ' (' + player.firstName + ')' : player.firstName;
      group.appendChild(opt);
    }
    sel.appendChild(group);
  }
}

function buildPublicRosterTab() {
  var container = document.getElementById('rosterView');
  if (!container || !window.DATA || !DATA.roster) return;

  var order = ['Tank', 'Heal', 'Melee', 'Ranged'];
  var labels = { Tank: 'Tanks', Heal: 'Healers', Melee: 'Melee', Ranged: 'Ranged' };
  var groups = { Tank: [], Heal: [], Melee: [], Ranged: [] };

  for (var i = 0; i < DATA.roster.length; i++) {
    var p = DATA.roster[i];
    if (groups[p.role]) groups[p.role].push(p);
  }

  var html = '<table class="roster-table"><thead><tr><th>Player</th><th>Class / Spec</th></tr></thead><tbody>';

  for (var r = 0; r < order.length; r++) {
    var role = order[r];
    var players = groups[role];
    if (!players.length) continue;
    players.sort(function (a, b) {
      return (a.nick || a.firstName).localeCompare(b.nick || b.firstName);
    });
    html += '<tr class="group-header"><td colspan="2">' + labels[role] + '</td></tr>';

    for (var j = 0; j < players.length; j++) {
      var player = players[j];
      var roleColor =
        player.role === 'Tank'
          ? 'var(--tank)'
          : player.role === 'Heal'
            ? 'var(--heal)'
            : player.role === 'Ranged'
              ? 'var(--ranged)'
              : 'var(--melee)';
      var dispName = player.nick || player.firstName;
      html +=
        '<tr>' +
        '<td><div class="player-name-cell">' +
        '<div class="mini-avatar" style="background:rgba(0,0,0,0.25);color:' +
        roleColor +
        ';border:2px solid ' +
        roleColor +
        ';">' +
        dispName.slice(0, 2).toUpperCase() +
        '</div>' +
        '<span style="font-weight:600;color:var(--text);">' +
        dispName +
        '</span>' +
        (player.firstName !== dispName
          ? '<span style="font-size:1.02rem;color:var(--text-muted);">(' + player.firstName + ')</span>'
          : '') +
        '</div></td>' +
        '<td>' +
        (player.class
          ? '<span class="badge badge-class" style="' +
            classBadgeStyle(player.class) +
            ';">' +
            (player.spec || player.class) +
            '</span>'
          : '<span style="color:var(--text-dim);">-</span>') +
        '</td>' +
        '</tr>';
    }
  }

  html += '</tbody></table>';
  container.innerHTML = html;
}

// Raider-facing preview of approved-but-unpromoted signups for the current
// signup season (#499) -- same grouped table as buildPublicRosterTab(), but
// reading DATA.incomingRoster (from the incoming_roster view) instead of
// DATA.roster. Visibility (and whether the Incoming sub-tab even exists) is
// handled by showRosterSubTab(), not here -- this only builds the table markup.
function buildIncomingRosterSection() {
  var container = document.getElementById('incomingRosterSection');
  if (!container) return;
  var rows = (window.DATA && DATA.incomingRoster) || [];
  if (!rows.length) {
    container.innerHTML = '';
    return;
  }

  var order = ['Tank', 'Heal', 'Melee', 'Ranged'];
  var labels = { Tank: 'Tanks', Heal: 'Healers', Melee: 'Melee', Ranged: 'Ranged' };
  var groups = { Tank: [], Heal: [], Melee: [], Ranged: [] };

  for (var i = 0; i < rows.length; i++) {
    var p = rows[i];
    if (groups[p.role]) groups[p.role].push(p);
  }

  var html = '<table class="roster-table"><thead><tr><th>Player</th><th>Class / Spec</th></tr></thead><tbody>';

  for (var r = 0; r < order.length; r++) {
    var role = order[r];
    var players = groups[role];
    if (!players.length) continue;
    players.sort(function (a, b) {
      return a.firstName.localeCompare(b.firstName);
    });
    html += '<tr class="group-header"><td colspan="2">' + labels[role] + '</td></tr>';

    for (var j = 0; j < players.length; j++) {
      var player = players[j];
      var roleColor =
        player.role === 'Tank'
          ? 'var(--tank)'
          : player.role === 'Heal'
            ? 'var(--heal)'
            : player.role === 'Ranged'
              ? 'var(--ranged)'
              : 'var(--melee)';
      html +=
        '<tr>' +
        '<td><div class="player-name-cell">' +
        '<div class="mini-avatar" style="background:rgba(0,0,0,0.25);color:' +
        roleColor +
        ';border:2px solid ' +
        roleColor +
        ';">' +
        player.firstName.slice(0, 2).toUpperCase() +
        '</div>' +
        '<span style="font-weight:600;color:var(--text);">' +
        player.firstName +
        '</span>' +
        '</div></td>' +
        '<td>' +
        (player.class
          ? '<span class="badge badge-class" style="' +
            classBadgeStyle(player.class) +
            ';">' +
            (player.spec || player.class) +
            '</span>'
          : '<span style="color:var(--text-dim);">-</span>') +
        '</td>' +
        '</tr>';
    }
  }

  html += '</tbody></table>';
  container.innerHTML = html;
}

// Which of the Roster tab's two sub-tabs is showing -- reset to 'current'
// whenever a raider navigates into the Roster tab fresh (showView), but left
// alone when heavy data re-renders while they're already looking at it, so a
// late-arriving incoming-roster fetch doesn't yank them off what they're
// reading (#499).
var _rosterSubTab = 'current';

function showRosterSubTab(tab) {
  var hasIncoming = ((window.DATA && DATA.incomingRoster) || []).length > 0;
  _rosterSubTab = hasIncoming && tab === 'incoming' ? 'incoming' : 'current';

  var subNav = document.getElementById('rosterSubNav');
  var tabCurrentBtn = document.getElementById('rosterSubTabCurrent');
  var tabIncomingBtn = document.getElementById('rosterSubTabIncoming');
  var rosterEl = document.getElementById('rosterView');
  var incomingEl = document.getElementById('incomingRosterSection');

  if (subNav) subNav.style.display = hasIncoming ? 'flex' : 'none';
  if (tabIncomingBtn) tabIncomingBtn.style.display = hasIncoming ? '' : 'none';
  if (tabCurrentBtn) tabCurrentBtn.classList.toggle('active', _rosterSubTab === 'current');
  if (tabIncomingBtn) tabIncomingBtn.classList.toggle('active', _rosterSubTab === 'incoming');
  if (rosterEl) rosterEl.style.display = _rosterSubTab === 'current' ? '' : 'none';
  if (incomingEl) incomingEl.style.display = _rosterSubTab === 'incoming' ? '' : 'none';
}

function updateSignupNavItem() {
  var el = document.getElementById('navSignup');
  if (el) el.style.display = DATA && DATA.signupsOpen ? '' : 'none';
}

document.getElementById('playerSelect').addEventListener('change', function (e) {
  if (e.target.value) {
    showView('profile');
    renderProfile(e.target.value, 'landing');
  }
});

function buildPublicStats() {
  var loot = DATA.lootCounts || {};
  var totalItems = 0;
  var keys = Object.keys(loot);
  for (var i = 0; i < keys.length; i++) totalItems += loot[keys[i]].count || 0;

  var el = document.getElementById('landingStats');
  if (!el) return;
  el.innerHTML =
    '<div class="pub-stat"><span class="pub-stat-num">' +
    (DATA.roster || []).length +
    '</span><span class="pub-stat-label">Raiders</span></div>' +
    '<div class="pub-stat"><span class="pub-stat-num">' +
    totalItems +
    '</span><span class="pub-stat-label">Items This Tier</span></div>';
}

function buildRecentLoot() {
  var loot = DATA.lootCounts || {};
  var roster = DATA.roster || [];

  var nameMap = {};
  for (var i = 0; i < roster.length; i++) {
    nameMap[normalise(roster[i].firstName)] = roster[i].nick || roster[i].firstName;
  }

  var all = [];
  var keys = Object.keys(loot);
  for (var k = 0; k < keys.length; k++) {
    var key = keys[k];
    var items = loot[key].items || [];
    var display = nameMap[key] || key.charAt(0).toUpperCase() + key.slice(1);
    for (var j = 0; j < items.length; j++) {
      all.push({
        player: display,
        item: items[j].name,
        difficulty: items[j].difficulty,
        date: items[j].date,
        _d: new Date(items[j].date)
      });
    }
  }

  all.sort(function (a, b) {
    return b._d - a._d;
  });
  var recent = all.slice(0, 10);

  var el = document.getElementById('landingLoot');
  if (!el || !recent.length) return;

  var html = '<div class="pub-loot-title">Recent Loot</div>';
  for (var m = 0; m < recent.length; m++) {
    var e = recent[m];
    var diffClass =
      e.difficulty === 'Mythic' ? 'diff-mythic' : e.difficulty === 'Heroic' ? 'diff-heroic' : 'diff-other';
    html +=
      '<div class="pub-loot-row">' +
      '<span class="pub-loot-player">' +
      e.player +
      '</span>' +
      '<span class="pub-loot-item">' +
      e.item +
      '</span>' +
      '<span class="pub-loot-diff ' +
      diffClass +
      '">' +
      e.difficulty +
      '</span>' +
      '<span class="pub-loot-date">' +
      e.date +
      '</span>' +
      '</div>';
  }
  el.innerHTML = html;
}

function buildProgression() {
  var raids = (DATA && DATA.raidProgression) || [];
  var el = document.getElementById('landingProgression');
  if (!el || !raids.length) return;

  var html = '<div class="prog-wrap">';
  for (var i = 0; i < raids.length; i++) {
    var raid = raids[i];
    var bosses = raid.bosses || [];
    var killed = bosses.filter(function (b) {
      return !!b.mythicDate;
    }).length;
    var total = bosses.length;
    var pct = total ? Math.round((killed / total) * 100) : 0;
    html += '<div class="prog-card">';
    html += '<div class="prog-header">';
    html += '<span class="prog-score">' + killed + '/' + total + ' M</span>';
    html += '<span class="prog-raid-name">' + _esc(raid.name || 'Unnamed Raid') + '</span>';
    html += '</div>';
    if (total) {
      html += '<div class="prog-bar-wrap"><div class="prog-bar" style="width:' + pct + '%"></div></div>';
    }
    if (bosses.length) {
      html += '<div class="prog-bosses">';
      for (var j = 0; j < bosses.length; j++) {
        var boss = bosses[j];
        var killed_ = !!boss.mythicDate;
        var progress = _raidProgressFor(raid, boss);
        html += '<div class="prog-boss' + (killed_ ? ' prog-boss-killed' : '') + '">';
        html += '<span class="prog-boss-num">' + (j + 1) + '</span>';
        html += '<span class="prog-boss-name">' + _esc(boss.name || 'Unknown') + '</span>';
        if (killed_) html += '<span class="prog-boss-date">' + boss.mythicDate + '</span>';
        html += _renderPullsBadge(progress, killed_);
        html += '</div>';
      }
      html += '</div>';
    }
    if (!raid.isMiniRaid && raid.aotcDate) {
      html += '<div class="prog-aotc">AOTC <span class="prog-aotc-date">' + raid.aotcDate + '</span></div>';
    }
    html += '</div>';
  }
  html += '</div>';
  el.innerHTML = html;
}

// Boss objects in DATA.raidProgression never carry a WCL encounterID
// (tab-season.js's fetchWclForRaid() discards it before saving), so the
// join to DATA.raidProgress -- keyed by "<wclZoneId>|<normalised name>" in
// mapSupabaseRaidProgress() -- has to go through the same (zone, boss name)
// pair used everywhere else in this card.
function _raidProgressFor(raid, boss) {
  var map = (DATA && DATA.raidProgress) || {};
  var zoneId = raid.wclZoneId;
  if (!zoneId || !boss || !boss.name) return null;
  return map[zoneId + '|' + normalise(boss.name)] || null;
}

function _wclReportUrl(progress) {
  if (!progress || !progress.reportCode) return '';
  var url = 'https://www.warcraftlogs.com/reports/' + encodeURIComponent(progress.reportCode);
  if (progress.fightId) url += '#fight=' + encodeURIComponent(progress.fightId);
  return url;
}

// killed bosses: total pulls next to the existing kill date (matching WCL's
// own reports view, e.g. "Belo'ren, Child of Al'ar -- Pulls: 81"). Still
// in-progress: pulls plus best % remaining on the current best attempt.
// Either way, a report link (when the sync found one) jumps straight to
// that pull/kill on WCL.
function _renderPullsBadge(progress, killed) {
  if (!progress || progress.pulls == null) return '';
  var text = progress.pulls + (progress.pulls === 1 ? ' pull' : ' pulls');
  if (!killed && progress.bestPct != null) {
    text += ' -- best ' + progress.bestPct + '%';
  }
  var url = _wclReportUrl(progress);
  if (url) {
    return '<a class="prog-boss-pulls" href="' + url + '" target="_blank" rel="noopener">' + _esc(text) + '</a>';
  }
  return '<span class="prog-boss-pulls">' + _esc(text) + '</span>';
}

function _esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Called by discord.js when a stored session is successfully validated on page load.
// officer-quick-actions.js (loaded before this file) also wants this hook -- only
// one function named onDiscordSessionRestored can exist in the global scope, and
// this file's declaration is the one that wins since it loads last, so it has to
// call _qaRefresh() itself (#371) or the officer bar/player selector/claim prompt
// silently never react to a restored session.
function onDiscordSessionRestored(session) {
  if (typeof _qaRefresh === 'function') _qaRefresh();
  if (session && session.nameRealm && sessionStorage.getItem('wga_open_profile')) {
    sessionStorage.removeItem('wga_open_profile');
    autoOpenClaimedProfile(session.nameRealm);
  }
}

// Auto-open the claimed character's profile after Discord login / session restore.
function autoOpenClaimedProfile(nameRealm) {
  if (!nameRealm || !window.DATA) return;
  var firstName = nameRealm.split('-')[0].trim();
  var sel = document.getElementById('playerSelect');
  if (!sel) return;
  // Confirm the character is actually in the current roster dropdown
  var found = false;
  for (var i = 0; i < sel.options.length; i++) {
    if (sel.options[i].value === firstName) {
      found = true;
      break;
    }
  }
  if (!found) return;
  sel.value = firstName;
  showView('profile');
  renderProfile(firstName, 'landing');
}

// Boot -- maintenance mode gates loadData() entirely, before any data loads.
function bootRosterApp() {
  checkMaintenanceMode().then(function (maint) {
    if (maint.enabled) {
      showMaintenanceBanner(maint.message);
      return;
    }
    loadData(
      function () {
        populateDropdown();
        buildPublicStats();
        buildProgression();
        buildStreamWidget();
        // Deep-link support for officer.html's nav (#354) -- its Roster/Streams/Sign
        // Up/Help links point back at index.html since those views only exist here.
        var hashView = { roster: 'roster', streams: 'streamers', signup: 'signup', help: 'help' }[
          (location.hash || '').replace('#', '')
        ];
        if (hashView === 'signup') showSignupView();
        else if (hashView) showView(hashView);
        else showView('landing');
        // Init Discord session after core data is ready so the profile deep-link can
        // find the claimed character in the now-populated player dropdown.
        if (typeof initDiscordLogin === 'function') initDiscordLogin();
      },
      function () {
        buildPublicStats();
        buildProgression();
        buildRecentLoot();
        buildStreamWidget();
        var sel = document.getElementById('playerSelect');
        var profileWrap = document.getElementById('profileViewWrap');
        if (sel && sel.value && profileWrap && profileWrap.classList.contains('active')) {
          renderProfile(sel.value, 'landing');
        }
        var rosterWrap = document.getElementById('rosterViewWrap');
        if (rosterWrap && rosterWrap.classList.contains('active')) {
          buildIncomingRosterSection();
          showRosterSubTab(_rosterSubTab);
        }
      }
    );
  });
}

// Cold-landing team picker (see IS_COLD_LANDING, js/common.js). Shown instead of
// booting the app for whichever team happens to be the fallback default -- tries
// a claim-based auto-redirect first, falling back to manual team buttons so a
// raider on another team never silently lands on Phoenix's roster.
function showTeamPickerButtons() {
  var spinner = document.getElementById('teamPickerSpinner');
  var status = document.getElementById('teamPickerStatus');
  var list = document.getElementById('teamPickerList');
  if (spinner) spinner.style.display = 'none';
  if (status) status.style.display = 'none';
  if (!list) return;
  list.innerHTML = '';
  Object.keys(TEAMS).forEach(function (slug) {
    var btn = document.createElement('button');
    btn.className = 'btn btn-gold team-picker-btn';
    btn.textContent = TEAMS[slug].name;
    btn.onclick = function () {
      sessionStorage.setItem('wga_team', slug);
      location.href = location.pathname + '?team=' + slug;
    };
    list.appendChild(btn);
  });
  list.style.display = 'flex';
}

function resolveColdLanding() {
  var screen = document.getElementById('teamPickerScreen');
  if (screen) screen.style.display = 'flex';
  if (!supabaseClient) {
    showTeamPickerButtons();
    return;
  }
  supabaseClient.auth
    .getSession()
    .then(function (result) {
      var session = result && result.data && result.data.session;
      if (!session) {
        showTeamPickerButtons();
        return;
      }
      // Same "auth_user_id only, no team_id filter" query as findClaimElsewhere
      // (js/discord.js) -- the RLS policy allows a member to read all their own
      // team_members rows, letting us find a claim on any team in one query.
      return supabaseClient
        .from('team_members')
        .select('team_id, players!players_team_member_id_fkey(name_realm)')
        .eq('auth_user_id', session.user.id)
        .then(function (res) {
          var rows = (res && res.data) || [];
          var claimedSlug = null;
          for (var i = 0; i < rows.length && !claimedSlug; i++) {
            var players = rows[i].players || [];
            if (!players.length || !players[0].name_realm) continue;
            Object.keys(TEAMS).forEach(function (slug) {
              if (!claimedSlug && TEAMS[slug].supabaseTeamId === rows[i].team_id) claimedSlug = slug;
            });
          }
          if (claimedSlug) {
            sessionStorage.setItem('wga_team', claimedSlug);
            location.href = location.pathname + '?team=' + claimedSlug;
          } else {
            showTeamPickerButtons();
          }
        });
    })
    .catch(function () {
      showTeamPickerButtons();
    });
}

if (typeof IS_COLD_LANDING !== 'undefined' && IS_COLD_LANDING) {
  resolveColdLanding();
} else {
  bootRosterApp();
}
