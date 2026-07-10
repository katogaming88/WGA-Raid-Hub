var _pendingRosterEntries = [];
var _pendingMissingSignups = [];
var _pendingFilterRole = null;
var _pendingSwapOnly = false;
var _pendingSortKey = 'name';

// Map of nameRealm.toLowerCase() -> current roster player, for diff/conflict checks.
function buildPendingRosterMap() {
  var map = {};
  var roster = (window.DATA && DATA.roster) || [];
  roster.forEach(function (p) {
    if (p.nameRealm) map[p.nameRealm.toLowerCase()] = p;
  });
  return map;
}

// Maps a pending_roster view row to the shape the render functions expect.
function mapPendingRosterRow(row) {
  return {
    signupId: row.signup_id,
    nameRealm: row.signup_name_realm,
    className: row.class || '',
    mainSpec: row.spec || '',
    role: row.role || '',
    offSpecs: row.off_specs || '',
    mainSwap: !!row.main_swap,
    notes: row.player_note || '',
    officerNote: row.signup_officer_note || '',
    season: row.season || ''
  };
}

function buildPendingRosterTab() {
  var container = document.getElementById('pendingRosterContainer');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">Loading...</p>';

  var loaded = { entries: false, missing: false };
  _pendingRosterEntries = [];
  _pendingMissingSignups = [];

  function tryRender() {
    if (!loaded.entries || !loaded.missing) return;
    renderPendingRoster(_pendingRosterEntries, _pendingMissingSignups);
  }

  if (!supabaseClient) {
    _pendingRosterEntries = [];
    loaded.entries = true;
    tryRender();
  } else {
    supabaseClient
      .from('pending_roster')
      .select('*')
      .eq('team_id', _teamCfg.supabaseTeamId)
      .then(function (result) {
        _pendingRosterEntries = result.error ? [] : (result.data || []).map(mapPendingRosterRow);
        loaded.entries = true;
        tryRender();
      });
  }

  jsonpRequest(WEB_APP_URL + '?action=getMissingSignups', function (err, result) {
    _pendingMissingSignups = err ? [] : result.missing || [];
    loaded.missing = true;
    tryRender();
  });
}

function renderPendingRoster(entries, missing) {
  var container = document.getElementById('pendingRosterContainer');
  if (!container) return;

  var rosterMap = buildPendingRosterMap();
  var html = '<div style="margin-top:1.5rem;">';

  html += buildPendingStatsHtml(entries);
  html += buildMissingSignupsHtml(missing);

  if (entries.length) {
    var coverage = computeBuffCoverage(entries, 'className', 'mainSpec', 'nameRealm');
    html += buildPendingBuffCoverageHtml(coverage);
  }

  if (!entries.length) {
    html +=
      '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No approved signups in the pending roster.</p>';
  } else {
    html += buildPendingControlsHtml();
    var visible = getFilteredSortedPendingEntries(entries);
    if (!visible.length) {
      html +=
        '<p style="color:var(--text-muted);font-size:1rem;margin-top:1rem;">No pending entries match the current filter.</p>';
    } else {
      visible.forEach(function (e) {
        html += buildPendingCardHtml(e, rosterMap);
      });
    }
  }

  html += '</div>';
  container.innerHTML = html;
}

// ── Filter / sort controls ────────────────────────────────────────────────────

function getFilteredSortedPendingEntries(entries) {
  var filtered = entries.filter(function (e) {
    if (_pendingFilterRole && e.role !== _pendingFilterRole) return false;
    if (_pendingSwapOnly && !e.mainSwap) return false;
    return true;
  });
  filtered.sort(function (a, b) {
    if (_pendingSortKey === 'class') {
      return (
        (a.className || '').localeCompare(b.className || '') || (a.nameRealm || '').localeCompare(b.nameRealm || '')
      );
    }
    return (a.nameRealm || '').localeCompare(b.nameRealm || '');
  });
  return filtered;
}

