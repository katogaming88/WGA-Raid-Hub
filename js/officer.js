var OFFICER_PASS = _teamCfg.officerPass;
var SESSION_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours
var _SESSION_KEY = TEAM_SLUG + '_officer';
var _SESSION_TS_KEY = TEAM_SLUG + '_officer_ts';
var selectedOfficerPlayer = null;
var activeFilters = {};
var activeSort = { key: null, dir: 1 };
// ACTIVE_SEASON is declared in common.js; officer.js updates it via setActiveSeason()

function toggleHelp(id) {
  var el = document.getElementById(id);
  if (el) el.classList.toggle('open');
}

function showView(name) {
  document.getElementById('loadingMsg').style.display = 'none';
  if (name === 'officer') document.getElementById('officerViewWrap').classList.add('active');
}

function openTab(name) {
  var btns = document.querySelectorAll('.nav-item');
  for (var i = 0; i < btns.length; i++) {
    var attr = btns[i].getAttribute('onclick') || '';
    if (attr.indexOf("'" + name + "'") !== -1) {
      btns[i].click();
      return;
    }
  }
}

function switchTab(name) {
  document.querySelectorAll('.nav-item').forEach(function (b) {
    b.classList.remove('active');
  });
  document.querySelectorAll('.tab-panel').forEach(function (p) {
    p.classList.remove('active');
  });
  event.target.classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
  if (name === 'loot') {
    resetLootSubTab();
  }
  if (name === 'attendance') buildAttendanceTab();
  if (name === 'priority') {
    resetPrioritySubTab();
    buildPriorityTab();
  }
  if (name === 'signups') {
    resetSignupsSubTab();
    buildSignupsTab();
  }
  if (name === 'requests') buildRequestsTab();
  if (name === 'bis') {
    resetBisSubTab();
    buildBisTab();
  }
  if (name === 'mplus') buildMPlusTab();
  if (name === 'audit') buildAuditTab();
  if (name === 'reports') {
    resetReportsSubTab();
    buildReportsTab();
  }
  if (name === 'season') buildSeasonTab();
  if (name === 'admin') buildAdminTab();
}

function resetBisSubTab() {
  document.querySelectorAll('[id^="bis-subtab-btn-"]').forEach(function (b) {
    b.classList.remove('active');
  });
  var defaultBtn = document.getElementById('bis-subtab-btn-submissions');
  if (defaultBtn) defaultBtn.classList.add('active');
  var subSubmissions = document.getElementById('bis-sub-submissions');
  var subLists = document.getElementById('bis-sub-lists');
  if (subSubmissions) subSubmissions.style.display = '';
  if (subLists) subLists.style.display = 'none';
}

function switchBisSubTab(name, btnEl) {
  document.querySelectorAll('[id^="bis-subtab-btn-"]').forEach(function (b) {
    b.classList.remove('active');
  });
  if (btnEl) btnEl.classList.add('active');
  var subSubmissions = document.getElementById('bis-sub-submissions');
  var subLists = document.getElementById('bis-sub-lists');
  if (subSubmissions) subSubmissions.style.display = name === 'submissions' ? '' : 'none';
  if (subLists) subLists.style.display = name === 'lists' ? '' : 'none';
  if (name === 'submissions') buildBisTab();
  if (name === 'lists') buildBisListsTab();
}

function resetSignupsSubTab() {
  document.querySelectorAll('[id^="signups-subtab-btn-"]').forEach(function (b) {
    b.classList.remove('active');
  });
  var defaultBtn = document.getElementById('signups-subtab-btn-signups');
  if (defaultBtn) defaultBtn.classList.add('active');
  var subSignups = document.getElementById('signups-sub-signups');
  var subPending = document.getElementById('signups-sub-pendingRoster');
  var subHistory = document.getElementById('signups-sub-history');
  if (subSignups) subSignups.style.display = '';
  if (subPending) subPending.style.display = 'none';
  if (subHistory) subHistory.style.display = 'none';
}

