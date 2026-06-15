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
    html =
      '<div class="signup-step-label">Step 1 of 4</div>' +
      '<h2 class="signup-step-title">Sign Up for Next Season</h2>' +
      '<p class="signup-step-desc">Enter your exact in-game character name and select your realm.</p>' +
      '<div class="signup-field">' +
        '<span class="signup-label">Character Name</span>' +
        '<input type="text" id="signupCharName" class="signup-input" placeholder="Katorri" value="' + (signupData.charName || '') + '" autocomplete="off">' +
      '</div>' +
      '<div class="signup-field">' +
        '<span class="signup-label">Realm</span>' +
        '<div class="realm-combobox">' +
          '<input type="text" id="signupRealm" class="signup-input realm-input" placeholder="Type to search..." autocomplete="off" value="' + (signupData.realm || '') + '">' +
          '<div class="realm-dropdown" id="realmDropdown"></div>' +
        '</div>' +
      '</div>' +
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
    Object.keys(CLASS_SPECS).forEach(function(cls) {
      var hex = CLASS_COLORS[cls] || '#888888';
      var sel = signupData.className === cls ? ' signup-class-btn-selected' : '';
      html += '<button class="signup-class-btn' + sel + '" style="--cls-color:' + hex + ';" onclick="signupSelectClass(\'' + cls.replace(/'/g, "\\'") + '\')">' + cls + '</button>';
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
      '<h2 class="signup-step-title" style="color:' + clsColor + ';">' + signupData.className + '</h2>' +
      '<div class="signup-field">' +
        '<span class="signup-label">Main Spec</span>' +
        '<div class="signup-radio-group">';
    specData.specs.forEach(function(s) {
      html += '<label class="signup-radio-label"><input type="radio" name="mainSpec" value="' + s + '"' + (signupData.mainSpec === s ? ' checked' : '') + ' onchange="updateOffSpecList()">' + s + '</label>';
    });
    html +=
        '</div>' +
      '</div>' +
      '<div class="signup-field">' +
        '<span class="signup-label">Off Spec <span class="signup-optional">(optional -- select all that apply)</span></span>' +
        '<div class="signup-checkbox-group" id="offSpecGroup">' + buildOffSpecHTML(specData.specs, signupData.mainSpec, signupData.offSpecs) + '</div>' +
      '</div>';
    if (specData.roles) {
      html +=
        '<div class="signup-field">' +
          '<span class="signup-label">Primary Role</span>' +
          '<div class="signup-radio-group">';
      specData.roles.forEach(function(r) {
        html += '<label class="signup-radio-label"><input type="radio" name="primaryRole" value="' + r + '"' + (signupData.role === r ? ' checked' : '') + '>' + r + '</label>';
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
    html =
      '<div class="signup-step-label">Step 4 of 4</div>' +
      '<h2 class="signup-step-title">Additional Information</h2>' +
      '<div class="signup-field">' +
        '<span class="signup-label">Discord Name <span class="signup-optional">(optional -- only if different from your character name)</span></span>' +
        '<input type="text" id="signupDiscord" class="signup-input" placeholder="YourDiscord" value="' + (signupData.discord || '') + '">' +
      '</div>' +
      '<div class="signup-field">' +
        '<span class="signup-label">Anything else officers should know? <span class="signup-optional">(optional)</span></span>' +
        '<textarea id="signupNotes" class="signup-textarea" placeholder="e.g. applying as a trial, recently changed mains, availability caveats...">' + (signupData.notes || '') + '</textarea>' +
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
  if (firstInput) setTimeout(function() { firstInput.focus(); }, 50);
}

function initRealmCombobox() {
  var input    = document.getElementById('signupRealm');
  var dropdown = document.getElementById('realmDropdown');
  if (!input || !dropdown) return;

  function showMatches(query) {
    var q = query.toLowerCase().trim();
    if (!q) { dropdown.style.display = 'none'; return; }
    var matches = WOW_REALMS.filter(function(r) {
      return r.toLowerCase().indexOf(q) !== -1;
    }).slice(0, 12);
    if (!matches.length) { dropdown.style.display = 'none'; return; }
    dropdown.innerHTML = matches.map(function(r) {
      return '<div class="realm-option" onmousedown="pickRealm(\'' + r.replace(/'/g, "\\'") + '\')">' + r + '</div>';
    }).join('');
    dropdown.style.display = 'block';
  }

  input.addEventListener('input', function() { showMatches(this.value); });
  input.addEventListener('focus', function() { showMatches(this.value); });
  input.addEventListener('blur',  function() { setTimeout(function() { dropdown.style.display = 'none'; }, 150); });
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
  specs.filter(function(s) { return s !== mainSpec; }).forEach(function(s) {
    var checked = selectedOffSpecs && selectedOffSpecs.indexOf(s) !== -1 ? ' checked' : '';
    html += '<label class="signup-checkbox-label"><input type="checkbox" name="offSpec" value="' + s + '"' + checked + '>' + s + '</label>';
  });
  return html;
}

function updateOffSpecList() {
  var mainSpecEl = document.querySelector('input[name="mainSpec"]:checked');
  var mainSpec   = mainSpecEl ? mainSpecEl.value : '';
  var specData   = CLASS_SPECS[signupData.className];
  var group      = document.getElementById('offSpecGroup');
  if (!group || !specData) return;
  var currentChecked = Array.prototype.map.call(
    document.querySelectorAll('input[name="offSpec"]:checked'),
    function(el) { return el.value; }
  );
  group.innerHTML = buildOffSpecHTML(specData.specs, mainSpec, currentChecked);
}

function signupSelectClass(cls) {
  signupData.className = cls;
  signupData.mainSpec  = '';
  signupData.offSpecs  = [];
  signupData.role      = '';
  signupStep = 3;
  renderSignupStep();
}

function signupNext() {
  if (signupStep === 1) {
    var charName = (document.getElementById('signupCharName').value || '').trim();
    var realm    = (document.getElementById('signupRealm').value || '').trim();
    if (!charName) { document.getElementById('signupError').textContent = 'Please enter your character name.'; return; }
    if (!realm)    { document.getElementById('signupError').textContent = 'Please select your realm.'; return; }
    signupData.charName = charName;
    signupData.realm    = realm;
    signupStep = 2;

  } else if (signupStep === 3) {
    var mainSpecEl = document.querySelector('input[name="mainSpec"]:checked');
    var offSpecEls = document.querySelectorAll('input[name="offSpec"]:checked');
    var roleEl     = document.querySelector('input[name="primaryRole"]:checked');
    var specData   = CLASS_SPECS[signupData.className];
    if (!mainSpecEl) { document.getElementById('signupError').textContent = 'Please select your main spec.'; return; }
    if (specData.roles && !roleEl) { document.getElementById('signupError').textContent = 'Please select your primary role.'; return; }
    signupData.mainSpec = mainSpecEl.value;
    signupData.offSpecs = Array.prototype.map.call(offSpecEls, function(el) { return el.value; });
    signupData.role     = roleEl ? roleEl.value : null;
    signupStep = 4;

  } else {
    signupStep++;
  }
  renderSignupStep();
}

function signupBack() {
  if (signupStep === 3) { signupStep = 2; }
  else if (signupStep > 1) { signupStep--; }
  renderSignupStep();
}

function submitSignup() {
  signupData.discord     = (document.getElementById('signupDiscord').value || '').trim();
  signupData.notes       = (document.getElementById('signupNotes').value || '').trim();
  signupData.submittedAt = new Date().toISOString();

  var btn = document.getElementById('signupSubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }

  var cbName = '_submitSignupCb';
  window[cbName] = function(result) {
    delete window[cbName];
    if (result && result.success) {
      signupStep = 5;
      renderSignupStep();
    } else {
      if (btn) { btn.disabled = false; btn.textContent = 'Submit'; }
      var err = document.getElementById('signupError');
      if (err) err.textContent = 'Submission failed. Please try again or contact an officer on Discord.';
    }
  };

  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    if (btn) { btn.disabled = false; btn.textContent = 'Submit'; }
    var err = document.getElementById('signupError');
    if (err) err.textContent = 'Submission failed. Please try again or contact an officer on Discord.';
  };
  script.src = WEB_APP_URL + '?action=submitSignup&data=' + encodeURIComponent(JSON.stringify(signupData)) + '&callback=' + cbName;
  document.head.appendChild(script);
}