function buildPendingControlsHtml() {
  var roles = ['Tank', 'Heal', 'Melee', 'Ranged'];
  var roleColors = { Tank: 'var(--tank)', Heal: 'var(--heal)', Melee: 'var(--melee)', Ranged: 'var(--ranged)' };

  function chip(active, color, label, onclick) {
    return (
      '<button onclick="' +
      onclick +
      '" style="cursor:pointer;font-size:0.82rem;padding:0.2rem 0.65rem;border-radius:4px;' +
      'border:1px solid ' +
      (active ? color : 'var(--border)') +
      ';background:' +
      (active ? color : 'var(--bg)') +
      ';color:' +
      (active ? 'var(--bg)' : 'var(--text-muted)') +
      ';font-weight:600;">' +
      label +
      '</button>'
    );
  }

  var roleChips = roles
    .map(function (r) {
      return chip(_pendingFilterRole === r, roleColors[r], r, "setPendingFilterRole('" + r + "')");
    })
    .join('');

  var swapChip = chip(_pendingSwapOnly, 'var(--gold-light)', 'Main Swap Only', 'togglePendingSwapOnly()');

  var sortChip = chip(
    _pendingSortKey === 'class',
    'var(--text)',
    'Sort: ' + (_pendingSortKey === 'class' ? 'Class' : 'Name'),
    'togglePendingSortKey()'
  );

  return (
    '<div style="display:flex;flex-wrap:wrap;gap:0.4rem;align-items:center;margin-bottom:1rem;">' +
    roleChips +
    swapChip +
    '<span style="flex:1;"></span>' +
    sortChip +
    '</div>'
  );
}

function setPendingFilterRole(role) {
  _pendingFilterRole = _pendingFilterRole === role ? null : role;
  renderPendingRoster(_pendingRosterEntries, _pendingMissingSignups);
}

function togglePendingSwapOnly() {
  _pendingSwapOnly = !_pendingSwapOnly;
  renderPendingRoster(_pendingRosterEntries, _pendingMissingSignups);
}

function togglePendingSortKey() {
  _pendingSortKey = _pendingSortKey === 'class' ? 'name' : 'class';
  renderPendingRoster(_pendingRosterEntries, _pendingMissingSignups);
}

// ── Stats panel ──────────────────────────────────────────────────────────────

function buildPendingStatsHtml(entries) {
  var roles = { Tank: 0, Heal: 0, Melee: 0, Ranged: 0 };
  entries.forEach(function (e) {
    if (roles[e.role] !== undefined) roles[e.role]++;
  });

  var roleColors = { Tank: 'var(--tank)', Heal: 'var(--heal)', Melee: 'var(--melee)', Ranged: 'var(--ranged)' };
  var rolePills = Object.keys(roles)
    .map(function (r) {
      return (
        '<span style="display:inline-flex;align-items:center;gap:0.3rem;background:var(--bg-alt);' +
        'border:1px solid var(--border);border-radius:4px;padding:0.2rem 0.6rem;font-size:0.85rem;">' +
        '<span style="color:' +
        roleColors[r] +
        ';font-weight:700;">' +
        r +
        '</span>' +
        '<span style="color:var(--text);font-weight:600;">' +
        roles[r] +
        '</span>' +
        '</span>'
      );
    })
    .join('');

  return (
    '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-bottom:1.25rem;">' +
    '<span style="font-size:0.85rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;' +
    'letter-spacing:0.12em;margin-right:0.25rem;">' +
    entries.length +
    ' Pending</span>' +
    rolePills +
    '</div>'
  );
}

// ── Missing signups section ──────────────────────────────────────────────────

