function switchSeasonSubTab(name, btnEl) {
  document.querySelectorAll('[id^="season-subtab-btn-"]').forEach(function (b) {
    b.classList.remove('active');
  });
  if (btnEl) btnEl.classList.add('active');
  ['settings', 'progression', 'history'].forEach(function (sub) {
    var el = document.getElementById('season-sub-' + sub);
    if (el) el.style.display = sub === name ? '' : 'none';
  });
  if (name === 'progression') renderRaidProgressionCards();
  if (name === 'history') renderSeasonHistory();
}

function buildSeasonTab() {
  var startInput = document.getElementById('seasonStartInput');
  if (startInput) startInput.value = (DATA && DATA.seasonStart) || '';
  var nameInput = document.getElementById('seasonNameInput');
  if (nameInput) nameInput.value = (DATA && DATA.seasonName) || '';
  var endInput = document.getElementById('seasonEndInput');
  if (endInput) endInput.value = (DATA && DATA.seasonEnd) || '';
  var signupSeasonInput = document.getElementById('signupSeasonInput');
  if (signupSeasonInput) signupSeasonInput.value = (DATA && DATA.signupSeason) || '';
  var trialWeeksInput = document.getElementById('trialWeeksInput');
  var trialAttendInput = document.getElementById('trialAttendInput');
  if (trialWeeksInput) trialWeeksInput.value = DATA && DATA.trialWeeks != null ? DATA.trialWeeks : 4;
  if (trialAttendInput) trialAttendInput.value = DATA && DATA.trialAttend != null ? DATA.trialAttend : 75;
  SEASON_RAIDS = JSON.parse(JSON.stringify((DATA && DATA.raidProgression) || []));
  // Reset to Settings subtab; Progression and History render lazily on switch
  var defaultBtn = document.getElementById('season-subtab-btn-settings');
  switchSeasonSubTab('settings', defaultBtn);
}

function renderSeasonHistory() {
  var history = (DATA && DATA.seasonHistory) || [];
  var wrap = document.getElementById('seasonHistoryWrap');
  var list = document.getElementById('seasonHistoryList');
  if (!wrap || !list) return;
  if (!history.length) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';
  var html = '';
  for (var i = history.length - 1; i >= 0; i--) {
    var s = history[i];
    var raidCount = s.raids && s.raids.length ? s.raids.length : 0;
    html += '<div style="border-bottom:1px solid rgba(255,255,255,0.06);padding:0.45rem 0 0.6rem;">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;">';
    html += '<div>';
    html += '<strong style="color:var(--text);">' + (s.name || '(unnamed)') + '</strong>';
    html +=
      '<span style="font-size:0.85rem;color:var(--text-muted);margin-left:0.75rem;">' +
      (s.start || '-') +
      ' to ' +
      (s.end || 'ongoing') +
      '</span>';
    if (raidCount)
      html +=
        '<span style="font-size:0.82rem;color:var(--text-muted);margin-left:0.5rem;">(' +
        raidCount +
        ' raid' +
        (raidCount !== 1 ? 's' : '') +
        ')</span>';
    html += '</div>';
    html += '<div style="display:flex;gap:0.4rem;">';
    if (s.roster) {
      html +=
        '<button class="btn btn-muted" style="font-size:0.8rem;padding:2px 10px;white-space:nowrap;" onclick="toggleSeasonSnapshot(' +
        i +
        ', this)">View Roster</button>';
    }
    html +=
      '<button class="btn btn-muted" style="font-size:0.8rem;padding:2px 10px;white-space:nowrap;" onclick="confirmUnarchiveSeason(' +
      i +
      ')">Unarchive</button>';
    html += '</div>';
    html += '</div>';
    if (s.roster) {
      html += '<div id="snapshot-' + i + '" style="display:none;margin-top:0.5rem;"></div>';
    }
    html += '</div>';
  }
  list.innerHTML = html;
  var confirmEl = document.getElementById('seasonUnarchiveConfirm');
  if (confirmEl) confirmEl.style.display = 'none';
}

