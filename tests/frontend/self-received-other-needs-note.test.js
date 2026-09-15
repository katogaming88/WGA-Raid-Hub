import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// An Other report needs a note (Kat, 2026-09-14, #868). Other goes to an
// officer, who has nothing to judge it by without one. The form refuses it
// before sending, and submit_self_received() refuses it too
// (20260914201439), so the form has to ask first or the raider gets a database
// error instead.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');

function makeSandbox(source, note) {
  const rpcCalls = [];
  const els = {};
  const el = (id) => (els[id] ??= { value: '', innerHTML: '', style: {}, placeholder: '', focus() {} });
  const sandbox = {
    window: {},
    location: { search: '', pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
      getElementById: (id) => els[id] || null,
      querySelector: () => null,
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
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  el('src-row1').value = source;
  el('notes-row1').value = note;
  el('diff-row1').value = 'Heroic';
  el('form-row1');
  sandbox.supabaseClient = {
    rpc(name, params) {
      rpcCalls.push({ name, params });
      return Promise.resolve({ data: [{ id: 1, auto_approved: false }], error: null });
    },
    functions: { invoke: () => Promise.resolve({}) }
  };
  sandbox.DATA = { selfReceived: {}, roster: [] };
  return { sandbox, rpcCalls, el };
}

const submit = (sandbox) =>
  sandbox.submitSelfReceivedRequest('Kat', 'Kat-Stormrage', 'Some Ring', 'Finger', 'row1', 'Finger');

describe('Mark Received: an Other report needs a note', () => {
  it('sends nothing for Other with an empty or blank note, and marks the notes box', () => {
    for (const note of ['', '   ']) {
      const { sandbox, rpcCalls, el } = makeSandbox('Other', note);
      submit(sandbox);
      expect(rpcCalls).toEqual([]);
      expect(el('notes-row1').style.borderColor).toBe('var(--melee)');
      expect(el('notes-row1').placeholder).toContain('required');
    }
  });

  it('sends an Other report with a note', () => {
    const { sandbox, rpcCalls } = makeSandbox('Other', 'timewalking vendor');
    submit(sandbox);
    expect(rpcCalls.map((c) => c.params.p_source)).toEqual(['Other']);
  });

  it('still sends every other source without a note', () => {
    const { sandbox, rpcCalls } = makeSandbox('Great Vault', '');
    submit(sandbox);
    expect(rpcCalls).toHaveLength(1);
  });

  it('asks for the note in the box when Other is chosen, and stops asking when it is not', () => {
    const { sandbox, el } = makeSandbox('Other', '');
    el('note-row1');
    sandbox.selfReceivedSourceChanged('row1');
    expect(el('notes-row1').placeholder).toContain('required');
    el('src-row1').value = 'M+';
    sandbox.selfReceivedSourceChanged('row1');
    expect(el('notes-row1').placeholder).toBe('Notes (optional)');
  });
});