function switchSignupsSubTab(name, btnEl) {
  document.querySelectorAll('[id^="signups-subtab-btn-"]').forEach(function (b) {
    b.classList.remove('active');
  });
  if (btnEl) btnEl.classList.add('active');
  var subSignups = document.getElementById('signups-sub-signups');
  var subPending = document.getElementById('signups-sub-pendingRoster');
  var subHistory = document.getElementById('signups-sub-history');
  if (subSignups) subSignups.style.display = name === 'signups' ? '' : 'none';
  if (subPending) subPending.style.display = name === 'pendingRoster' ? '' : 'none';
  if (subHistory) subHistory.style.display = name === 'history' ? '' : 'none';
  if (name === 'signups') buildSignupsTab();
  if (name === 'pendingRoster') buildPendingRosterTab();
  if (name === 'history') buildSignupHistoryTab();
}

function resetPrioritySubTab() {
  document.querySelectorAll('[id^="prio-subtab-btn-"]').forEach(function (b) {
    b.classList.remove('active');
  });
  var defaultBtn = document.getElementById('prio-subtab-btn-list');
  if (defaultBtn) defaultBtn.classList.add('active');
  var subList = document.getElementById('prio-sub-list');
  var subUnmanaged = document.getElementById('prio-sub-unmanaged');
  var subConflicts = document.getElementById('prio-sub-conflicts');
  if (subList) subList.style.display = '';
  if (subUnmanaged) subUnmanaged.style.display = 'none';
  if (subConflicts) subConflicts.style.display = 'none';
}

function switchPrioritySubTab(name, btnEl) {
  document.querySelectorAll('[id^="prio-subtab-btn-"]').forEach(function (b) {
    b.classList.remove('active');
  });
  if (btnEl) btnEl.classList.add('active');
  var subList = document.getElementById('prio-sub-list');
  var subUnmanaged = document.getElementById('prio-sub-unmanaged');
  var subConflicts = document.getElementById('prio-sub-conflicts');
  if (subList) subList.style.display = name === 'list' ? '' : 'none';
  if (subUnmanaged) subUnmanaged.style.display = name === 'unmanaged' ? '' : 'none';
  if (subConflicts) subConflicts.style.display = name === 'conflicts' ? '' : 'none';
  if (name === 'list') buildPriorityTab();
  if (name === 'unmanaged') buildUnmanagedTab();
  if (name === 'conflicts') buildConflicts();
}

function resetReportsSubTab() {
  document.querySelectorAll('[id^="reports-subtab-btn-"]').forEach(function (b) {
    b.classList.remove('active');
  });
  var defaultBtn = document.getElementById('reports-subtab-btn-rnlsi');
  if (defaultBtn) defaultBtn.classList.add('active');
  ['rnlsi', 'bisDemand', 'priorityHealth', 'lootPace'].forEach(function (name) {
    var sub = document.getElementById('reports-sub-' + name);
    if (sub) sub.style.display = name === 'rnlsi' ? '' : 'none';
  });
}

function switchReportsSubTab(name, btnEl) {
  document.querySelectorAll('[id^="reports-subtab-btn-"]').forEach(function (b) {
    b.classList.remove('active');
  });
  if (btnEl) btnEl.classList.add('active');
  ['rnlsi', 'bisDemand', 'priorityHealth', 'lootPace'].forEach(function (subName) {
    var sub = document.getElementById('reports-sub-' + subName);
    if (sub) sub.style.display = subName === name ? '' : 'none';
  });
  if (name === 'rnlsi') loadRnlsiReport();
  if (name === 'bisDemand') loadBisDemandReport();
  if (name === 'priorityHealth') loadPriorityHealthReport();
  if (name === 'lootPace') loadLootPaceReport();
}

