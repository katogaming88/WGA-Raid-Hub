// #286: guild-wide Twitch streams (landing page section + Streamers tab).
//
// MOCK DATA: supabase-js isn't wired into the frontend yet (see supabase/migrations/
// 20260705000000_streamers.sql for the real schema). MOCK_STREAMERS stands in for a
// `select * from streamers` read -- public/no-secret, so swapping it for a real
// Supabase client call later shouldn't need to change anything below this block.
// team_slug spans both teams because Guild Streams need to see across teams, which
// today's per-team GAS silos can't do -- that's the reason this feature needs Supabase.
var MOCK_STREAMERS = [
  {
    id: 1,
    team_slug: 'phoenix',
    player_first_name: 'Kato',
    display_name: 'Kato Gaming',
    twitch_channel: 'katogaming',
    schedule_note: 'Raids Tue/Thu 8pm ET, farm runs on weekends.',
    guild_wide_opt_out: false,
    is_live: true
  },
  {
    id: 2,
    team_slug: 'phoenix',
    player_first_name: 'Ashlynn',
    display_name: 'AshlynnTV',
    twitch_channel: 'ashlynntv',
    schedule_note: '',
    guild_wide_opt_out: false,
    is_live: false
  },
  {
    id: 3,
    team_slug: 'hellfire',
    player_first_name: 'Brakka',
    display_name: 'BrakkaBoom',
    twitch_channel: 'brakkaboom',
    schedule_note: 'VODs posted the next day.',
    guild_wide_opt_out: false,
    is_live: true
  },
  {
    id: 4,
    team_slug: 'hellfire',
    player_first_name: 'Novabyte',
    display_name: 'Novabyte',
    twitch_channel: 'novabyte',
    schedule_note: '',
    guild_wide_opt_out: true,
    is_live: false
  }
];

function getTeamStreamers() {
  return MOCK_STREAMERS.filter(function (s) {
    return s.team_slug === TEAM_SLUG;
  });
}

function getGuildStreamers() {
  return MOCK_STREAMERS.filter(function (s) {
    return s.team_slug !== TEAM_SLUG && !s.guild_wide_opt_out;
  });
}

function getVisibleStreamers() {
  return getTeamStreamers().concat(getGuildStreamers());
}

function getOwnStreamer(firstName) {
  var norm = normalise(firstName);
  for (var i = 0; i < MOCK_STREAMERS.length; i++) {
    var s = MOCK_STREAMERS[i];
    if (s.team_slug === TEAM_SLUG && normalise(s.player_first_name) === norm) return s;
  }
  return null;
}

function twitchEmbedSrc(channel) {
  var parent = location.hostname || 'localhost';
  return (
    'https://player.twitch.tv/?channel=' +
    encodeURIComponent(channel) +
    '&parent=' +
    encodeURIComponent(parent) +
    '&muted=true'
  );
}

function formatLiveBannerText(streamers) {
  var live = streamers.filter(function (s) {
    return s.is_live;
  });
  if (!live.length) return '';
  var names = live.map(function (s) {
    return s.display_name;
  });
  if (names.length === 1) return names[0] + ' is live!';
  if (names.length === 2) return names[0] + ' and ' + names[1] + ' are live!';
  return names[0] + ', ' + names[1] + ', and ' + (names.length - 2) + ' more are live!';
}

function streamerCardHTML(s, opts) {
  opts = opts || {};
  var big = !!opts.big;
  var player = null;
  if (s.team_slug === TEAM_SLUG) {
    for (var i = 0; i < (DATA.roster || []).length; i++) {
      if (normalise(DATA.roster[i].firstName) === normalise(s.player_first_name)) {
        player = DATA.roster[i];
        break;
      }
    }
  }
  var profileLink = player
    ? '<a href="javascript:void(0)" onclick="showView(\'profile\');renderProfile(\'' +
      player.firstName.replace(/'/g, "\\'") +
      '\',\'landing\')" class="stream-profile-link">View profile</a>'
    : '';

  return (
    '<div class="stream-card' +
    (big ? ' stream-card-big' : '') +
    '">' +
    '<div class="stream-embed-wrap">' +
    '<iframe class="stream-iframe" data-src="' +
    twitchEmbedSrc(s.twitch_channel) +
    '" frameborder="0" allowfullscreen scrolling="no" loading="lazy"></iframe>' +
    '</div>' +
    '<div class="stream-card-body">' +
    '<div class="stream-card-header">' +
    '<span class="stream-name">' +
    s.display_name +
    '</span>' +
    (s.is_live ? '<span class="stream-live-dot" title="Live now"></span>' : '') +
    '<a class="stream-twitch-link" href="https://twitch.tv/' +
    encodeURIComponent(s.twitch_channel) +
    '" target="_blank" rel="noopener">twitch.tv/' +
    s.twitch_channel +
    '</a>' +
    '</div>' +
    (s.schedule_note ? '<p class="stream-note">' + s.schedule_note + '</p>' : '') +
    (profileLink ? '<div class="stream-card-footer">' + profileLink + '</div>' : '') +
    '</div>' +
    '</div>'
  );
}

// Embeds only load once their card actually scrolls into view -- avoids
// spinning up an iframe per streamer for a roster nobody is looking at yet.
function observeStreamEmbeds(root) {
  var iframes = (root || document).querySelectorAll('.stream-iframe[data-src]');
  if (!iframes.length) return;
  if (typeof IntersectionObserver === 'undefined') {
    iframes.forEach(function (f) {
      f.src = f.dataset.src;
      f.removeAttribute('data-src');
    });
    return;
  }
  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var f = entry.target;
        f.src = f.dataset.src;
        f.removeAttribute('data-src');
        observer.unobserve(f);
      });
    },
    { rootMargin: '200px' }
  );
  iframes.forEach(function (f) {
    observer.observe(f);
  });
}

