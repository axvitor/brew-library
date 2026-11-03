/* The Firebase bridge (firebase-init.js) against an in-memory Firestore:
   moving a library out of the old single document, saving only what
   changed, two devices at once, failures, new accounts, the label scan's
   learning, and the admin view across accounts.

   The bridge is loaded as it ships; only `firebase` is a stand-in. */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const makeFirebase = require('./helpers/fake-firestore.js');
const { ROOT } = require('./helpers/app-source.js');

const SRC = fs.readFileSync(path.join(ROOT, 'firebase-init.js'), 'utf8');
const KINDS = ['coffees', 'recipes', 'roasters', 'grinders', 'methods', 'styles'];

// A library shaped like a real one: dozens of items of each kind, with the
// fields, empty strings and nested objects the app actually stores.
function sampleLibrary() {
  const lib = { version: 1, seedVersion: 6, pristine: false, builtinStylesVersion: 3,
    coffees: [], recipes: [], roasters: [], grinders: [], methods: [], styles: [] };
  for (let i = 0; i < 6; i++) lib.roasters.push({ id: 'roa-' + i, name: 'Roaster ' + i, location: i % 2 ? 'Minas Gerais' : '' });
  for (let i = 0; i < 4; i++) lib.grinders.push({ id: 'gr-' + i, name: 'Grinder ' + i, kind: 'Hand grinder', unit: 'clicks', notes: '' });
  for (let i = 0; i < 5; i++) lib.methods.push({ id: 'me-' + i, name: 'Method ' + i, kind: 'Pour over', ratio: '1:16', notes: '' });
  for (let i = 0; i < 3; i++) lib.styles.push({ id: 'st-' + i, name: 'Style ' + i, author: 'Someone', notes: '',
    steps: [{ t: '0:00', label: 'Bloom', water: 50 }, { t: '0:45', label: 'Pour', water: 200 }] });
  for (let i = 0; i < 40; i++) lib.coffees.push({ id: 'cof-' + i, name: 'Coffee ' + i, roaster: 'Roaster ' + (i % 6),
    roasterId: 'roa-' + (i % 6), origin: i % 3 ? 'Cerrado Mineiro' : '', process: 'Natural', roast: '', varietal: '', notes: '' });
  for (let i = 0; i < 90; i++) lib.recipes.push({ id: 'rec-' + i, name: '', coffeeId: 'cof-' + (i % 40), grinderId: 'gr-' + (i % 4),
    grindSize: (i % 3) + ' turns + ' + i + ' clicks', methodId: 'me-' + (i % 5), styleId: 'st-' + (i % 3), dose: 15, water: 250,
    temp: 94, brewTime: '3:10', steps: [], notes: '', rating: i % 6, fav: i % 7 === 0, createdAt: 1700000000000 + i * 3600000,
    updatedAt: 1700000000000 + i * 3600000 });
  return lib;
}

function start() {
  const fb = makeFirebase();
  const ctx = vm.createContext({ window: {}, firebase: fb.firebase, console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {} }, setTimeout, clearTimeout, Promise, Date, JSON });
  vm.runInContext(SRC, ctx);
  return { Brew: ctx.window.Brew, fb, store: fb.store, stats: fb.stats, db: fb.db };
}
const tick = (ms) => new Promise(r => setTimeout(r, ms || 20));
const clone = (v) => JSON.parse(JSON.stringify(v));
// The bridge runs in its own vm context, whose objects have that context's
// prototypes; compare what they hold, not where they were made.
const same = (a, b, msg) => assert.deepStrictEqual(clone(a), clone(b), msg);
const ids = (list) => list.map(e => e.id);
function docsUnder(store, prefix) {
  const out = [];
  store.forEach((_, p) => { if (p.startsWith(prefix) && p.split('/').length === prefix.split('/').length) out.push(p); });
  return out;
}

