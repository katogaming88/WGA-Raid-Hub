// ── Import sub-tab (Supabase, #219) ─────────────────────────────────────────
//
// submitLootImport() carries every field import_rclc_loot() (migration
// 20260709180000) needs straight through from the RCLC paste -- date/time,
// itemID, boss, instance -- instead of the old GAS path's minimal
// id/player/date/itemName/instance subset. The RPC does its own date
// parsing (accepts RCLC's "YYYY/MM/DD" as-is) and player/item resolution
// server-side, so there's no client-side reshaping needed beyond picking the
// fields off each entry. One RPC call per paste, not chunked -- a raid
// night's export is at most a couple hundred entries, well within a normal
// request body, and the old GAS chunking was worked around Apps Script's own
// URL-length limits (JSONP GET), which don't apply to a POST through
// supabase-js.

function buildLootImportForm() {
  var el = document.getElementById('loot-sub-import');
  if (!el) return;

  // #607: loot import is excluded for a guild-officer-only visitor (the
  // RCLC dedupe key is per-team and a mixed-team paste can't be caught by
  // it, so this stays blocked even for otherwise-full-access surfaces).
  if (window._guildOfficerAccessLevel === 'guild') {
    el.innerHTML =
      '<p class="signup-officer-note">Loot import is not available for guild officer access on a team you are not an officer of.</p>';
    return;
  }

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
    '<strong>Season reset:</strong> update Season Name in Season Settings before re-importing so new entries are tagged with the new season -- past seasons stay in the loot feed under their own label, filterable there.';
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
  html += '<span id="lootImportStatus" style="font-size:1.04rem;"></span>';
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
    var instance = String(e.instance || '').trim();
    if (!id || !player || !instance) continue;
    rows.push({
      id: id,
      player: player,
      date: String(e.date || '').trim(),
      time: String(e.time || '').trim(),
      itemID: e.itemID != null ? e.itemID : null,
      itemName: String(e.itemName || '').trim(),
      // itemString carries the item's own bonus IDs, which import_rclc_loot()
      // now prefers over the instance string for track detection -- the
      // bonus IDs are baked into the item at generation and can't drift the
      // way the instance/boss text can when loot is passed out after the
      // raid has already moved to a different pull (20260829200033).
      itemString: String(e.itemString || '').trim(),
      instance: instance,
      boss: String(e.boss || '').trim(),
      response: String(e.response || '').trim()
    });
  }

  if (rows.length === 0) {
    setLootImportStatus(
      'No valid entries found -- check that the JSON has id, player, and instance fields.',
      'var(--melee)'
    );
    return;
  }

  // rclc_loot.season stores the compact code ('MID1'), same convention as
  // priority_order.season/scoring.season (see js/common.js's
  // seasonCodeForDisplay block comment) -- this used to write the raw
  // display name straight through, which is why season_loot_pace's season
  // dropdown showed "Midnight Season 1" twice (once as the correctly-coded
  // "MID1" translated back for display, once as the raw un-translated
  // string sitting in the same column).
  var season = window.DATA && DATA.seasonName ? seasonCodeForDisplay(DATA.seasonName.trim()) : '';

  setLootImportStatus('Importing ' + rows.length + ' entries...', 'var(--text-muted)');

  supabaseClient
    .rpc('import_rclc_loot', { p_team_id: _teamCfg.supabaseTeamId, p_season: season, p_rows: rows })
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);
      var counts = result.data || {};
      var inserted = counts.inserted || 0;
      var skipped = counts.skipped_duplicate || 0;
      var unresolved = counts.unresolved_item || 0;
      var msg = 'Done. ' + inserted + ' new entries added';
      if (skipped > 0) msg += ', ' + skipped + ' duplicates skipped';
      if (unresolved > 0) msg += ', ' + unresolved + ' with an unresolved item (check Item Lookup)';
      msg += '.';
      setLootImportStatus(msg, 'var(--heal)');
      // Newly imported loot can make a saved Mythic #1 stale (player already
      // has the Heroic version) -- refresh that check now so the Priority
      // nav badge reflects it immediately, since an officer may not visit
      // the Priority tab this session otherwise.
      if (typeof refreshPriorityStaleBadge === 'function') refreshPriorityStaleBadge();
    })
    .catch(function (err) {
      setLootImportStatus('Import failed: ' + err.message, 'var(--melee)');
    });
}