function resetLootSubTab() {
  document.querySelectorAll('[id^="loot-subtab-btn-"]').forEach(function (b) {
    b.classList.remove('active');
  });
  var defaultBtn = document.getElementById('loot-subtab-btn-import');
  if (defaultBtn) defaultBtn.classList.add('active');
  var subFairness = document.getElementById('loot-sub-fairness');
  var subImport = document.getElementById('loot-sub-import');
  var subHistory = document.getElementById('loot-sub-history');
  if (subFairness) subFairness.style.display = 'none';
  if (subImport) subImport.style.display = '';
  if (subHistory) subHistory.style.display = 'none';
  buildLootImportForm();
}

function switchLootSubTab(name, btnEl) {
  document.querySelectorAll('[id^="loot-subtab-btn-"]').forEach(function (b) {
    b.classList.remove('active');
  });
  if (btnEl) btnEl.classList.add('active');
  var subFairness = document.getElementById('loot-sub-fairness');
  var subImport = document.getElementById('loot-sub-import');
  var subHistory = document.getElementById('loot-sub-history');
  if (subFairness) subFairness.style.display = name === 'fairness' ? '' : 'none';
  if (subImport) subImport.style.display = name === 'import' ? '' : 'none';
  if (subHistory) subHistory.style.display = name === 'history' ? '' : 'none';
  if (name === 'fairness') buildFairness();
  if (name === 'import') buildLootImportForm();
  if (name === 'history') buildLootHistoryTab();
}

function showOfficerPrompt() {
  document.getElementById('officerPassword').value = '';
  document.getElementById('officerError').style.display = 'none';
  document.getElementById('officerPrompt').classList.add('active');
  setTimeout(function () {
    document.getElementById('officerPassword').focus();
  }, 50);
}

function hideOfficerPrompt() {
  document.getElementById('officerPrompt').classList.remove('active');
}

function submitOfficerPassword() {
  if (document.getElementById('officerPassword').value === OFFICER_PASS) {
    sessionStorage.setItem(_SESSION_KEY, '1');
    sessionStorage.setItem(_SESSION_TS_KEY, String(Date.now()));
    hideOfficerPrompt();
    document.getElementById('loadingMsg').style.display = '';
    loadData(
      function () {
        buildOfficerDashboard();
        if (typeof showAdminTab === 'function') showAdminTab(true);
        document.getElementById('officerViewWrap').classList.add('active');
        document.getElementById('loadingMsg').style.display = 'none';
      },
      function () {
        buildStatsBar();
        buildRosterTable();
        reopenSelectedPlayer();
      }
    );
  } else {
    document.getElementById('officerError').style.display = '';
  }
}

function officerLogout() {
  sessionStorage.removeItem(_SESSION_KEY);
  sessionStorage.removeItem(_SESSION_TS_KEY);
  window.location.href = 'index.html';
}

function isOfficerSessionValid() {
  if (sessionStorage.getItem(_SESSION_KEY) !== '1') return false;
  var ts = parseInt(sessionStorage.getItem(_SESSION_TS_KEY) || '0', 10);
  return ts > 0 && Date.now() - ts < SESSION_DURATION_MS;
}

function setNavBadge(id, count) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = count;
  el.style.display = count > 0 ? '' : 'none';
}

function updateNavBadges() {
  jsonpRequest(WEB_APP_URL + '?action=getPendingCounts', function (err, result) {
    if (err || !result) return;
    setNavBadge('signupsNavBadge', (result.signups || 0) + (result.pendingRoster || 0));
    setNavBadge('pendingRosterSubBadge', result.pendingRoster || 0);
    setNavBadge('bisNavBadge', result.bis || 0);
    setNavBadge('mplusNavBadge', result.mplus || 0);
    setNavBadge('requestsNavBadge', result.requests || 0);
  });
}

function buildOfficerDashboard() {
  buildStatsBar();
  buildRosterTable();
  buildRosterBuffCoverage();
  buildTrialPromoAlert();
  renderSignupToggle();
  renderBisToggle();
  renderMPlusToggle();
  updateUnmanagedBadge();
  updateNavBadges();
  populateSeasonSelector();
  if (DATA._loadedAt) {
    var t = DATA._loadedAt;
    var h = t.getHours(),
      m = t.getMinutes();
    var ts = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    var el = document.getElementById('dataTimestamp');
    if (el) el.textContent = 'Data as of ' + ts;
  }
  var tabParam = (location.search.match(/[?&]tab=([^&]+)/) || [])[1];
  if (tabParam) openTab(tabParam);
}

