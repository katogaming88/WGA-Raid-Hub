import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #1246: a raid night says Heroic or Mythic, with a team default set once at
// the top of the officer Raid Schedule tab (team_schedule_settings). A weekday
// rule or an added night left at "Team default" stores null, and
// raid_night_info() resolves it. Loads the real js/tabs/tab-schedule.js on top
// of common.js, with a Supabase client that records every write.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const SCHEDULE_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-schedule.js'), 'utf8');

function makeEl(extra) {
  return Object.assign(
    { style: {}, textContent: '', innerHTML: '', value: '', checked: false, disabled: false },
    extra
  );
}

// Every from() call is one record: the table, the write payload and options,
// the filters, and whether it asked for a single row. reads maps a table name
// to the rows a select on it answers with.
function makeClient(reads = {}) {
  const calls = [];
  const client = {
    from(table) {
      const call = { table, eqs: [] };
      calls.push(call);
      const b = {
        select(cols) {
          call.select = cols;
          return b;
        },
        insert(row) {
          call.insert = row;
          return b;
        },
        update(row) {
          call.update = row;
          return b;
        },
        upsert(row, opts) {
          call.upsert = row;
          call.upsertOpts = opts;
          return b;
        },
        delete() {
          call.delete = true;
          return b;
        },
        eq(col, val) {
          call.eqs.push([col, val]);
          return b;
        },
        gte() {
          return b;
        },
        order() {
          return b;
        },
        maybeSingle() {
          call.maybeSingle = true;
          return b;
        },
        then(resolve, reject) {
          let result;
          if (call.insert) result = { data: [Object.assign({ id: 99 }, call.insert)], error: null };
          else if (call.update || call.upsert || call.delete) result = { data: null, error: null };
          else if (call.maybeSingle) result = { data: reads[table] || null, error: null };
          else result = { data: reads[table] || [], error: null };
          return Promise.resolve(result).then(resolve, reject);
        }
      };
      return b;
    }
  };
  return { client, calls };
}

// defaultOptions stands in for the "Team default (...)" option of each weekly
// row already on screen, which a saved default relabels in place.
function loadSandbox({ reads, rowFields, defaultOptions = [] } = {}) {
  const els = {};
  const audit = [];
  const row = {
    querySelector: (sel) => {
      if (!rowFields || !(sel in rowFields)) return makeEl();
      return makeEl(rowFields[sel]);
    }
  };
  const sandbox = {
    window: {},
    location: { search: '', pathname: '/officer.html' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
      getElementById: (id) => {
        if (!els[id]) els[id] = makeEl();
        return els[id];
      },
      querySelector: (sel) => (sel.indexOf('data-rule-id') !== -1 ? row : null),
      querySelectorAll: (sel) => (sel === '.sched-rule-difficulty option[value=""]' ? defaultOptions : [])
    },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }),
    setTimeout: () => 0,
    confirm: () => true,
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  vm.runInContext(SCHEDULE_JS, sandbox, { filename: 'tab-schedule.js' });
  const { client, calls } = makeClient(reads);
  sandbox.supabaseClient = client;
  sandbox._teamCfg = { supabaseTeamId: 1 };
  sandbox._escAttr = (s) => String(s == null ? '' : s);
  sandbox.getDiscordSession = () => null;
  sandbox.writeAuditLog = (action, targetType, targetId, detail) => {
    audit.push({ action, targetType, targetId, detail });
  };
  return { sandbox, els, calls, audit };
}

function flush() {
  return new Promise((r) => setImmediate(r));
}

const RULE_FIELDS = {
  '.sched-rule-weekday': { value: '2' },
  '.sched-rule-start': { value: '21:30' },
  '.sched-rule-duration': { value: '180' },
  '.sched-rule-timezone': { value: 'America/New_York' },
  '.sched-rule-optional': { checked: false },
  '.sched-rule-active': { checked: true }
};

const TUESDAY_RULE = {
  id: 5,
  weekday: 2,
  start_time: '21:30:00',
  timezone: 'America/New_York',
  duration_minutes: 180,
  active: true,
  is_optional: false,
  difficulty: null
};