function setLootImportStatus(text, color) {
  var el = document.getElementById('lootImportStatus');
  if (!el) return;
  el.style.color = color || 'var(--text-muted)';
  el.textContent = text;
}

// ── Import History sub-tab (Supabase, #219) ─────────────────────────────────
//
// Sourced from audit_log rather than rclc_loot directly: every successful
// import already logs one 'Loot Imported (RCLC)' entry per row (player as
// TARGET, "track - item name" as DETAIL), and -- critically -- only genuine
// paste-imports ever produce that action. rclc_loot itself can't tell a
// paste-imported row apart from the separate legacy-tracker rows the #320
// historical import already merged in, so querying it directly here would
// misrepresent old history as recent imports. No "Clear All" in this
// version for the same reason: there's no safe way yet to select only
// paste-imported rows for deletion (see docs/database-decisions.md).
//
// Grouped into one row per *import event*, not one row per item -- a single
// paste can add dozens of rows, and the per-item table used to bury "did my
// paste go through" under a long item list. Every row from one
// import_rclc_loot() call shares the exact same audit_log.created_at:
// that column defaults to now(), and Postgres freezes now() for the whole
// transaction, so every write_audit_log() call inside the same RPC
// invocation gets an identical timestamp down to the microsecond -- grouping
// on (actor_id, created_at) reliably reconstructs "one paste" with no new
// column needed.
// Module state for the click-to-expand per-player breakdown and season
// filter below -- resolved once up front alongside the grouped rows, so
// expanding a row or switching seasons is a pure re-render, no extra fetch.
var _lootHistoryImports = [];
var _lootHistoryPlayerNames = {};
var _lootHistoryActorNames = {};
var _lootHistorySeasonFilter = '';
// Rows written before 20260822203445_import_rclc_loot_audit_season.sql kept
// their old plain-string detail with no season recorded -- there's no
// reliable way to match one of those back to the specific rclc_loot row it
// came from after the fact (see that migration's header comment), so they
// sit in this bucket rather than being silently dropped or misattributed to
// whichever season happens to be active now.
var LOOT_HISTORY_UNKNOWN_SEASON = '__unknown__';

function buildLootHistoryTab() {
  var el = document.getElementById('loot-sub-history');
  if (!el) return;
  el.innerHTML = '<p style="font-size:1.04rem;color:var(--text-muted);padding:0.5rem 0;">Loading...</p>';
  if (!supabaseClient) {
    el.innerHTML = '<p style="font-size:1.04rem;color:var(--melee);padding:0.5rem 0;">Not connected to Supabase.</p>';
    return;
  }

  var teamId = _teamCfg.supabaseTeamId;
  _lootHistorySeasonFilter = window.DATA && DATA.seasonName ? seasonCodeForDisplay(DATA.seasonName.trim()) : '';
  // Every import ever run, not a capped recent window -- fetchAllPaged
  // (js/common.js, same cursor-by-id pattern as the Audit Log tab) rather
  // than a single limited select, since a season's worth of imports can
  // exceed Supabase's per-request row cap.
  fetchAllPaged(
    function (afterId, limit) {
      var q = supabaseClient
        .from('audit_log')
        .select(
          'id, actor_id, target_type, target_id, detail, created_at',
          afterId === null ? { count: 'exact' } : undefined
        )
        .eq('team_id', teamId)
        .eq('action', 'Loot Imported (RCLC)')
        .order('id', { ascending: true })
        .limit(limit);
      return afterId === null ? q : q.gt('id', afterId);
    },
    { label: 'loot import history' }
  ).then(function (rows) {
    if (rows === null) {
      el.innerHTML =
        '<p style="font-size:1.04rem;color:var(--melee);padding:0.5rem 0;">Could not load import history.</p>';
      return;
    }
    var imports = groupLootImportEvents(rows);
    return Promise.all([resolveAuditActorNames(imports, teamId), resolveAuditTargetNames(rows, teamId)]).then(
      function (maps) {
        _lootHistoryImports = imports;
        _lootHistoryPlayerNames = maps[1];
        renderLootHistoryPanel(maps[0]);
      }
    );
  });
}