test('moving a library out of the old single document', async () => {
  const t = start();
  const old = sampleLibrary();
  old.scanLearn = { ex: [], layouts: { 'roaster 1': { name: 0.2 } } };
  t.store.set('libraries/me', clone(old));
  const lib = await t.Brew.loadLibrary('me');

  for (const k of KINDS) {
    same(lib[k], old[k], k + ' come back whole, in order');
    assert.equal(docsUnder(t.store, 'libraries/me/' + k + '/').length, old[k].length, k + ': one document each');
  }
  const meta = t.store.get('libraries/me');
  assert.ok(KINDS.every(k => !(k in meta)), 'the settings document keeps no item arrays');
  assert.equal(meta.schema, 2);
  same(meta.scanLearn, old.scanLearn, 'settings are kept');
  same(t.store.get('libraries/me/backup/v1').library, old, 'a full backup of the old document is saved');
  assert.ok(!('schema' in lib) && lib.recipes.every(r => !('_pos' in r)), 'the app never sees internal fields');

  const again = await t.Brew.loadLibrary('me');
  for (const k of KINDS) same(again[k], old[k], 'reloading gives the same ' + k);
});

test('a save writes only what changed', async () => {
  const t = start();
  t.store.set('libraries/me', clone(sampleLibrary()));
  const lib = await t.Brew.loadLibrary('me');
  t.Brew.subscribeLibrary('me', () => {});
  await tick();
  const writes = () => t.stats.writes + t.stats.deletes;

  let w = writes();
  await t.Brew.saveLibrary('me', lib);
  assert.equal(writes() - w, 0, 'an unchanged library writes nothing');

  lib.recipes[3].rating = 5;
  w = writes();
  await t.Brew.saveLibrary('me', lib);
  assert.equal(writes() - w, 1, 'one changed recipe, one write');
  assert.equal(t.store.get('libraries/me/recipes/rec-3').rating, 5);

  lib.recipes.push({ id: 'rec-new', coffeeId: 'cof-0', steps: [], createdAt: Date.now(), extra: undefined });
  w = writes();
  await t.Brew.saveLibrary('me', lib);
  assert.equal(writes() - w, 1, 'one added recipe, one write');
  assert.ok(!('extra' in t.store.get('libraries/me/recipes/rec-new')), 'undefined fields are left out');

  lib.coffees.splice(5, 1);
  w = writes();
  await t.Brew.saveLibrary('me', lib);
  assert.equal(writes() - w, 1, 'one removed coffee, one delete');
  assert.ok(!t.store.has('libraries/me/coffees/cof-5'));

  lib.lastSeen = { id: 'rec-2', at: 1 };
  w = writes();
  await t.Brew.saveLibrary('me', lib);
  assert.equal(writes() - w, 1, 'a changed setting writes only the settings document');

  lib.coffees.push({ id: 'cof-a/b', name: 'Slash' });
  await t.Brew.saveLibrary('me', lib);
  assert.ok(t.store.has('libraries/me/coffees/cof-a%2Fb'), 'an id with "/" is stored safely');

  const t2 = start();
  t.store.forEach((v, k) => t2.store.set(k, clone(v)));
  const back = await t2.Brew.loadLibrary('me');
  same(ids(back.recipes), ids(lib.recipes), 'order survives a reload, new items last');
  same(ids(back.coffees), ids(lib.coffees), 'removed items stay removed');
  same(back.lastSeen, lib.lastSeen);
});

test('the label scan’s [text, field] pairs, which Firestore can’t hold as they are', async () => {
  const t = start();
  t.store.set('libraries/me', clone(sampleLibrary()));
  const lib = await t.Brew.loadLibrary('me');
  t.Brew.subscribeLibrary('me', () => {});
  await tick();
  lib.scanLearn = { ex: [['Fazenda Pinhal', 'name'], ['Natural', 'process']], layouts: { x: { name: [0.1, 0.2] } } };
  await t.Brew.saveLibrary('me', lib);   // the stand-in throws on nested arrays, like Firestore

  const t2 = start();
  t.store.forEach((v, k) => t2.store.set(k, clone(v)));
  const back = await t2.Brew.loadLibrary('me');
  same(back.scanLearn, lib.scanLearn, 'comes back exactly as saved');
  const w = t2.stats.writes;
  await t2.Brew.saveLibrary('me', back);
  assert.equal(t2.stats.writes, w, 'and re-saving it unchanged writes nothing');
});

