// Discord OAuth session management and login flow.
// Depends on: common.js (supabaseClient, _teamCfg)

var DISCORD_SESSION_KEY = 'wga_discord_' + TEAM_SLUG; // one key per team
var _mappedDiscordSession = null; // cache of the {username, nameRealm, isOfficer, isAdmin} shape

// ── Session cache ─────────────────────────────────────────────────────────────
// Supabase's SDK persists the raw auth session itself, but that alone can't
// answer isOfficer/nameRealm synchronously (that's a DB round-trip). Persist the
// *mapped* shape to localStorage too so synchronous readers (renderDiscordNav,
// and officer.js's reload path which renders from cache before initDiscordLogin
// re-validates) have something to show immediately after a page reload, before
// resolveDiscordSession() has had a chance to run again.

function getDiscordSession() {
  if (_mappedDiscordSession) return _mappedDiscordSession;
  try {
    var raw = localStorage.getItem(DISCORD_SESSION_KEY);
    if (raw) _mappedDiscordSession = JSON.parse(raw);
  } catch (_) {}
  return _mappedDiscordSession;
}

function setDiscordSession(data) {
  _mappedDiscordSession = data;
  try {
    localStorage.setItem(DISCORD_SESSION_KEY, JSON.stringify(data));
  } catch (_) {}
}

function clearDiscordSession() {
  _mappedDiscordSession = null;
  try {
    localStorage.removeItem(DISCORD_SESSION_KEY);
  } catch (_) {}
}

// ── Nav rendering ─────────────────────────────────────────────────────────────

function renderDiscordNav(session) {
  var btn = document.getElementById('navDiscord');
  if (!btn) return;
  if (!session) {
    btn.textContent = 'Login with Discord';
    btn.disabled = false;
    btn.onclick = loginWithDiscord;
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
    if (dd) {
      dd.parentNode.removeChild(dd);
      return;
    }
    dd = document.createElement('div');
    dd.id = 'discordNavDropdown';
    dd.className = 'discord-nav-dropdown';
    var currentSession = getDiscordSession();
    if (currentSession && currentSession.nameRealm) {
      var profileBtn = document.createElement('button');
      profileBtn.textContent = 'My Profile';
      profileBtn.onclick = function () {
        var firstName = currentSession.nameRealm.split('-')[0].trim();
        var d = document.getElementById('discordNavDropdown');
        if (d) d.parentNode.removeChild(d);
        if (!document.getElementById('profileView')) {
          // On officer.html -- navigate to the public page and auto-open the profile there
          sessionStorage.setItem('wga_open_profile', '1');
          var base = window.location.pathname.replace('officer.html', 'index.html');
          window.location.href = base + (TEAM_SLUG !== 'phoenix' ? '?team=' + TEAM_SLUG : '');
          return;
        }
        if (typeof showView === 'function') showView('profile');
        if (typeof renderProfile === 'function') renderProfile(firstName, 'landing');
        var sel = document.getElementById('playerSelect');
        if (sel) sel.value = firstName;
      };
      dd.appendChild(profileBtn);
    } else if (currentSession && !currentSession.nameRealm) {
      var claimBtn = document.createElement('button');
      claimBtn.textContent = 'Claim your character';
      claimBtn.onclick = function () {
        showDiscordClaimModal(currentSession);
      };
      dd.appendChild(claimBtn);
    }
    var logoutBtn = document.createElement('button');
    logoutBtn.textContent = 'Log out';
    logoutBtn.onclick = discordLogout;
    dd.appendChild(logoutBtn);
    btn.style.position = 'relative';
    btn.appendChild(dd);
    document.addEventListener('click', function closeDD() {
      var d = document.getElementById('discordNavDropdown');
      if (d) d.parentNode.removeChild(d);
      document.removeEventListener('click', closeDD);
    });
  };
}

// ── Login (full-page redirect) ──────────────────────────────────────────────

function loginWithDiscord() {
  if (!supabaseClient) return;
  supabaseClient.auth.signInWithOAuth({
    provider: 'discord',
    options: { redirectTo: window.location.origin + window.location.pathname + window.location.search }
  });
}

// ── Session mapping ──────────────────────────────────────────────────────────

