function buildAttendanceTab() {
  var details   = DATA.attendanceDetails || {};
  var roster    = DATA.roster || [];
  var THRESHOLD = parseInt((document.getElementById('attendThreshold') || { value: '95' }).value) || 95;

  var below = [];
  for (var i = 0; i < roster.length; i++) {
    var p   = roster[i];
    var pct = parseInt(p.attendance) || 0;
    if (pct <= THRESHOLD) below.push(p);
  }
  below.sort(function(a,b) { return (parseInt(a.attendance)||0) - (parseInt(b.attendance)||0); });

  var html = '';
  if (!below.length) {
    html = '<p style="color:var(--text);padding:1rem;">All raiders are at or above '+THRESHOLD+'% attendance.</p>';
  } else {
    html += '<p style="font-size:1rem;color:var(--text);margin-bottom:1rem;">'+below.length+' raider'+(below.length!==1?'s':'')+' at or below '+THRESHOLD+'% attendance</p>';
    for (var i = 0; i < below.length; i++) {
      var p       = below[i];
      var name    = p.nick || p.firstName;
      var pct     = parseInt(p.attendance) || 0;
      var color   = attendColor(pct);
      var penalty = details[p.firstName] || [];

      html += '<div class="attend-player-row">';
      html += '<div class="attend-player-header">';
      html += '<span class="attend-player-name">'+name+(p.firstName!==name?' <span style="font-size:0.95rem;color:var(--text-muted);">('+p.firstName+')</span>':'')+'</span>';
      html += '<span style="font-size:1rem;font-weight:700;color:'+color+';">'+(p.attendance||'-')+'</span>';
      html += '</div>';
      html += '<div class="attend-row" style="margin-bottom:0.5rem;">';
      html += '<div class="attend-bar-wrap"><div class="attend-bar" style="width:'+(p.attendance||'0%')+';background:'+color+';"></div></div>';
      html += '</div>';
      if (penalty.length) {
        html += '<div class="attend-penalty-list">';
        for (var j = 0; j < penalty.length; j++) {
          var ae = penalty[j];
          var sc = ae.status==='No Show'?'var(--melee)':'var(--gold)';
          html += '<div class="attend-penalty-entry">';
          html += '<span style="color:var(--text);">'+ae.date+'</span>';
          html += '<span style="color:'+sc+';font-weight:600;">'+ae.status+'</span>';
          html += '</div>';
        }
        html += '</div>';
      }
      html += '</div>';
    }
  }
  document.getElementById('attendanceContent').innerHTML = html;
}