function buildMissingSignupsHtml(missing) {
  var collapsed = missing.length > 0;
  var collapseId = 'pendingMissingCollapse';

  var headerColor = missing.length ? 'var(--melee)' : 'var(--text-muted)';
  var icon = missing.length ? '&#9660;' : '&#9654;';

  var html =
    '<div style="margin-bottom:1.25rem;border:1px solid var(--border);border-radius:6px;overflow:hidden;">' +
    '<div onclick="toggleMissingSignups()" style="cursor:pointer;display:flex;align-items:center;' +
    'justify-content:space-between;padding:0.6rem 0.85rem;background:var(--bg-alt);">' +
    '<span style="font-size:0.85rem;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;color:' +
    headerColor +
    ';">Missing Signups (' +
    missing.length +
    ')</span>' +
    '<span id="pendingMissingIcon" style="font-size:0.8rem;color:var(--text-muted);">' +
    icon +
    '</span>' +
    '</div>' +
    '<div id="' +
    collapseId +
    '" style="display:' +
    (collapsed ? 'block' : 'none') +
    ';padding:0.75rem 0.85rem;">';

  if (!missing.length) {
    html +=
      '<p style="color:var(--text-muted);font-size:0.9rem;margin:0;">All roster members have submitted a signup.</p>';
  } else {
    var byRole = { Tank: [], Heal: [], Melee: [], Ranged: [] };
    missing.forEach(function (p) {
      var r = p.role || 'Melee';
      if (!byRole[r]) byRole[r] = [];
      byRole[r].push(p);
    });
    var roleColors = { Tank: 'var(--tank)', Heal: 'var(--heal)', Melee: 'var(--melee)', Ranged: 'var(--ranged)' };
    Object.keys(byRole).forEach(function (role) {
      if (!byRole[role].length) return;
      html +=
        '<div style="margin-bottom:0.5rem;">' +
        '<span style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.1em;color:' +
        roleColors[role] +
        ';font-weight:700;">' +
        role +
        ' (' +
        byRole[role].length +
        ')</span>' +
        '<div style="margin-top:0.25rem;display:flex;flex-wrap:wrap;gap:0.35rem;">';
      byRole[role].forEach(function (p) {
        var clsColor = classColor(p.className);
        html +=
          '<span style="font-size:0.82rem;background:var(--bg);border:1px solid var(--border);' +
          'border-radius:4px;padding:0.15rem 0.5rem;color:' +
          clsColor +
          ';">' +
          (p.nameRealm ? p.nameRealm.split('-')[0] : p.nameRealm) +
          '<span style="color:var(--text-muted);font-weight:400;"> (' +
          (p.spec || p.className || '') +
          ')</span>' +
          '</span>';
      });
      html += '</div></div>';
    });
  }

  html += '</div></div>';
  return html;
}

function toggleMissingSignups() {
  var panel = document.getElementById('pendingMissingCollapse');
  var icon = document.getElementById('pendingMissingIcon');
  if (!panel) return;
  var visible = panel.style.display !== 'none';
  panel.style.display = visible ? 'none' : 'block';
  if (icon) icon.innerHTML = visible ? '&#9654;' : '&#9660;';
}

// ── Buff / debuff coverage panel ─────────────────────────────────────────────

function buildPendingBuffCoverageHtml(coverage) {
  var sections = [
    { label: 'Raid Buffs', buffs: RAID_BUFFS },
    { label: 'Boss Debuffs', buffs: BOSS_DEBUFFS },
    { label: 'Utility', buffs: RAID_UTILITY }
  ];

  var bodyHtml = '';
  sections.forEach(function (sec) {
    bodyHtml +=
      '<div style="margin-bottom:0.6rem;">' +
      '<span style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.1em;' +
      'color:var(--text-muted);font-weight:700;display:block;margin-bottom:0.35rem;">' +
      sec.label +
      '</span>' +
      '<div style="display:flex;flex-wrap:wrap;gap:0.3rem;">';
    sec.buffs.forEach(function (buff) {
      var data = coverage[buff.name] || { count: 0, providers: [] };
      var count = data.count;
      var indicator, color;
      if (count >= 2) {
        indicator = '&#10003;';
        color = 'var(--heal)';
      } else if (count === 1) {
        indicator = '!';
        color = 'var(--gold-light)';
      } else {
        indicator = '&#10007;';
        color = 'var(--melee)';
      }
      var nameColor = buff.classes.length === 1 ? classColor(buff.classes[0]) : 'var(--text)';
      var titleAttr = data.providers.length ? ' title="' + data.providers.join(', ') + '"' : '';
      bodyHtml +=
        '<span' +
        titleAttr +
        ' style="display:inline-flex;align-items:center;gap:0.3rem;' +
        'background:var(--bg);border:1px solid var(--border);border-radius:4px;' +
        'padding:0.2rem 0.6rem;font-size:0.88rem;cursor:default;">' +
        '<span style="color:' +
        color +
        ';font-weight:700;">' +
        indicator +
        '</span>' +
        '<span style="color:' +
        nameColor +
        ';">' +
        buff.name +
        '</span>' +
        (count > 0 ? '<span style="color:' + color + ';font-weight:600;font-size:0.8rem;">' + count + '</span>' : '') +
        '</span>';
    });
    bodyHtml += '</div></div>';
  });

  return (
    '<div style="margin-bottom:1.25rem;border:1px solid var(--border);border-radius:6px;overflow:hidden;">' +
    '<div onclick="togglePendingBuffCoverage()" style="cursor:pointer;display:flex;align-items:center;' +
    'justify-content:space-between;padding:0.6rem 0.85rem;background:var(--bg-alt);">' +
    '<span style="font-size:0.85rem;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;' +
    'color:var(--text-muted);">Buff Coverage</span>' +
    '<span id="pendingBuffIcon" style="font-size:0.8rem;color:var(--text-muted);">&#9654;</span>' +
    '</div>' +
    '<div id="pendingBuffCollapse" style="display:none;padding:0.75rem 0.85rem;">' +
    bodyHtml +
    '</div>' +
    '</div>'
  );
}

