/* The app's small rules, lifted out of app.js by name and run as they
   ship: time entry and parsing, ratios, the dial-in advice, and the admin
   dashboard's counting. */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/app-source.js');

const t = (s) => s;                       // English, untranslated
const locale = () => 'en-GB';

test('brew time fills m:ss from the right as digits are typed', () => {
  const { formatTyped, timeDigits } = load(['formatTyped', 'timeDigits']);
  const typed = (s) => formatTyped(/^~/.test(s) ? '~' : '', timeDigits(s));
  assert.equal(typed('3'), '0:03');
  assert.equal(typed('34'), '0:34');
  assert.equal(typed('345'), '3:45');
  assert.equal(typed('1230'), '12:30');
  assert.equal(typed('12345'), '12:34', 'four digits at most');
  assert.equal(typed('0028'), '0:28', 'leading zeros dropped');
  assert.equal(typed('3:45'), '3:45', 'typing the colon still works');
  assert.equal(typed('~028'), '~0:28', 'an approximate time keeps its ~');
  assert.equal(typed(''), '');
});

test('times read back as seconds', () => {
  const { secondsOf, normTime, mmss } = load(['secondsOf', 'normTime', 'mmss']);
  assert.equal(secondsOf('3:45'), 225);
  assert.equal(secondsOf('~0:28'), 28);
  assert.equal(secondsOf('45'), 45, 'bare digits are seconds');
  assert.equal(secondsOf(''), null);
  assert.equal(normTime('34'), '0:34');
  assert.equal(normTime('3:10'), '3:10');
  assert.equal(mmss(270), '4:30');
  assert.equal(mmss(5), '0:05');
});

test('ratios read as 1:x', () => {
  const { ratio } = load(['ratio']);
  assert.equal(ratio(15, 250), '1:16.7');
  assert.equal(ratio(20, 40), '1:2');
  assert.equal(ratio(18, 36.9), '1:2.05');
  assert.equal(ratio(0, 250), '—');
  assert.equal(ratio('', ''), '—');
});

test('dial-in advice: the grind step fits the grinder', () => {
  const { grindStep } = load(['grindStep'], { t });
  assert.equal(grindStep({ unit: 'clicks' }, 'Pour over'), '2–3 clicks');
  assert.equal(grindStep({ unit: 'clicks' }, 'Espresso'), '1–2 clicks');
  assert.equal(grindStep({ unit: 'dial' }, 'Pour over'), '1 step');
  assert.equal(grindStep({ unit: 'numbers' }, 'Espresso'), 'half a step');
  assert.equal(grindStep({ unit: 'cliques' }, 'Pour over'), '2–3 clicks', 'a unit written in Portuguese');
  assert.equal(grindStep(null, 'Pour over'), 'a little', 'no grinder');
});

test('dial-in advice: sour goes finer, bitter coarser, with the lever that suits the method', () => {
  const methods = { v60: { kind: 'Pour over' }, esp: { kind: 'Espresso' }, aero: { kind: 'Immersion' }, moka: { kind: 'Moka pot' } };
  const grinders = { k: { unit: 'clicks' } };
  const { tf } = load(['tf'], { t });
  const { dialAdvice } = load(['dialAdvice', 'grindStep'], {
    t, tf, findIn: (kind, id) => (kind === 'method' ? methods : grinders)[id],
    methodType: (me) => me && me.kind
  });
  const r = (m) => ({ methodId: m, grinderId: 'k' });

  assert.equal(dialAdvice(r('v60'), 'sour').main, 'Grind 2–3 clicks finer next time.');
  assert.equal(dialAdvice(r('v60'), 'sour').alt, 'Or brew 1–2 °C hotter.');
  assert.equal(dialAdvice(r('v60'), 'bitter').main, 'Grind 2–3 clicks coarser next time.');
  assert.equal(dialAdvice(r('v60'), 'bitter').alt, 'Or brew 1–2 °C cooler.');
  assert.equal(dialAdvice(r('esp'), 'sour').main, 'Grind 1–2 clicks finer next time.');
  assert.equal(dialAdvice(r('esp'), 'bitter').alt, 'Or stop the shot 2–3 s earlier.');
  assert.equal(dialAdvice(r('aero'), 'sour').alt, 'Or steep 30 s longer.');
  assert.equal(dialAdvice(r('moka'), 'bitter').alt, 'Or take it off the heat sooner.');
  const ok = dialAdvice(r('v60'), 'balanced');
  assert.equal(ok.main, 'Dialled in — keep these settings.');
  assert.equal(ok.alt, '');
});

