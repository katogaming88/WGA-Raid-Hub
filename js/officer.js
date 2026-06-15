var OFFICER_PASS          = 'phoenix2';
var selectedOfficerPlayer = null;
var activeFilters         = {};
var activeSort            = { key: null, dir: 1 };

function showView(name) {
  document.getElementById('loadingMsg').style.display = 'none';
  if (name === 'officer') document.getElementById('officerViewWrap').classList.add('active');
}

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
    hideOfficerPrompt();
    buildOfficerDashboard();
    showView('officer');
  } else {
    document.getElementById('officerError').style.display = '';
  }
}

function officerLogout() {
  sessionStorage.removeItem('phoenix_officer');
  window.location.href = 'index.html';
}

function buildOfficerDashboard() {
  buildStatsBar();
  buildRosterTable();
  renderSignupToggle();
  renderBisToggle();
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

// Boot: require password before showing any content
loadData(function() {
  if (sessionStorage.getItem('phoenix_officer') !== '1') {
    showOfficerPrompt();
    return;
  }
  buildOfficerDashboard();
  document.getElementById('officerViewWrap').classList.add('active');
  document.getElementById('loadingMsg').style.display = 'none';
});
