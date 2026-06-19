var OFFICER_PASS          = 'phoenix2';
var SESSION_DURATION_MS   = 2 * 60 * 60 * 1000; // 2 hours
var selectedOfficerPlayer = null;
var activeFilters         = {};
var activeSort            = { key: null, dir: 1 };

function toggleHelp(id) {
  var el = document.getElementById(id);
  if (el) el.classList.toggle('open');
}

function showView(name) {
  document.getElementById('loadingMsg').style.display = 'none';
  if (name === 'officer') document.getElementById('officerViewWrap').classList.add('active');
}

function switchTab(name) {
  document.querySelectorAll('.nav-item').forEach(function(b) { b.classList.remove('active'); });
  document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
  event.target.classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
  if (name === 'loot')       { resetLootSubTab(); buildConflicts(); }
  if (name === 'attendance') buildAttendanceTab();
  if (name === 'priority')   { resetPrioritySubTab(); buildPriorityTab(); }
  if (name === 'signups')    { resetSignupsSubTab(); buildSignupsTab(); }
  if (name === 'requests')   buildRequestsTab();
  if (name === 'bis')        buildBisTab();
  if (name === 'mplus')      buildMPlusTab();
  if (name === 'audit')      buildAuditTab();
  if (name === 'season')     buildSeasonTab();
}

function resetSignupsSubTab() {
  document.querySelectorAll('[id^="signups-subtab-btn-"]').forEach(function(b) { b.classList.remove('active'); });
  var defaultBtn = document.getElementById('signups-subtab-btn-signups');
  if (defaultBtn) defaultBtn.classList.add('active');
  var subSignups  = document.getElementById('signups-sub-signups');
  var subPending  = document.getElementById('signups-sub-pendingRoster');
  if (subSignups) subSignups.style.display = '';
  if (subPending) subPending.style.display = 'none';
}

function switchSignupsSubTab(name, btnEl) {
  document.querySelectorAll('[id^="signups-subtab-btn-"]').forEach(function(b) { b.classList.remove('active'); });
  if (btnEl) btnEl.classList.add('active');
  var subSignups = document.getElementById('signups-sub-signups');
  var subPending = document.getElementById('signups-sub-pendingRoster');
  if (subSignups) subSignups.style.display = name === 'signups'       ? '' : 'none';
  if (subPending) subPending.style.display = name === 'pendingRoster' ? '' : 'none';
  if (name === 'signups')       buildSignupsTab();
  if (name === 'pendingRoster') buildPendingRosterTab();
}

function resetPrioritySubTab() {
  document.querySelectorAll('[id^="prio-subtab-btn-"]').forEach(function(b) { b.classList.remove('active'); });
  var defaultBtn = document.getElementById('prio-subtab-btn-list');
  if (defaultBtn) defaultBtn.classList.add('active');
  var subList      = document.getElementById('prio-sub-list');
  var subUnmanaged = document.getElementById('prio-sub-unmanaged');
  if (subList)      subList.style.display      = '';
  if (subUnmanaged) subUnmanaged.style.display = 'none';
}

function switchPrioritySubTab(name, btnEl) {
  document.querySelectorAll('[id^="prio-subtab-btn-"]').forEach(function(b) { b.classList.remove('active'); });
  if (btnEl) btnEl.classList.add('active');
  var subList      = document.getElementById('prio-sub-list');
  var subUnmanaged = document.getElementById('prio-sub-unmanaged');
  if (subList)      subList.style.display      = name === 'list'      ? '' : 'none';
  if (subUnmanaged) subUnmanaged.style.display = name === 'unmanaged' ? '' : 'none';
  if (name === 'list')      buildPriorityTab();
  if (name === 'unmanaged') buildUnmanagedTab();
}

function resetLootSubTab() {
  document.querySelectorAll('[id^="loot-subtab-btn-"]').forEach(function(b) { b.classList.remove('active'); });
  var defaultBtn = document.getElementById('loot-subtab-btn-import');
  if (defaultBtn) defaultBtn.classList.add('active');
  var subConflicts = document.getElementById('loot-sub-conflicts');
  var subFairness  = document.getElementById('loot-sub-fairness');
  var subImport    = document.getElementById('loot-sub-import');
  var subHistory   = document.getElementById('loot-sub-history');
  if (subConflicts) subConflicts.style.display = 'none';
  if (subFairness)  subFairness.style.display  = 'none';
  if (subImport)    subImport.style.display     = '';
  if (subHistory)   subHistory.style.display    = 'none';
  buildLootImportForm();
}