test('dashboard tallies match names loosely and rank by count', () => {
  const { tally, looseKey } = load(['tally', 'looseKey']);
  assert.equal(looseKey('  Moka   Clube '), 'moka clube');
  const rows = tally(['Moka Clube', 'moka clube', 'Sabino', '', 'MOKA  CLUBE', null, 'Sabino', 'Arbor']);
  assert.deepEqual(rows.map(r => [r.label, r.value]), [['Moka Clube', 3], ['Sabino', 2], ['Arbor', 1]]);
});

test('dashboard periods cover the range end to end, and count into the right one', () => {
  const lib = load(['adminBuckets', 'countInto', 'startOfDay', 'rangeStart'], { t, locale }, ['DAY_MS']);
  const now = Date.now(), today = lib.startOfDay(now);

  const week = lib.adminBuckets('7');
  assert.equal(week.length, 7);
  assert.equal(week[6].start, today, 'the last period is today');
  for (let i = 1; i < week.length; i++) assert.equal(week[i].start, week[i - 1].end, 'no gaps between days');
  assert.equal(lib.rangeStart('7'), week[0].start);

  const year = lib.adminBuckets('365');
  assert.equal(year.length, 12, 'twelve months');
  assert.ok(year[11].start <= now && now < year[11].end, 'the last month is this month');

  const quarter = lib.adminBuckets('90');
  assert.equal(quarter.length, 13, 'thirteen weeks');
  assert.ok(quarter[12].end > now, 'the last week includes today');

  const counts = lib.countInto(week, [today + 1000, today + 2000, week[0].start, week[0].start - 1, now + 3 * 86400000]);
  assert.equal(counts[6], 2, 'two today');
  assert.equal(counts[0], 1, 'one on the first day');
  assert.equal(counts.reduce((a, b) => a + b, 0), 3, 'before the range and in the future are left out');
});

test('AeroPress drawing: moments come from the steps, inverted ones included', () => {
  const { aeroModel } = load(['aeroModel']);
  const plan = (steps, total) => ({
    total, water: steps.reduce((a, s) => a + (s[2] || 0), 0),
    segs: steps.map((s, i) => ({ start: s[0], end: i + 1 < steps.length ? steps[i + 1][0] : total, label: s[1], water: s[2] || 0 }))
  });

  const inv = aeroModel(plan([
    [0, 'Flip the AeroPress upside down, seat the plunger a few rings in, then add the coffee.'],
    [15, 'Pour in all the water and stir well to saturate every ground.'],
    [60, 'Wet the filter, screw on the cap, then let it steep undisturbed.'],
    [90, 'Flip upright onto your mug.'],
    [105, 'Press slowly and evenly — about 30 seconds.']
  ], 150), 15, 225);
  assert.equal(inv.inverted, true);
  assert.equal(inv.pours[0].at, 15, 'the water goes in at the step that pours it');
  assert.equal(inv.pressStart, 105, '"AeroPress" in the first step is not the press');
  assert.equal(inv.capAt, 60);
  assert.equal(inv.flipAt, 90);
  assert.ok(inv.flipEnd > inv.flipAt && inv.flipEnd <= inv.pressStart);

  const up = aeroModel(plan([
    [0, 'Pour all the water', 200], [10, 'Insert the plunger'], [120, 'Swirl gently'], [150, 'Press gently']
  ], 180), 11, 200);
  assert.equal(up.inverted, undefined, 'an upright recipe stays upright');
  assert.equal(up.insertAt, 10);
  assert.equal(up.pressStart, 150);
});

test('brew drawings: pours take their own time, and brewer names are not steps', () => {
  const { pourModel, immersionModel, aeroModel } = load(['pourModel', 'immersionModel', 'aeroModel']);
  const plan = (steps, total) => ({
    total, water: steps.reduce((a, s) => a + (s[2] || 0), 0),
    segs: steps.map((s, i) => ({ start: s[0], end: i + 1 < steps.length ? steps[i + 1][0] : total, label: s[1], water: s[2] || 0, pour: s[3] || 0 }))
  });

  // Tetsu's pours give no seconds: about 6 g a second, not the whole 45 s step.
  const tetsu = pourModel(plan([[0, 'Pour', 50], [45, 'Pour', 70], [90, 'Pour', 60]], 135), 15);
  assert.deepEqual(tetsu.pours.map(q => Math.round(q.dur)), [8, 12, 10]);
  const hoff = pourModel(plan([[0, 'Bloom', 50, 10], [45, 'Pour', 50, 10]], 155), 15);
  assert.deepEqual(hoff.pours.map(q => q.dur), [10, 10], 'a step that says how long keeps it');

  const fp = immersionModel(plan([[0, 'Add the coffee to the French press and pour the water', 500], [240, 'Break the crust'], [300, 'Press the plunger down slowly']], 330), 30, 500);
  assert.equal(fp.pressStart, 300, '"French press" in the first step is not the press');

  const odd = aeroModel(plan([[0, 'Pour', 50], [45, 'Pour', 50], [90, 'Press']], 150), 15, 100);
  assert.ok(odd.insertAt <= odd.pressStart, 'the plunger goes in before the press');
});