function clearCache() {
  var btn = document.getElementById('clearCacheBtn');
  btn.disabled = true;
  btn.textContent = 'Clearing...';

  jsonpRequest(WEB_APP_URL + '?action=clearCache', function (err, data) {
    btn.textContent = !err && data && data.success ? 'Cleared!' : 'Error';
    setTimeout(function () {
      btn.textContent = 'Clear Cache';
      btn.disabled = false;
    }, 2000);
  });
}

// -- Season selector ----------------------------------------------------------

var ATTENDANCE_WEIGHTS_JS = {
  Present: 1.0,
  Bench: 1.0,
  'Medical Leave': 1.0,
  Excused: 0.8,
  'No Show': 0.0
};

function populateSeasonSelector() {
  var sel = document.getElementById('seasonSelector');
  var wrap = document.getElementById('seasonSelectorWrap');
  if (!sel) return;

  var history = (DATA && DATA.seasonHistory) || [];
  var current = (DATA && DATA.seasonName) || '';
  var hasSeasons = history.length > 0 || current;

  if (wrap) wrap.style.display = hasSeasons ? '' : 'none';

  var options = [{ label: 'All Seasons', value: '' }];
  for (var i = 0; i < history.length; i++) {
    options.push({ label: history[i].name, value: history[i].name });
  }
  if (current) options.push({ label: current + ' (current)', value: current });

  sel.innerHTML = options
    .map(function (o) {
      return '<option value="' + o.value + '">' + o.label + '</option>';
    })
    .join('');

  // Default to current season if set, otherwise All Seasons
  var defaultVal = current || '';
  sel.value = defaultVal;
  ACTIVE_SEASON = defaultVal || null;
}

function setActiveSeason(value) {
  ACTIVE_SEASON = value || null;
  rebuildSeasonFilteredViews();
}

function rebuildSeasonFilteredViews() {
  // Always rebuild the roster table (attendance % may change)
  buildRosterTable();
  reopenSelectedPlayer();
  // Rebuild whichever loot sub-tab is currently visible
  var subFairness = document.getElementById('loot-sub-fairness');
  if (subFairness && subFairness.style.display !== 'none') buildFairness();
  // Rebuild contested items if visible on the priority tab
  var subConflicts = document.getElementById('prio-sub-conflicts');
  if (subConflicts && subConflicts.style.display !== 'none') buildConflicts();
  // Rebuild attendance sub-tabs if visible
  var tabAttend = document.getElementById('tab-attendance');
  if (tabAttend && tabAttend.classList.contains('active')) {
    var subScores = document.getElementById('attend-sub-scores');
    var subBench = document.getElementById('attend-sub-bench');
    if (!subScores || subScores.style.display !== 'none') buildAttendanceTab();
    if (subBench && subBench.style.display !== 'none' && Array.isArray(_attendanceGrid)) buildBenchFairness();
  }
}

// Returns { start, end } date strings for the active season, or { start: null, end: null }
function getSeasonDateRange() {
  if (!ACTIVE_SEASON) return { start: null, end: null };
  var history = (DATA && DATA.seasonHistory) || [];
  var current = (DATA && DATA.seasonName) || '';
  var all = history.slice();
  if (current) all.push({ name: current, start: DATA.seasonStart || '', end: DATA.seasonEnd || '' });
  for (var i = 0; i < all.length; i++) {
    if (all[i].name === ACTIVE_SEASON) {
      return { start: all[i].start || null, end: all[i].end || null };
    }
  }
  return { start: null, end: null };
}

// getSeasonLootItems / getSeasonLootEntry are defined in common.js and work off ACTIVE_SEASON

