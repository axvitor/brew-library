/* Pulls pieces of app.js out by name, so tests run the shipping code
   rather than a copy of it, with no test hooks in the app.

   app.js is one script whose top-level functions all start at the left
   margin as `function name(` and end at the first `}` back at the left
   margin; nested functions are indented. That convention is what lets a
   function be lifted out by its text alone. */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

function sourceOf(name) {
  const start = APP.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('app.js has no top-level function ' + name + '()');
  const end = APP.indexOf('\n}\n', start);
  return APP.slice(start + 1, end + 2);
}

// A top-level `var NAME = …;` declaration, up to its closing semicolon at
// the end of a line.
function varOf(name) {
  const m = APP.match(new RegExp('\\nvar ' + name + ' = [\\s\\S]*?;\\n'));
  if (!m) throw new Error('app.js has no top-level var ' + name);
  return m[0].slice(1);
}

/* Builds the named functions (and vars) into one scope with the given
   stand-ins for whatever they reach for outside themselves, and returns
   them by name. */
function load(names, stubs, vars) {
  stubs = stubs || {};
  const stubNames = Object.keys(stubs);
  const body = (vars || []).map(varOf).join('\n') + '\n' +
    names.map(sourceOf).join('\n') +
    '\nreturn {' + names.map(n => n + ': ' + n).join(', ') + '};';
  return new Function(...stubNames, body)(...stubNames.map(k => stubs[k]));
}

module.exports = { ROOT, APP, sourceOf, load };
