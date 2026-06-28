var LOOT_CHUNK_SIZE = 25;

// ── Import sub-tab ────────────────────────────────────────────────────────────

function buildLootImportForm() {
  var el = document.getElementById('loot-sub-import');
  if (!el) return;

  var seasonName = window.DATA && DATA.seasonName ? DATA.seasonName.trim() : '';

  var html = '<div class="signup-officer-panel">';
  html +=
    '<div class="signup-status-row"><span class="signup-status-label">Import from RCLootCouncil<button class="help-btn" onclick="toggleHelp(\'help-loot-import\')" title="Show help">?</button></span></div>';
  html += '<div id="help-loot-import" class="help-tip">';
  html += '<strong>How to import:</strong>';
  html += '<ul>';
  html +=
    '<li>In-game: open <strong>RCLootCouncil</strong>, click <strong>Export</strong>, choose <strong>JSON</strong>, and copy the output.</li>';
  html +=
    '<li>Paste it into the box below. You can paste multiple nights at once -- duplicates are skipped automatically.</li>';
  html +=
    '<li>Make sure <strong>Season Name</strong> is set correctly in Season Settings before importing so entries are tagged with the right season label.</li>';
  html += '</ul>';
  html +=
    '<strong>Season reset:</strong> go to <strong>Import History</strong>, click "Clear All Loot", update Season Name in Season Settings, then re-import this season\'s loot.';
  html += '</div>';
  if (seasonName) {
    html +=
      '<p class="signup-officer-note" style="margin-top:0.35rem;">Active season: <strong>' +
      seasonName +
      '</strong>. All imported entries will be tagged with this label. To change it, go to <a href="#" onclick="switchTab(\'season\');return false;">Season Settings</a>.</p>';
  } else {
    html +=
      '<p class="signup-officer-note" style="margin-top:0.35rem;color:var(--melee);">No season name configured. Set one in <a href="#" onclick="switchTab(\'season\');return false;">Season Settings</a> before importing so loot entries are properly labeled.</p>';
  }
  html += '<p class="signup-officer-note" style="margin-top:0.5rem;">In-game: RCLootCouncil &gt; Export &gt; JSON. ';
  html += "Paste one night's export (or multiple nights) below. Duplicate entries are skipped automatically.</p>";
  html += '<div style="margin-top:0.75rem;">';
  html +=
    '<textarea id="lootImportPaste" class="prio-export-textarea" placeholder="Paste RCLC JSON here..." style="height:160px;resize:vertical;"></textarea>';
  html += '</div>';
  html += '<div style="display:flex;align-items:center;gap:0.75rem;margin-top:0.75rem;flex-wrap:wrap;">';
  html += '<button class="btn btn-gold" onclick="submitLootImport()">Import</button>';
  html += '<span id="lootImportStatus" style="font-size:0.92rem;"></span>';
  html += '</div>';
  html += '</div>';

  el.innerHTML = html;
}

function submitLootImport() {
  var pasteEl = document.getElementById('lootImportPaste');
  var paste = pasteEl ? pasteEl.value.trim() : '';

  if (!paste) {
    setLootImportStatus('Paste the RCLC JSON export first.', 'var(--melee)');
    return;
  }

  var entries;
  try {
    entries = JSON.parse(paste);
    if (!Array.isArray(entries)) throw new Error('Expected a JSON array.');
  } catch (err) {
    setLootImportStatus('Invalid JSON: ' + err.message, 'var(--melee)');
    return;
  }

  var rows = [];
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    var id = String(e.id || '').trim();
    var player = String(e.player || '').trim();
    var date = (function (raw) {
      if (!raw) return '';
      var d = new Date(raw);
      if (isNaN(d.getTime())) return String(raw).trim();
      var yr = d.getFullYear();
      var mo = String(d.getMonth() + 1).padStart(2, '0');
      var dy = String(d.getDate()).padStart(2, '0');
      return yr + '-' + mo + '-' + dy;
    })(e.date);
    var itemName = String(e.itemName || '').trim();
    var instance = String(e.instance || '').trim();
    if (id && player && instance) {
      rows.push({ id: id, player: player, date: date, itemName: itemName, instance: instance });
    }
  }

  if (rows.length === 0) {
    setLootImportStatus(
      'No valid entries found -- check that the JSON has id, player, and instance fields.',
      'var(--melee)'
    );
    return;
  }

  var season = window.DATA && DATA.seasonName ? DATA.seasonName.trim() : '';

  setLootImportStatus('Importing ' + rows.length + ' entries...', 'var(--text-muted)');

  sendLootChunks(season, rows, 0, 0, 0, function (written, skipped) {
    var msg = 'Done. ' + written + ' new entries added';
    if (skipped > 0) msg += ', ' + skipped + ' duplicates skipped';
    msg += '.';
    setLootImportStatus(msg, 'var(--heal)');
  });
}

function setLootImportStatus(text, color) {
  var el = document.getElementById('lootImportStatus');
  if (!el) return;
  el.style.color = color || 'var(--text-muted)';
  el.textContent = text;
}

