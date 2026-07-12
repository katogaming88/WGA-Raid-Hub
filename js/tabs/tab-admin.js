// ── Admin subtab management ───────────────────────────────────────────────

var ADMIN_SUBTABS = ['properties', 'export', 'officers', 'features', 'danger'];

// Which sub-tabs each access level may see (#317, honoring the RLS split from
// #294). true (site admins, and the legacy password login) sees everything;
// 'team_leader' sees the surfaces backed by the three team-leader-only tables
// (team_settings, team_members, season_snapshots) but not Data Export; any
// other value sees nothing. showAdminTab (officer.html) applies this map to
// the sub-tab buttons; buildAdminTab uses it to pick the landing sub-tab.
function adminSubTabVisibility(access) {
  var vis = {};
  ADMIN_SUBTABS.forEach(function (sub) {
    if (access === true) vis[sub] = true;
    else if (access === 'team_leader') vis[sub] = sub !== 'export';
    else vis[sub] = false;
  });
  return vis;
}

function buildAdminTab() {
  var vis = adminSubTabVisibility(window._adminAccessLevel);
  var defaultSub =
    ADMIN_SUBTABS.filter(function (sub) {
      return vis[sub];
    })[0] || 'properties';
  switchAdminSubTab(defaultSub, document.getElementById('admin-subtab-btn-' + defaultSub));
}

function switchAdminSubTab(name, btnEl) {
  document.querySelectorAll('[id^="admin-subtab-btn-"]').forEach(function (b) {
    b.classList.remove('active');
  });
  if (btnEl) btnEl.classList.add('active');
  ADMIN_SUBTABS.forEach(function (sub) {
    var el = document.getElementById('admin-sub-' + sub);
    if (el) el.style.display = sub === name ? '' : 'none';
  });
  if (name === 'properties') loadAdminProperties();
  if (name === 'officers') renderOfficerManagement();
  if (name === 'features') renderAdminFeatureFlags();
  if (name === 'danger') renderDangerZone();
}

// ── Properties Inspector ──────────────────────────────────────────────────

function loadAdminProperties() {
  var content = document.getElementById('adminPropsContent');

  var rows = [
    ['Season Name', (DATA && DATA.seasonName) || '(not set)'],
    ['Season Start', (DATA && DATA.seasonStart) || '(not set)'],
    ['Season End', (DATA && DATA.seasonEnd) || '(not set)'],
    ['Archived Seasons', ((DATA && DATA.seasonHistory) || []).length + ' season(s)'],
    ['Raid Progression', ((DATA && DATA.raidProgression) || []).length + ' raid(s)'],
    ['Signups Open', DATA && DATA.signupsOpen ? 'Yes' : 'No'],
    ['BiS Submissions Open', DATA && DATA.bisSubmissionsOpen ? 'Yes' : 'No'],
    ['M+ Exclusions Open', DATA && DATA.mPlusExclusionsOpen ? 'Yes' : 'No']
  ];
  var html = '<table class="admin-props-table">';
  rows.forEach(function (r) {
    html += '<tr><td class="admin-prop-key">' + r[0] + '</td><td class="admin-prop-val">' + r[1] + '</td></tr>';
  });
  html += '</table>';
  if (content) content.innerHTML = html;
}

// ── Data Export ───────────────────────────────────────────────────────────

function downloadExport() {
  var btn = document.getElementById('adminExportBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Preparing...';
  }
  try {
    var payload = {
      exportedAt: new Date().toISOString(),
      team: TEAM_NAME,
      version: VERSION,
      data: DATA
    };
    var json = JSON.stringify(payload, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = TEAM_SLUG + '-export-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Download JSON';
    }
  }
}

// ── Danger Zone ───────────────────────────────────────────────────────────