// Top banner: plain "X is live!" text, shown on every page (unlike the widget
// below, it isn't hidden on the Streams/Signup tabs -- it's just a heads-up).
function buildLiveTopbar() {
  var el = document.getElementById('streamLiveTopbar');
  if (!el) return;
  var text = formatLiveBannerText(getVisibleStreamers());
  if (!text) {
    el.style.display = 'none';
    el.textContent = '';
    return;
  }
  el.textContent = text;
  el.style.display = '';
}

var STREAM_WIDGET_COLLAPSE_KEY = 'wga_stream_widget_collapsed';
var _streamWidgetCollapseApplied = false;

function isStreamWidgetCollapsed() {
  try {
    return localStorage.getItem(STREAM_WIDGET_COLLAPSE_KEY) === '1';
  } catch (_) {
    return false;
  }
}

function setStreamWidgetCollapsed(collapsed) {
  try {
    localStorage.setItem(STREAM_WIDGET_COLLAPSE_KEY, collapsed ? '1' : '0');
  } catch (_) {}
}

// Floating widget: always present (site-wide), expanded by default but
// remembers the user's collapse/expand choice across page loads.
// It only surfaces streamers who are currently live -- the full roster (live +
// offline) still lives on the Streamers tab (buildStreamersTab).
function buildStreamWidget() {
  buildLiveTopbar();

  var widget = document.getElementById('streamWidget');
  var pill = document.getElementById('streamWidgetPill');
  var panel = document.getElementById('streamWidgetPanel');
  if (!widget || !pill || !panel) return;

  if (!_streamWidgetCollapseApplied) {
    panel.style.display = isStreamWidgetCollapsed() ? 'none' : 'block';
    _streamWidgetCollapseApplied = true;
  }

  var live = getVisibleStreamers().filter(function (s) {
    return s.is_live;
  });

  widget.style.display = '';
  pill.innerHTML = live.length ? '<span class="stream-widget-dot"></span>' + live.length + ' Live' : 'Streams';

  panel.innerHTML = live.length
    ? '<div class="stream-widget-list">' +
      live
        .map(function (s) {
          return streamerCardHTML(s);
        })
        .join('') +
      '</div>'
    : '<div class="stream-widget-banner stream-widget-empty">No one is live right now.</div>';
  observeStreamEmbeds(panel);
}

function toggleStreamWidget() {
  var panel = document.getElementById('streamWidgetPanel');
  if (!panel) return;
  var collapsing = panel.style.display !== 'none';
  panel.style.display = collapsing ? 'none' : 'block';
  setStreamWidgetCollapsed(collapsing);
}

function buildStreamersTab() {
  var container = document.getElementById('streamersView');
  if (!container) return;
  var visible = getVisibleStreamers();
  if (!visible.length) {
    container.innerHTML =
      '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No streamers linked yet.</p>';
    return;
  }
  var html = '<div class="stream-grid stream-grid-big">';
  for (var i = 0; i < visible.length; i++) html += streamerCardHTML(visible[i], { big: true });
  html += '</div>';
  container.innerHTML = html;
  observeStreamEmbeds(container);
}

// ── Self-service editor (own profile only) ──────────────────────────────────

