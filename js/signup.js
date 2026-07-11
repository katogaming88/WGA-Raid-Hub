var signupStep = 1;
var signupData = {};

function showSignupView() {
  signupStep = 1;
  signupData = {};
  showView('signup');
  renderSignupStep();
}

function renderSignupStep() {
  var container = document.getElementById('signupForm');
  var html = '';

  if (signupStep === 1) {
    var showClaimDiffersBox = signupData.claimNameRealm && signupData.matchesClaim === false;
    html =
      '<div class="signup-step-label">Step 1 of 4</div>' +
      '<h2 class="signup-step-title">Sign Up for Next Season</h2>' +
      '<p class="signup-step-desc">Enter your exact in-game character name and select your realm.</p>' +
      '<div class="signup-field">' +
      '<span class="signup-label">Character Name</span>' +
      '<input type="text" id="signupCharName" class="signup-input" placeholder="Katorri" value="' +
      (signupData.charName || '') +
      '" autocomplete="off">' +
      '</div>' +
      '<div class="signup-field">' +
      '<span class="signup-label">Realm</span>' +
      '<div class="realm-combobox">' +
      '<input type="text" id="signupRealm" class="signup-input realm-input" placeholder="Type to search..." autocomplete="off" value="' +
      (signupData.realm || '') +
      '">' +
      '<div class="realm-dropdown" id="realmDropdown"></div>' +
      '</div>' +
      '</div>' +
      (showClaimDiffersBox ? buildClaimDiffersWarningHtml() : '') +
      '<p id="signupError" class="signup-error"></p>' +
      '<div class="signup-actions">' +
      '<button class="btn btn-muted" onclick="showView(\'landing\')">Cancel</button>' +
      '<button class="btn btn-gold" onclick="signupNext()">Next</button>' +
      '</div>';
  } else if (signupStep === 2) {
    html =
      '<div class="signup-step-label">Step 2 of 4</div>' +
      '<h2 class="signup-step-title">Select Your Class</h2>' +
      '<div class="signup-class-grid">';
    Object.keys(CLASS_SPECS).forEach(function (cls) {
      var hex = CLASS_COLORS[cls] || '#888888';
      var sel = signupData.className === cls ? ' signup-class-btn-selected' : '';
      html +=
        '<button class="signup-class-btn' +
        sel +
        '" style="--cls-color:' +
        hex +
        ';" onclick="signupSelectClass(\'' +
        cls.replace(/'/g, "\\'") +
        '\')">' +
        cls +
        '</button>';
    });
    html +=
      '</div>' +
      '<p id="signupError" class="signup-error"></p>' +
      '<div class="signup-actions">' +
      '<button class="btn btn-muted" onclick="signupBack()">Back</button>' +
      '</div>';
  } else if (signupStep === 3) {
    var specData = CLASS_SPECS[signupData.className];
    var clsColor = CLASS_COLORS[signupData.className] || 'var(--gold-light)';
    html =
      '<div class="signup-step-label">Step 3 of 4</div>' +
      '<h2 class="signup-step-title" style="color:' +
      clsColor +
      ';">' +
      signupData.className +
      '</h2>' +
      (signupHasClassMismatch() ? buildClassMismatchWarningHtml() : '') +
      '<div class="signup-field">' +
      '<span class="signup-label">Main Spec</span>' +
      '<div class="signup-radio-group">';
    specData.specs.forEach(function (s) {
      html +=
        '<label class="signup-radio-label"><input type="radio" name="mainSpec" value="' +
        s +
        '"' +
        (signupData.mainSpec === s ? ' checked' : '') +
        ' onchange="updateOffSpecList()">' +
        s +
        '</label>';
    });
    html +=
      '</div>' +
      '</div>' +
      '<div class="signup-field">' +
      '<span class="signup-label">Off Spec <span class="signup-optional">(optional -- select all that apply)</span></span>' +
      '<div class="signup-checkbox-group" id="offSpecGroup">' +
      buildOffSpecHTML(specData.specs, signupData.mainSpec, signupData.offSpecs) +
      '</div>' +
      '</div>';
    if (specData.roles) {
      html +=
        '<div class="signup-field">' +
        '<span class="signup-label">Primary Role</span>' +
        '<div class="signup-radio-group">';
      specData.roles.forEach(function (r) {
        html +=
          '<label class="signup-radio-label"><input type="radio" name="primaryRole" value="' +
          r +
          '"' +
          (signupData.role === r ? ' checked' : '') +
          '>' +
          r +
          '</label>';
      });
      html += '</div></div>';
    }
    html +=
      '<p id="signupError" class="signup-error"></p>' +
      '<div class="signup-actions">' +
      '<button class="btn btn-muted" onclick="signupBack()">Back</button>' +
      '<button class="btn btn-gold" onclick="signupNext()">Next</button>' +
      '</div>';
  } else if (signupStep === 4) {
    var discordSession = typeof getDiscordSession === 'function' ? getDiscordSession() : null;
    var hasClaim = !!(discordSession && discordSession.nameRealm);
    var swapChecked = !!signupData.mainSwapChecked;
    var claimDiffers = hasClaim && signupData.matchesClaim === false;

    var mainSwapFieldHtml;
    if (claimDiffers) {
      mainSwapFieldHtml =
        '<div class="signup-field">' +
        '<p style="margin:0;font-size:0.92rem;color:var(--text-muted);">This will be recorded as switching from your claimed character <strong style="color:var(--text);">' +
        discordSession.nameRealm +
        '</strong>.</p>' +
        '</div>';
    } else if (hasClaim) {
      mainSwapFieldHtml = '';
    } else {
      mainSwapFieldHtml =
        '<div class="signup-field">' +
        '<label style="display:flex;align-items:center;gap:0.55rem;font-size:1rem;color:var(--text);cursor:pointer;">' +
        '<input type="checkbox" id="signupMainSwapToggle"' +
        (swapChecked ? ' checked' : '') +
        ' onchange="toggleMainSwapField()" style="width:1.15rem;height:1.15rem;accent-color:var(--gold-light);cursor:pointer;flex-shrink:0;">' +
        '<span>I\'m switching mains this season <span class="signup-optional">(optional)</span></span>' +
        '</label>' +
        '<div id="signupMainSwapWrap" style="display:' +
        (swapChecked ? 'block' : 'none') +
        ';margin-top:0.5rem;">' +
        '<input type="text" id="signupMainSwap" class="signup-input" placeholder="Katorri-Khaz Modan" value="' +
        (signupData.mainSwap || '') +
        '">' +
        '</div>' +
        '</div>';
    }

    html =
      '<div class="signup-step-label">Step 4 of 4</div>' +
      '<h2 class="signup-step-title">Additional Information</h2>' +
      mainSwapFieldHtml +
      '<div class="signup-field">' +
      '<span class="signup-label">Anything else officers should know? <span class="signup-optional">(optional)</span></span>' +
      '<textarea id="signupNotes" class="signup-textarea" placeholder="e.g. applying as a trial, recently changed mains, availability caveats...">' +
      (signupData.notes || '') +
      '</textarea>' +
      '</div>' +
      '<p id="signupError" class="signup-error"></p>' +
      '<div class="signup-actions">' +
      '<button class="btn btn-muted" onclick="signupBack()">Back</button>' +
      '<button class="btn btn-gold" id="signupSubmitBtn" onclick="submitSignup()">Submit</button>' +
      '</div>';
  } else if (signupStep === 5) {
    html =
      '<div class="signup-confirm">' +
      '<div class="signup-confirm-check">&#10003;</div>' +
      '<h2 class="signup-step-title">Signup Submitted</h2>' +
      '<p class="signup-step-desc">Your signup has been submitted. Officers will review your application and be in touch. If you need to update anything, message Katorri or Rod on Discord -- do not resubmit without officer approval.</p>' +
      '<button class="btn btn-gold" onclick="showView(\'landing\')" style="margin-top:1.5rem;">Back to Roster</button>' +
      '</div>';
  }

  container.innerHTML = html;
  if (signupStep === 1) initRealmCombobox();
  var firstInput = container.querySelector('input[type="text"]');
  if (firstInput)
    setTimeout(function () {
      firstInput.focus();
    }, 50);
}

function initRealmCombobox() {
  var input = document.getElementById('signupRealm');
  var dropdown = document.getElementById('realmDropdown');
  if (!input || !dropdown) return;

  function showMatches(query) {
    var q = query.toLowerCase().trim();
    if (!q) {
      dropdown.style.display = 'none';
      return;
    }
    var matches = WOW_REALMS.filter(function (r) {
      return r.toLowerCase().indexOf(q) !== -1;
    }).slice(0, 12);
    if (!matches.length) {
      dropdown.style.display = 'none';
      return;
    }
    dropdown.innerHTML = matches
      .map(function (r) {
        return '<div class="realm-option" onmousedown="pickRealm(\'' + r.replace(/'/g, "\\'") + '\')">' + r + '</div>';
      })
      .join('');
    dropdown.style.display = 'block';
  }

  input.addEventListener('input', function () {
    showMatches(this.value);
  });
  input.addEventListener('focus', function () {
    showMatches(this.value);
  });
  input.addEventListener('blur', function () {
    setTimeout(function () {
      dropdown.style.display = 'none';
    }, 150);
  });
}

function toggleMainSwapField() {
  var cb = document.getElementById('signupMainSwapToggle');
  var wrap = document.getElementById('signupMainSwapWrap');
  if (wrap) wrap.style.display = cb && cb.checked ? 'block' : 'none';
}

function pickRealm(realm) {
  var input = document.getElementById('signupRealm');
  if (input) input.value = realm;
  var dropdown = document.getElementById('realmDropdown');
  if (dropdown) dropdown.style.display = 'none';
  signupData.realm = realm;
}

function buildOffSpecHTML(specs, mainSpec, selectedOffSpecs) {
  var html = '';
  specs
    .filter(function (s) {
      return s !== mainSpec;
    })
    .forEach(function (s) {
      var checked = selectedOffSpecs && selectedOffSpecs.indexOf(s) !== -1 ? ' checked' : '';
      html +=
        '<label class="signup-checkbox-label"><input type="checkbox" name="offSpec" value="' +
        s +
        '"' +
        checked +
        '>' +
        s +
        '</label>';
    });
  return html;
}

function updateOffSpecList() {
  var mainSpecEl = document.querySelector('input[name="mainSpec"]:checked');
  var mainSpec = mainSpecEl ? mainSpecEl.value : '';
  var specData = CLASS_SPECS[signupData.className];
  var group = document.getElementById('offSpecGroup');
  if (!group || !specData) return;
  var currentChecked = Array.prototype.map.call(
    document.querySelectorAll('input[name="offSpec"]:checked'),
    function (el) {
      return el.value;
    }
  );
  group.innerHTML = buildOffSpecHTML(specData.specs, mainSpec, currentChecked);
}

function buildClaimDiffersWarningHtml() {
  return (
    '<div style="margin:0.5rem 0 1rem;padding:0.7rem 0.85rem;background:var(--bg-alt);' +
    'border:1px solid var(--gold-dim);border-radius:4px;">' +
    '<p style="margin:0 0 0.5rem;font-size:0.92rem;color:var(--text-muted);">You\'re signed in with <strong style="color:var(--text);">' +
    signupData.claimNameRealm +
    '</strong> claimed, but typed <strong style="color:var(--text);">' +
    signupData.charName +
    '-' +
    signupData.realm +
    "</strong> above. Double-check the spelling if that's not what you meant.</p>" +
    '<label style="display:flex;align-items:center;gap:0.55rem;font-size:0.95rem;color:var(--text);cursor:pointer;">' +
    '<input type="checkbox" id="signupClaimDiffersConfirm"' +
    (signupData.claimDiffersConfirmed ? ' checked' : '') +
    ' style="width:1.1rem;height:1.1rem;accent-color:var(--gold-light);cursor:pointer;flex-shrink:0;">' +
    '<span>Yes, I meant to sign up ' +
    signupData.charName +
    '-' +
    signupData.realm +
    ', not ' +
    signupData.claimNameRealm +
    '</span>' +
    '</label>' +
    '</div>'
  );
}

function signupHasClassMismatch() {
  if (!signupData.matchesClaim || !signupData.claimNameRealm || !signupData.className) return false;
  var claimedPlayer = findRosterPlayerByNameRealm(signupData.claimNameRealm);
  return !!(claimedPlayer && claimedPlayer.class && claimedPlayer.class !== signupData.className);
}

function buildClassMismatchWarningHtml() {
  var claimedPlayer = findRosterPlayerByNameRealm(signupData.claimNameRealm);
  return (
    '<div style="margin:0.5rem 0 1rem;padding:0.7rem 0.85rem;background:var(--bg-alt);' +
    'border:1px solid var(--gold-dim);border-radius:4px;">' +
    '<p style="margin:0 0 0.5rem;font-size:0.92rem;color:var(--text-muted);">Your claimed character <strong style="color:var(--text);">' +
    signupData.claimNameRealm +
    '</strong> is on file as a <strong style="color:var(--text);">' +
    claimedPlayer.class +
    '</strong>, but you selected <strong style="color:var(--text);">' +
    signupData.className +
    "</strong>. A character's class doesn't change, so this usually means the wrong class got clicked. If you meant to sign up a different character instead, go back and check the name/realm.</p>" +
    '<label style="display:flex;align-items:center;gap:0.55rem;font-size:0.95rem;color:var(--text);cursor:pointer;">' +
    '<input type="checkbox" id="signupClassMismatchConfirm"' +
    (signupData.classMismatchConfirmed ? ' checked' : '') +
    ' style="width:1.1rem;height:1.1rem;accent-color:var(--gold-light);cursor:pointer;flex-shrink:0;">' +
    '<span>Yes, I meant to pick ' +
    signupData.className +
    ' for ' +
    signupData.claimNameRealm +
    '</span>' +
    '</label>' +
    '</div>'
  );
}

function signupSelectClass(cls) {
  signupData.className = cls;
  signupData.mainSpec = '';
  signupData.offSpecs = [];
  signupData.role = '';
  signupData.classMismatchConfirmed = false;
  signupStep = 3;
  renderSignupStep();
}

function signupNext() {
  if (signupStep === 1) {
    var charName = (document.getElementById('signupCharName').value || '').trim();
    var realm = (document.getElementById('signupRealm').value || '').trim();
    var charNameErr = validateCharName(charName);
    if (charNameErr) {
      document.getElementById('signupError').textContent = charNameErr;
      return;
    }
    if (!realm) {
      document.getElementById('signupError').textContent = 'Please select your realm.';
      return;
    }
    var priorCharName = signupData.charName;
    var priorRealm = signupData.realm;
    signupData.charName = charName;
    signupData.realm = realm;

    var discordSession1 = typeof getDiscordSession === 'function' ? getDiscordSession() : null;
    var claimNameRealm = discordSession1 && discordSession1.nameRealm ? discordSession1.nameRealm : null;
    if (charName !== priorCharName || realm !== priorRealm) signupData.claimDiffersConfirmed = false;
    signupData.claimNameRealm = claimNameRealm;
    signupData.matchesClaim = !!(
      claimNameRealm && (charName + '-' + realm).toLowerCase() === claimNameRealm.toLowerCase()
    );

    if (claimNameRealm && !signupData.matchesClaim && !signupData.claimDiffersConfirmed) {
      var claimConfirmEl1 = document.getElementById('signupClaimDiffersConfirm');
      if (claimConfirmEl1 && claimConfirmEl1.checked) {
        signupData.claimDiffersConfirmed = true;
      } else {
        renderSignupStep();
        return;
      }
    }

    signupStep = 2;
  } else if (signupStep === 3) {
    var mainSpecEl = document.querySelector('input[name="mainSpec"]:checked');
    var offSpecEls = document.querySelectorAll('input[name="offSpec"]:checked');
    var roleEl = document.querySelector('input[name="primaryRole"]:checked');
    var specData = CLASS_SPECS[signupData.className];
    if (!mainSpecEl) {
      document.getElementById('signupError').textContent = 'Please select your main spec.';
      return;
    }
    if (specData.roles && !roleEl) {
      document.getElementById('signupError').textContent = 'Please select your primary role.';
      return;
    }
    if (signupHasClassMismatch()) {
      var confirmEl = document.getElementById('signupClassMismatchConfirm');
      if (!confirmEl || !confirmEl.checked) {
        document.getElementById('signupError').textContent =
          'Please confirm the class change, or go back and re-check your character selection.';
        return;
      }
      signupData.classMismatchConfirmed = true;
    }
    signupData.mainSpec = mainSpecEl.value;
    signupData.offSpecs = Array.prototype.map.call(offSpecEls, function (el) {
      return el.value;
    });
    var rawRole = roleEl ? roleEl.value : specData.role || null;
    if (rawRole === 'DPS' || rawRole === 'Healer') {
      rawRole = SPEC_ROLE[signupData.mainSpec] || rawRole;
    }
    signupData.role = rawRole;
    signupStep = 4;
  } else {
    signupStep++;
  }
  renderSignupStep();
}

function signupBack() {
  if (signupStep === 3) {
    signupStep = 2;
  } else if (signupStep > 1) {
    signupStep--;
  }
  renderSignupStep();
}

function submitSignup() {
  var discordSession = typeof getDiscordSession === 'function' ? getDiscordSession() : null;
  var hasClaim = !!(discordSession && discordSession.nameRealm);
  var claimDiffers = hasClaim && signupData.matchesClaim === false;

  if (claimDiffers) {
    // Already confirmed at step 1 -- signupNext() won't advance past step 1 otherwise.
    signupData.mainSwap = discordSession.nameRealm;
  } else if (hasClaim) {
    signupData.mainSwap = '';
  } else {
    var swapToggle = document.getElementById('signupMainSwapToggle');
    var swapChecked = !!(swapToggle && swapToggle.checked);
    signupData.mainSwapChecked = swapChecked;
    if (!swapChecked) {
      signupData.mainSwap = '';
    } else {
      var rawSwap = (
        document.getElementById('signupMainSwap') ? document.getElementById('signupMainSwap').value : ''
      ).trim();
      var swapResult = validateMainSwap(rawSwap);
      if (swapResult.error) {
        var swapErr = document.getElementById('signupError');
        if (swapErr) swapErr.textContent = swapResult.error;
        return;
      }
      signupData.mainSwap = swapResult.value;
    }
  }

  signupData.notes = (document.getElementById('signupNotes').value || '').trim();
  signupData.submittedAt = new Date().toISOString();

  var btn = document.getElementById('signupSubmitBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Submitting...';
  }

  if (!supabaseClient) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Submit';
    }
    var noClientErr = document.getElementById('signupError');
    if (noClientErr) noClientErr.textContent = 'Submission failed. Please try again or contact an officer on Discord.';
    return;
  }

  supabaseClient
    .rpc('submit_season_signup', {
      p_team_id: _teamCfg.supabaseTeamId,
      p_name_realm: signupData.charName + '-' + signupData.realm,
      p_class: signupData.className,
      p_spec: signupData.mainSpec,
      p_off_specs: (signupData.offSpecs || []).join(', '),
      p_main_swap: !!signupData.mainSwap,
      p_player_note: signupData.notes
    })
    .then(function (result) {
      if (result.error) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Submit';
        }
        var err = document.getElementById('signupError');
        if (err) err.textContent = 'Submission failed. Please try again or contact an officer on Discord.';
        return;
      }

      // Best-effort Discord notification via the discord-bot-webhook Edge
      // Function. Not gated on its result -- the Supabase insert above is
      // the write of record.
      supabaseClient.functions.invoke('discord-bot-webhook', {
        body: {
          action: 'signup',
          team: TEAM_SLUG,
          payload: {
            charName: signupData.charName || '',
            realm: signupData.realm || '',
            className: signupData.className || '',
            mainSpec: signupData.mainSpec || '',
            offSpecs: (signupData.offSpecs || []).join(', '),
            role: signupData.role || '',
            discord: signupData.discord || '',
            notes: signupData.notes || ''
          }
        }
      });

      signupStep = 5;
      renderSignupStep();
    });
}