// Collapses raw per-item audit_log rows into one entry per (actor_id,
// created_at) group -- every row from one import_rclc_loot() call shares the
// exact same created_at (see the block comment above), so that pair
// reliably reconstructs "one paste" with no new column needed. Sorted
// newest-first for display; rows arrive id-ascending from the paged fetch,
// so each group's own playerItems stay in original insertion order too.
function groupLootImportEvents(rows) {
  var order = [];
  var byKey = {};
  rows.forEach(function (row) {
    var key = (row.actor_id || 'unknown') + '|' + row.created_at;
    if (!byKey[key]) {
      var season =
        row.detail && typeof row.detail === 'object' && row.detail.season
          ? row.detail.season
          : LOOT_HISTORY_UNKNOWN_SEASON;
      byKey[key] = {
        actor_id: row.actor_id,
        created_at: row.created_at,
        season: season,
        itemCount: 0,
        playerItems: {}
      };
      order.push(key);
    }
    var group = byKey[key];
    group.itemCount++;
    if (row.target_type === 'players' && row.target_id != null) {
      if (!group.playerItems[row.target_id]) group.playerItems[row.target_id] = [];
      group.playerItems[row.target_id].push(lootImportItemSummary(row.detail));
    }
  });
  return order
    .map(function (key) {
      return byKey[key];
    })
    .sort(function (a, b) {
      return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
    });
}

// audit_log.detail for a 'Loot Imported (RCLC)' row is either a plain string
// (rows written before 20260822163718_import_rclc_loot_audit_season.sql) or
// {summary, season} (that migration on). Either way, `summary` is already
// "<Track> - <item name>", exactly what belongs in a per-player item list.
function lootImportItemSummary(detail) {
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object' && detail.summary) return detail.summary;
  return 'Unknown item';
}

function lootHistorySeasonLabel(season) {
  if (season === LOOT_HISTORY_UNKNOWN_SEASON) return 'Unknown season (imported before season tracking)';
  return (typeof seasonDisplayName === 'function' && seasonDisplayName(season)) || season;
}

function setLootHistorySeasonFilter(season) {
  _lootHistorySeasonFilter = season;
  renderLootHistoryPanel(_lootHistoryActorNames);
}