function togglePendingBuffCoverage() {
  var panel = document.getElementById('pendingBuffCollapse');
  var icon = document.getElementById('pendingBuffIcon');
  if (!panel) return;
  var visible = panel.style.display !== 'none';
  panel.style.display = visible ? 'none' : 'block';
  if (icon) icon.innerHTML = visible ? '&#9654;' : '&#9660;';
}

// ── Pending entry cards ──────────────────────────────────────────────────────
//
// The old bulk "Push to Roster" area operated on Sheets row indices and pushed
// every pending entry in one GAS call; that model doesn't carry over to the
// signup_id-keyed Supabase data (#328). Each card below gets its own
// "Add to Roster" control (trial toggle + main-swap picker) that calls
// add_signup_to_roster() directly. A bulk selection UX is #273's job.

function buildPendingCardHtml(e, rosterMap) {
  rosterMap = rosterMap || {};
  var clsColor = classColor(e.className);
  var isNew = !(e.nameRealm && rosterMap[e.nameRealm.toLowerCase()]);
  var borderStyle = e.mainSwap ? 'border-left:3px solid var(--gold-light);' : '';

  var html =
    '<div class="signup-response-card" style="' +
    borderStyle +
    '" data-row="' +
    e.signupId +
    '">' +
    '<div class="signup-response-header">' +
    '<span class="signup-response-name">' +
    escHtml(e.nameRealm) +
    '</span>' +
    '<span style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;' +
    'margin-left:0.4rem;color:' +
    (isNew ? 'var(--heal)' : 'var(--text-muted)') +
    ';">' +
    (isNew ? 'New' : 'Update') +
    '</span>';

  if (e.season)
    html +=
      '<span style="font-size:0.7rem;color:var(--text-muted);background:var(--bg-alt);' +
      'border:1px solid var(--border);border-radius:3px;padding:0.1rem 0.4rem;margin-left:0.4rem;">' +
      escHtml(e.season) +
      '</span>';

  html += '</div>';
  html +=
    '<div style="font-size:1rem;color:' +
    clsColor +
    ';margin-top:0.35rem;font-weight:600;">' +
    e.className +
    ' &middot; ' +
    e.mainSpec +
    (e.offSpecs ? '<span style="color:var(--text-muted);font-weight:400;"> / ' + e.offSpecs + '</span>' : '') +
    '</div>';

  if (e.role)
    html +=
      '<div style="font-size:0.92rem;color:var(--text-muted);margin-top:0.2rem;">Role: <span style="color:var(--text);">' +
      e.role +
      '</span></div>';
  if (e.mainSwap)
    html +=
      '<div style="font-size:0.92rem;color:var(--text-muted);margin-top:0.2rem;">' +
      '<span style="color:var(--gold-light);font-weight:600;">Main swap requested</span> ' +
      '<span style="font-size:0.85rem;">-- select the old character to archive below.</span></div>';
  if (e.notes)
    html +=
      '<div style="font-size:0.9rem;color:var(--text-muted);margin-top:0.35rem;font-style:italic;">' +
      escHtml(e.notes) +
      '</div>';

  html += buildAddToRosterControlHtml(e);

  html +=
    '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
    '<button class="btn btn-danger" onclick="removePendingRosterRow(' +
    e.signupId +
    ',this)" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Remove from Pending</button>' +
    '</div>' +
    '</div>';

  return html;
}