// The roster snapshot lives inline on the seasonHistory entry itself
// (history[index].roster, see archive_current_season() in
// 20260712100000_team_settings_season_config.sql) rather than behind a
// separate lookup key, so this just renders what's already in DATA -- no
// round trip needed (#221 follow-up to the old getRosterSnapshot GAS action).
function toggleSeasonSnapshot(index, btnEl) {
  var panel = document.getElementById('snapshot-' + index);
  if (!panel) return;
  if (panel.style.display !== 'none') {
    panel.style.display = 'none';
    btnEl.textContent = 'View Roster';
    return;
  }
  if (panel.dataset.loaded) {
    panel.style.display = '';
    btnEl.textContent = 'Hide Roster';
    return;
  }
  var history = (DATA && DATA.seasonHistory) || [];
  var season = history[index];
  var players = (season && season.roster) || [];
  panel.dataset.loaded = '1';
  btnEl.textContent = 'Hide Roster';
  if (!players.length) {
    panel.innerHTML =
      '<p style="font-size:0.88rem;color:var(--text-muted);">No roster data captured for this season.</p>';
    panel.style.display = '';
    return;
  }
  var roleOrder = { Tank: 0, Heal: 1, Melee: 2, Ranged: 3 };
  players = players.slice().sort(function (a, b) {
    var ra = roleOrder[a.role] !== undefined ? roleOrder[a.role] : 9;
    var rb = roleOrder[b.role] !== undefined ? roleOrder[b.role] : 9;
    if (ra !== rb) return ra - rb;
    return a.nameRealm.localeCompare(b.nameRealm);
  });
  var html = '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;margin-top:0.25rem;">';
  html += '<thead><tr style="color:var(--text-muted);text-align:left;border-bottom:1px solid rgba(255,255,255,0.1);">';
  html += '<th style="padding:0.2rem 0.5rem 0.2rem 0;">Player</th>';
  html += '<th style="padding:0.2rem 0.5rem;">Role</th>';
  html += '<th style="padding:0.2rem 0.5rem;">Status</th>';
  html += '<th style="padding:0.2rem 0.5rem;">Join Date</th>';
  html += '<th style="padding:0.2rem 0;">Attendance</th>';
  html += '</tr></thead><tbody>';
  players.forEach(function (p) {
    var status = p.isBench ? 'Bench' : p.isTrial ? 'Trial' : 'Roster';
    html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">';
    html += '<td style="padding:0.18rem 0.5rem 0.18rem 0;color:var(--text);">' + p.nameRealm + '</td>';
    html += '<td style="padding:0.18rem 0.5rem;color:var(--text-muted);">' + (p.role || '-') + '</td>';
    html += '<td style="padding:0.18rem 0.5rem;color:var(--text-muted);">' + status + '</td>';
    html += '<td style="padding:0.18rem 0.5rem;color:var(--text-muted);">' + (p.joinDate || '-') + '</td>';
    html += '<td style="padding:0.18rem 0;color:var(--text-muted);">' + (p.attendance || '-') + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table>';
  panel.innerHTML = html;
  panel.style.display = '';
}

var _unarchiveIndex = -1;

function confirmUnarchiveSeason(index) {
  _unarchiveIndex = index;
  var history = (DATA && DATA.seasonHistory) || [];
  var s = history[index] || {};
  var msg = document.getElementById('seasonUnarchiveConfirmMsg');
  var confirmEl = document.getElementById('seasonUnarchiveConfirm');
  if (msg) {
    var text = 'Restore "' + (s.name || '(unnamed)') + '" as the active season?';
    if (DATA && DATA.seasonName) {
      text +=
        ' The current active season ("' +
        DATA.seasonName +
        '") will be overwritten. Archive it first if you want to keep it.';
    }
    msg.textContent = text;
  }
  if (confirmEl) confirmEl.style.display = '';
}

function executeUnarchiveSeason() {
  var confirmEl = document.getElementById('seasonUnarchiveConfirm');
  var status = document.getElementById('seasonUnarchiveStatus');
  var btn = document.getElementById('seasonUnarchiveExecBtn');
  if (confirmEl) confirmEl.style.display = 'none';
  if (btn) btn.disabled = true;
  var index = _unarchiveIndex;

  supabaseClient
    .rpc('unarchive_season', { p_team_id: _teamCfg.supabaseTeamId, p_index: index })
    .then(function (result) {
      if (btn) btn.disabled = false;
      if (result.error) throw new Error(result.error.message);
      var season = result.data.season;
      DATA.seasonName = season.name || '';
      DATA.seasonStart = season.start || '';
      DATA.seasonEnd = season.end || '';
      DATA.raidProgression = season.raids || [];
      DATA.seasonHistory = result.data.config.seasonHistory || [];
      _unarchiveIndex = -1;
      buildSeasonTab();
      populateSeasonSelector();
      return writeAuditLog('Season Unarchived', null, null, season.name || '');
    })
    .then(function () {
      if (status) {
        status.textContent = 'Season restored.';
        setTimeout(function () {
          if (status) status.textContent = '';
        }, 3000);
      }
    })
    .catch(function (err) {
      if (btn) btn.disabled = false;
      if (status) status.textContent = err.message || 'Error restoring season.';
    });
}

function confirmClearSeasonStart() {
  var el = document.getElementById('seasonClearConfirm');
  if (el) el.style.display = '';
}

function executeClearSeasonStart() {
  var el = document.getElementById('seasonClearConfirm');
  if (el) el.style.display = 'none';
  var input = document.getElementById('seasonStartInput');
  if (input) input.value = '';
  saveSeasonStart();
}

function confirmClearSeasonEnd() {
  var el = document.getElementById('seasonEndClearConfirm');
  if (el) el.style.display = '';
}

function executeClearSeasonEnd() {
  var el = document.getElementById('seasonEndClearConfirm');
  if (el) el.style.display = 'none';
  var input = document.getElementById('seasonEndInput');
  if (input) input.value = '';
  saveSeasonEnd();
}

function confirmArchiveSeason() {
  var name = (DATA && DATA.seasonName) || '';
  var msg = document.getElementById('seasonArchiveConfirmMsg');
  if (msg) {
    if (!name) {
      msg.textContent = 'No current season name is set. Please set a Season Name before archiving.';
      document.getElementById('seasonArchiveExecBtn').style.display = 'none';
    } else {
      msg.textContent =
        'Archive "' +
        name +
        '"? The current season name, start date, and end date will be moved to history and cleared. Set a new Season Name and Start Date for the next season afterward.';
      document.getElementById('seasonArchiveExecBtn').style.display = '';
    }
  }
  var el = document.getElementById('seasonArchiveConfirm');
  if (el) el.style.display = '';
}

// Roster snapshot is computed client-side from the roster already in DATA
// (nameRealm/role/isTrial/isBench/joinDate/attendance -- the same fields the
// old GAS archiveSeason() read straight off the sheets) and passed to the
// archive_current_season RPC, which stores it inline on the new history
// entry rather than in a separate lookup key (#221).
function buildSeasonArchiveRosterSnapshot() {
  var roster = (DATA && DATA.roster) || [];
  return roster.map(function (p) {
    return {
      nameRealm: p.nameRealm,
      role: p.role,
      isTrial: !!p.isTrial,
      isBench: !!p.isBench,
      joinDate: p.joinDate || '',
      attendance: p.attendance || ''
    };
  });
}

function executeArchiveSeason() {
  var el = document.getElementById('seasonArchiveConfirm');
  var status = document.getElementById('seasonArchiveStatus');
  var btn = document.getElementById('seasonArchiveExecBtn');
  if (el) el.style.display = 'none';
  if (btn) {
    btn.disabled = true;
  }
  var archivedName = DATA.seasonName;

  supabaseClient
    .rpc('archive_current_season', {
      p_team_id: _teamCfg.supabaseTeamId,
      p_roster_snapshot: buildSeasonArchiveRosterSnapshot()
    })
    .then(function (result) {
      if (btn) btn.disabled = false;
      if (result.error) throw new Error(result.error.message);
      var config = result.data;
      DATA.seasonName = config.seasonName || '';
      DATA.seasonStart = config.seasonStart || '';
      DATA.seasonEnd = config.seasonEnd || '';
      DATA.raidProgression = config.raidProgression || [];
      DATA.seasonHistory = config.seasonHistory || [];
      SEASON_RAIDS = [];
      buildSeasonTab();
      populateSeasonSelector();
      return writeAuditLog('Season Archived', null, null, archivedName);
    })
    .then(function () {
      if (status) {
        status.textContent = 'Season archived.';
        setTimeout(function () {
          if (status) status.textContent = '';
        }, 3000);
      }
    })
    .catch(function (err) {
      if (btn) btn.disabled = false;
      if (status) status.textContent = err.message || 'Error archiving season.';
    });
}

function syncAttendancePct() {
  var btn = document.getElementById('syncAttendPctBtn');
  var status = document.getElementById('syncAttendPctStatus');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Syncing...';
  }

  jsonpRequest(WEB_APP_URL + '?action=syncAttendancePct', function (err, result) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Sync to Roster Sheet';
    }
    if (!err && result && result.success) {
      if (status) {
        status.textContent = 'Synced!';
        setTimeout(function () {
          if (status) status.textContent = '';
        }, 2000);
      }
    } else {
      if (status) {
        status.textContent = err ? err.message : 'Error syncing.';
      }
    }
  });
}

