var LOOT_CHUNK_SIZE = 25;

// ── Import sub-tab ────────────────────────────────────────────────────────────

function buildLootImportForm() {
  var el = document.getElementById('loot-sub-import');
  if (!el) return;

  var seasonName = (window.DATA && DATA.seasonName) ? DATA.seasonName.trim() : '';

  var html = '<div class="signup-officer-panel">';
  html += '<div class="signup-status-row"><span class="signup-status-label">Import from RCLootCouncil</span></div>';
  if (seasonName) {
    html += '<p class="signup-officer-note" style="margin-top:0.35rem;">Active season: <strong>' + seasonName + '</strong>. All imported entries will be tagged with this label. To change it, go to <a href="#" onclick="switchTab(\'season\');return false;">Season Settings</a>.</p>';
  } else {
    html += '<p class="signup-officer-note" style="margin-top:0.35rem;color:var(--melee);">No season name configured. Set one in <a href="#" onclick="switchTab(\'season\');return false;">Season Settings</a> before importing so loot entries are properly labeled.</p>';
  }
  html += '<p class="signup-officer-note" style="margin-top:0.5rem;">In-game: RCLootCouncil &gt; Export &gt; JSON. ';
  html += 'Paste one night\'s export (or multiple nights) below. Duplicate entries are skipped automatically.</p>';
  html += '<div style="margin-top:0.75rem;">';
  html += '<textarea id="lootImportPaste" class="prio-export-textarea" placeholder="Paste RCLC JSON here..." style="height:160px;resize:vertical;"></textarea>';
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
  var paste   = pasteEl ? pasteEl.value.trim() : '';

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
    var e        = entries[i];
    var id       = String(e.id       || '').trim();
    var player   = String(e.player   || '').trim();
    var date     = (function(raw) {
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
    setLootImportStatus('No valid entries found -- check that the JSON has id, player, and instance fields.', 'var(--melee)');
    return;
  }

  var season = (window.DATA && DATA.seasonName) ? DATA.seasonName.trim() : '';

  setLootImportStatus('Importing ' + rows.length + ' entries...', 'var(--text-muted)');

  sendLootChunks(season, rows, 0, 0, 0, function(written, skipped) {
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
  if (offset >= rows.length) { cb(totalWritten, totalSkipped); return; }
  var chunk  = rows.slice(offset, offset + LOOT_CHUNK_SIZE);
  var cbName = '_appendLootRowsCb' + Date.now();
  window[cbName] = function(result) {
    delete window[cbName];
    if (!result || !result.success) {
      setLootImportStatus('Import failed after ' + totalWritten + ' entries.', 'var(--melee)');
      return;
    }
    var w    = result.written || 0;
    var s    = result.skipped || 0;
    var done = Math.min(offset + LOOT_CHUNK_SIZE, rows.length);
    setLootImportStatus('Importing... (' + done + ' / ' + rows.length + ')', 'var(--text-muted)');
    sendLootChunks(season, rows, offset + LOOT_CHUNK_SIZE, totalWritten + w, totalSkipped + s, cb);
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    setLootImportStatus('Import failed after ' + totalWritten + ' entries.', 'var(--melee)');
  };
  script.src = WEB_APP_URL + '?action=appendLootRows&season=' + encodeURIComponent(season) + '&rows=' + encodeURIComponent(JSON.stringify(chunk)) + '&callback=' + cbName;
  document.head.appendChild(script);
}

// ── Import History sub-tab ────────────────────────────────────────────────────

function buildLootHistoryTab() {
  var el = document.getElementById('loot-sub-history');
  if (!el) return;
  el.innerHTML = '<p style="font-size:0.92rem;color:var(--text-muted);padding:0.5rem 0;">Loading...</p>';
  fetchPastedLootSummary(renderLootHistoryPanel);
}

function fetchPastedLootSummary(cb) {
  var cbName = '_pastedLootSummaryCb' + Date.now();
  window[cbName] = function(result) {
    delete window[cbName];
    cb(result || { count: 0, lastDate: '' });
  };
  var script = document.createElement('script');
  script.onerror = function() { delete window[cbName]; cb({ count: 0, lastDate: '' }); };
  script.src = WEB_APP_URL + '?action=getPastedLootSummary&callback=' + cbName;
  document.head.appendChild(script);
}

function renderLootHistoryPanel(summary, preservedStatus) {
  var el = document.getElementById('loot-sub-history');
  if (!el) return;

  var count    = summary ? (summary.count    || 0) : 0;
  var lastDate = summary ? (summary.lastDate || '') : '';

  var html = '<div class="signup-officer-panel">';
  html += '<div class="signup-status-row"><span class="signup-status-label">Imported Loot History</span></div>';
  if (count > 0) {
    html += '<p class="signup-officer-note" style="margin-top:0.35rem;">';
    html += count + ' entries stored.';
    if (lastDate) html += ' Most recent: ' + lastDate + '.';
    html += '</p>';
    html += '<div style="margin-top:0.75rem;display:flex;align-items:center;gap:0.75rem;">';
    html += '<button id="clearAllLootBtn" class="btn btn-danger" onclick="confirmClearAllLoot()">Clear All Loot History</button>';
    html += '<span id="lootHistoryStatus" style="font-size:0.92rem;"></span>';
    html += '</div>';
    html += '<div id="lootClearConfirm" style="display:none;margin-top:0.75rem;padding:0.75rem;background:rgba(255,124,92,0.08);border:1px solid rgba(255,124,92,0.25);border-radius:4px;">';
    html += '<span style="font-size:0.92rem;color:var(--melee);">This will delete all ' + count + ' imported loot entries. Use at season reset.</span>';
    html += '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">';
    html += '<button class="btn btn-danger" onclick="executeClearAllLoot()">Yes, Clear All</button>';
    html += '<button class="btn btn-muted" onclick="document.getElementById(\'lootClearConfirm\').style.display=\'none\'">Cancel</button>';
    html += '</div></div>';
  } else {
    html += '<p class="signup-officer-note" style="margin-top:0.35rem;">No loot history imported yet. Go to the <a href="#" onclick="switchLootSubTab(\'import\', document.getElementById(\'loot-subtab-btn-import\'));return false;">Import</a> tab to add entries.</p>';
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
  var btn    = document.getElementById('clearAllLootBtn');
  var status = document.getElementById('lootHistoryStatus');
  if (btn)    { btn.disabled = true; btn.textContent = 'Clearing...'; }
  if (status) { status.textContent = ''; }

  var cbName = '_clearAllLootCb' + Date.now();
  window[cbName] = function(result) {
    delete window[cbName];
    if (result && result.success) {
      fetchPastedLootSummary(function(summary) {
        renderLootHistoryPanel(summary, { color: 'var(--heal)', text: 'All loot history cleared.' });
      });
    } else {
      if (btn)    { btn.disabled = false; btn.textContent = 'Clear All Loot History'; }
      if (status) { status.style.color = 'var(--melee)'; status.textContent = 'Clear failed.'; }
    }
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    if (btn)    { btn.disabled = false; btn.textContent = 'Clear All Loot History'; }
    if (status) { status.style.color = 'var(--melee)'; status.textContent = 'Clear failed.'; }
  };
  script.src = WEB_APP_URL + '?action=clearAllPastedLoot&callback=' + cbName;
  document.head.appendChild(script);
}

// Legacy alias — called by old code paths that still reference buildLootImportTab
function buildLootImportTab() { buildLootImportForm(); }