describe('saveScheduleRule() difficulty', () => {
  it('sends null for a rule left at Team default', async () => {
    const { sandbox, calls } = loadSandbox({
      rowFields: { ...RULE_FIELDS, '.sched-rule-difficulty': { value: '' } }
    });
    sandbox.SCHEDULE_RULES = [TUESDAY_RULE];
    sandbox.saveScheduleRule(5);
    await flush();
    const write = calls.find((c) => c.table === 'raid_schedule' && c.update);
    expect(write.update).toHaveProperty('difficulty', null);
    expect(sandbox.SCHEDULE_RULES[0].difficulty).toBe(null);
  });

  it('sends the pick when a rule is set to Mythic', async () => {
    const { sandbox, calls, audit } = loadSandbox({
      rowFields: { ...RULE_FIELDS, '.sched-rule-difficulty': { value: 'mythic' } }
    });
    sandbox.SCHEDULE_RULES = [TUESDAY_RULE];
    sandbox.saveScheduleRule(5);
    await flush();
    const write = calls.find((c) => c.table === 'raid_schedule' && c.update);
    expect(write.update).toHaveProperty('difficulty', 'mythic');
    expect(sandbox.SCHEDULE_RULES[0].difficulty).toBe('mythic');
    expect(audit[0].detail).toContain('Mythic');
  });
});

describe('saveScheduleDefaultDifficulty()', () => {
  // updated_at is the database's to stamp (a trigger), not the browser clock's.
  it("upserts the team's default on team_id, and nothing else", async () => {
    const { sandbox, els, calls, audit } = loadSandbox();
    els.schedDefaultDifficulty = makeEl({ value: 'heroic' });
    sandbox.saveScheduleDefaultDifficulty();
    await flush();
    const write = calls.find((c) => c.table === 'team_schedule_settings' && c.upsert);
    expect(write.upsert).toEqual({ team_id: 1, default_difficulty: 'heroic' });
    expect(write.upsertOpts).toEqual({ onConflict: 'team_id' });
    expect(sandbox.SCHEDULE_DEFAULT_DIFFICULTY).toBe('heroic');
    expect(audit[0].action).toBe('Raid Difficulty Default Updated');
  });

  it('stores null for Not set', async () => {
    const { sandbox, els, calls } = loadSandbox();
    sandbox.SCHEDULE_DEFAULT_DIFFICULTY = 'mythic';
    els.schedDefaultDifficulty = makeEl({ value: '' });
    sandbox.saveScheduleDefaultDifficulty();
    await flush();
    const write = calls.find((c) => c.table === 'team_schedule_settings' && c.upsert);
    expect(write.upsert.default_difficulty).toBe(null);
    expect(sandbox.SCHEDULE_DEFAULT_DIFFICULTY).toBe(null);
  });

  // A rebuilt table would throw away a row an officer has edited and not saved.
  it('relabels each weekly row in place and leaves the rows on screen as they are', async () => {
    const options = [
      makeEl({ textContent: 'Team default (not set)' }),
      makeEl({ textContent: 'Team default (not set)' })
    ];
    const { sandbox, els } = loadSandbox({ defaultOptions: options });
    sandbox.SCHEDULE_RULES = [TUESDAY_RULE];
    sandbox.renderScheduleRules();
    const onScreen = els.scheduleRulesWrap.innerHTML;
    els.schedDefaultDifficulty = makeEl({ value: 'mythic' });
    sandbox.saveScheduleDefaultDifficulty();
    await flush();
    expect(els.scheduleRulesWrap.innerHTML).toBe(onScreen);
    expect(options.map((o) => o.textContent)).toEqual(['Team default (Mythic)', 'Team default (Mythic)']);
  });

  it('disables its Save button until the save answers', async () => {
    const { sandbox, els } = loadSandbox();
    els.schedDefaultDifficulty = makeEl({ value: 'heroic' });
    els.schedDefaultSaveBtn = makeEl();
    sandbox.saveScheduleDefaultDifficulty();
    expect(els.schedDefaultSaveBtn.disabled).toBe(true);
    await flush();
    expect(els.schedDefaultSaveBtn.disabled).toBe(false);
  });
});