function renderLootHistoryPanel(actorNames) {
  var el = document.getElementById('loot-sub-history');
  if (!el) return;
  _lootHistoryActorNames = actorNames;

  var allImports = _lootHistoryImports;
  var seasons = reportsUniqueSorted(
    allImports.map(function (imp) {
      return imp.season;
    }),
    function (a, b) {
      if (a === LOOT_HISTORY_UNKNOWN_SEASON) return 1;
      if (b === LOOT_HISTORY_UNKNOWN_SEASON) return -1;
      return a < b ? 1 : a > b ? -1 : 0;
    }
  );
  // The season computed at load time (the currently active one) may not
  // actually appear in this team's import history yet -- e.g. Season Settings
  // has no name set, or nothing's been imported this season -- fall back to
  // the most recent season that does.
  if (seasons.length && seasons.indexOf(_lootHistorySeasonFilter) === -1) {
    _lootHistorySeasonFilter = seasons[0];
  }
  var imports = allImports.filter(function (imp) {
    return imp.season === _lootHistorySeasonFilter;
  });

  // .signup-officer-panel's shared max-width:400px (css/styles.css) is
  // sized for the form-like panels it was built for elsewhere in this tab --
  // too narrow for a data table, so this instance overrides it wider.
  var html = '<div class="signup-officer-panel" style="max-width:none;">';
  html +=
    '<div class="signup-status-row"><span class="signup-status-label">Recent RCLC Imports<button class="help-btn" onclick="toggleHelp(\'help-loot-history\')" title="Show help">?</button></span></div>';
  html += '<div id="help-loot-history" class="help-tip" style="margin-bottom:0.5rem;">';
  html +=
    'Every paste imported via the Import tab, grouped into one row per import so an officer can confirm a paste went through and see who ran it. Click a row to see who received what from that import. Sourced from the audit log.';
  html += '</div>';

  if (seasons.length) {
    html +=
      '<div style="margin:0.5rem 0;"><select id="lootHistorySeasonFilter" onchange="setLootHistorySeasonFilter(this.value)">';
    html += seasons
      .map(function (s) {
        return (
          '<option value="' +
          escHtml(s) +
          '"' +
          (s === _lootHistorySeasonFilter ? ' selected' : '') +
          '>' +
          escHtml(lootHistorySeasonLabel(s)) +
          '</option>'
        );
      })
      .join('');
    html += '</select></div>';
  }

  if (!allImports.length) {
    html +=
      '<p class="signup-officer-note" style="margin-top:0.35rem;">No loot imported yet. Go to the <a href="#" onclick="switchLootSubTab(\'import\', document.getElementById(\'loot-subtab-btn-import\'));return false;">Import</a> tab to add entries.</p>';
    html += '</div>';
    el.innerHTML = html;
    return;
  }

  if (!imports.length) {
    html += '<p class="signup-officer-note" style="margin-top:0.35rem;">No loot imported for this season yet.</p>';
    html += '</div>';
    el.innerHTML = html;
    return;
  }

  html +=
    '<div style="font-size:1rem;color:var(--text-muted);margin:0.5rem 0;">' +
    imports.length +
    ' import' +
    (imports.length !== 1 ? 's' : '') +
    '</div>';
  html += localTimeZoneNote();
  html +=
    '<div style="overflow-x:auto;"><table class="roster-table" style="width:100%;"><thead><tr><th></th><th>Time</th><th>Imported By</th><th># of Items</th></tr></thead><tbody>';
  imports.forEach(function (imp, idx) {
    var importedBy = imp.actor_id ? actorNames[imp.actor_id] || '' : '';
    html +=
      '<tr style="cursor:pointer;" onclick="toggleLootHistoryDetail(' +
      idx +
      ')"><td id="loot-history-caret-' +
      idx +
      '" style="width:1.5rem;color:var(--text-muted);">&#9656;</td><td style="white-space:nowrap;">' +
      escHtml(auditFormatTs(imp.created_at)) +
      '</td><td>' +
      escHtml(importedBy) +
      '</td><td>' +
      imp.itemCount +
      '</td></tr>';
    html +=
      '<tr id="loot-history-detail-' +
      idx +
      '" style="display:none;"><td></td><td colspan="3">' +
      lootHistoryDetailHtml(imp) +
      '</td></tr>';
  });
  html += '</tbody></table></div>';
  html += '</div>';

  el.innerHTML = html;
}

// Turns one audit detail summary ("<Track> - <Item Name>", or a bare item
// name/"Unknown item" for rows with no resolvable track) into a Wowhead
// hover-tooltip link, same icon+link pattern as officerWishlistRowHTML()
// in js/common.js -- looked up by name against DATA.itemWowIds/itemIcons
// (populated once at load, shared across every tab) since audit_log only
// ever stored the item's name, not its id. Falls back to plain escaped text
// when the name doesn't resolve (an off-list item, or "Unknown item").
function lootImportItemLinkHtml(summary) {
  var track = '';
  var name = summary;
  var m = /^(Champion|Hero|Myth) - (.+)$/.exec(summary);
  if (m) {
    track = m[1];
    name = m[2];
  }
  var trackPrefix = track ? escHtml(track) + ' - ' : '';
  var wowId = ((DATA && DATA.itemWowIds) || {})[name];
  var icon = ((DATA && DATA.itemIcons) || {})[name];
  var isPtr = ((DATA && DATA.itemIsPtr) || {})[name];
  var iconImg = icon
    ? '<img src="https://wow.zamimg.com/images/wow/icons/large/' +
      icon +
      '.jpg" alt="" class="item-icon-sm" style="vertical-align:middle;margin-right:0.3rem;">'
    : '';
  if (wowId == null) {
    return trackPrefix + escHtml(name);
  }
  return (
    trackPrefix +
    '<a href="https://www.wowhead.com/' +
    (isPtr ? 'ptr/' : '') +
    'item=' +
    wowId +
    '" class="wowhead" target="_blank" rel="noopener" style="text-decoration:none;">' +
    iconImg +
    escHtml(name) +
    '</a>'
  );
}