const JOURNEY = ['originKey', 'originCountry', 'countryOfCoffee', 'journeyStats', 'badgeMet', 'awardBadges',
  'methodType', 'typeFromText', 'brewerFromName'];
const JOURNEY_VARS = ['ORIGIN_COUNTRIES', 'BADGES', 'METHOD_TYPES', 'BREWER_TYPE', 'BR_STATES'];

test('origins: the country a coffee’s origin names', () => {
  const { originCountry, countryOfCoffee } = load(JOURNEY, {}, JOURNEY_VARS);
  assert.equal(originCountry('Huila, Colombia'), '170');
  assert.equal(originCountry('Ethiopia Guji'), '231');
  assert.equal(originCountry('Etiópia'), '231', 'Portuguese, with its accent');
  assert.equal(originCountry('Cerrado Mineiro'), '076', 'a Brazilian region');
  assert.equal(originCountry('Carmo de Minas - MG'), '076', 'a town with its state');
  assert.equal(originCountry('CAPARAÓ'), '076');
  assert.equal(originCountry('Antigua, Guatemala'), '320');
  assert.equal(originCountry('Tarrazú'), '188');
  assert.equal(originCountry(''), '');
  assert.equal(originCountry('Somewhere nice'), '');
  assert.equal(originCountry('Javanese... no'), '', 'whole words only');
  assert.equal(countryOfCoffee({ origin: 'Huila', country: '231' }), '231', 'the picked country wins');
  assert.equal(countryOfCoffee({ origin: 'Huila', country: 'none' }), '', '"not set" on purpose stays unset');
  assert.equal(countryOfCoffee({ origin: 'Huila' }), '170', 'no country picked: the origin decides');
});

test('badges: earned from the recipes there are, once, and kept', () => {
  const { awardBadges, journeyStats } = load(JOURNEY, {}, JOURNEY_VARS);
  const lib = {
    methods: [{ id: 'v60', name: 'V60', kind: 'Pour over' }, { id: 'esp', name: 'Espresso', kind: 'Espresso' },
      { id: 'aero', name: 'AeroPress', kind: 'Immersion' }, { id: 'fp', name: 'French press', kind: 'Immersion' },
      { id: 'moka', name: 'Moka', kind: 'Moka pot' }, { id: 'cold', name: 'Toddy', kind: 'Cold brew' }],
    coffees: [{ id: 'a', origin: 'Cerrado Mineiro' }, { id: 'b', origin: 'Huila, Colombia' }, { id: 'c', origin: '' }],
    recipes: [{ id: 1, methodId: 'v60', coffeeId: 'a' }, { id: 2, methodId: 'aero', coffeeId: 'c' }]
  };
  const ids = () => Object.keys(lib.badges).sort();

  // The first count: what the library already qualifies for, quietly.
  let res = awardBadges(lib, 1000);
  assert.deepEqual(ids(), ['aeropress', 'first', 'pourover']);
  assert.deepEqual(res.fresh, [], 'nothing to announce for recipes made before badges');
  assert.equal(lib.badges.first.seen, true);
  assert.equal(journeyStats(lib).noCountry, 1, 'the coffee with no origin');

  // An AeroPress is its own kind, not Immersion.
  assert.equal(lib.badges.immersion, undefined);

  // A new recipe from a second country: Explorer, announced.
  lib.recipes.push({ id: 3, methodId: 'esp', coffeeId: 'b' });
  res = awardBadges(lib, 2000);
  assert.deepEqual(res.fresh.map(b => b.id).sort(), ['espresso', 'explorer']);
  assert.equal(lib.badges.explorer.seen, false, 'new: the profile pops it once');

  // Nothing new: nothing changes, nothing is awarded twice.
  res = awardBadges(lib, 3000);
  assert.equal(res.changed, false);
  assert.equal(lib.badges.espresso.at, 2000);

  // Deleting the recipes keeps what was earned.
  lib.recipes = [];
  res = awardBadges(lib, 4000);
  assert.equal(res.changed, false);
  assert.deepEqual(ids(), ['aeropress', 'espresso', 'explorer', 'first', 'pourover']);

  // Every kind of method: Pro barista.
  lib.recipes = ['v60', 'esp', 'aero', 'fp', 'moka', 'cold'].map((m, i) => ({ id: i, methodId: m, coffeeId: 'a' }));
  res = awardBadges(lib, 5000);
  assert.deepEqual(res.fresh.map(b => b.id).sort(), ['coldbrew', 'immersion', 'moka', 'pro']);
});
