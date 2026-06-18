var _auditEntries = [];

function buildAuditTab() {
  var container = document.getElementById('auditContainer');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">Loading audit log...</p>';

  var cbName = '_getAuditLogCb';
  window[cbName] = function(result) {
    delete window[cbName];
    _auditEntries = (result && result.entries) ? result.entries : [];
    renderAuditLog();
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    var c = document.getElementById('auditContainer');
    if (c) c.innerHTML = '<p style="color:var(--melee);font-size:1rem;margin-top:1.5rem;">Failed to load audit log.</p>';
  };
  script.src = WEB_APP_URL + '?action=getAuditLog&callback=' + cbName;
  document.head.appendChild(script);
}

function renderAuditLog() {
  var search    = (document.getElementById('auditSearch') || {}).value || '';
  var searchLow = search.trim().toLowerCase();
  var container = document.getElementById('auditContainer');
  if (!container) return;

  var entries = searchLow
    ? _auditEntries.filter(function(e) {
        return (e.changedBy || '').toLowerCase().indexOf(searchLow) !== -1
            || (e.action   || '').toLowerCase().indexOf(searchLow) !== -1
            || (e.target   || '').toLowerCase().indexOf(searchLow) !== -1;
      })
    : _auditEntries;

  if (!entries.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">'
      + (searchLow ? 'No entries match your search.' : 'No audit log entries yet.') + '</p>';
    return;
  }

  var rows = entries.map(function(e) {
    return '<tr>'
      + '<td class="audit-ts">'        + auditEsc(e.ts)              + '</td>'
      + '<td class="audit-changedby">' + auditEsc(e.changedBy)       + '</td>'
      + '<td class="audit-action">'    + auditEsc(e.action)          + '</td>'
      + '<td class="audit-target">'    + auditEsc(e.target)          + '</td>'
      + '<td class="audit-from">'      + auditFormatVal(e.oldVal)    + '</td>'
      + '<td class="audit-to">'        + auditFormatVal(e.newVal)    + '</td>'
      + '</tr>';
  }).join('');

  container.innerHTML = '<div style="font-size:0.88rem;color:var(--text-muted);margin-bottom:0.75rem;">'
    + entries.length + ' entr' + (entries.length !== 1 ? 'ies' : 'y') + '</div>'
    + '<div style="overflow-x:auto;">'
    + '<table class="roster-table audit-table" style="width:100%;">'
    + '<thead><tr>'
    + '<th style="white-space:nowrap;">Time</th>'
    + '<th>Changed By</th>'
    + '<th>Action</th>'
    + '<th>Target</th>'
    + '<th>From</th>'
    + '<th>To</th>'
    + '</tr></thead>'
    + '<tbody>' + rows + '</tbody>'
    + '</table></div>';
}

function auditEsc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function auditFormatVal(str) {
  str = String(str || '');
  if (!str) return '';
  if (/^https?:\/\//i.test(str)) {
    var display = str.length > 40 ? str.slice(0, 40) + '...' : str;
    return '<a href="' + auditEsc(str) + '" target="_blank" rel="noopener" style="color:var(--gold);">' + auditEsc(display) + '</a>';
  }
  return auditEsc(str);
}