function sendLootChunks(season, rows, offset, totalWritten, totalSkipped, cb) {
  if (offset >= rows.length) {
    cb(totalWritten, totalSkipped);
    return;
  }
  var chunk = rows.slice(offset, offset + LOOT_CHUNK_SIZE);
  jsonpRequest(
    WEB_APP_URL +
      '?action=appendLootRows&season=' +
      encodeURIComponent(season) +
      '&rows=' +
      encodeURIComponent(JSON.stringify(chunk)),
    function (err, result) {
      if (err || !result || !result.success) {
        setLootImportStatus(err ? err.message : 'Import failed after ' + totalWritten + ' entries.', 'var(--melee)');
        return;
      }
      var w = result.written || 0;
      var s = result.skipped || 0;
      var done = Math.min(offset + LOOT_CHUNK_SIZE, rows.length);
      setLootImportStatus('Importing... (' + done + ' / ' + rows.length + ')', 'var(--text-muted)');
      sendLootChunks(season, rows, offset + LOOT_CHUNK_SIZE, totalWritten + w, totalSkipped + s, cb);
    }
  );
}

// ── Import History sub-tab ────────────────────────────────────────────────────

function buildLootHistoryTab() {
  var el = document.getElementById('loot-sub-history');
  if (!el) return;
  el.innerHTML = '<p style="font-size:0.92rem;color:var(--text-muted);padding:0.5rem 0;">Loading...</p>';
  fetchPastedLootSummary(renderLootHistoryPanel);
}

function fetchPastedLootSummary(cb) {
  jsonpRequest(WEB_APP_URL + '?action=getPastedLootSummary', function (err, result) {
    cb(!err && result ? result : { count: 0, lastDate: '' });
  });
}

function renderLootHistoryPanel(summary, preservedStatus) {
  var el = document.getElementById('loot-sub-history');
  if (!el) return;

  var count = summary ? summary.count || 0 : 0;
  var lastDate = summary ? summary.lastDate || '' : '';

  var html = '<div class="signup-officer-panel">';
  html +=
    '<div class="signup-status-row"><span class="signup-status-label">Imported Loot History<button class="help-btn" onclick="toggleHelp(\'help-loot-history\')" title="Show help">?</button></span></div>';
  html += '<div id="help-loot-history" class="help-tip" style="margin-bottom:0.5rem;">';
  html +=
    'Shows the total number of loot entries imported via the Import tab, and the date of the most recent entry.<br>';
  html +=
    "<strong>Clear All Loot History</strong> removes every imported entry -- use this at a season reset before re-importing the new season's loot. It does not affect the Loot Data sheet (IMPORTRANGE source), only the pasted imports.";
  html += '</div>';
  if (count > 0) {
    html += '<p class="signup-officer-note" style="margin-top:0.35rem;">';
    html += count + ' entries stored.';
    if (lastDate) html += ' Most recent: ' + lastDate + '.';
    html += '</p>';
    html += '<div style="margin-top:0.75rem;display:flex;align-items:center;gap:0.75rem;">';
    html +=
      '<button id="clearAllLootBtn" class="btn btn-danger" onclick="confirmClearAllLoot()">Clear All Loot History</button>';
    html += '<span id="lootHistoryStatus" style="font-size:0.92rem;"></span>';
    html += '</div>';
    html +=
      '<div id="lootClearConfirm" style="display:none;margin-top:0.75rem;padding:0.75rem;background:rgba(255,124,92,0.08);border:1px solid rgba(255,124,92,0.25);border-radius:4px;">';
    html +=
      '<span style="font-size:0.92rem;color:var(--melee);">This will delete all ' +
      count +
      ' imported loot entries. Use at season reset.</span>';
    html += '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">';
    html += '<button class="btn btn-danger" onclick="executeClearAllLoot()">Yes, Clear All</button>';
    html +=
      '<button class="btn btn-muted" onclick="document.getElementById(\'lootClearConfirm\').style.display=\'none\'">Cancel</button>';
    html += '</div></div>';
  } else {
    html +=
      '<p class="signup-officer-note" style="margin-top:0.35rem;">No loot history imported yet. Go to the <a href="#" onclick="switchLootSubTab(\'import\', document.getElementById(\'loot-subtab-btn-import\'));return false;">Import</a> tab to add entries.</p>';
  }
  html += '</div>';

  el.innerHTML = html;

  if (preservedStatus) {
    var statusEl = document.getElementById('lootHistoryStatus');
    if (statusEl) {
      statusEl.style.color = preservedStatus.color;
      statusEl.textContent = preservedStatus.text;
    }
  }
}

function confirmClearAllLoot() {
  var el = document.getElementById('lootClearConfirm');
  if (el) el.style.display = '';
}

function executeClearAllLoot() {
  var confirmEl = document.getElementById('lootClearConfirm');
  if (confirmEl) confirmEl.style.display = 'none';
  var btn = document.getElementById('clearAllLootBtn');
  var status = document.getElementById('lootHistoryStatus');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Clearing...';
  }
  if (status) {
    status.textContent = '';
  }

  jsonpRequest(WEB_APP_URL + '?action=clearAllPastedLoot', function (err, result) {
    if (!err && result && result.success) {
      fetchPastedLootSummary(function (summary) {
        renderLootHistoryPanel(summary, { color: 'var(--heal)', text: 'All loot history cleared.' });
      });
    } else {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Clear All Loot History';
      }
      if (status) {
        status.style.color = 'var(--melee)';
        status.textContent = err ? err.message : 'Clear failed.';
      }
    }
  });
}

// Legacy alias — called by old code paths that still reference buildLootImportTab
function buildLootImportTab() {
  buildLootImportForm();
}
