// Discord OAuth session management and login flow.
// Depends on: common.js (WEB_APP_URL, TEAM_SLUG, jsonpRequest)

var DISCORD_CLIENT_ID = '1518683392864948334'; // public -- safe in JS
var DISCORD_REDIRECT_URI = 'https://katogaming88.github.io/wga-raid-hub/discord-callback.html';
var DISCORD_SCOPE = 'identify';
var DISCORD_SESSION_KEY = 'wga_discord_' + TEAM_SLUG; // one key per team in localStorage
var _discordPopup = null;
var _discordCsrfState = null;

// ── Session storage ───────────────────────────────────────────────────────────

function getDiscordSession() {
  try {
    var raw = localStorage.getItem(DISCORD_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

function setDiscordSession(data) {
  try { localStorage.setItem(DISCORD_SESSION_KEY, JSON.stringify(data)); } catch (_) { }
}

function clearDiscordSession() {
  try { localStorage.removeItem(DISCORD_SESSION_KEY); } catch (_) { }
}

// ── Nav rendering ─────────────────────────────────────────────────────────────

function renderDiscordNav(session) {
  var btn = document.getElementById('navDiscord');
  if (!btn) return;
  if (!session) {
    btn.textContent = 'Login with Discord';
    btn.disabled = false;
    btn.onclick = openDiscordPopup;
    btn.title = 'Sign in with Discord to view your priority standing and mark loot received';
    btn.classList.remove('discord-logged-in');
    // Remove any logout dropdown if present
    var existing = document.getElementById('discordNavDropdown');
    if (existing) existing.parentNode.removeChild(existing);
    return;
  }

  var displayName = session.nameRealm ? session.nameRealm.split('-')[0] : session.username;
  btn.textContent = displayName;
  btn.disabled = false;
  btn.title = 'Logged in as ' + session.username + (session.nameRealm ? ' (' + session.nameRealm + ')' : '');
  btn.classList.add('discord-logged-in');

  // Wire click to show a tiny logout dropdown
  btn.onclick = function (ev) {
    ev.stopPropagation();
    var dd = document.getElementById('discordNavDropdown');
    if (dd) { dd.parentNode.removeChild(dd); return; }
    dd = document.createElement('div');
    dd.id = 'discordNavDropdown';
    dd.className = 'discord-nav-dropdown';
    var logoutBtn = document.createElement('button');
    logoutBtn.textContent = 'Log out';
    logoutBtn.onclick = discordLogout;
    dd.appendChild(logoutBtn);
    btn.parentNode.style.position = 'relative';
    btn.parentNode.appendChild(dd);
    document.addEventListener('click', function closeDD() {
      var d = document.getElementById('discordNavDropdown');
      if (d) d.parentNode.removeChild(d);
      document.removeEventListener('click', closeDD);
    });
  };
}

// ── Popup flow ────────────────────────────────────────────────────────────────

function openDiscordPopup() {
  // Generate CSRF state token
  _discordCsrfState = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

  var authUrl = 'https://discord.com/api/oauth2/authorize'
    + '?client_id=' + encodeURIComponent(DISCORD_CLIENT_ID)
    + '&redirect_uri=' + encodeURIComponent(DISCORD_REDIRECT_URI)
    + '&response_type=code'
    + '&scope=' + encodeURIComponent(DISCORD_SCOPE)
    + '&state=' + encodeURIComponent(_discordCsrfState);

  var w = 480, h = 700;
  var left = Math.max(0, Math.round(window.screenX + (window.outerWidth - w) / 2));
  var top = Math.max(0, Math.round(window.screenY + (window.outerHeight - h) / 2));
  _discordPopup = window.open(authUrl, 'discord_auth',
    'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top +
    ',toolbar=no,menubar=no,resizable=no');

  if (!_discordPopup) {
    alert('Please allow popups for this site to log in with Discord.');
  }
}

window.addEventListener('message', function (ev) {
  if (ev.origin !== 'https://katogaming88.github.io') return;
  var data = ev.data;
  if (!data || data.type !== 'discord_auth') return;
  if (_discordPopup) { try { _discordPopup.close(); } catch (_) { } _discordPopup = null; }
  handleDiscordAuthResult(data.result || {});
});

function handleDiscordAuthResult(result) {
  if (!result || !result.success) {
    // Show a brief error near the login button
    var btn = document.getElementById('navDiscord');
    if (btn) { btn.textContent = 'Login failed -- try again'; setTimeout(function () { renderDiscordNav(null); }, 3000); }
    return;
  }

  setDiscordSession(result);
  renderDiscordNav(result);

  // Notify officer.html that a Discord login just completed so it can gate access
  if (typeof onDiscordLoginComplete === 'function') onDiscordLoginComplete(result);

  if (!result.nameRealm) {
    // First login -- no character claimed yet, show the claiming modal
    showDiscordClaimModal(result);
  } else {
    // Returning login -- auto-open the player's own profile
    if (typeof autoOpenClaimedProfile === 'function') autoOpenClaimedProfile(result.nameRealm);
  }
}

// ── Session validation on page load ──────────────────────────────────────────

function initDiscordLogin() {
  var session = getDiscordSession();
  if (!session || !session.token) {
    renderDiscordNav(null);
    // Let the host page know there is no Discord session (e.g. officer.html shows password prompt)
    if (typeof onDiscordInitNoSession === 'function') onDiscordInitNoSession();
    return;
  }
  // Validate the stored token against GAS (async, non-blocking)
  jsonpRequest(WEB_APP_URL + '?action=validateDiscordSession&token=' + encodeURIComponent(session.token), function (err, result) {
    if (err || !result || !result.valid) {
      clearDiscordSession();
      renderDiscordNav(null);
      if (typeof onDiscordInitNoSession === 'function') onDiscordInitNoSession();
      return;
    }
    // Merge fresh server-side data (nameRealm/isOfficer may have changed)
    var updated = Object.assign({}, session, {
      nameRealm: result.nameRealm || null,
      isOfficer: result.isOfficer || false
    });
    setDiscordSession(updated);
    renderDiscordNav(updated);
    if (typeof onDiscordSessionRestored === 'function') onDiscordSessionRestored(updated);
    if (updated.nameRealm && typeof autoOpenClaimedProfile === 'function') {
      autoOpenClaimedProfile(updated.nameRealm);
    }
  }, 15000);
}

// ── Claiming modal ────────────────────────────────────────────────────────────

function showDiscordClaimModal(session) {
  var modal = document.getElementById('discordClaimModal');
  if (!modal) return;
  document.getElementById('claimDiscordName').textContent = session.username || '';
  // Populate the roster dropdown from DATA (must already be loaded)
  var sel = document.getElementById('claimCharacterSelect');
  if (sel && window.DATA && DATA.roster) {
    sel.innerHTML = '<option value="">-- Select your character --</option>';
    var claimed = (DATA.discordClaims || []).map(function (c) { return c.nameRealm.toLowerCase(); });
    DATA.roster.forEach(function (p) {
      if (claimed.indexOf(p.nameRealm.toLowerCase()) !== -1) return; // already taken
      var opt = document.createElement('option');
      opt.value = p.nameRealm;
      opt.textContent = p.nameRealm + ' (' + p.class + ' ' + p.spec + ')';
      sel.appendChild(opt);
    });
  }
  document.getElementById('claimError').style.display = 'none';
  modal.style.display = '';
}

function closeDiscordClaimModal() {
  var modal = document.getElementById('discordClaimModal');
  if (modal) modal.style.display = 'none';
}

function submitCharacterClaim() {
  var sel = document.getElementById('claimCharacterSelect');
  var errEl = document.getElementById('claimError');
  var nameRealm = sel ? sel.value : '';
  if (!nameRealm) { if (errEl) { errEl.textContent = 'Please select a character.'; errEl.style.display = ''; } return; }

  var session = getDiscordSession();
  if (!session || !session.token) return;

  var submitBtn = document.querySelector('#discordClaimModal .claim-submit-btn');
  if (submitBtn) submitBtn.disabled = true;

  jsonpRequest(
    WEB_APP_URL + '?action=claimCharacter'
    + '&token=' + encodeURIComponent(session.token)
    + '&nameRealm=' + encodeURIComponent(nameRealm),
    function (err, result) {
      if (submitBtn) submitBtn.disabled = false;
      if (err || !result || !result.success) {
        var msg = (result && result.error) ? result.error : 'Something went wrong. Please try again.';
        if (errEl) { errEl.textContent = msg; errEl.style.display = ''; }
        return;
      }
      var updated = Object.assign({}, session, { nameRealm: result.nameRealm, isOfficer: result.isOfficer || false });
      setDiscordSession(updated);
      renderDiscordNav(updated);
      closeDiscordClaimModal();
      if (typeof onDiscordClaimComplete === 'function') onDiscordClaimComplete(updated);
      if (result.nameRealm && typeof autoOpenClaimedProfile === 'function') autoOpenClaimedProfile(result.nameRealm);
    },
    15000
  );
}

// ── Logout ────────────────────────────────────────────────────────────────────

function discordLogout() {
  var session = getDiscordSession();
  if (session && session.token) {
    // Fire-and-forget: invalidate the server-side session token
    jsonpRequest(WEB_APP_URL + '?action=discordLogout&token=' + encodeURIComponent(session.token), function () { }, 5000);
  }
  clearDiscordSession();
  renderDiscordNav(null);
  if (typeof onDiscordLogout === 'function') onDiscordLogout();
}