// Name + item list per player for one import, sourced entirely from data
// already fetched by buildLootHistoryTab -- expanding a row is a pure
// re-render, no additional round trip.
function lootHistoryDetailHtml(imp) {
  var playerIds = Object.keys(imp.playerItems);
  if (!playerIds.length) {
    return '<p class="signup-officer-note" style="margin:0.35rem 0;">No player breakdown available for this import.</p>';
  }
  var rows = playerIds
    .map(function (id) {
      return { name: _lootHistoryPlayerNames[id] || 'Unknown', items: imp.playerItems[id] };
    })
    .sort(function (a, b) {
      return b.items.length - a.items.length || a.name.localeCompare(b.name);
    });
  // One block per player, each listing their items -- not a flowing grid
  // like the old count-only view, since item lists vary too much in length
  // to line up in columns. text-align:left overrides the .roster-table
  // td:not(:first-child) center-alignment this cell (2nd td, colspan 3)
  // would otherwise inherit.
  var html = '<div style="text-align:left;margin:0.35rem 0;display:flex;flex-direction:column;gap:0.5rem;">';
  rows.forEach(function (r) {
    html +=
      '<div style="font-size:0.98rem;"><strong>' +
      escHtml(r.name) +
      '</strong> <span style="color:var(--text-muted);">(' +
      r.items.length +
      ')</span><ul style="margin:0.15rem 0 0 1.25rem;padding:0;color:var(--text-muted);">';
    r.items.forEach(function (item) {
      html += '<li>' + lootImportItemLinkHtml(item) + '</li>';
    });
    html += '</ul></div>';
  });
  html += '</div>';
  return html;
}

function toggleLootHistoryDetail(idx) {
  var row = document.getElementById('loot-history-detail-' + idx);
  var caret = document.getElementById('loot-history-caret-' + idx);
  if (!row) return;
  var isOpen = row.style.display !== 'none';
  row.style.display = isOpen ? 'none' : '';
  if (caret) caret.innerHTML = isOpen ? '&#9656;' : '&#9662;';
}

// Legacy alias — called by old code paths that still reference buildLootImportTab
function buildLootImportTab() {
  buildLootImportForm();
}

// ── Reassign sub-tab (#1029) ─────────────────────────────────────────────────
//
// Corrects which player a raid-awarded rclc_loot row is attributed to, for
// the case where loot council awarded it to one raider and it was then
// traded in-game per a prior agreement. rclc_loot already has a full officer
// RLS write policy (USING/WITH CHECK on my_team_role in officer/team_leader,
// or is_site_admin -- no is_guild_officer() clause), so this is a plain
// client UPDATE plus an audit log entry, same as toggleReportExcluded()
// (js/tabs/tab-attendance.js) -- no new RPC or migration needed. The
// "received" badges elsewhere (getLootEntry()/DATA.lootCounts) are computed
// live from rclc_loot at render time, not a separately-synced flag, so the
// correction is visible everywhere else the next time that data loads.
var _lootReassignRows = [];
var _lootReassignPlayerId = null;

