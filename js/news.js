// News tab (#509): a lightweight reverse-chronological "what shipped" feed for
// raiders. Source of truth is the hand-maintained news.json at the repo root
// (same authoring workflow as CHANGELOG.md) rather than anything derived from
// CHANGELOG.md itself -- changelog bullets aren't tagged by category and mix
// raider-facing and officer-only changes in the same Frontend line with no
// per-line audience marker, so filtering it would risk leaking officer-only
// tooling into this raider-facing feed. Fetched as a plain static file, not
// through Supabase -- it isn't team-scoped or written by anyone at runtime.
var NEWS_DATA = [];

function fetchNewsData() {
  return fetch('news.json')
    .then(function (res) {
      return res.ok ? res.json() : [];
    })
    .catch(function () {
      return [];
    });
}

// Display order: pinned entries first (an announcement/welcome post an
// officer wants raiders to see regardless of how old it is), then everything
// else newest-first by date.
function sortNewsNewestFirst(entries) {
  return (entries || []).slice().sort(function (a, b) {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    if (a.date === b.date) return 0;
    return a.date < b.date ? 1 : -1;
  });
}

// The chronologically newest entry regardless of pin status -- NEWS_DATA[0]
// can't be used for this once a pinned entry is sorted to the top, since a
// pin can be older than the actual latest post.
function latestNewsEntry() {
  if (!NEWS_DATA.length) return null;
  var latest = NEWS_DATA[0];
  for (var i = 1; i < NEWS_DATA.length; i++) {
    if (NEWS_DATA[i].date > latest.date) latest = NEWS_DATA[i];
  }
  return latest;
}

function loadNews() {
  return fetchNewsData().then(function (rows) {
    NEWS_DATA = sortNewsNewestFirst(rows);
    _newsManualToggle = {};
    updateNewsNavItem();
  });
}

var NEWS_CATEGORY_COLOR = {
  Feature: 'var(--heal)',
  Fix: 'var(--melee)',
  Change: 'var(--ranged)'
};

function newsCategoryBadge(category) {
  var color = NEWS_CATEGORY_COLOR[category] || 'var(--text-muted)';
  return (
    '<span class="badge news-category-badge" style="border:1px solid ' +
    color +
    ';color:' +
    color +
    ';">' +
    _esc(category) +
    '</span>'
  );
}

// Per-entry open/closed overrides, keyed by version (unique per entry) once a
// raider actually clicks a row -- everything not in here falls back to its
// default (open for a pinned entry or the single latest entry, closed
// otherwise). Reset on every loadNews() so a fresh fetch re-defaults.
var _newsManualToggle = {};

function isNewsEntryOpen(entry) {
  if (Object.prototype.hasOwnProperty.call(_newsManualToggle, entry.version)) {
    return _newsManualToggle[entry.version];
  }
  if (entry.pinned) return true;
  var latest = latestNewsEntry();
  return !!latest && latest.version === entry.version;
}

function toggleNewsEntry(idx) {
  var entry = NEWS_DATA[idx];
  if (!entry) return;
  _newsManualToggle[entry.version] = !isNewsEntryOpen(entry);
  renderNewsList();
}

function renderNewsList() {
  var container = document.getElementById('newsView');
  if (!container) return;
  if (!NEWS_DATA.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No news yet.</p>';
    return;
  }
  var html = '<div class="news-list">';
  for (var i = 0; i < NEWS_DATA.length; i++) {
    var entry = NEWS_DATA[i];
    var open = isNewsEntryOpen(entry);
    html +=
      '<div class="news-entry' +
      (open ? ' news-entry-open' : '') +
      (entry.pinned ? ' news-entry-pinned' : '') +
      '"><button class="news-entry-header" onclick="toggleNewsEntry(' +
      i +
      ')">' +
      (entry.pinned ? '<span class="news-pin-icon" title="Pinned">&#128204;</span>' : '') +
      '<span class="news-entry-date">' +
      _esc(entry.date) +
      '</span>' +
      newsCategoryBadge(entry.category) +
      '<span class="news-entry-version">v' +
      _esc(entry.version) +
      '</span>' +
      '<span class="news-entry-title">' +
      _esc(entry.title) +
      '</span>' +
      '<span class="news-entry-chevron">&#9660;</span>' +
      '</button>';
    if (open) {
      html += '<div class="news-entry-body">' + _esc(entry.body) + '</div>';
    }
    html += '</div>';
  }
  html += '</div>';
  container.innerHTML = html;
}

function buildNewsTab() {
  renderNewsList();
}

var NEWS_SEEN_KEY = 'wga_news_last_seen';

function getNewsLastSeen() {
  try {
    return localStorage.getItem(NEWS_SEEN_KEY) || '';
  } catch (_) {
    return '';
  }
}

function setNewsLastSeen(version) {
  try {
    localStorage.setItem(NEWS_SEEN_KEY, version);
  } catch (_) {}
}

// Keyed on the newest entry's version, not its date -- multiple entries
// commonly share the same authoring date (everything shipped today is dated
// today), so a plain date comparison could never flag a same-day entry added
// after a raider already visited the tab once. version is unique per entry
// (CI enforces a VERSION bump per frontend PR), so an exact mismatch is a
// reliable "there's something new" signal regardless of dates. Uses
// latestNewsEntry(), not NEWS_DATA[0] -- a pinned entry sorts to the top
// without necessarily being the newest one.
function updateNewsNavItem() {
  var dot = document.getElementById('navNewsDot');
  if (!dot) return;
  var latest = latestNewsEntry();
  var newestVersion = latest ? latest.version : '';
  dot.style.display = newestVersion && newestVersion !== getNewsLastSeen() ? '' : 'none';
}

// Marks the newest entry as seen (called when a raider actually visits the
// News tab) and hides the dot immediately, rather than waiting for the next
// updateNewsNavItem() call.
function markNewsSeen() {
  var latest = latestNewsEntry();
  if (!latest) return;
  setNewsLastSeen(latest.version);
  updateNewsNavItem();
}
