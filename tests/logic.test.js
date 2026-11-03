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
