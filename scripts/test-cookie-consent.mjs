import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../cookie-consent.js', import.meta.url), 'utf8');
const key = 'cmo-cookie-consent-v1';
function browser({ choice, age = 0, gpc = false, analytics = 'G-TEST' } = {}) {
  const nodes = [];
  const scripts = [];
  const cookies = [];
  const storage = new Map();
  if (choice) storage.set(key, JSON.stringify({ choice, at: Date.now() - age }));
  const element = () => {
    const node = { dataset: {}, children: [], handlers: {}, removed: false,
      setAttribute() {}, focus() {}, remove() { this.removed = true; },
      append(...children) { this.children.push(...children); },
      addEventListener(name, handler) { this.handlers[name] = handler; },
      querySelector() { return this.children[0]; },
    };
    nodes.push(node);
    return node;
  };
  const settings = element();
  const document = {
    currentScript: { dataset: { analytics } },
    createElement: element,
    querySelectorAll: () => [settings],
    head: { append: (script) => scripts.push(script) },
    body: { append() {} },
    get cookie() { return '_ga=existing; necessary=keep'; },
    set cookie(value) { cookies.push(value); },
  };
  const state = { reloads: 0 };
  const window = { addEventListener() {} };
  vm.runInNewContext(source, {
    window, document, navigator: { globalPrivacyControl: gpc },
    location: { hostname: 'www.cmo.xyz', reload() { state.reloads++; } },
    localStorage: { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    Date,
  });
  return { scripts, cookies, window, state, storage,
    open: () => settings.handlers.click(),
    choose(value) { nodes.findLast((node) => node.dataset.cookieChoice === value).handlers.click(); },
    acceptDisabled: () => nodes.findLast((node) => node.dataset.cookieChoice === 'accepted')?.disabled,
  };
}

test('fresh and rejected visits send no analytics and preserve necessary cookies', () => {
  for (const choice of [undefined, 'rejected']) {
    const b = browser({ choice });
    assert.equal(b.scripts.length, 0);
    assert.ok(b.cookies.length > 0);
    assert.ok(b.cookies.every((value) => value.startsWith('_ga=')));
  }
});
test('acceptance loads once with advertising disabled', () => {
  const b = browser();
  b.choose('accepted'); b.open(); b.choose('accepted');
  assert.equal(b.scripts.length, 1);
  const config = b.window.dataLayer.find((args) => args[0] === 'config')[2];
  assert.equal(config.allow_google_signals, false);
  assert.equal(config.allow_ad_personalization_signals, false);
  assert.equal(config.cookie_update, false);
  assert.equal(JSON.parse(b.storage.get(key)).choice, 'accepted');
});
test('saved consent expires after 180 days', () => {
  assert.equal(browser({ choice: 'accepted' }).scripts.length, 1);
  assert.equal(browser({ choice: 'accepted', age: 181 * 86400000 }).scripts.length, 0);
});
test('GPC overrides saved acceptance', () => {
  const b = browser({ choice: 'accepted', gpc: true });
  b.open();
  assert.equal(b.scripts.length, 0);
  assert.equal(b.acceptDisabled(), true);
  b.choose('accepted');
  assert.equal(b.scripts.length, 0);
  assert.equal(JSON.parse(b.storage.get(key)).choice, 'rejected');
});
test('withdrawal disables collection and reloads after clearing cookies', () => {
  const b = browser({ choice: 'accepted' });
  b.open(); b.choose('rejected');
  assert.equal(b.window['ga-disable-G-TEST'], true);
  assert.equal(b.state.reloads, 1);
  assert.ok(b.cookies.length > 0);
});
test('a later acceptance reverses rejection in the same session', () => {
  const b = browser();
  b.choose('rejected'); b.open(); b.choose('accepted');
  assert.equal(b.window['ga-disable-G-TEST'], false);
  assert.equal(b.scripts.length, 1);
});
test('legal pages never load analytics even with consent', () => {
  assert.equal(browser({ choice: 'accepted', analytics: null }).scripts.length, 0);
});