var DANGER_OPS = [
  {
    key: 'clearSeasonHistory',
    label: 'Clear Season History',
    desc: "Permanently deletes all archived seasons from this team's settings.",
    // Supabase-native (#423): since #221 archived seasons live in
    // team_settings.config.seasonHistory, not GAS Script Properties. This op
    // used to call the GAS dangerClearSeasonHistory action, which cleared the
    // old store and left the canonical one untouched -- reporting success while
    // the archived seasons survived. Handled by the op.supabase branch in
    // executeDangerOp() instead of the GAS sheet path below.
    supabase: true,
    // The one team-leader-scoped danger op (the #294 decision); the sheet wipes
    // below stay site-admin only.
    teamLeader: true
  },
  {
    key: 'clearLootData',
    label: 'Clear Loot Data Sheet',
    desc: 'Wipes all imported RCLootCouncil loot entries from the Loot Data sheet.',
    action: 'dangerClearSheet',
    sheet: 'Loot Data'
  },
  {
    key: 'clearPastedLoot',
    label: 'Clear Pasted Loot Sheet',
    desc: 'Wipes all rows from the Pasted Loot sheet.',
    action: 'dangerClearSheet',
    sheet: 'Pasted Loot'
  },
  {
    key: 'clearBisSubs',
    label: 'Clear BiS Submissions',
    desc: 'Wipes all rows from the BiS Responses sheet.',
    action: 'dangerClearSheet',
    sheet: 'BiS Responses'
  },
  {
    key: 'clearSignups',
    label: 'Clear Signups',
    desc: 'Wipes all rows from the Roster Responses (signup applications) sheet.',
    action: 'dangerClearSheet',
    sheet: 'Roster Responses'
  },
  {
    key: 'clearMplus',
    label: 'Clear M+ Exclusion Requests',
    desc: 'Wipes all rows from the M+ Exclusion Requests sheet.',
    action: 'dangerClearSheet',
    sheet: 'M+ Exclusion Requests'
  },
  {
    key: 'clearPending',
    label: 'Clear Pending Roster',
    desc: 'Wipes all rows from the Pending Roster sheet.',
    action: 'dangerClearSheet',
    sheet: 'Pending Roster'
  },
  {
    key: 'clearSelfReceived',
    label: 'Clear Self-Received',
    desc: 'Wipes all rows from the Self Received Requests sheet.',
    action: 'dangerClearSheet',
    sheet: 'Self Received Requests'
  }
];

// Danger ops visible at a given access level: site admins (and the legacy
// password login) see all of them, team leaders only the ops flagged
// teamLeader (#317).
function visibleDangerOps(access) {
  if (access === true) return DANGER_OPS;
  return DANGER_OPS.filter(function (op) {
    return op.teamLeader;
  });
}

function renderDangerZone() {
  var content = document.getElementById('adminDangerContent');
  if (!content) return;
  var html =
    '<p style="font-size:0.88rem;color:var(--melee);margin-bottom:1rem;">' +
    'These operations are permanent and cannot be undone. Type <strong>' +
    TEAM_NAME +
    '</strong> to confirm each action.' +
    '</p>';
  visibleDangerOps(window._adminAccessLevel).forEach(function (op) {
    html += '<div class="admin-danger-card">';
    html += '<div class="admin-danger-label">' + op.label + '</div>';
    html += '<p class="admin-danger-desc">' + op.desc + '</p>';
    html += '<div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">';
    html +=
      '<input type="text" class="add-player-input" id="danger-confirm-' +
      op.key +
      '"' +
      ' placeholder="Type team name to confirm" style="max-width:240px;font-size:0.88rem;">';
    html +=
      '<button class="btn btn-danger" id="danger-btn-' +
      op.key +
      '"' +
      ' onclick="executeDangerOp(\'' +
      op.key +
      '\')">' +
      op.label +
      '</button>';
    html += '<span id="danger-status-' + op.key + '" style="font-size:0.85rem;"></span>';
    html += '</div></div>';
  });
  content.innerHTML = html;
}