// Per-row "Add to Roster" control: trial toggle (default checked) and, for
// main-swap signups, a picker of active roster members to archive
// (add_signup_to_roster's p_archive_player_id, team-scoped in the function).
function buildAddToRosterControlHtml(e) {
  var roster = (window.DATA && DATA.roster) || [];
  var swapPicker = '';
  if (e.mainSwap) {
    var options = roster
      .map(function (p) {
        return '<option value="' + p.id + '">' + escHtml(p.nameRealm) + '</option>';
      })
      .join('');
    swapPicker =
      '<select class="pending-swap-select" style="font-size:0.85rem;padding:0.2rem 0.4rem;' +
      'background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);margin-right:0.5rem;">' +
      '<option value="">-- character to archive --</option>' +
      options +
      '</select>';
  }

  return (
    '<div class="pending-add-roster" style="display:flex;align-items:center;flex-wrap:wrap;gap:0.5rem;' +
    'margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid var(--border);">' +
    '<label style="display:flex;align-items:center;gap:0.3rem;font-size:0.85rem;color:var(--text-muted);cursor:pointer;">' +
    '<input type="checkbox" class="pending-trial-checkbox" checked style="accent-color:var(--gold-light);">Trial' +
    '</label>' +
    swapPicker +
    '<button class="btn request-approve-btn pending-add-btn" onclick="addSignupToRoster(' +
    e.signupId +
    ',this)" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Add to Roster</button>' +
    '<span class="pending-add-error" style="color:var(--melee);font-size:0.85rem;"></span>' +
    '</div>'
  );
}

// ── Add to Roster ─────────────────────────────────────────────────────────────

function addSignupToRoster(signupId, btnEl) {
  var card = btnEl.closest('.signup-response-card');
  var trialEl = card ? card.querySelector('.pending-trial-checkbox') : null;
  var swapEl = card ? card.querySelector('.pending-swap-select') : null;
  var errEl = card ? card.querySelector('.pending-add-error') : null;

  if (swapEl && !swapEl.value) {
    if (errEl) errEl.textContent = 'Select the character to archive for this main swap.';
    return;
  }

  if (errEl) errEl.textContent = '';
  btnEl.disabled = true;
  btnEl.textContent = 'Adding...';

  supabaseClient
    .rpc('add_signup_to_roster', {
      p_signup_id: signupId,
      p_is_trial: !!(trialEl && trialEl.checked),
      p_archive_player_id: swapEl && swapEl.value ? parseInt(swapEl.value, 10) : null
    })
    .then(function (result) {
      if (result.error) {
        btnEl.disabled = false;
        btnEl.textContent = 'Add to Roster';
        if (errEl) errEl.textContent = result.error.message;
        return;
      }
      if (card) card.remove();
      _pendingRosterEntries = _pendingRosterEntries.filter(function (e) {
        return e.signupId !== signupId;
      });
      renderPendingRoster(_pendingRosterEntries, _pendingMissingSignups);
      updateNavBadges();
    });
}

// ── Remove from pending ──────────────────────────────────────────────────────

function removePendingRosterRow(signupId, btnEl) {
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = '...';
  }

  supabaseClient
    .from('season_signups')
    .update({ status: 'rejected' })
    .eq('id', signupId)
    .eq('team_id', _teamCfg.supabaseTeamId)
    .then(function (result) {
      if (result.error) {
        if (btnEl) {
          btnEl.disabled = false;
          btnEl.textContent = 'Remove from Pending';
        }
        return;
      }
      var card = document.querySelector('.signup-response-card[data-row="' + signupId + '"]');
      if (card) card.remove();
      _pendingRosterEntries = _pendingRosterEntries.filter(function (e) {
        return e.signupId !== signupId;
      });
      // Re-render stats with the updated list
      renderPendingRoster(_pendingRosterEntries, _pendingMissingSignups);
      updateNavBadges();
    });
}