describe('addScheduleException() difficulty', () => {
  function fillForm(els, difficulty) {
    els.schedExcDateInput = makeEl({ value: '2026-10-08' });
    els.schedExcStartInput = makeEl({ value: '21:30' });
    els.schedExcDurationInput = makeEl({ value: '180' });
    els.schedExcDifficultyInput = makeEl({ value: difficulty });
  }

  it("carries an added night's pick", async () => {
    const { sandbox, els, calls } = loadSandbox();
    fillForm(els, 'mythic');
    sandbox.addScheduleException('added');
    await flush();
    const write = calls.find((c) => c.table === 'raid_schedule_exceptions' && c.insert);
    expect(write.insert).toHaveProperty('difficulty', 'mythic');
  });

  it('sends null for an added night left at Team default', async () => {
    const { sandbox, els, calls } = loadSandbox();
    fillForm(els, '');
    sandbox.addScheduleException('added');
    await flush();
    const write = calls.find((c) => c.table === 'raid_schedule_exceptions' && c.insert);
    expect(write.insert).toHaveProperty('difficulty', null);
  });

  it('sends null for a cancelled night, whatever the form holds', async () => {
    const { sandbox, els, calls } = loadSandbox();
    fillForm(els, 'mythic');
    sandbox.addScheduleException('cancelled');
    await flush();
    const write = calls.find((c) => c.table === 'raid_schedule_exceptions' && c.insert);
    expect(write.insert).toHaveProperty('difficulty', null);
  });
});

describe('the difficulty labels', () => {
  it('a rule row offers "Team default (Mythic)" first when the default is Mythic', () => {
    const { sandbox, els } = loadSandbox();
    sandbox.SCHEDULE_DEFAULT_DIFFICULTY = 'mythic';
    sandbox.SCHEDULE_RULES = [TUESDAY_RULE];
    sandbox.renderScheduleRules();
    const html = els.scheduleRulesWrap.innerHTML;
    expect(html).toContain('<option value="" selected>Team default (Mythic)</option>');
    expect(html).toContain('aria-label="Difficulty for Tuesday"');
  });

  it('a rule row reads "Team default (not set)" with no default', () => {
    const { sandbox, els } = loadSandbox();
    sandbox.SCHEDULE_RULES = [TUESDAY_RULE];
    sandbox.renderScheduleRules();
    expect(els.scheduleRulesWrap.innerHTML).toContain('>Team default (not set)</option>');
  });

  it("selects a rule's explicit pick", () => {
    const { sandbox, els } = loadSandbox();
    sandbox.SCHEDULE_DEFAULT_DIFFICULTY = 'mythic';
    sandbox.SCHEDULE_RULES = [{ ...TUESDAY_RULE, difficulty: 'heroic' }];
    sandbox.renderScheduleRules();
    const html = els.scheduleRulesWrap.innerHTML;
    expect(html).toContain('<option value="heroic" selected>Heroic</option>');
    expect(html).toContain('<option value="">Team default (Mythic)</option>');
  });

  // A night that moves from Heroic into Mythic counts as Mythic, and every
  // select an officer picks a night's difficulty from says so.
  it('every Mythic choice names the mixed night: weekly rows, the default and the added-night form', () => {
    const { sandbox, els } = loadSandbox();
    sandbox.SCHEDULE_RULES = [TUESDAY_RULE];
    sandbox.renderScheduleRules();
    expect(els.scheduleRulesWrap.innerHTML).toContain('<option value="mythic">Mythic, or Heroic into Mythic</option>');
    const page = readFileSync(path.join(HERE, '../../officer.html'), 'utf8');
    const mythicChoices = page.match(/<option value="mythic">[^<]*<\/option>/g);
    expect(mythicChoices).toEqual([
      '<option value="mythic">Mythic, or Heroic into Mythic</option>',
      '<option value="mythic">Mythic, or Heroic into Mythic</option>'
    ]);
  });

  it('the one-off list shows an added night at its resolved difficulty, and none for a cancelled one', () => {
    const { sandbox, els } = loadSandbox();
    sandbox.SCHEDULE_DEFAULT_DIFFICULTY = 'heroic';
    sandbox.SCHEDULE_EXCEPTIONS = [
      {
        id: 1,
        raid_date: '2026-10-08',
        exception_type: 'added',
        start_time: '21:30:00',
        duration_minutes: 180,
        is_optional: false,
        note: null,
        difficulty: null
      },
      {
        id: 2,
        raid_date: '2026-10-09',
        exception_type: 'added',
        start_time: '21:30:00',
        duration_minutes: 180,
        is_optional: false,
        note: null,
        difficulty: 'mythic'
      },
      {
        id: 3,
        raid_date: '2026-10-13',
        exception_type: 'cancelled',
        start_time: null,
        duration_minutes: null,
        is_optional: false,
        note: null,
        difficulty: null
      }
    ];
    sandbox.renderScheduleExceptions();
    const rows = els.scheduleExceptionsWrap.innerHTML.split('<tr').slice(2);
    expect(rows[0]).toContain('>Team default (Heroic)</td>');
    expect(rows[1]).toContain('>Mythic</td>');
    expect(rows[2]).not.toContain('Team default');
  });
});

