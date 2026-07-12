import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #386: an approved self-received item flips the matching bis_items row to
// obtained, via a trigger on self_received_requests. The trigger can only do
// that if the request records WHICH bis_items row it was raised against, since
// the same item can occupy several slots for one player -- the placeholder
// sources ('M+', 'Crafted', 'Catalyst') routinely do.
//
// The subtle part: the row's raw bis_items.slot (entry.dbSlot) is NOT the slot
// the UI displays (entry.slot / DATA.itemSlots), which prefers the item
// catalog's own name. Live data has catalog "Boots"/"Gloves"/"Trinket" against
// bis_items "Feet"/"Hands"/"Trinket 1". Sending the display slot would make the
// trigger match nothing for most real items, so these tests pin that p_slot
// carries dbSlot specifically.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');

function makeSandbox() {
  const rpcCalls = [];
  const els = {};
  function el(id) {
    if (!els[id]) els[id] = { value: '', innerHTML: '', style: {} };
    return els[id];
  }

  const sandbox = {
    window: {},
    location: { search: '', pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
      getElementById: (id) => els[id] || null,
      // The post-submit continuation re-renders the BiS row; nothing here
      // asserts on the DOM, so these just keep it from throwing.
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

  // The form fields the submit handlers read.
  el('src-row1').value = 'M+';
  el('notes-row1').value = '';
  el('diff-row1').value = 'Mythic';
  el('form-row1');

  sandbox.supabaseClient = {
    rpc(name, params) {
      rpcCalls.push({ name, params });
      return Promise.resolve({ data: [{ id: 1, auto_approved: true }], error: null });
    }
  };
  sandbox.DATA = { selfReceived: {}, roster: [] };
  return { sandbox, rpcCalls };
}

describe('self-received sends the bis_items slot, not the display slot (#386)', () => {
  it('submit_self_received carries dbSlot as p_slot', () => {
    const { sandbox, rpcCalls } = makeSandbox();
    // Display slot "Trinket" (the catalog name) vs the real BiS row "Trinket 1".
    sandbox.submitSelfReceivedRequest('Kat', 'Kat-Stormrage', 'Some Trinket', 'Trinket', 'row1', 'Trinket 1');

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe('submit_self_received');
    expect(rpcCalls[0].params.p_slot).toBe('Trinket 1');
    // Guard the exact regression: the display slot must NOT be what we send.
    expect(rpcCalls[0].params.p_slot).not.toBe('Trinket');
    expect(rpcCalls[0].params.p_item_name).toBe('Some Trinket');
  });

  it('direct_mark_received carries dbSlot as p_slot', () => {
    const { sandbox, rpcCalls } = makeSandbox();
    sandbox.submitDirectMarkReceived('Kat', 'Kat-Stormrage', 'Some Trinket', 'Trinket', 'row1', 'Trinket 1');

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe('direct_mark_received');
    expect(rpcCalls[0].params.p_slot).toBe('Trinket 1');
    expect(rpcCalls[0].params.p_slot).not.toBe('Trinket');
  });

  it('a placeholder listed in several slots sends the one row it was clicked from', () => {
    const { sandbox, rpcCalls } = makeSandbox();
    // "M+" is a loot source a player can list against many slots; the button was
    // rendered for the Wrist row, so only Wrist may be filled on approval.
    sandbox.submitSelfReceivedRequest('Kat', 'Kat-Stormrage', 'M+', '', 'row1', 'Wrist');
    expect(rpcCalls[0].params.p_slot).toBe('Wrist');
  });

  it('a legacy BiS row with no slot sends empty, letting the trigger decide', () => {
    const { sandbox, rpcCalls } = makeSandbox();
    sandbox.submitSelfReceivedRequest('Kat', 'Kat-Stormrage', 'Some Trinket', 'Trinket', 'row1', '');
    // Empty -> nullif() -> NULL, which the trigger only infers a target for when
    // the item occupies exactly one slot for that player.
    expect(rpcCalls[0].params.p_slot).toBe('');
  });
});
