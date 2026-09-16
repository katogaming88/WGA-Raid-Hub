// How the Calendar page behaves, written once and checked against both sites
// (#1102 step 1). tests/browser/calendar-recorded.test.js runs it against the
// current site's calendar.html, where it was recorded; tests/browser-app/
// calendar.test.js runs the same checks against the new app's Calendar page.
//
// The new page is a redesign (Kat, 2026-09-16), so what is recorded here is
// what it must keep doing, not how it looks:
//
//   month:  [{ date, status }]           raid nights and the reader's answer
//   night:  [{ name, status, note }]     every roster raider's status that night
//   counts: { in, out }
//   writes: { name, body }               each RPC or Edge Function call a
//                                        save makes, in order
//
// Deliberate differences, checked by the new suite only:
// - Rotators are counted with the bench, not as coming (the current site
//   counts a rotator as "in").
// - Signed out, the new page shows the schedule only, and raiders read
//   teammates' answers without notes (docs/database-decisions.md, 2026-09-16).
// - The arrows move between raid nights, not calendar days.
// - "Present" is a choice that clears your answer, instead of a separate
//   "Clear (back to default)" button.

import { SCENARIO as ROSTER } from './roster.js';

export const TODAY = '2026-05-13T16:00:00Z';
export const NIGHT = '2026-05-14';
export const TEAM_ID = 1;

// The roster: Roster's six raiders plus a rotator and the one row with no
// class. Emberlyn is on the bench.
export const ROTATOR = {
  id: 8,
  name_realm: 'Glimmerpaw-Illidan',
  nickname: 'Glim',
  is_trial: false,
  is_bench: false,
  is_rotator: true,
  tier_pieces_equipped: null,
  classes_specs: { class: 'Druid', spec: 'Feral', role: 'Melee' }
};
export const PLAYERS = [...ROSTER.players, ROTATOR];

// Tuesdays and Thursdays at 9pm.
export const SCHEDULE = [
  { weekday: 2, start_time: '21:00:00', duration_minutes: 180, active: true, is_optional: false },
  { weekday: 4, start_time: '21:00:00', duration_minutes: 180, active: true, is_optional: false }
];

const rsvp = (player_id, raid_date, status, note) => ({
  team_id: TEAM_ID,
  player_id,
  raid_date,
  status,
  note,
  updated_at: `${raid_date}T12:00:00+00:00`
});

// Answers for May. Aurelith (the viewer) is late on the 12th; Frostvale is out
// and Zed late on the 14th.
export const RSVPS = [
  rsvp(1, '2026-05-12', 'Late', 'Dentist until 9:30'),
  rsvp(6, NIGHT, 'Absent', 'Out of town'),
  rsvp(3, NIGHT, 'Late', 'Work until 9:15')
];

// Who is signed in: Aurelith, a Phoenix officer (players row 1).
export const VIEWER = {
  userId: 'user-aurelith',
  discordId: 'discord-aurelith',
  playerId: 1,
  nameRealm: 'Aurelith-Illidan',
  teamMemberId: 1
};

// The month, as the viewer's answers show on it. Nights without an answer are
// Present.
export const EXPECTED_MONTH = [
  '2026-05-05',
  '2026-05-07',
  '2026-05-12',
  '2026-05-14',
  '2026-05-19',
  '2026-05-21',
  '2026-05-26',
  '2026-05-28'
].map((date) => ({ date, status: date === '2026-05-12' ? 'Late' : 'Present' }));

// The night of the 14th, sorted by name.
export const EXPECTED_NIGHT = [
  { name: 'Aur', status: 'Present', note: '' },
  { name: 'Brightmoor', status: 'Present', note: '' },
  { name: 'Dawnthistle', status: 'Present', note: '' },
  { name: 'Em', status: 'Bench', note: '' },
  { name: 'Frostvale', status: 'Absent', note: 'Out of town' },
  { name: 'Glim', status: 'Rotator', note: '' },
  { name: 'Zed', status: 'Late', note: 'Work until 9:15' }
];

// Counted on the current site: the rotator is "in". The new page leaves
// rotators out of the count, with the bench.
export const CURRENT_COUNTS = { in: 5, out: 1 };
export const NEW_COUNTS = { in: 4, out: 1 };

// Saving your own answer. A note is required for anything but Present (and
// Attending on an optional night), and the save tells the Discord bot twice:
// once to post the answer, once to refresh the signup sheet.
export const OWN_ANSWER = { status: 'Tentative', note: 'Might be late from work' };
export const OWN_NOTE_REQUIRED = 'A note is required so officers know why.';
export const OWN_WRITES = [
  {
    name: 'set_own_rsvp',
    body: { p_team_id: TEAM_ID, p_raid_date: NIGHT, p_status: 'Tentative', p_note: 'Might be late from work' }
  },
  {
    name: 'discord-bot-webhook',
    body: {
      action: 'rsvp',
      team: 'phoenix',
      payload: {
        charName: VIEWER.nameRealm,
        raidDate: NIGHT,
        status: 'Tentative',
        note: 'Might be late from work'
      }
    }
  },
  { name: 'discord-bot-webhook', body: { action: 'signupSheetSync', team: 'phoenix', payload: { raidDate: NIGHT } } }
];

// Going back to the default (the 12th, where Aurelith said Late). No post to
// the bot, only the sheet refresh.
export const CLEAR_DATE = '2026-05-12';
export const CLEAR_WRITES = [
  { name: 'set_own_rsvp', body: { p_team_id: TEAM_ID, p_raid_date: CLEAR_DATE, p_status: null, p_note: null } },
  {
    name: 'discord-bot-webhook',
    body: { action: 'signupSheetSync', team: 'phoenix', payload: { raidDate: CLEAR_DATE } }
  }
];

// An officer changing a raider's answer: Brightmoor forgot to say they are
// out. The reason is required.
export const OFFICER_CHANGE = { name: 'Brightmoor', playerId: 2, status: 'Absent', note: 'Told us in Discord' };
export const OFFICER_NOTE_REQUIRED = 'A note is required so the raider knows why.';
export const OFFICER_WRITES = [
  {
    name: 'officer_set_rsvp',
    body: {
      p_team_id: TEAM_ID,
      p_player_id: 2,
      p_raid_date: NIGHT,
      p_status: 'Absent',
      p_note: 'Told us in Discord'
    }
  },
  { name: 'discord-bot-webhook', body: { action: 'signupSheetSync', team: 'phoenix', payload: { raidDate: NIGHT } } }
];

// Putting the rotator in for the week the night falls in (Sunday to
// Saturday).
export const ROTATOR_WRITES = [
  {
    name: 'officer_set_rotator_week',
    body: { p_team_id: TEAM_ID, p_player_id: ROTATOR.id, p_week_start: '2026-05-10', p_in: true }
  },
  { name: 'discord-bot-webhook', body: { action: 'signupSheetSync', team: 'phoenix', payload: { raidDate: NIGHT } } }
];

// Emberlyn is benched: on a normal night there is nothing for them to answer.
export const BENCH_VIEWER = {
  userId: 'user-emberlyn',
  discordId: 'discord-emberlyn',
  playerId: 5,
  nameRealm: 'Emberlyn-Illidan',
  teamMemberId: 2
};
