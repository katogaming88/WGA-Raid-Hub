// How the profile's two forms behave, written once and checked against both
// sites (#1102, #868 part 4). tests/browser/profile-forms-recorded.test.js
// records it from the current site's profile; tests/browser-app/
// profile-forms.test.js runs the same checks against the new app.
//
// Mark Received: which loot priority rows offer it, and what a report sends.
// The M+ exclusion request: what the raider sees of their own request, when
// the form is offered, what it refuses, and what it sends.
//
// What changes on purpose (Kat, 2026-09-14): Mark Received gains Weekly quest
// and Pug raid as sources (#868), and a raider now sees their own rejected M+
// request, which the current site's profile tried to show but the database did
// not let them read (20260914201423). The fixtures give the raider their own
// request so both sites are measured on the same rows.

import { TORBJORN, DODGEY, VIEWERS } from './profile.js';

export { TORBJORN, DODGEY, VIEWERS };

// Loot priority rows that offer Mark Received, by the name each row shows.
// Caustic Chain-Wrapped Sash is left out: a Mythic copy is already on file.
export const MARKABLE = ['Crafted', 'Baleful Grave-Knight’s Deathgrips', 'Band of the Hollow Choir'];

export const CURRENT_SOURCES = ['M+', 'Great Vault', 'Crafted', 'Catalyst', 'Bonus Roll', 'Other'];
export const NEW_SOURCES = [
  'M+',
  'Great Vault',
  'Crafted',
  'Catalyst',
  'Bonus Roll',
  'Weekly quest',
  'Pug raid',
  'Other'
];

// Each report: the row it is made from, what the raider fills in, and the
// submit_self_received() call it makes. The item is the catalog's own name,
// so a tier piece reports its token, with the row's slot: the catalog's for a
// raid item, the picked slot for an M+ or crafted pick. A crafted pick's form
// starts on the Crafted source.
export const REPORTS = [
  {
    row: 'Band of the Hollow Choir',
    difficulty: 'Heroic',
    source: 'Great Vault',
    note: 'from my vault',
    call: {
      p_team_id: 1,
      p_name_realm: 'Torbjorn-Illidan',
      p_item_name: 'Band of the Hollow Choir',
      p_track: 'Hero',
      p_source: 'Great Vault',
      p_note: 'from my vault',
      p_slot: 'Finger'
    }
  },
  {
    row: 'Baleful Grave-Knight’s Deathgrips',
    difficulty: 'Mythic',
    source: 'Bonus Roll',
    note: '',
    call: {
      p_team_id: 1,
      p_name_realm: 'Torbjorn-Illidan',
      p_item_name: 'Venomforged Idol',
      p_track: 'Myth',
      p_source: 'Bonus Roll',
      p_note: '',
      p_slot: 'Hands'
    }
  },
  {
    row: 'Crafted',
    difficulty: 'Heroic',
    source: null,
    defaultSource: 'Crafted',
    note: '',
    call: {
      p_team_id: 1,
      p_name_realm: 'Torbjorn-Illidan',
      p_item_name: 'Crafted',
      p_track: 'Hero',
      p_source: 'Crafted',
      p_note: '',
      p_slot: 'Wrist'
    }
  }
];

// A report the database holds for review tells the officers in Discord.
export const REVIEW_REPORT = {
  row: 'Band of the Hollow Choir',
  difficulty: 'Heroic',
  source: 'Other',
  note: 'timewalking vendor',
  webhook: {
    action: 'selfreceived',
    team: 'phoenix',
    payload: {
      player: 'Torbjorn-Illidan',
      item: 'Band of the Hollow Choir',
      slot: 'Finger',
      source: 'Other',
      notes: 'timewalking vendor'
    }
  }
};

// Dodgey's own M+ exclusion, as the M+ card reads it. `canRequest` is whether
// the card offers the form.
export const MPLUS_REJECTED_OPEN = { status: 'Rejected', note: 'Sockets missing', canRequest: true };
export const MPLUS_REJECTED_CLOSED = { status: 'Rejected', note: 'Sockets missing', canRequest: false };
export const MPLUS_NONE_CLOSED = { status: null, note: null, canRequest: false };
export const MPLUS_NONE_OPEN = { status: null, note: null, canRequest: true };

// The form refuses a request until the raider confirms Myth track in every M+
// slot and at least 2 of 3 gem sockets, then sends this, with the Raider.IO
// link filled in for them.
export const MPLUS_REQUEST = {
  note: 'Hero raid trinket has no Myth M+ match',
  call: {
    p_team_id: 1,
    p_name_realm: 'Dodgey-Illidan',
    p_raiderio_url: 'https://raider.io/characters/us/illidan/Dodgey',
    p_reason: 'Hero raid trinket has no Myth M+ match'
  },
  webhook: {
    action: 'mplus',
    team: 'phoenix',
    payload: {
      nameRealm: 'Dodgey-Illidan',
      raiderioUrl: 'https://raider.io/characters/us/illidan/Dodgey',
      notes: 'Hero raid trinket has no Myth M+ match'
    }
  }
};
