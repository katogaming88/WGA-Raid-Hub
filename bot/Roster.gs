// Roster Application Form Script
// Paste this into the Apps Script editor for the Roster Google Form

var BOT_BASE_URL = 'https://team-phoenix-qx42.onrender.com';
var WEBHOOK_SECRET = 'teamPhoenixPPCBot';

// -------------------------------------------------------
// Trigger: On form submit
// -------------------------------------------------------
function onRosterFormSubmit(e) {
  var responses = e.response.getItemResponses();
  var data = {};

  for (var i = 0; i < responses.length; i++) {
    var item = responses[i];
    data[item.getItem().getTitle()] = item.getResponse();
  }

  Logger.log('Roster form fields: ' + Object.keys(data).join(', '));

  var characterName = data['Character Name'] || '';
  var classSpec = data['Class / Spec'] || '';
  var notes = data['Notes'] || data['Optional Notes'] || '';
  var submittedAt = new Date().toISOString();

  var payload = JSON.stringify({
    characterName: characterName,
    classSpec: classSpec,
    notes: notes,
    submittedAt: submittedAt
  });

  sendToBot('/roster', payload);
}

// Re-send the last N submissions (for testing)
function sendLastNRosterSubmissions() {
  var N = 2;
  var form = FormApp.getActiveForm();
  var responses = form.getResponses();
  var start = Math.max(0, responses.length - N);

  for (var i = start; i < responses.length; i++) {
    onRosterFormSubmit({ response: responses[i] });
    if (i < responses.length - 1) {
      Utilities.sleep(2000);
    }
  }
}

function sendToBot(path, payload) {
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-webhook-secret': WEBHOOK_SECRET },
    payload: payload,
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(BOT_BASE_URL + path, options);

  if (response.getResponseCode() === 200) {
    Logger.log('Success: posted to ' + path);
  } else {
    Logger.log('Error on ' + path + ': ' + response.getResponseCode() + ' - ' + response.getContentText());
  }
}