test('two devices editing different recipes at once both keep their edit', async () => {
  const t = start();
  t.store.set('libraries/me', clone(sampleLibrary()));
  const lib = await t.Brew.loadLibrary('me');
  let latest = null;
  t.Brew.subscribeLibrary('me', l => { latest = l; });
  await tick();

  const other = clone(t.store.get('libraries/me/recipes/rec-0'));
  other.notes = 'from the phone';
  await t.db.collection('libraries').doc('me').collection('recipes').doc('rec-0').set(other);
  lib.recipes[1].notes = 'from the laptop';
  await t.Brew.saveLibrary('me', lib);
  await tick(40);

  assert.equal(t.store.get('libraries/me/recipes/rec-0').notes, 'from the phone');
  assert.equal(t.store.get('libraries/me/recipes/rec-1').notes, 'from the laptop');
  assert.equal(latest.recipes[0].notes, 'from the phone', 'this device hears about the other edit');
});

test('a move that fails leaves the old library untouched, and the next load finishes it', async () => {
  const t = start();
  const old = sampleLibrary();
  t.store.set('libraries/me', clone(old));
  t.fb.faults.failBatch = 1;
  await assert.rejects(t.Brew.loadLibrary('me'));
  const meta = t.store.get('libraries/me');
  for (const k of KINDS) same(meta[k], old[k], 'old ' + k + ' still all there');

  const lib = await t.Brew.loadLibrary('me');
  for (const k of KINDS) same(lib[k], old[k]);
  assert.ok(KINDS.every(k => !(k in t.store.get('libraries/me'))));
});

test('a new account starts empty and its first update already has its starter items', async () => {
  const t = start();
  assert.equal(await t.Brew.loadLibrary('new'), null);
  const seeded = { version: 1, seedVersion: 6, pristine: true, coffees: [], recipes: [], roasters: [],
    grinders: sampleLibrary().grinders, methods: sampleLibrary().methods, styles: sampleLibrary().styles };
  t.Brew.saveLibrary('new', seeded);
  let first = null;
  t.Brew.subscribeLibrary('new', l => { if (!first) first = l; });
  await tick(40);
  assert.equal(first.grinders.length, 4);
  assert.equal(first.methods.length, 5);
  assert.equal(docsUnder(t.store, 'libraries/new/grinders/').length, 4);
});

test('an out-of-date copy of the app saving the old layout is moved in, not lost', async () => {
  const t = start();
  t.store.set('libraries/me', clone(sampleLibrary()));
  await t.Brew.loadLibrary('me');
  let latest = null;
  t.Brew.subscribeLibrary('me', l => { latest = l; });
  await tick();
  const stale = sampleLibrary();
  stale.recipes[0].notes = 'saved by the old app';
  await t.db.collection('libraries').doc('me').set(stale);
  await tick(60);
  assert.equal(t.store.get('libraries/me/recipes/rec-0').notes, 'saved by the old app');
  assert.ok(KINDS.every(k => !(k in t.store.get('libraries/me'))));
  assert.equal(latest.recipes[0].notes, 'saved by the old app');
});

test('the admin view reads moved and not-yet-moved accounts alike', async () => {
  const t = start();
  const lib = sampleLibrary();
  t.store.set('libraries/moved', clone(lib));
  await t.Brew.loadLibrary('moved');
  const legacy = { version: 1, coffees: [{ id: 'c1', name: 'Old one' }], recipes: [{ id: 'r1', coffeeId: 'c1' }],
    roasters: [], grinders: [], methods: [], styles: [] };
  t.store.set('libraries/legacy', clone(legacy));
  t.store.set('profiles/moved', { name: 'A' });
  let got = null;
  t.Brew.watchAdminData(d => { got = d; }, e => { throw e; });
  await tick(60);
  same(ids(got.libraries.moved.recipes), ids(lib.recipes));
  same(ids(got.libraries.moved.coffees), ids(lib.coffees));
  same(got.libraries.legacy.coffees, legacy.coffees);
  assert.ok(got.libraries.moved.recipes.every(r => !('_pos' in r)));
  for (const k of KINDS) assert.equal(got.libraries.moved[k].length, lib[k].length, 'backups are not counted as ' + k);
});
