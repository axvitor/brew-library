/* Every piece of text the app shows has a Portuguese version.

   The app translates with t('English') and tf('English {n}', …), looking
   the English up in TRANSLATIONS.pt; anything missing quietly stays in
   English. Several have slipped through that way — a placeholder written
   straight into the markup, a dialog body, the Filters page — and were
   only noticed on the phone. These checks catch them when they're made. */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { APP } = require('./helpers/app-source.js');

// Text that is the same in both languages on purpose: names and numbers.
const SAME_IN_BOTH = new Set([
  'Brew Library',
  'Moka Clube', 'Ethiopia Guji', 'Caturra, Geisha…', 'KINGrinder K6', 'Chemex', '16', 'Lance Hedrick — Ultra'
]);

function unquote(s) { return s.replace(/\\'/g, "'"); }

function dictionary() {
  const from = APP.indexOf('var TRANSLATIONS = {');
  assert.ok(from >= 0, 'app.js defines TRANSLATIONS');
  const keys = new Set();
  const block = APP.slice(from, APP.indexOf('\n};', from));
  for (const m of block.matchAll(/^    '((?:[^'\\]|\\.)*)':/gm)) keys.add(unquote(m[1]));
  assert.ok(keys.size > 200, 'found the dictionary (' + keys.size + ' entries) — if this fails, its layout changed');
  return keys;
}

test('every t(…) and tf(…) text has a Portuguese translation', () => {
  const pt = dictionary();
  const used = new Set();
  for (const m of APP.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'\s*\)/g)) used.add(unquote(m[1]));
  for (const m of APP.matchAll(/\btf\(\s*'((?:[^'\\]|\\.)*)'/g)) used.add(unquote(m[1]));
  assert.ok(used.size > 200, 'found the texts in use (' + used.size + ') — if this fails, the t() pattern changed');
  const missing = [...used].filter(k => !pt.has(k) && !SAME_IN_BOTH.has(k)).sort();
  assert.deepEqual(missing, [], 'Add these to TRANSLATIONS.pt in app.js');
});

test('form placeholders have a Portuguese translation', () => {
  const pt = dictionary();
  const missing = [...APP.matchAll(/\bph: '((?:[^'\\]|\\.)*)'/g)]
    .map(m => unquote(m[1])).filter(k => !pt.has(k) && !SAME_IN_BOTH.has(k));
  assert.deepEqual(missing, [], 'Add these placeholders to TRANSLATIONS.pt, or to SAME_IN_BOTH here if they are names');
});

test('no English written straight into placeholders, labels or titles', () => {
  // placeholder="Some words…", aria-label="Close", title="Add coffee"…
  // should go through esc(t('…')) instead. Numbers and formats such as
  // placeholder="0:45" or "15" are fine as they are.
  const raw = [...APP.matchAll(/(placeholder|aria-label|title)="([A-Z][a-z][^"']*)/g)].map(m => m[0]);
  assert.deepEqual(raw, [], 'Wrap these in esc(t(…)) and add a translation');
});

test('translations keep their {placeholders}', () => {
  // tf('Delete “{name}”?') must still have {name} in Portuguese, or the
  // name silently disappears from the sentence.
  const from = APP.indexOf('var TRANSLATIONS = {');
  const block = APP.slice(from, APP.indexOf('\n};', from));
  const wrong = [];
  for (const m of block.matchAll(/^    '((?:[^'\\]|\\.)*)': '((?:[^'\\]|\\.)*)',?$/gm)) {
    const en = (m[1].match(/\{\w+\}/g) || []).sort().join();
    const pt = (m[2].match(/\{\w+\}/g) || []).sort().join();
    if (en !== pt) wrong.push(unquote(m[1]) + '  →  ' + unquote(m[2]));
  }
  assert.deepEqual(wrong, []);
});