function ownStreamerSectionHTML(player, backTo) {
  if (backTo !== 'landing') return '';
  var session = typeof getDiscordSession === 'function' ? getDiscordSession() : null;
  if (!session || !session.nameRealm || normalise(session.nameRealm) !== normalise(player.nameRealm)) return '';

  var existing = getOwnStreamer(player.firstName);
  var fnSafe = player.firstName.replace(/'/g, "\\'");
  var channel = existing ? existing.twitch_channel : '';
  var note = existing ? existing.schedule_note : '';
  var optOut = existing ? existing.guild_wide_opt_out : false;

  return (
    '<div class="profile-section"><div class="section-label">Your Stream</div>' +
    '<input type="text" id="streamerChannel-' +
    player.firstName +
    '" placeholder="Twitch channel name" class="self-received-source" style="max-width:100%;font-size:1rem;" value="' +
    _esc(channel) +
    '">' +
    '<textarea id="streamerNote-' +
    player.firstName +
    '" placeholder="Schedule note (optional)" rows="2" class="self-received-notes" style="max-width:100%;margin-top:0.4rem;">' +
    _esc(note) +
    '</textarea>' +
    '<label style="display:flex;align-items:center;gap:0.4rem;margin-top:0.5rem;font-size:0.92rem;color:var(--text-muted);">' +
    '<input type="checkbox" id="streamerOptOut-' +
    player.firstName +
    '"' +
    (optOut ? ' checked' : '') +
    '> Opt out of showing on other teams&#39; pages (guild-wide)' +
    '</label>' +
    '<div style="display:flex;gap:0.5rem;align-items:center;margin-top:0.5rem;">' +
    '<button class="btn btn-gold" style="font-size:0.92rem;padding:0.3rem 0.8rem;" onclick="saveOwnStreamer(\'' +
    fnSafe +
    '\')">Save</button>' +
    (existing
      ? '<button class="btn btn-muted" style="font-size:0.92rem;padding:0.3rem 0.8rem;" onclick="removeOwnStreamer(\'' +
        fnSafe +
        '\')">Remove</button>'
      : '') +
    '<span id="streamerSaveMsg-' +
    player.firstName +
    '" style="font-size:0.9rem;color:var(--text-muted);"></span>' +
    '</div>' +
    '<p class="self-received-note">Preview only for now -- not yet saved to a database (Supabase wiring lands separately).</p>' +
    '</div>'
  );
}

var TWITCH_CHANNEL_RE = /^[a-zA-Z0-9_]{4,25}$/;

function saveOwnStreamer(firstName) {
  var channelEl = document.getElementById('streamerChannel-' + firstName);
  var noteEl = document.getElementById('streamerNote-' + firstName);
  var optOutEl = document.getElementById('streamerOptOut-' + firstName);
  var msgEl = document.getElementById('streamerSaveMsg-' + firstName);
  var channel = channelEl ? channelEl.value.trim().replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '') : '';

  if (channelEl) channelEl.style.borderColor = '';
  if (!channel || !TWITCH_CHANNEL_RE.test(channel)) {
    if (channelEl) channelEl.style.borderColor = 'var(--melee)';
    if (msgEl) {
      msgEl.style.color = 'var(--melee)';
      msgEl.textContent = 'Enter a valid Twitch channel name (4-25 letters, numbers, or underscores).';
    }
    return;
  }

  var existing = getOwnStreamer(firstName);
  if (existing) {
    existing.twitch_channel = channel;
    existing.schedule_note = noteEl ? noteEl.value.trim() : '';
    existing.guild_wide_opt_out = !!(optOutEl && optOutEl.checked);
  } else {
    var norm = normalise(firstName);
    var player = null;
    for (var i = 0; i < (DATA.roster || []).length; i++) {
      if (normalise(DATA.roster[i].firstName) === norm) {
        player = DATA.roster[i];
        break;
      }
    }
    MOCK_STREAMERS.push({
      id: MOCK_STREAMERS.length + 1,
      team_slug: TEAM_SLUG,
      player_first_name: firstName,
      display_name: player ? player.nick || player.firstName : firstName,
      twitch_channel: channel,
      schedule_note: noteEl ? noteEl.value.trim() : '',
      guild_wide_opt_out: !!(optOutEl && optOutEl.checked),
      is_live: false
    });
  }

  buildStreamWidget();
  renderProfile(firstName, 'landing');
}

function removeOwnStreamer(firstName) {
  if (!confirm('Remove your streamer entry? This cannot be undone.')) return;
  var norm = normalise(firstName);
  for (var i = 0; i < MOCK_STREAMERS.length; i++) {
    if (MOCK_STREAMERS[i].team_slug === TEAM_SLUG && normalise(MOCK_STREAMERS[i].player_first_name) === norm) {
      MOCK_STREAMERS.splice(i, 1);
      break;
    }
  }
  buildStreamWidget();
  renderProfile(firstName, 'landing');
}