describe('buildScheduleTab() reads the team default', () => {
  it("reads the team's row once and shows it on the select and the rule rows", async () => {
    const { sandbox, els, calls } = loadSandbox({
      reads: {
        team_schedule_settings: { default_difficulty: 'mythic' },
        raid_schedule: [TUESDAY_RULE],
        raid_schedule_exceptions: []
      }
    });
    els.scheduleRulesWrap = makeEl();
    sandbox.buildScheduleTab();
    await flush();
    await flush();
    const read = calls.filter((c) => c.table === 'team_schedule_settings');
    expect(read).toHaveLength(1);
    expect(read[0].eqs).toEqual([['team_id', 1]]);
    expect(read[0].maybeSingle).toBe(true);
    expect(els.schedDefaultDifficulty.value).toBe('mythic');
    expect(els.scheduleRulesWrap.innerHTML).toContain('>Team default (Mythic)</option>');
  });

  it('still lists the weekly nights when the default cannot be read', async () => {
    const { sandbox, els, calls } = loadSandbox({ reads: { raid_schedule: [TUESDAY_RULE] } });
    const realFrom = sandbox.supabaseClient.from;
    sandbox.supabaseClient.from = (table) => {
      const b = realFrom(table);
      if (table !== 'team_schedule_settings') return b;
      b.then = (resolve) =>
        Promise.resolve({ data: null, error: { message: 'relation does not exist' } }).then(resolve);
      return b;
    };
    els.scheduleRulesWrap = makeEl();
    sandbox.buildScheduleTab();
    await flush();
    await flush();
    expect(calls.some((c) => c.table === 'raid_schedule')).toBe(true);
    expect(els.scheduleRulesWrap.innerHTML).toContain('data-rule-id="5"');
    expect(els.scheduleDefaultStatus.textContent).toContain('relation does not exist');
  });

  // An unread default is not "Not set": showing it as one would let a Save
  // erase the real value, and the rows would name a default nobody chose.
  it('locks the default and names no value when the default cannot be read', async () => {
    const { sandbox, els } = loadSandbox({ reads: { raid_schedule: [TUESDAY_RULE] } });
    const realFrom = sandbox.supabaseClient.from;
    sandbox.supabaseClient.from = (table) => {
      const b = realFrom(table);
      if (table !== 'team_schedule_settings') return b;
      b.then = (resolve) => Promise.resolve({ data: null, error: { message: 'timeout' } }).then(resolve);
      return b;
    };
    els.scheduleRulesWrap = makeEl();
    sandbox.buildScheduleTab();
    await flush();
    await flush();
    expect(els.schedDefaultDifficulty.disabled).toBe(true);
    expect(els.schedDefaultSaveBtn.disabled).toBe(true);
    expect(els.scheduleRulesWrap.innerHTML).toContain('<option value="" selected>Team default</option>');
  });

  it('clears an earlier error and unlocks the default when a later read succeeds', async () => {
    const { sandbox, els } = loadSandbox({
      reads: { team_schedule_settings: { default_difficulty: 'heroic' }, raid_schedule: [TUESDAY_RULE] }
    });
    els.scheduleDefaultStatus = makeEl({ textContent: 'Error loading the team default: timeout' });
    els.schedDefaultDifficulty = makeEl({ disabled: true });
    els.schedDefaultSaveBtn = makeEl({ disabled: true });
    els.scheduleRulesWrap = makeEl();
    sandbox.buildScheduleTab();
    await flush();
    await flush();
    expect(els.scheduleDefaultStatus.textContent).toBe('');
    expect(els.schedDefaultDifficulty.disabled).toBe(false);
    expect(els.schedDefaultSaveBtn.disabled).toBe(false);
    expect(els.schedDefaultDifficulty.value).toBe('heroic');
  });
});