function resolveDiscordSession(session) {
  return supabaseClient
    .from('team_members')
    .select('role, name_realm')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .eq('auth_user_id', session.user.id)
    .maybeSingle()
    .then(function (result) {
      var member = result.data;
      return supabaseClient.rpc('is_site_admin').then(function (adminResult) {
        return {
          username: session.user.user_metadata.full_name || session.user.user_metadata.name,
          nameRealm: member ? member.name_realm : null,
          isOfficer: !!member && (member.role === 'officer' || member.role === 'team_leader'),
          isAdmin: !!adminResult.data
        };
      });
    });
}

// ── Session validation on page load ──────────────────────────────────────────

function initDiscordLogin() {
  if (!supabaseClient) {
    renderDiscordNav(null);
    if (typeof onDiscordInitNoSession === 'function') onDiscordInitNoSession();
    return;
  }

  function fallBackToNoSession() {
    clearDiscordSession();
    renderDiscordNav(null);
    if (typeof onDiscordInitNoSession === 'function') onDiscordInitNoSession();
  }

  supabaseClient.auth
    .getSession()
    .then(function (result) {
      var session = result.data.session;
      if (!session) {
        fallBackToNoSession();
        return;
      }
      resolveDiscordSession(session)
        .then(function (mapped) {
          setDiscordSession(mapped);
          renderDiscordNav(mapped);
          if (typeof onDiscordSessionRestored === 'function') onDiscordSessionRestored(mapped);
        })
        .catch(fallBackToNoSession);
    })
    .catch(fallBackToNoSession);

  supabaseClient.auth.onAuthStateChange(function (event, session) {
    if (event === 'SIGNED_IN' && session) {
      resolveDiscordSession(session)
        .then(function (mapped) {
          setDiscordSession(mapped);
          renderDiscordNav(mapped);
          if (typeof onDiscordLoginComplete === 'function') onDiscordLoginComplete(mapped);
          if (!mapped.nameRealm) {
            // First login -- no character claimed yet, show the claiming modal
            showDiscordClaimModal(mapped);
          }
        })
        .catch(fallBackToNoSession);
    }
    if (event === 'SIGNED_OUT') {
      clearDiscordSession();
      renderDiscordNav(null);
      if (typeof onDiscordLogout === 'function') onDiscordLogout();
    }
  });
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
    var claimed = (DATA.discordClaims || []).map(function (c) {
      return c.nameRealm.toLowerCase();
    });
    DATA.roster
      .slice()
      .sort(function (a, b) {
        return a.nameRealm.localeCompare(b.nameRealm);
      })
      .forEach(function (p) {
        if (claimed.indexOf(p.nameRealm.toLowerCase()) !== -1) return; // already taken
        var opt = document.createElement('option');
        opt.value = p.nameRealm;
        opt.textContent = p.nameRealm + ' (' + p.class + ')';
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
  if (!nameRealm) {
    if (errEl) {
      errEl.textContent = 'Please select a character.';
      errEl.style.display = '';
    }
    return;
  }

  var session = getDiscordSession();
  if (!session) return;

  var submitBtn = document.querySelector('#discordClaimModal .claim-submit-btn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Claiming...';
  }

  jsonpRequest(
    WEB_APP_URL +
      '?action=claimCharacter' +
      '&token=' +
      encodeURIComponent(session.token) +
      '&nameRealm=' +
      encodeURIComponent(nameRealm),
    function (err, result) {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Confirm claim';
      }
      if (err || !result || !result.success) {
        var msg = result && result.error ? result.error : 'Something went wrong. Please try again.';
        if (errEl) {
          errEl.textContent = msg;
          errEl.style.display = '';
        }
        return;
      }
      var updated = Object.assign({}, session, { nameRealm: result.nameRealm, isOfficer: result.isOfficer || false });
      setDiscordSession(updated);
      renderDiscordNav(updated);
      closeDiscordClaimModal();
      if (typeof onDiscordClaimComplete === 'function') onDiscordClaimComplete(updated);
    },
    15000
  );
}

// ── Logout ────────────────────────────────────────────────────────────────────

function discordLogout() {
  if (!supabaseClient) return;
  // Don't rely solely on the onAuthStateChange SIGNED_OUT branch -- it's only wired up
  // when initDiscordLogin() has run on this page load, which officer.js's reload path
  // skips once a password-session flag is already valid. Clear state directly so logout
  // works regardless of whether that listener is attached.
  supabaseClient.auth.signOut().then(function () {
    clearDiscordSession();
    renderDiscordNav(null);
    if (typeof onDiscordLogout === 'function') onDiscordLogout();
  });
}
