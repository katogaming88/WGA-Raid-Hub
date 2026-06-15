// Public page: view switching, player dropdown, boot
function showView(name) {
  document.getElementById('loadingMsg').style.display = 'none';
  ['landingView','profileViewWrap','signupViewWrap'].forEach(function(id) {
    document.getElementById(id).classList.remove('active');
  });
  if (name === 'landing') { document.getElementById('landingView').classList.add('active'); renderSignupLandingLink(); }
  if (name === 'profile') document.getElementById('profileViewWrap').classList.add('active');
  if (name === 'signup')  document.getElementById('signupViewWrap').classList.add('active');
}

function populateDropdown() {
  var sel    = document.getElementById('playerSelect');
  var order  = ['Tank','Heal','Melee','Ranged'];
  var labels = { Tank:'Tanks', Heal:'Healers', Melee:'Melee', Ranged:'Ranged' };
  var groups = { Tank:[], Heal:[], Melee:[], Ranged:[] };
  for (var i = 0; i < DATA.roster.length; i++) {
    var p = DATA.roster[i];
    if (!p.isBench && groups[p.role]) groups[p.role].push(p);
  }
  for (var r = 0; r < order.length; r++) {
    var role = order[r];
    var players = groups[role];
    if (!players.length) continue;
    players.sort(function(a,b) { return (a.nick||a.firstName).localeCompare(b.nick||b.firstName); });
    var group = document.createElement('optgroup');
    group.label = labels[role];
    for (var j = 0; j < players.length; j++) {
      var p = players[j];
      var opt = document.createElement('option');
      opt.value = p.firstName;
      opt.textContent = p.nick ? p.nick + ' (' + p.firstName + ')' : p.firstName;
      group.appendChild(opt);
    }
    sel.appendChild(group);
  }
}

function renderSignupLandingLink() {
  var el = document.getElementById('signupLink');
  if (el) el.style.display = (DATA && DATA.signupsOpen) ? '' : 'none';
}

document.getElementById('playerSelect').addEventListener('change', function(e) {
  if (e.target.value) { showView('profile'); renderProfile(e.target.value, 'landing'); }
});

// Boot
loadData(function() {
  populateDropdown();
  showView('landing');
});