function executeDangerOp(key) {
  var op = null;
  for (var i = 0; i < DANGER_OPS.length; i++) {
    if (DANGER_OPS[i].key === key) {
      op = DANGER_OPS[i];
      break;
    }
  }
  if (!op) return;
  // Keep execute consistent with what renderDangerZone showed. Not a security
  // boundary: the GAS endpoint is unauthenticated by design, and the real
  // enforcement is RLS on the Supabase-backed surfaces.
  if (window._adminAccessLevel !== true && !op.teamLeader) return;

  var input = document.getElementById('danger-confirm-' + key);
  var btn = document.getElementById('danger-btn-' + key);
  var status = document.getElementById('danger-status-' + key);

  if (!input || input.value.trim() !== TEAM_NAME) {
    if (status) {
      status.style.color = 'var(--melee)';
      status.textContent = 'Team name does not match.';
      setTimeout(function () {
        if (status) {
          status.textContent = '';
        }
      }, 2500);
    }
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Working...';
  }

  function finish(err, ok) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = op.label;
    }
    if (!err && ok) {
      if (input) input.value = '';
      if (status) {
        status.style.color = 'var(--heal)';
        status.textContent = 'Done.';
        setTimeout(function () {
          if (status) status.textContent = '';
        }, 3000);
      }
    } else {
      if (status) {
        status.style.color = 'var(--melee)';
        status.textContent = err ? err.message : 'Error.';
      }
    }
  }

  // Season history clears the canonical Supabase store directly (#423); the
  // sheet-wipe ops stay on GAS until Apps Script is retired (#225).
  if (op.supabase) {
    clearSeasonHistorySupabase(finish);
    return;
  }

  var url = WEB_APP_URL + '?action=' + encodeURIComponent(op.action);
  if (op.sheet) url += '&sheet=' + encodeURIComponent(op.sheet);

  jsonpRequest(url, function (err, result) {
    finish(err, result && result.success);
  });
}

// Clears team_settings.config.seasonHistory via the same set_team_setting RPC
// the Season Settings tab writes through (#221), so the "Archived Seasons"
// count and the Season tab's history list both reflect it without a reload.
// season_snapshots is intentionally untouched: nothing writes it (archive
// stores its roster snapshot inline on the seasonHistory entry), so it holds no
// archived-season data to clear.
function clearSeasonHistorySupabase(finish) {
  saveTeamSetting({ seasonHistory: [] })
    .then(function (config) {
      if (DATA) DATA.seasonHistory = (config && config.seasonHistory) || [];
      if (typeof buildSeasonTab === 'function') buildSeasonTab();
      loadAdminProperties();
      return writeAuditLog('Season History Cleared', null, null, null);
    })
    .then(function () {
      finish(null, true);
    })
    .catch(function (err) {
      finish(err);
    });
}

// ── Officer Management ────────────────────────────────────────────────────────