function switchLootSubTab(name, btnEl) {
  document.querySelectorAll('[id^="loot-subtab-btn-"]').forEach(function(b) { b.classList.remove('active'); });
  if (btnEl) btnEl.classList.add('active');
  var subConflicts = document.getElementById('loot-sub-conflicts');
  var subFairness  = document.getElementById('loot-sub-fairness');
  var subImport    = document.getElementById('loot-sub-import');
  var subHistory   = document.getElementById('loot-sub-history');
  if (subConflicts) subConflicts.style.display = name === 'conflicts' ? '' : 'none';
  if (subFairness)  subFairness.style.display  = name === 'fairness'  ? '' : 'none';
  if (subImport)    subImport.style.display     = name === 'import'    ? '' : 'none';
  if (subHistory)   subHistory.style.display    = name === 'history'   ? '' : 'none';
  if (name === 'conflicts') buildConflicts();
  if (name === 'fairness')  buildFairness();
  if (name === 'import')    buildLootImportForm();
  if (name === 'history')   buildLootHistoryTab();
}

function showOfficerPrompt() {
  document.getElementById('officerPassword').value = '';
  document.getElementById('officerError').style.display = 'none';
  document.getElementById('officerPrompt').classList.add('active');
  setTimeout(function() { document.getElementById('officerPassword').focus(); }, 50);
}

function hideOfficerPrompt() {
  document.getElementById('officerPrompt').classList.remove('active');
}

function submitOfficerPassword() {
  if (document.getElementById('officerPassword').value === OFFICER_PASS) {
    sessionStorage.setItem('phoenix_officer', '1');
    sessionStorage.setItem('phoenix_officer_ts', String(Date.now()));
    hideOfficerPrompt();
    document.getElementById('loadingMsg').style.display = '';
    loadData(
      function() {
        buildOfficerDashboard();
        document.getElementById('officerViewWrap').classList.add('active');
        document.getElementById('loadingMsg').style.display = 'none';
      },
      function() {
        buildStatsBar();
        buildRosterTable();
      }
    );
  } else {
    document.getElementById('officerError').style.display = '';
  }
}

function officerLogout() {
  sessionStorage.removeItem('phoenix_officer');
  sessionStorage.removeItem('phoenix_officer_ts');
  window.location.href = 'index.html';
}

function isOfficerSessionValid() {
  if (sessionStorage.getItem('phoenix_officer') !== '1') return false;
  var ts = parseInt(sessionStorage.getItem('phoenix_officer_ts') || '0', 10);
  return ts > 0 && (Date.now() - ts) < SESSION_DURATION_MS;
}

function setNavBadge(id, count) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = count;
  el.style.display = count > 0 ? '' : 'none';
}

function updateNavBadges() {
  var cbName = '_getPendingCountsCb';
  window[cbName] = function(result) {
    delete window[cbName];
    setNavBadge('signupsNavBadge', (result.signups || 0) + (result.pendingRoster || 0));
    setNavBadge('pendingRosterSubBadge', result.pendingRoster || 0);
    setNavBadge('bisNavBadge', result.bis || 0);
    setNavBadge('mplusNavBadge', result.mplus || 0);
    setNavBadge('requestsNavBadge', result.requests || 0);
  };
  var script = document.createElement('script');
  script.onerror = function() { delete window[cbName]; };
  script.src = WEB_APP_URL + '?action=getPendingCounts&callback=' + cbName;
  document.head.appendChild(script);
}

function buildOfficerDashboard() {
  buildStatsBar();
  buildRosterTable();
  buildTrialPromoAlert();
  renderSignupToggle();
  renderBisToggle();
  renderMPlusToggle();
  updateUnmanagedBadge();
  updateNavBadges();
  if (DATA._loadedAt) {
    var t  = DATA._loadedAt;
    var h  = t.getHours(), m = t.getMinutes();
    var ts = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    var el = document.getElementById('dataTimestamp');
    if (el) el.textContent = 'Data as of ' + ts;
  }
}

function clearCache() {
  var btn = document.getElementById('clearCacheBtn');
  btn.disabled = true;
  btn.textContent = 'Clearing...';

  var cbName = '_clearCacheCallback';
  window[cbName] = function(data) {
    delete window[cbName];
    btn.textContent = data && data.success ? 'Cleared!' : 'Error';
    setTimeout(function() { btn.textContent = 'Clear Cache'; btn.disabled = false; }, 2000);
  };

  var script = document.createElement('script');
  script.src = WEB_APP_URL + '?action=clearCache&callback=' + cbName;
  script.onerror = function() {
    delete window[cbName];
    btn.textContent = 'Error';
    setTimeout(function() { btn.textContent = 'Clear Cache'; btn.disabled = false; }, 2000);
  };
  document.head.appendChild(script);
}

// Boot: require password before loading any data; clear expired sessions
if (!isOfficerSessionValid()) {
  sessionStorage.removeItem('phoenix_officer');
  sessionStorage.removeItem('phoenix_officer_ts');
  document.getElementById('loadingMsg').style.display = 'none';
  showOfficerPrompt();
} else {
  loadData(
    function() {
      buildOfficerDashboard();
      document.getElementById('officerViewWrap').classList.add('active');
      document.getElementById('loadingMsg').style.display = 'none';
    },
    function() {
      buildStatsBar();
      buildRosterTable();
      updateUnmanagedBadge();
    }
  );
}