function buildLootReassignTab() {
  var el = document.getElementById('loot-sub-reassign');
  if (!el) return;

  // Same restriction as buildLootImportForm() -- rclc_loot's officer write
  // policy has no is_guild_officer() clause, so a guild-officer-only visitor
  // (not an officer of this specific team) would fail the write silently at
  // the RLS layer; this says so up front instead of a confusing DB error.
  if (window._guildOfficerAccessLevel === 'guild') {
    el.innerHTML =
      '<p class="signup-officer-note">Loot reassignment is not available for guild officer access on a team you are not an officer of.</p>';
    return;
  }

  var roster = (window.DATA && DATA.roster) || [];
  var sorted = roster.slice().sort(function (a, b) {
    return (a.nick || a.firstName).localeCompare(b.nick || b.firstName);
  });

  var html = '<div class="signup-officer-panel" style="max-width:none;">';
  html +=
    '<div class="signup-status-row"><span class="signup-status-label">Reassign Loot<button class="help-btn" onclick="toggleHelp(\'help-loot-reassign\')" title="Show help">?</button></span></div>';
  html += '<div id="help-loot-reassign" class="help-tip">';
  html +=
    "For when loot council awarded an item to one raider and it was then traded in-game to someone else. Pick who the item is currently attributed to, find the item, and reassign it. This changes history -- everywhere that raider's received items are shown (Priority List, BiS, this list) reflects the correction immediately.";
  html += '</div>';
  html += '<div style="margin:0.5rem 0;display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">';
  html += '<label for="lootReassignPlayerSelect" style="font-size:1.02rem;">Currently credited to:</label>';
  html += '<select id="lootReassignPlayerSelect" onchange="loadLootForReassign(this.value)">';
  html += '<option value="">-- Select a player --</option>';
  for (var i = 0; i < sorted.length; i++) {
    var p = sorted[i];
    html +=
      '<option value="' + p.id + '">' + escHtml(p.nick ? p.nick + ' (' + p.firstName + ')' : p.firstName) + '</option>';
  }
  html += '</select>';
  html += '</div>';
  html += '<div id="lootReassignContent"></div>';
  html += '</div>';
  el.innerHTML = html;
}

// Every raid-awarded item for one player, not season-filtered -- a trade an
// officer needs to correct could be from an earlier season, and the list is
// one player's history at a time so it never grows large enough to need it.
function loadLootForReassign(playerId) {
  var content = document.getElementById('lootReassignContent');
  if (!content) return;
  _lootReassignPlayerId = playerId || null;
  if (!playerId) {
    content.innerHTML = '';
    return;
  }
  content.innerHTML = '<p style="font-size:1.02rem;color:var(--text-muted);padding:0.5rem 0;">Loading...</p>';

  fetchAllPaged(
    function (afterId, limit) {
      var q = supabaseClient
        .from('rclc_loot')
        .select(
          'id, item_id, track, season, awarded_at, items(name)',
          afterId === null ? { count: 'exact' } : undefined
        )
        .eq('team_id', _teamCfg.supabaseTeamId)
        .eq('player_id', playerId)
        .order('id', { ascending: true })
        .limit(limit);
      return afterId === null ? q : q.gt('id', afterId);
    },
    { label: 'loot for reassign' }
  ).then(function (rows) {
    if (_lootReassignPlayerId !== playerId) return; // player changed while this was in flight
    if (rows === null) {
      content.innerHTML =
        '<p style="font-size:1.02rem;color:var(--melee);padding:0.5rem 0;">Could not load this player\'s loot.</p>';
      return;
    }
    _lootReassignRows = rows.slice().sort(function (a, b) {
      return a.awarded_at < b.awarded_at ? 1 : a.awarded_at > b.awarded_at ? -1 : 0;
    });
    renderLootReassignRows();
  });
}

function renderLootReassignRows() {
  var content = document.getElementById('lootReassignContent');
  if (!content) return;
  if (!_lootReassignRows.length) {
    content.innerHTML =
      '<p class="signup-officer-note" style="margin-top:0.5rem;">No raid-awarded loot on file for this player.</p>';
    return;
  }
  var html =
    '<div style="overflow-x:auto;margin-top:0.5rem;"><table class="roster-table" style="width:100%;"><thead><tr><th>Item</th><th>Track</th><th>Season</th><th>Date</th><th></th></tr></thead><tbody>';
  for (var i = 0; i < _lootReassignRows.length; i++) {
    var row = _lootReassignRows[i];
    var itemName = row.items && row.items.name ? row.items.name : 'Unknown Item';
    var trackLabel = row.track === 'Myth' ? 'Mythic' : row.track === 'Hero' ? 'Heroic' : row.track || '';
    var dateLabel = row.awarded_at ? auditFormatTs(row.awarded_at) : '';
    html +=
      '<tr id="loot-reassign-row-' +
      row.id +
      '"><td style="text-align:left;">' +
      escHtml(itemName) +
      '</td><td>' +
      escHtml(trackLabel) +
      '</td><td>' +
      escHtml(seasonDisplayName(row.season) || row.season || '') +
      '</td><td style="white-space:nowrap;">' +
      escHtml(dateLabel) +
      '</td><td><button class="btn btn-muted" style="font-size:0.91rem;padding:2px 7px;" onclick="showLootReassignForm(' +
      row.id +
      ')">Reassign</button></td></tr>';
    html += '<tr id="loot-reassign-form-' + row.id + '" style="display:none;"><td colspan="5"></td></tr>';
  }
  html += '</tbody></table></div>';
  content.innerHTML = html;
}

