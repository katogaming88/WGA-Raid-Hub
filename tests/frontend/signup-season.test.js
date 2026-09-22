import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #934: the tier a team takes signups for is its team_seasons rows with the
// switch on, not a config key. common.js derives the open tiers and the
// current tier; tab-signups.js picks the tier the officer's toggle flips;
// signup.js picks the tier the raider's form submits for. The three files are
// plain browser scripts, loaded into one vm sandbox in the order the pages
// load them, with document stubs for the elements each render touches.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(HERE, rel), 'utf8');
const COMMON_JS = read('../../js/common.js');
const SIGNUPS_TAB_JS = read('../../js/tabs/tab-signups.js');
const SIGNUP_JS = read('../../js/signup.js');
const ROSTER_JS = read('../../js/roster.js');

function makeEl(extra) {
  return Object.assign(
    {
      style: {},
      textContent: '',
      innerHTML: '',
      disabled: false,
      value: '',
      className: '',
      dataset: {},
      classList: { add: () => {}, remove: () => {}, toggle: () => {} }
    },
    extra
  );
}

const SEASONS = [
  { code: 'MID3', display_name: 'Midnight Season 3', starts_at: '2099-01-01', ends_at: null },
  { code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2026-08-11', ends_at: '2098-12-31' },
  { code: 'MID1', display_name: 'Midnight Season 1', starts_at: '2026-03-17', ends_at: '2026-08-10' }
];

function loadSandbox({ data = {}, els = {} } = {}) {
  const sandbox = {
    window: {},
    // No ?team=, so roster.js's boot gate resolves a cold landing and sends
    // the browser to guild.html; the stub swallows that and the rest of the
    // file is loaded for its functions.
    location: { search: '', pathname: '/', replace: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
      // roster.js attaches a change listener to #playerSelect at top level,
      // unguarded, so an element the case did not stub still has to exist.
      getElementById: (id) => els[id] || makeEl({ addEventListener: () => {} }),
      querySelectorAll: () => [],
      createElement: () => ({}),
      head: { appendChild: () => {} }
    },
    console,
    Intl,
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t.unref) t.unref();
      return t;
    },
    clearTimeout,
    showView: () => {},
    getDiscordSession: () => null,
    // tab-attendance.js supplies this on the officer page.
    escHtml: (str) =>
      String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  vm.runInContext(SIGNUPS_TAB_JS, sandbox, { filename: 'tab-signups.js' });
  vm.runInContext(SIGNUP_JS, sandbox, { filename: 'signup.js' });
  vm.runInContext(ROSTER_JS, sandbox, { filename: 'roster.js' });
  sandbox.DATA = Object.assign({ seasons: SEASONS, teamSeasons: [] }, data);
  return sandbox;
}

describe('openSignupSeasonCodes and signupsOpen (common.js)', () => {
  it('lists the tiers with the switch on, newest first by start date', () => {
    const s = loadSandbox({
      data: {
        teamSeasons: [
          { season_code: 'MID1', signups_open: true, wishlist_open: false },
          { season_code: 'MID3', signups_open: true, wishlist_open: false },
          { season_code: 'MID2', signups_open: false, wishlist_open: true }
        ]
      }
    });
    expect(s.openSignupSeasonCodes()).toEqual(['MID3', 'MID1']);
    expect(s.signupsOpen('MID3')).toBe(true);
    expect(s.signupsOpen('MID2')).toBe(false);
    expect(s.signupsOpen()).toBe(true);
  });

  it('is empty, and closed, with no rows; a code the seasons read did not return sorts last', () => {
    const s = loadSandbox();
    expect(s.openSignupSeasonCodes()).toEqual([]);
    expect(s.signupsOpen()).toBe(false);
    s.DATA.teamSeasons = [
      { season_code: 'zzz-unknown', signups_open: true },
      { season_code: 'MID2', signups_open: true }
    ];
    expect(s.openSignupSeasonCodes()).toEqual(['MID2', 'zzz-unknown']);
  });

  it('currentSeasonCode() is the latest tier whose start has passed, as current_season() defines it', () => {
    const s = loadSandbox();
    // MID3 starts in 2099, so today falls in MID2.
    expect(s.currentSeasonCode()).toBe('MID2');
    s.DATA.seasons = [];
    expect(s.currentSeasonCode()).toBe('');
  });
});