// Computes attendance % for a player for the active season from rawAttendanceData.
// Returns a string like "95.0%" or null if data unavailable.
function computeSeasonAttendancePct(firstName) {
  var raw = DATA && DATA.rawAttendanceData;
  if (!raw) return null;

  var range = getSeasonDateRange();
  var start = range.start;
  var end = range.end;
  var allDates = raw.raidDates || [];
  var playerRecs = (raw.players || {})[firstName] || [];
  var joinDate = (raw.joinDates || {})[firstName] || '';

  // Filter raid dates to the season window
  var seasonDates = allDates.filter(function (d) {
    return (!start || d >= start) && (!end || d <= end);
  });

  // Determine this player's effective start within the season
  var effectiveStart = joinDate && (!start || joinDate > start) ? joinDate : start || '';
  var eligible = effectiveStart
    ? seasonDates.filter(function (d) {
        return d >= effectiveStart;
      })
    : seasonDates;

  if (!eligible.length) return null;

  // Filter player records to eligible window
  var eligibleRecs = playerRecs.filter(function (r) {
    return (!effectiveStart || r.date >= effectiveStart) && (!start || r.date >= start) && (!end || r.date <= end);
  });

  // Exclude "Not on Roster" dates from countable denominator
  var norDates = {};
  eligibleRecs.forEach(function (r) {
    if (r.status === 'Not on Roster') norDates[r.date] = true;
  });
  var countable = eligible.filter(function (d) {
    return !norDates[d];
  }).length;
  if (!countable) return null;

  var sum = eligibleRecs.reduce(function (acc, r) {
    if (r.status === 'Not on Roster') return acc;
    var w = ATTENDANCE_WEIGHTS_JS[r.status];
    return acc + (w != null ? w : 0);
  }, 0);

  return (Math.round((sum / countable) * 1000) / 10).toFixed(1) + '%';
}

// Returns attendance % for a player: prefers computed value from rawAttendanceData
// (works for any season, including All Seasons); falls back to server p.attendance.
function getDisplayAttendancePct(player) {
  if (DATA && DATA.rawAttendanceData) {
    var computed = computeSeasonAttendancePct(player.firstName);
    if (computed !== null) return computed;
  }
  return player.attendance || '0%';
}

// -- Boot: check password session first; Discord session validation happens via
//    onDiscordSessionRestored() in officer.html once discord.js calls initDiscordLogin().
if (!isOfficerSessionValid()) {
  sessionStorage.removeItem(_SESSION_KEY);
  sessionStorage.removeItem(_SESSION_TS_KEY);
  document.getElementById('loadingMsg').style.display = 'none';
  // Check for a Discord session before showing the password prompt.
  // initDiscordLogin() (discord.js) calls onDiscordSessionRestored() which will call
  // _grantOfficerAccessViaDiscord() if the session is valid and the user is an officer.
  // Defer by one tick so the inline script callbacks (onDiscordInitNoSession etc.)
  // defined at the bottom of officer.html are available before initDiscordLogin fires.
  setTimeout(function () {
    if (typeof initDiscordLogin === 'function') {
      initDiscordLogin();
    } else {
      showOfficerPrompt();
    }
  }, 0);
} else {
  // Session restored from sessionStorage (page reload) -- update Discord nav from cached session
  // without waiting for server validation, so the button reflects the logged-in state immediately.
  if (typeof renderDiscordNav === 'function' && typeof getDiscordSession === 'function') {
    renderDiscordNav(getDiscordSession());
  }
  loadData(
    function () {
      buildOfficerDashboard();
      // Check Discord session for isAdmin
      if (typeof showAdminTab === 'function') {
        var ds = typeof getDiscordSession === 'function' ? getDiscordSession() : null;
        // No Discord session means password login -- show the full Admin tab.
        showAdminTab(ds ? adminAccessLevel(ds) : true);
      }
      document.getElementById('officerViewWrap').classList.add('active');
      document.getElementById('loadingMsg').style.display = 'none';
    },
    function () {
      buildStatsBar();
      buildRosterTable();
      updateUnmanagedBadge();
      reopenSelectedPlayer();
    }
  );
}