function showLootReassignForm(rowId) {
  var formRow = document.getElementById('loot-reassign-form-' + rowId);
  if (!formRow) return;
  var cell = formRow.querySelector('td');
  if (formRow.style.display !== 'none') {
    formRow.style.display = 'none';
    return;
  }

  var roster = (window.DATA && DATA.roster) || [];
  var options = roster
    .filter(function (p) {
      return String(p.id) !== String(_lootReassignPlayerId);
    })
    .sort(function (a, b) {
      return (a.nick || a.firstName).localeCompare(b.nick || b.firstName);
    });

  var html = '<div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;justify-content:center;">';
  html += '<span style="font-size:1.02rem;">Reassign to:</span>';
  html += '<select id="loot-reassign-target-' + rowId + '">';
  html += '<option value="">-- Select a player --</option>';
  for (var i = 0; i < options.length; i++) {
    var p = options[i];
    html +=
      '<option value="' + p.id + '">' + escHtml(p.nick ? p.nick + ' (' + p.firstName + ')' : p.firstName) + '</option>';
  }
  html += '</select>';
  html +=
    '<button class="btn btn-gold" style="font-size:0.97rem;padding:0.2rem 0.6rem;" onclick="submitLootReassign(' +
    rowId +
    ')">Confirm</button>';
  html +=
    '<button class="btn btn-muted" style="font-size:0.97rem;padding:0.2rem 0.6rem;" onclick="document.getElementById(\'loot-reassign-form-' +
    rowId +
    "').style.display='none'\">Cancel</button>";
  html += '<span id="loot-reassign-ind-' + rowId + '" style="font-size:0.97rem;"></span>';
  html += '</div>';
  cell.innerHTML = html;
  formRow.style.display = '';
}

function submitLootReassign(rowId) {
  var targetSel = /** @type {HTMLSelectElement} */ (document.getElementById('loot-reassign-target-' + rowId));
  var ind = document.getElementById('loot-reassign-ind-' + rowId);
  var newPlayerId = targetSel ? targetSel.value : '';
  if (!newPlayerId) {
    if (targetSel) targetSel.style.borderColor = 'var(--melee)';
    return;
  }

  var row = _lootReassignRows.filter(function (r) {
    return String(r.id) === String(rowId);
  })[0];
  var itemName = row && row.items && row.items.name ? row.items.name : 'Unknown Item';

  var roster = (window.DATA && DATA.roster) || [];
  var oldPlayer = roster.filter(function (p) {
    return String(p.id) === String(_lootReassignPlayerId);
  })[0];
  var newPlayer = roster.filter(function (p) {
    return String(p.id) === String(newPlayerId);
  })[0];
  var oldName = oldPlayer ? oldPlayer.nick || oldPlayer.firstName : 'Unknown';
  var newName = newPlayer ? newPlayer.nick || newPlayer.firstName : 'Unknown';

  if (targetSel) targetSel.disabled = true;
  if (ind) {
    ind.textContent = 'Saving...';
    ind.style.color = 'var(--text-muted)';
  }

  supabaseClient
    .from('rclc_loot')
    .update({ player_id: newPlayerId })
    .eq('id', rowId)
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);
      return writeAuditLog('Loot Reassigned', 'players', newPlayerId, itemName + ': ' + oldName + ' -> ' + newName);
    })
    .then(function () {
      // Drop the row from this player's list -- it belongs to newPlayerId now.
      _lootReassignRows = _lootReassignRows.filter(function (r) {
        return String(r.id) !== String(rowId);
      });
      renderLootReassignRows();
    })
    .catch(function (err) {
      if (targetSel) targetSel.disabled = false;
      console.warn('Failed to reassign loot.', err);
      if (ind) {
        ind.textContent = 'Error: ' + err.message;
        ind.style.color = 'var(--melee)';
      }
    });
}