describe('the Signups tab tier select (tab-signups.js)', () => {
  function tabEls() {
    return {
      signupStatusBadge: makeEl(),
      signupToggleBtn: makeEl(),
      signupToggleTier: makeEl(),
      signupSeasonSelect: makeEl()
    };
  }

  it('offers the tiers that have not ended, newest first, and starts on the newest open one', () => {
    const els = tabEls();
    const s = loadSandbox({
      els,
      data: { teamSeasons: [{ season_code: 'MID2', signups_open: true, wishlist_open: false }] }
    });
    s.renderSignupToggle();
    expect(els.signupSeasonSelect.innerHTML.match(/<option value="([^"]+)">/g)).toEqual([
      '<option value="MID3">',
      '<option value="MID2">'
    ]);
    expect(els.signupSeasonSelect.innerHTML).toContain('Midnight Season 3');
    expect(els.signupSeasonSelect.value).toBe('MID2');
    expect(els.signupStatusBadge.textContent).toBe('OPEN');
    expect(els.signupToggleBtn.textContent).toBe('Close Signups');
    expect(els.signupToggleBtn.disabled).toBe(false);
    expect(els.signupToggleTier.textContent).toBe('Controls signups for Midnight Season 2.');
  });

  it('starts on the current tier when none is open, and follows the pick', () => {
    const els = tabEls();
    const s = loadSandbox({ els });
    s.renderSignupToggle();
    expect(els.signupSeasonSelect.value).toBe('MID2');
    expect(els.signupStatusBadge.textContent).toBe('CLOSED');
    expect(els.signupToggleBtn.textContent).toBe('Open Signups');
    els.signupSeasonSelect.value = 'MID3';
    s.onSignupTierSelect();
    expect(s.signupTierCode()).toBe('MID3');
    expect(els.signupToggleTier.textContent).toBe('Controls signups for Midnight Season 3.');
  });

  it('keeps an ended tier on the list while this team still has it open', () => {
    const els = tabEls();
    const s = loadSandbox({
      els,
      data: { teamSeasons: [{ season_code: 'MID1', signups_open: true, wishlist_open: false }] }
    });
    s.renderSignupToggle();
    expect(els.signupSeasonSelect.innerHTML).toContain('<option value="MID1">');
    expect(els.signupSeasonSelect.value).toBe('MID1');
  });

  it('offers an open tier the seasons read did not return, named from its code, so the toggle never acts on an unseen tier', () => {
    const els = tabEls();
    const s = loadSandbox({
      els,
      data: { seasons: [], teamSeasons: [{ season_code: 'MID2', signups_open: true, wishlist_open: false }] }
    });
    s.renderSignupToggle();
    expect(els.signupSeasonSelect.innerHTML).toBe('<option value="MID2">Midnight Season 2</option>');
    expect(els.signupSeasonSelect.value).toBe('MID2');
    expect(els.signupToggleBtn.disabled).toBe(false);
    expect(els.signupToggleBtn.textContent).toBe('Close Signups');
  });

  it('disables the toggle and the select when the site has no tier yet', () => {
    const els = tabEls();
    const s = loadSandbox({ els, data: { seasons: [] } });
    s.renderSignupToggle();
    expect(els.signupToggleBtn.disabled).toBe(true);
    expect(els.signupSeasonSelect.disabled).toBe(true);
    expect(els.signupToggleTier.textContent).toMatch(/No season to open yet/);
  });

  it('the history filters by the picked tier and labels it by name', () => {
    const els = Object.assign(tabEls(), { signupHistoryContainer: makeEl() });
    const s = loadSandbox({
      els,
      data: { teamSeasons: [{ season_code: 'MID3', signups_open: true, wishlist_open: false }] }
    });
    s.formatDateTime = () => '';
    s.localTimeZoneNote = () => '';
    s.classColor = () => '';
    s.renderSignupHistory([
      { nameRealm: 'A-Illidan', status: 'pending', season: 'MID3', className: 'Mage', mainSpec: 'Frost' },
      { nameRealm: 'B-Illidan', status: 'pending', season: 'MID2', className: 'Mage', mainSpec: 'Frost' }
    ]);
    expect(els.signupHistoryContainer.innerHTML).toContain('1 signup for Midnight Season 3');
    expect(els.signupHistoryContainer.innerHTML).toContain('A-Illidan');
    expect(els.signupHistoryContainer.innerHTML).not.toContain('B-Illidan');
  });
});

