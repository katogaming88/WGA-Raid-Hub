import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCommonJs, quietConsole } from './helpers/common-sandbox.js';

// Text from the four no-sign-in forms (M+ exclusion, BiS Source, My BiS
// Changed, Mark Received) shows as text on the officer tabs and the profile
// card, and a typed link is a link only when it's a web address (#1404).
// Each card renders with the real _esc()/_linkOrText() from js/common.js:
// the tab files run inside the same sandbox, so a stand-in can't hide a gap.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(HERE, '../../', rel), 'utf8');

const EVIL = '<img src=x onerror=alert(1)>"\'';
const BAD_LINK = 'javascript:alert(1)';

// Rendered markup is inert when the payload's tag never appears as a tag and
// no href starts with anything but http(s).
function expectInert(html) {
  expect(html).not.toMatch(/<img src=x/);
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;&quot;&#39;');
  expect(html).not.toMatch(/href="(?!https?:)/i);
}

function sandboxWithTab(tabFile) {
  const sb = loadCommonJs(quietConsole);
  const containers = {};
  sb.document.getElementById = (id) =>
    (containers[id] = containers[id] || {
      innerHTML: '',
      value: '',
      style: {},
      classList: { add() {}, remove() {}, toggle() {} }
    });
  sb.history = { replaceState() {}, pushState() {} };
  if (tabFile) vm.runInContext(read(tabFile), sb, { filename: tabFile });
  return { sb, containers };
}

describe('officer request tabs show form text as text (#1404)', () => {
  it('M+ tab: reason escaped, a non-web Raider.IO link is plain text', () => {
    const { sb, containers } = sandboxWithTab('js/tabs/tab-mplus.js');
    sb.renderMPlusSubmissions([
      { id: 1, nameRealm: 'Kat-Stormrage', timestamp: '', raiderioUrl: BAD_LINK, notes: EVIL }
    ]);
    const html = containers.mplusContainer.innerHTML;
    expectInert(html);
    expect(html).toContain(BAD_LINK);
  });

  it('M+ tab: a web Raider.IO link stays a link', () => {
    const { sb, containers } = sandboxWithTab('js/tabs/tab-mplus.js');
    sb.renderMPlusSubmissions([
      { id: 1, nameRealm: 'Kat-Stormrage', timestamp: '', raiderioUrl: 'https://raider.io/x', notes: '' }
    ]);
    expect(containers.mplusContainer.innerHTML).toContain('<a href="https://raider.io/x"');
  });

  it('BiS tab: link and note escaped, a non-web link is plain text', () => {
    const { sb, containers } = sandboxWithTab('js/tabs/tab-bis.js');
    sb.renderBisSubmissions([
      { id: 1, nameRealm: 'Kat-Stormrage', timestamp: '', bisLink: BAD_LINK + EVIL, notes: EVIL }
    ]);
    expectInert(containers.bisContainer.innerHTML);
  });

  it('Requests tab, pending: source and note escaped', () => {
    const { sb, containers } = sandboxWithTab('js/tabs/tab-requests.js');
    sb.renderPendingRequests([
      { id: 1, nameRealm: 'Kat-Stormrage', item: 'Foo', slot: '', timestamp: '', source: EVIL, notes: EVIL }
    ]);
    expectInert(containers.requestsContainer.innerHTML);
  });

  it('Requests tab, recent decisions: source, note and rejection reason escaped', () => {
    const { sb, containers } = sandboxWithTab('js/tabs/tab-requests.js');
    sb._requestsDecisionRows = [
      {
        id: 1,
        status: 'rejected',
        players: { name_realm: 'Kat-Stormrage' },
        items: { name: 'Foo' },
        source: EVIL,
        note: EVIL,
        officer_notes: EVIL
      }
    ];
    sb.renderRecentDecisions();
    expectInert(containers.requestsDecisions.innerHTML);
  });
});

describe('profile card shows form text as text (#1404)', () => {
  function renderKat(selfRecSource) {
    const { sb } = sandboxWithTab(null);
    sb.getDiscordSession = () => ({ nameRealm: 'Kat-Stormrage' });
    sb.wishlistBisItems = () => [{ item: 'Foo', slot: 'Head' }];
    sb.DATA = {
      roster: [
        {
          firstName: 'Kat',
          nameRealm: 'Kat-Stormrage',
          realm: 'Stormrage',
          bisLink: BAD_LINK,
          mPlusExcluded: true,
          mPlusNote: EVIL
        }
      ],
      selfReceived: { Kat: [{ item: 'Foo', source: selfRecSource }] }
    };
    const container = { innerHTML: '' };
    sb.renderProfile('Kat', 'landing', container);
    return container.innerHTML;
  }

  it('BiS link, M+ note and a tracked loot source (tooltip and label) are inert', () => {
    const html = renderKat('Mythic: ' + EVIL);
    expectInert(html);
    expect(html).toContain('title="Mythic: &lt;img');
  });

  it('an untracked loot source is inert', () => {
    expectInert(renderKat(EVIL));
  });
});

describe("the team page's _esc() is the quote-safe one (#1404)", () => {
  it('js/roster.js does not redeclare _esc over common.js', () => {
    expect(read('js/roster.js')).not.toMatch(/function _esc\(/);
  });
});
