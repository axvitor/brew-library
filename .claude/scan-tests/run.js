#!/usr/bin/env node
/* Regression tests for the label scanner's parser.
 *
 *     node .claude/scan-tests/run.js
 *
 * Each fixture in ./fixtures is the verbatim OCR text from a real coffee
 * bag, together with the values that reading should produce. The parser is
 * pulled straight out of app.js — the section between the "---- parsing ----"
 * and "---- scan UI ----" markers — so these test the shipping code rather
 * than a copy of it, and no test hooks are needed in the app.
 *
 * Why this exists: OCR output varies wildly between bags, and nearly every
 * improvement made for one bag has broken another. Rules that look safe in
 * isolation are not — preferring a longer name picked up OCR debris,
 * tidying note fragments ate the comma joining a wrapped list, and marking
 * text as used before it was accepted stopped a coffee's name being found.
 * Each of those was caught here rather than on the phone.
 *
 * Adding a bag: scan it, open "Everything it read" in the review sheet,
 * and save that text as a new fixture with the values it should produce.
 * Assert only what the bag genuinely shows — leaving a field out is better
 * than baking in a wrong answer, and `expect` may use null to assert that
 * nothing was found (a bag that prints no altitude must not invent one).
 *
 * `heights` stands in for Tesseract's per-line bounding boxes, which decide
 * which line is the coffee's name. Only lines whose size matters need an
 * entry; anything unlisted defaults to small.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const APP = path.join(HERE, '..', '..', 'app.js');
const FIXTURES = path.join(HERE, 'fixtures');

const START = '/* ---- parsing ---- */';
const END = '/* ---- scan UI ---- */';

function loadParser(roasters) {
  const src = fs.readFileSync(APP, 'utf8');
  const from = src.indexOf(START);
  const to = src.indexOf(END);
  if (from < 0 || to < 0) {
    console.error('Could not find the parsing section in app.js.');
    console.error('Expected markers:\n  ' + START + '\n  ' + END);
    process.exit(2);
  }
  const body = src.slice(from, to) + '\n return { parseLabel: parseLabel };';
  // coll() is the parser's only reach into the app; the roaster list is
  // what lets a known roaster be recognised on a bag.
  return new Function('coll', body)(() => roasters);
}

const FIELDS = ['name', 'roasterName', 'origin', 'altitude', 'process', 'roast', 'varietal', 'notes'];

let pass = 0, fail = 0;
const failures = [];

const files = fs.readdirSync(FIXTURES).filter(f => f.endsWith('.json')).sort();
if (!files.length) {
  console.error('No fixtures found in ' + FIXTURES);
  process.exit(2);
}

for (const file of files) {
  let fx;
  try {
    fx = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8'));
  } catch (err) {
    console.error(`\n${file}: could not be parsed — ${err.message}`);
    fail++;
    continue;
  }

  const roasters = (fx.roasters || []).map((name, i) => ({ id: 'r' + i, name }));
  const heights = fx.heights || {};
  const lines = fx.text.map(text => ({
    text,
    bbox: { y0: 0, y1: heights[text] || 12 },
    confidence: 80
  }));

  const { parseLabel } = loadParser(roasters);
  const found = parseLabel({ text: fx.text.join('\n'), lines }).found;

  console.log('\n' + (fx.label || file));
  for (const key of Object.keys(fx.expect)) {
    const want = fx.expect[key] === null ? undefined : fx.expect[key];
    const got = found[key];
    if (got === want) {
      pass++;
      console.log(`  PASS  ${key}  ${JSON.stringify(got)}`);
    } else {
      fail++;
      failures.push(`${fx.label || file} → ${key}`);
      console.log(`  FAIL  ${key}`);
      console.log(`        got  ${JSON.stringify(got)}`);
      console.log(`        want ${JSON.stringify(want)}`);
    }
  }

  // Shown, not asserted: fields this bag produces that the fixture makes no
  // claim about. Usually values OCR damaged beyond what parsing can repair.
  const extra = FIELDS
    .filter(k => !(k in fx.expect) && found[k] !== undefined)
    .map(k => `${k}=${JSON.stringify(found[k])}`);
  if (extra.length) console.log('  (unasserted: ' + extra.join(', ') + ')');
  if (fx.note) console.log('  note: ' + fx.note);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log('\nFailing:');
  failures.forEach(f => console.log('  - ' + f));
  console.log('');
}
process.exit(fail ? 1 : 0);
