/* Regression tests for the label scanner's parser.

   Each fixture in fixtures/scan is the verbatim OCR text from a real coffee
   bag, together with the values that reading should produce. The parser is
   pulled straight out of app.js — the section between the "---- parsing ----"
   and "---- scan UI ----" markers — so these test the shipping code rather
   than a copy of it, and no test hooks are needed in the app.

   Why this exists: OCR output varies wildly between bags, and nearly every
   improvement made for one bag has broken another. Rules that look safe in
   isolation are not — preferring a longer name picked up OCR debris,
   tidying note fragments ate the comma joining a wrapped list, and marking
   text as used before it was accepted stopped a coffee's name being found.
   Each of those was caught here rather than on the phone.

   Adding a bag: scan it, open "Everything it read" in the review sheet,
   and save that text as a new fixture with the values it should produce.
   Assert only what the bag genuinely shows — leaving a field out is better
   than baking in a wrong answer, and `expect` may use null to assert that
   nothing was found (a bag that prints no altitude must not invent one).
   A field the parser is known to get wrong today goes in `todo`: it is
   still checked and reported, but doesn't fail the run — and the report
   says when it starts passing, so it can come off the list.

   `heights` stands in for the OCR's per-line bounding boxes, which decide
   which line is the coffee's name. Only lines whose size matters need an
   entry; anything unlisted defaults to small. */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { APP } = require('./helpers/app-source.js');

const FIXTURES = path.join(__dirname, 'fixtures', 'scan');
const START = '/* ---- parsing ---- */';
const END = '/* ---- scan UI ---- */';

function loadParser(roasters) {
  const from = APP.indexOf(START), to = APP.indexOf(END);
  assert.ok(from >= 0 && to > from, 'app.js keeps its parsing section between the markers ' + START + ' and ' + END);
  const body = APP.slice(from, to) + '\n return { parseLabel: parseLabel, parseAltitude: parseAltitude };';
  // coll() is the parser's only reach into the app; the roaster list is
  // what lets a known roaster be recognised on a bag.
  return new Function('coll', body)(() => roasters);
}

const files = fs.readdirSync(FIXTURES).filter(f => f.endsWith('.json')).sort();

for (const file of files) {
  const fx = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8'));
  test(fx.label || file, async (t) => {
    const roasters = (fx.roasters || []).map((name, i) => ({ id: 'r' + i, name }));
    const heights = fx.heights || {};
    const lines = fx.text.map(text => ({ text, bbox: { y0: 0, y1: heights[text] || 12 }, confidence: 80 }));
    const found = loadParser(roasters).parseLabel({ text: fx.text.join('\n'), lines }).found;
    const todo = fx.todo || [];
    for (const key of Object.keys(fx.expect)) {
      const want = fx.expect[key] === null ? undefined : fx.expect[key];
      await t.test(key, { todo: todo.includes(key) ? (fx.note || 'known issue') : false }, () => {
        assert.equal(found[key], want);
      });
    }
  });
}

/* Altitude formats, checked directly rather than through a bag. An
   altitude is always three or four digits followed by a unit, but bags
   spell that unit every way there is — and the bare "m" needs a word
   boundary after it, so "1200 meters" once matched nothing at all. */
const ALTITUDES = [
  ['1200 m', '1,200 m'], ['1200m', '1,200 m'], ['1250M', '1,250 m'],
  ['900 metros', '900 m'], ['1200 meters', '1,200 m'], ['1200 metres', '1,200 m'],
  ['1200 mt', '1,200 m'], ['1200 mts', '1,200 m'], ['1200 m.', '1,200 m'],
  ['1.200m', '1,200 m'], ['1,200 masl', '1,200 m'], ['1200 msnm', '1,200 m'],
  ['1100-1300 m', '1,100–1,300 m'], ['1.100 a 1.300 metros', '1,100–1,300 m'],
  ['1100 to 1300 meters', '1,100–1,300 m'],
  // A unit is required, and the value has to be a plausible altitude.
  ['250 g', ''], ['serial 1200', ''], ['1200', ''],
  ['99999 m', ''], ['12 m', ''], ['50000 m', '']
];

test('altitude formats', () => {
  const { parseAltitude } = loadParser([]);
  for (const [input, want] of ALTITUDES) {
    assert.equal(parseAltitude(input) || '', want, JSON.stringify(input));
  }
});
