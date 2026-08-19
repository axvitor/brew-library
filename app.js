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
      toast('Could not sync — check your connection.');
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
    { id: 'st-hoffmann', name: 'James Hoffmann', author: 'James Hoffmann',
      notes: 'Ultimate V60 technique — bloom, two pours, swirl, even drawdown.' },
    { id: 'st-tetsu-sweet', name: 'Tetsu Kasuya — Sweet', author: 'Tetsu Kasuya',
      notes: '4:6 method. A smaller first pour pushes the cup toward sweetness.' },
    { id: 'st-tetsu-acid', name: 'Tetsu Kasuya — Acid', author: 'Tetsu Kasuya',
      notes: '4:6 method. A larger first pour brings out acidity and brightness.' },
    { id: 'st-tetsu-strength', name: 'Tetsu Kasuya — Strength', author: 'Tetsu Kasuya',
      notes: '4:6 method. Balanced first 40%, then the remaining 60% split into three pours for a stronger cup.' },
    { id: 'st-espresso', name: 'Espresso', author: '',
      notes: 'A pressure shot rather than a pour: dial in with dose, grind and shot time instead of a pour schedule.' },
    // The one seeded style with written steps rather than a built-in formula,
    // which is exactly what makes it editable: hasFormula() is false for it,
    // so it opens in the step builder like any style you'd write yourself.
    // Figures are his published Ultimate Pour Over at a 20 g dose — the pours
    // are cumulative totals, not per-pour amounts.
    { id: 'st-hedrick', name: 'Lance Hedrick — Ultimate', author: 'Lance Hedrick',
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
var BUILTIN_STYLES_VERSION = 1;

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
  addRecipe({ c: "cof-moka-bela-epoca", m: "me-aeropress", g: "gr-timemore-c2", gr: "21 clicks", s: "st-hoffmann", dose: '', temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-familia-protazio", m: "me-esp-3bomber", g: "gr-kingrinder", gr: "1 turn + 4 clicks", s: "st-espresso", dose: 18, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-familia-protazio", m: "me-v60", g: "gr-kingrinder", gr: "3 turns + 39 clicks", s: "st-hoffmann", dose: 15, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-familia-protazio", m: "me-origami", g: "gr-kingrinder", gr: "1 turn + 49 clicks", s: "st-hoffmann", dose: 15, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-familia-protazio", m: "me-aeropress", g: "gr-kingrinder", gr: "1 turn + 49 clicks", s: "st-hoffmann", dose: 15, temp: '', time: "2:30", notes: "Press for one more minute after 2:30." });
  addRecipe({ c: "cof-moka-tropical", m: "me-aeropress", g: "gr-kingrinder", gr: "1 turn + 40 clicks", s: "st-hoffmann", dose: '', temp: '', time: "", notes: "" });
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
  addRecipe({ c: "cof-moka-santa-luzia", m: "me-aeropress", g: "gr-timemore-c2", gr: "22 clicks", s: "st-hoffmann", dose: '', temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-flor-de-cacau", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 15 clicks", s: "st-hoffmann", dose: '', temp: '', time: "3:20", notes: "" });
  addRecipe({ c: "cof-moka-salada-de-frutas", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 30 clicks", s: "st-tetsu-sweet", dose: '', temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-salada-de-frutas", m: "me-filtro-oster", g: "gr-kingrinder", gr: "1 turn", s: "st-hoffmann", dose: 18, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-serra-da-canastra", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 50 clicks", s: "st-tetsu-sweet", dose: 20, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-cafe-das-pedras", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 35 clicks", s: "st-tetsu-sweet", dose: 20, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-coopiata-bahia", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 40 clicks", s: "st-tetsu-sweet", dose: 18, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-coopiata-bahia", m: "me-b75", g: "gr-kingrinder", gr: "2 turns + 20 clicks", s: "st-hoffmann", dose: 15, temp: '', time: "2:30", notes: "" });
  addRecipe({ c: "cof-moka-boa-vista-pinhal", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 55 clicks", s: "st-tetsu-sweet", dose: 18, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-boa-vista-pinhal", m: "me-aeropress", g: "gr-kingrinder", gr: "2 turns + 50 clicks", s: "st-hoffmann", dose: 12, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-boa-vista-pinhal", m: "me-esp-3bomber", g: "gr-kingrinder", gr: "1 turn + 1 click", s: "st-espresso", dose: 18, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-olhos-dagua", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 33 clicks", s: "st-tetsu-sweet", dose: 18, temp: '', time: "", notes: "" });
  addRecipe({ c: "cof-moka-olhos-dagua", m: "me-aeropress", g: "gr-kingrinder", gr: "2 turns + 40 clicks", s: "st-hoffmann", dose: 12, temp: '', time: "", notes: "" });
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
  addRecipe({ c: "cof-moka-sitio-palmito", m: "me-aeropress", g: "gr-kingrinder", gr: "1 turn + 45 clicks", s: "st-hoffmann", dose: 12, temp: 98, time: "3:00", notes: "Finish the brew by 3:00." });
  addRecipe({ c: "cof-five-nosso-talhao", m: "me-origami", g: "gr-kingrinder", gr: "1 turn + 37 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "3:15", notes: "" });
  addRecipe({ c: "cof-lucca-honey-coffee-moka", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 25 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "3:10", notes: "" });
  addRecipe({ c: "cof-lucca-fazenda-samambaia", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 40 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "3:15", notes: "" });
  addRecipe({ c: "cof-five-vista-do-brigadeiro", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 40 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "3:25", notes: "" });
  addRecipe({ c: "cof-lucca-forquilha-florada-setembro", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 25 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "3:00", notes: "" });
  addRecipe({ c: "cof-lucca-fazenda-cariama", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 20 clicks", s: "st-hoffmann", dose: 15, temp: 96, time: "3:10", notes: "" });
  addRecipe({ c: "cof-arbor-10-anos", m: "me-origami", g: "gr-kingrinder", gr: "1 turn + 55 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "2:45", notes: "" });
  addRecipe({ c: "cof-leve-cafeina", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 15 clicks", s: "st-hoffmann", dose: 15, temp: 96, time: "3:10", notes: "" });
  addRecipe({ c: "cof-sabino-nivaldo-rocha", m: "me-origami", g: "gr-kingrinder", gr: "2 turns + 25 clicks", s: "st-hoffmann", dose: 15, temp: 94, time: "3:00", notes: "" });
  addRecipe({ c: "cof-sabino-nivaldo-rocha", m: "me-aeropress", g: "gr-kingrinder", gr: "2 turns + 15 clicks", s: "st-hoffmann", dose: 15, temp: 96, time: "", notes: "Swirl at 1:45; press between 2:00 and 2:30–2:45." });
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
    meta: function (e) { return [e.kind, e.unit ? 'in ' + e.unit : ''].filter(Boolean).join(' · '); }
  },
  method: {
    coll: 'methods', label: 'Brewing method', plural: 'Methods', ref: 'methodId',
    fields: [
      { k: 'name', l: 'Name', ph: 'Chemex', req: true },
      { k: 'kind', l: 'Type', ph: 'Pour over / Immersion / Pressure' },
      { k: 'ratio', l: 'Typical ratio', ph: '1:16' },
      { k: 'notes', l: 'Notes', ph: 'Filter, kettle, gear…', area: true }
    ],
    meta: function (e) { return [e.kind, e.ratio].filter(Boolean).join(' · '); }
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

  if (styleId === 'st-hoffmann') {
    // James Hoffmann's "Ultimate AeroPress" technique.
    if (m.indexOf('aeropress') > -1) {
      return [
        { t: '0:00', label: 'Add the coffee, then pour all the water in one go.', water: g(water) },
        { t: '0:15', label: 'Insert the plunger just enough to seal, then leave it alone.', water: 0 },
        { t: '2:00', label: 'Remove the plunger and swirl gently to settle the bed.', water: 0 },
        { t: '2:30', label: 'Press slowly and evenly — about 30 seconds.', water: 0 }
      ];
    }
    if (m.indexOf('espresso') > -1 || m.indexOf('moka') > -1) return [];
    // James Hoffmann's V60: five equal pours (each a fifth of the total
    // water) at 0:00, 0:45, 1:10, 1:30 and 1:50, then let it draw down —
    // no stirring needed.
    var fifth = g(water / 5);
    return [
      { t: '0:00', label: 'Bloom — pour the first fifth of the water.', water: fifth },
      { t: '0:45', label: 'Pour the second fifth.', water: fifth },
      { t: '1:10', label: 'Pour the third fifth.', water: fifth },
      { t: '1:30', label: 'Pour the fourth fifth.', water: fifth },
      { t: '1:50', label: 'Pour the final fifth, then let it draw down — no stirring needed.', water: g(water) - fifth * 4 }
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
  trash: '<svg viewBox="0 0 24 24" class="ico"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" class="ico"><path d="M12 5v14M5 12h14"/></svg>',
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

var filters = { q: '', coffee: '', roaster: '', grinder: '', method: '', style: '', fav: false, sort: 'new' };

// Mobile only: whether the coffee/roaster/grinder/method/style/sort group
// is expanded under "More filters". A module-level flag rather than
// something read off the DOM, since renderHome() rebuilds the filter bar
// on every keystroke and every filter change — it has to survive that.
var filtersExpanded = false;

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

function visibleRecipes() {
  var q = filters.q.trim().toLowerCase();
  var out = state.recipes.filter(function (r) {
    if (filters.coffee && r.coffeeId !== filters.coffee) return false;
    if (filters.roaster && roasterIdOf(r) !== filters.roaster) return false;
    if (filters.grinder && r.grinderId !== filters.grinder) return false;
    if (filters.method && r.methodId !== filters.method) return false;
    if (filters.style && r.styleId !== filters.style) return false;
    if (filters.fav && !r.fav) return false;
    if (q) {
      var hay = [titleOf(r), nameOf('coffee', r.coffeeId), roasterOf(r), nameOf('grinder', r.grinderId),
        nameOf('method', r.methodId), nameOf('style', r.styleId), r.notes, r.grindSize]
        .join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });

  out.sort(function (a, b) {
    if (filters.sort === 'old') return a.createdAt - b.createdAt;
    if (filters.sort === 'rating') return (b.rating || 0) - (a.rating || 0) || b.createdAt - a.createdAt;
    if (filters.sort === 'coffee') return titleOf(a).localeCompare(titleOf(b));
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

// The avatar chip and the "Signed in as…" line inside the ⋮ menu both
// just reflect currentUser — Sign out itself now lives as a menu item
// (see index.html), so the topbar doesn't need a dedicated button for it.
function updateAccountChip() {
  var chip = document.getElementById('accountChip');
  var actions = document.getElementById('appActions');
  var menuAccount = document.getElementById('menuAccount');
  if (!chip) return;

  if (currentUser) {
    chip.hidden = false;
    var avatar = document.getElementById('accountAvatar');
    if (avatar) {
      avatar.src = currentUser.photoURL || '';
      avatar.style.visibility = currentUser.photoURL ? 'visible' : 'hidden';
    }
    if (menuAccount) {
      menuAccount.hidden = false;
      var emailEl = document.getElementById('menuAccountEmail');
      if (emailEl) emailEl.textContent = currentUser.email || '';
    }
  } else {
    chip.hidden = true;
    if (menuAccount) menuAccount.hidden = true;
  }
  if (actions) actions.hidden = authPhase !== 'ready';
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
  renderGate('Brew Library', 'Loading your library…', '');
}

function renderSignIn() {
  renderGate('Brew Library', 'Sign in to see your recipes — synced across every device.',
    '<button class="btn btn-google" data-action="sign-in">' + GOOGLE_G_ICON + '<span>Continue with Google</span></button>');
}

function renderFirebaseError() {
  renderGate('Can’t connect', 'The sync service didn’t load — check your connection and reload the page.', '');
}

function render() {
  updateAccountChip();

  if (authPhase === 'loading') { renderLoading(); return; }
  if (authPhase === 'signedOut') { renderSignIn(); return; }
  if (authPhase === 'error') { renderFirebaseError(); return; }

  var hash = location.hash || '#/';
  var m = hash.match(/^#\/r\/(.+)$/);
  if (m) renderDetail(decodeURIComponent(m[1]));
  else renderHome();
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
  return 'All ' + (type === 'roaster' ? 'roasters' : ENTITIES[type].plural.toLowerCase());
}
function comboMatch(type, r, id) {
  return type === 'roaster' ? roasterIdOf(r) === id : r[ENTITIES[type].ref] === id;
}
function comboOptions(type) {
  var list = coll(type).slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
  var out = [{ id: '', name: comboLabel(type), count: state.recipes.length }];
  list.forEach(function (e) {
    var n = state.recipes.filter(function (r) { return comboMatch(type, r, e.id); }).length;
    if (n) out.push({ id: e.id, name: e.name, count: n });
  });
  return out;
}

function comboListHTML(type) {
  var term = comboQuery.trim().toLowerCase();
  var opts = comboOptions(type);
  var shown = term ? opts.filter(function (o) { return o.name.toLowerCase().indexOf(term) !== -1; }) : opts;
  var html = '<div class="combo-list" role="listbox" aria-label="' + esc(ENTITIES[type].label) + '">';
  if (!shown.length) {
    html += '<div class="combo-empty">Nothing matches “' + esc(comboQuery.trim()) + '”</div>';
  } else {
    shown.forEach(function (o) {
      var on = (filters[type] || '') === o.id;
      html += '<div class="combo-opt' + (on ? ' on' : '') + '" role="option" aria-selected="' + on +
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
  var current = filters[type] ? findIn(type, filters[type]) : null;
  var shown = isOpen ? comboQuery : (current ? current.name : '');
  return '<div class="combo' + (filters[type] ? ' on' : '') + '">' +
    '<div class="combo-field' + (isOpen ? ' open' : '') + '">' +
      ICON[COMBO_ICON[type]] +
      '<input id="f-combo-' + type + '" class="combo-input" role="combobox" aria-haspopup="listbox" ' +
        'aria-expanded="' + isOpen + '" aria-label="Filter by ' + esc(ENTITIES[type].label) + '" autocomplete="off" ' +
        'placeholder="' + esc(comboLabel(type)) + '" value="' + esc(shown) + '" />' +
      (isOpen && comboQuery ? '<button class="combo-clear" data-action="combo-clear" aria-label="Clear search">' +
        ICON.close + '</button>' : '') +
      '<button class="combo-toggle" data-action="combo-toggle" data-type="' + type + '" aria-label="Show all ' +
        esc(ENTITIES[type].plural.toLowerCase()) + '">' + ICON.chevDown + '</button>' +
    '</div>' +
    (isOpen ? comboListHTML(type) : '') +
  '</div>';
}

function renderHome() {
  var list = visibleRecipes();
  var total = state.recipes.length;

  var html = '';
  html += '<section class="hero">' +
    '<h1>Your brewing library</h1>' +
    '<p><span class="count">' + total + '</span> ' + (total === 1 ? 'recipe' : 'recipes') +
    ' across ' + state.coffees.length + ' ' + (state.coffees.length === 1 ? 'coffee' : 'coffees') +
    '. Filter to find the one you want, then brew it.</p>' +
    '</section>';

  var moreCount = moreFiltersCount();
  html += '<div class="filters' + (filtersExpanded ? ' expanded' : '') + '">' +
    '<div class="search">' + ICON.search +
      '<input id="q" type="search" placeholder="Search recipes…" value="' + esc(filters.q) + '" />' +
    '</div>' +
    '<button class="pill-toggle' + (filters.fav ? ' on' : '') + '" data-action="toggle-fav-filter">' +
      ICON.star + 'Favourites</button>' +
    // Mobile only (see CSS) — everything below folds under this toggle so
    // the bar collapses to just Search, Favourites and the toggle.
    '<button class="pill-toggle filters-toggle' + (moreCount ? ' on' : '') + '" data-action="toggle-more-filters" ' +
      'aria-expanded="' + filtersExpanded + '">' + ICON.sliders + 'More filters' +
      (moreCount ? '<span class="filter-count">' + moreCount + '</span>' : '') +
    '</button>' +
    '<div class="filters-more">' +
      comboHTML('coffee') +
      comboHTML('roaster') +
      comboHTML('grinder') +
      comboHTML('method') +
      comboHTML('style') +
      '<div class="sel"><select id="f-sort" data-filter="sort" aria-label="Sort recipes">' +
        '<option value="new"' + (filters.sort === 'new' ? ' selected' : '') + '>Newest first</option>' +
        '<option value="old"' + (filters.sort === 'old' ? ' selected' : '') + '>Oldest first</option>' +
        '<option value="rating"' + (filters.sort === 'rating' ? ' selected' : '') + '>Top rated</option>' +
        '<option value="coffee"' + (filters.sort === 'coffee' ? ' selected' : '') + '>A–Z</option>' +
      '</select></div>' +
      (filtersActive() ? '<button class="btn btn-quiet btn-sm" data-action="clear-filters">Clear</button>' : '') +
    '</div>' +
    '</div>';

  if (!list.length) {
    html += '<div class="empty">' + ICON.bean +
      '<h3>' + (total ? 'Nothing matches those filters' : 'No recipes yet') + '</h3>' +
      '<p>' + (total
        ? 'Try clearing a filter or two to see the rest of your library.'
        : 'Add your first brew — coffee, grinder, method, recipe style and the pour schedule.') + '</p>' +
      (total
        ? '<button class="btn btn-ghost" data-action="clear-filters">Clear filters</button>'
        : '<button class="btn btn-primary" data-action="new-recipe">' + ICON.plus + 'Add recipe</button>') +
      '</div>';
  } else {
    html += '<div class="grid">' + list.map(cardHTML).join('') + '</div>';
  }

  view.innerHTML = html;
}

function cardHTML(r) {
  var bits = [];
  var grinder = findIn('grinder', r.grinderId);
  if (grinder) bits.push('<span class="tag">' + esc(grinder.name) + (r.grindSize ? ' · ' + esc(r.grindSize) : '') + '</span>');
  else if (r.grindSize) bits.push('<span class="tag">' + esc(r.grindSize) + '</span>');
  if (r.temp) bits.push('<span class="tag">' + esc(String(r.temp)) + '°C</span>');
  if (r.brewTime) bits.push('<span class="tag">' + esc(r.brewTime) + '</span>');

  var roaster = roasterOf(r);

  // The play/favourite buttons used to live inside this card's <a> — invalid
  // HTML (interactive content nested in interactive content), and browsers
  // resolve the ambiguity inconsistently: on real touch input the first tap
  // can land on the outer link instead of the button, so it took two taps
  // to actually fire. Fixed with the "stretched link" pattern instead: the
  // <a> is an invisible full-card hit target with no descendants, painted
  // *behind* the visible content; the content passes clicks through to it
  // (pointer-events:none) except for the two real buttons, which sit on
  // top and get their own taps directly, as true siblings of the link
  // rather than children of it.
  return '<div class="card">' +
    '<a class="card-link" href="#/r/' + encodeURIComponent(r.id) + '" aria-label="Open ' + esc(titleOf(r)) + '"></a>' +
    '<div class="card-content">' +
    '<div class="card-head">' +
      '<div class="card-head-info">' +
        // v3 leads the card with the method as a printed tag, then the
        // name in the display serif, then the roaster.
        '<div class="tags card-kind">' +
          '<span class="tag tag-accent">' + esc(nameOf('method', r.methodId)) + '</span>' +
          '<span class="tag">' + esc(nameOf('style', r.styleId)) + '</span>' +
        '</div>' +
        '<div class="card-title">' + esc(titleOf(r)) + '</div>' +
        (roaster ? '<div class="card-sub"><span>' + esc(roaster) + '</span></div>' : '') +
      '</div>' +
      '<div class="card-tools">' +
        // Only offered when there's actually something to count — a recipe
        // with neither a brew time nor a schedule has no ring to draw.
        (timerPlan(r)
          ? '<button class="cardbtn" data-action="timer" data-id="' + esc(r.id) + '" ' +
            'title="Start brew timer" aria-label="Start brew timer">' + ICON.play + '</button>'
          : '') +
        '<button class="fav' + (r.fav ? ' on' : '') + '" data-action="fav" data-id="' + esc(r.id) + '" aria-label="Toggle favourite">' +
          iconStar(r.fav) + '</button>' +
      '</div>' +
    '</div>' +
    (bits.length ? '<div class="tags">' + bits.join('') + '</div>' : '') +
    '<div class="card-foot">' +
      '<div class="stats">' +
        '<div class="stat"><span class="k">Dose</span><span class="v">' + num(r.dose, ' g') + '</span></div>' +
        '<div class="stat"><span class="k">Water</span><span class="v">' + num(r.water, ' g') + '</span></div>' +
        '<div class="stat"><span class="k">Ratio</span><span class="v">' + ratio(r.dose, r.water) + '</span></div>' +
      '</div>' +
      (r.rating ? stars(r.rating) : '') +
    '</div>' +
    '</div>' +
    '</div>';
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
      '<div class="body"><p>' + esc(s.label || '') + '</p>' +
        (w ? '<div class="w">+' + w + ' g&nbsp; · &nbsp;' + running + ' g total</div>' : '') +
      '</div></li>';
  }).join('');
}

// Explains why a formula-owned style is showing no pour schedule. Takes either
// a saved recipe or a form draft — both carry styleId/methodId.
function noStepsMessage(r) {
  if (r.styleId === 'st-espresso') {
    return 'Espresso is dialled in by dose, grind and shot time rather than a pour schedule — the numbers above are the recipe.';
  }
  var me = findIn('method', r.methodId);
  return (me ? me.name : 'This method') + ' doesn’t use a pour schedule — nothing to show here.';
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

function renderDetail(id) {
  var r = recipeById(id);
  if (!r) {
    view.innerHTML = '<div class="detail"><a class="back" href="#/">' + ICON.back + 'Library</a>' +
      '<div class="empty">' + ICON.bean + '<h3>Recipe not found</h3><p>It may have been deleted.</p></div></div>';
    return;
  }

  var c = findIn('coffee', r.coffeeId);
  var st = findIn('style', r.styleId);
  var gr = findIn('grinder', r.grinderId);
  var me = findIn('method', r.methodId);

  var styleDriven = hasFormula(r.styleId);
  var steps = effectiveSteps(r);
  var stepsHTML = timelineHTML(steps);

  var specs = '';
  function spec(k, v) { if (v) specs += '<div class="spec"><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>'; }
  spec('Coffee', c ? c.name : '—');
  if (c) {
    var ro = c.roasterId ? findIn('roaster', c.roasterId) : null;
    spec('Roaster', roasterNameOf(c));
    if (ro && ro.location) spec('Roastery', ro.location);
    spec('Origin', c.origin); spec('Altitude', c.altitude);
    spec('Process', c.process); spec('Roast', c.roast); spec('Varietal', c.varietal);
  }
  spec('Grinder', gr ? gr.name : '—');
  spec('Grind size', r.grindSize);
  spec('Method', me ? me.name : '—');
  spec('Recipe style', st ? st.name : '—');
  if (st && st.author) spec('Devised by', st.author);

  var html = '<div class="detail">' +
    '<a class="back" href="#/">' + ICON.back + 'Library</a>' +

    '<div class="detail-head">' +
      '<div class="detail-head-info">' +
        '<div class="kicker">' + esc(nameOf('method', r.methodId)) + ' · ' + esc(nameOf('style', r.styleId)) + '</div>' +
        '<div class="title-row">' +
          '<h1>' + esc(titleOf(r)) + '</h1>' +
          // Mobile-only: favourite as a plain star inline with the name,
          // at the far end of the row (same icon-only treatment as the
          // grid cards). Hidden on desktop, where the labelled button
          // below already covers it.
          '<button class="fav fav-inline' + (r.fav ? ' on' : '') + '" data-action="fav" data-id="' + esc(r.id) + '" aria-label="Toggle favourite">' + iconStar(r.fav) + '</button>' +
        '</div>' +
        '<div class="card-sub" style="margin-top:10px">' +
          (r.rating ? stars(r.rating) + '<span class="dot"></span>' : '') +
          '<span>' + ratio(r.dose, r.water) + ' ratio</span>' +
          (c && c.origin ? '<span class="dot"></span><span>' + esc(c.origin) + '</span>' : '') +
        '</div>' +
      '</div>' +
      // Brewing is what this page is for, so Start timer is the one filled
      // button and wears the same roast the timer's own control does — the
      // brew action looks identical everywhere it appears. Edit drops to a
      // ghost, and the two destructive-adjacent verbs move into an overflow
      // so four admin controls stop outranking the reason you opened this.
      '<div class="detail-actions">' +
        (timerPlan(r)
          ? '<button class="btn btn-accent btn-sm action-timer" data-action="timer" data-id="' + esc(r.id) + '">' +
            ICON.play + '<span>Start timer</span></button>'
          : '') +
        '<button class="btn btn-ghost btn-sm fav-desktop" data-action="fav" data-id="' + esc(r.id) + '">' +
          ICON.star + '<span>' + (r.fav ? 'Favourited' : 'Favourite') + '</span></button>' +
        '<button class="btn btn-ghost btn-sm action-edit" data-action="edit" data-id="' + esc(r.id) + '">' + ICON.edit + '<span>Edit</span></button>' +
        '<div class="menu-holder detail-more">' +
          '<button class="btn btn-ghost btn-sm btn-icon" data-action="toggle-detail-menu" ' +
            'aria-haspopup="true" aria-expanded="false" aria-label="More actions">' + ICON.more + '</button>' +
          '<div class="menu" id="detailMenu" hidden>' +
            '<button data-action="duplicate" data-id="' + esc(r.id) + '">Duplicate</button>' +
            '<div class="menu-sep"></div>' +
            '<button class="danger" data-action="delete" data-id="' + esc(r.id) + '">Delete recipe…</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div style="padding-top:28px"></div>' +
    '<div class="bigstats">' +
      '<div class="bigstat"><div class="k">Dose</div><div class="v">' + num(r.dose) + '<small>g</small></div></div>' +
      '<div class="bigstat"><div class="k">Water</div><div class="v">' + num(r.water) + '<small>g</small></div></div>' +
      '<div class="bigstat"><div class="k">Ratio</div><div class="v">' + ratio(r.dose, r.water) + '</div></div>' +
      '<div class="bigstat"><div class="k">Temperature</div><div class="v">' + num(r.temp) + '<small>°C</small></div></div>' +
      '<div class="bigstat"><div class="k">Brew time</div><div class="v">' + (r.brewTime ? esc(r.brewTime) : '—') + '</div></div>' +
      '<div class="bigstat"><div class="k">Grind</div><div class="v" style="font-size:19px">' + (r.grindSize ? esc(r.grindSize) : '—') + '</div></div>' +
    '</div>' +

    '<div class="detail-body">' +
      '<aside>' +
        '<div class="section-title">Details</div>' +
        '<dl class="specs">' + specs + '</dl>' +
        (c && c.notes ? '<div class="coffee-note">' + esc(c.notes) + '</div>' : '') +
        (st && st.notes ? '<div class="block"><div class="section-title">About this style</div>' +
          '<div class="coffee-note" style="margin-top:0">' + esc(st.notes) + '</div></div>' : '') +
      '</aside>' +
      '<div>' +
        '<div class="section-title">Pouring steps</div>' +
        (steps.length
          ? '<ol class="timeline">' + stepsHTML + '</ol>' +
            (styleDriven ? '<p class="hint" style="margin-top:12px">' + esc(stepsCaption(r)) + '</p>' : '')
          : styleDriven
            ? '<p style="color:var(--text-muted);font:var(--type-body-sm)">' + esc(noStepsMessage(r)) + '</p>'
            : '<p style="color:var(--text-muted);font:var(--type-body-sm)">No steps recorded — ' +
              '<a href="#" data-action="edit" data-id="' + esc(r.id) + '" style="color:var(--text-link)">add them</a>.</p>') +
        (r.notes ? '<div class="block"><div class="section-title">Personal notes</div><div class="notes">' + esc(r.notes) + '</div></div>' : '') +
      '</div>' +
    '</div>' +
  '</div>';

  view.innerHTML = html;
  window.scrollTo(0, 0);
}

/* ---------------------------------------------------------
   7b. Brew timer

   A stopwatch drawn as one closed ring: the whole circle is the
   recipe's brew time, and each pouring step owns the slice of arc
   it stays on screen for — so the plan is readable at a glance
   before the timer even starts, and the sweeping progress arc
   shows how far through the brew you are.
   --------------------------------------------------------- */

var RING_R = 86;
var RING_C = 2 * Math.PI * RING_R;

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
    return { at: secondsOf(s.t), label: s.label || '', water: Number(s.water) || 0 };
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
    segs.push({ start: 0, end: total, label: 'Pull the shot.', water: 0 });
  } else {
    if (steps[0].at > 0) segs.push({ start: 0, end: steps[0].at, label: 'Get set up.', water: 0 });
    steps.forEach(function (s, i) {
      segs.push({
        start: s.at,
        end: i + 1 < steps.length ? steps[i + 1].at : total,
        label: s.label,
        water: s.water
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

function buildTimerEl(r, plan) {
  var segHTML = plan.segs.map(function (s, i) {
    var len = (s.end - s.start) / plan.total * RING_C;
    // Hairline gap between arcs so the steps read as separate slices —
    // dropped on slivers too short to survive it.
    var gap = len > 14 ? 5 : 0;
    return '<circle class="tseg" data-i="' + i + '" cx="100" cy="100" r="' + RING_R + '" ' +
      'stroke-dasharray="' + Math.max(len - gap, 1).toFixed(2) + ' ' + RING_C.toFixed(2) + '" ' +
      'stroke-dashoffset="' + (-(s.start / plan.total * RING_C)).toFixed(2) + '"></circle>';
  }).join('');

  var rowsHTML = plan.segs.map(function (s, i) {
    return '<li class="timer-step" data-i="' + i + '">' +
      '<span class="ts-t">' + esc(mmss(s.start)) + '</span>' +
      '<span class="ts-l">' + esc(s.label) + '</span>' +
      (s.water ? '<span class="ts-w">+' + s.water + ' g</span>' : '<span class="ts-w"></span>') +
    '</li>';
  }).join('');

  var wrap = document.createElement('div');
  // Fullscreen, not a floating dialog — brewing wants undivided attention,
  // not a card sharing space with the library behind it. See .overlay-full.
  wrap.className = 'overlay overlay-full';
  wrap.innerHTML =
    '<div class="sheet narrow sheet-timer" role="dialog" aria-modal="true">' +
      '<div class="sheet-head">' +
        '<div class="timer-head-row">' +
          '<h2>' + esc(titleOf(r)) + '</h2>' +
          '<span class="timer-head-actions">' +
            '<button class="iconbtn timer-mute" data-action="timer-mute"></button>' +
            '<button class="iconbtn" data-action="close-modal" aria-label="Close">' + ICON.close + '</button>' +
          '</span>' +
        '</div>' +
        '<div class="timer-head-row">' +
          '<span class="timer-eyebrow"></span>' +
          '<span class="timer-clock">00:00 / ' + esc(mmss2(plan.total)) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="sheet-body timer-body">' +
        // .timer-hero and .timer-list are display:contents below the
        // desktop breakpoint, so mobile's single vertical flow (ring,
        // readouts, instruction, steps, next-strip) is byte-for-byte
        // unchanged — they only become real grid columns at the width
        // that has room for two. See the min-width:861px block.
        '<div class="timer-hero">' +
          '<div class="timer-ring">' +
            '<svg viewBox="0 0 200 200" aria-hidden="true">' +
              '<g transform="rotate(-90 100 100)">' +
                '<circle class="ttrack" cx="100" cy="100" r="' + RING_R + '"></circle>' +
                segHTML +
                '<circle class="tprog" cx="100" cy="100" r="' + RING_R + '" ' +
                  'stroke-dasharray="0 ' + RING_C.toFixed(2) + '"></circle>' +
              '</g>' +
              '<g class="thead"><circle cx="100" cy="' + (100 - RING_R) + '" r="5.5"></circle></g>' +
            '</svg>' +
            '<div class="timer-face">' +
              '<div class="timer-elapsed" role="timer" aria-live="off">00:00</div>' +
              '<div class="timer-total">of ' + esc(mmss2(plan.total)) + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="timer-readouts">' +
            '<div class="timer-readout">' +
              '<span class="rv timer-left">00:00</span>' +
              '<span class="rk">Left in this step</span>' +
            '</div>' +
            (plan.water
              ? '<div class="timer-readout">' +
                  '<span class="rv timer-poured">0<small>/ ' + plan.water + ' g</small></span>' +
                  '<span class="rk">Water poured</span>' +
                '</div>'
              : '') +
          '</div>' +
          '<div class="timer-now"><span class="timer-now-label"></span></div>' +
        '<p class="sr-only timer-announce" role="status" aria-live="polite"></p>' +
        '</div>' +
        '<div class="timer-list">' +
          '<ol class="timer-steps">' + rowsHTML + '</ol>' +
          '<div class="timer-next">' + ICON.arrowDown +
            '<span class="nx"></span><span class="nt"></span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="sheet-foot timer-foot">' +
        '<button class="btn btn-ghost timer-side" data-action="timer-reset" aria-label="Restart" title="Restart">' + ICON.replay + '</button>' +
        '<button class="btn timer-toggle" data-action="timer-toggle">' + ICON.play + '<span>Start brewing</span></button>' +
        '<button class="btn btn-ghost timer-side" data-action="timer-skip" aria-label="Skip to next step" title="Skip to next step">' + ICON.skip + '</button>' +
      '</div>' +
    '</div>';
  wrap.addEventListener('mousedown', function (ev) { if (ev.target === wrap) closeModal(); });
  return wrap;
}

function openTimer(id) {
  var r = recipeById(id);
  if (!r) return;
  var plan = timerPlan(r);
  if (!plan) { toast('Add a brew time or pouring steps first.'); return; }

  stopTimer();
  timer = {
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
        title: 'Still brewing',
        body: '<p>Your timer is running. Leaving now will stop it and you’ll need to start over.</p>',
        confirmLabel: 'Leave anyway',
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
}

function timerPaint() {
  if (!timer) return;
  var plan = timer.plan, el = timer.el;
  var e = Math.min(Math.max(timer.elapsed, 0), plan.total);
  var frac = e / plan.total;

  el.querySelector('.tprog').setAttribute('stroke-dasharray',
    (frac * RING_C).toFixed(2) + ' ' + RING_C.toFixed(2));
  el.querySelector('.thead').setAttribute('transform',
    'rotate(' + (frac * 360).toFixed(3) + ' 100 100)');
  el.querySelector('.timer-elapsed').textContent = mmss2(e);
  el.querySelector('.timer-clock').textContent = mmss2(e) + ' / ' + mmss2(plan.total);

  var i = 0, k;
  for (k = 0; k < plan.segs.length; k++) if (e >= plan.segs[k].start) i = k;

  // Per-step readouts refresh every frame; the heavier class work below
  // only runs when the step actually changes.
  var seg = plan.segs[i];
  var segLen = seg.end - seg.start;
  el.querySelector('.timer-left').textContent = mmss2(Math.max(0, seg.end - e));
  var poured = el.querySelector('.timer-poured');
  if (poured) {
    var pct = segLen > 0 ? Math.min(1, Math.max(0, (e - seg.start) / segLen)) : 1;
    var g = seg.from + (seg.upto - seg.from) * pct;
    poured.innerHTML = Math.round(g) + '<small>/ ' + plan.water + ' g</small>';
  }

  if (i === timer.seg) return;
  timer.seg = i;

  el.querySelector('.timer-eyebrow').textContent =
    'Step ' + (i + 1) + ' of ' + plan.segs.length;
  var nxt = plan.segs[i + 1];
  el.querySelector('.timer-next .nx').textContent = nxt ? 'Next · ' + nxt.label : 'Last step';
  el.querySelector('.timer-next .nt').textContent = nxt ? mmss2(nxt.start) : '';

  var segs = el.querySelectorAll('.tseg');
  var rows = el.querySelectorAll('.timer-step');
  for (k = 0; k < segs.length; k++) {
    segs[k].classList.toggle('is-now', k === i);
    segs[k].classList.toggle('is-past', k < i);
    rows[k].classList.toggle('is-now', k === i);
    rows[k].classList.toggle('is-past', k < i);
  }
  el.querySelector('.timer-now-label').textContent = plan.segs[i].label;
  var say = el.querySelector('.timer-announce');
  if (say) say.textContent = 'Step ' + (i + 1) + ' of ' + plan.segs.length + '. ' + plan.segs[i].label;
  if (rows[i]) rows[i].scrollIntoView({ block: 'nearest' });

  // Restart the attention pulse from the top on every step change.
  timer.sheet.classList.remove('pulse');
  void timer.sheet.offsetWidth;
  timer.sheet.classList.add('pulse');
}

/* One tick of the brew: advance the clock, fire any cue this moment has
   earned, repaint. Driven from two places on purpose — see timerRun. */
function timerTick() {
  if (!timer || !timer.running) return;
  timer.elapsed = timer.from + (performance.now() - timer.at) / 1000;
  if (timer.elapsed >= timer.plan.total) {
    timer.elapsed = timer.plan.total;
    timerRun(false);
    timerPaint();
    timer.sheet.classList.add('is-done');
    timer.el.querySelector('.timer-now-label').textContent = 'Brew complete.';
    var say = timer.el.querySelector('.timer-announce');
    if (say) say.textContent = 'Brew complete.';
    timerCue('done');
    timerControls();
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
  // v3's label ladder: Start brewing → Pause → Resume → Brew again.
  var label = done ? 'Brew again'
    : timer.running ? 'Pause'
    : timer.elapsed > 0 ? 'Resume' : 'Start brewing';
  btn.innerHTML = (done ? ICON.replay : timer.running ? ICON.pause : ICON.play) +
    '<span>' + label + '</span>';

  var mute = timer.el.querySelector('.timer-mute');
  if (mute) {
    mute.innerHTML = timerMuted ? ICON.soundOff : ICON.soundOn;
    mute.setAttribute('aria-pressed', timerMuted ? 'true' : 'false');
    var ml = timerMuted ? 'Unmute step cues' : 'Mute step cues';
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
  stack.forEach(function (m, i) {
    var el = m.render();
    m.el = el;
    modalRoot.appendChild(el);
    if (scrolls[i]) {
      var body = el.querySelector('.sheet-body');
      if (body) body.scrollTop = scrolls[i];
    }
  });

  document.body.style.overflow = stack.length ? 'hidden' : '';
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

function sheet(opts) {
  var wrap = document.createElement('div');
  wrap.className = 'overlay';
  wrap.innerHTML =
    '<div class="sheet' + (opts.narrow ? ' narrow' : '') + '" role="dialog" aria-modal="true">' +
      '<div class="sheet-head"><h2>' + esc(opts.title) + '</h2>' +
        '<button class="iconbtn" data-action="close-modal" aria-label="Close">' + ICON.close + '</button></div>' +
      '<div class="sheet-body">' + opts.body + '</div>' +
      '<div class="sheet-foot">' + opts.foot + '</div>' +
    '</div>';
  wrap.addEventListener('mousedown', function (ev) { if (ev.target === wrap) closeModal(); });
  return wrap;
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
            '<button class="btn btn-ghost" data-action="close-modal">Cancel</button>' +
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

function entitySelect(type, value, id, placeholder) {
  var list = coll(type).slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
  var opts = '<option value="">' + esc(placeholder || '— none —') + '</option>';
  list.forEach(function (e) {
    opts += '<option value="' + esc(e.id) + '"' + (e.id === value ? ' selected' : '') + '>' + esc(e.name) + '</option>';
  });
  return '<div class="with-add">' +
    '<select class="inp" id="' + id + '" data-role="' + type + '">' + opts + '</select>' +
    '<button type="button" class="addbtn" data-action="quick-add" data-type="' + type + '" ' +
      'title="Add ' + esc(ENTITIES[type].label.toLowerCase()) + '">' + ICON.plus + '</button>' +
  '</div>';
}

/* The recipe form opens on the roaster, which narrows the coffee list below
   it. Roaster isn't stored on the recipe — it lives on the Coffee entity, and
   duplicating it here would give the same fact two homes. It's a filter that
   makes picking a coffee quick once the library is large, and it's derived
   back off the coffee when an existing recipe is reopened. */
function formRoasterSelect(value) {
  var opts = '<option value="">All roasters</option>';
  allRoasters().forEach(function (ro) {
    opts += '<option value="' + esc(ro.id) + '"' + (ro.id === value ? ' selected' : '') + '>' + esc(ro.name) + '</option>';
  });
  return '<select class="inp" id="f-roaster-sel">' + opts + '</select>';
}

// Coffees for the chosen roaster, or all of them when none is chosen (which
// is also how coffees with no roaster recorded stay reachable).
function coffeesForRoaster(roasterId) {
  var list = coll('coffee').slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
  if (!roasterId) return list;
  return list.filter(function (c) { return c.roasterId === roasterId; });
}

function coffeeSelectHTML(roaster, value) {
  var list = coffeesForRoaster(roaster);
  // Deliberately unselected to start: the coffee is the one field worth a
  // conscious choice every time, and quietly defaulting to whichever coffee
  // sorts first is how a recipe ends up filed under the wrong bag.
  var opts = '<option value="">' +
    (list.length ? 'Select a coffee…' : 'No coffees for this roaster yet') + '</option>';
  list.forEach(function (c) {
    opts += '<option value="' + esc(c.id) + '"' + (c.id === value ? ' selected' : '') + '>' + esc(c.name) + '</option>';
  });
  return '<div class="with-add">' +
    '<select class="inp" id="f-coffee-sel" data-role="coffee">' + opts + '</select>' +
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
  var head = '<div class="form-sep-label">Brewing steps</div>';

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
        'placeholder="What to do at this point" aria-label="Step ' + (i + 1) + ' instruction" />' +
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
      '<button type="button" class="btn btn-ghost btn-sm" data-action="style-step-add">' + ICON.plus + 'Add step</button>' +
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
      '<input class="inp" data-s="label" value="' + esc(s.label) + '" placeholder="What you do at this point" />' +
      '<input class="inp" data-s="water" value="' + esc(s.water === 0 ? '' : s.water) + '" placeholder="g" inputmode="decimal" />' +
      '<button type="button" class="del" data-action="del-step" data-i="' + i + '" aria-label="Remove step">' + ICON.close + '</button>' +
    '</div>';
  }).join('');
  return '<p class="hint" style="margin:0 0 12px">This recipe style has no built-in formula — write the steps by hand.</p>' +
    '<div class="steps-head"><span>Time</span><span>Action</span><span>Water</span><span></span></div>' +
    '<div id="stepsWrap">' + rows + '</div>' +
    '<div class="steps-tools">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-action="add-step">' + ICON.plus + 'Add step</button>' +
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
  // Reopening an existing recipe derives the roaster back off its coffee, so
  // the narrowed list matches what's already selected instead of resetting.
  var c = findIn('coffee', m.draft.coffeeId);
  m.roaster = c ? (c.roasterId || '') : '';
  openModal(m);
}

function buildRecipeForm(m) {
  var d = m.draft;
  var body =
    // Coffee leads; roaster sits under it and stays in step both ways —
    // picking a coffee fills the roaster in, and picking a roaster narrows
    // the coffee list for when the library is long.
    '<div class="row row-2">' +
      '<div class="field" id="coffeeField"><label for="f-coffee-sel">Coffee</label>' +
        coffeeSelectHTML(m.roaster, d.coffeeId) + '</div>' +
      '<div class="field"><label for="f-roaster-sel">Roaster</label>' + formRoasterSelect(m.roaster) + '</div>' +
    '</div>' +
    '<div class="field"><label for="f-method-sel">Brewing method</label>' + entitySelect('method', d.methodId, 'f-method-sel', 'Select a method…') + '</div>' +
    '<div class="row row-2">' +
      '<div class="field"><label for="f-grinder-sel">Grinder</label>' + entitySelect('grinder', d.grinderId, 'f-grinder-sel', 'Select a grinder…') + '</div>' +
      '<div class="field"><label for="f-grind">Grind size</label>' +
        '<input class="inp" id="f-grind" value="' + esc(d.grindSize) + '" placeholder="e.g. 75 clicks" /></div>' +
    '</div>' +
    '<div class="field"><label for="f-style-sel">Recipe style</label>' + entitySelect('style', d.styleId, 'f-style-sel', 'Select a style…') +
      '<div class="hint">Pouring steps always follow the chosen recipe style. Add a style to build your own step-by-step schedule.</div></div>' +

    '<div class="form-sep-label">Brew parameters</div>' +
    '<div class="row row-3">' +
      '<div class="field"><label for="f-dose">Coffee dose (g)</label>' +
        '<input class="inp" id="f-dose" value="' + esc(d.dose) + '" placeholder="15" inputmode="decimal" /></div>' +
      '<div class="field"><label for="f-water">Water (g)</label>' +
        '<input class="inp" id="f-water" value="' + esc(d.water) + '" placeholder="250" inputmode="decimal" /></div>' +
      '<div class="field"><label for="f-temp">Temperature (°C)</label>' +
        '<input class="inp" id="f-temp" value="' + esc(d.temp) + '" placeholder="94" inputmode="decimal" /></div>' +
    '</div>' +
    '<div class="row row-2">' +
      '<div class="field"><label for="f-time">Total brew time</label>' +
        '<input class="inp" id="f-time" value="' + esc(d.brewTime) + '" placeholder="3:30" /></div>' +
      '<div class="field"><label>Ratio</label>' +
        '<div class="inp" style="display:flex;align-items:center;background:var(--surface-sunken);border-style:dashed">' +
          '<span id="ratioOut" class="ratio-hint">' + ratio(d.dose, d.water) + '</span></div></div>' +
    '</div>' +

    '<div class="form-sep-label">Pouring steps</div>' +
    '<div id="stepsSection">' + stepsSectionHTML(m) + '</div>' +

    '<div class="form-sep-label">Finishing touches</div>' +
    '<div class="field"><label for="f-notes">Personal notes</label>' +
      '<textarea class="inp" id="f-notes" placeholder="What worked, what to change next time…">' + esc(d.notes) + '</textarea></div>' +
    '<div class="row row-2">' +
      '<div class="field"><label for="f-name">Custom title (optional)</label>' +
        '<input class="inp" id="f-name" value="' + esc(d.name) + '" placeholder="Defaults to the coffee name" /></div>' +
      '<div class="field"><label>Cup score</label>' +
        '<div class="rate" id="rateWrap">' +
          [1, 2, 3, 4, 5].map(function (i) {
            return '<button type="button" class="' + (i <= (d.rating || 0) ? 'on' : '') + '" data-action="rate" data-v="' + i + '" aria-label="Rate ' + i + '">' +
              iconBean(i <= (d.rating || 0)) + '</button>';
          }).join('') +
        '</div></div>' +
    '</div>';

  var foot = '<button class="btn btn-ghost" data-action="close-modal">Cancel</button>' +
    '<button class="btn btn-primary" data-action="save-recipe">' + (d.id ? 'Save changes' : 'Save recipe') + '</button>';

  var el = sheet({ title: d.id ? 'Edit recipe' : 'New recipe', body: body, foot: foot });

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

  // Changing the roaster repaints just the coffee select beneath it, and drops
  // a coffee that no longer belongs to the chosen roaster rather than leaving
  // a selection that contradicts the field above it.
  // Choosing a coffee fills in its roaster, so the field below never
  // contradicts the one above it. Only the roaster select is repainted —
  // collapsing the coffee list out from under a fresh choice is jarring.
  el.addEventListener('change', function (ev) {
    if (!ev.target || ev.target.id !== 'f-coffee-sel') return;
    readRecipeForm(m);
    var picked = findIn('coffee', d.coffeeId);
    m.roaster = picked ? (picked.roasterId || '') : '';
    var rs = el.querySelector('#f-roaster-sel');
    if (rs) rs.value = m.roaster;
  });

  el.querySelector('#f-roaster-sel').addEventListener('change', function (ev) {
    readRecipeForm(m);
    m.roaster = ev.target.value;
    var c = findIn('coffee', d.coffeeId);
    if (m.roaster && (!c || c.roasterId !== m.roaster)) d.coffeeId = '';
    var field = el.querySelector('#coffeeField');
    field.innerHTML = '<label for="f-coffee-sel">Coffee</label>' + coffeeSelectHTML(m.roaster, d.coffeeId);
  });

  return el;
}

function readRecipeForm(m) {
  var el = m.el;
  if (!el) return;
  var d = m.draft, q = function (s) { return el.querySelector(s); };
  var roasterSel = q('#f-roaster-sel');
  if (roasterSel) m.roaster = roasterSel.value;
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
  if (!d.coffeeId) { toast('Pick a coffee first.'); return; }
  if (!d.methodId) { toast('Pick a brewing method.'); return; }

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
  toast('Recipe saved.');

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
  ['Natural', ['natural', 'via seca', 'dry process']],
  ['Induced fermentation', ['fermentacao induzida', 'induced fermentation', 'koji', 'lactic fermentation']]
];

var VARIETAL_TERMS = ['Bourbon', 'Yellow Bourbon', 'Red Bourbon', 'Caturra', 'Catuaí', 'Catucaí',
  'Mundo Novo', 'Typica', 'Geisha', 'Gesha', 'SL28', 'SL34', 'Heirloom', 'Pacamara', 'Maragogipe',
  'Icatu', 'Obatã', 'Arara', 'Acaiá', 'Topázio', 'Paraíso', 'Ouro Amarelo', 'Sarchimor', 'Villa Sarchi',
  'Pacas', 'Castillo', 'Caturrão', 'Rubi', 'Tupi', 'Laurina', 'Pink Bourbon'];

var ROAST_TERMS = [
  ['Light', ['light roast', 'light', 'torra clara', 'clara']],
  ['Medium-dark', ['medium-dark', 'medium dark', 'torra media escura']],
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
  ['origin', ['origem', 'origin', 'regiao', 'region', 'terroir', 'municipio']],
  // Deliberately not 'fazenda' / 'sitio' / 'farm': on Brazilian bags those
  // open the coffee's own name far more often than they label a producer
  // ("Fazenda Samambaia", "Sítio Palmito"). Treating them as labels both
  // stole the name and filed a truncated value under Origin.
  ['producer', ['produtor', 'producer']],
  // Recognised so they terminate a neighbouring value and never pose as a
  // coffee name, but mapped to nothing — the app has no field for them.
  ['skip', ['pontuacao', 'score', 'finalizacao', 'finalizaco', 'safra', 'secagem',
    'peneira', 'torrefacao', 'validade', 'lote/torrado em', 'lote', 'peso liquido',
    'peso', 'conteudo', 'moagem', 'embalado em']],
  ['notes', ['perfil sensorial', 'perfil aromatico', 'notas sensoriais',
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
  'cafe torrado em graos', 'torrado em graos', 'em graos', 'validade', 'lote',
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

function parseAltitude(text) {
  var re = /(\d{1,2}[.,]?\d{3}|\d{3,4})\s*(?:m|metros)?\s*(?:a|à|-|–|—|to|até|ate)\s*(\d{1,2}[.,]?\d{3}|\d{3,4})\s*(?:m\b|mts|metros|msnm|masl|m\.a\.s\.l)/i;
  var one = /(\d{1,2}[.,]\d{3}|\d{3,4})\s*(?:m\b|mts|metros|msnm|masl|m\.a\.s\.l)/i;

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

function matchVarietals(hay) {
  var hits = [];
  VARIETAL_TERMS.forEach(function (v) {
    if (termRe(scanNorm(v)).test(hay) && hits.indexOf(v) === -1) hits.push(v);
  });
  return hits.slice(0, 3).join(', ');
}

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
  'alto paranaiba', 'zona da mata'];
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
  'frutas', 'frutado', 'fruta', 'citrico', 'citrica', 'laranja', 'limao', 'tangerina', 'abacaxi',
  'maca', 'pessego', 'damasco', 'uva', 'morango', 'framboesa', 'banana', 'mamao', 'manga',
  'floral', 'jasmim', 'flores', 'acucar', 'doce', 'cremoso', 'encorpado',
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
function assembleNotes(frags) {
  var head = [], tail = [];
  frags.forEach(function (f) {
    f = splitGluedE(String(f).trim());
    if (!f) return;
    if (/^e\s/.test(scanNorm(f))) tail.push(f); else head.push(f);
  });
  return head.concat(tail).join(' ').replace(/\s+/g, ' ').trim();
}

function looksLikeNotes(line) {
  var n = scanNorm(line);
  if (n.length < 12) return false;
  // A list, not a single word: notes are enumerated.
  if (n.indexOf(',') === -1 && n.indexOf(' e ') === -1 && n.indexOf(' and ') === -1) return false;
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
  var re = /(\d{1,2}[.,]?\d{3}|\d{3,4})\s*(?:m\b|mts|metros|msnm|masl)/i;
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
  [['altitude', findAltitudeSpan],
   ['roast', function (t) { return findTermSpan(t, ROAST_TERMS); }],
   ['process', function (t) { return findTermSpan(t, PROCESS_TERMS); }]
  ].forEach(function (ex) {
    var idx = -1;
    hits.forEach(function (h, i) { if (h.field === ex[0] && out[i] === undefined) idx = i; });
    if (idx === -1) return;
    var span = ex[1](text);
    if (!span) return;
    out[idx] = span.value;
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

function looksLikeName(line) {
  var n = scanNorm(line);
  if (n.length < 3 || n.length > 44) return false;
  if (!/[a-z]/.test(n)) return false;               // pure numbers / weights
  if (/\d+\s*(g|kg|gr|ml)\b/.test(n)) return false; // "250 g"
  if (NOT_A_NAME.indexOf(n) !== -1) return false;
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
    if (field === 'process') {
      var pv = matchTerms(scanNorm(val), PROCESS_TERMS);
      if (pv) { take(); put('process', pv, reason); }
      return;
    }
    if (field === 'roast') {
      var rv = matchTerms(scanNorm(val), ROAST_TERMS);
      if (rv) { take(); put('roast', rv, reason); }
      return;
    }
    // A label already vouches that this is a tasting note, so one flavour
    // word is enough here — the stricter test is for finding notes with no
    // label at all.
    if (field === 'notes') {
      if (flavourHits(val)) { take(); put('notes', trimEdges(val), reason); }
      return;
    }
    take();
    if (field === 'altitude') put('altitude', parseAltitudeLoose(val) || val, reason);
    else if (field === 'producer') put('origin', trimEdges(val), reason);
    else put(field, trimEdges(val), reason);
  }

  // Tier 1 — labelled lines. Most reliable, so it runs first and wins.
  lines.forEach(function (line, i) {
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
  if (!found.process) {
    var proc = matchTerms(hay, PROCESS_TERMS);
    if (proc) put('process', proc, 'the label mentions this process');
  }
  if (!found.varietal) {
    var vars = matchVarietals(hay);
    if (vars) put('varietal', vars, 'recognised variety name on the label');
  }
  if (!found.roast) {
    var roast = matchTerms(hay, ROAST_TERMS);
    if (roast) put('roast', roast, 'the label mentions this roast level');
  }
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
    if (best) put('notes', trimEdges(best), 'reads as a list of tasting notes');
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
      '<p>' + esc(state.label || 'Reading the label…') + '</p></div>';
  } else if (state && state.error) {
    inner = '<p class="scan-err">' + esc(state.error) + '</p>' +
      '<button class="btn btn-ghost btn-sm" data-action="scan-label">' + ICON.camera + 'Try again</button>';
  } else {
    inner = '<button class="btn btn-ghost btn-sm" data-action="scan-label">' + ICON.camera + 'Scan label</button>' +
      '<p>Fill the frame with the panel that lists origin, altitude and process — ' +
      'usually the back. Small print needs a close, straight, evenly lit shot. ' +
      'Nothing leaves your device.</p>';
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

function pickImage() {
  return new Promise(function (resolve) {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    // No `capture` attribute on purpose: leaving it off lets the phone
    // offer both the camera and an existing photo, which matters for a bag
    // already drunk and thrown away.
    inp.addEventListener('change', function () {
      resolve(inp.files && inp.files[0] ? inp.files[0] : null);
    });
    inp.click();
  });
}

function startLabelScan(m) {
  if (!m || m.type !== 'coffee') return;
  pickImage().then(function (file) {
    if (!file) return;
    paintScan(m, { busy: true, progress: 0, label: 'Preparing the photo…' });
    return prepScanImage(file).then(function (prepped) {
      paintScan(m, { busy: true, progress: 0, label: 'Loading the reader…' });
      return runScanOCR(prepped.canvas, function (p) {
        paintScan(m, { busy: true, progress: p, label: 'Reading the label…' });
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
        paintScan(m, { error: 'Couldn’t read any text. Try filling the frame with the label, in even light.' });
        return;
      }
      openScanReview(m, parsed);
    });
  }).catch(function (err) {
    var msg = 'Something went wrong reading that photo.';
    if (err && err.message === 'tesseract-network') {
      msg = 'Couldn’t load the text reader — check your connection and try again.';
    } else if (err && err.message === 'decode') {
      msg = 'That file didn’t open as an image.';
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
        '<details class="scan-raw"><summary>Everything it read</summary>' +
        '<pre>' + esc(parsed.raw.trim() || '—') + '</pre></details></div>';
      var foot = '<button class="btn btn-ghost" data-action="close-modal">Cancel</button>' +
        '<button class="btn btn-primary" data-action="apply-scan">Fill fields</button>';
      return sheet({ title: 'What the label says', body: body, foot: foot, narrow: true });
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
            'value="' + val + '" placeholder="' + esc(f.ph || '') + '" autocomplete="off" />' +
            '<datalist id="' + dl + '">' + listOpts + '</datalist>';
        } else if (f.area) {
          control = '<textarea class="inp" id="e-' + f.k + '" data-k="' + f.k + '" placeholder="' + esc(f.ph || '') + '">' + val + '</textarea>';
        } else {
          control = '<input class="inp" id="e-' + f.k + '" data-k="' + f.k + '" value="' + val + '" placeholder="' + esc(f.ph || '') + '" />';
        }
        return '<div class="field"><label for="e-' + f.k + '">' + esc(f.l) + (f.req ? '' : ' <span style="text-transform:none;letter-spacing:0">(optional)</span>') + '</label>' +
          control + '</div>';
      }).join('');
      // Only coffees have a printed label to read, so only coffees get the
      // scanner — and it sits above the fields, since it fills them.
      if (type === 'coffee') body = scanBlockHTML() + body;
      // A style is the one entity that carries a process, not just facts —
      // so it gets the step builder under its plain fields.
      if (type === 'style') body += styleStepsSectionHTML(d);
      var foot = '<button class="btn btn-ghost" data-action="close-modal">Cancel</button>' +
        '<button class="btn btn-primary" data-action="save-entity">' + (d.id ? 'Save changes' : 'Add ' + def.label.toLowerCase()) + '</button>';
      return sheet({ title: (d.id ? 'Edit ' : 'Add ') + def.label.toLowerCase(), body: body, foot: foot, narrow: type !== 'style' });
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
  if (!d.name) { toast('Give it a name first.'); return; }
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
  toast(def.label + ' saved.');
}

/* ---------------------------------------------------------
   11. Library manager
   --------------------------------------------------------- */

function openLibrary(tab) {
  var m = {
    tab: tab || 'coffee',
    render: function () {
      var def = ENTITIES[m.tab];
      var list = coll(m.tab).slice().sort(function (a, b) { return a.name.localeCompare(b.name); });

      var tabs = '<div class="tabs">' + Object.keys(ENTITIES).map(function (t) {
        return '<button data-action="lib-tab" data-type="' + t + '" class="' + (t === m.tab ? 'on' : '') + '">' +
          esc(ENTITIES[t].plural) + ' <span style="opacity:.55">' + coll(t).length + '</span></button>';
      }).join('') + '</div>';

      var items = list.length ? list.map(function (e) {
        var used = def.usedBy ? def.usedBy(e.id) : state.recipes.filter(function (r) { return r[def.ref] === e.id; }).length;
        var noun = def.usedLabel || 'recipe';
        var meta = def.meta(e);
        return '<div class="list-item">' +
          '<div class="txt"><div class="nm">' + esc(e.name) + '</div>' +
            (meta ? '<div class="mt">' + esc(meta) + '</div>' : '') + '</div>' +
          '<span class="cnt">' + used + ' ' + (used === 1 ? noun : noun + 's') + '</span>' +
          '<button class="iconbtn" data-action="lib-edit" data-type="' + m.tab + '" data-id="' + esc(e.id) + '" aria-label="Edit">' + ICON.edit + '</button>' +
          '<button class="iconbtn danger" data-action="lib-del" data-type="' + m.tab + '" data-id="' + esc(e.id) + '" aria-label="Delete">' + ICON.trash + '</button>' +
        '</div>';
      }).join('') : '<div class="empty" style="padding:44px 20px"><h3 style="font-size:18px">Nothing here yet</h3>' +
        '<p>Add your first ' + esc(def.label.toLowerCase()) + '.</p></div>';

      var foot = '<button class="btn btn-ghost" data-action="close-modal">Done</button>' +
        '<button class="btn btn-primary" data-action="lib-add" data-type="' + m.tab + '">' + ICON.plus + 'Add ' + esc(def.label.toLowerCase()) + '</button>';

      return sheet({ title: 'Library', body: tabs + '<div class="list">' + items + '</div>', foot: foot });
    }
  };
  openModal(m);
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
    title: 'Delete ' + def.label.toLowerCase(),
    body: body,
    confirmLabel: 'Delete',
    onConfirm: function () {
      closeModal();
      state[def.coll] = coll(type).filter(function (x) { return x.id !== id; });
      save();
      renderModals();
      render();
      toast(def.label + ' deleted.');
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
  toast('Exported.');
}

function importData(file) {
  var reader = new FileReader();
  reader.onload = function () {
    var data;
    try {
      data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.recipes) || !Array.isArray(data.coffees)) throw new Error('bad shape');
    } catch (e) {
      toast('That file does not look like a Brew Library export.');
      return;
    }
    var have = state.recipes.length, incoming = data.recipes.length;
    confirmDanger({
      title: 'Replace your library',
      body: '<p>Replace your current library — ' + have + ' ' + (have === 1 ? 'recipe' : 'recipes') +
        ' — with the imported file (' + incoming + ' ' + (incoming === 1 ? 'recipe' : 'recipes') + ')?</p>' +
        '<p>This cannot be undone — export a backup first if unsure.</p>',
      confirmLabel: 'Replace library',
      onConfirm: function () {
        closeModal();
        state = normalizeLibrary(data);
        save();
        render();
        toast('Library imported.');
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
        toast('Library reset.');
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
  var t = ev.target.closest('[data-action]');
  var menu = ev.target.closest('#appMenu, [data-action="toggle-menu"], #detailMenu, [data-action="toggle-detail-menu"]');
  if (!menu) closeMenu();
  if (!t) return;

  var action = t.getAttribute('data-action');
  var id = t.getAttribute('data-id');
  var type = t.getAttribute('data-type');
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
      t.setAttribute('aria-expanded', dm.hidden ? 'false' : 'true');
      return;

    case 'new-recipe':
      ev.preventDefault();
      if (!state.coffees.length) {
        openEntityForm('coffee', null, function () { openRecipeForm(null); });
        toast('Add a coffee first — then the recipe.');
        return;
      }
      openRecipeForm(null);
      return;

    case 'open-library': ev.preventDefault(); openLibrary('coffee'); return;

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
        timerRun(false);
        timer.sheet.classList.add('is-done');
        timer.el.querySelector('.timer-now-label').textContent = 'Brew complete.';
        timerControls();
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
      toast('Duplicated — edit away.');
      return;

    case 'delete':
      ev.preventDefault();
      closeMenu();
      var dr = recipeById(id);
      if (!dr) return;
      confirmDanger({
        title: 'Delete recipe',
        body: '<p>Delete “' + esc(titleOf(dr)) + '”?</p>',
        confirmLabel: 'Delete',
        onConfirm: function () {
          closeModal();
          state.recipes = state.recipes.filter(function (r) { return r.id !== id; });
          save();
          location.hash = '#/';
          render();
          toast('Recipe deleted.');
        }
      });
      return;

    case 'clear-filters':
      filters.q = ''; filters.coffee = ''; filters.roaster = ''; filters.grinder = '';
      filters.method = ''; filters.style = ''; filters.fav = false;
      openCombo = null; comboQuery = '';
      render();
      return;

    case 'toggle-fav-filter':
      filters.fav = !filters.fav;
      render();
      return;

    case 'toggle-more-filters':
      filtersExpanded = !filtersExpanded;
      render();
      return;

    case 'combo-toggle':
      openCombo = openCombo === type ? null : type;
      comboQuery = '';
      renderHome();
      if (openCombo) { var cf = document.getElementById('f-combo-' + openCombo); if (cf) cf.focus(); }
      return;

    case 'combo-clear':
      comboQuery = '';
      renderHome();
      var cc = document.getElementById('f-combo-' + openCombo);
      if (cc) cc.focus();
      return;

    case 'combo-pick':
      filters[type] = id;
      openCombo = null;
      comboQuery = '';
      render();
      return;

    case 'sign-in':
      ev.preventDefault();
      window.Brew.signIn().catch(function (err) {
        if (err && err.code === 'auth/popup-blocked') {
          toast('Your browser blocked the sign-in popup — allow popups for this site and try again.');
        } else if (err && err.code === 'auth/popup-closed-by-user') {
          // They closed it themselves — no need to show an error.
        } else {
          toast('Could not sign in' + (err && err.code ? ' (' + err.code + ')' : '') + '.');
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
      top.draft.steps.splice(Number(t.getAttribute('data-i')), 1);
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
      top.draft.steps.splice(Number(t.getAttribute('data-i')), 1);
      if (!top.draft.steps.length) top.draft.steps.push({ t: '', label: '' });
      renderModals();
      return;

    case 'style-step-move':
      top.capture();
      var mFrom = Number(t.getAttribute('data-i'));
      var mTo = mFrom + Number(t.getAttribute('data-dir'));
      var mArr = top.draft.steps;
      if (mTo < 0 || mTo >= mArr.length) return;
      var moved = mArr[mFrom];
      mArr[mFrom] = mArr[mTo];
      mArr[mTo] = moved;
      renderModals();
      return;

    case 'rate':
      top.capture();
      var v = Number(t.getAttribute('data-v'));
      top.draft.rating = top.draft.rating === v ? 0 : v;
      renderModals();
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
        // Follow the new coffee's roaster rather than stranding it outside
        // the filter — saving a coffee only to watch it vanish is worse than
        // quietly moving the filter to where the user just went.
        if (type === 'coffee' && parent) {
          var nc = findIn('coffee', newId);
          parent.roaster = nc ? (nc.roasterId || '') : '';
        }
        // A roaster added from the recipe form becomes the active filter, so
        // the coffee select below it is already scoped to what you just made.
      }, type === 'coffee' && top && top.roaster
        ? { roasterName: (findIn('roaster', top.roaster) || {}).name || '' }
        : null);
      return;

    case 'lib-tab': top.tab = type; renderModals(); return;
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
  if (f === 'sort') filters.sort = ev.target.value;
  else filters[f] = ev.target.value;
  renderHome();
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

trackVisualViewport();
boot();

})();
