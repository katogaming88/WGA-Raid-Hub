import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// js/contact.js is a plain browser script, so it runs here in a vm sandbox on
// top of the real js/common.js -- same harness shape as
// tests/frontend/boe-submit.test.js.
//
// The subject since #957 is what the report carries: the submitter's identity
// comes from the JWT the function reads server-side, so the body holds only
// what the page legitimately knows. getDiscordSession is stubbed as a spy
// rather than left undefined, because a call site that still reads it would
// otherwise pass by taking the not-logged-in branch.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const CONTACT_JS = readFileSync(path.join(HERE, '../../js/contact.js'), 'utf8');

const SESSION = {
  username: 'Rexx',
  discordId: '281652589848690688',
  authUserId: 'uid-1'
};

function makeSandbox() {
  const els = {};
  const sessionCalls = [];
  function el(id) {
    if (!els[id]) els[id] = { value: '', innerHTML: '', textContent: '', style: {}, disabled: false };
    return els[id];
  }
  ['contactName', 'contactMessage', 'contactSubmitBtn', 'contactStatus'].forEach(el);

  const sandbox = {
    window: {},
    location: { search: '', pathname: '/index.html' },
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
  sandbox.getDiscordSession = () => {
    sessionCalls.push(1);
    return SESSION;
  };
  vm.runInContext(CONTACT_JS, sandbox, { filename: 'contact.js' });
  return { sandbox, els, el, sessionCalls };
}

// submitContactForm returns nothing, so a macrotask boundary is what drains
// the invoke's promise chain.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function recorderClient(result = { data: { success: true }, error: null }) {
  const calls = [];
  return {
    calls,
    client: {
      functions: {
        invoke(name, opts) {
          calls.push({ name, body: opts && opts.body });
          return typeof result === 'function' ? result() : Promise.resolve(result);
        }
      }
    }
  };
}

describe('contact-webhook invoke body (#957)', () => {
  it('sends the team, the typed name and the message, and nothing else', async () => {
    const { sandbox, el } = makeSandbox();
    const { calls, client } = recorderClient();
    sandbox.supabaseClient = client;
    el('contactName').value = '  Rexx  ';
    el('contactMessage').value = '  the roster tab is blank  ';
    sandbox.submitContactForm();
    await settle();
    expect(calls.length).toBe(1);
    expect(calls[0].name).toBe('contact-webhook');
    expect(calls[0].body).toEqual({
      team: 'phoenix',
      name: 'Rexx',
      message: 'the roster tab is blank'
    });
  });

  it('reads no identity from the page at all', async () => {
    // The identity is the JWT's since #957, so the page has no business
    // reading the session for this post: a body field it does not send
    // cannot be forged, and one it does send is worth exactly nothing.
    const { sandbox, el, sessionCalls } = makeSandbox();
    const { client } = recorderClient();
    sandbox.supabaseClient = client;
    el('contactMessage').value = 'anything';
    sandbox.submitContactForm();
    await settle();
    expect(sessionCalls.length).toBe(0);
  });

  it('sends an empty name when the optional field is blank', async () => {
    const { sandbox, el } = makeSandbox();
    const { calls, client } = recorderClient();
    sandbox.supabaseClient = client;
    el('contactMessage').value = 'no name given';
    sandbox.submitContactForm();
    await settle();
    expect(calls[0].body.name).toBe('');
  });
});

describe('the form before the call', () => {
  it('refuses a blank message before any network call', async () => {
    const { sandbox, el } = makeSandbox();
    const { calls, client } = recorderClient();
    sandbox.supabaseClient = client;
    el('contactMessage').value = '   ';
    sandbox.submitContactForm();
    await settle();
    expect(calls.length).toBe(0);
    expect(el('contactStatus').textContent).toBe('Please enter a message.');
  });

  it('disables the button during the call and restores it after', async () => {
    const { sandbox, el } = makeSandbox();
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    sandbox.supabaseClient = { functions: { invoke: () => gate } };
    el('contactMessage').value = 'hello';
    sandbox.submitContactForm();
    expect(el('contactSubmitBtn').disabled).toBe(true);
    expect(el('contactSubmitBtn').textContent).toBe('Sending...');
    release({ data: { success: true }, error: null });
    await settle();
    expect(el('contactSubmitBtn').disabled).toBe(false);
    expect(el('contactSubmitBtn').textContent).toBe('Send');
  });
});

describe('what the submitter is told', () => {
  it('clears both fields and announces on success', async () => {
    const { sandbox, el } = makeSandbox();
    const { client } = recorderClient();
    sandbox.supabaseClient = client;
    el('contactName').value = 'Rexx';
    el('contactMessage').value = 'the roster tab is blank';
    sandbox.submitContactForm();
    await settle();
    expect(el('contactName').value).toBe('');
    expect(el('contactMessage').value).toBe('');
    expect(el('contactStatus').textContent).toBe('Sent! Thanks for the report.');
  });

  it('shows the error the function reported, and keeps the message typed', async () => {
    const { sandbox, el } = makeSandbox();
    const { client } = recorderClient({ data: { success: false, error: 'Missing message' }, error: null });
    sandbox.supabaseClient = client;
    el('contactMessage').value = 'hello';
    sandbox.submitContactForm();
    await settle();
    expect(el('contactStatus').textContent).toBe('Missing message');
    expect(el('contactMessage').value).toBe('hello');
  });

  it('shows the transport error when the invoke itself failed', async () => {
    const { sandbox, el } = makeSandbox();
    const { client } = recorderClient({ data: null, error: { message: 'Failed to fetch' } });
    sandbox.supabaseClient = client;
    el('contactMessage').value = 'hello';
    sandbox.submitContactForm();
    await settle();
    expect(el('contactStatus').textContent).toBe('Failed to fetch');
  });

  it('restores the button and reports when the call rejects', async () => {
    const { sandbox, el } = makeSandbox();
    sandbox.supabaseClient = { functions: { invoke: () => Promise.reject(new Error('offline')) } };
    el('contactMessage').value = 'hello';
    sandbox.submitContactForm();
    await settle();
    expect(el('contactSubmitBtn').disabled).toBe(false);
    expect(el('contactSubmitBtn').textContent).toBe('Send');
    expect(el('contactStatus').textContent).toBe('offline');
  });
});
