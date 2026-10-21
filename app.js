/* ============================================================
   Brew Library — personal coffee brewing recipe library
   Vanilla JS · no build step · Google sign-in, synced per-user via Firestore
   ============================================================ */
(function () {
'use strict';

/* ---------------------------------------------------------
   1. Storage
   --------------------------------------------------------- */

var state = null;

// Bump whenever the built-in starter library below changes. A stored library
// that is still untouched starter data picks the new version up automatically;
// once you edit anything, your data is yours and is never replaced.
var SEED_VERSION = 6;

// The one account that starts with the full 101-recipe starter library.
// Everyone else invited to the app starts blank — your personal coffee list
// shouldn't land in a friend's account just because they signed in.
//
// Stored as a SHA-256 hash rather than the plain address, since this file
// is public (deployed as-is, no build step) — this keeps the email out of
// anyone reading the source while the check itself still works the same.
// Recompute with: crypto.subtle.digest('SHA-256', new TextEncoder().encode(email))
var OWNER_EMAIL_HASH = 'b4b829003004fb5d96cf13da1c211429f519bbcfd703c46b3d8e540c01c9781a';

function sha256Hex(text) {
  if (!(window.crypto && window.crypto.subtle)) return Promise.resolve('');
  return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) {
      return b.toString(16).padStart(2, '0');
    }).join('');
  });
}

var currentUser = null;      // Firebase user object once signed in, else null
var authPhase = 'loading';   // 'loading' | 'signedOut' | 'ready' | 'error'
var unsubscribeLibrary = null;

function uid(prefix) {
  return (prefix || 'x') + '-' + Math.random().toString(36).slice(2, 9);
}

// Any save that isn't the initial seed marks the library as user-owned.
function save(opts) {
  if (!opts || !opts.keepPristine) state.pristine = false;
  if (currentUser && window.Brew) {
    window.Brew.saveLibrary(currentUser.uid, state).catch(function () {
      toast(t('Could not sync — check your connection.'));
    });
  }
}

// Reuses the built-in grinders/methods/styles (generic, reusable across
// anyone) but starts with no coffees or recipes — those are personal.
function emptyLibrary() {
  var base = seed();
  return {
    version: 1, seedVersion: SEED_VERSION, pristine: true,
    coffees: [], recipes: [], roasters: [],
    grinders: base.grinders, methods: base.methods, styles: base.styles
  };
}

// Returns a Promise<library> — resolving the hash check is async, so this
// is too. Falls back to a blank library for anyone if hashing isn't
// available (window.crypto.subtle needs a secure context: https/localhost).
function initialLibraryFor(user) {
  if (!user || !user.email) return Promise.resolve(emptyLibrary());
  return sha256Hex(user.email.toLowerCase()).then(function (hash) {
    return hash === OWNER_EMAIL_HASH ? seed() : emptyLibrary();
  });
}

/* ---------------------------------------------------------
   2. Seed data — the reusable entities
   --------------------------------------------------------- */

/* Built-in recipe styles, defined outside seed() so an existing library can
   be topped up with newly added ones without regenerating everything else.
   Returns a fresh deep copy each call — these get edited in place once they
   land in a user's library, and a shared reference would leak one account's
   edits into the next seed. */
function builtinStyles() {
  return JSON.parse(JSON.stringify([
    { id: 'st-hoffmann', name: 'James Hoffmann V60', author: 'James Hoffmann',
      notes: 'Ultimate V60 technique — bloom, two pours, swirl, even drawdown.' },
    { id: 'st-hoffmann-aeropress', name: 'James Hoffmann AeroPress', author: 'James Hoffmann',
      notes: 'Ultimate AeroPress technique — all the water at once, a long steep, a swirl, ' +
        'then a gentle press. His published figures are 11 g to 200 g of water just off the boil; ' +
        'the schedule scales to whatever dose and water the recipe carries.' },
    { id: 'st-tetsu-sweet', name: 'Tetsu Kasuya — Sweet', author: 'Tetsu Kasuya',
      notes: '4:6 method. A smaller first pour pushes the cup toward sweetness.' },
    { id: 'st-tetsu-acid', name: 'Tetsu Kasuya — Acid', author: 'Tetsu Kasuya',
      notes: '4:6 method. A larger first pour brings out acidity and brightness.' },
    { id: 'st-tetsu-strength', name: 'Tetsu Kasuya — Strength', author: 'Tetsu Kasuya',
      notes: '4:6 method. Balanced first 40%, then the remaining 60% split into three pours for a stronger cup.' },
    { id: 'st-espresso', name: 'Espresso', author: '',
      notes: 'A pressure shot rather than a pour: dial in with dose, grind and shot time instead of a pour schedule.' },
    // These two styles carry written steps rather than a built-in formula,
    // which is exactly what makes them editable: hasFormula() is false for
    // them, so they open in the step builder like any style you'd write
    // yourself.
    { id: 'st-aeropress-inverted', name: 'AeroPress (Inverted)', author: '',
      notes: 'Brewed upside down, so the coffee steeps in full contact with the water instead of ' +
        'draining early — that buys a longer, more even extraction before you flip and press. ' +
        'A 1:15 ratio is a solid starting point; scale to taste.',
      steps: [
        { t: '0:00', label: 'Flip the AeroPress upside down, seat the plunger a few rings in, then add the coffee.' },
        { t: '0:15', label: 'Pour in all the water and stir well to saturate every ground.' },
        { t: '1:00', label: 'Wet the filter, screw on the cap, then let it steep undisturbed.' },
        { t: '1:30', label: 'Flip upright onto your mug.' },
        { t: '1:45', label: 'Press slowly and evenly — about 30 seconds.' }
      ] },
    // Figures are his published Ultimate Pour Over at a 20 g dose — the pours
    // are cumulative totals, not per-pour amounts.
    { id: 'st-hedrick-v60', name: 'Lance Hendrick V60', author: 'Lance Hendrick',
      notes: 'Catch-all pour over that suits any dripper and any roast. Level the bed before blooming, ' +
        'and pour slowly — aggressive pours over-agitate the grounds and push the cup bitter. ' +
        'Water 100°C for light roasts, 92°C medium, 85°C dark.',
      steps: [
        { t: '0:00', label: 'Bloom to 60 g — three times the dose. Swirl gently to wet every ground.' },
        { t: '0:30', label: 'Pour to 100 g total in a slow, steady circle.' },
        { t: '1:00', label: 'Pour to 200 g total.' },
        { t: '1:30', label: 'Pour to 300 g total, or your target weight.' },
        { t: '2:00', label: 'Let it draw down — aim to finish around 3:00.' }
      ] }
  ]));
}

/* Bump when a new built-in style is added. Tracked per library so the
   backfill runs exactly once: a style the user then deletes stays deleted
   rather than reappearing on every load. */
var BUILTIN_STYLES_VERSION = 3;

function seed() {
  var coffees = [
    { id: "cof-patrick", name: "Patrick", roaster: "", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-bridge", name: "Bridge Coffee", roaster: "", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-campos-altos", name: "Café Campos Altos", roaster: "", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-cafeco", name: "Cafe&Co", roaster: "", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-encantos-sensacao", name: "Sensação", roaster: "Encantos", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-encantos-agrado", name: "Agrado", roaster: "Encantos", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-moka-bela-epoca", name: "Bela Época Orgânico", roaster: "Moka Clube", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-moka-familia-protazio", name: "Família Protazio", roaster: "Moka Clube", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-moka-tropical", name: "Tropical", roaster: "Moka Clube", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-moka-irmaos-moscardini", name: "Irmãos Moscardini", roaster: "Moka Clube", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-brazuca-laranja", name: "Laranja", roaster: "Brazucafé", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-moka-grand-hotel", name: "Grand Hotel", roaster: "Moka Clube", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-brazuca-chocolate-belga", name: "Chocolate Belga", roaster: "Brazucafé", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-moka-santa-luzia", name: "Sítio Santa Luzia", roaster: "Moka Clube", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-moka-flor-de-cacau", name: "Flor de Cacau", roaster: "Moka Clube", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-moka-salada-de-frutas", name: "Salada de Frutas", roaster: "Moka Clube", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-moka-serra-da-canastra", name: "Serra da Canastra", roaster: "Moka Clube", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-cafe-das-pedras", name: "Café das Pedras", roaster: "", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-moka-coopiata-bahia", name: "Coopiatã Bahia", roaster: "Moka Clube", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-moka-boa-vista-pinhal", name: "Fazenda Boa Vista de Pinhal", roaster: "Moka Clube", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-moka-olhos-dagua", name: "Fazenda Olhos D'Água", roaster: "Moka Clube", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-moka-bala-de-caramelo", name: "Bala de Caramelo", roaster: "Moka Clube", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-moka-maca-do-amor", name: "Maçã do Amor", roaster: "Moka Clube", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-moka-caldo-de-cana", name: "Caldo de Cana e Limão", roaster: "Moka Clube", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-moka-chocolate-trufado", name: "Chocolate Trufado", roaster: "Moka Clube", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-ror-mokinha", name: "Mokinha", roaster: "Ror", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-moka-bioma-moca", name: "Bioma Moça", roaster: "Moka Clube", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-moka-fazenda-tombado", name: "Fazenda Tombado", roaster: "Moka Clube", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-moka-fazenda-cachoeira", name: "Fazenda Cachoeira", roaster: "Moka Clube", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-williams-rodrigo-mazzocco", name: "Rodrigo Mazzocco", roaster: "Williams & Sons", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-moka-castanha-capixaba", name: "Castanha Capixaba", roaster: "Moka Clube", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-moka-geisha-terracota", name: "Geisha Terracota", roaster: "Moka Clube", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-moka-fazenda-engenho", name: "Fazenda Engenho", roaster: "Moka Clube", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-lucca-fazenda-california", name: "Fazenda California", roaster: "Lucca", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-lucca-pessego", name: "Pêssego", roaster: "Lucca", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-intelligenza-acorda-pra-vida", name: "Acorda pra Vida — Lote 86", roaster: "Intelligenza", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-coffeepp-solos-vulcanicos", name: "Solos Vulcânicos", roaster: "Coffee ++", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-noname-fazenda-sertao", name: "Fazenda Sertão", roaster: "No Name", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-lucca-sitio-vinhedo", name: "Sítio Vinhedo", roaster: "Lucca", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-sabino-gabriel-lamounier", name: "Gabriel Lamounier", roaster: "Sabino", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-lucca-caffe-nato", name: "Caffè Nato", roaster: "Lucca", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-lucca-rio-brilhante", name: "Rio Brilhante", roaster: "Lucca", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-lucca-california-perola-negra", name: "Fazenda California — Pérola Negra", roaster: "Lucca", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-lucca-labareda", name: "Labareda", roaster: "Lucca", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-moka-fazenda-capadocia", name: "Fazenda Capadócia", roaster: "Moka Clube", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-moka-sitio-palmito", name: "Sítio Palmito", roaster: "Moka Clube", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-five-nosso-talhao", name: "Nosso Talhão", roaster: "Five Roasters", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-lucca-honey-coffee-moka", name: "Honey & Coffee Moka", roaster: "Lucca", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-lucca-fazenda-samambaia", name: "Fazenda Samambaia", roaster: "Lucca", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-five-vista-do-brigadeiro", name: "Vista do Brigadeiro", roaster: "Five Roasters", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-lucca-forquilha-florada-setembro", name: "Forquilha do Rio — Florada de Setembro", roaster: "Lucca", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-lucca-fazenda-cariama", name: "Fazenda Cariama", roaster: "Lucca", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-arbor-10-anos", name: "10 Anos", roaster: "Arbor", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-leve-cafeina", name: "Leve Cafeína", roaster: "", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-sabino-nivaldo-rocha", name: "Nivaldo Rocha", roaster: "Sabino", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-arbor-laranjinha", name: "Laranjinha", roaster: "Arbor", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-sabino-thais-paiva", name: "Thaís Paiva", roaster: "Sabino", origin: '', process: '', roast: '', varietal: '', notes: '' },
    { id: "cof-williams-gabriel-lamounier", name: "Gabriel Lamounier", roaster: "Williams & Sons", origin: '', process: '', roast: '', varietal: '', notes: '' },
  ];

  var grinders = [
    { id: 'gr-kingrinder', name: 'KINGrinder', kind: 'Hand grinder', unit: 'clicks', notes: '' },
    { id: 'gr-starseeker', name: 'Starseeker', kind: 'Hand grinder', unit: 'clicks', notes: '' },
    { id: 'gr-timemore-c2', name: 'Timemore C2', kind: 'Hand grinder', unit: 'clicks', notes: '' },
    { id: 'gr-oster', name: 'Oster', kind: 'Electric grinder', unit: 'dial', notes: '' }
  ];

  var methods = [
    { id: 'me-v60', name: 'V60', kind: 'Pour over', ratio: '1:16', notes: '' },
    { id: 'me-origami', name: 'Origami', kind: 'Pour over', ratio: '1:16', notes: '' },
    { id: 'me-aeropress', name: 'AeroPress', kind: 'Immersion', ratio: '1:16', notes: '' },
    { id: 'me-b75', name: 'Timemore B75', kind: 'Pour over', ratio: '1:15', notes: '' },
    { id: 'me-moka', name: 'Moka Pot', kind: 'Stovetop', ratio: '1:10', notes: '' },
    { id: 'me-espresso', name: 'Espresso', kind: 'Pressure', ratio: '1:2', notes: '' },
    { id: 'me-esp-dex', name: 'Espresso — DEX basket', kind: 'Pressure', ratio: '', notes: 'Cesto DEX.' },
    { id: 'me-esp-3bomber', name: 'Espresso — 3Bomber (18g basket)', kind: 'Pressure', ratio: '', notes: 'Cesto 3Bomber 18g.' },
    { id: 'me-filtro-oster', name: 'Filtro Oster', kind: 'Drip filter', ratio: '', notes: '' }
  ];

  var styles = builtinStyles();

  var now = Date.now();
  var recipes = [];
  function addRecipe(o) {
    // Water follows the recipe style: 250g for James Hoffmann, 300g for Tetsu Kasuya.
    var water = o.s === 'st-hoffmann' ? 250 : (o.s === 'st-tetsu-sweet' ? 300 : '');
    recipes.push({
      id: uid('rec'), name: '', coffeeId: o.c, grinderId: o.g, grindSize: o.gr,
      methodId: o.m, styleId: o.s, dose: o.dose, water: water, temp: o.temp, brewTime: o.time,
      steps: [], notes: o.notes || '', rating: 0, fav: false,
      createdAt: now - recipes.length, updatedAt: now - recipes.length
    });
  }

  addRecipe({ c: "cof-patrick", m: "me-esp-dex", g: "gr-oster", gr: "Dial 11", s: "st-espresso", dose: 20, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-patrick", m: "me-esp-dex", g: "gr-kingrinder", gr: "1 turn + 8 clicks", s: "st-espresso", dose: 20, temp: '', time: "~0:28", notes: "" });
  addRecipe({ c: "cof-patrick", m: "me-esp-3bomber", g: "gr-kingrinder", gr: "1 turn", s: "st-espresso", dose: 18, temp: '', time: "~0:28", notes: "" });
  addRecipe({ c: "cof-patrick", m: "me-origami", g: "gr-kingrinder", gr: "1 turn + 55 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "3:15", notes: "" });
  addRecipe({ c: "cof-bridge", m: "me-esp-dex", g: "gr-oster", gr: "Dial 10", s: "st-espresso", dose: 20, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-bridge", m: "me-esp-dex", g: "gr-kingrinder", gr: "1 turn + 3 clicks", s: "st-espresso", dose: 20, temp: '', time: "~0:28", notes: "" });
  addRecipe({ c: "cof-campos-altos", m: "me-esp-dex", g: "gr-kingrinder", gr: "1 turn + 10 clicks", s: "st-espresso", dose: 20, temp: '', time: "~0:28", notes: "" });
  addRecipe({ c: "cof-cafeco", m: "me-esp-dex", g: "gr-kingrinder", gr: "1 turn + 8 clicks", s: "st-espresso", dose: 20, temp: '', time: "~0:30", notes: "" });
  addRecipe({ c: "cof-encantos-sensacao", m: "me-esp-dex", g: "gr-kingrinder", gr: "1 turn + 5 clicks (ou 1 turn + 4)", s: "st-espresso", dose: 22, temp: '', time: "~0:28", notes: "" });
  addRecipe({ c: "cof-encantos-agrado", m: "me-esp-dex", g: "gr-kingrinder", gr: "1 turn + 5 clicks", s: "st-espresso", dose: 22, temp: '', time: "~0:28", notes: "" });
  addRecipe({ c: "cof-moka-bela-epoca", m: "me-esp-dex", g: "gr-kingrinder", gr: "1 turn + 6 clicks", s: "st-espresso", dose: 22, temp: '', time: "~0:26", notes: "" });
  addRecipe({ c: "cof-moka-bela-epoca", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 25 clicks", s: "st-hoffmann", dose: '', temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-bela-epoca", m: "me-aeropress", g: "gr-timemore-c2", gr: "21 clicks", s: "st-hoffmann-aeropress", dose: '', temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-familia-protazio", m: "me-esp-3bomber", g: "gr-kingrinder", gr: "1 turn + 4 clicks", s: "st-espresso", dose: 18, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-familia-protazio", m: "me-v60", g: "gr-kingrinder", gr: "3 turns + 39 clicks", s: "st-hoffmann", dose: 15, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-familia-protazio", m: "me-origami", g: "gr-kingrinder", gr: "1 turn + 49 clicks", s: "st-hoffmann", dose: 15, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-familia-protazio", m: "me-aeropress", g: "gr-kingrinder", gr: "1 turn + 49 clicks", s: "st-hoffmann-aeropress", dose: 15, temp: '', time: "2:30", notes: "Press for one more minute after 2:30." });
  addRecipe({ c: "cof-moka-tropical", m: "me-aeropress", g: "gr-kingrinder", gr: "1 turn + 40 clicks", s: "st-hoffmann-aeropress", dose: '', temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-tropical", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 10 clicks", s: "st-hoffmann", dose: '', temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-tropical", m: "me-b75", g: "gr-kingrinder", gr: "1 turn + 40 clicks", s: "st-hoffmann", dose: '', temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-irmaos-moscardini", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 20 clicks", s: "st-hoffmann", dose: '', temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-irmaos-moscardini", m: "me-origami", g: "gr-kingrinder", gr: "1 turn + 45 clicks", s: "st-hoffmann", dose: '', temp: '', time: "", notes: "Moka Clube method." });
  addRecipe({ c: "cof-moka-irmaos-moscardini", m: "me-esp-3bomber", g: "gr-kingrinder", gr: "1 turn", s: "st-espresso", dose: 20, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-brazuca-laranja", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 25 clicks", s: "st-hoffmann", dose: '', temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-brazuca-laranja", m: "me-esp-3bomber", g: "gr-kingrinder", gr: "1 turn + 2 clicks", s: "st-espresso", dose: 18, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-brazuca-laranja", m: "me-b75", g: "gr-kingrinder", gr: "1 turn + 50 clicks", s: "st-hoffmann", dose: '', temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-grand-hotel", m: "me-esp-3bomber", g: "gr-kingrinder", gr: "1 turn + 7 clicks", s: "st-espresso", dose: 20, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-grand-hotel", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 20 clicks", s: "st-hoffmann", dose: '', temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-brazuca-chocolate-belga", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 40 clicks", s: "st-hoffmann", dose: '', temp: 94, time: "", notes: "" });
  addRecipe({ c: "cof-brazuca-chocolate-belga", m: "me-esp-3bomber", g: "gr-kingrinder", gr: "1 turn + 5 clicks", s: "st-espresso", dose: 18, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-santa-luzia", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 20 clicks", s: "st-hoffmann", dose: '', temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-santa-luzia", m: "me-esp-3bomber", g: "gr-kingrinder", gr: "1 turn + 4 clicks", s: "st-espresso", dose: 18, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-santa-luzia", m: "me-aeropress", g: "gr-timemore-c2", gr: "22 clicks", s: "st-hoffmann-aeropress", dose: '', temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-flor-de-cacau", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 15 clicks", s: "st-hoffmann", dose: '', temp: '', time: "3:20", notes: "" });
  addRecipe({ c: "cof-moka-salada-de-frutas", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 30 clicks", s: "st-tetsu-sweet", dose: '', temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-salada-de-frutas", m: "me-filtro-oster", g: "gr-kingrinder", gr: "1 turn", s: "st-hoffmann", dose: 18, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-serra-da-canastra", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 50 clicks", s: "st-tetsu-sweet", dose: 20, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-cafe-das-pedras", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 35 clicks", s: "st-tetsu-sweet", dose: 20, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-coopiata-bahia", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 40 clicks", s: "st-tetsu-sweet", dose: 18, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-coopiata-bahia", m: "me-b75", g: "gr-kingrinder", gr: "2 turns + 20 clicks", s: "st-hoffmann", dose: 15, temp: '', time: "2:30", notes: "" });
  addRecipe({ c: "cof-moka-boa-vista-pinhal", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 55 clicks", s: "st-tetsu-sweet", dose: 18, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-boa-vista-pinhal", m: "me-aeropress", g: "gr-kingrinder", gr: "2 turns + 50 clicks", s: "st-hoffmann-aeropress", dose: 12, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-boa-vista-pinhal", m: "me-esp-3bomber", g: "gr-kingrinder", gr: "1 turn + 1 click", s: "st-espresso", dose: 18, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-olhos-dagua", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 33 clicks", s: "st-tetsu-sweet", dose: 18, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-olhos-dagua", m: "me-aeropress", g: "gr-kingrinder", gr: "2 turns + 40 clicks", s: "st-hoffmann-aeropress", dose: 12, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-bala-de-caramelo", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 45 clicks", s: "st-tetsu-sweet", dose: 18, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-bala-de-caramelo", m: "me-b75", g: "gr-kingrinder", gr: "2 turns + 50 clicks", s: "st-hoffmann", dose: 15, temp: '', time: "2:30", notes: "" });
  addRecipe({ c: "cof-moka-maca-do-amor", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 50 clicks", s: "st-tetsu-sweet", dose: 18, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-maca-do-amor", m: "me-b75", g: "gr-kingrinder", gr: "2 turns + 40 clicks", s: "st-hoffmann", dose: 15, temp: '', time: "2:30", notes: "" });
  addRecipe({ c: "cof-moka-caldo-de-cana", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 30 clicks", s: "st-tetsu-sweet", dose: 18, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-caldo-de-cana", m: "me-b75", g: "gr-kingrinder", gr: "2 turns + 40 clicks", s: "st-hoffmann", dose: 15, temp: '', time: "2:30", notes: "" });
  addRecipe({ c: "cof-moka-chocolate-trufado", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 25 clicks", s: "st-tetsu-sweet", dose: 18, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-chocolate-trufado", m: "me-b75", g: "gr-kingrinder", gr: "2 turns + 5 clicks", s: "st-hoffmann", dose: 15, temp: '', time: "2:30", notes: "" });
  addRecipe({ c: "cof-ror-mokinha", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 30 clicks", s: "st-hoffmann", dose: 15, temp: 98, time: "", notes: "" });
  addRecipe({ c: "cof-ror-mokinha", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 25 clicks", s: "st-tetsu-sweet", dose: 18, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-ror-mokinha", m: "me-b75", g: "gr-kingrinder", gr: "1 turn + 55 clicks", s: "st-hoffmann", dose: 15, temp: '', time: "~2:45", notes: "" });
  addRecipe({ c: "cof-moka-bioma-moca", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 25 clicks", s: "st-tetsu-sweet", dose: 18, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-bioma-moca", m: "me-b75", g: "gr-kingrinder", gr: "1 turn + 55 clicks", s: "st-hoffmann", dose: 15, temp: '', time: "2:20", notes: "" });
  addRecipe({ c: "cof-moka-bioma-moca", m: "me-esp-3bomber", g: "gr-kingrinder", gr: "1 turn", s: "st-espresso", dose: 18, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-fazenda-tombado", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 25 clicks", s: "st-tetsu-sweet", dose: 18, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-fazenda-tombado", m: "me-b75", g: "gr-kingrinder", gr: "2 turns + 5 clicks", s: "st-hoffmann", dose: 15, temp: '', time: "2:20", notes: "" });
  addRecipe({ c: "cof-moka-fazenda-cachoeira", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 50 clicks", s: "st-tetsu-sweet", dose: 18, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-fazenda-cachoeira", m: "me-origami", g: "gr-kingrinder", gr: "2 turns", s: "st-hoffmann", dose: 15, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-fazenda-cachoeira", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 10 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "2:55", notes: "" });
  addRecipe({ c: "cof-williams-rodrigo-mazzocco", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 35 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "", notes: "" });
  addRecipe({ c: "cof-moka-castanha-capixaba", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 10 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "", notes: "" });
  addRecipe({ c: "cof-moka-geisha-terracota", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 15 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "3:05", notes: "" });
  addRecipe({ c: "cof-moka-fazenda-engenho", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 10 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "", notes: "" });
  addRecipe({ c: "cof-lucca-fazenda-california", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 15 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "", notes: "" });
  addRecipe({ c: "cof-lucca-fazenda-california", m: "me-esp-3bomber", g: "gr-kingrinder", gr: "1 turn + 8 clicks", s: "st-espresso", dose: 18, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-lucca-pessego", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 45 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "3:05", notes: "" });
  addRecipe({ c: "cof-intelligenza-acorda-pra-vida", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 40 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "3:10–3:15", notes: "" });
  addRecipe({ c: "cof-intelligenza-acorda-pra-vida", m: "me-esp-3bomber", g: "gr-kingrinder", gr: "1 turn + 8 clicks", s: "st-espresso", dose: 18, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-coffeepp-solos-vulcanicos", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 24 clicks", s: "st-hoffmann", dose: 15, temp: '', time: "3:05", notes: "" });
  addRecipe({ c: "cof-coffeepp-solos-vulcanicos", m: "me-b75", g: "gr-kingrinder", gr: "2 turns + 20 clicks", s: "st-hoffmann", dose: 15, temp: '', time: "2:45", notes: "" });
  addRecipe({ c: "cof-noname-fazenda-sertao", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 40 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "3:00", notes: "" });
  addRecipe({ c: "cof-lucca-sitio-vinhedo", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 2 clicks", s: "st-hoffmann", dose: 15, temp: 98, time: "2:55", notes: "" });
  addRecipe({ c: "cof-sabino-gabriel-lamounier", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 45 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "3:20", notes: "Slow feed (pour slowly)." });
  addRecipe({ c: "cof-sabino-gabriel-lamounier", m: "me-v60", g: "gr-kingrinder", gr: "3 turns", s: "st-hoffmann", dose: 16, temp: 92, time: "3:05", notes: "Stir during the bloom." });
  addRecipe({ c: "cof-sabino-gabriel-lamounier", m: "me-b75", g: "gr-kingrinder", gr: "2 turns + 25 clicks", s: "st-hoffmann", dose: 15, temp: 98, time: "", notes: "" });
  addRecipe({ c: "cof-lucca-caffe-nato", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 38 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "3:05", notes: "" });
  addRecipe({ c: "cof-lucca-rio-brilhante", m: "me-origami", g: "gr-kingrinder", gr: "2 turns", s: "st-hoffmann", dose: 15, temp: 94, time: "2:55", notes: "" });
  addRecipe({ c: "cof-lucca-california-perola-negra", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 5 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "3:10", notes: "Stir during the bloom." });
  addRecipe({ c: "cof-lucca-labareda", m: "me-origami", g: "gr-kingrinder", gr: "1 turn + 55 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "3:00", notes: "" });
  addRecipe({ c: "cof-moka-fazenda-capadocia", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 5 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "3:10", notes: "" });
  addRecipe({ c: "cof-moka-fazenda-capadocia", m: "me-esp-3bomber", g: "gr-kingrinder", gr: "55 clicks", s: "st-espresso", dose: 18, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-sitio-palmito", m: "me-origami", g: "gr-kingrinder", gr: "1 turn + 58 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "3:10", notes: "" });
  addRecipe({ c: "cof-moka-sitio-palmito", m: "me-aeropress", g: "gr-kingrinder", gr: "1 turn + 45 clicks", s: "st-hoffmann-aeropress", dose: 12, temp: 98, time: "3:00", notes: "Finish the brew by 3:00." });
  addRecipe({ c: "cof-five-nosso-talhao", m: "me-origami", g: "gr-kingrinder", gr: "1 turn + 37 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "3:15", notes: "" });
  addRecipe({ c: "cof-lucca-honey-coffee-moka", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 25 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "3:10", notes: "" });
  addRecipe({ c: "cof-lucca-fazenda-samambaia", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 40 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "3:15", notes: "" });
  addRecipe({ c: "cof-five-vista-do-brigadeiro", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 40 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "3:25", notes: "" });
  addRecipe({ c: "cof-lucca-forquilha-florada-setembro", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 25 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "3:00", notes: "" });
  addRecipe({ c: "cof-lucca-fazenda-cariama", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 20 clicks", s: "st-hoffmann", dose: 15, temp: 96, time: "3:10", notes: "" });
  addRecipe({ c: "cof-arbor-10-anos", m: "me-origami", g: "gr-kingrinder", gr: "1 turn + 55 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "2:45", notes: "" });
  addRecipe({ c: "cof-leve-cafeina", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 15 clicks", s: "st-hoffmann", dose: 15, temp: 96, time: "3:10", notes: "" });
  addRecipe({ c: "cof-sabino-nivaldo-rocha", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 25 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "3:00", notes: "" });
  addRecipe({ c: "cof-sabino-nivaldo-rocha", m: "me-aeropress", g: "gr-kingrinder", gr: "2 turns + 15 clicks", s: "st-hoffmann-aeropress", dose: 15, temp: 96, time: "", notes: "Swirl at 1:45; press between 2:00 and 2:30–2:45." });
  addRecipe({ c: "cof-arbor-laranjinha", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 45 clicks", s: "st-hoffmann", dose: 15, temp: 96, time: "3:05", notes: "" });
  addRecipe({ c: "cof-sabino-thais-paiva", m: "me-v60", g: "gr-kingrinder", gr: "2 turns + 50 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "2:50", notes: "" });
  addRecipe({ c: "cof-williams-gabriel-lamounier", m: "me-v60", g: "gr-kingrinder", gr: "1 turn + 57 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "3:10", notes: "" });

  return { version: 1, seedVersion: SEED_VERSION, pristine: true, coffees: coffees, grinders: grinders, methods: methods, styles: styles, recipes: recipes };
}

/* ---------------------------------------------------------
   3. Entity definitions (generic, so new kinds are cheap)
   --------------------------------------------------------- */

var ENTITIES = {
  // Listed first so the Library manager's tabs read in the same order the
  // recipe form asks for things: roaster, then coffee, then the gear.
  roaster: {
    coll: 'roasters', label: 'Roaster', plural: 'Roasters', ref: 'roasterId',
    fields: [
      { k: 'name', l: 'Name', ph: 'Moka Clube', req: true },
      { k: 'location', l: 'Location', ph: 'City, country' }
    ],
    meta: function (e) { return e.location || ''; },
    // Roasters are referenced by coffees, not recipes, so the usage count
    // shown in the Library and the delete warning has to look there instead.
    usedBy: function (id) {
      return state.coffees.filter(function (c) { return c.roasterId === id; }).length;
    },
    usedLabel: 'coffee'
  },
  coffee: {
    coll: 'coffees', label: 'Coffee', plural: 'Coffees', ref: 'coffeeId',
    fields: [
      { k: 'name', l: 'Name', ph: 'Ethiopia Guji', req: true },
      { k: 'roasterName', l: 'Roaster', ph: 'Start typing — reuses a roaster or creates it', kind: 'autocomplete' },
      { k: 'origin', l: 'Origin', ph: 'Region, country' },
      { k: 'altitude', l: 'Altitude', ph: '1,200 m' },
      { k: 'process', l: 'Process', ph: 'Washed / Natural / Honey' },
      { k: 'roast', l: 'Roast level', ph: 'Light / Medium / Dark' },
      { k: 'varietal', l: 'Varietal', ph: 'Caturra, Geisha…' },
      { k: 'notes', l: 'Tasting notes', ph: 'Peach, bergamot, jasmine', area: true }
    ],
    meta: function (e) { return [roasterNameOf(e), e.origin, e.process].filter(Boolean).join(' · '); }
  },
  grinder: {
    coll: 'grinders', label: 'Grinder', plural: 'Grinders', ref: 'grinderId',
    fields: [
      { k: 'name', l: 'Name', ph: 'KINGrinder K6', req: true },
      { k: 'kind', l: 'Type', ph: 'Hand grinder / Electric' },
      { k: 'unit', l: 'Setting unit', ph: 'clicks, numbers, marks' },
      { k: 'notes', l: 'Notes', ph: 'Burr type, reference settings…', area: true }
    ],
    meta: function (e) { return [t(e.kind), e.unit ? t('in') + ' ' + e.unit : ''].filter(Boolean).join(' · '); }
  },
  method: {
    coll: 'methods', label: 'Brewing method', plural: 'Methods', ref: 'methodId',
    fields: [
      { k: 'name', l: 'Name', ph: 'Chemex', req: true },
      { k: 'kind', l: 'Type', kind: 'choice', choices: function () { return METHOD_TYPES; }, read: typeFromText },
      { k: 'ratio', l: 'Typical ratio', ph: '1:16' },
      { k: 'notes', l: 'Notes', ph: 'Filter, kettle, gear…', area: true }
    ],
    meta: function (e) { return [t(e.kind), e.ratio].filter(Boolean).join(' · '); }
  },
  style: {
    coll: 'styles', label: 'Recipe style', plural: 'Recipe styles', ref: 'styleId',
    fields: [
      { k: 'name', l: 'Name', ph: 'Lance Hedrick — Ultra', req: true },
      { k: 'author', l: 'Author', ph: 'Who devised it' },
      { k: 'notes', l: 'Description', ph: 'What this recipe is going for', area: true }
    ],
    meta: function (e) { return e.author || ''; }
  }
};

/* Roasters used to be a free-text field on each coffee. They're a real entity
   now — a location has nowhere to live on a bare string, and the same roaster
   spelled two ways used to read as two roasters. This promotes the old
   strings on load: one roaster record per distinct name, each coffee pointed
   at it. Idempotent and safe to run on every load, including on libraries
   that have already been through it and on freshly seeded ones.

   The legacy `coffee.roaster` string is deliberately left in place rather
   than deleted: it costs nothing, and it means a library written by this
   version still opens correctly in a tab running the previous one. */
var libraryMigrated = false;

function normalizeLibrary(lib) {
  if (!lib) return lib;
  libraryMigrated = false;
  ['coffees', 'grinders', 'methods', 'styles', 'recipes', 'roasters'].forEach(function (k) {
    if (!Array.isArray(lib[k])) lib[k] = [];
  });

  /* Add built-in styles the library doesn't have yet. The SEED_VERSION path
     can't do this: it only re-seeds *pristine* libraries, and any account
     that has ever saved anything is no longer pristine — so a style added
     after someone started using the app would never reach them. This is
     additive and never removes or overwrites, and the version marker means
     it runs once per library, so deleting a style you don't want makes it
     stay gone. */
  if ((lib.builtinStylesVersion || 0) < BUILTIN_STYLES_VERSION) {
    var haveStyle = {};
    lib.styles.forEach(function (st) { haveStyle[st.id] = true; });
    builtinStyles().forEach(function (st) {
      if (!haveStyle[st.id]) lib.styles.push(st);
    });
    // Renames of built-in styles, applied only where the old name is still
    // in place — if you renamed it yourself, that is your name for it.
    [['st-hoffmann', 'James Hoffmann', 'James Hoffmann V60']].forEach(function (ren) {
      var st = lib.styles.filter(function (x) { return x.id === ren[0]; })[0];
      if (st && st.name === ren[1]) st.name = ren[2];
    });

    /* The Hoffmann AeroPress schedule used to hide inside the V60 style,
       which switched on the method behind the scenes. Now that it is a
       style of its own, recipes relying on that switch have to be pointed
       at it — otherwise they would quietly lose the steps they have always
       shown. Matched on the method's own name, since a library can carry
       several AeroPress methods under different ids. */
    var aeroIds = {};
    lib.methods.forEach(function (me) {
      if (/aeropress/i.test(me.name || '')) aeroIds[me.id] = true;
    });
    lib.recipes.forEach(function (r) {
      if (r.styleId === 'st-hoffmann' && aeroIds[r.methodId]) r.styleId = 'st-hoffmann-aeropress';
    });
    lib.builtinStylesVersion = BUILTIN_STYLES_VERSION;
    libraryMigrated = true;
  }

  var byName = {};
  lib.roasters.forEach(function (ro) { byName[(ro.name || '').trim().toLowerCase()] = ro; });

  lib.coffees.forEach(function (c) {
    if (c.roasterId && byName[String(c.roasterId)]) return;
    var name = (c.roaster || '').trim();
    if (!name) return;
    // Already pointing at a roaster that exists? Nothing to do.
    if (c.roasterId && lib.roasters.some(function (ro) { return ro.id === c.roasterId; })) return;
    var key = name.toLowerCase();
    var found = byName[key];
    if (!found) {
      found = { id: uid('roa'), name: name, location: '' };
      lib.roasters.push(found);
      byName[key] = found;
    }
    c.roasterId = found.id;
    libraryMigrated = true;
  });

  return lib;
}

function coll(type) { return state[ENTITIES[type].coll]; }
function findIn(type, id) {
  var list = coll(type);
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}
function nameOf(type, id) { var e = findIn(type, id); return e ? e.name : '—'; }
function recipeById(id) {
  for (var i = 0; i < state.recipes.length; i++) if (state.recipes[i].id === id) return state.recipes[i];
  return null;
}

/* ---------------------------------------------------------
   4. Recipe-style presets (scale to the chosen dose & water)
   --------------------------------------------------------- */

function g(n) { return Math.round(n); }

// Styles whose pouring steps are owned by a built-in formula. These never store
// hand-written steps — the schedule is derived from dose/water/method on render.
// A style can be formula-owned and still yield no steps (Espresso, moka pot).
var FORMULA_STYLES = {
  'st-hoffmann': true,
  'st-hoffmann-aeropress': true,
  'st-tetsu-sweet': true,
  'st-tetsu-acid': true,
  'st-tetsu-strength': true,
  'st-espresso': true
};

function hasFormula(styleId) { return FORMULA_STYLES[styleId] === true; }

function preset(styleId, dose, water, methodName) {
  dose = Number(dose) || 15;
  water = Number(water) || dose * 16;
  var m = (methodName || '').toLowerCase();

  // Espresso is dialled in by dose, grind and shot time — there is no pour schedule.
  if (styleId === 'st-espresso') return [];

  // James Hoffmann's "Ultimate AeroPress": everything in at once, steep to
  // 2:00, swirl, let it settle, then press gently over about 30 seconds.
  if (styleId === 'st-hoffmann-aeropress') {
    return [
      { t: '0:00', label: 'Add the coffee, then pour all the water in one go.', water: g(water), pour: 10 },
      { t: '0:15', label: 'Insert the plunger just enough to seal, then leave it alone.', water: 0 },
      { t: '2:00', label: 'Remove the plunger and swirl gently to settle the bed.', water: 0 },
      { t: '2:30', label: 'Press slowly and evenly — about 30 seconds.', water: 0 }
    ];
  }

  if (styleId === 'st-hoffmann') {
    if (m.indexOf('espresso') > -1 || m.indexOf('moka') > -1) return [];
    // James Hoffmann's V60: five equal pours (each a fifth of the total
    // water) at 0:00, 0:45, 1:10, 1:30 and 1:50, then let it draw down —
    // no stirring needed. Each pour goes in over 10 seconds (`pour`), then
    // you wait for the next one.
    var fifth = g(water / 5);
    return [
      { t: '0:00', label: 'Bloom — pour the first fifth of the water.', water: fifth, pour: 10 },
      { t: '0:45', label: 'Pour the second fifth.', water: fifth, pour: 10 },
      { t: '1:10', label: 'Pour the third fifth.', water: fifth, pour: 10 },
      { t: '1:30', label: 'Pour the fourth fifth.', water: fifth, pour: 10 },
      { t: '1:50', label: 'Pour the final fifth, then let it draw down — no stirring needed.', water: g(water) - fifth * 4, pour: 10 }
    ];
  }

  // Tetsu Kasuya 4:6 — first 40% sets flavour, last 60% sets strength.
  var forty = water * 0.4, sixty = water * 0.6, a, b, rest, out, i;
  if (styleId === 'st-tetsu-sweet') { a = forty * 5 / 12; b = forty * 7 / 12; rest = 3; }
  else if (styleId === 'st-tetsu-acid') { a = forty * 7 / 12; b = forty * 5 / 12; rest = 3; }
  else if (styleId === 'st-tetsu-strength') { a = forty / 2; b = forty / 2; rest = 3; }
  else return [];

  out = [
    { t: '0:00', label: 'Pour 1 — the first 40% shapes the flavour balance.', water: g(a) },
    { t: '0:45', label: 'Pour 2 — completes the first 40%.', water: g(b) }
  ];
  for (i = 0; i < rest; i++) {
    out.push({
      t: mmss(90 + i * 45),
      label: 'Pour ' + (i + 3) + ' — the last 60% builds strength.',
      water: g(sixty / rest)
    });
  }
  return out;
}

/* ---------------------------------------------------------
   5. Small helpers
   --------------------------------------------------------- */

/* ---------------------------------------------------------
   Language

   One dictionary keyed on the English string itself, so t() falls back to
   its own argument and an untranslated string still reads correctly rather
   than showing a missing key.

   That single mechanism covers the built-in pouring steps too. They are
   library data, not interface text, but they are also *our* data — and
   because the lookup is by exact match, a step you have edited no longer
   matches anything and is left in your own words. Nothing you typed is
   ever translated: values scanned off a bag, coffee names, tasting notes
   and grind settings are yours, and stay exactly as entered.

   The language follows the device unless it has been set explicitly. */
var LANG_KEY = 'brewLang';

function deviceLang() {
  var list = navigator.languages && navigator.languages.length
    ? navigator.languages : [navigator.language || 'en'];
  for (var i = 0; i < list.length; i++) {
    if (/^pt\b/i.test(list[i])) return 'pt';
    if (/^en\b/i.test(list[i])) return 'en';
  }
  return 'en';
}

var langChoice = (function () {
  try { return localStorage.getItem(LANG_KEY) || 'auto'; } catch (e) { return 'auto'; }
})();

var LANG = langChoice === 'auto' ? deviceLang() : langChoice;

/* Dates and any other Intl formatting follow the app's language, not the
   browser's. Passing undefined as the locale — which is what the home
   screen's date did — means setting the app to Português leaves the date
   in whatever the device is set to. */
function locale() {
  return LANG === 'pt' ? 'pt-BR' : 'en-GB';
}

function setLang(choice) {
  langChoice = choice;
  LANG = choice === 'auto' ? deviceLang() : choice;
  try { localStorage.setItem(LANG_KEY, choice); } catch (e) { /* private mode */ }
  document.documentElement.setAttribute('lang', LANG);
}

function t(s) {
  if (LANG === 'en' || s == null) return s;
  var table = TRANSLATIONS[LANG];
  if (!table) return s;
  if (Object.prototype.hasOwnProperty.call(table, s)) return table[s];
  // Steps built from a formula count upward — "Pour 3 — the last 60%…" —
  // so the number is lifted out, the shape looked up, and the number put
  // back. Only shapes actually in the dictionary can match, so a step you
  // wrote yourself is untouched.
  var num = null;
  var shape = String(s).replace(/\d+/, function (d) { num = d; return '{n}'; });
  if (num !== null && Object.prototype.hasOwnProperty.call(table, shape)) {
    return table[shape].replace('{n}', num);
  }
  return s;
}

// Plural helper: English and Portuguese both take a bare -s here, but the
// noun itself differs, so both forms are looked up rather than assembled.
function tPlural(n, one, many) {
  return n === 1 ? t(one) : t(many);
}

var TRANSLATIONS = {
  pt: {
    // --- shell and menu ---
    'Home': 'Início',
    'Ranking': 'Ranking',
    'Best in the cup': 'Melhores na xícara',
    'Your coffees ranked by average cup score across every recipe that uses them.': 'Seus cafés ordenados pela nota média em todas as receitas que os usam.',
    'Nothing scored yet': 'Nada avaliado ainda',
    'Give a brew a cup score and the coffee joins the ranking. Two or three is enough to see which bags are worth buying again.': 'Dê uma nota a um preparo e o café entra no ranking. Dois ou três já bastam para ver quais pacotes valem repetir.',
    'Start with the one you just opened': 'Comece pela que você acabou de abrir',
    'The rest': 'Os demais',
    'Brewing for': 'Preparando para',
    'Ratio locked': 'Proporção travada',
    'Less coffee': 'Menos café',
    'More coffee': 'Mais café',
    'g coffee': 'g de café',
    'g water': 'g de água',
    'Scaled for this brew only — the recipe keeps': 'Ajustado só para este preparo — a receita continua com',
    'Change the dose and every pour below rescales.': 'Mude a dose e todos os despejos se ajustam.',
    'Reset': 'Desfazer',
    'Roasted by': 'Torrado por',
    'Start brewing': 'Começar a preparar',
    'Time': 'Tempo',
    'Back': 'Voltar',
    'Tasting notes': 'Notas de prova',
    'No steps recorded —': 'Nenhum passo registrado —',
    'add them': 'adicione',
    'Method type': 'Tipo de método',
    'Pour over': 'Coado',
    'Pressure': 'Pressão',
    'Immersion': 'Imersão',
    'Drip filter': 'Cafeteira',
    'Stovetop': 'Fogão',
    'Continue': 'Continuar',
    'Recent': 'Recente',
    'grams': 'gramas',
    'water': 'água',
    'shot': 'extração',
    'Search': 'Buscar',
    'Search recipes': 'Buscar receitas',
    'Show options': 'Mostrar opções',
    'Tap to search': 'Toque para buscar',
    'Search ': 'Buscar ',
    'Try a shorter search, or clear it to see all ': 'Tente uma busca mais curta, ou limpe para ver todos os ',
    'avg score': 'nota média',
    'scored': 'avaliadas',
    'with no score yet. Rate a brew and it joins the ranking.': 'sem nota ainda. Avalie um preparo e ele entra no ranking.',
    'Account': 'Conta',
    'Export data': 'Exportar dados',
    'Backup': 'Backup',
    'Device': 'Dispositivo',
    // --- greeting and home ---
    'Morning': 'Bom dia',
    'Afternoon': 'Boa tarde',
    'Evening': 'Boa noite',
    'What are you': 'O que você vai',
    'brewing': 'preparar',
    'today?': 'hoje?',
    'roaster': 'torrefação',
    'roasters': 'torrefações',
    'All': 'Todos',
    'All recipes': 'Todas as receitas',
    'Matching recipes': 'Receitas encontradas',
    'Brew': 'Preparar',
    'Open': 'Abrir',
    'opened': 'aberta',
    'Coffees, roasters and gear your recipes refer to. Edit one here and every recipe using it follows.': 'Cafés, torrefações e equipamentos que suas receitas usam. Edite aqui e toda receita que os usa acompanha.',
    'Pouring now': 'Despejando agora',
    'Now': 'Agora',
    'Done': 'Pronto',
    // --- sign-in ---
    'Every recipe you have dialled in, on every device.': 'Cada receita que você ajustou, em todos os aparelhos.',
    'Sign in to open your library — pour schedules scale themselves to whatever dose you brew today.': 'Entre para abrir sua biblioteca — os despejos se ajustam à dose que você preparar hoje.',
    'Pour steps computed live from the recipe style': 'Despejos calculados na hora a partir do estilo da receita',
    'Real-time sync, nothing to save by hand': 'Sincronização em tempo real, nada para salvar à mão',
    'Your library stays private to your account': 'Sua biblioteca fica privada na sua conta',
    'Open to anyone with a Google account. Your recipes are never shared between accounts.': 'Aberto a qualquer conta Google. Suas receitas nunca são compartilhadas entre contas.',
    'Pick up where you left off': 'Continue de onde parou',
    'just now': 'agora mesmo',
    'min ago': 'min atrás',
    'hour ago': 'hora atrás',
    'hours ago': 'horas atrás',
    'yesterday': 'ontem',
    'days ago': 'dias atrás',
    'Library': 'Biblioteca',
    'Add recipe': 'Adicionar receita',
    'Export data (.json)': 'Exportar dados (.json)',
    'Import data…': 'Importar dados…',
    'Sign out': 'Sair',
    'Reset library…': 'Redefinir biblioteca…',
    'Language': 'Idioma',
    'Appearance': 'Aparência',
    'Dark': 'Escuro',
    'Light': 'Claro',
    'Device language': 'Idioma do dispositivo',
    'Account menu': 'Menu da conta',
    'Back to top': 'Voltar ao topo',
    'Synced across your signed-in devices.': 'Sincronizado entre seus dispositivos conectados.',
    // --- home ---
    'Your brewing library': 'Sua biblioteca de preparos',
    'recipe': 'receita',
    'recipes': 'receitas',
    'coffee': 'café',
    'coffees': 'cafés',
    'across': 'em',
    'Filter to find the one you want, then brew it.': 'Filtre para encontrar a que você quer e prepare.',
    'Search recipes…': 'Buscar receitas…',
    'Favourites': 'Favoritas',
    'More filters': 'Mais filtros',
    'Sort recipes': 'Ordenar receitas',
    'Newest first': 'Mais recentes',
    'Oldest first': 'Mais antigas',
    'Top rated': 'Melhor avaliadas',
    'A–Z': 'A–Z',
    'Clear': 'Limpar',
    'Clear filters': 'Limpar filtros',
    'Clear search': 'Limpar busca',
    'Nothing matches those filters': 'Nada corresponde a esses filtros',
    'No recipes yet': 'Nenhuma receita ainda',
    'Try clearing a filter or two to see the rest of your library.': 'Tente limpar um filtro ou dois para ver o resto da sua biblioteca.',
    'Add your first brew — coffee, grinder, method, recipe style and the pour schedule.': 'Adicione seu primeiro preparo — café, moedor, método, estilo de receita e o cronograma de despejos.',
    'Nothing matches': 'Nada corresponde a',
    // --- filter fields ---
    'All coffees': 'Todos os cafés',
    'All grinders': 'Todos os moedores',
    'All methods': 'Todos os métodos',
    'All recipe styles': 'Todos os estilos',
    'Filter by coffee': 'Filtrar por café',
    'Filter by roaster': 'Filtrar por torrefação',
    'Filter by grinder': 'Filtrar por moedor',
    'Filter by brewing method': 'Filtrar por método de preparo',
    'Filter by recipe style': 'Filtrar por estilo de receita',
    'Show all coffees': 'Mostrar todos os cafés',
    'Show all roasters': 'Mostrar todas as torrefações',
    'Show all grinders': 'Mostrar todos os moedores',
    'Show all methods': 'Mostrar todos os métodos',
    'Show all recipe styles': 'Mostrar todos os estilos de receita',
    // --- entities ---
    'Roaster': 'Torrefação',
    'Roasters': 'Torrefações',
    'roaster': 'torrefação',
    'roasters': 'torrefações',
    'Coffee': 'Café',
    'Coffees': 'Cafés',
    'Grinder': 'Moedor',
    'Grinders': 'Moedores',
    'grinder': 'moedor',
    'grinders': 'moedores',
    'Brewing method': 'Método de preparo',
    'Methods': 'Métodos',
    'brewing method': 'método de preparo',
    'methods': 'métodos',
    'Recipe style': 'Estilo de receita',
    'Recipe styles': 'Estilos de receita',
    'recipe style': 'estilo de receita',
    'recipe styles': 'estilos de receita',
    // --- entity phrases ---
    'Add coffee': 'Adicionar café',
    'Edit coffee': 'Editar café',
    'Delete coffee': 'Excluir café',
    'Coffee saved.': 'Café salvo.',
    'Coffee deleted.': 'Café excluído.',
    'Add your first coffee.': 'Adicione seu primeiro café.',
    'Add roaster': 'Adicionar torrefação',
    'Edit roaster': 'Editar torrefação',
    'Delete roaster': 'Excluir torrefação',
    'Roaster saved.': 'Torrefação salva.',
    'Roaster deleted.': 'Torrefação excluída.',
    'Add your first roaster.': 'Adicione sua primeira torrefação.',
    'Add grinder': 'Adicionar moedor',
    'Edit grinder': 'Editar moedor',
    'Delete grinder': 'Excluir moedor',
    'Grinder saved.': 'Moedor salvo.',
    'Grinder deleted.': 'Moedor excluído.',
    'Add your first grinder.': 'Adicione seu primeiro moedor.',
    'Add brewing method': 'Adicionar método de preparo',
    'Edit brewing method': 'Editar método de preparo',
    'Delete brewing method': 'Excluir método de preparo',
    'Brewing method saved.': 'Método de preparo salvo.',
    'Brewing method deleted.': 'Método de preparo excluído.',
    'Add your first brewing method.': 'Adicione seu primeiro método de preparo.',
    'Add recipe style': 'Adicionar estilo de receita',
    'Edit recipe style': 'Editar estilo de receita',
    'Delete recipe style': 'Excluir estilo de receita',
    'Recipe style saved.': 'Estilo de receita salvo.',
    'Recipe style deleted.': 'Estilo de receita excluído.',
    'Add your first recipe style.': 'Adicione seu primeiro estilo de receita.',
    // --- fields ---
    'Name': 'Nome',
    'Location': 'Localização',
    'Origin': 'Origem',
    'Altitude': 'Altitude',
    'Process': 'Processo',
    'Roast level': 'Nível de torra',
    'Roast': 'Torra',
    'Varietal': 'Variedade',
    'Tasting notes': 'Notas sensoriais',
    'Type': 'Tipo',
    'Setting unit': 'Unidade de ajuste',
    'Notes': 'Notas',
    'Typical ratio': 'Proporção típica',
    'Author': 'Autor',
    'Description': 'Descrição',
    'optional': 'opcional',
    'City, country': 'Cidade, país',
    'Region, country': 'Região, país',
    'Washed / Natural / Honey': 'Lavado / Natural / Cereja descascado',
    'Light / Medium / Dark': 'Clara / Média / Escura',
    'Peach, bergamot, jasmine': 'Pêssego, bergamota, jasmim',
    'Start typing — reuses a roaster or creates it': 'Comece a digitar — reutiliza uma torrefação ou cria uma',
    'Hand grinder / Electric': 'Manual / Elétrico',
    'clicks, numbers, marks': 'cliques, números, marcas',
    'Burr type, reference settings…': 'Tipo de mó, ajustes de referência…',
    'Pour over / Immersion / Pressure': 'Coado / Imersão / Pressão',
    'Filter, kettle, gear…': 'Filtro, chaleira, equipamento…',
    'Who devised it': 'Quem criou',
    'What this recipe is going for': 'O que esta receita busca',
    // --- recipe detail ---
    'Roastery': 'Torrefadora',
    'Grind size': 'Moagem',
    'Method': 'Método',
    'Dose': 'Dose',
    'Water': 'Água',
    'Start timer': 'Iniciar cronômetro',
    'Favourite': 'Favoritar',
    'Favourited': 'Favoritada',
    'Edit': 'Editar',
    'More actions': 'Mais ações',
    'Duplicate': 'Duplicar',
    'Delete recipe…': 'Excluir receita…',
    'Delete recipe': 'Excluir receita',
    'Delete': 'Excluir',
    // --- forms ---
    'New recipe': 'Nova receita',
    'Edit recipe': 'Editar receita',
    'Save changes': 'Salvar alterações',
    // --- forms and scanning ---
    'Recipes': 'Receitas',
    'Cancel': 'Cancelar',
    'Done': 'Concluído',
    'Save recipe': 'Salvar receita',
    'Nothing here yet': 'Nada aqui ainda',
    'Scan label': 'Escanear rótulo',
    'Try again': 'Tentar de novo',
    'Fill the frame with the label itself, not the whole bag — the panel listing origin, process and notes. Small print needs a close, straight, evenly lit shot. Nothing leaves your device.': 'Enquadre o rótulo em si, não o pacote inteiro — o painel com origem, processo e notas. Letras pequenas exigem uma foto próxima, reta e bem iluminada. Nada sai do seu aparelho.',
    'Everything it read': 'Tudo o que foi lido',
    'Fill fields': 'Preencher campos',
    'Brew parameters': 'Parâmetros do preparo',
    'Coffee dose (g)': 'Dose de café (g)',
    'Water (g)': 'Água (g)',
    'Temperature (°C)': 'Temperatura (°C)',
    'Total brew time': 'Tempo total de preparo',
    'Ratio': 'Proporção',
    'Pouring steps': 'Etapas de despejo',
    'Personal notes': 'Anotações pessoais',
    'Finishing touches': 'Toques finais',
    'Custom title (optional)': 'Título personalizado (opcional)',
    'Cup score': 'Nota da xícara',
    // --- timer, brewing and steps ---
    'Sign in to see your recipes — synced across every device.': 'Entre para ver suas receitas — sincronizadas em todos os aparelhos.',
    'Continue with Google': 'Continuar com o Google',
    'of': 'de',
    'Step': 'Etapa',
    'Next': 'Próxima',
    'Last step': 'Última etapa',
    'Left in this step': 'Restante nesta etapa',
    'Water poured': 'Água despejada',
    'Shot': 'Extração',
    'Brewing your library…': 'Preparando sua biblioteca…',
    'Enjoy your cup': 'Aproveite seu café',
    'Rate this cup': 'Avalie esta xícara',
    'poured': 'despejados',
    'Not set': 'Não definido',
    'Moka pot': 'Moka',
    'Drip machine': 'Cafeteira elétrica',
    'Cold brew': 'Cold brew',
    'Coffee steeping in the press': 'Café em infusão na prensa',
    'Moka pot brewing on the stove': 'Moka preparando no fogão',
    'Brew on the stove; take it off at the first gurgle.': 'Prepare no fogão; tire ao primeiro borbulhar.',
    'Let it steep.': 'Deixe em infusão.',
    'Brew.': 'Prepare.',
    'AeroPress brewing into the mug': 'AeroPress preparando na caneca',
    'in the basket': 'no porta-filtro',
    'Stop the shot': 'Parar a extração',
    'Espresso pouring into the cup': 'Espresso caindo na xícara',
    'Your coffee · every device': 'Seu café · todo dispositivo',
    'Contents': 'Conteúdo',
    'Pours': 'Despejos',
    'Timed': 'Cronometrados',
    'Scales': 'Ajustável',
    'Sync': 'Sincronia',
    'Live': 'Ao vivo',
    'Your best cup': 'Seu melhor café',
    'Rank by': 'Classificar por',
    'rating': 'avaliação',
    'ratings': 'avaliações',
    'avg': 'média',
    'Waiting for a score': 'Aguardando nota',
    'Scores are weighted by how many ratings stand behind them; the plain average shows when it differs.': 'As notas pesam pelo número de avaliações; a média simples aparece quando é diferente.',
    'Give a brew a cup score and it joins the ranking. Two or three is enough to see which bags are worth buying again.': 'Dê uma nota a um preparo e ele entra no ranking. Duas ou três bastam para ver quais pacotes valem a recompra.',
    'Wait': 'Aguarde',
    'next pour in': 'próximo despejo em',
    'Water in the cone': 'Água no filtro',
    'left': 'restantes',
    'target': 'meta',
    'Add': 'Adicione',
    'up to': 'até',
    'Close': 'Fechar',
    'Restart': 'Recomeçar',
    'Skip to next step': 'Pular para a próxima etapa',
    'Mute step cues': 'Silenciar avisos',
    'Unmute step cues': 'Ativar avisos',
    'Start brewing': 'Iniciar preparo',
    'Resume': 'Retomar',
    'Pause': 'Pausar',
    'Brew again': 'Preparar de novo',
    'Select a coffee…': 'Selecione um café…',
    'Select a method…': 'Selecione um método…',
    'Select a grinder…': 'Selecione um moedor…',
    'Select a style…': 'Selecione um estilo…',
    'e.g. 75 clicks': 'ex.: 75 cliques',
    'What you do at this point': 'O que você faz neste momento',
    'What to do at this point': 'O que fazer neste momento',
    'Add step': 'Adicionar etapa',
    'This recipe style has no built-in formula — write the steps by hand.': 'Este estilo de receita não tem fórmula própria — escreva as etapas à mão.',
    'Pouring steps always follow the chosen recipe style. Add a style to build your own step-by-step schedule.': 'As etapas de despejo sempre seguem o estilo de receita escolhido. Adicione um estilo para montar seu próprio cronograma.',
    // --- built-in pouring steps (data, but ours) ---
    'Preparing the photo…': 'Preparando a foto…',
    'Loading the reader…': 'Carregando o leitor…',
    'Reading the label…': 'Lendo o rótulo…',
    'Couldn’t read any text. Try filling the frame with the label, in even light.': 'Não foi possível ler nenhum texto. Tente enquadrar o rótulo com luz uniforme.',
    'Couldn’t load the text reader — check your connection and try again.': 'Não foi possível carregar o leitor de texto — verifique sua conexão e tente de novo.',
    'That file didn’t open as an image.': 'Esse arquivo não abriu como imagem.',
    'Something went wrong reading that photo.': 'Algo deu errado ao ler essa foto.',
    'What the label says': 'O que diz o rótulo',
    'reads as a town and state': 'parece uma cidade e estado',
    // --- detail page ---
    'Temperature': 'Temperatura',
    'Brew time': 'Tempo de preparo',
    'Grind': 'Moagem',
    'Details': 'Detalhes',
    'About this style': 'Sobre este estilo',
    'ratio': 'proporção',
    // --- remaining interface ---
    'Action': 'Ação',
    'Time': 'Tempo',
    'Brewing steps': 'Etapas do preparo',
    'Recipe not found': 'Receita não encontrada',
    'It may have been deleted.': 'Ela pode ter sido excluída.',
    'This cannot be undone — export a backup first if unsure.': 'Isso não pode ser desfeito — exporte um backup antes, se tiver dúvida.',
    'All roasters': 'Todas as torrefações',
    // --- built-in pouring steps ---
    'Bloom — pour the first fifth of the water.': 'Pré-infusão — despeje o primeiro quinto da água.',
    'Flip the AeroPress upside down, seat the plunger a few rings in, then add the coffee.': 'Vire a AeroPress de cabeça para baixo, encaixe o êmbolo alguns aneis e adicione o café.',
    'Pour in all the water and stir well to saturate every ground.': 'Despeje toda a água e mexa bem para saturar todo o pó.',
    'Wet the filter, screw on the cap, then let it steep undisturbed.': 'Molhe o filtro, rosqueie a tampa e deixe em infusão sem mexer.',
    'Flip upright onto your mug.': 'Vire de volta sobre a sua xícara.',
    'Bloom to 60 g — three times the dose. Swirl gently to wet every ground.': 'Pré-infusão até 60 g — três vezes a dose. Gire suavemente para molhar todo o pó.',
    'Pour to 100 g total in a slow, steady circle.': 'Despeje até 100 g no total em círculos lentos e constantes.',
    'Pour to 200 g total.': 'Despeje até 200 g no total.',
    'Pour to 300 g total, or your target weight.': 'Despeje até 300 g no total, ou o seu peso alvo.',
    'Let it draw down — aim to finish around 3:00.': 'Deixe escoar — busque terminar por volta de 3:00.',
    'Pour the second fifth.': 'Despeje o segundo quinto.',
    'Pour the third fifth.': 'Despeje o terceiro quinto.',
    'Pour the fourth fifth.': 'Despeje o quarto quinto.',
    'Pour the final fifth, then let it draw down — no stirring needed.': 'Despeje o último quinto e deixe escoar — não precisa mexer.',
    'Pour 1 — the first 40% shapes the flavour balance.': 'Despejo 1 — os primeiros 40% definem o equilíbrio de sabor.',
    'Pour 2 — completes the first 40%.': 'Despejo 2 — completa os primeiros 40%.',
    'Pour {n} — the last 60% builds strength.': 'Despejo {n} — os últimos 60% constroem a intensidade.',
    'Add the coffee, then pour all the water in one go.': 'Adicione o café e despeje toda a água de uma vez.',
    'Insert the plunger just enough to seal, then leave it alone.': 'Encaixe o êmbolo só o suficiente para vedar e deixe quieto.',
    'Remove the plunger and swirl gently to settle the bed.': 'Retire o êmbolo e gire suavemente para assentar o leito.',
    'Press slowly and evenly — about 30 seconds.': 'Pressione devagar e por igual — cerca de 30 segundos.',
    'Pull the shot.': 'Extraia o shot.',
    'Get set up.': 'Prepare tudo.',
    // --- built-in style descriptions ---
    'Ultimate V60 technique — bloom, two pours, swirl, even drawdown.': 'Técnica definitiva do V60 — pré-infusão, dois despejos, giro e escoamento uniforme.',
    '4:6 method. A smaller first pour pushes the cup toward sweetness.': 'Método 4:6. Um primeiro despejo menor leva a xícara para a doçura.',
    '4:6 method. A larger first pour brings out acidity and brightness.': 'Método 4:6. Um primeiro despejo maior realça a acidez e o brilho.',
    '4:6 method. Balanced first 40%, then the remaining 60% split into three pours for a stronger cup.': 'Método 4:6. Primeiros 40% equilibrados, e os 60% restantes divididos em três despejos para uma xícara mais intensa.',
    'A pressure shot rather than a pour: dial in with dose, grind and shot time instead of a pour schedule.': 'Um shot sob pressão, não um coado: ajuste por dose, moagem e tempo de extração em vez de um cronograma de despejos.',
    // --- built-in method and grinder types ---
    'Pour over': 'Coado',
    'Immersion': 'Imersão',
    'Pressure': 'Pressão',
    'Stovetop': 'Fogão',
    'Drip filter': 'Filtro de gotejamento',
    'Hand grinder': 'Moedor manual',
    'Electric grinder': 'Moedor elétrico',
    'in': 'em',
    'Espresso is dialled in by dose, grind and shot time rather than a pour schedule — the numbers above are the recipe.': 'O espresso é ajustado pela dose, moagem e tempo de extração, não por um cronograma de despejos — os números acima são a receita.',
    'This method': 'Este método',
    'doesn’t use a pour schedule — nothing to show here.': 'não usa cronograma de despejos — nada a mostrar aqui.',
    'Defaults to the coffee name': 'Usa o nome do café por padrão',
    'Brewed upside down, so the coffee steeps in full contact with the water instead of draining early — that buys a longer, more even extraction before you flip and press. A 1:15 ratio is a solid starting point; scale to taste.': 'Preparado de cabeça para baixo, para que o café fique em contato total com a água em vez de escoar cedo demais — isso garante uma extração mais longa e uniforme antes de virar e prensar. Uma proporção de 1:15 é um bom ponto de partida; ajuste ao seu gosto.',
    'Catch-all pour over that suits any dripper and any roast. Level the bed before blooming, and pour slowly — aggressive pours over-agitate the grounds and push the cup bitter. Water 100°C for light roasts, 92°C medium, 85°C dark.': 'Coado versátil que serve a qualquer suporte e qualquer torra. Nivele o leito antes da pré-infusão e despeje devagar — despejos agressivos agitam demais o pó e deixam a xícara amarga. Água a 100°C para torras claras, 92°C médias, 85°C escuras.',
    'nothing matches — try clearing a filter': 'nada corresponde — tente limpar um filtro',
    'Ultimate AeroPress technique — all the water at once, a long steep, a swirl, then a gentle press. His published figures are 11 g to 200 g of water just off the boil; the schedule scales to whatever dose and water the recipe carries.': 'Técnica definitiva da AeroPress — toda a água de uma vez, uma infusão longa, um giro e uma prensagem suave. Os números publicados por ele são 11 g para 200 g de água logo abaixo da fervura; o cronograma se ajusta à dose e à água da receita.',
    // --- messages ---
    'Recipe saved.': 'Receita salva.',
    'Recipe deleted.': 'Receita excluída.',
    'Duplicated — edit away.': 'Duplicada — pode editar.',
    'Pick a coffee first.': 'Escolha um café primeiro.',
    'Pick a brewing method.': 'Escolha um método de preparo.',
    'Give it a name first.': 'Dê um nome primeiro.',
    'Add a brew time or pouring steps first.': 'Adicione um tempo de preparo ou etapas de despejo primeiro.',
    'Add a coffee first — then the recipe.': 'Adicione um café primeiro — depois a receita.',
    'Could not sync — check your connection.': 'Não foi possível sincronizar — verifique sua conexão.',
    'Exported.': 'Exportado.',
    'Library imported.': 'Biblioteca importada.',
    'Library reset.': 'Biblioteca redefinida.',
    'That file does not look like a Brew Library export.': 'Esse arquivo não parece ser uma exportação do Brew Library.',
    'Could not sign in': 'Não foi possível entrar',
    'Your browser blocked the sign-in popup — allow popups for this site and try again.': 'Seu navegador bloqueou a janela de login — permita pop-ups neste site e tente novamente.',
    'Can’t connect': 'Sem conexão',
    'Still brewing': 'Preparo em andamento',
    'Leave anyway': 'Sair mesmo assim',
    'Brew complete.': 'Preparo concluído.',
  }
};

/* index.html ships English. Anything marked data-i18n is translated once
   the language is known, and again whenever it changes. The original text
   is kept on the node so switching back is a lookup, not a reversal. */
function translateMarkup() {
  var nodes = document.querySelectorAll('[data-i18n]');
  [].forEach.call(nodes, function (el) {
    if (!el.hasAttribute('data-i18n-src')) el.setAttribute('data-i18n-src', el.textContent);
    el.textContent = t(el.getAttribute('data-i18n-src'));
  });
  [].forEach.call(document.querySelectorAll('[data-i18n-aria]'), function (el) {
    if (!el.hasAttribute('data-i18n-aria-src')) el.setAttribute('data-i18n-aria-src', el.getAttribute('aria-label'));
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-src')));
  });
  // The chosen language is ticked in the menu.
  [].forEach.call(document.querySelectorAll('[data-action="set-lang"]'), function (el) {
    el.classList.toggle('on', el.getAttribute('data-lang') === langChoice);
  });
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function mmss(sec) {
  var m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}
function normTime(v) {
  v = String(v || '').trim();
  if (!v) return '';
  if (/^\d+$/.test(v)) return mmss(parseInt(v, 10));
  return v;
}
function ratio(dose, water) {
  dose = Number(dose); water = Number(water);
  if (!dose || !water) return '—';
  var r = water / dose;
  return '1:' + (r >= 10 ? r.toFixed(1) : r.toFixed(2)).replace(/\.0+$/, '');
}
function num(v, unit) {
  if (v === '' || v == null || isNaN(Number(v))) return '—';
  return String(Number(v)) + (unit || '');
}
function titleOf(r) {
  if (r.name) return r.name;
  var c = findIn('coffee', r.coffeeId);
  return c ? c.name : 'Untitled recipe';
}
function toast(msg) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { el.hidden = true; }, 2600);
}
// Cupform v3 marks a favourite with a bookmark, not a star — the star is
// reserved for nothing, and beans do the rating. bookmark-check is the
// filled/on state, plain bookmark the off state.
function iconStar(filled) {
  return '<svg viewBox="0 0 24 24" class="' + (filled ? '' : 'off') + '">' +
    '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>' +
    (filled ? '<path d="M9 10l2 2 4-4"/>' : '') +
  '</svg>';
}
// Cupform rates in beans, not stars — the 1–5 cup score uses this glyph
// (rating only; the Favourite bookmark stays a star, a separate concept).
function iconBean(filled) {
  return '<svg viewBox="0 0 24 24" class="' + (filled ? 'on' : 'off') + '">' +
    '<ellipse cx="12" cy="12" rx="6.4" ry="9" transform="rotate(38 12 12)"/>' +
    '<path class="crease" d="M8.2 15.8C10 13 14 11 15.8 8.2"/>' +
  '</svg>';
}
function stars(n) {
  var out = '<span class="stars">', i;
  for (i = 1; i <= 5; i++) out += iconBean(i <= (n || 0));
  return out + '</span>';
}
/* Lucide geometry (24px grid, 2px stroke, round caps) — v3's icon system.
   Inlined rather than pulled from the lucide-static CDN so the app keeps
   its zero-dependency, zero-request-beyond-fonts shape; swap these paths
   if a real icon set ever arrives. Glyph names match Lucide's own. */
var ICON = {
  edit: '<svg viewBox="0 0 24 24" class="ico"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/><path d="M15 5l4 4"/></svg>',
  copy: '<svg viewBox="0 0 24 24" class="ico"><rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"/></svg>',
  download: '<svg viewBox="0 0 24 24" class="ico"><path d="M12 4v11M8 11l4 4 4-4M5 20h14"/></svg>',
  upload: '<svg viewBox="0 0 24 24" class="ico"><path d="M12 15V4M8 8l4-4 4 4M5 20h14"/></svg>',
  signout: '<svg viewBox="0 0 24 24" class="ico"><path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 8l-4 4 4 4M6 12h9"/></svg>',
  trash: '<svg viewBox="0 0 24 24" class="ico"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" class="ico"><path d="M12 5v14M5 12h14"/></svg>',
  drop: '<svg viewBox="0 0 24 24" class="ico"><path d="M12 3.5c3.5 4.2 6 7.6 6 10.6a6 6 0 0 1-12 0c0-3 2.5-6.4 6-10.6z"/></svg>',
  cup: '<svg viewBox="0 0 24 24" class="cup"><path d="M5 9h12v4a6 6 0 0 1-6 6h0a6 6 0 0 1-6-6z"/><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H16"/></svg>',
  stop: '<svg viewBox="0 0 24 24" class="ico ico-fill"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  minus: '<svg viewBox="0 0 24 24" class="ico"><path d="M5 12h14"/></svg>',
  close: '<svg viewBox="0 0 24 24" class="ico"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  back: '<svg viewBox="0 0 24 24" class="ico"><path d="M15 18l-6-6 6-6"/></svg>',
  search: '<svg viewBox="0 0 24 24" class="ico"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
  // bookmark — the favourite mark in v3.
  star: '<svg viewBox="0 0 24 24" class="ico"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
  // The rating mark is deliberately not an icon: a drawn bean with a
  // centre crease, so it can fill.
  bean: '<svg viewBox="0 0 24 24" class="bean"><g transform="rotate(-28 12 12)">' +
    '<ellipse cx="12" cy="12" rx="6.4" ry="9.4"/><path d="M12 4.4c-2 2.5-2 5 0 7.6s2 5.1 0 7.6"/></g></svg>',
  // Solid: a hollow triangle reads as a shape, a filled one as "press me".
  play: '<svg viewBox="0 0 24 24" class="ico ico-fill"><path d="M6 3l14 9-14 9z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" class="ico"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
  replay: '<svg viewBox="0 0 24 24" class="ico"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  skip: '<svg viewBox="0 0 24 24" class="ico"><path d="M5 4l10 8-10 8zM19 5v14"/></svg>',
  arrowDown: '<svg viewBox="0 0 24 24" class="ico"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>',
  timer: '<svg viewBox="0 0 24 24" class="ico"><path d="M10 2h4M12 14l3-3"/><circle cx="12" cy="14" r="8"/></svg>',
  // sliders-horizontal — v3's own glyph for a filter/options toggle.
  sliders: '<svg viewBox="0 0 24 24" class="ico"><path d="M21 4H14M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3"/>' +
    '<circle cx="12" cy="4" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="20" r="2"/></svg>',
  chevUp: '<svg viewBox="0 0 24 24" class="ico"><path d="M18 15l-6-6-6 6"/></svg>',
  chevDown: '<svg viewBox="0 0 24 24" class="ico"><path d="M6 9l6 6 6-6"/></svg>',
  chevRight: '<svg viewBox="0 0 24 24" class="ico"><path d="M9 6l6 6-6 6"/></svg>',
  soundOn: '<svg viewBox="0 0 24 24" class="ico"><path d="M11 5L6 9H2v6h4l5 4z"/>' +
    '<path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.8 5.2a9 9 0 0 1 0 13.6"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24" class="ico"><path d="M11 5L6 9H2v6h4l5 4z"/>' +
    '<path d="M22 9l-6 6M16 9l6 6"/></svg>',
  more: '<svg viewBox="0 0 24 24" class="ico ico-fill"><circle cx="5" cy="12" r="1.6"/>' +
    '<circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
  check: '<svg viewBox="0 0 24 24" class="ico"><path d="M20 6L9 17l-5-5"/></svg>',
  // Lucide coffee / store / cog / filter / book-open — the lead glyph in
  // each filter's combobox names what that field searches, rather than
  // repeating the magnifier five times across one bar.
  coffee: '<svg viewBox="0 0 24 24" class="ico"><path d="M6 2v2M10 2v2M14 2v2"/>' +
    '<path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/></svg>',
  store: '<svg viewBox="0 0 24 24" class="ico"><path d="m2 7 4.4-4.4A2 2 0 0 1 7.8 2h8.4a2 2 0 0 1 1.4.6L22 7"/>' +
    '<path d="M2 7h20"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>' +
    '<path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/></svg>',
  // A hand grinder, drawn from its one unmistakable feature: the crank on
  // top. Every grinder in this library but the Oster is a hand grinder.
  // Earlier attempts failed for want of a silhouette — a burr disc reads
  // as a CD, a cog turns to mush at 17px, a hopper reads as a trash can,
  // and a funnel would collide with Method's own glyph. Body plus catch-cup
  // seam plus crank survives the size and looks like nothing else here.
  grinder: '<svg viewBox="0 0 24 24" class="ico"><path d="M12 8.5V5h6"/><path d="M18 5v3"/>' +
    '<rect x="6.5" y="8.5" width="11" height="12.5" rx="2.5"/>' +
    '<path d="M6.5 15.5h11"/></svg>',
  filter: '<svg viewBox="0 0 24 24" class="ico"><path d="M22 3H2l8 9.5V19l4 2v-8.5L22 3z"/></svg>',
  book: '<svg viewBox="0 0 24 24" class="ico"><path d="M12 7v14"/>' +
    '<path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>',
  camera: '<svg viewBox="0 0 24 24" class="ico"><path d="M3 8.7A1.7 1.7 0 0 1 4.7 7h2a1 1 0 0 0 .83-.45l.94-1.4A1 1 0 0 1 9.3 4.7h5.4a1 1 0 0 1 .83.45l.94 1.4A1 1 0 0 0 17.3 7h2A1.7 1.7 0 0 1 21 8.7v8.6a1.7 1.7 0 0 1-1.7 1.7H4.7A1.7 1.7 0 0 1 3 17.3z"/>' +
    '<circle cx="12" cy="13" r="3.4"/></svg>'
};

// Which glyph leads each filter's combobox.
var COMBO_ICON = {
  coffee: 'coffee', roaster: 'store', grinder: 'grinder', method: 'filter', style: 'book'
};

/* ---------------------------------------------------------
   6. Filters
   --------------------------------------------------------- */

var filters = { q: '', coffee: '', roaster: '', grinder: '', method: '', style: '', fav: false, sort: 'new', kind: '' };
/* Which set the comboboxes read and write. Home points it at the live
   filters; the filters page points it at its own draft, so nothing the
   page touches reaches the list until Apply. */
var filterTarget = filters;

// Mobile only: whether the coffee/roaster/grinder/method/style/sort group
// is expanded under "More filters". A module-level flag rather than
// something read off the DOM, since renderHome() rebuilds the filter bar
// on every keystroke and every filter change — it has to survive that.

// Cupform v3.1's Combobox: "Select for a list that outgrew a list. Typing
// filters the options; the field still resolves to exactly one value."
// Every entity filter (coffee, roaster, grinder, method, style) uses one —
// only one open at a time, so a single pair of module-level slots covers
// all of them, same reason filtersExpanded is module-level: renderHome()
// rebuilds the whole bar on every keystroke.
var openCombo = null; // 'coffee' | 'roaster' | 'grinder' | 'method' | 'style' | null
var comboQuery = '';

function filtersActive() {
  return !!(filters.q || filters.coffee || filters.roaster || filters.grinder || filters.method || filters.style || filters.fav);
}

// How many of the filters tucked under "More filters" are set — shown as
// a badge on the toggle so collapsing them doesn't hide that they're active.
function moreFiltersCount() {
  return ['coffee', 'roaster', 'grinder', 'method', 'style'].filter(function (k) { return !!filters[k]; }).length;
}

// Display name for a coffee's roaster: the linked record if it resolves,
// otherwise the legacy string, so a library mid-migration still reads right.
function roasterNameOf(c) {
  if (!c) return '';
  var ro = c.roasterId ? findIn('roaster', c.roasterId) : null;
  if (ro) return ro.name;
  return (c.roaster || '').trim();
}

function roasterIdOf(r) {
  var c = findIn('coffee', r.coffeeId);
  return c ? (c.roasterId || '') : '';
}

function roasterOf(r) {
  return roasterNameOf(findIn('coffee', r.coffeeId));
}

function allRoasters() {
  return coll('roaster').slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
}

function visibleRecipes(f) {
  f = f || filters;
  var q = f.q.trim().toLowerCase();
  var out = state.recipes.filter(function (r) {
    if (f.coffee && r.coffeeId !== f.coffee) return false;
    if (f.roaster && roasterIdOf(r) !== f.roaster) return false;
    if (f.grinder && r.grinderId !== f.grinder) return false;
    if (f.method && r.methodId !== f.method) return false;
    if (f.kind && brewerOf(r) !== f.kind) return false;
    if (f.style && r.styleId !== f.style) return false;
    if (f.fav && !r.fav) return false;
    if (q) {
      var hay = [titleOf(r), nameOf('coffee', r.coffeeId), roasterOf(r), nameOf('grinder', r.grinderId),
        nameOf('method', r.methodId), nameOf('style', r.styleId), r.notes, r.grindSize]
        .join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });

  out.sort(function (a, b) {
    if (f.sort === 'old') return a.createdAt - b.createdAt;
    if (f.sort === 'rating') return (b.rating || 0) - (a.rating || 0) || b.createdAt - a.createdAt;
    if (f.sort === 'coffee') return titleOf(a).localeCompare(titleOf(b));
    return b.createdAt - a.createdAt;
  });
  return out;
}

/* ---------------------------------------------------------
   7. Views
   --------------------------------------------------------- */

var view = document.getElementById('view');

// Standard Google "G" mark for the sign-in button, per Google's brand guidelines.
var GOOGLE_G_ICON = '<svg viewBox="0 0 48 48" class="ico" aria-hidden="true">' +
  '<path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.5 0 24 0 14.6 0 6.5 5.4 2.5 13.2l7.9 6.1C12.3 13 17.6 9.5 24 9.5z"/>' +
  '<path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.6c-.5 3-2.2 5.5-4.7 7.2l7.4 5.7C43.7 37.6 46.5 31.6 46.5 24.5z"/>' +
  '<path fill="#FBBC05" d="M10.4 19.3c-.5 1.4-.8 3-.8 4.7s.3 3.3.8 4.7l-7.9 6.1C.9 31.6 0 28.1 0 24s.9-7.6 2.5-10.8z"/>' +
  '<path fill="#34A853" d="M24 48c6.5 0 12-2.1 15.9-5.9l-7.4-5.7c-2.1 1.4-4.8 2.2-8.5 2.2-6.4 0-11.7-3.5-13.6-8.7l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/>' +
  '</svg>';

/* The tab bar's height is not a constant: it grows by the home-indicator
   inset on phones that have one, and the bar disappears entirely on
   desktop. Anything that has to sit above it — the pinned brew action,
   Back to top, the page's own bottom padding — measures it rather than
   guessing, which is how a 16px gap opened up under the brew bar. */
/* ---- coffee details ----
   Brewer icons: each method gets a drawing of its brewer instead of a
   two-letter monogram, matched on the method's name (then its kind), so
   "Espresso — DEX basket" and "Espresso — 3Bomber" share the portafilter. */
var BREWER_SVG = {
  v60: '<path d="M4 6h16l-6 11h-4z"/><path d="M6.4 10h11.2" opacity=".45"/><path d="M9 20h6"/>',
  origami: '<path d="M3 6h18l-6.5 10h-5z"/><path d="M8 6l2 10M16 6l-2 10"/><path d="M10 19h4"/>',
  espresso: '<path d="M4 8h12v3a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 9h4"/><path d="M8 19h4"/>',
  moka: '<path d="M7 4h10l-1.5 7h-7z"/><path d="M8.5 11h7l1.5 9H7z"/><path d="M17 6h2v4"/>',
  flat: '<path d="M4 6h16l-4 9H8z"/><path d="M9 15h6v3H9z"/>',
  chemex: '<path d="M6 3h12l-4 8 4 9H6l4-9z"/><path d="M9.5 11h5"/>',
  aeropress: '<rect x="7" y="3" width="10" height="13" rx="1"/><path d="M5 16h14M9 19.5h6"/>',
  press: '<rect x="6" y="7" width="11" height="13" rx="1.5"/><path d="M11.5 3v10M8.5 13h6"/><path d="M17 10h2v6h-2"/>',
  drip: '<rect x="4" y="3" width="16" height="5" rx="1"/><path d="M6 8v12h12V8"/><path d="M9 13h6v5H9z"/>',
  bean: '<g transform="rotate(-28 12 12)"><ellipse cx="12" cy="12" rx="6.4" ry="9.4"/><path d="M12 4.4c-2 2.5-2 5 0 7.6s2 5.1 0 7.6"/></g>'
};

/* Method types. The method form picks one of these; older libraries carry
   free text ("Pressure", "Imersão"…), which is read for its meaning. The
   type decides the timer's drawing and backs up the icon when the name
   says nothing. */
var METHOD_TYPES = ['Pour over', 'Immersion', 'Espresso', 'AeroPress', 'Moka pot', 'Drip machine', 'Cold brew'];

function typeFromText(text) {
  var k = String(text || '').toLowerCase();
  if (!k) return '';
  if (/aeropress/.test(k)) return 'AeroPress';
  if (/cold/.test(k)) return 'Cold brew';
  if (/immers|imers|french|prensa/.test(k)) return 'Immersion';
  if (/espresso|pressure|press[aã]o/.test(k)) return 'Espresso';
  if (/moka|stovetop|fog[aã]o/.test(k)) return 'Moka pot';
  if (/drip|cafeteira|machine|m[aá]quina|gotej/.test(k)) return 'Drip machine';
  if (/pour|coado|filtro/.test(k)) return 'Pour over';
  return '';
}

// The brewer a name points at, or '' when the name says nothing.
function brewerFromName(me) {
  var n = (me && me.name || '').toLowerCase();
  if (/origami/.test(n)) return 'origami';
  if (/v60|hario|cone|cono/.test(n)) return 'v60';
  if (/aeropress/.test(n)) return 'aeropress';
  if (/espresso|portafilter/.test(n)) return 'espresso';
  if (/moka|bialetti|stovetop|italiana/.test(n)) return 'moka';
  if (/b75|kalita|wave|flat|april|orea/.test(n)) return 'flat';
  if (/chemex/.test(n)) return 'chemex';
  if (/french|prensa|press|clever|immers|cold/.test(n)) return 'press';
  if (/drip|cafeteira|machine|m[aá]quina/.test(n)) return 'drip';
  return '';
}

var TYPE_BREWER = { 'Pour over': 'v60', 'Immersion': 'press', 'Espresso': 'espresso', 'AeroPress': 'aeropress',
  'Moka pot': 'moka', 'Drip machine': 'drip', 'Cold brew': 'press' };
var BREWER_TYPE = { v60: 'Pour over', origami: 'Pour over', flat: 'Pour over', chemex: 'Pour over', aeropress: 'AeroPress',
  espresso: 'Espresso', moka: 'Moka pot', press: 'Immersion', drip: 'Drip machine' };

// The method's type: what the form chose, else what its name implies.
function methodType(me) {
  if (!me) return '';
  if (/aeropress/i.test(me.name || '')) return 'AeroPress';
  return typeFromText(me.kind) || BREWER_TYPE[brewerFromName(me)] || '';
}

function brewerKey(me) {
  if (!me) return 'bean';
  return brewerFromName(me) || TYPE_BREWER[methodType(me)] || 'bean';
}

// Which drawing the timer shows for a recipe's method and plan.
function animKindFor(me, plan) {
  var ty = methodType(me);
  if (ty === 'AeroPress') return 'aero';
  if (ty === 'Espresso') return 'shot';
  if (ty === 'Immersion' || ty === 'Cold brew') return 'immersion';
  if (ty === 'Moka pot') return 'moka';
  return plan.water ? 'pour' : '';
}

function brewerIcon(me) {
  return '<svg viewBox="0 0 24 24" class="ico brewer-ico" aria-hidden="true">' + BREWER_SVG[brewerKey(me)] + '</svg>';
}

/* ---- appearance ----
   Dark is F4 as designed; light is the same layout on warm white, with
   frosted white glass. "Device" follows the phone's own setting and is
   the default, so the app matches the sign-in screen until someone
   picks Dark or Light. The
   choice is per device (localStorage), like the language. index.html
   applies it before the stylesheet paints, so a light phone never
   flashes dark on load; this keeps it current afterwards. */
var themeChoice = (function () {
  try { return localStorage.getItem('brewTheme') || 'auto'; } catch (e) { return 'auto'; }
})();
var themeQuery = window.matchMedia('(prefers-color-scheme: light)');

function applyTheme(device) {
  var choice = device ? 'auto' : themeChoice;
  var mode = choice === 'auto' ? (themeQuery.matches ? 'light' : 'dark') : choice;
  document.documentElement.setAttribute('data-theme', mode);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', mode === 'light' ? '#F4F2EE' : '#111010');
  var cs = document.querySelector('meta[name="color-scheme"]');
  if (cs) cs.setAttribute('content', mode);
}

function setTheme(choice) {
  themeChoice = choice;
  try { localStorage.setItem('brewTheme', choice); } catch (e) { /* private mode */ }
  applyTheme();
}

applyTheme();
if (themeQuery.addEventListener) themeQuery.addEventListener('change', function () {
  if (authPhase === 'signedOut') applyTheme(true);
  else if (themeChoice === 'auto') applyTheme();
});

/* ---- liquid glass ----
   Floating controls are glass in the iOS sense: the page behind is
   blurred and saturated (every engine), and on Chromium it is also bent
   at the rim, the way a thick lens bends what is under its edge. That
   bend is an SVG displacement filter driven by a map drawn to the
   element's exact size and corner radius: each pixel says how far, and
   which way, to look for the backdrop — strongest at the rim, nothing in
   the middle. Red, green and blue are bent by slightly different amounts,
   which leaves the faint colour fringe real glass has. Safari and Firefox
   cannot run an SVG filter as a backdrop filter, so they get the blur,
   the tint and the specular rim without the bend — still glass.

   Anything marked data-glass gets the bend; its value is the blur in px. */
var GLASS_BEND = !!navigator.userAgentData && !!(window.CSS && CSS.supports &&
  CSS.supports('backdrop-filter', 'url(#g)'));

function glassQuiet() {
  return window.matchMedia('(prefers-reduced-transparency: reduce)').matches;
}

function glassMap(w, h, r) {
  var c = document.createElement('canvas');
  c.width = w; c.height = h;
  var ctx = c.getContext('2d');
  var img = ctx.createImageData(w, h);
  var hw = w / 2, hh = h / 2;
  // Signed distance to a rounded rectangle: negative inside.
  function sdf(px, py) {
    var qx = Math.abs(px - hw) - (hw - r), qy = Math.abs(py - hh) - (hh - r);
    var ox = Math.max(qx, 0), oy = Math.max(qy, 0);
    return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r;
  }
  var rim = Math.min(20, hw, hh);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var px = x + 0.5, py = y + 0.5, i = (y * w + x) * 4;
      var depth = -sdf(px, py);
      var k = depth >= rim ? 0 : Math.pow(1 - Math.max(depth, 0) / rim, 2);
      var nx = 0, ny = 0;
      if (k) {
        nx = sdf(px + 1, py) - sdf(px - 1, py);
        ny = sdf(px, py + 1) - sdf(px, py - 1);
        var n = Math.sqrt(nx * nx + ny * ny) || 1;
        nx /= n; ny /= n;
      }
      // Look inward from the rim: the edge shows what is further in.
      img.data[i] = 128 - 127 * k * nx;
      img.data[i + 1] = 128 - 127 * k * ny;
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

function glassFilter(w, h, r) {
  var id = 'glass-' + w + 'x' + h + 'r' + r;
  if (document.getElementById(id)) return id;
  var host = document.getElementById('glassDefs');
  if (!host) {
    host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    host.id = 'glassDefs';
    host.setAttribute('aria-hidden', 'true');
    host.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
    document.body.appendChild(host);
  }
  // One filter per size, shared by every element of that size; a window
  // resized through many widths should not keep them all.
  if (host.childNodes.length > 40) host.innerHTML = '';
  var s = Math.round(Math.min(26, Math.min(w, h) * 0.45));
  function pass(scale, row, name) {
    return '<feDisplacementMap in="SourceGraphic" in2="map" scale="' + scale + '" xChannelSelector="R" yChannelSelector="G" result="d' + name + '"/>' +
      '<feColorMatrix in="d' + name + '" type="matrix" values="' + row + '" result="' + name + '"/>';
  }
  host.insertAdjacentHTML('beforeend',
    '<filter id="' + id + '" x="0" y="0" width="' + w + '" height="' + h + '" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">' +
      '<feImage href="' + glassMap(w, h, r) + '" x="0" y="0" width="' + w + '" height="' + h + '" preserveAspectRatio="none" result="map"/>' +
      pass(s, '1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0', 'r') +
      pass(s + 4, '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0', 'g') +
      pass(s + 8, '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0', 'b') +
      '<feBlend in="r" in2="g" mode="screen" result="rg"/>' +
      '<feBlend in="rg" in2="b" mode="screen"/>' +
    '</filter>');
  return id;
}

function glassBend(el, blur) {
  if (!el) return;
  if (!GLASS_BEND || glassQuiet()) { el.style.backdropFilter = ''; return; }
  var w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
  if (!w || !h) return;
  var r = Math.round(Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, w / 2, h / 2));
  el.style.backdropFilter = 'url(#' + glassFilter(w, h, r) + ') blur(' + blur + 'px) saturate(190%) brightness(1.08)';
  document.documentElement.classList.add('glass-bend');
}

function glassAll(root) {
  var els = (root || document).querySelectorAll('[data-glass]');
  for (var i = 0; i < els.length; i++) glassBend(els[i], Number(els[i].getAttribute('data-glass')) || 5);
}

/* The selected tab sits under a lens that slides between tabs, stretching
   as it travels and settling with a little give — the same move the iOS
   tab bar makes. `from` is where the lens was ({x, y, w, h}), or null to
   place it without moving. */
function slideLens(lens, from, to) {
  var end = 'translate(' + to.x + 'px,' + to.y + 'px)';
  lens.style.width = to.w + 'px';
  lens.style.height = to.h + 'px';
  lens.style.transform = end;
  lens.classList.add('is-placed');
  lens._pos = to;
  if (!from || (from.x === to.x && from.w === to.w) || !lens.animate ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var mx = (from.x + to.x) / 2, mw = (from.w + to.w) / 2, nudge = to.x > from.x ? 3 : -3;
  lens.animate([
    { transform: 'translate(' + from.x + 'px,' + from.y + 'px)', width: from.w + 'px' },
    { transform: 'translate(' + mx + 'px,' + to.y + 'px) scale(1.18,.88)', width: mw + 'px', offset: 0.45 },
    { transform: 'translate(' + (to.x + nudge) + 'px,' + to.y + 'px) scale(.97,1.03)', width: to.w + 'px', offset: 0.8 },
    { transform: end, width: to.w + 'px' }
  ], { duration: 480, easing: 'cubic-bezier(.3,.7,.25,1)' });
}

function lensPos(box) {
  var lens = box && box.querySelector('.tab-lens');
  return (lens && lens._pos) || null;
}

// Puts (or slides) a tab group's lens onto its .on tab. The lens is made
// here when the group's markup has none, so repainting a group's buttons
// needs no lens markup of its own.
function tabsLens(box, from) {
  if (!box) return;
  var lens = box.querySelector('.tab-lens');
  if (!lens) {
    lens = document.createElement('span');
    lens.className = 'tab-lens';
    lens.setAttribute('aria-hidden', 'true');
    box.insertBefore(lens, box.firstChild);
  }
  var on = box.querySelector('.on');
  if (!on) { lens.classList.remove('is-placed'); return; }
  slideLens(lens, from, { x: on.offsetLeft, y: on.offsetTop, w: on.offsetWidth, h: on.offsetHeight });
}

function placeLens(animate) {
  var nav = document.getElementById('appNav');
  var lens = nav && nav.querySelector('.nav-lens');
  if (!lens) return;
  var on = nav.querySelector('[data-nav].on');
  if (!on || nav.hidden || getComputedStyle(lens).display === 'none') { lens._pos = null; return; }
  slideLens(lens, animate ? lens._pos : null,
    { x: on.offsetLeft, y: on.offsetTop, w: on.offsetWidth, h: on.offsetHeight });
}

function measureNav() {
  var nav = document.getElementById('appNav');
  var shown = nav && !nav.hidden && getComputedStyle(nav).display !== 'none';
  var side = shown && getComputedStyle(nav).position === 'fixed' &&
    window.matchMedia('(min-width:861px)').matches;
  // Height when it is a bottom bar, width when it is a sidebar, zero for
  // both when it is not on screen at all — the sign-in screen has no nav,
  // and reserving the sidebar's width there left the page inset by 232px
  // with the hero unable to reach the left edge.
  // The capsule floats clear of the bottom edge, so what has to be kept
  // free is everything from its top down — not just its own height.
  var reserve = (shown && !side) ? Math.max(0, Math.round(window.innerHeight - nav.getBoundingClientRect().top)) : 0;
  document.documentElement.style.setProperty('--nav-h', reserve + 'px');
  document.documentElement.style.setProperty('--nav-w', (side ? nav.offsetWidth : 0) + 'px');
  if (shown && !side) { glassBend(nav, 5); placeLens(false); }
  else if (nav) nav.style.backdropFilter = '';
  glassAll();
}

function updateNav() {
  var nav = document.getElementById('appNav');
  if (!nav) return;

  var hash = location.hash || '#/';

  // The nav is the app's whole chrome now, so it only exists once there is
  // an app to navigate — the sign-in gate owns the screen on its own.
  nav.hidden = authPhase !== 'ready' || !currentUser;
  // On a phone a recipe tucks the capsule away (CSS, keyed off this class):
  // that page pins its own Start brewing bar where the capsule would sit,
  // and has a back button for the way out. The desktop sidebar stays.
  document.body.classList.toggle('on-recipe', hash.indexOf('#/r/') === 0);
  measureNav();

  var here = hash === '#/account' ? 'account'
    : hash === '#/library' ? 'library'
    : hash === '#/ranking' ? 'ranking'
    : hash.indexOf('#/r/') === 0 ? 'home'
    : 'home';
  var items = nav.querySelectorAll('[data-nav]');
  for (var i = 0; i < items.length; i++) {
    var on = items[i].getAttribute('data-nav') === here;
    items[i].classList.toggle('on', on);
    if (on) items[i].setAttribute('aria-current', 'page');
    else items[i].removeAttribute('aria-current');
  }
  placeLens(true);
}

function renderGate(title, message, footHTML) {
  view.innerHTML = '<div class="gate"><div class="gate-card">' +
    ICON.bean +
    '<h1>' + esc(title) + '</h1>' +
    '<p class="gate-msg">' + message + '</p>' +
    (footHTML || '') +
  '</div></div>';
}

function renderLoading() {
  view.innerHTML = '<div class="gate"><div class="gate-card loading-card">' + STEAM_SVG +
    '<h1>' + esc(t('Brewing your library…')) + '</h1></div></div>';
}
// Three wisps rising, used while the library loads.
var STEAM_SVG = '<svg class="steam" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M8 19c-2-3 2-5 0-8s2-5 0-7"/><path d="M12 20c-2-3 2-5 0-8s2-5 0-7"/><path d="M16 19c-2-3 2-5 0-8s2-5 0-7"/></svg>';

/* The one screen a first-time visitor sees, so it gets a picture and a
   reason rather than a bean and a button. Its own layout, not renderGate:
   loading and the connection error are momentary states that want to stay
   small and quiet, and dressing them up would be dressing up a failure. */
/* The sign-in screen: the app's own bag label — the bean, the name, a
   ruled grid of what is inside — over the pitch and Google's button.
   It follows the device's light or dark setting, not the saved
   appearance, which belongs to an account that is not signed in yet. */
function renderSignIn() {
  applyTheme(true);
  function fact(k, v) {
    return '<span class="ll-fact"><span class="k">' + esc(t(k)) + '</span><span class="v">' + esc(t(v)) + '</span></span>';
  }
  view.innerHTML = '<div class="gate-screen login">' +
    '<div class="login-hero">' +
      '<div class="login-label" aria-hidden="true">' +
        '<span class="bl-valve"><i></i></span>' +
        '<svg class="login-bean" viewBox="0 0 24 24">' + BREWER_SVG.bean + '</svg>' +
        '<span class="ll-kicker">' + esc(t('Your coffee · every device')) + '</span>' +
        '<span class="ll-name">Brew Library</span>' +
        '<span class="ll-grid">' +
          fact('Contents', 'Recipes') + fact('Pours', 'Timed') + fact('Dose', 'Scales') + fact('Sync', 'Live') +
        '</span>' +
      '</div>' +
    '</div>' +
    '<div class="login-sheet">' +
      '<h1>' + esc(t('Every recipe you have dialled in, on every device.')) + '</h1>' +
      '<p class="gate-lede">' + esc(t('Sign in to open your library — pour schedules scale themselves to whatever dose you brew today.')) + '</p>' +
      '<button class="btn btn-google" data-action="sign-in">' + GOOGLE_G_ICON +
        '<span>' + esc(t('Continue with Google')) + '</span></button>' +
      '<p class="gate-foot">' + esc(t('Open to anyone with a Google account. Your recipes are never shared between accounts.')) + '</p>' +
    '</div>' +
  '</div>';
}

function renderFirebaseError() {
  renderGate(t('Can’t connect'), 'The sync service didn’t load — check your connection and reload the page.', '');
}

function render() {
  updateNav();

  if (authPhase === 'loading') { renderLoading(); return; }
  if (authPhase === 'signedOut') { renderSignIn(); return; }
  // Signed in: back to the account's own appearance.
  applyTheme();
  if (authPhase === 'error') { renderFirebaseError(); return; }

  var hash = location.hash || '#/';
  var m = hash.match(/^#\/r\/(.+)$/);
  if (!m) doseView = { id: null, dose: null };
  if (m) renderDetail(decodeURIComponent(m[1]));
  else if (hash === '#/account') renderAccount();
  else if (hash === '#/library') renderLibrary();
  else if (hash === '#/ranking') renderRanking();
  else renderHome(true);
  closeMenu();
}

/* ---- home ---- */

// Cupform v3.1's Combobox: "Select for a list that outgrew a list. Typing
// filters the options; the field still resolves to exactly one value."
// One generic builder covers all five entity filters — coffee, roaster,
// grinder, method, style — since they all resolve a recipe field to one
// picked id the same way; only how a recipe is matched to an option
// differs (recipes carry a roasterId only indirectly, via their coffee).
function comboLabel(type) {
  return t('All ' + (type === 'roaster' ? 'roasters' : ENTITIES[type].plural.toLowerCase()));
}
function comboMatch(type, r, id) {
  return type === 'roaster' ? roasterIdOf(r) === id : r[ENTITIES[type].ref] === id;
}
function comboOptions(type) {
  var list = coll(type).slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
  var out = [{ id: '', name: comboLabel(type), count: state.recipes.length }];
  // Everything is listed, including entries nothing is filed under yet.
  // Hiding those made sense on the chip rail this replaced, where space was
  // the constraint — but in a list you search, a style you just added
  // simply being absent reads as the search being broken.
  list.forEach(function (e) {
    var n = state.recipes.filter(function (r) { return comboMatch(type, r, e.id); }).length;
    out.push({ id: e.id, name: e.name, count: n });
  });
  return out;
}

function comboListHTML(type) {
  var term = comboQuery.trim().toLowerCase();
  var opts = comboOptions(type);
  var shown = term ? opts.filter(function (o) { return o.name.toLowerCase().indexOf(term) !== -1; }) : opts;
  var html = '<div class="combo-list" role="listbox" aria-label="' + esc(t(ENTITIES[type].label)) + '">';
  if (!shown.length) {
    html += '<div class="combo-empty">' + esc(t('Nothing matches') + ' “' + comboQuery.trim() + '”') + '</div>';
  } else {
    shown.forEach(function (o) {
      var on = (filterTarget[type] || '') === o.id;
      html += '<div class="combo-opt' + (on ? ' on' : '') + (o.id && !o.count ? ' is-empty' : '') + '" role="option" aria-selected="' + on +
        '" data-action="combo-pick" data-type="' + type + '" data-id="' + esc(o.id) + '">' +
        '<span class="combo-opt-label">' + esc(o.name) + '</span>' +
        (o.id ? '<span class="combo-opt-meta">' + o.count + '</span>' : '') +
        (on ? ICON.check : '') +
      '</div>';
    });
  }
  return html + '</div>';
}

function comboHTML(type) {
  var isOpen = openCombo === type;
  var current = filterTarget[type] ? findIn(type, filterTarget[type]) : null;
  var shown = isOpen ? comboQuery : (current ? current.name : '');
  return '<div class="combo' + (filterTarget[type] ? ' on' : '') + '">' +
    '<div class="combo-field' + (isOpen ? ' open' : '') + '">' +
      ICON[COMBO_ICON[type]] +
      '<input id="f-combo-' + type + '" class="combo-input" role="combobox" aria-haspopup="listbox" ' +
        'aria-expanded="' + isOpen + '" aria-label="' + esc(t('Filter by ' + ENTITIES[type].label.toLowerCase())) + '" autocomplete="off" ' +
        'placeholder="' + esc(comboLabel(type)) + '" value="' + esc(shown) + '" />' +
      (isOpen && comboQuery ? '<button class="combo-clear" data-action="combo-clear" aria-label="' + esc(t('Clear search')) + '">' +
        ICON.close + '</button>' : '') +
      '<button class="combo-toggle" data-action="combo-toggle" data-type="' + type + '" aria-label="' +
        esc(t('Show all ' + ENTITIES[type].plural.toLowerCase())) + '">' + ICON.chevDown + '</button>' +
    '</div>' +
    (isOpen ? comboListHTML(type) : '') +
  '</div>';
}

/* The last recipe you opened, for the home screen to hand back.

   Deliberately local rather than part of the synced library: this is one
   write every time any recipe is opened, where the library is otherwise
   written only when something actually changes. Pushing that to Firestore
   would turn ordinary browsing into a stream of writes for a fact that is
   really about this device — what you had open on this phone, not what
   the library knows. Only ever one entry; the previous one is replaced. */
var SEEN_KEY = 'brewLastSeen';

function markSeen(id) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify({ id: id, at: Date.now() })); }
  catch (e) { /* private mode — the card just won't appear */ }
}

function lastSeen() {
  var raw;
  try { raw = localStorage.getItem(SEEN_KEY); } catch (e) { return null; }
  if (!raw) return null;
  var v;
  try { v = JSON.parse(raw); } catch (e) { return null; }
  if (!v || !v.id) return null;
  // The recipe may have been deleted, or belong to an account that has
  // since signed out on this device.
  var r = recipeById(v.id);
  return r ? { recipe: r, at: v.at } : null;
}

// Coarse on purpose: "3 days ago" is what you want to know here, not a
// timestamp. Anything past a fortnight stops counting and gives a date.
function agoLabel(ms) {
  var mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 2) return t('just now');
  if (mins < 60) return mins + ' ' + t('min ago');
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + ' ' + t(hrs === 1 ? 'hour ago' : 'hours ago');
  var days = Math.floor(hrs / 24);
  if (days === 1) return t('yesterday');
  if (days < 15) return days + ' ' + t('days ago');
  return new Date(ms).toLocaleDateString(locale());
}

function greetingKey() {
  var h = new Date().getHours();
  if (h < 12) return 'Morning';
  if (h < 18) return 'Afternoon';
  return 'Evening';
}


/* The methods you actually brew with, most-used first — a shortcut past
   the full combo below.



/* Repaints whichever surface owns the comboboxes right now. */
/* Which view was last painted. Entrance animations are gated on this:
   arriving at home should animate, but renderHome() also runs on every
   search keystroke and every filter change, and replaying the whole page
   under the caret each time you type is unusable. */
function repaintFilters() {
  if (filterTarget === filters) renderHome();
  else renderModals();
}

/* ---- filters page ----
   Was an inline group that expanded under the search bar and applied
   every change to the list as you made it. As a page it commits instead:
   changes land in a draft, the button counts what they would leave you
   with, and nothing reaches the list until Apply. Search is not part of
   it — typing a query is inherently live, and it stays on the home bar. */
function openFilters() {
  var m = {
    draft: {
      q: filters.q,
      coffee: filters.coffee, roaster: filters.roaster, grinder: filters.grinder,
      method: filters.method, style: filters.style,
      fav: filters.fav, sort: filters.sort, kind: filters.kind
    },
    onClose: function () { filterTarget = filters; openCombo = null; comboQuery = ''; },
    render: function () {
      filterTarget = m.draft;
      var n = visibleRecipes(m.draft).length;
      var touched = m.draft.coffee || m.draft.roaster || m.draft.grinder ||
        m.draft.method || m.draft.style || m.draft.fav || m.draft.sort !== 'new';

      var body =
        '<div class="filter-page">' +
          '<button class="pill-toggle' + (m.draft.fav ? ' on' : '') + '" data-action="filters-toggle-fav">' +
            ICON.star + esc(t('Favourites only')) + '</button>' +
          '<div class="field"><label>' + esc(t('Coffee')) + '</label>' + comboHTML('coffee') + '</div>' +
          '<div class="field"><label>' + esc(t('Roaster')) + '</label>' + comboHTML('roaster') + '</div>' +
          '<div class="field"><label>' + esc(t('Grinder')) + '</label>' + comboHTML('grinder') + '</div>' +
          '<div class="field"><label>' + esc(t('Brewing method')) + '</label>' + comboHTML('method') + '</div>' +
          '<div class="field"><label>' + esc(t('Recipe style')) + '</label>' + comboHTML('style') + '</div>' +
          '<div class="field"><label for="f-sort">' + esc(t('Sort')) + '</label>' +
            '<select class="inp" id="f-sort" data-filter="sort">' +
              '<option value="new"' + (m.draft.sort === 'new' ? ' selected' : '') + '>' + esc(t('Newest first')) + '</option>' +
              '<option value="old"' + (m.draft.sort === 'old' ? ' selected' : '') + '>' + esc(t('Oldest first')) + '</option>' +
              '<option value="rating"' + (m.draft.sort === 'rating' ? ' selected' : '') + '>' + esc(t('Top rated')) + '</option>' +
              '<option value="coffee"' + (m.draft.sort === 'coffee' ? ' selected' : '') + '>' + esc(t('A–Z')) + '</option>' +
            '</select></div>' +
        '</div>';

      var foot =
        (touched ? '<button class="btn btn-quiet filters-clear" data-action="filters-clear-draft">' +
          esc(t('Clear')) + '</button>' : '') +
        '<button class="btn btn-ghost" data-action="close-modal">' + esc(t('Cancel')) + '</button>' +
        '<button class="btn btn-primary" data-action="filters-apply"' + (n ? '' : ' disabled') + '>' +
          esc(n ? t('Show') + ' ' + n + ' ' + tPlural(n, 'recipe', 'recipes') : t('No matches')) +
        '</button>';

      return sheet({ title: t('Filters'), body: body, foot: foot, narrow: true });
    }
  };
  openModal(m);
}

/* ---- home (F4) ----
   A header, the method-type tabs, a carousel that opens on the recipe you
   were last looking at, the search pill, and every recipe as a row. */

/* One tab per brewer — V60, Origami, Espresso… — most used first, so the
   tabs follow the library rather than a fixed list. Methods that only
   differ by a detail after a dash or in brackets ("Espresso — DEX
   basket", "Espresso — 3Bomber (18g basket)") share their brewer's tab. */
function brewerOf(r) {
  var me = findIn('method', r.methodId);
  return me ? me.name.split(/\s+[—–-]\s+|\s*\(/)[0].trim() : '';
}

function kindTabsHTML() {
  var counts = {}, firstMethod = {};
  state.recipes.forEach(function (r) {
    var b = brewerOf(r);
    if (b) {
      counts[b] = (counts[b] || 0) + 1;
      if (!firstMethod[b]) firstMethod[b] = findIn('method', r.methodId);
    }
  });
  var names = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
  if (names.length < 2) return '';
  function tab(value, label) {
    var on = (filters.kind || '') === value;
    return '<button type="button" role="tab" aria-selected="' + on + '" class="ktab' + (on ? ' on' : '') +
      '" data-action="pick-kind" data-kind="' + esc(value) + '">' +
      (value ? brewerIcon(firstMethod[value]) : '') + '<span>' + esc(label) + '</span></button>';
  }
  return '<div class="ktabs-glass glass" data-glass="5"><div class="ktabs" role="tablist" aria-label="' + esc(t('Method')) + '">' +
    tab('', t('All')) + names.map(function (n) { return tab(n, n); }).join('') + '</div></div>';
}

function monogram(r) {
  var me = findIn('method', r.methodId);
  var letters = ((me && me.name) || titleOf(r)).replace(/[^A-Za-zÀ-ÿ0-9]/g, '');
  return letters.slice(0, 2).toUpperCase() || '·';
}

function slideHTML(r, kind) {
  var grind = grindText(r);
  var roaster = roasterOf(r);
  var style = nameOf('style', r.styleId);
  var plan = timerPlan(r);
  var hasWater = r.water !== '' && r.water != null;
  return '<div class="slide">' +
    '<a class="slide-link" href="#/r/' + encodeURIComponent(r.id) + '" aria-label="' + esc(t('Open') + ' ' + titleOf(r)) + '"></a>' +
    '<div class="slide-body">' +
      '<div class="slide-top">' +
        '<span class="slide-chip' + (kind === 'continue' ? ' is-continue' : '') + '">' +
          esc(t(kind === 'continue' ? 'Continue' : 'Recent')) + '</span>' +
        '<span class="slide-method">' + brewerIcon(findIn('method', r.methodId)) + '<span>' + esc(nameOf('method', r.methodId)) + '</span></span>' +
      '</div>' +
      '<div class="slide-name">' +
        '<span class="nm">' + esc(titleOf(r)) + '</span>' +
        '<span class="mt">' + esc([roaster, style].filter(Boolean).join(' · ')) + '</span>' +
      '</div>' +
      '<div class="slide-foot">' +
        '<div class="slide-stats">' +
        '<div class="slide-nums">' +
          '<span><b>' + num(r.dose) + 'g</b><i>' + esc(t('coffee')) + '</i></span>' +
          (hasWater
            ? '<span><b>' + num(r.water) + 'g</b><i>' + esc(t('water')) + '</i></span>'
            : (r.brewTime ? '<span><b>' + esc(String(r.brewTime).replace('~', '')) + '</b><i>' + esc(t('shot')) + '</i></span>' : '')) +
        '</div>' +
        (grind ? '<div class="slide-grind">' + ICON.grinder + '<span>' + esc(grind) + '</span></div>' : '') +
        '</div>' +
        (plan
          ? '<button type="button" class="slide-brew" data-action="timer" data-id="' + esc(r.id) + '" aria-label="' +
              esc(t('Brew') + ' ' + titleOf(r)) + '">' + ICON.play + '</button>'
          : '<span class="slide-open" aria-hidden="true">' + ICON.chevRight + '</span>') +
      '</div>' +
    '</div>' +
  '</div>';
}

/* Opens on the recipe you last looked at, then the newest additions. */
function carouselHTML() {
  var seen = lastSeen();
  var first = seen ? seen.recipe : null;
  var recent = state.recipes.slice()
    .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); })
    .filter(function (r) { return !first || r.id !== first.id; })
    .slice(0, first ? 4 : 5);
  var slides = (first ? [slideHTML(first, 'continue')] : [])
    .concat(recent.map(function (r) { return slideHTML(r, 'recent'); }));
  if (!slides.length) return '';
  var dots = '';
  for (var i = 0; i < slides.length; i++) dots += '<span class="dot' + (i === 0 ? ' on' : '') + '"></span>';
  return '<div class="carousel" id="homeCarousel">' + slides.join('') + '</div>' +
    (slides.length > 1 ? '<div class="carousel-dots" aria-hidden="true">' + dots + '</div>' : '');
}

// The grinder and its setting in one line: "KINGrinder · 1 turn + 55 clicks".
function grindText(r) {
  var gr = findIn('grinder', r.grinderId);
  return [gr ? gr.name : '', r.grindSize || ''].filter(Boolean).join(' · ');
}

/* Every recipe as a card: name and where it comes from on top, then a
   strip of the three numbers you set before brewing — coffee, water (or
   the shot time) and the grind, under the grinder's name. */
function homeRowHTML(r) {
  var roaster = roasterOf(r);
  var gr = findIn('grinder', r.grinderId);
  function cell(v, k, text) {
    return '<span class="hc-cell"><span class="v' + (text ? ' is-text' : '') + '">' + v + '</span>' +
      '<span class="k">' + esc(k) + '</span></span>';
  }
  var cells = '';
  if (r.dose !== '' && r.dose != null) cells += cell(num(r.dose) + 'g', t('Coffee'));
  if (r.water !== '' && r.water != null) cells += cell(num(r.water) + 'g', t('Water'));
  else if (r.brewTime) cells += cell(esc(String(r.brewTime).replace('~', '')), t('Shot'));
  if (r.grindSize) cells += cell(esc(r.grindSize), gr ? gr.name : t('Grind'), true);
  return '<a class="hcard" href="#/r/' + encodeURIComponent(r.id) + '">' +
    '<span class="hc-top">' +
      '<span class="hc-ico">' + brewerIcon(findIn('method', r.methodId)) + '</span>' +
      '<span class="hc-txt"><span class="nm">' + esc(titleOf(r)) + '</span>' +
        '<span class="mt">' + esc([nameOf('method', r.methodId), roaster].filter(Boolean).join(' · ')) + '</span></span>' +
      (r.fav ? '<span class="hc-side"><span class="hc-fav" aria-label="' + esc(t('Favourite')) + '">' + iconStar(true) + '</span></span>' : '') +
    '</span>' +
    (cells ? '<span class="hc-strip">' + cells + '</span>' : '') +
  '</a>';
}

function renderHome(entering) {
  // Only the router passes this. Every other caller — a keystroke in the
  // search field, a tab, applying filters — repaints without replaying
  // the page's entrance under the caret.
  view.classList.toggle('view-enter', entering === true);
  var list = visibleRecipes();
  var total = state.recipes.length;
  // The carousel is for picking up where you were; while you are hunting
  // for something else it only pushes the results down.
  var hunting = filtersActive();

  var name = (currentUser && currentUser.displayName || '').split(' ')[0];
  var photo = currentUser && currentUser.photoURL;
  var letter = (name || (currentUser && currentUser.email) || '?').trim().charAt(0).toUpperCase();

  var html = '<div class="home">' +
    '<header class="home-head">' +
      '<div class="home-title">' +
        '<span class="home-day">' + esc(new Date().toLocaleDateString(locale(),
          { weekday: 'long', day: 'numeric', month: 'long' })) + '</span>' +
        '<h1><svg class="brand-mark home-bean" viewBox="0 0 24 24" aria-hidden="true">' +
          '<g transform="rotate(-28 12 12)"><ellipse cx="12" cy="12" rx="6.4" ry="9.4"/>' +
          '<path d="M12 4.4c-2 2.5-2 5 0 7.6s2 5.1 0 7.6"/></g></svg>' +
          '<span>' + esc(t('Brew Library')) + '</span></h1>' +
      '</div>' +
      '<a class="home-av" href="#/account" aria-label="' + esc(t('Account')) + '">' +
        (photo ? '<img src="' + esc(photo) + '" alt="" />' : '<span>' + esc(letter) + '</span>') +
      '</a>' +
    '</header>' +
    kindTabsHTML() +
    (hunting ? '' : carouselHTML());

  var moreCount = moreFiltersCount() + (filters.fav ? 1 : 0);
  html += '<div class="home-search">' +
      '<label class="search-pill">' + ICON.search +
        '<input id="q" type="search" placeholder="' + esc(t('Search') + ' ' + total + ' ' + tPlural(total, 'recipe', 'recipes')) +
          '" value="' + esc(filters.q) + '" aria-label="' + esc(t('Search recipes')) + '" />' +
      '</label>' +
      '<button type="button" class="search-filter' + (moreCount ? ' on' : '') + '" data-action="filters-open" aria-label="' +
        esc(t('Filters')) + (moreCount ? ' (' + moreCount + ')' : '') + '">' + ICON.sliders +
        (moreCount ? '<span class="search-badge">' + moreCount + '</span>' : '') +
      '</button>' +
    '</div>';

  html += '<div class="home-sec">' +
      '<span class="home-sec-t">' + esc(t(hunting || filters.kind ? 'Matching recipes' : 'All recipes')) + '</span>' +
      (hunting || filters.kind
        ? '<button type="button" class="home-sec-a" data-action="clear-filters">' + esc(t('Clear')) + ' · ' + list.length + '/' + total + '</button>'
        : '<span class="home-sec-n">' + total + '</span>') +
    '</div>';

  if (!list.length) {
    html += '<div class="empty">' + ICON.cup +
      '<h3>' + esc(t(total ? 'Nothing matches those filters' : 'No recipes yet')) + '</h3>' +
      '<p>' + esc(t(total
        ? 'Try clearing a filter or two to see the rest of your library.'
        : 'Add your first brew — coffee, grinder, method, recipe style and the pour schedule.')) + '</p>' +
      (total
        ? '<button class="btn btn-ghost" data-action="clear-filters">' + esc(t('Clear filters')) + '</button>'
        : '<button class="btn btn-primary" data-action="new-recipe">' + ICON.plus + esc(t('Add recipe')) + '</button>') +
      '</div>';
  } else {
    html += '<div class="hrows hcards">' + list.map(homeRowHTML).join('') + '</div>';
  }

  view.innerHTML = html + '</div>';
  tabsLens(view.querySelector('.ktabs'));
  glassAll(view);
}



/* ---- detail ---- */

function timelineHTML(steps) {
  var running = 0;
  return steps.map(function (s) {
    var w = Number(s.water) || 0;
    running += w;
    return '<li class="step">' +
      '<span class="bullet"></span>' +
      '<div class="t">' + esc(s.t || '') + '</div>' +
      '<div class="body"><p>' + esc(t(s.label || '')) + '</p>' +
        (w ? '<div class="w">+' + w + ' g · ' + running + ' g total</div>' : '') +
      '</div></li>';
  }).join('');
}

// Explains why a formula-owned style is showing no pour schedule. Takes either
// a saved recipe or a form draft — both carry styleId/methodId.
function noStepsMessage(r) {
  if (r.styleId === 'st-espresso') {
    return t('Espresso is dialled in by dose, grind and shot time rather than a pour schedule — the numbers above are the recipe.');
  }
  var me = findIn('method', r.methodId);
  return (me ? me.name : t('This method')) + ' ' + t('doesn’t use a pour schedule — nothing to show here.');
}

// Caption under a style-derived schedule. The Hoffmann bloom is 2x the dose, so
// when no dose is recorded the schedule falls back to 15 g — say so rather than
// quietly showing numbers the recipe's own Dose tile doesn't support.
function stepsCaption(r) {
  var styleName = nameOf('style', r.styleId);
  // Every formula (Hoffmann, Tetsu) is scaled purely off the water amount —
  // if none is recorded, say so rather than quietly assuming one.
  if (!Number(r.water)) {
    var assumedDose = Number(r.dose) || 15;
    return 'Follows the ' + styleName + ' formula. No water recorded, so it assumes ' +
      (assumedDose * 16) + ' g (1:16 at ' + assumedDose + ' g dose) — set a water amount to make it exact.';
  }
  return 'Follows the ' + styleName + ' formula, scaled to this dose and water.';
}

// Steps a user-authored style defines for itself, via the style form's step
// builder. Built-in formula styles compute theirs instead and never store any.
function styleSteps(styleId) {
  var st = findIn('style', styleId);
  if (!st || !st.steps) return [];
  return st.steps.filter(function (s) { return s.t || s.label; });
}

// True when the style itself owns the schedule — either a built-in formula or
// hand-built steps. Recipes on such a style don't store steps of their own.
function styleProvidesSteps(styleId) {
  return hasFormula(styleId) || styleSteps(styleId).length > 0;
}

// Pouring steps follow the recipe *style*, in priority order: a built-in
// formula (scaled live to this recipe's dose/water/method), then steps the
// style defines itself. Recipes created before styles could carry their own
// steps fall back to the ones stored on the recipe, so nothing already saved
// loses its schedule.
function effectiveSteps(r) {
  if (hasFormula(r.styleId)) {
    var me = findIn('method', r.methodId);
    return preset(r.styleId, r.dose, r.water, me ? me.name : '');
  }
  var own = styleSteps(r.styleId);
  if (own.length) return own;
  return (r.steps || []).filter(function (s) { return s.label || s.water || s.t; });
}

/* One stat tile, or nothing at all. An espresso recipe has no water, ratio,
   temperature or time, and rendering those as em-dashes made the four
   emptiest fields the loudest marks on a page whose whole job is to hand
   over the parameters. num() yields an em-dash for a blank value, so that
   is what "empty" means here. */
function bigstat(label, value, unit, style) {
  var v = String(value == null ? '' : value);
  if (!v || v === '—') return '';
  return '<div class="bigstat"><div class="k">' + esc(label) + '</div>' +
    '<div class="v"' + (style ? ' style="' + style + '"' : '') + '>' + v +
    (unit ? '<small>' + esc(unit) + '</small>' : '') + '</div></div>';
}

/* ---- ranking ----
   Which bags, recipes and roasters were actually worth it. Scores live on
   recipes (one cup score each). A coffee's standing pools the scores of
   its recipes, a recipe style's (James Hoffmann V60, Lance Hedrick…)
   pools every brew made with it, and a roaster's pools every recipe of
   every coffee it roasted.

   Only scored recipes count. An unrated recipe is not a zero — it is a
   brew you never got round to judging.

   Pooled scores are weighted by how many ratings stand behind them, so a
   single 5 cannot outrank a long run of 5s and 4s. Each pool is ranked by
   a Bayesian average: its ratings plus RANK_PRIOR imaginary ratings at
   the library's own average.

     score = (sum of ratings + RANK_PRIOR × library average) / (ratings + RANK_PRIOR)

   With few ratings the score leans toward the library's average; as
   ratings pile up it converges on the plain average, which is shown
   beside it. */
var RANK_PRIOR = 2;
var rankTab = 'coffee';

function rankStats() {
  var rated = state.recipes.filter(function (r) { return (r.rating || 0) > 0; });
  var sum = rated.reduce(function (n, r) { return n + r.rating; }, 0);
  return { rated: rated, mean: rated.length ? sum / rated.length : 0 };
}

function rankEntries(kind) {
  var st = rankStats();
  var pools = {};
  st.rated.forEach(function (r) {
    var key = kind === 'roaster' ? roasterIdOf(r) : kind === 'recipe' ? r.styleId : r.coffeeId;
    if (!key) return;
    var p = pools[key] || (pools[key] = { key: key, sum: 0, n: 0, coffees: {}, methods: {} });
    p.sum += r.rating; p.n++; p.coffees[r.coffeeId] = true;
    if (r.methodId) p.methods[r.methodId] = (p.methods[r.methodId] || 0) + 1;
  });
  return Object.keys(pools).map(function (key) {
    var p = pools[key], e = { n: p.n, avg: p.sum / p.n,
      score: (p.sum + RANK_PRIOR * st.mean) / (p.n + RANK_PRIOR) };
    if (kind === 'recipe') {
      // A recipe style — James Hoffmann V60, Lance Hedrick… — across every
      // coffee brewed with it, drawn with the brewer it is used on most.
      var sty = findIn('style', key);
      var mids = Object.keys(p.methods).sort(function (a, b) { return p.methods[b] - p.methods[a]; });
      var ncs = Object.keys(p.coffees).length;
      e.name = sty ? sty.name : '—';
      e.icon = brewerIcon(findIn('method', mids[0]));
      e.sub = [sty && sty.author && sty.name.indexOf(sty.author) < 0 ? sty.author : '',
        ncs + ' ' + tPlural(ncs, 'coffee', 'coffees')].filter(Boolean).join(' · ');
    } else if (kind === 'roaster') {
      var ro = findIn('roaster', key);
      var nc = Object.keys(p.coffees).length;
      e.name = ro ? ro.name : '—';
      e.sub = nc + ' ' + tPlural(nc, 'coffee', 'coffees');
    } else {
      var c = findIn('coffee', key);
      e.name = c ? c.name : '—';
      e.sub = roasterNameOf(c);
    }
    return e;
  }).filter(function (e) { return e.name !== '—'; }).sort(function (a, b) {
    return b.score - a.score || b.n - a.n || a.name.localeCompare(b.name);
  });
}

function rankRowHTML(e, i, kind) {
  var pooled = true;
  var inner =
    '<span class="rk-no' + (i < 3 ? ' is-top' : '') + '">' + (i + 1) + '</span>' +
    (e.icon ? '<span class="rk-ico">' + e.icon + '</span>' : '') +
    '<span class="rk-txt"><span class="nm">' + esc(e.name) + '</span>' +
      '<span class="mt">' + esc([e.sub, pooled ? e.n + ' ' + tPlural(e.n, 'rating', 'ratings') : ''].filter(Boolean).join(' · ')) + '</span>' +
      '<span class="rk-bar" aria-hidden="true"><i style="width:' + (e.score / 5 * 100).toFixed(1) + '%"></i></span>' +
    '</span>' +
    '<span class="rk-score"><span class="v">' + e.score.toFixed(1) + '</span>' +
      (pooled && Math.abs(e.avg - e.score) >= 0.05
        ? '<span class="k">' + esc(t('avg')) + ' ' + e.avg.toFixed(1) + '</span>'
        : (pooled ? '' : '<span class="k">' + stars(e.score) + '</span>')) +
    '</span>';
  return e.href
    ? '<a class="rk-row" href="' + e.href + '">' + inner + '</a>'
    : '<div class="rk-row">' + inner + '</div>';
}

// The top-scored recipe, ready to brew again.
function rankHeroHTML() {
  var best = rankStats().rated.slice().sort(function (a, b) {
    return b.rating - a.rating || (b.createdAt || 0) - (a.createdAt || 0);
  })[0];
  if (!best) return '';
  var me = findIn('method', best.methodId), st = findIn('style', best.styleId);
  var hasWater = best.water !== '' && best.water != null;
  return '<section class="rk-hero">' +
    '<div class="rk-hero-top"><span class="rk-hero-k">' + esc(t('Your best cup')) + '</span>' + stars(best.rating) + '</div>' +
    '<a class="rk-hero-nm" href="#/r/' + encodeURIComponent(best.id) + '">' + esc(titleOf(best)) + '</a>' +
    '<span class="rk-hero-mt">' + esc([me ? me.name : '', st ? st.name : '', roasterOf(best)].filter(Boolean).join(' · ')) + '</span>' +
    '<div class="rk-hero-foot">' +
      '<span class="rk-hero-nums">' +
        '<span><b>' + num(best.dose) + 'g</b><i>' + esc(t('coffee')) + '</i></span>' +
        (hasWater ? '<span><b>' + num(best.water) + 'g</b><i>' + esc(t('water')) + '</i></span>' : '') +
      '</span>' +
      (timerPlan(best)
        ? '<button type="button" class="rk-again" data-action="timer" data-id="' + esc(best.id) + '">' + ICON.play + '<span>' + esc(t('Brew again')) + '</span></button>'
        : '') +
    '</div>' +
  '</section>';
}

// Unscored recipes, the one you last opened first, each with beans to
// score it on the spot.
function rankWaitingHTML() {
  var seen = lastSeen();
  var first = seen && seen.recipe && !(seen.recipe.rating > 0) ? seen.recipe : null;
  var rest = state.recipes.filter(function (r) { return !(r.rating > 0) && (!first || r.id !== first.id); })
    .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  var list = (first ? [first] : []).concat(rest).slice(0, 6);
  if (!list.length) return '';
  return '<div class="home-sec"><span class="home-sec-t">' + esc(t('Waiting for a score')) + '</span></div>' +
    '<div class="rk-wait">' + list.map(function (r) {
      return '<div class="rk-wcard">' +
        '<a class="nm" href="#/r/' + encodeURIComponent(r.id) + '">' + esc(titleOf(r)) + '</a>' +
        '<span class="mt">' + esc(nameOf('method', r.methodId)) + '</span>' +
        '<div class="rate">' + [1, 2, 3, 4, 5].map(function (n) {
          return '<button type="button" data-action="rate-recipe" data-id="' + esc(r.id) + '" data-v="' + n + '" ' +
            'aria-label="' + esc(t('Rate') + ' ' + titleOf(r) + ' ' + n) + '">' + iconBean(false) + '</button>';
        }).join('') + '</div>' +
      '</div>';
    }).join('') + '</div>';
}

function renderRanking(keepScroll) {
  view.classList.remove('view-enter');
  var tabs = [['coffee', t('Coffees')], ['recipe', t('Recipes')], ['roaster', t('Roasters')]];
  var entries = rankEntries(rankTab);

  var html = '<div class="ranking rk">' +
    '<div class="ranking-head"><h1>' + esc(t('Best in the cup')) + '</h1></div>' +
    rankHeroHTML() +
    '<div class="segs rk-tabs" role="tablist" aria-label="' + esc(t('Rank by')) + '">' +
      tabs.map(function (tb) {
        var on = tb[0] === rankTab;
        return '<button type="button" role="tab" aria-selected="' + on + '" class="seg' + (on ? ' on' : '') + '" ' +
          'data-action="rank-tab" data-tab="' + tb[0] + '">' + esc(tb[1]) + '</button>';
      }).join('') +
    '</div>';

  if (!entries.length) {
    html += '<div class="empty rank-empty">' + ICON.cup +
      '<h3>' + esc(t('Nothing scored yet')) + '</h3>' +
      '<p>' + esc(t('Give a brew a cup score and it joins the ranking. Two or three is enough to see which bags are worth buying again.')) + '</p></div>';
  } else {
    html += '<div class="rk-list">' + entries.map(function (e, i) { return rankRowHTML(e, i, rankTab); }).join('') + '</div>';
    html += '<p class="rk-note">' + esc(t('Scores are weighted by how many ratings stand behind them; the plain average shows when it differs.')) + '</p>';
  }
  html += rankWaitingHTML();

  view.innerHTML = html + '</div>';
  tabsLens(view.querySelector('.rk-tabs'));
  if (!keepScroll) window.scrollTo(0, 0);
}

/* ---- account ----
   Everything that used to hang off the topbar's overflow menu: identity,
   language, the export/import backup hatch, and the two destructive verbs.
   A page rather than a dropdown, because the nav gives it a home now and a
   menu anchored to a bar that no longer exists had nowhere to hang. */
function renderAccount() {
  view.classList.remove('view-enter');
  var name = (currentUser && (currentUser.displayName || '')) || '';
  var email = (currentUser && currentUser.email) || '';
  var initial = (name || email || '?').trim().charAt(0).toUpperCase();
  var photo = currentUser && currentUser.photoURL;

  function langBtn(code, label) {
    return '<button class="seg' + (langChoice === code ? ' on' : '') + '" ' +
      'data-action="set-lang" data-lang="' + code + '">' + esc(label) + '</button>';
  }
  function themeBtn(code, label) {
    return '<button class="seg' + (themeChoice === code ? ' on' : '') + '" ' +
      'data-action="set-theme" data-theme-choice="' + code + '">' + esc(label) + '</button>';
  }
  function row(action, icon, label, meta, danger) {
    return '<button class="acc-row' + (danger ? ' danger' : '') + '" data-action="' + action + '">' +
      icon + '<span class="grow">' + esc(label) + '</span>' +
      (meta ? '<span class="acc-meta">' + esc(meta) + '</span>' : '') + '</button>';
  }

  view.innerHTML = '<div class="account">' +
    '<div class="ranking-head account-head"><h1>' + esc(t('Account')) + '</h1></div>' +
    '<div class="acc-card">' +
      (photo
        ? '<img class="acc-av" src="' + esc(photo) + '" alt="" />'
        : '<div class="acc-av acc-av-letter">' + esc(initial) + '</div>') +
      '<div class="acc-id">' +
        (name ? '<span class="acc-name">' + esc(name) + '</span>' : '') +
        '<span class="acc-email">' + esc(email) + '</span>' +
      '</div>' +
    '</div>' +

    '<div class="acc-group">' +
      '<div class="section-title">' + esc(t('Language')) + '</div>' +
      '<div class="segs">' +
        langBtn('auto', t('Device')) + langBtn('en', 'English') + langBtn('pt', 'Português') +
      '</div>' +
    '</div>' +

    '<div class="acc-group">' +
      '<div class="section-title">' + esc(t('Appearance')) + '</div>' +
      '<div class="segs">' +
        themeBtn('auto', t('Device')) + themeBtn('dark', t('Dark')) + themeBtn('light', t('Light')) +
      '</div>' +
    '</div>' +

    '<div class="acc-group">' +
      '<div class="section-title">' + esc(t('Backup')) + '</div>' +
      row('export', ICON.download, t('Export data'), '.json') +
      row('import', ICON.upload, t('Import data…')) +
      '<p class="acc-sync"><i></i>' + esc(t('Synced across your signed-in devices.')) + '</p>' +
    '</div>' +

    '<div class="acc-group">' +
      row('sign-out', ICON.signout, t('Sign out')) +
      row('reset', ICON.trash, t('Reset library…'), '', true) +
    '</div>' +
  '</div>';
  window.scrollTo(0, 0);
  Array.prototype.forEach.call(view.querySelectorAll('.segs'), function (box) { tabsLens(box); });
}

/* ---- recipe (F4) ----
   Dose stepper. Scales this brew without touching the saved recipe: the
   ratio stays locked, water follows the dose, and the pours rescale —
   formula styles recompute from the new numbers, hand-written steps have
   their grams scaled by the same factor. The timer reads the same scaled
   copy, so what you set here is what you brew. Forgotten as soon as you
   leave the recipe. */
var doseView = { id: null, dose: null };

function scalable(r) {
  var d = Number(r.dose), w = Number(r.water);
  return d > 0 && w > 0;
}

function viewRecipe(r) {
  if (!r || doseView.id !== r.id || doseView.dose == null || !scalable(r)) return r;
  var k = doseView.dose / Number(r.dose);
  var out = Object.assign({}, r);
  out.dose = doseView.dose;
  out.water = Math.round(Number(r.water) * k);
  if (r.steps && r.steps.length) {
    out.steps = r.steps.map(function (st) {
      var w = Number(st.water);
      return Object.assign({}, st, w ? { water: Math.round(w * k) } : {});
    });
  }
  return out;
}

function stepsF4HTML(steps) {
  var run = 0;
  return steps.map(function (st, i) {
    var w = Number(st.water) || 0;
    run += w;
    return '<li class="rd-step">' +
      '<span class="rd-dot' + (i === 0 ? ' is-first' : '') + '" aria-hidden="true"></span>' +
      '<span class="rd-t">' + esc(st.t || '') + '</span>' +
      '<span class="rd-l">' + esc(t(st.label || '')) + '</span>' +
      (w ? '<span class="rd-w">+' + w + ' · ' + run + ' g</span>' : '<span class="rd-w"></span>') +
    '</li>';
  }).join('');
}

/* The top of a recipe reads like the label on its bag: the roaster across
   the top, the coffee's name, then the facts the coffee has on record —
   origin, process, altitude, varietal — and its tasting notes.
   Facts that are not on record are left out, not shown empty. */
var BEAN_MARK = '<svg viewBox="0 0 24 24" class="ico bean-mark" aria-hidden="true">' + BREWER_SVG.bean + '</svg>';

function bagLabelHTML(r, c, roaster) {
  var facts = '';
  function fact(k, v) {
    if (v) facts += '<div class="bl-fact"><dt>' + esc(k) + '</dt><dd>' + v + '</dd></div>';
  }
  if (c) {
    fact(t('Origin'), esc(c.origin));
    fact(t('Process'), esc(c.process));
    fact(t('Altitude'), c.altitude ? esc(String(c.altitude)) : '');
    fact(t('Varietal'), esc(c.varietal));
  }
  var notes = c && c.notes ? String(c.notes).split(/\s*[,;\n·]\s*/).filter(Boolean) : [];
  // Short comma lists read as chips; anything longer stays a sentence.
  var asChips = notes.length > 1 && notes.length <= 8 && notes.every(function (n) { return n.length <= 24; });
  return '<section class="bag-label">' +
    '<span class="bl-valve" aria-hidden="true"><i></i></span>' +
    (roaster ? '<span class="bl-roaster">' + esc(roaster) + '</span>' : '') +
    '<h1 class="rd-name">' + esc(titleOf(r)) + '</h1>' +
    (r.rating ? '<span class="rd-score">' + stars(r.rating) + '</span>' : '') +
    (facts ? '<dl class="bl-facts">' + facts + '</dl>' : '') +
    (notes.length
      ? (asChips
        ? '<div class="bl-notes" aria-label="' + esc(t('Tasting notes')) + '">' +
            notes.map(function (n) { return '<span>' + esc(n) + '</span>'; }).join('') + '</div>'
        : '<p class="bl-notes-text">' + esc(c.notes) + '</p>')
      : '') +
  '</section>';
}

function renderDetail(id, keepScroll) {
  view.classList.remove('view-enter');
  var saved = recipeById(id);
  if (!saved) {
    view.innerHTML = '<div class="detail rd"><div class="rd-top"><a class="rd-btn" href="#/" aria-label="' + esc(t('Back')) + '">' + ICON.back + '</a></div>' +
      '<div class="empty">' + ICON.bean + '<h3>' + esc(t('Recipe not found')) + '</h3><p>' + esc(t('It may have been deleted.')) + '</p></div></div>';
    return;
  }
  if (doseView.id !== id) doseView = { id: id, dose: null };
  var r = viewRecipe(saved);
  var scaledNow = doseView.dose != null && doseView.dose !== Number(saved.dose);

  var c = findIn('coffee', r.coffeeId);
  var st = findIn('style', r.styleId);
  var gr = findIn('grinder', r.grinderId);
  var me = findIn('method', r.methodId);
  var styleDriven = hasFormula(r.styleId);
  var steps = effectiveSteps(r);
  var roaster = roasterOf(r);

  var specs = '';
  function spec(k, v) { if (v) specs += '<div class="rd-spec"><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>'; }
  if (c) {
    var ro = c.roasterId ? findIn('roaster', c.roasterId) : null;
    if (ro && ro.location) spec(t('Roastery'), ro.location);
  }
  if (st && st.author) spec(t('Devised by'), st.author);

  // The dose card: a stepper when the recipe has both weights to scale,
  // otherwise just the numbers it does have.
  var doseCard;
  if (scalable(saved)) {
    doseCard = '<section class="rd-dose">' +
      '<div class="rd-dose-top"><span>' + esc(t('Brewing for')) + '</span>' +
        '<span class="rd-lock">' + esc(t('Ratio locked')) + ' · ' + ratio(r.dose, r.water) + '</span></div>' +
      '<div class="rd-dose-row">' +
        '<button type="button" class="rd-step-btn" data-action="dose-step" data-d="-1" aria-label="' + esc(t('Less coffee')) + '"' +
          (Number(r.dose) <= 1 ? ' disabled' : '') + '>' + ICON.minus + '</button>' +
        '<div class="rd-dose-nums">' +
          '<span><b>' + num(r.dose) + '<small>g</small></b><i>' + BEAN_MARK + esc(t('coffee')) + '</i></span>' +
          '<span class="rd-arrow" aria-hidden="true">→</span>' +
          '<span><b>' + num(r.water) + '<small>g</small></b><i>' + ICON.drop + esc(t('water')) + '</i></span>' +
        '</div>' +
        '<button type="button" class="rd-step-btn" data-action="dose-step" data-d="1" aria-label="' + esc(t('More coffee')) + '">' + ICON.plus + '</button>' +
      '</div>' +
      '<p class="rd-dose-note">' + (scaledNow
        ? esc(t('Scaled for this brew only — the recipe keeps')) + ' ' + num(saved.dose, ' g') + '. ' +
          '<button type="button" class="rd-reset" data-action="dose-reset">' + esc(t('Reset')) + '</button>'
        : esc(t('Change the dose and every pour below rescales.'))) + '</p>' +
    '</section>';
  } else {
    doseCard = '<section class="rd-dose is-static"><div class="rd-dose-nums">' +
      (Number(r.dose) > 0 ? '<span><b>' + num(r.dose) + '<small>g</small></b><i>' + BEAN_MARK + esc(t('coffee')) + '</i></span>' : '') +
      (r.water !== '' && r.water != null ? '<span><b>' + num(r.water) + '<small>g</small></b><i>' + ICON.drop + esc(t('water')) + '</i></span>' : '') +
    '</div></section>';
  }

  var tiles = '';
  if (r.temp !== '' && r.temp != null) tiles += '<div class="rd-tile"><span class="k">' + esc(t('Water')) + '</span><span class="v">' + num(r.temp) + ' °C</span></div>';
  if (r.brewTime) tiles += '<div class="rd-tile"><span class="k">' + esc(t('Time')) + '</span><span class="v">' + esc(String(r.brewTime).replace('~', '')) + '</span></div>';
  if (gr || r.grindSize) tiles += '<div class="rd-tile"><span class="k">' + esc(gr ? gr.name : t('Grind')) + '</span><span class="v is-text">' + esc(r.grindSize || '—') + '</span></div>';

  var html = '<div class="detail rd">' +
    '<div class="rd-top">' +
      '<a class="rd-btn" href="#/" aria-label="' + esc(t('Back')) + '">' + ICON.back + '</a>' +
      '<span class="rd-gap"></span>' +
      '<button class="rd-btn fav' + (r.fav ? ' on' : '') + '" data-action="fav" data-id="' + esc(r.id) + '" aria-label="' + esc(t('Toggle favourite')) + '">' + iconStar(r.fav) + '</button>' +
      '<div class="menu-holder detail-more">' +
        '<button class="rd-btn" data-action="toggle-detail-menu" aria-haspopup="true" aria-expanded="false" aria-label="' + esc(t('More actions')) + '">' + ICON.more + '</button>' +
        '<div class="menu" id="detailMenu" hidden>' +
          '<button data-action="edit" data-id="' + esc(r.id) + '">' + esc(t('Edit')) + '</button>' +
          '<button data-action="duplicate" data-id="' + esc(r.id) + '">' + esc(t('Duplicate')) + '</button>' +
          '<div class="menu-sep"></div>' +
          '<button class="danger" data-action="delete" data-id="' + esc(r.id) + '">' + esc(t('Delete recipe…')) + '</button>' +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div class="rd-chips">' +
      (me ? '<span class="rd-chip">' + brewerIcon(me) + esc(me.name) + '</span>' : '') +
      (st ? '<span class="rd-chip">' + esc(st.name) + '</span>' : '') +
    '</div>' +
    bagLabelHTML(r, c, roaster) +

    doseCard +
    (tiles ? '<div class="rd-tiles">' + tiles + '</div>' : '') +

    '<h2 class="rd-h2">' + esc(t(steps.length ? 'Pouring steps' : 'How to brew it')) + '</h2>' +
    (steps.length
      ? '<ol class="rd-steps">' + stepsF4HTML(steps) + '</ol>' +
        (styleDriven ? '<p class="rd-hint">' + esc(stepsCaption(r)) + '</p>' : '')
      : styleDriven
        ? '<p class="rd-hint">' + esc(noStepsMessage(r)) + '</p>'
        : '<p class="rd-hint">' + esc(t('No steps recorded —')) + ' <a href="#" data-action="edit" data-id="' + esc(r.id) + '">' + esc(t('add them')) + '</a>.</p>') +

    (st && st.notes ? '<div class="rd-note"><span class="k">' + esc(t('About this style')) + '</span><p>' + esc(t(st.notes)) + '</p></div>' : '') +
    (r.notes ? '<div class="rd-note"><span class="k">' + esc(t('Personal notes')) + '</span><p>' + esc(r.notes) + '</p></div>' : '') +
    (specs ? '<h2 class="rd-h2">' + esc(t('Details')) + '</h2><dl class="rd-specs">' + specs + '</dl>' : '') +
  '</div>' +
    // A sibling of .detail, not a child: .detail animates on entry, and an
    // element with a transform is a containing block for fixed descendants.
    '<div class="detail-bar rd-bar glass" data-glass="6">' +
      (timerPlan(r)
        ? '<button class="rd-brew" data-action="timer" data-id="' + esc(r.id) + '">' +
            '<span>' + esc(t('Start brewing')) + '</span>' +
            '<span class="rd-brew-end">' + (timerPlan(r).total ? '<span class="rd-brew-time">' + esc(mmss(timerPlan(r).total)) + '</span>' : '') +
              '<span class="rd-brew-disc">' + ICON.play + '</span></span>' +
          '</button>'
        : '<span class="detail-bar-note">' + esc(t('Add a brew time or pouring steps to time this one.')) + '</span>') +
      '<button class="rd-btn rd-edit" data-action="edit" data-id="' + esc(r.id) + '" aria-label="' + esc(t('Edit')) + '">' + ICON.edit + '</button>' +
    '</div>';

  view.innerHTML = html;
  markSeen(r.id);
  if (!keepScroll) window.scrollTo(0, 0);
  glassAll(view);
}

/* ---------------------------------------------------------
   7b. Brew timer

   A stopwatch drawn as one closed ring: the whole circle is the
   recipe's brew time, and each pouring step owns the slice of arc
   it stays on screen for — so the plan is readable at a glance
   before the timer even starts, and the sweeping progress arc
   shows how far through the brew you are.
   --------------------------------------------------------- */


// Times here are free-form ("3:15", "~0:28", "3:10–3:15"), so take the first
// m:ss found — for a range that's the lower bound, which is the one worth
// counting up to.
function secondsOf(v) {
  var s = String(v == null ? '' : v);
  var m = s.match(/(\d+):([0-5]\d)/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  m = s.match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

function timerPlan(r) {
  var steps = effectiveSteps(r).map(function (s) {
    return { at: secondsOf(s.t), label: s.label || '', water: Number(s.water) || 0, pour: Number(s.pour) || 0 };
  }).filter(function (s) { return s.at !== null; });
  steps.sort(function (a, b) { return a.at - b.at; });

  var brew = secondsOf(r.brewTime);
  var last = steps.length ? steps[steps.length - 1].at : 0;
  // The ring has to close *after* the final pour — a recipe whose recorded
  // brew time is shorter than its own schedule gets padded rather than
  // truncated, so no step ends up with zero arc.
  var total = (brew && brew > last) ? brew : (steps.length ? last + 45 : brew);
  if (!total) return null;

  var segs = [];
  if (!steps.length) {
    // Espresso and the like: no pour schedule, so the ring is the shot.
    var ty0 = methodType(findIn('method', r.methodId));
    segs.push({ start: 0, end: total, water: 0,
      label: ty0 === 'Moka pot' ? 'Brew on the stove; take it off at the first gurgle.'
        : ty0 === 'Immersion' || ty0 === 'Cold brew' ? 'Let it steep.'
        : ty0 === 'Espresso' || !ty0 ? 'Pull the shot.' : 'Brew.' });
  } else {
    if (steps[0].at > 0) segs.push({ start: 0, end: steps[0].at, label: 'Get set up.', water: 0 });
    steps.forEach(function (s, i) {
      segs.push({
        start: s.at,
        end: i + 1 < steps.length ? steps[i + 1].at : total,
        label: s.label,
        water: s.water,
        pour: s.pour
      });
    });
  }
  // Running water totals, so the timer can show grams poured against the
  // target the way v3's BrewTimer does.
  var run = 0;
  segs.forEach(function (s) { s.from = run; run += s.water || 0; s.upto = run; });
  return { total: total, segs: segs, water: run };
}

// v3 zero-pads the timer's clock (02:05, not 2:05) so the digits never
// shift width mid-brew. Only the timer uses this; mmss stays elsewhere.
function mmss2(sec) {
  var n = Math.max(0, Math.floor(sec));
  return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
}

var timer = null;

/* ---- brewing cues -------------------------------------------------
   A brew timer you have to watch is barely a timer: the whole point of
   the ring, the countdown and the wake lock is to let you keep your eyes
   on the bed and one hand on the kettle. So each step boundary is
   announced three ways at once — a tone, a buzz, and a live-region
   update — because at any given moment one of those is unavailable:
   the phone is face-down, or on silent, or its owner is using a screen
   reader. A soft tone lands three seconds early as a "get ready", the
   firmer one on the boundary itself.

   Tones are synthesized with the Web Audio API rather than shipped as
   files, which keeps the app's no-build, no-assets shape intact. */
var timerMuted = (function () {
  try { return localStorage.getItem('brewTimerMuted') === '1'; } catch (e) { return false; }
})();
var timerAudioCtx = null;

function saveTimerMuted() {
  try { localStorage.setItem('brewTimerMuted', timerMuted ? '1' : '0'); } catch (e) { /* private mode */ }
}

// Browsers only allow audio to start from a user gesture, so this is called
// from Start/Resume and from unmuting — never on load.
function timerAudio() {
  if (timerMuted) return null;
  try {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!timerAudioCtx) {
      // iPhones silence Web Audio entirely when the ringer switch is off,
      // which is exactly how a phone sitting on a kitchen counter tends to
      // be. Declaring the page as playback audio opts out of that (Safari
      // 16.4+); without it the timer is inaudible on the device it was
      // built for, with no error to explain why.
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* older Safari */ }
      timerAudioCtx = new Ctx();
      // A single silent buffer completes the unlock on iOS, which otherwise
      // reports a running context that produces nothing.
      try {
        var src = timerAudioCtx.createBufferSource();
        src.buffer = timerAudioCtx.createBuffer(1, 1, 22050);
        src.connect(timerAudioCtx.destination);
        src.start(0);
      } catch (e) { /* priming is best-effort */ }
    }
    // Re-checked on every cue, not just at unlock: iOS suspends the context
    // whenever the app is backgrounded, and a brew outlasts a glance away.
    if (timerAudioCtx.state !== 'running') timerAudioCtx.resume();
    return timerAudioCtx;
  } catch (e) { return null; }
}

function timerTone(freq, dur, peak, delay) {
  var ctx = timerAudio();
  if (!ctx) return;
  try {
    var t0 = ctx.currentTime + (delay || 0);
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    // Short attack, exponential tail — a soft mallet rather than a beep.
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  } catch (e) { /* audio unavailable — the buzz and live region still fire */ }
}

function timerBuzz(pattern) {
  if (timerMuted) return;
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* unsupported */ }
}

function timerCue(kind) {
  if (timerMuted) return;
  if (kind === 'warn') {
    timerTone(620, 0.11, 0.055);
    timerBuzz(60);
  } else if (kind === 'step') {
    timerTone(880, 0.16, 0.10);
    timerTone(1175, 0.18, 0.085, 0.10);
    timerBuzz(120);
  } else if (kind === 'done') {
    timerTone(880, 0.18, 0.10);
    timerTone(1175, 0.18, 0.10, 0.16);
    timerTone(1568, 0.34, 0.11, 0.32);
    timerBuzz([120, 70, 200]);
  }
}

// Fired from the animation loop, so only ever while the brew is running.
function timerRunCues() {
  var plan = timer.plan, e = timer.elapsed, i = 0, k;
  for (k = 0; k < plan.segs.length; k++) if (e >= plan.segs[k].start) i = k;

  if (timer.cueSeg == null) timer.cueSeg = i;
  if (i !== timer.cueSeg) {
    timer.cueSeg = i;
    timer.warned = false;
    timerCue('step');
  }

  var left = plan.segs[i].end - e;
  if (!timer.warned && left > 0 && left <= 3) {
    timer.warned = true;
    timerCue('warn');
  }
}

// The whole brew as one thin ring around the pause button.
var TM_R = 47, TM_C = 2 * Math.PI * TM_R;
// A cup with steam, for the end of the brew.
var DONE_CUP = '<svg viewBox="0 0 72 64" fill="none" stroke-linecap="round">' +
  '<path class="dc-steam" d="M26 4c-3 4-3 7 0 11M36 2c-3 4-3 7 0 11M46 4c-3 4-3 7 0 11"/>' +
  '<path class="dc-cup" d="M14 24h40v14a16 16 0 0 1-16 16h-8a16 16 0 0 1-16-16z"/>' +
  '<path class="dc-cup" d="M54 29h4a6 6 0 0 1 0 12h-5"/>' +
  '<path class="dc-coffee" d="M17 28h34"/><path class="dc-saucer" d="M8 60h56"/></svg>';
var TM_PAUSE = '<svg viewBox="0 0 24 24" class="ico ico-fill"><rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/></svg>';

/* ---- brew animation ----
   The timer's illustration, drawn on a canvas from a small model of the
   brew, and always as a pure function of the elapsed time — so pause,
   skip and restart show exactly the right moment.

   Pour-over: each pour adds water at its own rate (over its `pour`
   seconds, or across the whole step); the dry bed soaks up about twice
   the dose first; what stands in the cone drains through the bed at
   k·√held, so a full cone runs fast and the end trickles. Drops fall from
   the tip into a glass server that fills, and steams once warm.

   Espresso: pre-infusion with nothing coming out, drops swelling at the
   spouts, two tiger-striped streams, then thinning and paling as the shot
   blondes. The app keeps no yield, so the cup fills towards a 1:2 shot. */
var ANIM_W = 300, ANIM_H = 310;

function animEase(k) { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); }
function animLerp(a, b, k) { return a + (b - a) * k; }
function animRnd(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function animMix(c1, c2, k) {
  var a = parseInt(c1.slice(1), 16), b = parseInt(c2.slice(1), 16);
  return 'rgb(' + Math.round(animLerp(a >> 16, b >> 16, k)) + ',' + Math.round(animLerp((a >> 8) & 255, (b >> 8) & 255, k)) + ',' +
    Math.round(animLerp(a & 255, b & 255, k)) + ')';
}
function animRoundRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
}

function animHTML(label) {
  return '<div class="tm-anim"><canvas role="img" aria-label="' + esc(label) + '"></canvas></div>';
}

function pourModel(plan, dose) {
  var pours = [];
  plan.segs.forEach(function (sg) {
    if (!sg.water) return;
    var len = sg.end - sg.start;
    pours.push({ at: sg.start, g: sg.water, dur: sg.pour ? Math.min(sg.pour, len) : len, upto: sg.upto });
  });
  var water = plan.water, absorb = Math.min((Number(dose) || water / 16) * 2, pours.length ? pours[0].g * 0.8 : 0);
  var k = 0.29 * Math.sqrt(water / 250);
  var dt = 0.05, n = Math.ceil(plan.total / dt) + 1, held = [], out = [], soaked = [], rate = [], drops = [];
  var h = 0, o = 0, s = 0, next = 1.4;
  for (var i = 0; i < n; i++) {
    var tt = i * dt, inflow = 0;
    pours.forEach(function (q) { if (tt >= q.at && tt < q.at + q.dur) inflow += q.g / q.dur; });
    var add = inflow * dt, soak = Math.min(add, absorb - s);
    s += soak; h += add - soak;
    var r = h > 0 ? Math.min(h / dt, k * Math.sqrt(h)) : 0;
    h -= r * dt; o += r * dt;
    while (o >= next) { drops.push(tt); next += 1.4; }
    held.push(h); out.push(o); soaked.push(s); rate.push(r);
  }
  return { kind: 'pour', dt: dt, pours: pours, water: water, absorb: absorb, held: held, out: out, soaked: soaked, rate: rate, drops: drops,
    bloomEnd: pours.length > 1 ? pours[1].at : plan.total };
}

function shotProfile(u) {       // flow over a 28 s shot, by its own clock
  if (u < 6) return 0;
  if (u < 9) return animLerp(0.15, 1.2, animEase((u - 6) / 3));
  if (u < 24) return animLerp(1.2, 1.75, animEase((u - 9) / 5));
  return animLerp(1.75, 0.9, animEase((u - 24) / 4));
}
function shotModel(plan, dose) {
  var T = plan.total, dt = 0.02, n = Math.ceil(T / dt) + 1, cum = [], y = 0;
  for (var i = 0; i < n; i++) { cum.push(y); y += shotProfile(i * dt / T * 28) * dt; }
  var yieldG = (Number(dose) || 18) * 2, scale = y ? yieldG / y : 0;
  return { kind: 'shot', dt: dt, total: T, yieldG: yieldG, cum: cum.map(function (v) { return v * scale; }) };
}

function animAt(arr, dt, tt) { return arr[Math.max(0, Math.min(arr.length - 1, Math.round(tt / dt)))]; }

function animColors() {
  var cs = getComputedStyle(document.documentElement);
  var dark = document.documentElement.getAttribute('data-theme') !== 'light';
  return {
    card: cs.getPropertyValue('--surface-card').trim(), sunken: cs.getPropertyValue('--surface-sunken').trim(),
    strong: cs.getPropertyValue('--border-strong').trim(), accent: cs.getPropertyValue('--text-accent').trim(),
    paper: dark ? 'rgba(237,235,231,.07)' : 'rgba(26,24,22,.04)', rib: dark ? 'rgba(237,235,231,.05)' : 'rgba(26,24,22,.06)',
    water: dark ? 'rgba(143,179,201,.9)' : 'rgba(91,143,176,.9)', glass: dark ? 'rgba(237,235,231,.75)' : 'rgba(26,24,22,.7)',
    steam: dark ? '237,235,231' : '107,103,95', wood: dark ? '#6B4A33' : '#8A6A4E', dark: dark
  };
}

function animDraw(e) {
  if (!timer || !timer.anim) return;
  var cv = timer.el.querySelector('.tm-anim canvas');
  if (!cv) return;
  var dpr = window.devicePixelRatio || 1, w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
  if (!w || !h) return;
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  var ctx = cv.getContext('2d');
  ctx.setTransform(w / ANIM_W, 0, 0, h / ANIM_H, 0, 0);
  ctx.clearRect(0, 0, ANIM_W, ANIM_H);
  var theme = document.documentElement.getAttribute('data-theme');
  if (!timer.animCol || timer.animTheme !== theme) { timer.animCol = animColors(); timer.animTheme = theme; }
  var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (timer.anim.kind === 'pour') drawPourAnim(ctx, e, timer.anim, timer.animCol, still);
  else if (timer.anim.kind === 'aero') drawAeroAnim(ctx, e, timer.anim, timer.animCol, still);
  else if (timer.anim.kind === 'immersion') drawImmersionAnim(ctx, e, timer.anim, timer.animCol, still);
  else if (timer.anim.kind === 'moka') drawMokaAnim(ctx, e, timer.anim, timer.animCol, still);
  else drawShotAnim(ctx, e, timer.anim, timer.animCol, still);
}

function drawPourAnim(ctx, tt, M, col, still) {
  var C = { top: 70, bot: 190, l0: 58, r0: 242, l1: 128, r1: 172 };
  function cx(y) { var k = (y - C.top) / (C.bot - C.top); return [animLerp(C.l0, C.l1, k), animLerp(C.r0, C.r1, k)]; }
  // Grams standing in the cone → surface height: a cone's volume grows
  // with the cube of its depth, so height goes with the cube root.
  function levelY(g) { var f = Math.cbrt(Math.max(0, Math.min(1, g / (M.water * 1.2)))); return C.bot - 14 - f * (C.bot - 14 - 80); }
  var pour = null; M.pours.forEach(function (q) { if (tt >= q.at && tt < q.at + q.dur) pour = q; });
  var held = animAt(M.held, M.dt, tt), wet = M.absorb ? animAt(M.soaked, M.dt, tt) / M.absorb : 1;
  var out = animAt(M.out, M.dt, tt), rate = animAt(M.rate, M.dt, tt), x, k;

  // Server, behind the cone's tip.
  var sx0 = 92, sx1 = 208, sTop = 222, sBot = 300;
  var sf = Math.max(0, Math.min(1, out / Math.max(1, M.water - M.absorb))), sy = sBot - 6 - sf * 58;
  var wav = function (xx) { return sy + Math.sin(xx * 0.12 + tt * 3) * (rate > 0.5 ? 1.2 : 0.4); };
  ctx.save(); ctx.beginPath(); animRoundRect(ctx, sx0, sTop, sx1 - sx0, sBot - sTop, 16); ctx.clip();
  if (out > 0.5) {
    var g1 = ctx.createLinearGradient(0, sy, 0, sBot); g1.addColorStop(0, '#7A4A2A'); g1.addColorStop(1, '#2E1A0F');
    ctx.fillStyle = g1; ctx.beginPath(); ctx.moveTo(sx0, sy);
    for (x = sx0; x <= sx1; x += 4) ctx.lineTo(x, wav(x));
    ctx.lineTo(sx1, sBot); ctx.lineTo(sx0, sBot); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(201,162,122,.55)'; ctx.lineWidth = 1.5; ctx.beginPath();
    for (x = sx0; x <= sx1; x += 4) ctx[x === sx0 ? 'moveTo' : 'lineTo'](x, wav(x));
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = col.strong; ctx.lineWidth = 2; ctx.beginPath(); animRoundRect(ctx, sx0, sTop, sx1 - sx0, sBot - sTop, 16); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(sx0 + 8, sTop + 10, 5, sBot - sTop - 30);

  var steamA = Math.max(0, Math.min(1, (out - 40) / 60)) * (still ? 0.5 : 1);
  if (steamA > 0) {
    ctx.lineCap = 'round';
    for (var wv = 0; wv < 3; wv++) {
      ctx.strokeStyle = 'rgba(' + col.steam + ',' + (0.22 * steamA) + ')'; ctx.lineWidth = 3; ctx.beginPath();
      for (k = 0; k <= 12; k++) ctx[k ? 'lineTo' : 'moveTo'](130 + wv * 20 + Math.sin(tt * 0.9 + wv * 2.1 + k * 0.5) * (2 + k * 0.5), sTop - 4 - k * 2.6);
      ctx.stroke();
    }
  }

  // Drops from the tip, or a thin stream when it runs fast.
  ctx.fillStyle = '#5A3520';
  if (rate > 2.2) {
    ctx.strokeStyle = '#5A3520'; ctx.lineWidth = Math.max(1.5, Math.min(3.2, rate * 0.6));
    ctx.beginPath(); ctx.moveTo(150, 204); ctx.lineTo(150, sy); ctx.stroke();
  } else {
    M.drops.forEach(function (bt) {
      var age = tt - bt; if (age < 0 || age > 0.6) return;
      var y = 206 + 350 * age * age; if (y > sy) return;
      ctx.beginPath(); ctx.ellipse(150, y, 2.2, 3.2, 0, 0, Math.PI * 2); ctx.fill();
    });
  }

  // Cone and filter paper with faint spiral ribs.
  ctx.lineJoin = 'round'; ctx.fillStyle = col.card; ctx.strokeStyle = col.strong; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(C.l0 - 8, C.top - 4); ctx.lineTo(C.r0 + 8, C.top - 4); ctx.lineTo(C.r1 + 4, C.bot + 4);
  ctx.lineTo(C.r1 - 8, 204); ctx.lineTo(C.l1 + 8, 204); ctx.lineTo(C.l1 - 4, C.bot + 4); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = col.paper; ctx.beginPath();
  ctx.moveTo(C.l0, C.top); ctx.lineTo(C.r0, C.top); ctx.lineTo(C.r1, C.bot); ctx.lineTo(C.l1, C.bot); ctx.closePath(); ctx.fill();
  ctx.save(); ctx.clip(); ctx.strokeStyle = col.rib; ctx.lineWidth = 1;
  for (var rb = -6; rb <= 6; rb++) { ctx.beginPath(); ctx.moveTo(150 + rb * 16, C.top); ctx.quadraticCurveTo(150 + rb * 9, 130, 150 + rb * 3.5, C.bot); ctx.stroke(); }

  // The bed darkens as it wets, and domes while it blooms.
  var B = M.bloomEnd, bloomK = tt < B ? animEase(tt / 6) * (1 - animEase((tt - (B - 15)) / 15)) : 0;
  var bedTop = C.bot - 18, b0 = cx(bedTop)[0], b1 = cx(bedTop)[1];
  ctx.fillStyle = animMix('#9C7A5A', '#3A2418', animEase(wet)); ctx.beginPath();
  ctx.moveTo(b0, bedTop); ctx.quadraticCurveTo(150, bedTop - 14 * bloomK, b1, bedTop);
  ctx.lineTo(C.r1, C.bot); ctx.lineTo(C.l1, C.bot); ctx.closePath(); ctx.fill();
  for (var gi = 0; gi < 70; gi++) {
    ctx.fillStyle = 'rgba(0,0,0,' + (0.18 + animRnd(gi + 7) * 0.2) + ')';
    ctx.fillRect(animLerp(b0 + 4, b1 - 4, animRnd(gi)), animLerp(bedTop + 2, C.bot - 1, animRnd(gi + 99)), 1.4, 1.4);
  }

  // Standing coffee under a moving surface, rippled where the pour lands.
  if (held > 0.4) {
    var ly = Math.min(levelY(held), bedTop - 2), lx = cx(ly), calm = pour ? 1.6 : 0.5;
    var surf = function (xx) { return ly + Math.sin(xx * 0.09 + tt * 4) * calm + Math.sin(xx * 0.23 - tt * 2.5) * calm * 0.5; };
    var g2 = ctx.createLinearGradient(0, ly, 0, bedTop); g2.addColorStop(0, 'rgba(154,107,69,.82)'); g2.addColorStop(1, 'rgba(74,43,24,.95)');
    ctx.fillStyle = g2; ctx.beginPath(); ctx.moveTo(lx[0], ly);
    for (x = lx[0]; x <= lx[1]; x += 3) ctx.lineTo(x, surf(x));
    ctx.lineTo(cx(bedTop)[1], bedTop); ctx.quadraticCurveTo(150, bedTop - 14 * bloomK, cx(bedTop)[0], bedTop); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(217,185,143,.9)'; ctx.lineWidth = 2; ctx.beginPath();
    for (x = lx[0] + 2; x <= lx[1] - 2; x += 3) ctx[x === lx[0] + 2 ? 'moveTo' : 'lineTo'](x, surf(x));
    ctx.stroke();
    if (pour && !still) {
      var land = 150 + Math.sin((tt - pour.at) * 2.2) * 26 * animEase((tt - pour.at) / 1.5);
      for (var ri = 0; ri < 4; ri++) {
        var age = ((tt * 4 + ri) % 4) / 4;
        ctx.strokeStyle = 'rgba(232,210,180,' + (0.55 * (1 - age)) + ')'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.ellipse(land, ly + 1, 4 + age * 26, (4 + age * 26) * 0.22, 0, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }
  // Bloom bubbles: gas leaving the fresh grounds.
  if (bloomK > 0.05 && !still) {
    for (var bi = 0; bi < 14; bi++) {
      var life = 1.6 + animRnd(bi) * 1.4, ph = ((tt + animRnd(bi + 3) * life) % life) / life;
      ctx.strokeStyle = 'rgba(217,185,143,' + (0.8 * bloomK * (1 - ph)) + ')'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(animLerp(b0 + 10, b1 - 10, animRnd(bi + 11)), bedTop - 4 - 12 * bloomK - ph * 6, 1.5 + ph * 2.5, 0, Math.PI * 2); ctx.stroke();
    }
  }
  ctx.restore();
  ctx.strokeStyle = col.strong; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(C.l0 - 8, C.top - 4); ctx.lineTo(C.r0 + 8, C.top - 4); ctx.stroke();

  // This pour's target: where the coffee will stand when it is in — read
  // from the same model as the liquid, so the level meets the line.
  if (pour) {
    var ty = Math.min(levelY(animAt(M.held, M.dt, pour.at + pour.dur)), bedTop - 2), tx = cx(ty);
    ctx.setLineDash([4, 5]); ctx.strokeStyle = col.accent; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(tx[0] + 6, ty); ctx.lineTo(tx[1] - 6, ty); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = col.accent; ctx.font = '500 12px "Albert Sans", sans-serif'; ctx.fillText(pour.upto + ' g', tx[1] + 2, ty + 4);
    // The kettle stream eases in and out, and circles as it pours.
    var into = tt - pour.at, k1 = animEase(into / 0.5) * (1 - animEase((into - pour.dur + 0.5) / 0.5));
    var lyNow = held > 0.4 ? Math.min(levelY(held), bedTop - 2) : bedTop - 10 * bloomK;
    var land2 = 150 + Math.sin(into * 2.2) * 26 * animEase(into / 1.5);
    ctx.strokeStyle = col.water; ctx.lineCap = 'round'; ctx.lineWidth = 3.2 * k1;
    ctx.beginPath(); ctx.moveTo(214, 0); ctx.bezierCurveTo(200, 20, land2 + 8, lyNow - 70, land2, lyNow); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = k1;
    ctx.beginPath(); ctx.moveTo(213, 2); ctx.bezierCurveTo(199, 22, land2 + 7, lyNow - 70, land2 - 0.6, lyNow - 2); ctx.stroke();
  }
}

/* AeroPress, side on: the chamber standing on a mug. Water goes in with
   the pour, the grounds darken and bubble; the plunger is set in to hold
   the brew; a swirl stirs the surface; then the press drives the seal
   down, the coffee streams through the cap into the mug, and the plunger
   ends with a hiss of air on the puck. The moments come from the
   recipe's steps — read from their wording, falling back to sensible
   defaults — so the drawing follows whatever schedule the recipe has. */
function aeroModel(plan, dose, water) {
  var W = plan.water || Number(water) || 200;
  var pours = [];
  plan.segs.forEach(function (sg) {
    if (!sg.water) return;
    var len = sg.end - sg.start;
    pours.push({ at: sg.start, g: sg.water, dur: sg.pour ? Math.min(sg.pour, len) : Math.min(10, len) });
  });
  if (!pours.length) pours.push({ at: 0, g: W, dur: 10 });
  function find(re) {
    for (var i = 0; i < plan.segs.length; i++) if (re.test(plan.segs[i].label || '')) return plan.segs[i];
    return null;
  }
  var ins = find(/plunger|seal|êmbolo|tampe/i), sw = find(/swirl|stir|gir|mex/i), pr = find(/press|pression|empurr/i);
  var last = plan.segs[plan.segs.length - 1];
  var pressStart = pr ? pr.start : last.start, pressEnd = pr ? Math.min(pr.end, pr.start + 40) : plan.total;
  if (pressEnd - pressStart < 5) pressEnd = Math.min(plan.total, pressStart + 20);
  return {
    kind: 'aero', water: W, dose: Number(dose) || W / 16, pours: pours,
    insertAt: ins ? ins.start : pours[pours.length - 1].at + pours[pours.length - 1].dur + 3,
    swirlAt: sw ? sw.start : -1, pressStart: pressStart, pressEnd: pressEnd
  };
}

function drawAeroAnim(ctx, tt, M, col, still) {
  var cL = 106, cR = 194, cTop = 40, cBot = 196, puckTop = 184;
  // Water poured so far.
  var poured = 0, pour = null;
  M.pours.forEach(function (q) {
    if (tt >= q.at + q.dur) poured += q.g;
    else if (tt >= q.at) { poured += q.g * (tt - q.at) / q.dur; pour = q; }
  });
  var fillFrac = Math.min(1, poured / (M.water * 1.15));
  var press = M.pressEnd > M.pressStart ? animEase((tt - M.pressStart) / (M.pressEnd - M.pressStart)) : 0;
  var liquidTop0 = puckTop - fillFrac * (puckTop - cTop - 22);
  var plungerIn = tt >= M.insertAt;
  var sealY = plungerIn ? animLerp(Math.min(liquidTop0 - 6, cTop + 12), puckTop - 2, press) : null;
  var liquidTop = plungerIn ? Math.max(liquidTop0, sealY + 4) : liquidTop0;
  var absorbed = Math.min(M.dose * 2, poured);
  var mugG = (poured - absorbed) * press;
  var wet = Math.min(1, poured / Math.max(1, M.dose * 2));

  // Mug.
  var mL = 84, mR = 216, mTop = 214, mBot = 300;
  var mLevel = mBot - 6 - Math.min(1, mugG / (M.water * 1.05)) * (mBot - mTop - 16);
  ctx.save(); ctx.beginPath(); animRoundRect(ctx, mL, mTop, mR - mL, mBot - mTop, 14); ctx.clip();
  if (mugG > 0.5) {
    var gm = ctx.createLinearGradient(0, mLevel, 0, mBot); gm.addColorStop(0, '#7A4A2A'); gm.addColorStop(1, '#2E1A0F');
    ctx.fillStyle = gm; ctx.beginPath(); ctx.moveTo(mL, mLevel);
    for (var x = mL; x <= mR; x += 4) ctx.lineTo(x, mLevel + Math.sin(x * 0.12 + tt * 4) * (press > 0 && press < 1 ? 1.2 : 0.4));
    ctx.lineTo(mR, mBot); ctx.lineTo(mL, mBot); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = col.strong; ctx.lineWidth = 2; ctx.beginPath(); animRoundRect(ctx, mL, mTop, mR - mL, mBot - mTop, 14); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(mR, 232); ctx.bezierCurveTo(mR + 26, 232, mR + 26, 272, mR, 272); ctx.stroke();

  // The stream through the cap while pressing.
  if (press > 0.02 && press < 0.99) {
    ctx.strokeStyle = '#5A3520'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(150, 206); ctx.lineTo(150 + Math.sin(tt * 12) * 0.4, mLevel); ctx.stroke();
  }

  // Chamber: a clear tube with its flange resting on the mug.
  ctx.fillStyle = col.card; ctx.strokeStyle = col.strong; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.beginPath(); animRoundRect(ctx, cL - 18, cBot, cR - cL + 36, 8, 3); ctx.fill(); ctx.stroke();
  ctx.fillStyle = col.sunken; ctx.beginPath(); animRoundRect(ctx, cL + 6, cBot + 8, cR - cL - 12, 6, 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = col.paper; ctx.fillRect(cL, cTop, cR - cL, cBot - cTop);

  // Inside: grounds settle as a puck; the slurry above is dark and bubbly.
  ctx.save(); ctx.beginPath(); ctx.rect(cL, cTop, cR - cL, cBot - cTop); ctx.clip();
  if (poured > 0.5) {
    var swirlK = M.swirlAt >= 0 && tt >= M.swirlAt && tt < M.swirlAt + 4 ? Math.sin((tt - M.swirlAt) / 4 * Math.PI) : 0;
    var amp = (pour ? 1.6 : 0.6) + swirlK * 4;
    var surf = function (xx) { return liquidTop + Math.sin(xx * 0.1 + tt * (4 + swirlK * 6)) * amp + (xx - 150) * 0.06 * swirlK * Math.sin(tt * 5); };
    var gl = ctx.createLinearGradient(0, liquidTop, 0, puckTop);
    gl.addColorStop(0, 'rgba(122,80,48,.92)'); gl.addColorStop(1, 'rgba(46,26,15,.97)');
    ctx.fillStyle = gl; ctx.beginPath(); ctx.moveTo(cL, plungerIn ? liquidTop : surf(cL));
    for (x = cL; x <= cR; x += 3) ctx.lineTo(x, plungerIn && press > 0 ? liquidTop : surf(x));
    ctx.lineTo(cR, puckTop); ctx.lineTo(cL, puckTop); ctx.closePath(); ctx.fill();
    if (!(plungerIn && press > 0)) {
      ctx.strokeStyle = 'rgba(217,185,143,.85)'; ctx.lineWidth = 2; ctx.beginPath();
      for (x = cL + 2; x <= cR - 2; x += 3) ctx[x === cL + 2 ? 'moveTo' : 'lineTo'](x, surf(x));
      ctx.stroke();
    }
    // Fresh grounds release gas for the first moments after the pour.
    var fizz = Math.max(0, 1 - Math.max(0, tt - (M.pours[0].at + M.pours[0].dur)) / 20) * (press > 0 ? 0 : 1);
    if (fizz > 0 && !still) {
      for (var bi = 0; bi < 12; bi++) {
        var life = 1.4 + animRnd(bi) * 1.2, ph = ((tt + animRnd(bi + 3) * life) % life) / life;
        ctx.strokeStyle = 'rgba(217,185,143,' + (0.7 * fizz * (1 - ph)) + ')'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(animLerp(cL + 8, cR - 8, animRnd(bi + 21)), liquidTop + 4 + ph * 4, 1.4 + ph * 2, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }
  ctx.fillStyle = animMix('#9C7A5A', '#3A2418', animEase(wet));
  ctx.fillRect(cL, puckTop, cR - cL, cBot - puckTop);
  for (var gi = 0; gi < 50; gi++) {
    ctx.fillStyle = 'rgba(0,0,0,' + (0.2 + animRnd(gi + 7) * 0.2) + ')';
    ctx.fillRect(animLerp(cL + 2, cR - 3, animRnd(gi)), animLerp(puckTop + 1, cBot - 2, animRnd(gi + 99)), 1.4, 1.4);
  }
  ctx.restore();
  // Tube walls, number marks, and a highlight down the glass.
  ctx.strokeStyle = col.glass; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cL, cTop); ctx.lineTo(cL, cBot); ctx.moveTo(cR, cTop); ctx.lineTo(cR, cBot); ctx.stroke();
  ctx.lineWidth = 1; ctx.fillStyle = col.strong; ctx.font = '500 9px "Albert Sans", sans-serif';
  for (var mk = 1; mk <= 4; mk++) {
    var my = puckTop - mk * (puckTop - cTop - 22) / 4;
    ctx.strokeStyle = col.strong; ctx.beginPath(); ctx.moveTo(cR - 10, my); ctx.lineTo(cR - 2, my); ctx.stroke();
    ctx.fillText(String(mk), cR - 19, my + 3);
  }
  ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fillRect(cL + 6, cTop + 6, 5, cBot - cTop - 16);

  // The plunger: seal in the tube, body above it, and the cap on top.
  if (plungerIn) {
    var drop = animEase((tt - M.insertAt) / 0.8);
    var sY = animLerp(cTop - 30, sealY, drop);
    ctx.fillStyle = col.card; ctx.strokeStyle = col.strong; ctx.lineWidth = 2;
    ctx.beginPath(); animRoundRect(ctx, cL + 6, sY - 150, cR - cL - 12, 150, 4); ctx.fill(); ctx.stroke();
    ctx.beginPath(); animRoundRect(ctx, cL - 4, sY - 158, cR - cL + 8, 10, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = col.dark ? '#2A2723' : '#3F3B36'; ctx.beginPath(); animRoundRect(ctx, cL + 1, sY - 6, cR - cL - 2, 8, 3); ctx.fill();
    // Air hissing through the puck as the press bottoms out.
    if (press > 0.92 && press < 1 && !still) {
      for (var hi = 0; hi < 8; hi++) {
        var hp = ((tt * 3 + animRnd(hi) * 3) % 1);
        ctx.fillStyle = 'rgba(232,210,180,' + (0.6 * (1 - hp)) + ')';
        ctx.beginPath(); ctx.arc(animLerp(cL + 10, cR - 10, animRnd(hi + 40)), puckTop - 2 - hp * 4, 1.2, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // Kettle stream while the water goes in.
  if (pour && !plungerIn) {
    var into = tt - pour.at, k1 = animEase(into / 0.5) * (1 - animEase((into - pour.dur + 0.5) / 0.5));
    var land = 150 + Math.sin(into * 2.2) * 18;
    ctx.strokeStyle = col.water; ctx.lineCap = 'round'; ctx.lineWidth = 3.2 * k1;
    ctx.beginPath(); ctx.moveTo(220, 0); ctx.bezierCurveTo(204, 12, land + 6, liquidTop - 40, land, liquidTop); ctx.stroke();
  }

  // Steam once the mug has coffee in it.
  var sa = Math.max(0, Math.min(1, (mugG - 30) / 60)) * (still ? 0.5 : 1);
  if (sa > 0 && press >= 1) {
    for (var wv = 0; wv < 3; wv++) {
      ctx.strokeStyle = 'rgba(' + col.steam + ',' + 0.2 * sa + ')'; ctx.lineWidth = 3; ctx.beginPath();
      for (var k = 0; k <= 10; k++) ctx[k ? 'lineTo' : 'moveTo'](128 + wv * 22 + Math.sin(tt + wv * 2 + k * 0.6) * (1.5 + k * 0.4), mTop - 4 - k * 2.4);
      ctx.stroke();
    }
  }
}

/* French press (and any immersion brewer): a glass carafe in a frame.
   The water goes in and lifts the grounds into a crust; the brew steeps
   with the odd bubble; a stir or "break the crust" step sinks them; the
   press drives the mesh down, packing the grounds at the bottom and
   leaving clear coffee above it. Steps are read for those moments; with
   none named, the press is the last 20 s of the brew. */
function immersionModel(plan, dose, water) {
  var W = plan.water || Number(water) || 300;
  var pours = [];
  plan.segs.forEach(function (sg) {
    if (!sg.water) return;
    var len = sg.end - sg.start;
    pours.push({ at: sg.start, g: sg.water, dur: sg.pour ? Math.min(sg.pour, len) : Math.min(15, len) });
  });
  if (!pours.length) pours.push({ at: 0, g: W, dur: 15 });
  function find(re) {
    for (var i = 0; i < plan.segs.length; i++) if (re.test(plan.segs[i].label || '')) return plan.segs[i];
    return null;
  }
  var st = find(/stir|break|crust|skim|mex|quebr|crosta/i), pr = find(/plunge|press|pression|empurr|desç|release|drain|liber/i);
  var pressStart = pr ? pr.start : Math.max(0, plan.total - 20), pressEnd = pr ? Math.min(pr.end, pr.start + 25) : plan.total;
  if (pressEnd - pressStart < 4) pressEnd = Math.min(plan.total, pressStart + 15);
  return { kind: 'immersion', water: W, dose: Number(dose) || W / 15, pours: pours,
    stirAt: st ? st.start : -1, pressStart: pressStart, pressEnd: pressEnd };
}

function drawImmersionAnim(ctx, tt, M, col, still) {
  // The carafe sits low enough that the plunger's full rod fits above it:
  // the knob starts near the top of the frame and, fully pressed, still
  // rests above the lid.
  var L = 104, R = 196, top = 142, bot = 284, x, i;
  var ROD = bot - top - 2;
  var poured = 0, pour = null;
  M.pours.forEach(function (q) {
    if (tt >= q.at + q.dur) poured += q.g;
    else if (tt >= q.at) { poured += q.g * (tt - q.at) / q.dur; pour = q; }
  });
  var fill = Math.min(1, poured / (M.water * 1.12));
  var level = bot - 8 - fill * (bot - top - 26);
  var press = M.pressEnd > M.pressStart ? animEase((tt - M.pressStart) / (M.pressEnd - M.pressStart)) : 0;
  var stirred = M.stirAt >= 0 && tt >= M.stirAt;
  var sinceStir = stirred ? tt - M.stirAt : 0;
  var meshY = animLerp(top + 6, bot - 22, press);
  var steep = Math.max(0, tt - (M.pours[0].at + M.pours[0].dur));

  // Glass carafe: coffee body, grounds, then the frame around it.
  ctx.save(); ctx.beginPath(); animRoundRect(ctx, L, top, R - L, bot - top, 12); ctx.clip();
  if (poured > 0.5) {
    var body = animMix('#8A5A36', '#3A2418', Math.min(1, steep / 120));
    var g = ctx.createLinearGradient(0, level, 0, bot); g.addColorStop(0, body); g.addColorStop(1, '#24150C');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(L, level);
    var amp = pour ? 1.6 : 0.5;
    for (x = L; x <= R; x += 3) ctx.lineTo(x, level + Math.sin(x * 0.1 + tt * 4) * amp);
    ctx.lineTo(R, bot); ctx.lineTo(L, bot); ctx.closePath(); ctx.fill();
    // Grounds: a floating crust until stirred or pressed, then sinking;
    // under the press, everything below the mesh packs into a bed.
    var crust = stirred ? Math.max(0, 1 - sinceStir / 3) : 1;
    for (i = 0; i < 90; i++) {
      var gx = animLerp(L + 4, R - 4, animRnd(i)), depth = animRnd(i + 40);
      var floatY = level + 2 + depth * 12;
      var sunkY = bot - 6 - animRnd(i + 80) * 14;
      var drift = stirred ? Math.min(1, sinceStir / (12 + animRnd(i + 3) * 30)) : Math.min(1, steep / 400) * 0.3;
      var gy = animLerp(floatY, sunkY, Math.max(drift, 1 - crust * (1 - drift)));
      if (press > 0) gy = Math.max(gy, Math.min(meshY + 3 + depth * 6, bot - 4));
      if (press >= 0.98) gy = bot - 4 - animRnd(i + 80) * 12;
      ctx.fillStyle = 'rgba(30,18,10,' + (0.55 + animRnd(i + 7) * 0.35) + ')';
      ctx.fillRect(gx, gy, 2, 2);
    }
    if (crust > 0.1 && !stirred && press === 0) {
      ctx.fillStyle = 'rgba(60,38,22,' + 0.75 * crust + ')'; ctx.fillRect(L, level - 1, R - L, 10);
      if (!still) {
        for (i = 0; i < 8; i++) {
          var life = 2 + animRnd(i) * 2, ph = ((tt + animRnd(i + 5) * life) % life) / life;
          ctx.strokeStyle = 'rgba(217,185,143,' + 0.7 * (1 - ph) + ')'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(animLerp(L + 10, R - 10, animRnd(i + 9)), level - 1 - ph * 3, 1.3 + ph * 2, 0, Math.PI * 2); ctx.stroke();
        }
      }
    }
  }
  ctx.restore();
  ctx.strokeStyle = col.glass; ctx.lineWidth = 2; ctx.beginPath(); animRoundRect(ctx, L, top, R - L, bot - top, 12); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fillRect(L + 7, top + 8, 5, bot - top - 26);
  // Metal frame: bands top and bottom, and the handle.
  ctx.strokeStyle = col.strong; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(L - 4, top + 18); ctx.lineTo(R + 4, top + 18); ctx.moveTo(L - 4, bot - 14); ctx.lineTo(R + 4, bot - 14); ctx.stroke();
  ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(R + 4, top + 22); ctx.bezierCurveTo(R + 38, top + 24, R + 38, bot - 40, R + 4, bot - 34); ctx.stroke();
  // Lid, rod and the mesh plate.
  ctx.fillStyle = col.card; ctx.strokeStyle = col.strong; ctx.lineWidth = 2;
  ctx.beginPath(); animRoundRect(ctx, L - 6, top - 14, R - L + 12, 14, 5); ctx.fill(); ctx.stroke();
  var knobY = meshY - ROD;
  ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(150, meshY); ctx.lineTo(150, knobY + 6); ctx.stroke();
  ctx.fillStyle = col.sunken; ctx.beginPath(); ctx.arc(150, knobY, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  if (poured > 0.5 || press > 0) {
    ctx.strokeStyle = col.strong; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(L + 3, meshY); ctx.lineTo(R - 3, meshY); ctx.stroke();
    ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(L + 3, meshY + 3); ctx.lineTo(R - 3, meshY + 3); ctx.stroke(); ctx.setLineDash([]);
  }
  // Kettle stream while pouring, and steam once pressed.
  if (pour) {
    var into = tt - pour.at, k1 = animEase(into / 0.5) * (1 - animEase((into - pour.dur + 0.5) / 0.5));
    ctx.strokeStyle = col.water; ctx.lineCap = 'round'; ctx.lineWidth = 3.2 * k1;
    ctx.beginPath(); ctx.moveTo(228, 0); ctx.bezierCurveTo(214, 14, 166 + Math.sin(into * 2) * 12, level - 50, 160 + Math.sin(into * 2) * 12, level); ctx.stroke();
  }
  var sa = press >= 1 ? 1 : 0;
  if (sa) {
    for (var wv = 0; wv < 2; wv++) {
      ctx.strokeStyle = 'rgba(' + col.steam + ',' + 0.18 * (still ? 0.5 : 1) + ')'; ctx.lineWidth = 3; ctx.beginPath();
      for (var k = 0; k <= 10; k++) ctx[k ? 'lineTo' : 'moveTo'](82 + wv * 12 + Math.sin(tt + wv * 2 + k * 0.6) * (1.5 + k * 0.4), top + 20 - k * 2.4);
      ctx.stroke();
    }
  }
}

/* Moka pot: an eight-sided aluminium pot on a burner, lid tipped open on
   its hinge so the top chamber can be watched. The base stays solid
   metal — the water in it is never seen, only its effect. About halfway
   through the brew time coffee wells up out of the column in the middle
   of the top chamber and its level climbs; near the end it pales and
   sputters, the gurgle that says take it off the heat. A moka recipe
   carries no pours, so the phases come from the brew time. */
function mokaModel(plan) {
  return { kind: 'moka', total: plan.total };
}

function drawMokaAnim(ctx, tt, M, col, still) {
  var u = tt / M.total;
  var flow = animEase((u - 0.5) / 0.38);
  var gurgle = u > 0.84 && u < 1 ? Math.sin((u - 0.84) / 0.16 * Math.PI) : 0;
  var on = u < 1, i, k;
  var metal = col.dark
    ? ['#3E3B38', '#8F8B85', '#CFCBC5', '#77736D', '#34312E']
    : ['#7E7A74', '#C9C5BF', '#F7F5F1', '#A9A49D', '#6B675F'];
  function metalFill(x0, x1) {
    var g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, metal[0]); g.addColorStop(0.28, metal[1]); g.addColorStop(0.45, metal[2]);
    g.addColorStop(0.72, metal[3]); g.addColorStop(1, metal[4]);
    return g;
  }
  // Facet edges: the octagon's corners seen side on, as faint verticals.
  function facets(lt, rt, lb, rb, yt, yb) {
    ctx.strokeStyle = 'rgba(0,0,0,.16)'; ctx.lineWidth = 1;
    [0.18, 0.5, 0.82].forEach(function (f) {
      ctx.beginPath(); ctx.moveTo(animLerp(lt, rt, f), yt); ctx.lineTo(animLerp(lb, rb, f), yb); ctx.stroke();
    });
  }

  // Burner: a grate, and a ring of blue flames while it brews.
  ctx.strokeStyle = col.strong; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(78, 296); ctx.lineTo(222, 296); ctx.stroke();
  if (on) {
    for (i = 0; i < 9; i++) {
      var fx = 106 + i * 11, fh = 9 + (still ? 0 : Math.sin(tt * 11 + i * 1.9) * 2.5) + (i % 2 ? 2 : 0);
      var gf = ctx.createLinearGradient(0, 296 - fh * 1.7, 0, 296);
      gf.addColorStop(0, 'rgba(110,170,220,0)'); gf.addColorStop(0.55, 'rgba(110,170,220,.75)'); gf.addColorStop(1, 'rgba(70,120,210,.95)');
      ctx.fillStyle = gf; ctx.beginPath(); ctx.moveTo(fx - 4, 296); ctx.quadraticCurveTo(fx - 1, 296 - fh, fx, 296 - fh * 1.7);
      ctx.quadraticCurveTo(fx + 1, 296 - fh, fx + 4, 296); ctx.closePath(); ctx.fill();
    }
  }

  // Base: solid, flaring towards the burner, with the safety valve.
  var bT = 206, bB = 288;
  ctx.fillStyle = metalFill(96, 204); ctx.strokeStyle = col.strong; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(110, bT); ctx.lineTo(190, bT); ctx.lineTo(204, bB - 6); ctx.lineTo(200, bB); ctx.lineTo(100, bB); ctx.lineTo(96, bB - 6); ctx.closePath();
  ctx.fill(); ctx.stroke(); facets(110, 190, 96, 204, bT, bB - 4);
  ctx.fillStyle = metal[1]; ctx.beginPath(); ctx.arc(122, 240, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = metal[4]; ctx.beginPath(); ctx.arc(122, 240, 2, 0, Math.PI * 2); ctx.fill();

  // Waist: the threaded joint between the two halves.
  ctx.fillStyle = metalFill(108, 192); ctx.beginPath(); animRoundRect(ctx, 108, 192, 84, 15, 3); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(110, 197); ctx.lineTo(190, 197); ctx.moveTo(110, 202); ctx.lineTo(190, 202); ctx.stroke();

  // Handle: black, bolted to the top chamber on its right.
  ctx.strokeStyle = col.dark ? '#0E0D0C' : '#1F1D1B'; ctx.lineWidth = 11; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(198, 122); ctx.lineTo(236, 128); ctx.quadraticCurveTo(244, 130, 242, 140); ctx.lineTo(234, 176); ctx.quadraticCurveTo(232, 184, 222, 182); ctx.lineTo(188, 178); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(206, 121); ctx.lineTo(234, 126); ctx.stroke();

  // Top chamber: one piece with its pouring spout, flaring to the rim.
  var rY = 106, tB = 192;
  ctx.fillStyle = metalFill(84, 206); ctx.strokeStyle = col.strong; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(114, tB); ctx.lineTo(98, rY + 8); ctx.lineTo(80, rY - 4); ctx.quadraticCurveTo(88, rY - 4, 98, rY);
  ctx.lineTo(204, rY); ctx.lineTo(186, tB); ctx.closePath(); ctx.fill(); ctx.stroke();
  facets(102, 204, 114, 186, rY + 2, tB);

  // Looking in through the open top: the dark interior, the column's
  // mouth in the middle, and the coffee's surface climbing towards the rim.
  var oX = 151, oRx = 50, oRy = 13;
  ctx.save(); ctx.beginPath(); ctx.ellipse(oX, rY, oRx, oRy, 0, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = col.dark ? '#0B0908' : '#2A2420'; ctx.fillRect(oX - oRx, rY - oRy, oRx * 2, oRy * 2);
  ctx.strokeStyle = metal[3]; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(oX, rY - 1, oRx - 1, oRy - 1, 0, Math.PI, Math.PI * 2); ctx.stroke();
  var depth = (1 - flow) * 22;
  if (flow < 0.95) {        // the column's top, until the coffee covers it
    ctx.fillStyle = metal[1]; ctx.beginPath(); ctx.ellipse(oX, rY + 6 + Math.min(depth, 10) * 0.2, 8, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#120D09'; ctx.beginPath(); ctx.ellipse(oX, rY + 6 + Math.min(depth, 10) * 0.2, 5, 1.8, 0, 0, Math.PI * 2); ctx.fill();
  }
  if (flow > 0.01) {
    var sy = rY + 2 + depth * 0.45;
    var cg = ctx.createRadialGradient(oX, sy, 2, oX, sy, oRx);
    cg.addColorStop(0, gurgle > 0.3 ? '#C9A27A' : '#8A5A36'); cg.addColorStop(1, '#3A2418');
    ctx.fillStyle = cg; ctx.beginPath(); ctx.ellipse(oX, sy, oRx * (0.82 + flow * 0.16), oRy * (0.8 + flow * 0.18), 0, 0, Math.PI * 2); ctx.fill();
    // Fresh coffee welling from the column, ringed with foam.
    if (on && !still) {
      var pulse = 0.6 + 0.4 * Math.sin(tt * (gurgle > 0 ? 14 : 5));
      ctx.fillStyle = 'rgba(201,162,122,' + (0.55 + gurgle * 0.35) + ')';
      ctx.beginPath(); ctx.ellipse(oX, sy, 9 + pulse * 3, 3 + pulse, 0, 0, Math.PI * 2); ctx.fill();
      for (i = 0; i < 7; i++) {
        var ph = ((tt * (1.2 + gurgle * 2) + animRnd(i) * 3) % 1), ang = animRnd(i + 4) * Math.PI * 2;
        ctx.fillStyle = 'rgba(232,210,180,' + 0.6 * (1 - ph) + ')';
        ctx.beginPath(); ctx.arc(oX + Math.cos(ang) * (8 + ph * 26), sy + Math.sin(ang) * (2 + ph * 6), 1 + ph, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  ctx.restore();
  ctx.strokeStyle = metal[2]; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(oX, rY, oRx, oRy, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = col.strong; ctx.lineWidth = 1; ctx.stroke();

  // Lid: tipped back on its hinge beside the handle, knob on top.
  ctx.save(); ctx.translate(204, rY - 2); ctx.rotate(1.25);
  ctx.fillStyle = metalFill(-110, 0); ctx.strokeStyle = col.strong; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-108, 0); ctx.lineTo(0, 0); ctx.lineTo(-6, -10); ctx.quadraticCurveTo(-54, -24, -102, -10); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = col.dark ? '#0E0D0C' : '#1F1D1B'; ctx.beginPath(); animRoundRect(ctx, -62, -28, 16, 9, 4); ctx.fill();
  ctx.restore();
  ctx.fillStyle = metal[1]; ctx.strokeStyle = col.strong; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(204, rY - 2, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

  // Steam off the open top once coffee is in.
  if (flow > 0.25) {
    for (var wv = 0; wv < 3; wv++) {
      ctx.strokeStyle = 'rgba(' + col.steam + ',' + 0.2 * Math.min(1, (flow - 0.25) * 2) * (still ? 0.5 : 1) + ')';
      ctx.lineWidth = 2.5; ctx.beginPath();
      for (k = 0; k <= 12; k++) ctx[k ? 'lineTo' : 'moveTo'](128 + wv * 22 + Math.sin(tt * 1.2 + wv * 2 + k * 0.6) * (1.5 + k * 0.45), rY - 8 - k * 2.8);
      ctx.stroke();
    }
  }
}

function drawShotAnim(ctx, tt, M, col, still) {
  var u = tt / M.total * 28, flow = shotProfile(u), vol = animAt(M.cum, M.dt, tt), blond = animEase((u - 23) / 5);
  // Group head and portafilter.
  ctx.fillStyle = col.sunken; ctx.strokeStyle = col.strong; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.beginPath(); animRoundRect(ctx, 70, 0, 160, 30, 6); ctx.fill(); ctx.stroke();
  ctx.fillStyle = col.card; ctx.beginPath();
  ctx.moveTo(82, 30); ctx.lineTo(218, 30); ctx.lineTo(210, 62); ctx.quadraticCurveTo(208, 70, 200, 70);
  ctx.lineTo(100, 70); ctx.quadraticCurveTo(92, 70, 90, 62); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(214, 42); ctx.lineTo(290, 46); ctx.quadraticCurveTo(298, 48, 296, 56); ctx.lineTo(212, 58); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = col.wood; ctx.beginPath(); animRoundRect(ctx, 248, 45, 46, 11, 5); ctx.fill();
  ctx.fillStyle = col.sunken;
  [128, 160].forEach(function (sx) { ctx.beginPath(); animRoundRect(ctx, sx, 70, 12, 12, 3); ctx.fill(); ctx.stroke(); });

  var spouts = [134, 166], cupTop = 196, cupBot = 262, cupL = 104, cupR = 196;
  var level = cupBot - 4 - Math.max(0, Math.min(1, vol / (M.yieldG * 1.2))) * (cupBot - cupTop - 14);
  var crema = vol > 1 ? Math.max(4, Math.min(11, 4 + vol / M.yieldG * 9)) : 0;
  var stream = flow > 0.9;
  spouts.forEach(function (sx, si) {
    var dir = si ? -1 : 1;
    if (!stream && flow > 0.05) {
      var period = 1 / (flow * 1.4), ph = ((u + si * 0.37) % period) / period, r = 1.5 + ph * 3;
      ctx.fillStyle = animMix('#4A2B18', '#8A5A36', 0.3); ctx.beginPath();
      if (ph < 0.75) ctx.ellipse(sx, 84 + r, r * 0.9, r, 0, 0, Math.PI * 2);
      else ctx.ellipse(sx, 90 + (ph - 0.75) / 0.25 * (level - 90), 2.6, 3.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (stream) {
      var w = Math.max(1.4, Math.min(3.4, flow * 1.8)) * (1 - blond * 0.35), top = 84, bot = level - crema * 0.3;
      ctx.strokeStyle = animMix('#4A2B18', '#C9A27A', blond * 0.8); ctx.lineWidth = w; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx, top);
      for (var y = top; y <= bot; y += 4) ctx.lineTo(sx + dir * (y - top) * 0.04 + Math.sin(y * 0.15 - tt * 9) * 0.5, y);
      ctx.stroke();
      if (!still && blond < 0.9) {      // tiger striping
        ctx.strokeStyle = 'rgba(217,185,143,' + (0.55 * (1 - blond)) + ')'; ctx.lineWidth = w * 0.7;
        for (var b = 0; b < 8; b++) {
          var yy = top + ((tt * 90 + b * 22) % (bot - top));
          ctx.beginPath(); ctx.moveTo(sx + dir * (yy - top) * 0.04, yy); ctx.lineTo(sx + dir * (yy + 6 - top) * 0.04, Math.min(yy + 6, bot)); ctx.stroke();
        }
      }
    }
  });

  // A glass cup: dark body, crema on top, a speckle of foam.
  function cup() {
    ctx.moveTo(cupL, cupTop); ctx.lineTo(cupR, cupTop); ctx.lineTo(cupR - 4, cupBot - 22); ctx.quadraticCurveTo(cupR - 8, cupBot, 170, cupBot);
    ctx.lineTo(130, cupBot); ctx.quadraticCurveTo(cupL + 8, cupBot, cupL + 4, cupBot - 22); ctx.closePath();
  }
  ctx.save(); ctx.beginPath(); cup(); ctx.clip();
  if (vol > 0.3) {
    var g = ctx.createLinearGradient(0, level, 0, cupBot); g.addColorStop(0, '#3A2418'); g.addColorStop(1, '#1E120B');
    ctx.fillStyle = g; ctx.fillRect(cupL, level, cupR - cupL, cupBot - level);
    var cg = ctx.createLinearGradient(0, level - crema, 0, level + 2);
    cg.addColorStop(0, animMix('#D9B98F', '#E8D2B4', blond)); cg.addColorStop(1, '#9A6B45');
    ctx.fillStyle = cg; ctx.fillRect(cupL, level - crema, cupR - cupL, crema + 2);
    for (var i = 0; i < 40; i++) {
      ctx.fillStyle = 'rgba(122,74,42,' + (0.25 + animRnd(i) * 0.3) + ')'; ctx.beginPath();
      ctx.arc(animLerp(cupL + 3, cupR - 3, animRnd(i + 5)), level - crema + animRnd(i + 50) * crema, 0.6 + animRnd(i + 9) * 1.1, 0, Math.PI * 2); ctx.fill();
    }
    if (stream) spouts.forEach(function (sx) {
      ctx.strokeStyle = 'rgba(232,210,180,.5)'; ctx.lineWidth = 1; ctx.beginPath();
      ctx.ellipse(sx, level - crema + 1, 5 + Math.sin(tt * 8) * 1.5, 1.5, 0, 0, Math.PI * 2); ctx.stroke();
    });
  }
  ctx.restore();
  ctx.strokeStyle = col.glass; ctx.lineWidth = 2; ctx.beginPath(); cup(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cupR, 206); ctx.bezierCurveTo(cupR + 22, 206, cupR + 22, 236, cupR - 2, 236); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(cupL + 8, cupTop + 6, 5, cupBot - cupTop - 22);
  ctx.strokeStyle = col.strong; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(78, 276); ctx.lineTo(222, 276); ctx.stroke();
  var sa = Math.max(0, Math.min(1, (vol / M.yieldG - 0.25) * 2)) * (still ? 0.4 : 1);
  if (sa > 0) {
    for (var wv = 0; wv < 2; wv++) {
      ctx.strokeStyle = 'rgba(' + col.steam + ',' + 0.2 * sa + ')'; ctx.lineWidth = 2.5; ctx.beginPath();
      for (var k = 0; k <= 10; k++) ctx[k ? 'lineTo' : 'moveTo'](140 + wv * 22 + Math.sin(tt * 1.1 + wv * 2 + k * 0.6) * (1.5 + k * 0.4), cupTop - 6 - k * 2.4);
      ctx.stroke();
    }
  }
}

function buildTimerEl(r, plan) {
  var me = findIn('method', r.methodId);
  var kind = animKindFor(me, plan);
  var shot = kind === 'shot';
  var rowsHTML = plan.segs.map(function (s, i) {
    return '<li class="timer-step" data-i="' + i + '">' +
      '<span class="ts-t">' + esc(mmss(s.start)) + '</span>' +
      '<span class="ts-l">' + esc(t(s.label)) + '</span>' +
      (s.water ? '<span class="ts-w">+' + s.water + ' g</span>' : '<span class="ts-w"></span>') +
    '</li>';
  }).join('');

  var wrap = document.createElement('div');
  // Fullscreen, not a floating dialog — brewing wants undivided attention,
  // not a card sharing space with the library behind it. See .overlay-full.
  wrap.className = 'overlay overlay-full' + (shot ? ' is-shot' : '') + (plan.segs.length === 1 ? ' is-single' : '');
  wrap.innerHTML =
    '<div class="sheet narrow sheet-timer" role="dialog" aria-modal="true" aria-label="' + esc(titleOf(r)) + '">' +
      '<div class="sheet-head">' +
        '<div class="tm-head">' +
          '<button class="tm-circ glass" data-glass="4" data-action="close-modal" aria-label="' + esc(t('Close')) + '">' + ICON.close + '</button>' +
          '<span class="tm-title"><h2>' + esc(titleOf(r)) + '</h2><span class="timer-eyebrow"></span></span>' +
          '<button class="tm-circ glass timer-mute" data-glass="4" data-action="timer-mute"></button>' +
        '</div>' +
      '</div>' +
      '<div class="sheet-body timer-body">' +
        '<div class="timer-hero">' +
          '<div class="tm-clock' + (plan.water || shot ? ' is-split' : '') + '">' +
            '<span class="tm-time"><span class="timer-elapsed" role="timer" aria-live="off">0:00</span>' +
            '<span class="timer-total">' + esc(t('of')) + ' ' + esc(mmss(plan.total)) + '</span></span>' +
            (plan.water
              ? '<span class="tm-water"><span class="timer-poured">0<small> g</small></span>' +
                  '<span class="timer-total">' + esc(t('of')) + ' ' + plan.water + ' g ' + esc(t('poured')) + '</span></span>'
              : shot && Number(r.dose) > 0
                ? '<span class="tm-water"><span class="timer-poured is-dose">' + num(r.dose) + '<small> g</small></span>' +
                    '<span class="timer-total">' + esc(t('in the basket')) + '</span></span>'
                : '') +
          '</div>' +
          (kind ? animHTML(t({ aero: 'AeroPress brewing into the mug', pour: 'Water in the cone', shot: 'Espresso pouring into the cup',
            immersion: 'Coffee steeping in the press', moka: 'Moka pot brewing on the stove' }[kind])) : '') +
          '<div class="timer-now glass" data-glass="8">' +
            '<span class="tm-done-cup" aria-hidden="true">' + DONE_CUP + '</span>' +
            '<span class="timer-now-kicker"></span>' +
            '<span class="timer-now-label"></span>' +
            '<span class="timer-now-sub"></span>' +
            '<div class="tm-rate rate" role="group" aria-label="' + esc(t('Rate this cup')) + '">' +
              [1, 2, 3, 4, 5].map(function (n) {
                return '<button type="button" data-action="rate-recipe" data-id="' + esc(r.id) + '" data-v="' + n + '" ' +
                  'aria-label="' + esc(t('Rate') + ' ' + n) + '">' + iconBean(false) + '</button>';
              }).join('') +
            '</div>' +
          '</div>' +
          '<div class="timer-next"><span class="nt"></span><span class="nx"></span></div>' +
          '<p class="sr-only timer-announce" role="status" aria-live="polite"></p>' +
        '</div>' +
        '<div class="timer-list">' +
          '<ol class="timer-steps">' + rowsHTML + '</ol>' +
        '</div>' +
      '</div>' +
      '<div class="sheet-foot timer-foot glass" data-glass="6">' +
        '<button class="timer-side glass" data-glass="4" data-action="timer-reset" aria-label="' + esc(t('Restart')) + '" title="' + esc(t('Restart')) + '">' + ICON.replay + '</button>' +
        '<div class="tm-play">' +
          '<svg class="tm-ring" viewBox="0 0 100 100" aria-hidden="true">' +
            '<circle class="ttrack" cx="50" cy="50" r="' + TM_R + '"></circle>' +
            '<circle class="tprog" cx="50" cy="50" r="' + TM_R + '" transform="rotate(-90 50 50)" ' +
              'stroke-dasharray="0 ' + TM_C.toFixed(2) + '"></circle>' +
          '</svg>' +
          '<button class="timer-toggle glass" data-glass="3" data-action="timer-toggle"></button>' +
        '</div>' +
        (shot
          ? '<button class="timer-side glass" data-glass="4" data-action="timer-skip" aria-label="' + esc(t('Stop the shot')) + '" title="' + esc(t('Stop the shot')) + '">' + ICON.stop + '</button>'
          : '<button class="timer-side glass" data-glass="4" data-action="timer-skip" aria-label="' + esc(t('Skip to next step')) + '" title="' + esc(t('Skip to next step')) + '">' + ICON.skip + '</button>') +
      '</div>' +
    '</div>';
  wrap.addEventListener('mousedown', function (ev) { if (ev.target === wrap) closeModal(); });
  return wrap;
}

function openTimer(id) {
  var r = viewRecipe(recipeById(id));
  if (!r) return;
  var plan = timerPlan(r);
  if (!plan) { toast(t('Add a brew time or pouring steps first.')); return; }

  stopTimer();
  timer = {
    shot: animKindFor(findIn('method', r.methodId), plan) === 'shot',
    anim: (function (kind) {
      return kind === 'aero' ? aeroModel(plan, r.dose, r.water)
        : kind === 'immersion' ? immersionModel(plan, r.dose, r.water)
        : kind === 'moka' ? mokaModel(plan)
        : kind === 'shot' ? shotModel(plan, r.dose)
        : kind === 'pour' ? pourModel(plan, r.dose) : null;
    })(animKindFor(findIn('method', r.methodId), plan)),
    id: id, ratio: (Number(r.dose) > 0 && Number(r.water) > 0) ? ratio(r.dose, r.water) : '',
    plan: plan, el: buildTimerEl(r, plan), sheet: null,
    elapsed: 0, running: false, from: 0, at: 0, raf: 0, seg: -1, wake: null,
    cueSeg: null, warned: false, tick: 0
  };
  timer.sheet = timer.el.querySelector('.sheet-timer');

  openModal({
    render: function () { return timer.el; },
    onClose: stopTimer,
    // A stray tap outside the sheet or an Escape while the kettle's still
    // going is exactly the moment a silent close costs the most — ask first.
    guardClose: function () {
      if (!timer || !timer.running) return true;
      confirmDanger({
        title: t('Still brewing'),
        body: '<p>Your timer is running. Leaving now will stop it and you’ll need to start over.</p>',
        confirmLabel: t('Leave anyway'),
        onConfirm: function () {
          closeModal();       // dismiss this confirmation
          closeModal(true);   // then force-close the timer underneath it
        }
      });
      return false;
    }
  });
  // Opens paused: you press play when the kettle is over the bed, not when
  // the sheet happens to finish animating in.
  timerPaint();
  timerControls();
  glassAll(timer.el);
}

function timerPaint() {
  if (!timer) return;
  var plan = timer.plan, el = timer.el;
  var e = Math.min(Math.max(timer.elapsed, 0), plan.total);
  var frac = e / plan.total;
  var done = e >= plan.total;

  el.querySelector('.tprog').setAttribute('stroke-dasharray',
    (frac * TM_C).toFixed(2) + ' ' + TM_C.toFixed(2));
  el.querySelector('.timer-elapsed').textContent = mmss(Math.floor(e));

  var i = 0, k;
  for (k = 0; k < plan.segs.length; k++) if (e >= plan.segs[k].start) i = k;

  // Per-step readouts refresh every frame; the heavier work below only
  // runs when the step actually changes.
  var seg = plan.segs[i];
  var segLen = seg.end - seg.start;
  var left = mmss(Math.max(0, Math.ceil(seg.end - e)));
  var kick = el.querySelector('.timer-now-kicker');
  // A step with a pour time pours over its first `pour` seconds, then waits
  // for the next step; one without spreads the water across the step.
  var pourFor = seg.pour ? Math.min(seg.pour, segLen) : segLen;
  var pouringNow = !!seg.water && e - seg.start < pourFor;
  if (!done) {
    // Steps that add no water are not pours — a drawdown or a steep says
    // so rather than announcing a pour of nothing.
    if (seg.water && seg.pour) {
      kick.textContent = pouringNow
        ? t('Pouring now') + ' · ' + mmss(Math.max(0, Math.ceil(seg.start + pourFor - e))) + ' ' + t('left')
        : t('Wait') + ' · ' + t('next pour in') + ' ' + left;
    } else {
      kick.textContent = (seg.water ? t('Pouring now') : t('Now')) + ' · ' + left + ' ' + t('left');
    }
    timer.sheet.classList.toggle('is-waiting', !!seg.water && !pouringNow);
  }
  animDraw(e);
  var poured = el.querySelector('.timer-poured:not(.is-dose)');
  if (poured) {
    var pct = pourFor > 0 ? Math.min(1, Math.max(0, (e - seg.start) / pourFor)) : 1;
    var g = seg.from + (seg.upto - seg.from) * pct;
    poured.innerHTML = Math.round(g) + '<small> g</small>';
    timer.sheet.classList.toggle('is-pouring', pouringNow && timer.running && !done);
  }

  if (i === timer.seg) return;
  timer.seg = i;

  el.querySelector('.timer-eyebrow').textContent = timer.shot
    ? nameOf('method', recipeById(timer.id) ? recipeById(timer.id).methodId : '')
    : t('Step') + ' ' + (i + 1) + ' ' + t('of') + ' ' + plan.segs.length;
  var nxt = plan.segs[i + 1];
  el.querySelector('.timer-next .nt').textContent = nxt ? t('Next') + ' · ' + mmss(nxt.start) : t('Last step');
  el.querySelector('.timer-next .nx').textContent = nxt ? t(nxt.label) : '';

  var rows = el.querySelectorAll('.timer-step');
  for (k = 0; k < rows.length; k++) {
    rows[k].classList.toggle('is-now', k === i);
    rows[k].classList.toggle('is-past', k < i);
  }
  el.querySelector('.timer-now-label').textContent = t(seg.label);
  el.querySelector('.timer-now-sub').textContent = seg.water
    ? t('Add') + ' ' + seg.water + ' g' + (seg.pour ? ' ' + t('in') + ' ' + seg.pour + ' s' : '') +
      (seg.from ? ' · ' + t('up to') + ' ' + seg.upto + ' g' : '')
    : '';
  var say = el.querySelector('.timer-announce');
  if (say) say.textContent = t('Step') + ' ' + (i + 1) + ' ' + t('of') + ' ' + plan.segs.length + '. ' + t(seg.label);
  if (rows[i] && rows[i].offsetParent) rows[i].scrollIntoView({ block: 'nearest' });

  // Restart the attention pulse from the top on every step change.
  timer.sheet.classList.remove('pulse');
  void timer.sheet.offsetWidth;
  timer.sheet.classList.add('pulse');
}

// Shows the recipe's cup score on the beans of the finished brew.
function timerRatePaint() {
  if (!timer) return;
  var r = recipeById(timer.id);
  var n = (r && r.rating) || 0;
  var btns = timer.el.querySelectorAll('.tm-rate button');
  for (var i = 0; i < btns.length; i++) {
    var on = i < n;
    btns[i].classList.toggle('on', on);
    btns[i].innerHTML = iconBean(on);
  }
}

// The ring has closed: say so in the pour card and offer to go again.
function timerFinish() {
  if (!timer) return;
  timerRun(false);
  timer.sheet.classList.add('is-done');
  var plan = timer.plan;
  timer.el.querySelector('.timer-now-kicker').textContent = t('Done');
  timer.el.querySelector('.timer-now-label').textContent = t('Enjoy your cup');
  timer.el.querySelector('.timer-now-sub').textContent = [mmss(plan.total),
    plan.water ? plan.water + ' g' : '', timer.ratio || ''].filter(Boolean).join(' · ');
  timer.sheet.classList.remove('is-pouring');
  timerRatePaint();
  var say = timer.el.querySelector('.timer-announce');
  if (say) say.textContent = t('Brew complete.');
  timerControls();
}

/* One tick of the brew: advance the clock, fire any cue this moment has
   earned, repaint. Driven from two places on purpose — see timerRun. */
function timerTick() {
  if (!timer || !timer.running) return;
  timer.elapsed = timer.from + (performance.now() - timer.at) / 1000;
  if (timer.elapsed >= timer.plan.total) {
    timer.elapsed = timer.plan.total;
    timerPaint();
    timerFinish();
    timerCue('done');
    return;
  }
  timerRunCues();
  timerPaint();
}

// The smooth half: repaints at display rate, and stops dead when the page is
// hidden — which is fine, because nothing is visible to paint.
function timerFrame() {
  if (!timer || !timer.running) return;
  timerTick();
  if (timer && timer.running) timer.raf = requestAnimationFrame(timerFrame);
}

function timerRun(on) {
  if (!timer) return;
  timer.running = on;
  if (on) {
    timer.from = timer.elapsed;
    timer.at = performance.now();
    // Pressing play is the gesture browsers require before audio may start.
    timerAudio();
    timer.raf = requestAnimationFrame(timerFrame);
    /* The reliable half. requestAnimationFrame is suspended entirely while
       the page is hidden — a dimmed screen, a lock, another tab — so a
       timer driven by it alone stops counting and silently skips every cue
       the moment you put the phone down, which is precisely when you were
       relying on being told. An interval keeps ticking (throttled, but a
       brew cue does not need sub-second precision), and elapsed time is
       read from the wall clock either way, so the two can never disagree. */
    clearInterval(timer.tick);
    timer.tick = setInterval(timerTick, 250);
    timerWake(true);
  } else {
    cancelAnimationFrame(timer.raf);
    clearInterval(timer.tick);
    timer.tick = 0;
    timerWake(false);
  }
  timerControls();
}

function timerControls() {
  if (!timer) return;
  var done = timer.elapsed >= timer.plan.total;
  var btn = timer.el.querySelector('.timer-toggle');
  // v3's label ladder: Start brewing → Pause → Resume → Brew again. The
  // button is an icon now, so the ladder is its accessible name.
  var label = done ? t('Brew again')
    : timer.running ? t('Pause')
    : timer.elapsed > 0 ? t('Resume') : t('Start brewing');
  btn.innerHTML = done ? ICON.replay : timer.running ? TM_PAUSE : ICON.play;
  btn.setAttribute('aria-label', label);
  btn.setAttribute('title', label);

  var mute = timer.el.querySelector('.timer-mute');
  if (mute) {
    mute.innerHTML = timerMuted ? ICON.soundOff : ICON.soundOn;
    mute.setAttribute('aria-pressed', timerMuted ? 'true' : 'false');
    var ml = t(timerMuted ? 'Unmute step cues' : 'Mute step cues');
    mute.setAttribute('aria-label', ml);
    mute.setAttribute('title', ml);
    mute.classList.toggle('is-muted', timerMuted);
  }

  timer.sheet.classList.toggle('is-running', timer.running);
}

// Rewinds in place: a running timer keeps running from zero, a paused one
// stays paused at zero. Only "Brew again" (a finished ring) starts itself.
function timerReset(andRun) {
  if (!timer) return;
  var resume = andRun || timer.running;
  timerRun(false);
  timer.elapsed = 0;
  timer.seg = -1;
  timer.cueSeg = null;
  timer.warned = false;
  timer.sheet.classList.remove('is-done');
  timerPaint();
  if (resume) timerRun(true); else timerControls();
}

function stopTimer() {
  if (!timer) return;
  cancelAnimationFrame(timer.raf);
  clearInterval(timer.tick);
  timerWake(false);
  timer = null;
}

// Brewing means watching the screen without touching it, which is exactly
// when the phone decides to sleep. Best-effort only — unsupported browsers
// and rejected requests just carry on without it.
function timerWake(on) {
  if (!timer || !navigator.wakeLock) return;
  if (on) {
    if (timer.wake) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      if (timer && timer.running) timer.wake = lock;
      else lock.release().catch(function () {});
    }, function () {});
  } else if (timer.wake) {
    timer.wake.release().catch(function () {});
    timer.wake = null;
  }
}

/* ---------------------------------------------------------
   8. Modal stack
   --------------------------------------------------------- */

var modalRoot = document.getElementById('modalRoot');
var stack = [];

function openModal(m) {
  var top = stack[stack.length - 1];
  if (top && top.capture) top.capture();
  stack.push(m);
  renderModals();
}
// `force` bypasses a modal's own guardClose — used once a guarded modal's
// own confirmation has already been answered, so it doesn't ask twice.
function closeModal(force) {
  var top = stack[stack.length - 1];
  if (!force && top && top.guardClose && !top.guardClose()) return;
  var m = stack.pop();
  if (m && m.onClose) m.onClose();
  renderModals();
}
/* Back closes a page instead of leaving the app.

   One history entry is kept per open page, and the two are reconciled here
   rather than in closeModal, because not every path goes through it —
   saveEntity pops the stack itself so the callback can write into the
   parent's draft before anything repaints. renderModals is the one place
   they all meet.

   Unwinding only touches entries still known to be ours. Saving a recipe
   from another recipe's page changes the hash right after closing, which
   puts an entry on top that is not a page; stepping back over it would
   undo that navigation instead of tidying up. */
var historyDepth = 0;
var ignorePops = 0;
var inPopstate = false;

function syncHistory() {
  var want = stack.length;
  while (historyDepth < want) {
    historyDepth++;
    history.pushState({ brewDepth: historyDepth }, '');
  }
  if (want < historyDepth) {
    var extra = historyDepth - want;
    historyDepth = want;
    if (!history.state || !history.state.brewDepth) return;   // not ours to unwind
    ignorePops++;
    // Deferred, and re-checked when it runs. Saving a recipe closes the page
    // and *then* changes the hash to the recipe just saved; unwinding
    // regardless would undo that and drop the reader back on the old one.
    setTimeout(function () {
      if (!history.state || !history.state.brewDepth) { ignorePops--; return; }
      history.go(-extra);
    }, 0);
  }
}

window.addEventListener('popstate', function (ev) {
  if (ignorePops > 0) { ignorePops--; return; }
  var want = (ev.state && ev.state.brewDepth) || 0;
  historyDepth = want;
  inPopstate = true;
  while (stack.length > want) {
    var before = stack.length;
    closeModal();
    // Not just "unchanged": a running timer answers a close by opening a
    // confirmation, so the stack grows. Either way nothing was dismissed,
    // so stop and restore an entry for whatever is still open.
    if (stack.length >= before) {
      inPopstate = false;
      syncHistory();
      return;
    }
  }
  inPopstate = false;
  // Landing on an entry that outlived its page — left behind when a save
  // navigated away — would otherwise leave the count too high, and the next
  // page would open without an entry of its own for Back to consume.
  historyDepth = stack.length;
});

function renderModals() {
  // Every re-render throws the sheets away and builds fresh ones, which resets
  // their scroll to the top. Adding or removing a step near the bottom of a
  // long form would otherwise fling you back to the first field, so carry each
  // sheet's scroll position across the rebuild.
  var scrolls = stack.map(function (m) {
    var body = m.el && m.el.querySelector('.sheet-body');
    return body ? body.scrollTop : 0;
  });

  modalRoot.innerHTML = '';
  // Titles gather as the stack renders, so each page's breadcrumb can name
  // the pages that led to it.
  var trail = baseCrumbs();
  stack.forEach(function (m, i) {
    var el = m.render();
    m.el = el;
    modalRoot.appendChild(el);
    if (scrolls[i]) {
      var body = el.querySelector('.sheet-body');
      if (body) body.scrollTop = scrolls[i];
    }

    var crumbs = el.querySelector('.crumbs');
    var heading = el.querySelector('.page-head h2');
    if (crumbs) crumbs.innerHTML = crumbTrail(trail, i);
    if (heading) trail.push({ label: heading.textContent, depth: i });
    glassAll(el);

  });

  /* A page is hidden only when another page covers it. Anything that still
     floats — a confirmation, the timer — is meant to sit *over* the page
     that opened it, and hiding that page would drop the reader back to the
     recipe list behind. The pages themselves stay in the DOM regardless: a
     form's element is where its typed values are read back from. */
  var pages = stack.map(function (m) {
    return m.el && m.el.classList.contains('page') ? m.el : null;
  });
  pages.forEach(function (el, i) {
    if (!el) return;
    var coveredByPage = false;
    for (var j = i + 1; j < pages.length; j++) if (pages[j]) coveredByPage = true;
    el.classList.toggle('is-behind', coveredByPage);
  });

  document.body.style.overflow = stack.length ? 'hidden' : '';
  /* The page covers the app, so the app must leave the tab order with it.
     Without this, tabbing past a form's last field walks into the hundred
     recipe links still rendered underneath. inert also takes them out of
     the accessibility tree; the attribute is ignored where unsupported, so
     aria-hidden carries those cases. */
  var covered = stack.some(function (m) {
    return m.el && m.el.classList && m.el.classList.contains('page');
  });
  [view, document.querySelector('.foot'), document.querySelector('.topbar')].forEach(function (el) {
    if (!el) return;
    if (covered) { el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true'); }
    else { el.removeAttribute('inert'); el.removeAttribute('aria-hidden'); }
  });
  var last = stack[stack.length - 1];
  // Only on the way in. Re-focusing the first field on every re-render is the
  // other half of the same jump — the browser scrolls whatever it focuses into
  // view, so editing a step at the bottom would drag the form back to the top.
  if (last && last.el && !last.focused) {
    last.focused = true;
    // Confirmation dialogs have no field to land on — fall back to Cancel,
    // the safe default action, so a keyboard user can hit Enter to back
    // out immediately instead of landing nowhere.
    var focusable = last.el.querySelector('input,select,textarea,.dialog .btn-ghost');
    if (focusable && !('ontouchstart' in window)) focusable.focus();
  }

  // Not while unwinding: the browser has already moved, and matching it
  // again would step back twice for one press.
  if (!inPopstate) syncHistory();
}

// You pressed "Add step" because you have a step to write — put the cursor in
// it. Scrolls the fresh row into view too, which is the one case where moving
// the view is what you actually asked for.
function focusLastStep(m, rowSelector) {
  if (!m.el) return;
  var rows = m.el.querySelectorAll(rowSelector);
  if (!rows.length) return;
  var input = rows[rows.length - 1].querySelector('input');
  if (!input) return;
  input.focus();
  if (input.scrollIntoView) input.scrollIntoView({ block: 'nearest' });
}

/* Forms are pages, not sheets. They are long, they nest — a recipe can
   open a coffee, which can open a roaster — and on a phone a stack of
   sheets over a dimmed list gives no sense of where you are. A page with a
   breadcrumb does, and the trail is just the modal stack drawn out.

   The head and foot stay pinned with the body scrolling between them, so
   Save is always reachable above the keyboard. Class names from the sheet
   era are kept where behaviour hangs off them (.sheet-body carries scroll
   position across re-renders).

   Confirmations are deliberately not pages: v3 reserves the centred modal
   for destructive choices, and an interruption should read as one. */
function sheet(opts) {
  var wrap = document.createElement('div');
  wrap.className = 'page';
  wrap.innerHTML =
    '<div class="page-inner' + (opts.narrow ? ' narrow' : '') + '" role="dialog" aria-modal="true">' +
      '<div class="page-head">' +
        '<nav class="crumbs" aria-label="Breadcrumb"></nav>' +
        '<div class="page-title-row">' +
          '<h2>' + esc(opts.title) + '</h2>' +
          '<button class="iconbtn" data-action="close-modal" aria-label="Close">' + ICON.close + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="sheet-body">' + opts.body + '</div>' +
      '<div class="sheet-foot glass" data-glass="6">' + opts.foot + '</div>' +
    '</div>';
  return wrap;
}

/* Renders the trail leading to the page at `depth`, every step of it
   clickable: a crumb pointing into the app closes the whole stack and goes
   there, one pointing at an earlier page closes back down to it. */
function crumbTrail(trail, depth) {
  return trail.map(function (c) {
    if (c.hash !== undefined) {
      return '<a href="' + esc(c.hash) + '" data-action="crumb-home" data-hash="' + esc(c.hash) + '">' +
        esc(c.label) + '</a>';
    }
    return '<button data-action="crumb-back" data-depth="' + c.depth + '">' + esc(c.label) + '</button>';
  }).join('<span class="crumb-sep" aria-hidden="true">/</span>') +
    (trail.length ? '<span class="crumb-sep" aria-hidden="true">/</span>' : '');
}

/* Where the trail starts: the recipe list, plus the recipe being looked at
   if the form was opened from one. Everything after this comes from the
   stack itself. */
function baseCrumbs() {
  if ((location.hash || '') === '#/library') {
    return [{ label: t('Library'), hash: '#/library' }];
  }
  var out = [{ label: t('Recipes'), hash: '#/' }];
  var m = (location.hash || '').match(/^#\/r\/(.+)$/);
  if (m) {
    var r = recipeById(decodeURIComponent(m[1]));
    if (r) out.push({ label: titleOf(r), hash: location.hash });
  }
  return out;
}

// A themed stand-in for the browser's own confirm() — used for anything
// that destroys data, so the moment users are most at risk of a mis-click
// never drops out of the app's own design language into an OS dialog.
// `body` is HTML (already escaped by the caller where it embeds user text).
//
// Deliberately its own centered dialog, not sheet() — v3 treats these as
// two different components: BottomSheet (forms, rises from the bottom
// edge) vs. Modal (centered, "reserved for confirmations and destructive
// choices"). Reusing sheet() here would dock every delete/reset prompt to
// the bottom edge on mobile along with ordinary forms, when the whole
// point of a centered dialog is that it reads as a deliberate interrupt
// rather than routine navigation.
function confirmDanger(opts) {
  var m = {
    _onConfirm: opts.onConfirm,
    render: function () {
      var wrap = document.createElement('div');
      wrap.className = 'overlay overlay-modal';
      wrap.innerHTML =
        '<div class="dialog" role="alertdialog" aria-modal="true" aria-label="' + esc(opts.title) + '">' +
          '<h2>' + esc(opts.title) + '</h2>' +
          '<div class="dialog-body">' + opts.body + '</div>' +
          '<div class="dialog-foot">' +
            '<button class="btn btn-ghost" data-action="close-modal">' + esc(t('Cancel')) + '</button>' +
            '<button class="btn btn-danger" data-action="confirm-danger">' + esc(opts.confirmLabel) + '</button>' +
          '</div>' +
        '</div>';
      wrap.addEventListener('mousedown', function (ev) { if (ev.target === wrap) closeModal(); });
      return wrap;
    }
  };
  openModal(m);
}

/* ---------------------------------------------------------
   9. Recipe form
   --------------------------------------------------------- */

function blankRecipe() {
  return {
    // Nothing is pre-filled: every field opens empty and leans on its
    // placeholder for the hint. A silently pre-selected grinder or a 94 already
    // sitting in the temperature box is a value the user never chose but that
    // gets saved as though they did — placeholders suggest without asserting.
    id: '', name: '', coffeeId: '',
    grinderId: '', grindSize: '',
    methodId: '',
    styleId: '',
    dose: '', water: '', temp: '', brewTime: '',
    steps: [{ t: '', label: '', water: '' }],
    notes: '', rating: 0, fav: false
  };
}

/* ---- searchable selects ----
   The recipe form's pickers outgrew a native <select>: fifty-eight coffees
   is a list you search, not one you scroll. Each select stays in the DOM,
   hidden, as the single source of truth — readRecipeForm reads it, and the
   steps preview hangs off its change events. The
   field on top only ever writes into it and fires change, so none of that
   logic has to know it exists.

   Styled with Cupform v3.1's Combobox classes, so these read as the same
   control as the filters page, minus the "on" fill: a chosen value in a
   form is an answer, not an active filter. */

// Accents are ignored so "familia" finds "Família" and "epoca" finds
// "Época" — typing them on a phone keyboard is the slow way round.
function fold(str) {
  return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function enhanceSelects(root) {
  [].forEach.call(root.querySelectorAll('select[data-search]:not([data-enhanced])'), enhanceSelect);
}

function enhanceSelect(sel) {
  sel.setAttribute('data-enhanced', '');
  sel.hidden = true;

  var listId = sel.id + '-list';
  var wrap = document.createElement('div');
  wrap.className = 'combo combo-form';
  wrap.innerHTML =
    '<div class="combo-field">' +
      '<input class="combo-input" id="' + sel.id + '-q" type="text" role="combobox" autocomplete="off" ' +
        'aria-autocomplete="list" aria-expanded="false" aria-controls="' + listId + '" />' +
      '<button type="button" class="combo-clear" tabindex="-1" aria-label="' + esc(t('Clear')) + '" hidden>' + ICON.close + '</button>' +
      '<button type="button" class="combo-toggle" tabindex="-1" aria-label="' + esc(t('Show options')) + '">' + ICON.chevDown + '</button>' +
    '</div>' +
    '<div class="combo-list" id="' + listId + '" role="listbox" hidden></div>';
  sel.parentNode.insertBefore(wrap, sel);

  // The field's own label points at the hidden select; move it to the
  // input so tapping the label still lands somewhere.
  var lbl = sel.closest('.field') && sel.closest('.field').querySelector('label[for="' + sel.id + '"]');
  if (lbl) lbl.setAttribute('for', sel.id + '-q');

  var field = wrap.querySelector('.combo-field');
  var input = wrap.querySelector('.combo-input');
  var list = wrap.querySelector('.combo-list');
  var clear = wrap.querySelector('.combo-clear');
  var active = -1, shown = [];

  function options() {
    return [].filter.call(sel.options, function (o) { return o.value; });
  }
  function placeholder() {
    var none = [].filter.call(sel.options, function (o) { return !o.value; })[0];
    return none ? none.text : '';
  }
  // The chosen value carries its secondary text too: two coffees can share a
  // name ("Gabriel Lamounier" from Sabino and from Williams & Sons), and the
  // field has to say which one it holds, not just the list.
  function current() {
    if (!(sel.selectedIndex >= 0 && sel.value)) return '';
    var o = sel.options[sel.selectedIndex], meta = o.getAttribute('data-meta');
    return o.text + (meta ? ' · ' + meta : '');
  }

  function showValue() {
    input.value = current();
    input.placeholder = placeholder();
    clear.hidden = !sel.value;
  }

  function paint() {
    var q = fold(input.value.trim());
    // While the box still shows the chosen value, list everything — you
    // opened it to change your mind, not to be shown your own answer.
    if (input.value === current()) q = '';
    // An option's secondary text (a coffee's roaster) is searchable too.
    shown = options().filter(function (o) {
      return !q || fold(o.text + ' ' + (o.getAttribute('data-meta') || '')).indexOf(q) !== -1;
    });
    if (active >= shown.length) active = shown.length - 1;
    list.innerHTML = shown.length
      ? shown.map(function (o, i) {
          var on = o.value === sel.value;
          return '<div class="combo-opt' + (on ? ' on' : '') + (i === active ? ' is-active' : '') + '" ' +
            'role="option" id="' + listId + '-' + i + '" aria-selected="' + on + '" data-i="' + i + '">' +
            '<span class="combo-opt-label">' + esc(o.text) + '</span>' +
            (o.getAttribute('data-meta') ? '<span class="combo-opt-meta is-text">' + esc(o.getAttribute('data-meta')) + '</span>' : '') +
            (on ? ICON.check : '') + '</div>';
        }).join('')
      : '<div class="combo-empty">' + esc(options().length
          ? t('Nothing matches') + ' “' + input.value.trim() + '”'
          : placeholder()) + '</div>';
    // Browsing with a finger and no keyboard yet: say how to start typing.
    // A <label> for the field rather than a clickable row: tapping it
    // focuses the field natively, which iOS treats as a real focus and
    // answers with the keyboard.
    if (browsing) {
      list.insertAdjacentHTML('afterbegin', '<label class="combo-hint" for="' + input.id + '">' +
        ICON.search + '<span>' + esc(t('Tap to search')) + '</span></label>');
    }
    input.setAttribute('aria-activedescendant', active >= 0 ? listId + '-' + active : '');
    var a = list.querySelector('.is-active');
    if (a) a.scrollIntoView({ block: 'nearest' });
  }

  function open() {
    var opening = list.hidden;
    if (opening) {
      active = -1;
      list.hidden = false;
      field.classList.add('open');
      input.setAttribute('aria-expanded', 'true');
    }
    paint();
    if (opening) fit();
  }
  /* The list lives inside the sheet's scrolling body, so a field near the
     bottom of the visible area — Brewing method or Grinder when the sheet
     first opens — had its list clipped exactly where the Cancel / Save
     footer begins. Scroll the form just enough for the list to clear it;
     if the form can't scroll that far, open the list upward instead. */
  function fit() {
    var scroller = wrap.closest('.sheet-body');
    wrap.classList.remove('drop-up');
    list.style.maxHeight = '';
    if (!scroller) return;
    var sb = scroller.getBoundingClientRect();
    var fr = field.getBoundingClientRect();
    // A clear gap, not flush: a list sitting on the footer's edge reads as
    // running underneath it.
    var over = list.getBoundingClientRect().bottom - sb.bottom + 16;
    if (over <= 0) return;
    var room = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
    // Never scroll the field itself out of view to make room.
    var canScroll = Math.min(room, fr.top - sb.top - 8);
    if (canScroll >= over) { scroller.scrollTop += over; return; }
    var below = sb.bottom - fr.bottom - 12, above = fr.top - sb.top - 12;
    if (above > below) {
      wrap.classList.add('drop-up');
      list.style.maxHeight = Math.max(120, above) + 'px';
    } else {
      if (canScroll > 0) { scroller.scrollTop += canScroll; below += canScroll; }
      list.style.maxHeight = Math.max(120, below) + 'px';
    }
  }
  function close() {
    wrap.classList.remove('drop-up');
    list.style.maxHeight = '';
    list.hidden = true;
    field.classList.remove('open');
    input.setAttribute('aria-expanded', 'false');
    // Locked again, so the next tap opens the list without a keyboard.
    input.readOnly = true;
    browsing = false;
    showValue();
  }
  function pick(value) {
    var changed = sel.value !== value;
    sel.value = value;
    close();
    if (changed) sel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /* How the field is reached decides how it opens. A finger opens the list
     to browse with no keyboard: on a phone the keyboard takes half the
     screen and leaves room for about three options. Tapping the field
     again switches to searching. A mouse or the Tab key goes straight to
     typing, since a physical keyboard costs no screen.

     iOS decides whether to show the keyboard at one moment only: when a
     tap moves focus onto a field that is editable right then. So browsing
     leaves the field unfocused, and the second tap makes it editable in
     pointerdown, before that tap's focus lands — a real focus onto an
     editable field, which is the one thing iOS answers with a keyboard.
     Unlocking a field that already has focus, or refocusing it from code,
     gets nothing. */
  var box = sel.closest('.field') || wrap;
  var touch = false, browsing = false, wantSearch = false;

  function browse() {
    browsing = true;
    input.readOnly = true;
    open();
  }
  function search() {
    browsing = false;
    input.readOnly = false;
    open();
    input.select();
  }

  box.addEventListener('pointerdown', function (ev) {
    touch = ev.pointerType === 'touch' || ev.pointerType === 'pen';
    // The second tap, on the field, its label, or the "Tap to search" row:
    // unlock now, so the focus this tap is about to cause is editable.
    if (browsing && (ev.target === input || ev.target.closest('label, .combo-hint'))) {
      wantSearch = true;
      input.readOnly = false;
    }
  }, true);

  input.readOnly = true;
  input.addEventListener('focus', function () {
    if (wantSearch || !touch) {
      wantSearch = false;
      search();
    } else {
      browse();
      // Hand focus back, so the next tap arrives on an unfocused field and
      // its focus is one iOS will raise the keyboard for.
      input.blur();
    }
    touch = false;
  });
  // A mouse click on a field still focused from a pick: no focus event is
  // coming, so open it for typing here.
  input.addEventListener('click', function () {
    if (list.hidden && document.activeElement === input) search();
  });
  // Typing highlights the first match, so Enter takes the best guess.
  input.addEventListener('input', function () { open(); active = 0; paint(); });
  input.addEventListener('blur', function () {
    // Browsing keeps the list open with nothing focused; only an outside
    // tap closes it (below).
    if (browsing) return;
    setTimeout(function () { if (document.activeElement !== input) close(); }, 0);
  });

  // While browsing nothing has focus, so there is no blur to close on.
  // Removes itself once the form it belongs to has gone.
  function outside(ev) {
    if (!wrap.isConnected) { document.removeEventListener('pointerdown', outside, true); return; }
    if (list.hidden || !browsing || box.contains(ev.target)) return;
    close();
  }
  document.addEventListener('pointerdown', outside, true);

  input.addEventListener('keydown', function (ev) {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      open();
      if (!shown.length) return;
      active = ev.key === 'ArrowDown'
        ? (active + 1) % shown.length
        : (active <= 0 ? shown.length - 1 : active - 1);
      paint();
    } else if (ev.key === 'Enter') {
      if (list.hidden) return;
      ev.preventDefault();
      if (shown[active]) pick(shown[active].value);
      else if (shown.length === 1) pick(shown[0].value);
    } else if (ev.key === 'Escape' && !list.hidden) {
      // Stop here: an Escape that reached the page would close the form.
      ev.preventDefault();
      ev.stopPropagation();
      close();
    }
  });
  // mousedown, not click: click lands after the input's blur has already
  // closed the list and the option is gone.
  list.addEventListener('mousedown', function (ev) {
    // The hint is a <label>; let it through so its tap reaches the field.
    if (ev.target.closest('.combo-hint')) return;
    // Anything else in the list must not steal focus from the field.
    ev.preventDefault();
    var opt = ev.target.closest('.combo-opt');
    if (!opt) return;
    var byTouch = touch;
    pick(shown[Number(opt.getAttribute('data-i'))].value);
    // On a phone, dismiss the keyboard once the choice is made — and leave
    // the field unfocused, so the next tap browses again.
    if (byTouch) input.blur();
  });
  wrap.querySelector('.combo-toggle').addEventListener('mousedown', function (ev) {
    ev.preventDefault();
    if (!list.hidden) { close(); if (touch) input.blur(); return; }
    // Opened by the chevron with a finger: browse, and never focus — the
    // chevron is not the field, and should not bring a keyboard.
    if (touch) { touch = false; browse(); }
    else if (document.activeElement === input) search();
    else input.focus();
  });
  clear.addEventListener('mousedown', function (ev) {
    ev.preventDefault();
    var byTouch = touch;
    pick('');
    if (byTouch) input.blur();
  });

  sel._comboSync = showValue;
  showValue();
}

// For code that sets a select's value directly: that fires no event, so
// the field on top has to be told to show the new value.
function syncCombo(sel) {
  if (sel && sel._comboSync) sel._comboSync();
}

function entitySelect(type, value, id, placeholder) {
  var list = coll(type).slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
  var opts = '<option value="">' + esc(placeholder || '— none —') + '</option>';
  list.forEach(function (e) {
    opts += '<option value="' + esc(e.id) + '"' + (e.id === value ? ' selected' : '') + '>' + esc(e.name) + '</option>';
  });
  return '<div class="with-add">' +
    '<select class="inp" id="' + id + '" data-role="' + type + '" data-search>' + opts + '</select>' +
    '<button type="button" class="addbtn" data-action="quick-add" data-type="' + type + '" ' +
      'title="' + esc(t('Add ' + ENTITIES[type].label.toLowerCase())) + '">' + ICON.plus + '</button>' +
  '</div>';
}

/* The recipe form has no roaster field: the roaster belongs to the Coffee,
   so asking for it here only gave the same fact a second place to disagree.
   Each coffee carries its roaster as secondary text in the picker instead —
   that keeps same-named coffees from different roasters apart, and typing a
   roaster's name still narrows the list to its coffees. */
function coffeeSelectHTML(value) {
  var list = coll('coffee').slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
  // Deliberately unselected to start: the coffee is the one field worth a
  // conscious choice every time, and quietly defaulting to whichever coffee
  // sorts first is how a recipe ends up filed under the wrong bag.
  var opts = '<option value="">' + t('Select a coffee…') + '</option>';
  list.forEach(function (c) {
    var roaster = roasterNameOf(c);
    opts += '<option value="' + esc(c.id) + '"' + (roaster ? ' data-meta="' + esc(roaster) + '"' : '') +
      (c.id === value ? ' selected' : '') + '>' + esc(c.name) + '</option>';
  });
  return '<div class="with-add">' +
    '<select class="inp" id="f-coffee-sel" data-role="coffee" data-search>' + opts + '</select>' +
    '<button type="button" class="addbtn" data-action="quick-add" data-type="coffee" ' +
      'title="Add coffee">' + ICON.plus + '</button>' +
  '</div>';
}

/* Step builder for a recipe style: a timeline you edit in place, so the whole
   brew reads top to bottom while you're writing it. Rows keep the order you
   put them in rather than re-sorting as you type — a list that rearranges
   itself mid-keystroke is unusable — and a hint flags any time that isn't
   later than the one above it, which is the case worth catching. */
function styleStepsSectionHTML(d) {
  var head = '<div class="form-sep-label">' + esc(t('Brewing steps')) + '</div>';

  if (hasFormula(d.id)) {
    return head + '<p class="hint" style="margin:0">This style\'s steps come from its built-in formula and ' +
      'rescale to each recipe\'s dose and water automatically — there\'s nothing to write by hand.</p>';
  }

  if (!d.steps || !d.steps.length) d.steps = [{ t: '', label: '' }];
  var last = d.steps.length - 1;

  var rows = d.steps.map(function (s, i) {
    return '<li class="stepbuild-row" data-i="' + i + '">' +
      '<span class="stepbuild-mark">' + (i + 1) + '</span>' +
      '<input class="inp stepbuild-t" data-s="t" value="' + esc(s.t || '') + '" ' +
        'placeholder="0:45" inputmode="numeric" aria-label="Step ' + (i + 1) + ' time" />' +
      '<input class="inp stepbuild-l" data-s="label" value="' + esc(s.label || '') + '" ' +
        'placeholder="' + esc(t('What to do at this point')) + '" aria-label="' + esc(t('Step')) + ' ' + (i + 1) + '" />' +
      '<span class="stepbuild-tools">' +
        '<button type="button" class="iconbtn" data-action="style-step-move" data-i="' + i + '" data-dir="-1" ' +
          'aria-label="Move step ' + (i + 1) + ' earlier"' + (i === 0 ? ' disabled' : '') + '>' + ICON.chevUp + '</button>' +
        '<button type="button" class="iconbtn" data-action="style-step-move" data-i="' + i + '" data-dir="1" ' +
          'aria-label="Move step ' + (i + 1) + ' later"' + (i === last ? ' disabled' : '') + '>' + ICON.chevDown + '</button>' +
        '<button type="button" class="iconbtn danger" data-action="style-step-del" data-i="' + i + '" ' +
          'aria-label="Remove step ' + (i + 1) + '">' + ICON.close + '</button>' +
      '</span>' +
    '</li>';
  }).join('');

  return head +
    '<p class="hint" style="margin:0 0 14px">Every recipe on this style follows these steps, so you only write them once.</p>' +
    '<ol class="stepbuild">' + rows + '</ol>' +
    (stepsOutOfOrder(d.steps)
      ? '<p class="hint stepbuild-warn">' + ICON.arrowDown + 'Some times run backwards — reorder the steps so the brew reads start to finish.</p>'
      : '') +
    '<div class="steps-tools">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-action="style-step-add">' + ICON.plus + esc(t('Add step')) + '</button>' +
    '</div>';
}

// True when any filled-in time is not later than the filled-in time before it.
function stepsOutOfOrder(steps) {
  var prev = -1, bad = false;
  (steps || []).forEach(function (s) {
    var sec = secondsOf(s.t);
    if (sec === null) return;
    if (sec <= prev) bad = true;
    prev = sec;
  });
  return bad;
}

function stepsEditor(steps) {
  var rows = steps.map(function (s, i) {
    return '<div class="steprow" data-i="' + i + '">' +
      '<input class="inp" data-s="t" value="' + esc(s.t) + '" placeholder="0:45" inputmode="numeric" />' +
      '<input class="inp" data-s="label" value="' + esc(s.label) + '" placeholder="' + esc(t('What you do at this point')) + '" />' +
      '<input class="inp" data-s="water" value="' + esc(s.water === 0 ? '' : s.water) + '" placeholder="g" inputmode="decimal" />' +
      '<button type="button" class="del" data-action="del-step" data-i="' + i + '" aria-label="Remove step">' + ICON.close + '</button>' +
    '</div>';
  }).join('');
  return '<p class="hint" style="margin:0 0 12px">' + esc(t('This recipe style has no built-in formula — write the steps by hand.')) + '</p>' +
    '<div class="steps-head"><span>' + esc(t('Time')) + '</span><span>' + esc(t('Action')) + '</span><span>' + esc(t('Water')) + '</span><span></span></div>' +
    '<div id="stepsWrap">' + rows + '</div>' +
    '<div class="steps-tools">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-action="add-step">' + ICON.plus + esc(t('Add step')) + '</button>' +
    '</div>';
}

// Decides, from the currently selected style, whether the steps section shows
// a live read-only preview (style has a formula) or a manual editor (it doesn't).
function stepsSectionHTML(m) {
  var d = m.draft;
  var mth = findIn('method', d.methodId);
  var methodName = mth ? mth.name : '';

  if (hasFormula(d.styleId)) {
    var steps = preset(d.styleId, d.dose, d.water, methodName);
    if (steps.length) {
      return '<ol class="timeline">' + timelineHTML(steps) + '</ol>' +
        '<p class="hint" style="margin-top:12px">' + esc(stepsCaption(d)) +
        ' Switch to a custom recipe style to write steps by hand.</p>';
    }
    return '<p class="hint" style="margin:0">' + esc(noStepsMessage(d)) + '</p>';
  }

  var own = styleSteps(d.styleId);
  if (own.length) {
    var st = findIn('style', d.styleId);
    return '<ol class="timeline">' + timelineHTML(own) + '</ol>' +
      '<p class="hint" style="margin-top:12px">These steps come from the ' +
      esc(st ? st.name : 'selected') + ' style — edit the style to change them for every recipe using it.</p>';
  }

  if (!d.steps || !d.steps.length) d.steps = [{ t: '', label: '', water: '' }];
  return stepsEditor(d.steps);
}

function openRecipeForm(existing) {
  var m = {
    draft: existing
      ? JSON.parse(JSON.stringify(existing))
      : blankRecipe(),
    capture: function () { readRecipeForm(m); },
    render: function () { return buildRecipeForm(m); }
  };
  openModal(m);
}

function buildRecipeForm(m) {
  var d = m.draft;
  var body =
    '<div class="field" id="coffeeField"><label for="f-coffee-sel">' + esc(t('Coffee')) + '</label>' +
      coffeeSelectHTML(d.coffeeId) + '</div>' +
    '<div class="field"><label for="f-method-sel">' + esc(t('Brewing method')) + '</label>' + entitySelect('method', d.methodId, 'f-method-sel', t('Select a method…')) + '</div>' +
    '<div class="row row-2">' +
      '<div class="field"><label for="f-grinder-sel">' + esc(t('Grinder')) + '</label>' + entitySelect('grinder', d.grinderId, 'f-grinder-sel', t('Select a grinder…')) + '</div>' +
      '<div class="field"><label for="f-grind">' + esc(t('Grind size')) + '</label>' +
        '<input class="inp" id="f-grind" value="' + esc(d.grindSize) + '" placeholder="' + esc(t('e.g. 75 clicks')) + '" /></div>' +
    '</div>' +
    '<div class="field"><label for="f-style-sel">' + esc(t('Recipe style')) + '</label>' + entitySelect('style', d.styleId, 'f-style-sel', t('Select a style…')) +
      '<div class="hint">' + esc(t('Pouring steps always follow the chosen recipe style. Add a style to build your own step-by-step schedule.')) + '</div></div>' +

    '<div class="form-sep-label">' + esc(t('Brew parameters')) + '</div>' +
    '<div class="row row-3">' +
      '<div class="field"><label for="f-dose">' + esc(t('Coffee dose (g)')) + '</label>' +
        '<input class="inp" id="f-dose" value="' + esc(d.dose) + '" placeholder="15" inputmode="decimal" /></div>' +
      '<div class="field"><label for="f-water">' + esc(t('Water (g)')) + '</label>' +
        '<input class="inp" id="f-water" value="' + esc(d.water) + '" placeholder="250" inputmode="decimal" /></div>' +
      '<div class="field"><label for="f-temp">' + esc(t('Temperature (°C)')) + '</label>' +
        '<input class="inp" id="f-temp" value="' + esc(d.temp) + '" placeholder="94" inputmode="decimal" /></div>' +
    '</div>' +
    '<div class="row row-2">' +
      '<div class="field"><label for="f-time">' + esc(t('Total brew time')) + '</label>' +
        '<input class="inp" id="f-time" value="' + esc(d.brewTime) + '" placeholder="3:30" /></div>' +
      '<div class="field"><label>' + esc(t('Ratio')) + '</label>' +
        '<div class="inp" style="display:flex;align-items:center;background:var(--surface-sunken);border-style:dashed">' +
          '<span id="ratioOut" class="ratio-hint">' + ratio(d.dose, d.water) + '</span></div></div>' +
    '</div>' +

    '<div class="form-sep-label">' + esc(t('Pouring steps')) + '</div>' +
    '<div id="stepsSection">' + stepsSectionHTML(m) + '</div>' +

    '<div class="form-sep-label">' + esc(t('Finishing touches')) + '</div>' +
    '<div class="field"><label for="f-notes">' + esc(t('Personal notes')) + '</label>' +
      '<textarea class="inp" id="f-notes" placeholder="What worked, what to change next time…">' + esc(d.notes) + '</textarea></div>' +
    '<div class="row row-2">' +
      '<div class="field"><label for="f-name">' + esc(t('Custom title (optional)')) + '</label>' +
        '<input class="inp" id="f-name" value="' + esc(d.name) + '" placeholder="' + esc(t('Defaults to the coffee name')) + '" /></div>' +
      '<div class="field"><label>' + esc(t('Cup score')) + '</label>' +
        '<div class="rate" id="rateWrap">' +
          [1, 2, 3, 4, 5].map(function (i) {
            return '<button type="button" class="' + (i <= (d.rating || 0) ? 'on' : '') + '" data-action="rate" data-v="' + i + '" aria-label="Rate ' + i + '">' +
              iconBean(i <= (d.rating || 0)) + '</button>';
          }).join('') +
        '</div></div>' +
    '</div>';

  var foot = '<button class="btn btn-ghost" data-action="close-modal">' + esc(t('Cancel')) + '</button>' +
    '<button class="btn btn-primary" data-action="save-recipe">' + esc(t(d.id ? 'Save changes' : 'Save recipe')) + '</button>';

  var el = sheet({ title: t(d.id ? 'Edit recipe' : 'New recipe'), body: body, foot: foot });

  // live ratio + live steps preview (steps only react to dose/water while a
  // style-driven formula is active — manual steps aren't touched by these).
  var dose = el.querySelector('#f-dose'), water = el.querySelector('#f-water'), out = el.querySelector('#ratioOut');
  function upd() { out.textContent = ratio(dose.value, water.value); }
  function syncSteps() {
    d.dose = dose.value.trim();
    d.water = water.value.trim();
    if (!hasFormula(d.styleId)) return;
    var wrap = el.querySelector('#stepsSection');
    if (wrap) wrap.innerHTML = stepsSectionHTML(m);
  }
  dose.addEventListener('input', function () { upd(); syncSteps(); });
  water.addEventListener('input', function () { upd(); syncSteps(); });

  function onStyleOrMethodChange() {
    readRecipeForm(m);
    var wrap = el.querySelector('#stepsSection');
    if (wrap) wrap.innerHTML = stepsSectionHTML(m);
  }
  el.querySelector('#f-style-sel').addEventListener('change', onStyleOrMethodChange);
  el.querySelector('#f-method-sel').addEventListener('change', onStyleOrMethodChange);

  enhanceSelects(el);
  return el;
}

function readRecipeForm(m) {
  var el = m.el;
  if (!el) return;
  var d = m.draft, q = function (s) { return el.querySelector(s); };
  d.coffeeId = q('#f-coffee-sel').value;
  d.methodId = q('#f-method-sel').value;
  d.grinderId = q('#f-grinder-sel').value;
  d.styleId = q('#f-style-sel').value;
  d.grindSize = q('#f-grind').value.trim();
  d.dose = q('#f-dose').value.trim();
  d.water = q('#f-water').value.trim();
  d.temp = q('#f-temp').value.trim();
  d.brewTime = normTime(q('#f-time').value);
  d.notes = q('#f-notes').value;
  d.name = q('#f-name').value.trim();
  d.steps = [].map.call(el.querySelectorAll('.steprow'), function (row) {
    return {
      t: normTime(row.querySelector('[data-s="t"]').value),
      label: row.querySelector('[data-s="label"]').value.trim(),
      water: row.querySelector('[data-s="water"]').value.trim()
    };
  });
}

function saveRecipe(m) {
  readRecipeForm(m);
  var d = m.draft;
  if (!d.coffeeId) { toast(t('Pick a coffee first.')); return; }
  if (!d.methodId) { toast(t('Pick a brewing method.')); return; }

  if (styleProvidesSteps(d.styleId)) {
    // The style owns the schedule — computed live from a formula, or written
    // once on the style itself. Either way there's nothing to store here.
    d.steps = [];
  } else {
    d.steps = d.steps.filter(function (s) { return s.label || s.water || s.t; });
    d.steps.forEach(function (s) { s.water = s.water === '' ? 0 : Number(s.water); });
  }
  ['dose', 'water', 'temp'].forEach(function (k) { d[k] = d[k] === '' ? '' : Number(d[k]); });

  var now = Date.now();
  if (d.id) {
    var existing = recipeById(d.id);
    for (var k in d) if (Object.prototype.hasOwnProperty.call(d, k)) existing[k] = d[k];
    existing.updatedAt = now;
  } else {
    d.id = uid('rec');
    d.createdAt = now;
    d.updatedAt = now;
    state.recipes.push(d);
  }
  save();
  closeModal();
  toast(t('Recipe saved.'));

  var target = '#/r/' + encodeURIComponent(d.id);
  if (location.hash.indexOf('#/r/') === 0 && location.hash !== target) {
    location.hash = target;          // came from another recipe's page — follow the saved one
  } else {
    render();                        // stay where we are, refreshed
  }
}

/* ---------------------------------------------------------
   9b. Label scan — read a coffee bag with on-device OCR

   Everything here runs in the browser: Tesseract is fetched from a CDN
   the first time Scan is tapped (never on cold start) and its language
   data is cached in IndexedDB afterwards, so no photo and no key ever
   leaves the device.

   OCR gives back raw text, not fields, so the value of this section is
   the parsing below it. Two tiers: labelled lines ("Processo: Natural")
   are read directly, and whatever is left is matched against the closed
   vocabularies a coffee bag actually uses. Anything it can't place is
   still shown as raw text to copy from, and nothing is written to the
   form until it's confirmed.
   --------------------------------------------------------- */

var TESSERACT_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
var tesseractLoad = null;

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (tesseractLoad) return tesseractLoad;
  tesseractLoad = new Promise(function (resolve, reject) {
    var s = document.createElement('script');
    s.src = TESSERACT_SRC;
    s.async = true;
    s.onload = function () {
      if (window.Tesseract) resolve(window.Tesseract);
      else reject(new Error('tesseract-missing'));
    };
    // Null the cache on failure so a later tap retries rather than
    // resolving against a promise that already rejected.
    s.onerror = function () { tesseractLoad = null; reject(new Error('tesseract-network')); };
    document.head.appendChild(s);
  });
  return tesseractLoad;
}

/* A phone photo of a bag is the worst case for OCR: 12 megapixels of
   curved foil, often with light type on a dark background. Scaling down,
   flattening to grey, stretching the contrast to the full range and
   inverting dark bags so the engine always sees dark-on-light buys more
   accuracy than any engine setting does. */
/* Tesseract wants roughly 30px of cap height. The spec panel on a bag is
   often 2mm type, so the frame is what decides whether it is readable at
   all: fill it with the label and 2mm lands near 40px here; include the
   whole bag and the shelf behind it and the same text falls under 15px,
   which no engine setting recovers. Raised from 1600 for a little more
   headroom, but kept well short of the original photo — the cost is paid
   twice now that two layout passes run. */
var SCAN_MAX_EDGE = 2000;

function prepScanImage(file) {
  return new Promise(function (resolve, reject) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(url);
      var scale = Math.min(1, SCAN_MAX_EDGE / Math.max(img.width, img.height));
      var w = Math.max(1, Math.round(img.width * scale));
      var h = Math.max(1, Math.round(img.height * scale));
      var cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      var ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      var data, px;
      try {
        data = ctx.getImageData(0, 0, w, h);
      } catch (e) {
        // Shouldn't happen for a local file, but never fail the scan over
        // preprocessing — the untouched canvas still reads.
        resolve({ canvas: cv, inverted: false });
        return;
      }
      px = data.data;
      var i, lum, min = 255, max = 0, sum = 0, n = px.length / 4;
      for (i = 0; i < px.length; i += 4) {
        lum = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
        px[i] = px[i + 1] = px[i + 2] = lum;
        if (lum < min) min = lum;
        if (lum > max) max = lum;
        sum += lum;
      }
      var span = Math.max(1, max - min);
      // A mostly-dark frame means a dark bag with light type on it.
      var invert = (sum / n) < 115;
      for (i = 0; i < px.length; i += 4) {
        lum = ((px[i] - min) * 255 / span) | 0;
        if (invert) lum = 255 - lum;
        px[i] = px[i + 1] = px[i + 2] = lum;
      }
      ctx.putImageData(data, 0, 0);
      resolve({ canvas: cv, inverted: invert });
    };
    img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

/* Portuguese only. Pairing it with eng made the two dictionaries compete
   over the same Latin script and cost accuracy on the 95% of these bags
   that are Portuguese; an English bag still reads, just without a
   matching dictionary behind it. */
var SCAN_LANG = 'por';

function inkLength(data) {
  return ((data && data.text) || '').replace(/\s+/g, '').length;
}

/* Two layout passes, always — not one with a fallback.

   A bag is not a page of prose: auto analysis (PSM 3) groups lines well,
   which is what picking the name out by text height depends on, while
   sparse mode (PSM 11) finds scattered small print that auto misses
   entirely — and on these bags the altitude, process and variety are
   exactly that small print. Running only the first, as this did, meant
   the fields most worth having were the ones most likely to be dropped.

   The passes are combined rather than chosen between: line structure
   comes from whichever read more, and the text of both is concatenated so
   vocabulary matching gets every character either pass managed to see. */
function runScanOCR(canvas, onProgress) {
  function report(pass, p) {
    if (onProgress) onProgress(pass * 0.5 + Math.max(0, Math.min(1, p || 0)) * 0.5);
  }
  return loadTesseract().then(function (T) {
    var worker, autoData;
    var pass = 0;
    return T.createWorker(SCAN_LANG, 1, {
      logger: function (msg) {
        if (msg.status === 'recognizing text') report(pass, msg.progress);
      }
    }).then(function (w) {
      worker = w;
      return worker.recognize(canvas);
    }).then(function (res) {
      autoData = res.data;
      pass = 1;
      return worker.setParameters({ tessedit_pageseg_mode: '11' });
    }).then(function () {
      return worker.recognize(canvas);
    }).then(function (res) {
      var sparse = res.data;
      var best = inkLength(sparse) > inkLength(autoData) ? sparse : autoData;
      return {
        text: ((autoData && autoData.text) || '') + '\n' + ((sparse && sparse.text) || ''),
        lines: (best && best.lines) || []
      };
    }).then(function (data) {
      return worker.terminate().then(function () { return data; });
    }, function (err) {
      if (worker) { try { worker.terminate(); } catch (e) { /* already gone */ } }
      throw err;
    });
  });
}

/* ---- parsing ---- */

function deaccent(s) {
  s = String(s == null ? '' : s);
  return s.normalize ? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : s;
}
function scanNorm(s) { return deaccent(s).toLowerCase().replace(/\s+/g, ' ').trim(); }

// Canonical value first, then every spelling worth matching, English and
// Portuguese. Order is significant: the first hit wins, so the compound
// terms have to sit above the single words they contain.
var PROCESS_TERMS = [
  ['Anaerobic natural', ['anaerobic natural', 'natural anaerobico', 'natural anaerobio']],
  ['Anaerobic', ['anaerobic', 'anaerobico', 'anaerobia', 'anaerobiose', 'fermentacao anaerobica']],
  ['Carbonic maceration', ['carbonic maceration', 'maceracao carbonica']],
  ['Pulped natural', ['pulped natural', 'cereja descascado', 'despolpado', 'descascado', 'semi-washed', 'semi washed']],
  ['Wet hulled', ['wet hulled', 'giling basah']],
  ['Washed', ['fully washed', 'washed', 'lavado', 'lavada', 'via umida']],
  ['Honey', ['yellow honey', 'red honey', 'black honey', 'white honey', 'honey']],
  ['Fermented natural', ['natural fermentado', 'fermented natural', 'natural fermentation']],
  ['Natural', ['natural', 'via seca', 'dry process']],
  ['Induced fermentation', ['fermentacao induzida', 'induced fermentation', 'koji', 'lactic fermentation']]
];

var VARIETAL_TERMS = ['Bourbon Amarelo', 'Bourbon Vermelho', 'Bourbon Rosa',
  'Catuaí Amarelo', 'Catuaí Vermelho', 'Catucaí Amarelo', 'Catucaí Vermelho',
  'Bourbon', 'Yellow Bourbon', 'Red Bourbon', 'Caturra', 'Catuaí', 'Catucaí',
  'Mundo Novo', 'Typica', 'Geisha', 'Gesha', 'SL28', 'SL34', 'Heirloom', 'Pacamara', 'Maragogipe',
  'Icatu', 'Obatã', 'Arara', 'Acaiá', 'Topázio', 'Paraíso', 'Ouro Amarelo', 'Sarchimor', 'Villa Sarchi',
  'Pacas', 'Castillo', 'Caturrão', 'Rubi', 'Tupi', 'Laurina', 'Pink Bourbon'];

var ROAST_TERMS = [
  ['Medium-light', ['medium-light', 'medium light', 'torra media clara', 'media clara', 'clara media']],
  ['Medium-dark', ['medium-dark', 'medium dark', 'torra media escura', 'media escura']],
  ['Light', ['light roast', 'light', 'torra clara', 'clara']],
  ['Medium', ['medium roast', 'medium', 'torra media', 'media']],
  ['Dark', ['dark roast', 'dark', 'torra escura', 'escura']],
  ['Omni', ['omni roast', 'omni']]
];

// Labels a bag prints beside a value, in either language. Matched at the
// start of a line, so "Processo: Natural" and "Altitude 1.200m" both read.
var FIELD_LABELS = [
  ['altitude', ['altitude media', 'altitude', 'elevation', 'elevacao', 'msnm', 'masl']],
  ['process', ['processamento', 'processo', 'process', 'preparo', 'metodo']],
  ['varietal', ['variedades', 'variedade', 'varietals', 'varietal', 'variety', 'cultivares', 'cultivar']],
  ['roast', ['nivel de torra', 'perfil de torra', 'torra', 'roast level', 'roast']],
  ['origin', ['origem', 'origin', 'regiao', 'region', 'terroir', 'municipio', 'cidade']],
  // Deliberately not 'fazenda' / 'sitio' / 'farm': on Brazilian bags those
  // open the coffee's own name far more often than they label a producer
  // ("Fazenda Samambaia", "Sítio Palmito"). Treating them as labels both
  // stole the name and filed a truncated value under Origin.
  ['producer', ['produtor', 'producer']],
  // Recognised so they terminate a neighbouring value and never pose as a
  // coffee name, but mapped to nothing — the app has no field for them.
  ['skip', ['metodos indicados', 'metodo indicado', 'pontuacao', 'score', 'finalizacao', 'finalizaco', 'safra', 'secagem',
    'peneira', 'torrefacao', 'validade', 'lote/torrado em', 'lote', 'peso liquido',
    'peso', 'conteudo', 'moagem', 'embalado em']],
  ['notes', ['perfil sensorial', 'perfil aromatico', 'notas sensoriais', 'sensorial',
    'notas de degustacao', 'notas', 'tasting notes', 'sensory', 'descritores',
    'sabor', 'aroma', 'notes']]
];

// Words that look like a headline on a bag but are never the coffee's name.
var NOT_A_NAME = ['cafe especial', 'especial', 'specialty coffee', 'specialty', 'arabica', '100% arabica',
  'cafe arabica', 'torrado e moido', 'torrado', 'moido', 'graos', 'grao', 'whole bean', 'beans',
  'single origin', 'microlote', 'micro lote', 'net wt', 'peso liquido', 'cafe', 'coffee', 'blend',
  'organico', 'organic', 'premium', 'gourmet', 'produto do brasil', 'brasil', 'brazil',
  // Seen on the Sabino bag: a roaster's suffix line, and the packaging
  // boilerplate that surrounds the weight and dates.
  'coffee co', 'coffee co.', 'roasters', 'roastery', 'torrefacao',
  'cafe torrado em graos', 'torrado em graos', 'em graos', 'em grao', 'validade', 'lote',
  'lote/torrado em', 'peso', 'net weight', 'conteudo'];

function fmtMeters(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/* Altitudes print as "1.200m", "1,200 masl", "1100-1300 m" and every
   variant between. Pull the numbers, undo whichever thousands separator
   was used, and keep only values that are plausible for coffee. */
function altNum(s) {
  var n = parseInt(String(s).replace(/[.,]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}
function altPlausible(n) { return n >= 200 && n <= 3000; }

/* An altitude is always three or four digits followed by a unit —
   "metros", "meters", or "m". Spelling it out is what the alternation
   below is for: the bare "m" needs a word boundary after it, so without
   the long forms listed first, "1200 meters" matched nothing at all. */
var ALT_UNIT = '(?:metros|metres|meters|msnm|masl|m\\.a\\.s\\.l|mts\\b|mt\\b|m\\b|m\\.)';

function parseAltitude(text) {
  var num = '(\\d{1,2}[.,]?\\d{3}|\\d{3,4})';
  var re = new RegExp(num + '\\s*(?:metros|metres|meters|m)?\\s*(?:a|à|-|–|—|to|até|ate)\\s*' +
    num + '\\s*' + ALT_UNIT, 'i');
  var one = new RegExp('(\\d{1,2}[.,]\\d{3}|\\d{3,4})\\s*' + ALT_UNIT, 'i');

  var m = text.match(re);
  if (m) {
    var lo = altNum(m[1]), hi = altNum(m[2]);
    if (altPlausible(lo) && altPlausible(hi) && hi >= lo) return fmtMeters(lo) + '–' + fmtMeters(hi) + ' m';
  }
  m = text.match(one);
  if (m) {
    var v = altNum(m[1]);
    if (altPlausible(v)) return fmtMeters(v) + ' m';
  }
  return '';
}

/* Used only on a line already known to be an altitude, where the unit is
   often left off ("Altitude: 1.100 a 1.300") or lost to OCR. Bare numbers
   can be trusted here precisely because the label vouched for them. */
function parseAltitudeLoose(text) {
  var strict = parseAltitude(text);
  if (strict) return strict;
  var nums = String(text).match(/\d{1,2}[.,]\d{3}|\d{3,4}/g) || [];
  var vals = [];
  nums.forEach(function (raw) {
    var n = altNum(raw);
    if (altPlausible(n) && vals.indexOf(n) === -1) vals.push(n);
  });
  if (!vals.length) return '';
  vals.sort(function (a, b) { return a - b; });
  if (vals.length === 1) return fmtMeters(vals[0]) + ' m';
  return fmtMeters(vals[0]) + '–' + fmtMeters(vals[vals.length - 1]) + ' m';
}

// Whole-word match. Without the boundaries "media" fires inside
// "imediatamente" and "natural" inside "naturalmente".
function termRe(term) {
  return new RegExp('(^|[^a-z0-9])' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)');
}

function matchTerms(hay, table) {
  for (var i = 0; i < table.length; i++) {
    var spellings = table[i][1];
    for (var j = 0; j < spellings.length; j++) {
      if (termRe(spellings[j]).test(hay)) return table[i][0];
    }
  }
  return '';
}

var VARIETAL_TABLE = VARIETAL_TERMS.map(function (v) { return [v, [scanNorm(v)]]; });

/* "São João Del Rei - MG" is a place, not a coffee. Recognising the
   city-state form keeps it out of the name and puts it where it belongs:
   on this bag it was the tallest line left, so it became the name. */
var BR_STATES = 'AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO';
var PLACE_RE = new RegExp('\\s[-–—/]\\s*(' + BR_STATES + ')\\s*$', 'i');
function looksLikePlace(line) { return PLACE_RE.test(String(line).trim()); }

/* The growing regions, few enough to name. Both OCR passes often read the
   origin differently — one cleanly, one as nonsense ("Cerrado Mineiro" vs
   "cCerodo Míteio") — and neither carries the debris a noise count could
   separate. Recognising the actual region is what tells them apart. */
var REGION_TERMS = ['cerrado mineiro', 'sul de minas', 'mantiqueira de minas', 'matas de minas',
  'campo das vertentes', 'chapada diamantina', 'alta mogiana', 'mogiana', 'oeste da bahia',
  'montanhas do espirito santo', 'caparao', 'jequitinhonha', 'chapada de minas',
  'alto paranaiba', 'zona da mata', 'norte pioneiro do parana'];
// Deliberately absent: "Serra da Canastra", "Guji", "Yirgacheffe", "Huila".
// They are genuine regions, but on a bag they are usually part of the
// coffee's own name — and two of them are coffee names in this library, so
// listing them made the origin swallow the name.

function regionScore(text) {
  var hit = regionMatch(text);
  // A fuzzy hit still counts, just for less than a clean one.
  return hit ? hit.term.length * (hit.exact ? 1 : 0.7) : 0;
}

/* Finds a growing region in a string, allowing for OCR damage: "Motos de
   Minos" is "Matas de Minas" with three characters knocked out. The region
   list is short and the names are long and distinctive, so a near miss is
   safe to trust — unlike varietals, where Catuaí and Catucaí are one
   character apart and a fuzzy match could silently swap one for the other. */
function regionMatch(text) {
  var origWords = String(text).split(/\s+/);
  var normWords = origWords.map(function (w) { return scanNorm(w); });
  for (var t = 0; t < REGION_TERMS.length; t++) {
    var term = REGION_TERMS[t], parts = term.split(' '), span = parts.length;
    var budget = term.length >= 12 ? 3 : (term.length >= 8 ? 2 : 0);
    for (var i = 0; i + span <= normWords.length; i++) {
      var joined = normWords.slice(i, i + span).join(' ');
      if (joined === term) return { term: term, exact: true, at: i, span: span, words: origWords };
      if (budget && editDistance(joined, term) <= budget) {
        return { term: term, exact: false, at: i, span: span, words: origWords };
      }
    }
  }
  return null;
}

/* Bags routinely print the height and the town on one line — "1250M |
   Carmo De Minas - MG". Lift the height out so the origin is just a place. */
function stripAltitude(text) {
  var span = findAltitudeSpan(text);
  if (!span) return text;
  return (text.slice(0, span.start) + ' ' + text.slice(span.end))
    .replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
}

function titleCaseRegion(term) {
  var small = { de: 1, do: 1, da: 1, das: 1, dos: 1, e: 1 };
  return term.split(' ').map(function (w, i) {
    if (i && small[w]) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

/* Restores the real spelling of a mangled region while leaving the rest of
   the line alone, so "Motos de Minos - MG" becomes "Matas de Minas - MG".
   Only rewrites what OCR got wrong: an exact match is returned untouched,
   which keeps a bag's own capitalisation intact. */
function correctRegion(text) {
  var hit = regionMatch(text);
  if (!hit || hit.exact) return text;
  return hit.words.slice(0, hit.at)
    .concat([titleCaseRegion(hit.term)])
    .concat(hit.words.slice(hit.at + hit.span))
    .join(' ');
}

/* Tasting notes are recognisable by what they are made of, which matters
   because their label is often mangled ("Notas Sencoriais") and the
   two-column panel puts the value nowhere near it. */
var FLAVOUR_TERMS = ['chocolate', 'cacau', 'caramelo', 'caramelizad', 'melado', 'mel', 'panela',
  'avela', 'amendoa', 'amendoim', 'castanha', 'noz', 'nozes', 'baunilha', 'especiaria',
  'rapadura', 'melaco', 'melado', 'nibs', 'pistache', 'tamarindo', 'cupuacu', 'jabuticaba',
  'maracuja', 'goiaba', 'caju', 'acerola', 'graviola', 'pitanga', 'ameixa', 'figo',
  'toranja', 'bergamota', 'lichia', 'melancia', 'coco', 'amora', 'cereja', 'pera',
  'jaca', 'caja', 'manga', 'frutas vermelhas', 'fermentado', 'exotico', 'tropical',
  'frutas', 'frutado', 'fruta', 'citrico', 'citrica', 'laranja', 'limao', 'tangerina', 'abacaxi',
  'maca', 'pessego', 'damasco', 'uva', 'morango', 'framboesa', 'banana', 'mamao', 'manga',
  'floral', 'jasmim', 'flores', 'acucar', 'doce', 'cremoso', 'encorpado',
  'licoroso', 'vinhoso', 'docura', 'sedoso', 'aveludado', 'suave', 'equilibrado',
  'acidez', 'corpo', 'persistente', 'refrescante',
  'chocolate milk', 'caramel', 'hazelnut', 'almond', 'walnut', 'vanilla', 'cocoa',
  'citrus', 'berry', 'stone fruit', 'jasmine', 'honey', 'nutty', 'toffee', 'praline'];

/* How much debris a line carries. OCR damage shows up as characters that
   never belong in prose — pipes, stray colons, underscores — so counting
   them separates a clean reading from a mangled one far better than length
   does. */
function noiseCount(line) {
  var m = String(line).match(/[^A-Za-zÀ-ɏ0-9 ,.'\-&\/]/g);
  return m ? m.length : 0;
}

// Strip leading/trailing punctuation and stray single letters left behind
// by a neighbouring column bleeding into the line.
function trimEdges(s) {
  return String(s)
    .replace(/^[^A-Za-zÀ-ɏ0-9]+/, '')
    .replace(/[^A-Za-zÀ-ɏ0-9)]+$/, '')
    .trim();
}

function flavourHits(line) {
  var n = scanNorm(line), hits = 0;
  for (var i = 0; i < FLAVOUR_TERMS.length; i++) {
    if (n.indexOf(FLAVOUR_TERMS[i]) !== -1) hits++;
  }
  return hits;
}

/* OCR glues the list's final conjunction onto the word after it, so
   "E CARAMELO" arrives as "ECARAMELO". Only split when what follows the E
   is itself a flavour, which leaves words that merely start with E —
   "ESPECIARIAS" — alone. */
function splitGluedE(frag) {
  var n = scanNorm(frag);
  if (n.length > 2 && n.charAt(0) === 'e' && n.charAt(1) !== ' ') {
    var rest = n.slice(1);
    for (var i = 0; i < FLAVOUR_TERMS.length; i++) {
      if (rest.indexOf(FLAVOUR_TERMS[i]) === 0) return frag.charAt(0) + ' ' + frag.slice(1);
    }
  }
  return frag;
}

/* Puts note fragments back in order. The two passes often disagree about
   which came first, but Portuguese settles it: the "e ..." clause ends the
   list, wherever OCR happened to report it. */
/* A lone letter with punctuation in front of the list is OCR debris, not a
   note. Real notes never open on a single letter, and requiring the
   punctuation keeps "Amêndoas…" and "LARANJA,…" intact. */
function cleanNoteText(f) {
  return String(f).replace(/^[A-Za-zÀ-ɏ]\s*[,.;:]\s+/, '').trim();
}

function assembleNotes(frags) {
  var head = [], tail = [];
  frags.forEach(function (f) {
    f = cleanNoteText(splitGluedE(String(f).trim()));
    if (!f || !flavourHits(f)) return;
    if (/^e\s/.test(scanNorm(f))) tail.push(f); else head.push(f);
  });
  // Rejoin with the separator the bag itself uses, unless the piece
  // already ends in one or the next begins with the conjunction that
  // closes a Portuguese list — "…limão Licoroso" should read
  // "…limão | Licoroso", but "…Cerrado E Caramelo" is already right.
  var out = '';
  head.concat(tail).forEach(function (f) {
    if (!out) { out = f; return; }
    var joinWith = ' ';
    if (!/[,&|;]$/.test(out) && !/^(e|and)\s/.test(scanNorm(f))) {
      joinWith = out.indexOf('|') !== -1 ? ' | ' : ', ';
    }
    out += joinWith + f;
  });
  return trimEdges(out.replace(/\s+/g, ' '));
}

function looksLikeNotes(line) {
  var n = scanNorm(line);
  if (n.length < 12) return false;
  // A list, not a single word: notes are enumerated.
  if (n.indexOf(',') === -1 && n.indexOf('|') === -1 && n.indexOf(';') === -1 &&
      n.indexOf(' e ') === -1 && n.indexOf(' and ') === -1) return false;
  var hits = 0;
  for (var i = 0; i < FLAVOUR_TERMS.length; i++) {
    if (n.indexOf(FLAVOUR_TERMS[i]) !== -1) hits++;
  }
  if (!hits) return false;
  // One flavour word joined by "e" is not a tasting note — it is half the
  // coffee names in this library ("Flor de Cacau", "Salada de Frutas",
  // "Bala de Caramelo"). Demand either several flavours or a real list.
  return hits >= 2 || n.indexOf(',') !== -1;
}

/* True when the "value" sliced off a label is really just the rest of the
   label. "Notas Sencoriais:" matched on the short synonym "notas", which
   left "Sencoriais:" looking like a value — words with no digits, ending
   in the punctuation that terminates a label. */
function looksLikeLabelTail(val) {
  return /^[^0-9]{0,24}[:;]\s*$/.test(String(val).trim());
}

/* Deaccented and lowercased but NOT whitespace-collapsed, so offsets into
   the result still line up with the original string and a value can be
   sliced out of it. */
function normKeepLen(s) { return deaccent(s).toLowerCase(); }

/* Every label on one line, in order. Matching anywhere rather than only at
   the start matters because OCR regularly runs a two-column spec panel
   together — "Processo Natural Variedade Catuai" is one line, and anchoring
   at position 0 threw away everything after the first label. */
function labelHits(line) {
  var flat = normKeepLen(line);
  var hits = [];
  FIELD_LABELS.forEach(function (entry) {
    entry[1].forEach(function (syn) {
      var from = 0, at;
      while ((at = flat.indexOf(syn, from)) !== -1) {
        // Right boundary as well as left: without it "torra" matches the
        // start of "torrado em grãos" and invents a roast label.
        if (/[a-z]/.test(flat.charAt(at + syn.length))) { from = at + syn.length; continue; }
        // Must start on a word boundary, or "notas" matches inside a word.
        if (at === 0 || !/[a-z0-9]/.test(flat.charAt(at - 1))) {
          hits.push({ field: entry[0], label: syn, start: at, end: at + syn.length });
        }
        from = at + syn.length;
      }
    });
  });
  // Nothing matched exactly, so allow for OCR having damaged the label.
  if (!hits.length) hits = fuzzyLabelHits(flat);

  hits.sort(function (a, b) { return a.start - b.start || b.end - a.end; });
  // Drop any hit sitting inside an earlier, longer one ("notas" within
  // "notas sensoriais").
  var out = [];
  hits.forEach(function (h) {
    var last = out[out.length - 1];
    if (last && h.start < last.end) return;
    out.push(h);
  });
  return out;
}

function editDistance(a, b) {
  var m = a.length, n = b.length, prev = [], cur = [], i, j;
  if (Math.abs(m - n) > 2) return 99;
  for (j = 0; j <= n; j++) prev[j] = j;
  for (i = 1; i <= m; i++) {
    cur[0] = i;
    for (j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1,
        prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
    }
    for (j = 0; j <= n; j++) prev[j] = cur[j];
  }
  return prev[n];
}

/* Damage to a label is relentless and almost always a single character:
   "Região" arrives as "Regiõo", "Processo" as "Trocesso", "Sensoriais" as
   "Sencoriais". Enumerating those misspellings is hopeless; allowing one
   slip is not. Only used when nothing matched exactly, and only on labels
   long enough that a near-miss means something. */
function fuzzyLabelHits(flat) {
  var words = [], re = /[^\s]+/g, m;
  while ((m = re.exec(flat)) !== null) {
    words.push({ text: m[0].replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''), start: m.index, end: m.index + m[0].length });
  }
  var hits = [];
  FIELD_LABELS.forEach(function (entry) {
    entry[1].forEach(function (syn) {
      var budget = fuzzyBudget(syn.length);
      if (!budget) return;
      var span = syn.split(' ').length;
      for (var i = 0; i + span <= words.length; i++) {
        var text = [], k;
        for (k = 0; k < span; k++) text.push(words[i + k].text);
        var joined = text.join(' ');
        if (!joined) continue;
        if (editDistance(joined, syn) <= budget) {
          hits.push({ field: entry[0], label: syn, start: words[i].start, end: words[i + span - 1].end });
          return; // one fuzzy hit per synonym is plenty
        }
      }
    });
  });
  return hits;
}

function fuzzyBudget(len) {
  if (len < 6) return 0;
  return len >= 9 ? 2 : 1;
}

function labelAt(line) {
  var hits = labelHits(line);
  return hits.length ? hits[0] : null;
}

// Where a vocabulary term sits inside a string, so it can be lifted out.
function findTermSpan(text, table) {
  var flat = normKeepLen(text);
  for (var i = 0; i < table.length; i++) {
    var spellings = table[i][1];
    for (var j = 0; j < spellings.length; j++) {
      var t = spellings[j], at = flat.indexOf(t);
      while (at !== -1) {
        var okL = at === 0 || !/[a-z0-9]/.test(flat.charAt(at - 1));
        var okR = !/[a-z0-9]/.test(flat.charAt(at + t.length));
        if (okL && okR) return { start: at, end: at + t.length, value: table[i][0] };
        at = flat.indexOf(t, at + 1);
      }
    }
  }
  return null;
}

function findAltitudeSpan(text) {
  var re = new RegExp('(\\d{1,2}[.,]?\\d{3}|\\d{3,4})\\s*' + ALT_UNIT, 'i');
  var m = re.exec(text);
  if (!m) return null;
  var v = parseAltitude(m[0]);
  return v ? { start: m.index, end: m.index + m[0].length, value: v } : null;
}

/* A very common bag layout stacks a row of labels above a row of values:

     variedade torra          região altitude
     CATUCAI 24/137 MEDIA     MANTIQUEIRA DE MINAS  1150M

   Splitting that row by position is guesswork, but the tight vocabularies
   make it unnecessary: lift out the parts that can be identified — the
   altitude, the roast, the process — and whatever text is left belongs to
   the label that has no vocabulary to check against. Here "MEDIA" and
   "1150M" are claimed, leaving exactly "CATUCAI 24/137" and "MANTIQUEIRA
   DE MINAS" for variedade and região. */
function distributeRow(hits, valueLine) {
  var text = valueLine, out = {};
  // Nothing to divide: one label owns the whole line, and lifting out only
  // the part a vocabulary recognised would truncate it — "FERMENTAÇÃO
  // ANAERÓBICA 72H" would lose its 72H.
  if (hits.length === 1) { out[0] = valueLine.replace(/\s+/g, ' ').trim(); return out; }
  [['altitude', findAltitudeSpan],
   ['roast', function (line) { return findTermSpan(line, ROAST_TERMS); }],
   ['process', function (line) { return findTermSpan(line, PROCESS_TERMS); }]
  ].forEach(function (ex) {
    var idx = -1;
    hits.forEach(function (h, i) { if (h.field === ex[0] && out[i] === undefined) idx = i; });
    if (idx === -1) return;
    var span = ex[1](text);
    if (!span) return;
    out[idx] = trimEdges(text.slice(span.start, span.end));
    text = text.slice(0, span.start) + ' ' + text.slice(span.end);
  });
  // Everything unclaimed goes to the first label still waiting for a value.
  var leftover = text.replace(/\s+/g, ' ').trim();
  hits.forEach(function (h, i) {
    if (out[i] === undefined && leftover) { out[i] = leftover; leftover = ''; }
  });
  return out;
}

/* Tesseract hands back per-word bounding boxes, which is the only real
   signal available for "which line is the coffee's name": on a bag, the
   name is set biggest. Returns lines sorted by cap height, tallest first. */
function linesByHeight(data) {
  var out = [];
  var lines = (data && data.lines) || [];
  lines.forEach(function (ln, i) {
    var text = (ln.text || '').trim();
    if (!text) return;
    var h = 0;
    if (ln.bbox) h = ln.bbox.y1 - ln.bbox.y0;
    out.push({ text: text, h: h, conf: ln.confidence || 0, at: i });
  });
  out.sort(function (a, b) { return b.h - a.h; });
  return out;
}

function isBareVocabularyValue(n) {
  var tables = [PROCESS_TERMS, ROAST_TERMS], i, j;
  for (i = 0; i < tables.length; i++) {
    for (j = 0; j < tables[i].length; j++) {
      if (tables[i][j][1].indexOf(n) !== -1) return true;
    }
  }
  return REGION_TERMS.indexOf(n) !== -1;
}

function looksLikeName(line) {
  var n = scanNorm(line);
  if (n.length < 3 || n.length > 44) return false;
  if (!/[a-z]/.test(n)) return false;               // pure numbers / weights
  if (/\d+\s*(g|kg|gr|ml)\b/.test(n)) return false; // "250 g"
  if (NOT_A_NAME.indexOf(n) !== -1) return false;
  // Exact match only: "Natural" and "Campo das Vertentes" are answers to
  // other fields, while a coffee genuinely called "Água Clara" survives.
  if (isBareVocabularyValue(n)) return false;
  if (looksLikePlace(line)) return false;   // "São João Del Rei - MG"
  if (looksLikeNotes(line)) return false;   // the tasting-note list
  if (/\d{2}\/\d{2}\/\d{2,4}/.test(n)) return false; // roast / best-before dates
  // Only a label that *opens* the line disqualifies it. Rejecting any line
  // that merely contains a label word would throw away real names — plenty
  // of coffees are called something like "Notas de Cacau".
  var hits = labelHits(line);
  if (hits.length && hits[0].start === 0) return false;
  return true;
}

/* Turns OCR output into proposed field values. Each result carries a short
   `why` so the review sheet can say where the guess came from — a guess you
   can't audit is worse than no guess. */
function parseLabel(data) {
  var raw = (data && data.text) || '';
  var lines = raw.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
  var hay = scanNorm(raw);
  var found = {};
  var why = {};

  function put(field, value, reason) {
    value = String(value || '').trim().replace(/\s+/g, ' ');
    if (!value) return;
    // Origin is the one field the two OCR passes routinely disagree on,
    // and first-wins picks the garbled one as often as the good one. Gather
    // every candidate and settle it once, on evidence, further down.
    if (field === 'origin') {
      value = trimEdges(stripAltitude(value));
      if (!value) return;
      if (originCands.indexOf(value) === -1) { originCands.push(value); originWhy[value] = reason; }
      return;
    }
    if (found[field]) return;
    found[field] = value;
    why[field] = reason;
  }
  var originCands = [], originWhy = {};

  /* Settle origin: a named region beats a town-and-state, which beats bare
     text; cleaner beats noisier; longer breaks the tie. */
  function resolveOrigin() {
    var best = null, bestScore = -Infinity;
    originCands.forEach(function (c) {
      var score = (looksLikePlace(c) ? 500 : 0) + regionScore(c) * 10
        - noiseCount(c) * 2 - (/\d/.test(c) ? 40 : 0) + c.length * 0.1;
      if (score > bestScore) { bestScore = score; best = c; }
    });
    if (best) { found.origin = correctRegion(trimEdges(best)); why.origin = originWhy[best]; }
  }

  // Raw text that tier 1 turned into a value. Tracked separately from the
  // values themselves because a vocabulary rewrites what it matched:
  // "FERMENTAÇÃO ANAERÓBICA 72H" becomes "Anaerobic", and without the
  // original recorded here that line stays free to be picked as the name.
  var consumed = [];
  function consume(text) {
    var n = scanNorm(text);
    if (n && consumed.indexOf(n) === -1) consumed.push(n);
  }

  // Notes routinely wrap. Keep pulling in following lines while the text so
  // far ends mid-list, which is precise enough not to swallow the next
  // section: "LARANJA, FRUTAS AMARELAS," continues, "…& ESPECIARIAS" stops.
  function withContinuation(val, from) {
    var frags = [val], added = 0;
    for (var j = from + 1; j < lines.length && added < 3; j++) {
      var nxt = lines[j].trim();
      if (!nxt || labelHits(nxt).length) break;
      // Continue either when the text so far stops mid-list, or when the
      // next line is plainly more flavours — OCR splits notes both ways
      // ("LARANJA, FRUTAS AMARELAS," / "ECARAMELO" then "MARACUJÁ DO CERRADO").
      var midList = /[,&]$|\se$/.test(frags[frags.length - 1].trim());
      if (!midList && !flavourHits(nxt)) break;
      frags.push(nxt);
      consume(nxt);
      added++;
    }
    return assembleNotes(frags);
  }

  function assign(field, val, reason, srcLine) {
    if (!val) return;
    if (field === 'skip') return;
    // Only text that is actually accepted counts as consumed. Marking it
    // up front meant a value the vocabulary went on to reject still burned
    // the line, and it could no longer be offered as the coffee's name.
    function take() {
      consume(val);
      if (srcLine) consume(srcLine);
    }
    // Where a field has a vocabulary, the labelled text has to produce a
    // known term to be believed. A label says where to look; only the
    // vocabulary says whether what's there is valid. "Torra: CAE 5" is
    // exactly the case — labelled, confident, and pure OCR noise, while
    // the real "Média" sat elsewhere in the text waiting for tier 2.
    // The vocabulary decides whether this is a real process or roast; it
    // does not decide how to say it. "Média" is stored as "Média" and
    // "Cereja descascado" as "Cereja descascado" — the label's own words,
    // not an English translation of them.
    if (field === 'process') {
      if (matchTerms(scanNorm(val), PROCESS_TERMS)) { take(); put('process', trimEdges(val), reason); }
      return;
    }
    if (field === 'roast') {
      if (matchTerms(scanNorm(val), ROAST_TERMS)) { take(); put('roast', trimEdges(val), reason); }
      return;
    }
    // A label already vouches that this is a tasting note, so one flavour
    // word is enough here — the stricter test is for finding notes with no
    // label at all.
    if (field === 'notes') {
      if (flavourHits(val)) { take(); put('notes', trimEdges(cleanNoteText(val)), reason); }
      return;
    }
    if (field === 'altitude') {
      var av = parseAltitudeLoose(val);
      if (av) { take(); put('altitude', av, reason); }
      return;
    }
    take();
    if (field === 'producer') put('origin', trimEdges(val), reason);
    else put(field, trimEdges(val), reason);
  }

  /* Some bags set labels in one column and values in another, and OCR
     reports that as every label, then every value. Pairing them off in
     order fails as soon as anything sits between the two runs — on one bag
     the producer's name did, which would have filed him as the variety.

     A label with a vocabulary can prove which value is its own, so one
     confident match anchors the rest: "Perfil de Torra" finds "Média
     Clara", and the offset that took carries "Variedade" to "Caparaó
     Amarelo" beside it. Without such an anchor nothing is assigned, since
     a guess here is worse than leaving the field for the review sheet. */
  function assignBlock(labelHitsList, values) {
    var anchor = -1, anchorVal = -1;
    labelHitsList.forEach(function (hit, p) {
      if (anchor !== -1) return;
      var table = hit.field === 'roast' ? ROAST_TERMS : (hit.field === 'process' ? PROCESS_TERMS : null);
      for (var v = 0; v < values.length; v++) {
        var ok = table ? matchTerms(scanNorm(values[v].text), table)
                       : (hit.field === 'altitude' ? parseAltitudeLoose(values[v].text) : '');
        if (ok) { anchor = p; anchorVal = v; return; }
      }
    });
    if (anchor === -1) return false;
    var offset = anchorVal - anchor;
    if (offset < 0) return false;
    var used = false;
    labelHitsList.forEach(function (hit, p) {
      var v = values[p + offset];
      if (!v) return;
      assign(hit.field, v.text, 'labelled “' + hit.label + '” in the column above', v.text);
      used = true;
    });
    return used;
  }

  var handledLine = {};

  // Tier 1 — labelled lines. Most reliable, so it runs first and wins.
  lines.forEach(function (line, i) {
    if (handledLine[i]) return;
    var hits = labelHits(line);
    if (!hits.length) return;

    var inline = hits.map(function (hit, k) {
      var stop = (k + 1 < hits.length) ? hits[k + 1].start : line.length;
      var val = line.slice(hit.end, stop).replace(/^\s*[:；;：\-–—]?\s*/, '').trim();
      // OCR mangles label wording constantly, so a short synonym can match
      // half of a longer label and leave the rest looking like a value.
      if (looksLikeLabelTail(val)) return '';
      // Punctuation debris is not a value. Treating it as one also stopped
      // the label reaching down to the real value on the next line.
      if (!/[A-Za-zÀ-ɏ0-9]/.test(val)) return '';
      return val;
    });

    var anyInline = inline.some(function (v) { return !!v; });
    var next = (lines[i + 1] || '').trim();
    var nextIsValues = next && !labelHits(next).length;

    // A run of bare labels one per line, followed by a run of values.
    if (!anyInline && hits.length === 1 && next && labelHits(next).length) {
      var block = [hits[0]], k = i + 1;
      for (; k < lines.length; k++) {
        var h = labelHits(lines[k]);
        if (h.length !== 1) break;
        var inlineVal = lines[k].slice(h[0].end).replace(/^\s*[:；;：\-–—]?\s*/, '').trim();
        if (inlineVal) break;
        block.push(h[0]);
      }
      if (block.length >= 2) {
        var vals = [];
        for (; k < lines.length && vals.length < block.length + 4; k++) {
          if (labelHits(lines[k]).length) break;
          vals.push({ text: lines[k], at: k });
        }
        if (vals.length && assignBlock(block, vals)) {
          for (var b = 0; b < block.length; b++) handledLine[i + b] = true;
          return;
        }
      }
    }

    // A whole row of labels with nothing beside them means the values are
    // on the row below — pair them up rather than letting only the last
    // label reach down for the lot.
    if (!anyInline && nextIsValues) {
      var share = distributeRow(hits, next);
      hits.forEach(function (hit, k) {
        if (share[k] === undefined) return;
        var v = (hit.field === 'notes') ? withContinuation(share[k], i + 1) : share[k];
        assign(hit.field, v, 'labelled “' + hit.label + '” on the line above', next);
      });
      return;
    }

    hits.forEach(function (hit, k) {
      var val = inline[k];
      if (!val && k === hits.length - 1 && nextIsValues) val = next;
      if (!val) return;
      if (hit.field === 'notes') val = withContinuation(val, val === next ? i + 1 : i);
      assign(hit.field, val, 'from the “' + hit.label + '” line', line);
    });
  });

  // Tier 2 — vocabulary and pattern matching over everything else.
  if (!found.altitude) {
    for (var ai = 0; ai < lines.length; ai++) {
      var alt = parseAltitude(lines[ai]);
      if (alt) {
        put('altitude', alt, 'a height in metres appears on the label');
        consume(lines[ai]);
        break;
      }
    }
  }
  /* Unlabelled fields are found by looking for a known term line by line,
     rather than across the whole text at once, so the words the bag printed
     can be lifted out and kept. Matching tells us the value is real; it is
     not licence to reword it. */
  function findByVocabulary(field, table, reason) {
    if (found[field]) return;
    for (var li = 0; li < lines.length; li++) {
      var span = findTermSpan(lines[li], table);
      if (!span) continue;
      put(field, trimEdges(lines[li].slice(span.start, span.end)), reason);
      return;
    }
  }
  findByVocabulary('process', PROCESS_TERMS, 'the label mentions this process');
  findByVocabulary('varietal', VARIETAL_TABLE, 'a recognised variety name on the label');
  findByVocabulary('roast', ROAST_TERMS, 'the label mentions this roast level');
  for (var pi = 0; pi < lines.length; pi++) {
    // Skip anything tier 1 already carved up, or the un-split row comes
    // back and beats the clean half taken out of it.
    if (consumed.indexOf(scanNorm(lines[pi])) !== -1) continue;
    if (looksLikePlace(lines[pi])) put('origin', lines[pi], 'reads as a town and state');
    else if (regionScore(lines[pi]) && !labelHits(lines[pi]).length) {
      put('origin', lines[pi], 'names a known growing region');
    }
  }
  if (!found.notes) {
    // Both layout passes usually see the notes, one cleanly and one full of
    // debris ("...frutas amare| Eta NENAAS:"). Pick by cleanliness, not by
    // length — the longer copy is often the more damaged one.
    var best = '', bestNoise = Infinity;
    lines.forEach(function (line) {
      if (!looksLikeNotes(line)) return;
      var noise = noiseCount(line);
      if (noise < bestNoise || (noise === bestNoise && line.length > best.length)) {
        best = line; bestNoise = noise;
      }
    });
    if (best) put('notes', trimEdges(cleanNoteText(best)), 'reads as a list of tasting notes');
  }

  // Roaster: match against roasters already in the library first. That is
  // by far the strongest signal available — OCR rarely reads a logo well,
  // but it usually gets enough characters for an existing name to match.
  var roasters = coll('roaster');
  for (var r = 0; r < roasters.length; r++) {
    var rn = scanNorm(roasters[r].name);
    if (rn.length >= 3 && hay.indexOf(rn) !== -1) {
      put('roasterName', roasters[r].name, 'matches a roaster already in your library');
      break;
    }
  }

  // Name: the tallest line that isn't a label, a weight, or boilerplate,
  // and isn't something already claimed by another field. Without the last
  // check the town-and-state line wins on height and becomes the name.
  resolveOrigin();

  var taken = consumed.slice();
  ['roasterName', 'origin', 'notes', 'varietal', 'process', 'roast', 'altitude'].forEach(function (k) {
    if (found[k]) taken.push(scanNorm(found[k]));
  });
  var tall = linesByHeight(data);
  var byPos = {};
  tall.forEach(function (l) { byPos[l.at] = l; });
  for (var t = 0; t < tall.length; t++) {
    var cand = trimEdges(tall[t].text.replace(/[|_~"'`]+/g, ''));
    if (!looksLikeName(cand)) continue;
    if (taken.indexOf(scanNorm(cand)) !== -1) continue;
    // Names are often set over two lines ("família" above "carolino").
    // Join the next one when it is the same size and reads as a name too —
    // a real second line matches in height; the next section never does.
    var nxt = byPos[tall[t].at + 1];
    if (nxt && tall[t].h > 0 && nxt.h / tall[t].h >= 0.75) {
      var join = trimEdges(nxt.text.replace(/[|_~"'`]+/g, ''));
      if (join && looksLikeName(join) && taken.indexOf(scanNorm(join)) === -1) {
        cand = cand + ' ' + join;
      }
    }
    // The biggest text is sometimes only part of the name: a bag can set
    // "Roseira" large and "Sítio Roseira" smaller beneath it. Prefer a
    // fuller line that contains the winner — but only a clean one, or
    // "Fazenda Jaguara" gets traded for "Fazenda Jaguara [cana Amarelo hat".
    var nc = scanNorm(cand);
    tall.forEach(function (l) {
      var alt = trimEdges(l.text.replace(/[|_~"'`]+/g, ''));
      if (!alt || scanNorm(alt) === nc) return;
      if (!looksLikeName(alt) || taken.indexOf(scanNorm(alt)) !== -1) return;
      var na = scanNorm(alt);
      if (na.indexOf(nc) === -1 || na.length <= nc.length) return;
      if (na.length > nc.length * 2.5) return;
      if (noiseCount(alt) > noiseCount(cand)) return;
      // What it adds has to be a word. A stray leading character is
      // alphanumeric too, so without this "FAZENDA SERTÃO" loses to
      // "7 FAZENDA SERTÃO".
      var base = nc.split(' ');
      var extra = na.split(' ').filter(function (w) { return base.indexOf(w) === -1; });
      if (!extra.some(function (w) { return w.length >= 2; })) return;
      cand = alt; nc = na;
    });
    put('name', cand, 'the largest text on the label');
    break;
  }

  return { found: found, why: why, raw: raw };
}

/* ---- scan UI ---- */

// Which proposed fields the review sheet offers, in the order the form
// itself asks for them.
var SCAN_FIELDS = [
  ['name', 'Name'], ['roasterName', 'Roaster'], ['origin', 'Origin'],
  ['altitude', 'Altitude'], ['process', 'Process'], ['roast', 'Roast level'],
  ['varietal', 'Varietal'], ['notes', 'Tasting notes']
];

function scanBlockHTML(state) {
  var inner;
  if (state && state.busy) {
    var frac = Math.max(0, Math.min(1, state.progress || 0));
    inner = '<div class="scan-busy"><div class="scan-bar">' +
      '<i style="transform:scaleX(' + frac.toFixed(3) + ')"></i></div>' +
      '<p>' + esc(state.label || t('Reading the label…')) + '</p></div>';
  } else if (state && state.error) {
    inner = '<p class="scan-err">' + esc(state.error) + '</p>' +
      '<button class="btn btn-ghost btn-sm" data-action="scan-label">' + ICON.camera + esc(t('Try again')) + '</button>';
  } else {
    inner = '<button class="btn btn-ghost btn-sm" data-action="scan-label">' + ICON.camera + esc(t('Scan label')) + '</button>' +
      '<p>' + esc(t('Fill the frame with the label itself, not the whole bag — the panel listing origin, process and notes. Small print needs a close, straight, evenly lit shot. Nothing leaves your device.')) + '</p>';
  }
  return '<div class="scan">' + inner + '</div>';
}

// Repaints just the scan block. A full renderModals() would throw away
// whatever is half-typed in the form, and this runs on every progress tick.
function paintScan(m, state) {
  if (!m || !m.el) return;
  var block = m.el.querySelector('.scan');
  if (!block || !block.isConnected) return;
  var fresh = document.createElement('div');
  fresh.innerHTML = scanBlockHTML(state);
  block.replaceWith(fresh.firstChild);
}

/* The input is attached to the page, not just created, and stays there until
   the picker answers. A detached input can be garbage-collected on iOS while
   the camera or photo library is open — taking a photo is slow enough for it
   to happen — and its change listener goes with it, so the chosen photo was
   silently dropped and the scan had to be started again. */
var pendingPick = null;
function pickImage() {
  if (pendingPick) pendingPick.remove();
  return new Promise(function (resolve) {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    // No `capture` attribute on purpose: leaving it off lets the phone
    // offer both the camera and an existing photo, which matters for a bag
    // already drunk and thrown away.
    inp.hidden = true;
    inp.setAttribute('aria-hidden', 'true');
    document.body.appendChild(inp);
    pendingPick = inp;
    function done(file) {
      inp.remove();
      if (pendingPick === inp) pendingPick = null;
      resolve(file);
    }
    inp.addEventListener('change', function () {
      done(inp.files && inp.files[0] ? inp.files[0] : null);
    });
    inp.addEventListener('cancel', function () { done(null); });
    inp.click();
  });
}

function startLabelScan(m) {
  if (!m || m.type !== 'coffee') return;
  pickImage().then(function (file) {
    if (!file) return;
    paintScan(m, { busy: true, progress: 0, label: t('Preparing the photo…') });
    return prepScanImage(file).then(function (prepped) {
      paintScan(m, { busy: true, progress: 0, label: t('Loading the reader…') });
      return runScanOCR(prepped.canvas, function (p) {
        paintScan(m, { busy: true, progress: p, label: t('Reading the label…') });
      });
    }).then(function (data) {
      // The sheet may have been closed while OCR ran; writing into a
      // discarded draft would silently lose the result.
      if (stack.indexOf(m) === -1) return;
      paintScan(m, null);
      var parsed = parseLabel(data);
      var any = false, k;
      for (k in parsed.found) if (Object.prototype.hasOwnProperty.call(parsed.found, k)) { any = true; break; }
      if (!any && !parsed.raw.trim()) {
        paintScan(m, { error: t('Couldn’t read any text. Try filling the frame with the label, in even light.') });
        return;
      }
      openScanReview(m, parsed);
    });
  }).catch(function (err) {
    var msg = t('Something went wrong reading that photo.');
    if (err && err.message === 'tesseract-network') {
      msg = t('Couldn’t load the text reader — check your connection and try again.');
    } else if (err && err.message === 'decode') {
      msg = t('That file didn’t open as an image.');
    }
    paintScan(m, { error: msg });
  });
}

/* The review step. Nothing the scanner found is written to the form until
   it's confirmed here: OCR on a curved foil bag is wrong often enough that
   silently overwriting typed fields would be the worst possible behaviour.
   Each row can be unticked, and every value stays editable. */
function openScanReview(parent, parsed) {
  var review = {
    render: function () {
      var rows = '';
      SCAN_FIELDS.forEach(function (pair) {
        var k = pair[0];
        var val = parsed.found[k];
        if (!val) return;
        var current = (parent.draft[k] || '').trim();
        var clash = current && current.toLowerCase() !== val.toLowerCase();
        rows += '<div class="scan-row">' +
          '<label class="scan-take"><input type="checkbox" data-take="' + k + '" checked />' +
            '<span>' + esc(pair[1]) + '</span></label>' +
          '<input class="inp" data-val="' + k + '" value="' + esc(val) + '" />' +
          '<p class="scan-why">' + esc(parsed.why[k] || '') +
            (clash ? ' · replaces “' + esc(current) + '”' : '') + '</p>' +
        '</div>';
      });
      if (!rows) {
        rows = '<p class="scan-none">Text came through, but none of it matched a field. ' +
          'The full reading is below — copy anything useful.</p>';
      }
      var body = '<div class="scan-review">' + rows +
        '<details class="scan-raw"><summary>' + esc(t('Everything it read')) + '</summary>' +
        '<pre>' + esc(parsed.raw.trim() || '—') + '</pre></details></div>';
      var foot = '<button class="btn btn-ghost" data-action="close-modal">' + esc(t('Cancel')) + '</button>' +
        '<button class="btn btn-primary" data-action="apply-scan">' + esc(t('Fill fields')) + '</button>';
      return sheet({ title: t('What the label says'), body: body, foot: foot, narrow: true });
    },
    applyScan: function () {
      var el = review.el;
      if (!el) return;
      SCAN_FIELDS.forEach(function (pair) {
        var k = pair[0];
        var take = el.querySelector('[data-take="' + k + '"]');
        var val = el.querySelector('[data-val="' + k + '"]');
        if (take && take.checked && val && val.value.trim()) parent.draft[k] = val.value.trim();
      });
      // closeModal re-renders the stack, and the parent form builds from
      // its draft — so the filled values appear without disturbing
      // anything already typed into it.
      closeModal();
    }
  };
  openModal(review);
}

/* ---------------------------------------------------------
   10. Entity form (coffee / grinder / method / style)
   --------------------------------------------------------- */

function openEntityForm(type, existing, onSaved, prefill) {
  var def = ENTITIES[type];
  var draft = existing ? JSON.parse(JSON.stringify(existing)) : { id: '' };
  // The roaster is edited by name and resolved back to a record on save.
  if (type === 'coffee') draft.roasterName = existing ? roasterNameOf(existing) : '';
  // Adding a coffee from the recipe form carries the roaster already chosen
  // there, so the new coffee lands inside the filter that opened this form.
  if (!existing && prefill) {
    for (var pk in prefill) if (Object.prototype.hasOwnProperty.call(prefill, pk)) draft[pk] = prefill[pk];
  }
  var m = {
    draft: draft,
    capture: function () { readEntityForm(m, def); },
    render: function () {
      var d = m.draft;
      var body = def.fields.map(function (f) {
        var val = esc(d[f.k] == null ? '' : d[f.k]);
        var control;
        if (f.kind === 'autocomplete') {
          // Free text backed by a datalist of roasters already on record.
          // Typing reuses an existing one — so the same roaster doesn't end up
          // spelled three different ways — and an unrecognised name simply
          // creates it on save, with no separate "add a roaster" detour.
          var dl = 'dl-' + f.k;
          var listOpts = allRoasters().map(function (ro) {
            return '<option value="' + esc(ro.name) + '"></option>';
          }).join('');
          control = '<input class="inp" id="e-' + f.k + '" data-k="' + f.k + '" list="' + dl + '" ' +
            'value="' + val + '" placeholder="' + esc(t(f.ph || '')) + '" autocomplete="off" />' +
            '<datalist id="' + dl + '">' + listOpts + '</datalist>';
        } else if (f.kind === 'choice') {
          // A fixed list. A value typed in other words is read for its
          // meaning; one that names nothing stays as an extra choice, so
          // saving the form never loses it.
          var cur = (f.read && f.read(d[f.k])) || (d[f.k] || '');
          var opts = [''].concat(typeof f.choices === 'function' ? f.choices() : f.choices);
          if (cur && opts.indexOf(cur) < 0) opts.push(cur);
          control = '<select class="inp" id="e-' + f.k + '" data-k="' + f.k + '">' +
            opts.map(function (o) {
              return '<option value="' + esc(o) + '"' + (o === cur ? ' selected' : '') + '>' +
                esc(o ? t(o) : '— ' + t('Not set') + ' —') + '</option>';
            }).join('') + '</select>';
        } else if (f.area) {
          control = '<textarea class="inp" id="e-' + f.k + '" data-k="' + f.k + '" placeholder="' + esc(t(f.ph || '')) + '">' + val + '</textarea>';
        } else {
          control = '<input class="inp" id="e-' + f.k + '" data-k="' + f.k + '" value="' + val + '" placeholder="' + esc(t(f.ph || '')) + '" />';
        }
        return '<div class="field"><label for="e-' + f.k + '">' + esc(t(f.l)) + (f.req ? '' : ' <span style="text-transform:none;letter-spacing:0">(' + esc(t('optional')) + ')</span>') + '</label>' +
          control + '</div>';
      }).join('');
      // Only coffees have a printed label to read, so only coffees get the
      // scanner — and it sits above the fields, since it fills them.
      if (type === 'coffee') body = scanBlockHTML() + body;
      // A style is the one entity that carries a process, not just facts —
      // so it gets the step builder under its plain fields.
      if (type === 'style') body += styleStepsSectionHTML(d);
      var foot = '<button class="btn btn-ghost" data-action="close-modal">' + esc(t('Cancel')) + '</button>' +
        '<button class="btn btn-primary" data-action="save-entity">' +
          esc(d.id ? t('Save changes') : t('Add ' + def.label.toLowerCase())) + '</button>';
      return sheet({ title: t((d.id ? 'Edit ' : 'Add ') + def.label.toLowerCase()), body: body, foot: foot, narrow: type !== 'style' });
    },
    type: type,
    onSaved: onSaved
  };
  openModal(m);
}

function readEntityForm(m, def) {
  if (!m.el) return;
  // Guarded on rows existing: a built-in formula style renders no builder at
  // all, and reading it blind would wipe the steps of anything that has them.
  var rows = m.el.querySelectorAll('.stepbuild-row');
  if (rows.length) {
    m.draft.steps = [].map.call(rows, function (row) {
      return {
        t: normTime(row.querySelector('[data-s="t"]').value),
        label: row.querySelector('[data-s="label"]').value.trim()
      };
    });
  }
  def.fields.forEach(function (f) {
    var input = m.el.querySelector('[data-k="' + f.k + '"]');
    if (input) m.draft[f.k] = input.value.trim();
  });
}

function saveEntity(m) {
  var def = ENTITIES[m.type];
  readEntityForm(m, def);
  var d = m.draft;
  if (!d.name) { toast(t('Give it a name first.')); return; }
  // Drop the blank row the builder always keeps at the end.
  if (d.steps) d.steps = d.steps.filter(function (s) { return s.t || s.label; });

  // Resolve the typed roaster name to a record: reuse an existing one when
  // the name matches (case- and space-insensitively, so "Moka Clube" and
  // "moka clube " are the same roaster), otherwise create it now. roasterName
  // itself is a form-only field and never gets stored on the coffee.
  if (m.type === 'coffee') {
    var typed = (d.roasterName || '').trim();
    delete d.roasterName;
    if (!typed) {
      d.roasterId = '';
    } else {
      var match = coll('roaster').filter(function (ro) {
        return (ro.name || '').trim().toLowerCase() === typed.toLowerCase();
      })[0];
      if (!match) {
        match = { id: uid('roa'), name: typed, location: '' };
        coll('roaster').push(match);
      }
      d.roasterId = match.id;
    }
    d.roaster = typed;   // legacy mirror, kept readable by older tabs
  }

  if (d.id) {
    var existing = findIn(m.type, d.id);
    for (var k in d) if (Object.prototype.hasOwnProperty.call(d, k)) existing[k] = d[k];
  } else {
    d.id = uid(m.type.slice(0, 3));
    coll(m.type).push(d);
  }
  save();

  // Pop this modal *before* re-rendering, so the callback can write into the
  // parent form's draft and have that draft be what gets painted.
  var cb = m.onSaved;
  stack.pop();
  if (cb) cb(d.id);
  renderModals();
  render();
  toast(t(def.label + ' saved.'));
}

/* ---------------------------------------------------------
   11. Library manager
   --------------------------------------------------------- */

/* ---- library ----
   A destination, not a modal. It is reached from the nav, so it keeps the
   nav: a full-screen page laid over the tab bar hid the very control you
   used to get here, and left the Library tab lit behind a sheet covering
   it. Entity forms still open as pages on top — those are tasks you
   finish and leave, which is a different thing from a place you are. */
var libraryTab = 'coffee';
var libraryQuery = '';

function libraryListHTML(tab) {
  var def = ENTITIES[tab];
  var all = coll(tab).slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
  var q = libraryQuery.trim().toLowerCase();
  // Matches the meta line too, so a coffee is findable by its roaster,
  // origin or process — the things actually printed on the row.
  var list = q ? all.filter(function (e) {
    return (e.name + ' ' + (def.meta(e) || '')).toLowerCase().indexOf(q) !== -1;
  }) : all;

  if (!all.length) {
    return '<div class="empty" style="padding:44px 20px">' +
      '<h3 style="font-size:18px">' + esc(t('Nothing here yet')) + '</h3>' +
      '<p>' + esc(t('Add your first ' + def.label.toLowerCase() + '.')) + '</p></div>';
  }
  if (!list.length) {
    return '<div class="empty" style="padding:36px 20px">' +
      '<h3 style="font-size:18px">' + esc(t('Nothing matches') + ' “' + libraryQuery.trim() + '”') + '</h3>' +
      '<p>' + esc(t('Try a shorter search, or clear it to see all ') +
        coll(tab).length + ' ' + t(ENTITIES[tab].plural.toLowerCase()) + '.') + '</p></div>';
  }
  return list.map(function (e) {
    var used = def.usedBy ? def.usedBy(e.id) : state.recipes.filter(function (r) { return r[def.ref] === e.id; }).length;
    var noun = def.usedLabel || 'recipe';
    var meta = def.meta(e);
    return '<div class="list-item">' +
      '<div class="txt"><div class="nm">' + esc(e.name) + '</div>' +
        (meta ? '<div class="mt">' + esc(meta) + '</div>' : '') + '</div>' +
      '<span class="cnt">' + used + ' ' + (used === 1 ? noun : noun + 's') + '</span>' +
      '<button class="iconbtn" data-action="lib-edit" data-type="' + tab + '" data-id="' + esc(e.id) + '" aria-label="' + esc(t('Edit')) + '">' + ICON.edit + '</button>' +
      '<button class="iconbtn danger" data-action="lib-del" data-type="' + tab + '" data-id="' + esc(e.id) + '" aria-label="' + esc(t('Delete')) + '">' + ICON.trash + '</button>' +
    '</div>';
  }).join('');
}

function libraryTabsHTML() {
  return Object.keys(ENTITIES).map(function (tab) {
    return '<button data-action="lib-tab" data-type="' + tab + '" class="' + (tab === libraryTab ? 'on' : '') + '">' +
      esc(t(ENTITIES[tab].plural)) + ' <span style="opacity:.55">' + coll(tab).length + '</span></button>';
  }).join('');
}

function librarySearchPlaceholder() {
  return t('Search ') + t(ENTITIES[libraryTab].plural.toLowerCase()) + '…';
}

function libraryAddHTML() {
  var def = ENTITIES[libraryTab];
  return ICON.plus + '<span>' + esc(t('Add ' + def.label.toLowerCase())) + '</span>';
}

function renderLibrary() {
  view.classList.remove('view-enter');
  view.innerHTML = '<div class="library">' +
    '<div class="library-head">' +
      '<h1>' + esc(t('Library')) + '</h1>' +
      '<p>' + esc(t('Coffees, roasters and gear your recipes refer to. Edit one here and every recipe using it follows.')) + '</p>' +
    '</div>' +
    '<div class="tabs" id="libTabs">' + libraryTabsHTML() + '</div>' +
    '<div class="search library-search">' + ICON.search +
      '<input id="libQ" type="search" autocomplete="off" value="' + esc(libraryQuery) + '" ' +
        'placeholder="' + esc(librarySearchPlaceholder()) + '" />' +
    '</div>' +
    // Above the list, not below it: at the foot of fifty-eight coffees,
    // adding one meant scrolling past every coffee you already had.
    '<button class="btn btn-primary library-add" data-action="lib-add" data-type="' + libraryTab + '">' +
      libraryAddHTML() + '</button>' +
    '<div class="list" id="libList">' + libraryListHTML(libraryTab) + '</div>' +
  '</div>';
  window.scrollTo(0, 0);
  tabsLens(document.getElementById('libTabs'));
}

/* Swaps the tab strip and the list in place. A full re-render rebuilt the
   whole page for what is a change of context inside it, which reads as a
   reload and throws away your scroll position. */
function paintLibraryList() {
  var list = document.getElementById('libList');
  if (list) list.innerHTML = libraryListHTML(libraryTab);
}

function paintLibraryTab() {
  var tabs = document.getElementById('libTabs');
  var list = document.getElementById('libList');
  var add = document.querySelector('.library-add');
  if (!tabs || !list) { renderLibrary(); return; }
  // The search does not carry across tabs: a term that found a coffee
  // would land on Grinders as an empty list with no obvious cause.
  libraryQuery = '';
  var q = document.getElementById('libQ');
  if (q) { q.value = ''; q.placeholder = librarySearchPlaceholder(); }
  tabs.innerHTML = libraryTabsHTML();
  list.innerHTML = libraryListHTML(libraryTab);
  if (add) {
    add.innerHTML = libraryAddHTML();
    add.setAttribute('data-type', libraryTab);
  }
}

function deleteEntity(type, id) {
  var def = ENTITIES[type];
  var e = findIn(type, id);
  if (!e) return;
  var used = def.usedBy ? def.usedBy(id) : state.recipes.filter(function (r) { return r[def.ref] === id; }).length;
  var noun = def.usedLabel || 'recipe';
  var body = '<p>Delete “' + esc(e.name) + '”?</p>' +
    (used ? '<p>It is used by ' + used + ' ' + (used === 1 ? noun : noun + 's') +
      ', which will show “—” for this field until you edit them.</p>' : '');
  confirmDanger({
    title: t('Delete ' + def.label.toLowerCase()),
    body: body,
    confirmLabel: t('Delete'),
    onConfirm: function () {
      closeModal();
      state[def.coll] = coll(type).filter(function (x) { return x.id !== id; });
      save();
      renderModals();
      render();
      toast(t(def.label + ' deleted.'));
    }
  });
}

/* ---------------------------------------------------------
   12. Import / export / reset
   --------------------------------------------------------- */

function exportData() {
  var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'brew-library-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  toast(t('Exported.'));
}

function importData(file) {
  var reader = new FileReader();
  reader.onload = function () {
    var data;
    try {
      data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.recipes) || !Array.isArray(data.coffees)) throw new Error('bad shape');
    } catch (e) {
      toast(t('That file does not look like a Brew Library export.'));
      return;
    }
    var have = state.recipes.length, incoming = data.recipes.length;
    confirmDanger({
      title: 'Replace your library',
      body: '<p>Replace your current library — ' + have + ' ' + (have === 1 ? 'recipe' : 'recipes') +
        ' — with the imported file (' + incoming + ' ' + (incoming === 1 ? 'recipe' : 'recipes') + ')?</p>' +
        '<p>' + esc(t('This cannot be undone — export a backup first if unsure.')) + '</p>',
      confirmLabel: 'Replace library',
      onConfirm: function () {
        closeModal();
        state = normalizeLibrary(data);
        save();
        render();
        toast(t('Library imported.'));
      }
    });
  };
  reader.readAsText(file);
}

function resetAll() {
  var n = state.recipes.length;
  confirmDanger({
    title: 'Reset the library',
    body: '<p>Reset the library back to the starter data?</p>' +
      '<p>Every recipe and coffee you added will be deleted' +
      (n ? ' — including ' + n + ' ' + (n === 1 ? 'recipe' : 'recipes') + ' you currently have' : '') + '.</p>',
    confirmLabel: 'Reset library',
    onConfirm: function () {
      closeModal();
      initialLibraryFor(currentUser).then(function (fresh) {
        state = normalizeLibrary(fresh);
        save({ keepPristine: true });
        location.hash = '#/';
        render();
        toast(t('Library reset.'));
      });
    }
  });
}

/* ---------------------------------------------------------
   13. Events
   --------------------------------------------------------- */

// Both popovers dismiss on any click outside themselves. The detail menu is
// rebuilt by render(), so it's looked up fresh rather than cached.
function closeMenu() {
  var app = document.getElementById('appMenu');
  if (app) app.hidden = true;
  var detail = document.getElementById('detailMenu');
  if (detail) {
    detail.hidden = true;
    var trigger = document.querySelector('[data-action="toggle-detail-menu"]');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }
}

document.addEventListener('click', function (ev) {
  var btn = ev.target.closest('[data-action]');
  var menu = ev.target.closest('#appMenu, [data-action="toggle-menu"], #detailMenu, [data-action="toggle-detail-menu"]');
  if (!menu) closeMenu();
  if (!btn) return;

  var action = btn.getAttribute('data-action');
  var id = btn.getAttribute('data-id');
  var type = btn.getAttribute('data-type');
  var top = stack[stack.length - 1];

  switch (action) {
    case 'home': return;

    case 'toggle-menu':
      ev.preventDefault();
      var mn = document.getElementById('appMenu');
      mn.hidden = !mn.hidden;
      return;

    case 'toggle-detail-menu':
      ev.preventDefault();
      var dm = document.getElementById('detailMenu');
      if (!dm) return;
      dm.hidden = !dm.hidden;
      btn.setAttribute('aria-expanded', dm.hidden ? 'false' : 'true');
      return;

    case 'new-recipe':
      ev.preventDefault();
      if (!state.coffees.length) {
        openEntityForm('coffee', null, function () { openRecipeForm(null); });
        toast(t('Add a coffee first — then the recipe.'));
        return;
      }
      openRecipeForm(null);
      return;

    case 'set-theme':
      ev.preventDefault();
      var themeBox = btn.closest('.segs');
      var themeFrom = lensPos(themeBox);
      setTheme(btn.getAttribute('data-theme-choice') || 'auto');
      Array.prototype.forEach.call(themeBox.querySelectorAll('.seg'), function (b) {
        b.classList.toggle('on', b === btn);
      });
      tabsLens(themeBox, themeFrom);
      return;

    case 'set-lang':
      ev.preventDefault();
      setLang(btn.getAttribute('data-lang') || 'auto');
      closeMenu();
      translateMarkup();
      renderModals();
      render();
      return;

    case 'open-library': ev.preventDefault(); location.hash = '#/library'; return;

    case 'fav':
      ev.preventDefault(); ev.stopPropagation();
      var fr = recipeById(id);
      if (!fr) return;
      fr.fav = !fr.fav;
      save();
      render();
      // v3 gives the favourite mark the system's only spring. render()
      // rebuilds the DOM, so the animation class goes on afterwards —
      // otherwise every already-favourited mark would pop on each render.
      if (fr.fav) {
        Array.prototype.forEach.call(
          document.querySelectorAll('.fav[data-id="' + id + '"]'),
          function (el) { el.classList.add('pop'); }
        );
      }
      return;

    case 'timer':
      ev.preventDefault(); ev.stopPropagation();
      openTimer(id);
      return;

    case 'timer-toggle':
      ev.preventDefault();
      if (!timer) return;
      // Once the ring has closed the same button becomes "brew again".
      if (timer.elapsed >= timer.plan.total) timerReset(true);
      else timerRun(!timer.running);
      return;

    case 'timer-reset':
      ev.preventDefault();
      timerReset();
      return;

    case 'timer-mute':
      ev.preventDefault();
      timerMuted = !timerMuted;
      saveTimerMuted();
      // Unmuting is itself a gesture, so take it as permission to start audio
      // and confirm with the cue the user just re-enabled.
      if (!timerMuted) { timerAudio(); timerCue('warn'); }
      timerControls();
      return;

    // v3's BrewTimer offers a skip — you're ahead of the schedule and
    // want the next instruction now, not in twenty seconds.
    case 'timer-skip':
      ev.preventDefault();
      if (!timer) return;
      var seg = timer.plan.segs[timer.seg];
      if (!seg) return;
      timer.elapsed = Math.min(timer.plan.total, seg.end);
      timer.from = timer.elapsed;
      timer.at = performance.now();
      timer.warned = false;
      timerPaint();
      if (timer.elapsed >= timer.plan.total) {
        timerFinish();
      }
      return;

    case 'edit':
      ev.preventDefault();
      openRecipeForm(recipeById(id));
      return;

    case 'duplicate':
      ev.preventDefault();
      closeMenu();
      var src = recipeById(id);
      if (!src) return;
      var copy = JSON.parse(JSON.stringify(src));
      copy.id = uid('rec');
      copy.name = (titleOf(src)) + ' (copy)';
      copy.createdAt = copy.updatedAt = Date.now();
      copy.fav = false;
      state.recipes.push(copy);
      save();
      location.hash = '#/r/' + encodeURIComponent(copy.id);
      toast(t('Duplicated — edit away.'));
      return;

    case 'delete':
      ev.preventDefault();
      closeMenu();
      var dr = recipeById(id);
      if (!dr) return;
      confirmDanger({
        title: t('Delete recipe'),
        body: '<p>Delete “' + esc(titleOf(dr)) + '”?</p>',
        confirmLabel: 'Delete',
        onConfirm: function () {
          closeModal();
          state.recipes = state.recipes.filter(function (r) { return r.id !== id; });
          save();
          location.hash = '#/';
          render();
          toast(t('Recipe deleted.'));
        }
      });
      return;

    case 'dose-step':
      ev.preventDefault();
      var dr = recipeById(doseView.id);
      if (dr && scalable(dr)) {
        var cur = doseView.dose != null ? doseView.dose : Number(dr.dose);
        var next = Math.max(1, Math.round(cur + Number(btn.getAttribute('data-d'))));
        doseView.dose = next === Number(dr.dose) ? null : next;
        renderDetail(dr.id, true);
      }
      return;

    case 'dose-reset':
      ev.preventDefault();
      doseView.dose = null;
      if (doseView.id) renderDetail(doseView.id, true);
      return;

    case 'pick-kind':
      ev.preventDefault();
      var kindFrom = lensPos(document.querySelector('.ktabs'));
      var kindScroll = (document.querySelector('.ktabs') || {}).scrollLeft || 0;
      filters.kind = btn.getAttribute('data-kind') || '';
      renderHome();
      var kt = document.querySelector('.ktabs');
      if (kt) { kt.scrollLeft = kindScroll; tabsLens(kt, kindFrom); }
      return;

    case 'clear-filters':
      filters.q = ''; filters.coffee = ''; filters.roaster = ''; filters.grinder = '';
      filters.method = ''; filters.style = ''; filters.fav = false; filters.kind = '';
      openCombo = null; comboQuery = '';
      render();
      return;

    case 'toggle-fav-filter':
      filters.fav = !filters.fav;
      render();
      return;

    case 'combo-toggle':
      openCombo = openCombo === type ? null : type;
      comboQuery = '';
      repaintFilters();
      if (openCombo) { var cf = document.getElementById('f-combo-' + openCombo); if (cf) cf.focus(); }
      return;

    case 'combo-clear':
      comboQuery = '';
      repaintFilters();
      var cc = document.getElementById('f-combo-' + openCombo);
      if (cc) cc.focus();
      return;

    case 'combo-pick':
      filterTarget[type] = id;
      openCombo = null;
      comboQuery = '';
      repaintFilters();
      return;

    case 'filters-open':
      ev.preventDefault();
      openFilters();
      return;

    case 'filters-clear-draft':
      ev.preventDefault();
      if (top && top.draft) {
        top.draft.coffee = top.draft.roaster = top.draft.grinder = '';
        top.draft.method = top.draft.style = '';
        top.draft.fav = false;
        top.draft.sort = 'new';
        renderModals();
      }
      return;

    case 'filters-toggle-fav':
      ev.preventDefault();
      if (top && top.draft) { top.draft.fav = !top.draft.fav; renderModals(); }
      return;

    case 'filters-apply':
      ev.preventDefault();
      if (top && top.draft) {
        // q stays live from the home search field and is never part of
        // the draft, so it is deliberately not copied back.
        ['coffee', 'roaster', 'grinder', 'method', 'style', 'fav', 'sort'].forEach(function (k) {
          filters[k] = top.draft[k];
        });
      }
      closeModal();
      renderHome();
      return;

    case 'sign-in':
      ev.preventDefault();
      window.Brew.signIn().catch(function (err) {
        if (err && err.code === 'auth/popup-blocked') {
          toast('Your browser blocked the sign-in popup — allow popups for this site and try again.');
        } else if (err && err.code === 'auth/popup-closed-by-user') {
          // They closed it themselves — no need to show an error.
        } else {
          toast(t('Could not sign in') + (err && err.code ? ' (' + err.code + ')' : '') + '.');
        }
      });
      return;

    case 'sign-out':
      ev.preventDefault();
      if (unsubscribeLibrary) { unsubscribeLibrary(); unsubscribeLibrary = null; }
      window.Brew.signOutUser();
      return;

    /* --- modal actions --- */
    case 'close-modal': ev.preventDefault(); closeModal(); return;

    case 'confirm-danger':
      ev.preventDefault();
      if (top && top._onConfirm) top._onConfirm();
      return;

    case 'add-step':
      top.capture();
      top.draft.steps.push({ t: '', label: '', water: '' });
      renderModals();
      focusLastStep(top, '.steprow');
      return;

    case 'del-step':
      top.capture();
      top.draft.steps.splice(Number(btn.getAttribute('data-i')), 1);
      if (!top.draft.steps.length) top.draft.steps.push({ t: '', label: '', water: '' });
      renderModals();
      return;

    case 'style-step-add':
      top.capture();
      if (!top.draft.steps) top.draft.steps = [];
      top.draft.steps.push({ t: '', label: '' });
      renderModals();
      focusLastStep(top, '.stepbuild-row');
      return;

    case 'style-step-del':
      top.capture();
      top.draft.steps.splice(Number(btn.getAttribute('data-i')), 1);
      if (!top.draft.steps.length) top.draft.steps.push({ t: '', label: '' });
      renderModals();
      return;

    case 'style-step-move':
      top.capture();
      var mFrom = Number(btn.getAttribute('data-i'));
      var mTo = mFrom + Number(btn.getAttribute('data-dir'));
      var mArr = top.draft.steps;
      if (mTo < 0 || mTo >= mArr.length) return;
      var moved = mArr[mFrom];
      mArr[mFrom] = mArr[mTo];
      mArr[mTo] = moved;
      renderModals();
      return;

    case 'rank-tab':
      ev.preventDefault();
      var rkFrom = lensPos(document.querySelector('.rk-tabs'));
      rankTab = btn.getAttribute('data-tab') || 'coffee';
      renderRanking(true);
      tabsLens(document.querySelector('.rk-tabs'), rkFrom);
      return;

    case 'rate-recipe':
      ev.preventDefault();
      var rr = recipeById(id);
      if (rr) {
        // Tapping the score you already have clears it, so a mis-tap is
        // undoable with the same control that made it.
        var want = Number(btn.getAttribute('data-v')) || 0;
        rr.rating = rr.rating === want ? 0 : want;
        save();
        render();
        timerRatePaint();
      }
      return;

    case 'rate':
      top.capture();
      var v = Number(btn.getAttribute('data-v'));
      top.draft.rating = top.draft.rating === v ? 0 : v;
      renderModals();
      return;

    // A crumb pointing back at the app leaves every open page, so it has to
    // clear the stack one at a time — each page may guard its own close, and
    // a form with unsaved work still gets to ask.
    case 'crumb-home':
      ev.preventDefault();
      var goTo = btn.getAttribute('data-hash') || '#/';
      while (stack.length) {
        var before = stack.length;
        closeModal();
        if (stack.length === before) return;   // a page refused to close
      }
      if (location.hash !== goTo) location.hash = goTo;
      else render();
      return;

    case 'crumb-back':
      ev.preventDefault();
      var toDepth = parseInt(btn.getAttribute('data-depth'), 10);
      while (stack.length - 1 > toDepth) {
        var was = stack.length;
        closeModal();
        if (stack.length === was) return;
      }
      return;

    case 'save-recipe': saveRecipe(top); return;
    case 'save-entity': saveEntity(top); return;

    // Capture first: the scan and its review both re-render the form, and
    // anything already typed has to survive that round trip.
    case 'scan-label':
      if (top && top.capture) top.capture();
      startLabelScan(top);
      return;
    case 'apply-scan':
      if (top && top.applyScan) top.applyScan();
      return;

    case 'quick-add':
      openEntityForm(type, null, function (newId) {
        var parent = stack[stack.length - 1];
        if (parent && parent.draft) parent.draft[ENTITIES[type].ref] = newId;
      }, null);
      return;

    case 'lib-tab':
      var libFrom = lensPos(document.getElementById('libTabs'));
      libraryTab = type; paintLibraryTab();
      tabsLens(document.getElementById('libTabs'), libFrom);
      return;
    case 'lib-add': openEntityForm(type, null, null); return;
    case 'lib-edit': openEntityForm(type, findIn(type, id), null); return;
    case 'lib-del': deleteEntity(type, id); return;

    /* --- data --- */
    case 'export': exportData(); return;
    case 'import': document.getElementById('importFile').click(); return;
    case 'reset': resetAll(); return;

    case 'back-to-top':
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
  }
});

document.addEventListener('input', function (ev) {
  if (ev.target.id === 'libQ') {
    libraryQuery = ev.target.value;
    paintLibraryList();
    return;
  }
  if (ev.target.id === 'q') {
    filters.q = ev.target.value;
    var pos = ev.target.selectionStart;
    renderHome();
    var again = document.getElementById('q');
    if (again) { again.focus(); again.setSelectionRange(pos, pos); }
    return;
  }
  if (ev.target.id && ev.target.id.indexOf('f-combo-') === 0) {
    // Typing filters the option list live, same as the search field —
    // the value itself only ever gets set by picking an option.
    openCombo = ev.target.id.slice('f-combo-'.length);
    comboQuery = ev.target.value;
    var mpos = ev.target.selectionStart;
    renderHome();
    var mAgain = document.getElementById('f-combo-' + openCombo);
    if (mAgain) { mAgain.focus(); mAgain.setSelectionRange(mpos, mpos); }
  }
});

// Focusing a field opens its list — starting from a blank query, same as
// Cupform's Combobox, so the full option set is there to browse.
document.addEventListener('focusin', function (ev) {
  if (!ev.target.id || ev.target.id.indexOf('f-combo-') !== 0) return;
  var type = ev.target.id.slice('f-combo-'.length);
  if (openCombo === type) return;
  openCombo = type;
  comboQuery = '';
  renderHome();
  var mf = document.getElementById('f-combo-' + type);
  if (mf) mf.focus();
});

// Clicking anywhere outside the open combobox closes it, same as the
// account and detail overflow menus.
document.addEventListener('click', function (ev) {
  if (!openCombo) return;
  if (ev.target.closest('.combo')) return;
  openCombo = null;
  comboQuery = '';
  renderHome();
});

document.addEventListener('change', function (ev) {
  var f = ev.target.getAttribute && ev.target.getAttribute('data-filter');
  if (!f) return;
  if (f === 'sort') filterTarget.sort = ev.target.value;
  else filterTarget[f] = ev.target.value;
  repaintFilters();
});

document.addEventListener('keydown', function (ev) {
  if (ev.key === 'Escape' && openCombo) {
    openCombo = null;
    comboQuery = '';
    renderHome();
    return;
  }
  if (ev.key === 'Escape' && stack.length) { closeModal(); return; }
  if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey) && stack.length) {
    var top = stack[stack.length - 1];
    if (top.draft && top.type) saveEntity(top);
    else if (top.draft) saveRecipe(top);
  }
});

document.getElementById('importFile').addEventListener('change', function (ev) {
  if (ev.target.files && ev.target.files[0]) importData(ev.target.files[0]);
  ev.target.value = '';
});

window.addEventListener('hashchange', render);

// Floating back-to-top button — appears once you've scrolled past roughly
// one screen's worth of content.
(function () {
  var btn = document.getElementById('backToTop');
  if (!btn) return;
  var visible = false;
  function sync() {
    var shouldShow = window.scrollY > window.innerHeight * 0.6;
    if (shouldShow === visible) return;
    visible = shouldShow;
    btn.classList.toggle('show', shouldShow);
  }
  window.addEventListener('scroll', sync, { passive: true });
  sync();
})();

/* ---------------------------------------------------------
   14. Boot — wait for Firebase auth before showing anything.
   --------------------------------------------------------- */

// Local design/layout preview, no Google sign-in, no Firestore involved.
// Gated on BOTH conditions so it can never fire on the deployed site even
// if someone appends ?preview there: must be localhost/127.0.0.1 AND the
// query flag must be present. Edits work (favouriting, adding recipes,
// etc.) but save() no-ops since currentUser stays null — nothing persists,
// a reload always comes back to the clean starter library.
// Private addresses count as local too, so the app can be opened on a
// phone over the Wi-Fi it shares with the machine serving it — a camera
// feature proves very little tested on a desktop browser. Still gated on
// ?preview as well as the address, and no public host matches either
// half: the live site is a github.io name, never a private IP.
function isLocalPreview() {
  var host = location.hostname;
  // .local is reserved for mDNS and can't be registered publicly, so
  // matching its suffix is safe.
  var local = host === 'localhost' || host === '' || /\.local$/i.test(host);
  if (!local) {
    // Must be a complete IPv4 literal. Anchoring only the prefix would let
    // an ordinary registrable name — "10.evil.com", "192.168.1.19.evil.com"
    // — pose as a LAN address and open preview mode on a public site.
    var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (m) {
      var a = +m[1], b = +m[2];
      local = a === 127 ||                          // loopback
        a === 10 ||                                 // 10.0.0.0/8
        (a === 192 && b === 168) ||                 // 192.168.0.0/16
        (a === 172 && b >= 16 && b <= 31) ||        // 172.16.0.0/12
        (a === 169 && b === 254);                   // link-local
    }
  }
  return local && new URLSearchParams(location.search).has('preview');
}

/* Publishes --kb (pixels hidden behind the keyboard) and --vv-top (how far
   the browser scrolled the visual viewport) so sheets can sit above the
   keyboard. iOS doesn't shrink the layout viewport for a keyboard — vh and
   dvh both stay at full height and the keyboard is simply drawn over the
   page — so a sheet measured in dvh buries its Save button underneath it.

   These are published as padding on the overlay rather than as its height:
   the scrim has to keep covering the whole viewport, including the strip
   behind the keyboard, or dismissing the keyboard reveals an unpainted gap.
   No-ops without the API, where both fall back to 0 and nothing changes. */
function trackVisualViewport() {
  var vv = window.visualViewport;
  if (!vv) return;
  var root = document.documentElement;
  var apply = function () {
    // How much of the layout viewport something (almost always the keyboard)
    // is covering at the bottom. 0 with no keyboard up.
    var covered = window.innerHeight - vv.height - vv.offsetTop;
    root.style.setProperty('--kb', Math.max(0, Math.round(covered)) + 'px');
    root.style.setProperty('--vv-top', Math.round(vv.offsetTop) + 'px');
  };
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  apply();
}

function boot() {
  if (isLocalPreview()) {
    state = normalizeLibrary(seed());
    authPhase = 'ready';
    render();
    return;
  }

  if (!window.Brew) {
    authPhase = 'error';
    render();
    return;
  }

  window.Brew.onAuthChange(function (user) {
    if (unsubscribeLibrary) { unsubscribeLibrary(); unsubscribeLibrary = null; }

    if (!user) {
      currentUser = null;
      state = null;
      authPhase = 'signedOut';
      render();
      return;
    }

    currentUser = user;
    authPhase = 'ready';
    window.Brew.loadLibrary(user.uid).then(function (data) {
      var needsSeed = !data || (data.pristine && data.seedVersion !== SEED_VERSION);
      var ready = needsSeed ? initialLibraryFor(user) : Promise.resolve(data);
      return ready.then(function (lib) {
        state = normalizeLibrary(lib);
        if (needsSeed) window.Brew.saveLibrary(user.uid, state);
        else if (libraryMigrated) save({ keepPristine: true });
        render();
      });
    }).then(function () {
      // Live sync: any change (from this device or another) re-renders.
      unsubscribeLibrary = window.Brew.subscribeLibrary(user.uid, function (remote) {
        state = normalizeLibrary(remote);
        render();
      });
    });
  });
}

/* Coming back to a hidden page: restart the paint loop rAF abandoned, and
   resync immediately rather than waiting up to a quarter second, so the
   clock is already correct by the time it is looked at. */
document.addEventListener('visibilitychange', function () {
  if (document.hidden || !timer || !timer.running) return;
  timerTick();
  cancelAnimationFrame(timer.raf);
  timer.raf = requestAnimationFrame(timerFrame);
});

document.documentElement.setAttribute('lang', LANG);
translateMarkup();
trackVisualViewport();
boot();

// The carousel's dots follow whichever slide is nearest the left edge.
document.addEventListener('scroll', function (ev) {
  var c = ev.target;
  if (!c || c.id !== 'homeCarousel') return;
  var slide = c.querySelector('.slide');
  if (!slide) return;
  var i = Math.round(c.scrollLeft / (slide.offsetWidth + 12));
  var dots = document.querySelectorAll('.carousel-dots .dot');
  for (var k = 0; k < dots.length; k++) dots[k].classList.toggle('on', k === i);
}, true);

// The bar changes height on rotation and disappears entirely when the
// layout crosses into the sidebar breakpoint.
window.addEventListener('resize', measureNav);
window.addEventListener('orientationchange', measureNav);

})();