describe('the signup form tier (signup.js) and the public page (roster.js)', () => {
  it('signupTier() is the newest open tier, and the picker is hidden with one tier open', () => {
    const els = { signupTierPicker: makeEl() };
    const s = loadSandbox({
      els,
      data: { teamSeasons: [{ season_code: 'MID2', signups_open: true, wishlist_open: false }] }
    });
    expect(s.signupTier()).toBe('MID2');
    s.renderSignupTierPicker();
    expect(els.signupTierPicker.style.display).toBe('none');
    expect(els.signupTierPicker.innerHTML).toBe('');
  });

  it('shows the picker with two tiers open, selected on the newest, and follows the pick', () => {
    const els = { signupTierPicker: makeEl(), signupForm: makeEl() };
    const s = loadSandbox({
      els,
      data: {
        teamSeasons: [
          { season_code: 'MID2', signups_open: true, wishlist_open: false },
          { season_code: 'MID3', signups_open: true, wishlist_open: false }
        ]
      }
    });
    s.renderSignupTierPicker();
    expect(els.signupTierPicker.style.display).toBe('');
    expect(els.signupTierPicker.innerHTML).toContain('<option value="MID3" selected>Midnight Season 3</option>');
    expect(els.signupTierPicker.innerHTML).toContain('<option value="MID2">Midnight Season 2</option>');
    s.onSignupTierChange('MID2');
    expect(s.signupTier()).toBe('MID2');
    // A pick the team has since closed falls back to the newest open tier.
    s.DATA.teamSeasons = [{ season_code: 'MID3', signups_open: true, wishlist_open: false }];
    expect(s.signupTier()).toBe('MID3');
  });

  it('the classmates pool includes the roster only when the live tier is the one being signed up for', () => {
    const s = loadSandbox({
      data: {
        incomingRoster: [{ nameRealm: 'Incoming-Illidan', className: 'Mage', mainSpec: 'Frost' }],
        roster: [{ nameRealm: 'Rostered-Illidan', className: 'Mage', mainSpec: 'Frost' }],
        teamSeasons: [{ season_code: 'MID3', signups_open: true, wishlist_open: false }]
      }
    });
    expect(s.signupClassmatesPool().map((p) => p.nameRealm)).toEqual(['Incoming-Illidan']);
    s.DATA.teamSeasons = [{ season_code: 'MID2', signups_open: true, wishlist_open: false }];
    expect(
      s
        .signupClassmatesPool()
        .map((p) => p.nameRealm)
        .sort()
    ).toEqual(['Incoming-Illidan', 'Rostered-Illidan']);
  });

  it('the Sign Up nav item shows when any tier is open', () => {
    const els = { navSignup: makeEl() };
    const s = loadSandbox({ els });
    s.updateSignupNavItem();
    expect(els.navSignup.style.display).toBe('none');
    s.DATA.teamSeasons = [{ season_code: 'MID1', signups_open: true, wishlist_open: false }];
    s.updateSignupNavItem();
    expect(els.navSignup.style.display).toBe('');
  });
});