function saveSignupSeason() {
  var input = document.getElementById('signupSeasonInput');
  var val = input ? input.value.trim() : '';
  var btn = document.getElementById('signupSeasonSaveBtn');
  var status = document.getElementById('signupSeasonStatus');
  if (!val) {
    if (status) {
      status.textContent = 'Season name cannot be blank.';
      setTimeout(function () {
        if (status) status.textContent = '';
      }, 3000);
    }
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  saveTeamSetting({ activeSignupSeason: val })
    .then(function () {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
      if (DATA) DATA.signupSeason = val;
      if (status) {
        status.textContent = val ? 'Saved!' : 'Cleared.';
        setTimeout(function () {
          if (status) status.textContent = '';
        }, 2000);
      }
    })
    .catch(function (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
      if (status) status.textContent = err.message || 'Error saving.';
    });
}

function saveSeasonName() {
  var input = document.getElementById('seasonNameInput');
  var val = input ? input.value.trim() : '';
  var btn = document.getElementById('seasonNameSaveBtn');
  var status = document.getElementById('seasonNameStatus');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  saveTeamSetting({ seasonName: val })
    .then(function () {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
      if (DATA) DATA.seasonName = val;
      if (input) input.value = val;
      populateSeasonSelector();
      writeAuditLog('Season Name Set', null, null, val);
      if (status) {
        status.textContent = val ? 'Saved!' : 'Cleared.';
        setTimeout(function () {
          if (status) status.textContent = '';
        }, 2000);
      }
    })
    .catch(function (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
      if (status) status.textContent = err.message || 'Error saving.';
    });
}

function saveSeasonStart() {
  var input = document.getElementById('seasonStartInput');
  var val = input ? input.value.trim() : '';
  if (val && !/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    alert('Enter a date in YYYY-MM-DD format.');
    return;
  }
  var btn = document.getElementById('seasonStartSaveBtn');
  var status = document.getElementById('seasonStartStatus');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  saveTeamSetting({ seasonStart: val })
    .then(function () {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
      if (DATA) DATA.seasonStart = val;
      if (input) input.value = val;
      populateSeasonSelector();
      writeAuditLog('Season Start Set', null, null, val);
      if (status) {
        status.textContent = val ? 'Saved!' : 'Cleared.';
        setTimeout(function () {
          if (status) status.textContent = '';
        }, 2000);
      }
    })
    .catch(function (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
      if (status) status.textContent = err.message || 'Error saving.';
    });
}

function saveSeasonEnd() {
  var input = document.getElementById('seasonEndInput');
  var val = input ? input.value.trim() : '';
  if (val && !/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    alert('Enter a date in YYYY-MM-DD format.');
    return;
  }
  var btn = document.getElementById('seasonEndSaveBtn');
  var status = document.getElementById('seasonEndStatus');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  saveTeamSetting({ seasonEnd: val })
    .then(function () {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
      if (DATA) DATA.seasonEnd = val;
      if (input) input.value = val;
      writeAuditLog('Season End Set', null, null, val);
      if (status) {
        status.textContent = val ? 'Saved!' : 'Cleared.';
        setTimeout(function () {
          if (status) status.textContent = '';
        }, 2000);
      }
    })
    .catch(function (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
      if (status) status.textContent = err.message || 'Error saving.';
    });
}

// -- Raid Progression --

var SEASON_RAIDS = [];

function raidAddRaid() {
  raidCollectFromDOM();
  SEASON_RAIDS.push({
    name: '',
    wclZoneId: '',
    encounterStart: '',
    encounterEnd: '',
    isMiniRaid: false,
    bosses: [],
    aotcDate: ''
  });
  renderRaidProgressionCards();
}

function raidRemoveRaid(idx) {
  raidCollectFromDOM();
  SEASON_RAIDS.splice(idx, 1);
  renderRaidProgressionCards();
}

function raidAddBoss(raidIdx) {
  raidCollectFromDOM();
  SEASON_RAIDS[raidIdx].bosses.push({ name: '', mythicDate: '' });
  renderRaidProgressionCards();
}

function raidRemoveBoss(raidIdx, bossIdx) {
  raidCollectFromDOM();
  SEASON_RAIDS[raidIdx].bosses.splice(bossIdx, 1);
  renderRaidProgressionCards();
}

function raidCollectFromDOM() {
  var wrap = document.getElementById('raidProgressionCards');
  if (!wrap) return;
  var raidEls = wrap.querySelectorAll('.raid-prog-block');
  for (var i = 0; i < raidEls.length; i++) {
    if (!SEASON_RAIDS[i]) continue;
    var nameEl = raidEls[i].querySelector('.raid-name-input');
    var miniEl = raidEls[i].querySelector('.raid-mini-check');
    var aotcEl = raidEls[i].querySelector('.raid-aotc-input');
    var zoneEl = raidEls[i].querySelector('.raid-zone-input');
    if (nameEl) SEASON_RAIDS[i].name = nameEl.value.trim();
    if (miniEl) SEASON_RAIDS[i].isMiniRaid = miniEl.checked;
    if (aotcEl) SEASON_RAIDS[i].aotcDate = aotcEl.value;
    if (zoneEl) SEASON_RAIDS[i].wclZoneId = zoneEl.value.trim();
    var encStartEl = raidEls[i].querySelector('.raid-enc-start');
    var encEndEl = raidEls[i].querySelector('.raid-enc-end');
    if (encStartEl) SEASON_RAIDS[i].encounterStart = encStartEl.value.trim();
    if (encEndEl) SEASON_RAIDS[i].encounterEnd = encEndEl.value.trim();
    var bossEls = raidEls[i].querySelectorAll('.raid-boss-row');
    for (var j = 0; j < bossEls.length; j++) {
      if (!SEASON_RAIDS[i].bosses[j]) continue;
      var bnEl = bossEls[j].querySelector('.boss-name-input');
      var bdEl = bossEls[j].querySelector('.boss-date-input');
      if (bnEl) SEASON_RAIDS[i].bosses[j].name = bnEl.value.trim();
      if (bdEl) SEASON_RAIDS[i].bosses[j].mythicDate = bdEl.value;
    }
  }
}

function renderRaidProgressionCards() {
  var wrap = document.getElementById('raidProgressionCards');
  if (!wrap) return;
  if (!SEASON_RAIDS.length) {
    wrap.innerHTML =
      '<p style="font-size:0.88rem;color:var(--text-muted);">No raids added yet. Click "+ Add Raid" to start.</p>';
    return;
  }
  var html = '';
  for (var i = 0; i < SEASON_RAIDS.length; i++) {
    var raid = SEASON_RAIDS[i];
    var isMini = !!raid.isMiniRaid;
    html +=
      '<div class="raid-prog-block" style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:1rem;">';
    html += '<div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.5rem;">';
    html +=
      '<input class="raid-name-input add-player-input" placeholder="Raid name (e.g. Liberation of Undermine)" value="' +
      _escAttr(raid.name) +
      '" style="flex:1;min-width:200px;font-size:0.95rem;padding:0.35rem 0.6rem;">';
    html +=
      '<label style="display:flex;align-items:center;gap:5px;font-size:0.85rem;color:var(--text-muted);cursor:pointer;white-space:nowrap;"><input type="checkbox" class="raid-mini-check"' +
      (isMini ? ' checked' : '') +
      ' onchange="raidToggleMini(' +
      i +
      ',this)"> Mini-raid</label>';
    html +=
      '<button class="btn btn-danger" style="padding:2px 10px;font-size:0.8rem;" onclick="raidRemoveRaid(' +
      i +
      ')">Remove</button>';
    html += '</div>';
    html += '<div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;margin-bottom:0.75rem;">';
    html += '<span style="font-size:0.82rem;color:var(--text-muted);white-space:nowrap;">WCL Zone ID</span>';
    html +=
      '<input class="raid-zone-input add-player-input" type="number" placeholder="e.g. 46" value="' +
      _escAttr(raid.wclZoneId || '') +
      '" style="width:80px;font-size:0.88rem;padding:0.28rem 0.5rem;">';
    html +=
      '<button class="btn btn-muted" style="font-size:0.78rem;padding:2px 8px;" onclick="listWclEncounters(' +
      i +
      ')">List</button>';
    html += '<span style="font-size:0.82rem;color:var(--text-muted);white-space:nowrap;">Encounters</span>';
    html +=
      '<input class="raid-enc-start add-player-input" type="number" placeholder="from" value="' +
      _escAttr(raid.encounterStart || '') +
      '" style="width:70px;font-size:0.88rem;padding:0.28rem 0.5rem;">';
    html += '<span style="font-size:0.82rem;color:var(--text-muted);">-</span>';
    html +=
      '<input class="raid-enc-end add-player-input" type="number" placeholder="to" value="' +
      _escAttr(raid.encounterEnd || '') +
      '" style="width:70px;font-size:0.88rem;padding:0.28rem 0.5rem;">';
    html +=
      '<button class="btn btn-muted" style="font-size:0.82rem;padding:3px 12px;" onclick="fetchWclForRaid(' +
      i +
      ')">Fetch from WCL</button>';
    html += '<span id="wclFetchStatus_' + i + '" style="font-size:0.8rem;color:var(--text-muted);"></span>';
    html += '</div>';
    html +=
      '<div id="wclEncList_' +
      i +
      '" style="display:none;font-size:0.8rem;color:var(--text-muted);background:rgba(0,0,0,0.2);border-radius:4px;padding:0.5rem 0.75rem;margin-bottom:0.75rem;line-height:1.8;"></div>';
    if (!isMini) {
      html += '<div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem;">';
      html += '<span style="font-size:0.85rem;color:var(--text-muted);white-space:nowrap;">AOTC Date</span>';
      html +=
        '<input type="date" class="raid-aotc-input add-player-input" value="' +
        _escAttr(raid.aotcDate || '') +
        '" style="max-width:170px;font-size:0.9rem;padding:0.3rem 0.5rem;">';
      html += '</div>';
    }
    html +=
      '<div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.4rem;font-weight:600;letter-spacing:0.04em;">BOSSES</div>';
    if (raid.bosses.length) {
      html += '<div style="display:flex;flex-direction:column;gap:0.4rem;margin-bottom:0.5rem;">';
      for (var j = 0; j < raid.bosses.length; j++) {
        var boss = raid.bosses[j];
        html += '<div class="raid-boss-row" style="display:flex;align-items:center;gap:0.5rem;">';
        html +=
          '<span style="font-size:0.8rem;color:var(--text-muted);min-width:1.2rem;text-align:right;">' +
          (j + 1) +
          '</span>';
        html +=
          '<input class="boss-name-input add-player-input" placeholder="Boss name" value="' +
          _escAttr(boss.name) +
          '" style="flex:1;font-size:0.88rem;padding:0.28rem 0.5rem;">';
        html += '<span style="font-size:0.78rem;color:var(--text-muted);white-space:nowrap;">Mythic kill</span>';
        html +=
          '<input type="date" class="boss-date-input add-player-input" value="' +
          _escAttr(boss.mythicDate || '') +
          '" style="width:150px;font-size:0.88rem;padding:0.28rem 0.5rem;">';
        html +=
          '<button class="btn btn-muted" style="padding:2px 8px;font-size:0.78rem;" onclick="raidRemoveBoss(' +
          i +
          ',' +
          j +
          ')">&times;</button>';
        html += '</div>';
      }
      html += '</div>';
    }
    html +=
      '<button class="btn btn-muted" style="font-size:0.8rem;padding:3px 10px;" onclick="raidAddBoss(' +
      i +
      ')">+ Add Boss</button>';
    html += '</div>';
  }
  wrap.innerHTML = html;
}

function raidToggleMini(idx, checkbox) {
  raidCollectFromDOM();
  SEASON_RAIDS[idx].isMiniRaid = checkbox.checked;
  if (checkbox.checked) SEASON_RAIDS[idx].aotcDate = '';
  renderRaidProgressionCards();
}

function _escAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

function listWclEncounters(idx) {
  raidCollectFromDOM();
  var zoneId = SEASON_RAIDS[idx].wclZoneId ? parseInt(SEASON_RAIDS[idx].wclZoneId, 10) : 0;
  if (!zoneId || isNaN(zoneId)) {
    alert('Enter a WCL Zone ID first.');
    return;
  }

  var el = document.getElementById('wclEncList_' + idx);
  if (el) {
    el.style.display = '';
    el.textContent = 'Loading...';
  }

  jsonpRequest(
    WEB_APP_URL + '?action=getWclZoneEncounters&zoneId=' + encodeURIComponent(zoneId),
    function (err, result) {
      if (!el) return;
      if (err || !result || result.error) {
        el.textContent = err ? err.message : 'Error: ' + ((result && result.error) || 'Unknown');
        return;
      }
      var lines = (result.encounters || []).map(function (e) {
        return e.id + ' -- ' + e.name;
      });
      el.innerHTML =
        '<strong style="color:var(--text);">' +
        (result.zoneName || 'Zone ' + zoneId) +
        '</strong><br>' +
        lines.join('<br>');
    }
  );
}

function fetchWclForRaid(idx) {
  raidCollectFromDOM();
  var raid = SEASON_RAIDS[idx];
  var zoneId = raid.wclZoneId ? parseInt(raid.wclZoneId, 10) : 0;
  if (!zoneId || isNaN(zoneId)) {
    alert('Enter a WCL Zone ID first.');
    return;
  }

  var status = document.getElementById('wclFetchStatus_' + idx);
  if (status) {
    status.textContent = 'Fetching from WCL...';
  }

  jsonpRequest(
    WEB_APP_URL + '?action=fetchWclProgression&zoneId=' + encodeURIComponent(zoneId),
    function (err, result) {
      if (err || !result || result.error) {
        if (status) status.textContent = err ? err.message : 'Error: ' + ((result && result.error) || 'Unknown');
        return;
      }
      var encStart = parseInt(SEASON_RAIDS[idx].encounterStart, 10) || 0;
      var encEnd = parseInt(SEASON_RAIDS[idx].encounterEnd, 10) || 0;
      var filtered = (result.bosses || []).filter(function (b) {
        if (encStart && b.encounterID < encStart) return false;
        if (encEnd && b.encounterID > encEnd) return false;
        return true;
      });
      SEASON_RAIDS[idx].bosses = filtered.map(function (b) {
        return { name: b.name || '', mythicDate: b.mythicDate || '' };
      });
      var lastInRange = filtered[filtered.length - 1];
      if (!SEASON_RAIDS[idx].isMiniRaid && lastInRange && lastInRange.heroicDate) {
        SEASON_RAIDS[idx].aotcDate = lastInRange.heroicDate;
      }
      renderRaidProgressionCards();
      var s = document.getElementById('wclFetchStatus_' + idx);
      if (s) {
        s.textContent = 'Fetched ' + SEASON_RAIDS[idx].bosses.length + ' boss(es)!';
        setTimeout(function () {
          if (s) s.textContent = '';
        }, 3000);
      }
    }
  );
}

function saveRaidProgression() {
  raidCollectFromDOM();
  var btn = document.getElementById('raidSaveBtn');
  var status = document.getElementById('raidProgressionStatus');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  saveTeamSetting({ raidProgression: SEASON_RAIDS })
    .then(function () {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save Progression';
      }
      DATA.raidProgression = JSON.parse(JSON.stringify(SEASON_RAIDS));
      writeAuditLog('Raid Progression Saved', null, null, SEASON_RAIDS.length + ' raid(s)');
      if (status) {
        status.textContent = 'Saved!';
        setTimeout(function () {
          if (status) status.textContent = '';
        }, 2500);
      }
    })
    .catch(function (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save Progression';
      }
      if (status) status.textContent = err.message || 'Error saving.';
    });
}

function saveTrialThresholds() {
  var weeksInput = document.getElementById('trialWeeksInput');
  var attendInput = document.getElementById('trialAttendInput');
  var btn = document.getElementById('trialThresholdsSaveBtn');
  var status = document.getElementById('trialThresholdsStatus');
  var weeks = Math.max(1, Math.min(52, parseInt(weeksInput ? weeksInput.value : 4) || 4));
  var attend = Math.max(0, Math.min(100, parseInt(attendInput ? attendInput.value : 75) || 75));
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  saveTeamSetting({ trialWeeks: weeks, trialAttend: attend })
    .then(function () {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
      if (DATA) {
        DATA.trialWeeks = weeks;
        DATA.trialAttend = attend;
      }
      PROMO_THRESHOLDS.weeks = weeks;
      PROMO_THRESHOLDS.attend = attend;
      writeAuditLog('Trial Thresholds Set', null, null, weeks + ' wk / ' + attend + '%');
      if (status) {
        status.textContent = 'Saved!';
        setTimeout(function () {
          if (status) status.textContent = '';
        }, 2000);
      }
    })
    .catch(function (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
      if (status) status.textContent = err.message || 'Error saving.';
    });
}