function renderOfficerManagement() {
  var el = document.getElementById('adminOfficersContent');
  if (!el || !supabaseClient) return;
  el.innerHTML = '<p style="color:var(--text-muted);font-size:0.9rem;">Loading...</p>';
  fetchTeamClaims().then(function (claims) {
    // Team leaders are a distinct top tier managed outside this picker; only
    // plain officers are promotable/revocable here (matches the old flat
    // officerDiscordIds toggle this replaces).
    var officerClaims = claims.filter(function (c) {
      return c.role === 'officer';
    });
    var nonOfficerClaims = claims.filter(function (c) {
      return c.role !== 'officer' && c.role !== 'team_leader';
    });

    var rows = officerClaims
      .map(function (c) {
        var jsonId = JSON.stringify(c.teamMemberId);
        var jsonNr = JSON.stringify(c.nameRealm).replace(/"/g, '&quot;');
        var btn =
          '<button class="btn btn-muted" style="padding:0.2rem 0.6rem;font-size:0.75rem;" onclick="revokeOfficer(' +
          jsonId +
          ',' +
          jsonNr +
          ')">Revoke</button>';
        return (
          '<tr>' +
          '<td style="width:75%">' +
          escHtml(c.nameRealm) +
          '</td>' +
          '<td style="width:25%;text-align:right">' +
          btn +
          '</td>' +
          '</tr>'
        );
      })
      .join('');

    var table = rows
      ? '<table class="loot-table" style="width:100%;table-layout:fixed;margin-bottom:1rem;">' +
        '<thead><tr><th style="width:75%;text-align:left">Character</th><th style="width:25%"></th></tr></thead>' +
        '<tbody>' +
        rows +
        '</tbody></table>'
      : '<p style="color:var(--text-muted);font-size:0.9rem;margin-bottom:1rem;">No officers yet.</p>';

    // Promote a claimed character to officer
    var options = nonOfficerClaims
      .map(function (c) {
        return '<option value="' + escHtml(String(c.teamMemberId)) + '">' + escHtml(c.nameRealm) + '</option>';
      })
      .join('');

    var promote = options
      ? '<div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">' +
        '<select id="promoteOfficerSelect" class="roster-search-input" style="width:280px;">' +
        '<option value="">Select a claimed character...</option>' +
        options +
        '</select>' +
        '<button class="btn" onclick="grantOfficerFromPicker()" style="padding:0.3rem 0.75rem;font-size:0.85rem;">Grant Officer</button>' +
        '<span id="manualOfficerStatus" style="font-size:0.85rem;"></span>' +
        '</div>'
      : '<p style="color:var(--text-muted);font-size:0.9rem;">No claimed characters left to promote.</p>';

    el.innerHTML =
      table +
      '<p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:0.5rem;">Promote a claimed character to officer:</p>' +
      promote;
  });
}

function grantOfficerFromPicker() {
  var selectEl = document.getElementById('promoteOfficerSelect');
  var stEl = document.getElementById('manualOfficerStatus');
  var teamMemberId = selectEl ? selectEl.value : '';
  if (!teamMemberId) {
    if (stEl) {
      stEl.style.color = 'var(--melee)';
      stEl.textContent = 'Select a claimed character first.';
    }
    return;
  }
  if (stEl) {
    stEl.style.color = 'var(--text-muted)';
    stEl.textContent = 'Saving...';
  }
  grantOfficer(teamMemberId);
}

function grantOfficer(teamMemberId) {
  supabaseClient
    .from('team_members')
    .update({ role: 'officer' })
    .eq('id', teamMemberId)
    .then(function (result) {
      if (result.error) {
        alert('Failed: ' + result.error.message);
        return;
      }
      renderOfficerManagement();
      if (typeof renderDiscordClaims === 'function') renderDiscordClaims();
    });
}

function revokeOfficer(teamMemberId, nameRealm) {
  if (!confirm('Revoke officer access for ' + (nameRealm || teamMemberId) + '?')) return;
  supabaseClient
    .from('team_members')
    .update({ role: 'raider' })
    .eq('id', teamMemberId)
    .then(function (result) {
      if (result.error) {
        alert('Failed: ' + result.error.message);
        return;
      }
      renderOfficerManagement();
      if (typeof renderDiscordClaims === 'function') renderDiscordClaims();
    });
}

// ── Feature Flags (#231) ──────────────────────────────────────────────────
// Team-leader/site-admin self-serve version of the same toggle list
// js/admin.js's site-admin dashboard has, scoped to this team only. Both
// write through the same saveTeamSetting({features: {...}}) path
// (set_team_setting RPC), whose RLS already accepts a team_leader or site
// admin -- no new write path needed here either.
var ADMIN_FEATURE_FLAGS = [
  { key: 'loot', label: 'Loot Import & Tracking' },
  { key: 'priority', label: 'Priority Order' },
  { key: 'bis', label: 'BiS Lists' },
  { key: 'scoring', label: 'Scoring' },
  { key: 'mplus', label: 'M+ Exclusions' },
  { key: 'fairness', label: 'Fairness Charts' },
  { key: 'bench', label: 'Bench Management' }
];

function renderAdminFeatureFlags() {
  var el = document.getElementById('adminFeatureFlagsContent');
  if (!el) return;
  el.innerHTML = ADMIN_FEATURE_FLAGS.map(function (f) {
    var checked = featureEnabled(f.key);
    return (
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--border);">' +
      '<span>' +
      escHtml(f.label) +
      '</span>' +
      '<input type="checkbox" style="width:1.1rem;height:1.1rem;accent-color:var(--gold);cursor:pointer;" ' +
      (checked ? 'checked' : '') +
      ' onchange="toggleAdminFeatureFlag(\'' +
      f.key +
      '\',this.checked)">' +
      '</div>'
    );
  }).join('');
}

function toggleAdminFeatureFlag(key, enabled) {
  var features = {};
  ADMIN_FEATURE_FLAGS.forEach(function (f) {
    features[f.key] = featureEnabled(f.key);
  });
  features[key] = enabled;

  saveTeamSetting({ features: features })
    .then(function (config) {
      DATA.features = config.features || {};
      applyFeatureFlagVisibility();
    })
    .catch(function (err) {
      alert(err.message);
      renderAdminFeatureFlags(); // revert the checkbox to last-known state
    });
}
