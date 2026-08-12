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
var SEED_VERSION = 5;

// The one account that starts with the full 101-recipe starter library.
// Everyone else invited to the app starts blank — your personal coffee list
// shouldn't land in a friend's account just because they signed in.
var OWNER_EMAIL = 'axvitor@gmail.com';

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
    coffees: [], recipes: [],
    grinders: base.grinders, methods: base.methods, styles: base.styles
  };
}

function initialLibraryFor(user) {
  var isOwner = user && user.email && user.email.toLowerCase() === OWNER_EMAIL;
  return isOwner ? seed() : emptyLibrary();
}

/* ---------------------------------------------------------
   2. Seed data — the reusable entities
   --------------------------------------------------------- */

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

  var styles = [
    { id: 'st-hoffmann', name: 'James Hoffmann', author: 'James Hoffmann',
      notes: 'Ultimate V60 technique — bloom, two pours, swirl, even drawdown.' },
    { id: 'st-tetsu-sweet', name: 'Tetsu Kasuya — Sweet', author: 'Tetsu Kasuya',
      notes: '4:6 method. A smaller first pour pushes the cup toward sweetness.' },
    { id: 'st-tetsu-acid', name: 'Tetsu Kasuya — Acid', author: 'Tetsu Kasuya',
      notes: '4:6 method. A larger first pour brings out acidity and brightness.' },
    { id: 'st-tetsu-strength', name: 'Tetsu Kasuya — Strength', author: 'Tetsu Kasuya',
      notes: '4:6 method. Balanced first 40%, then the remaining 60% split into three pours for a stronger cup.' },
    { id: 'st-espresso', name: 'Espresso', author: '',
      notes: 'A pressure shot rather than a pour: dial in with dose, grind and shot time instead of a pour schedule.' }
  ];

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
  coffee: {
    coll: 'coffees', label: 'Coffee', plural: 'Coffees', ref: 'coffeeId',
    fields: [
      { k: 'name', l: 'Name', ph: 'Ethiopia Guji', req: true },
      { k: 'roaster', l: 'Roaster', ph: 'Who roasted it' },
      { k: 'origin', l: 'Origin', ph: 'Region, country' },
      { k: 'process', l: 'Process', ph: 'Washed / Natural / Honey' },
      { k: 'roast', l: 'Roast level', ph: 'Light / Medium / Dark' },
      { k: 'varietal', l: 'Varietal', ph: 'Caturra, Geisha…' },
      { k: 'notes', l: 'Tasting notes', ph: 'Peach, bergamot, jasmine', area: true }
    ],
    meta: function (e) { return [e.roaster, e.origin, e.process].filter(Boolean).join(' · '); }
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
    // James Hoffmann's "Ultimate V60": 2× bloom, up to 60% by 1:15, rest by 1:45, stir, drawdown.
    return [
      { t: '0:00', label: 'Bloom — pour twice the coffee weight, wetting every ground.', water: g(dose * 2) },
      { t: '0:10', label: 'Swirl gently until the bed is flat and no dry grounds remain.', water: 0 },
      { t: '0:45', label: 'Pour steadily up to 60% of the total water, finishing by 1:15.', water: g(water * 0.6 - dose * 2) },
      { t: '1:15', label: 'Pour the remaining 40% more gently, in circles, by 1:45.', water: g(water * 0.4) },
      { t: '1:45', label: 'Stir once clockwise and once anti-clockwise, then let it draw down.', water: 0 }
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
function iconStar(filled) {
  return '<svg viewBox="0 0 24 24" class="' + (filled ? '' : 'off') + '"><path d="M12 3.6l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9z"/></svg>';
}
function stars(n) {
  var out = '<span class="stars">', i;
  for (i = 1; i <= 5; i++) out += iconStar(i <= (n || 0));
  return out + '</span>';
}
var ICON = {
  edit: '<svg viewBox="0 0 24 24" class="ico"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" class="ico"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
  trash: '<svg viewBox="0 0 24 24" class="ico"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>',
  plus: '<svg viewBox="0 0 24 24" class="ico"><path d="M12 5v14M5 12h14"/></svg>',
  close: '<svg viewBox="0 0 24 24" class="ico"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  back: '<svg viewBox="0 0 24 24" class="ico"><path d="M15 6l-6 6 6 6"/></svg>',
  search: '<svg viewBox="0 0 24 24" class="ico"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/></svg>',
  star: '<svg viewBox="0 0 24 24" class="ico"><path d="M12 3.6l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9z"/></svg>',
  bean: '<svg viewBox="0 0 24 24" class="bean"><g transform="rotate(-28 12 12)">' +
    '<ellipse cx="12" cy="12" rx="6.4" ry="9.4"/><path d="M12 4.4c-2 2.5-2 5 0 7.6s2 5.1 0 7.6"/></g></svg>'
};

/* ---------------------------------------------------------
   6. Filters
   --------------------------------------------------------- */

var filters = { q: '', coffee: '', roaster: '', grinder: '', method: '', style: '', fav: false, sort: 'new' };

function filtersActive() {
  return !!(filters.q || filters.coffee || filters.roaster || filters.grinder || filters.method || filters.style || filters.fav);
}

function roasterOf(r) {
  var c = findIn('coffee', r.coffeeId);
  return c ? (c.roaster || '') : '';
}

function allRoasters() {
  var seen = {}, out = [];
  state.coffees.forEach(function (c) {
    var name = (c.roaster || '').trim();
    if (name && !seen[name]) { seen[name] = true; out.push(name); }
  });
  out.sort(function (a, b) { return a.localeCompare(b); });
  return out;
}

function visibleRecipes() {
  var q = filters.q.trim().toLowerCase();
  var out = state.recipes.filter(function (r) {
    if (filters.coffee && r.coffeeId !== filters.coffee) return false;
    if (filters.roaster && roasterOf(r) !== filters.roaster) return false;
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

function updateAccountChip() {
  var chip = document.getElementById('accountChip');
  var actions = document.getElementById('appActions');
  if (!chip) return;
  if (currentUser) {
    chip.hidden = false;
    var avatar = document.getElementById('accountAvatar');
    var emailEl = document.getElementById('accountEmail');
    if (avatar) {
      avatar.src = currentUser.photoURL || '';
      avatar.style.visibility = currentUser.photoURL ? 'visible' : 'hidden';
    }
    if (emailEl) emailEl.textContent = currentUser.email || '';
  } else {
    chip.hidden = true;
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

function selectHTML(id, type, value) {
  var list = coll(type).slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
  var opts = '<option value="">All ' + esc(ENTITIES[type].plural.toLowerCase()) + '</option>';
  list.forEach(function (e) {
    opts += '<option value="' + esc(e.id) + '"' + (e.id === value ? ' selected' : '') + '>' + esc(e.name) + '</option>';
  });
  return '<div class="sel' + (value ? ' on' : '') + '"><select id="' + id + '" data-filter="' + type + '" aria-label="Filter by ' +
    esc(ENTITIES[type].label) + '">' + opts + '</select></div>';
}

function roasterSelectHTML(value) {
  var list = allRoasters();
  var opts = '<option value="">All roasters</option>';
  list.forEach(function (name) {
    opts += '<option value="' + esc(name) + '"' + (name === value ? ' selected' : '') + '>' + esc(name) + '</option>';
  });
  return '<div class="sel' + (value ? ' on' : '') + '"><select id="f-roaster" data-filter="roaster" aria-label="Filter by roaster">' +
    opts + '</select></div>';
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

  html += '<div class="filters">' +
    '<div class="search">' + ICON.search +
      '<input id="q" type="search" placeholder="Search recipes…" value="' + esc(filters.q) + '" />' +
    '</div>' +
    selectHTML('f-coffee', 'coffee', filters.coffee) +
    roasterSelectHTML(filters.roaster) +
    selectHTML('f-grinder', 'grinder', filters.grinder) +
    selectHTML('f-method', 'method', filters.method) +
    selectHTML('f-style', 'style', filters.style) +
    '<button class="pill-toggle' + (filters.fav ? ' on' : '') + '" data-action="toggle-fav-filter">' +
      ICON.star + 'Favourites</button>' +
    '<div class="sel"><select id="f-sort" data-filter="sort" aria-label="Sort recipes">' +
      '<option value="new"' + (filters.sort === 'new' ? ' selected' : '') + '>Newest first</option>' +
      '<option value="old"' + (filters.sort === 'old' ? ' selected' : '') + '>Oldest first</option>' +
      '<option value="rating"' + (filters.sort === 'rating' ? ' selected' : '') + '>Top rated</option>' +
      '<option value="coffee"' + (filters.sort === 'coffee' ? ' selected' : '') + '>A–Z</option>' +
    '</select></div>' +
    (filtersActive() ? '<button class="btn btn-quiet btn-sm" data-action="clear-filters">Clear</button>' : '') +
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
  if (r.rating) bits.push('<span class="tag tag-accent">' + stars(r.rating) + '</span>');

  return '<a class="card" href="#/r/' + encodeURIComponent(r.id) + '">' +
    '<div class="card-head">' +
      '<div>' +
        '<div class="card-title">' + esc(titleOf(r)) + '</div>' +
        '<div class="card-sub">' +
          '<span>' + esc(nameOf('method', r.methodId)) + '</span><span class="dot"></span>' +
          '<span>' + esc(nameOf('style', r.styleId)) + '</span>' +
        '</div>' +
      '</div>' +
      '<button class="fav' + (r.fav ? ' on' : '') + '" data-action="fav" data-id="' + esc(r.id) + '" aria-label="Toggle favourite">' +
        iconStar(true) + '</button>' +
    '</div>' +
    '<div class="tags">' + bits.join('') + '</div>' +
    '<div class="stats">' +
      '<div class="stat"><span class="k">Dose</span><span class="v">' + num(r.dose, ' g') + '</span></div>' +
      '<div class="stat"><span class="k">Water</span><span class="v">' + num(r.water, ' g') + '</span></div>' +
      '<div class="stat"><span class="k">Ratio</span><span class="v">' + ratio(r.dose, r.water) + '</span></div>' +
    '</div>' +
    '</a>';
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
  var base = 'Follows the ' + nameOf('style', r.styleId) + ' formula, scaled to this dose and water.';
  var me = findIn('method', r.methodId);
  var mName = (me ? me.name : '').toLowerCase();
  var doseDrivesSteps = r.styleId === 'st-hoffmann' && mName.indexOf('aeropress') === -1;
  if (doseDrivesSteps && !Number(r.dose)) {
    return 'Follows the ' + nameOf('style', r.styleId) + ' formula. No dose recorded, so the bloom assumes 15 g ' +
      '(this style’s ratio at 250 g) — set a dose to make it exact.';
  }
  return base;
}

// Pouring steps are always derived from the recipe style's formula (scaled to
// this recipe's dose/water/method) whenever that style has one built in.
// Only styles without a formula (custom, user-added ones) keep hand-written steps.
function effectiveSteps(r) {
  if (hasFormula(r.styleId)) {
    var me = findIn('method', r.methodId);
    return preset(r.styleId, r.dose, r.water, me ? me.name : '');
  }
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
  if (c) { spec('Roaster', c.roaster); spec('Origin', c.origin); spec('Process', c.process); spec('Roast', c.roast); spec('Varietal', c.varietal); }
  spec('Grinder', gr ? gr.name : '—');
  spec('Grind size', r.grindSize);
  spec('Method', me ? me.name : '—');
  spec('Recipe style', st ? st.name : '—');
  if (st && st.author) spec('Devised by', st.author);

  var html = '<div class="detail">' +
    '<a class="back" href="#/">' + ICON.back + 'Library</a>' +

    '<div class="detail-head">' +
      '<div>' +
        '<div class="kicker">' + esc(nameOf('method', r.methodId)) + ' · ' + esc(nameOf('style', r.styleId)) + '</div>' +
        '<h1>' + esc(titleOf(r)) + '</h1>' +
        '<div class="card-sub" style="margin-top:10px">' +
          (r.rating ? stars(r.rating) + '<span class="dot"></span>' : '') +
          '<span>' + ratio(r.dose, r.water) + ' ratio</span>' +
          (c && c.origin ? '<span class="dot"></span><span>' + esc(c.origin) + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="detail-actions">' +
        '<button class="btn btn-ghost btn-sm" data-action="fav" data-id="' + esc(r.id) + '">' +
          ICON.star + (r.fav ? 'Favourited' : 'Favourite') + '</button>' +
        '<button class="btn btn-ghost btn-sm" data-action="duplicate" data-id="' + esc(r.id) + '">' + ICON.copy + 'Duplicate</button>' +
        '<button class="btn btn-ghost btn-sm btn-danger" data-action="delete" data-id="' + esc(r.id) + '">' + ICON.trash + 'Delete</button>' +
        '<button class="btn btn-primary btn-sm" data-action="edit" data-id="' + esc(r.id) + '">' + ICON.edit + 'Edit</button>' +
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
            ? '<p style="color:var(--muted);font-size:15px">' + esc(noStepsMessage(r)) + '</p>'
            : '<p style="color:var(--muted);font-size:15px">No steps recorded — ' +
              '<a href="#" data-action="edit" data-id="' + esc(r.id) + '" style="color:var(--accent-ink)">add them</a>.</p>') +
        (r.notes ? '<div class="block"><div class="section-title">Personal notes</div><div class="notes">' + esc(r.notes) + '</div></div>' : '') +
      '</div>' +
    '</div>' +
  '</div>';

  view.innerHTML = html;
  window.scrollTo(0, 0);
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
function closeModal() { stack.pop(); renderModals(); }
function renderModals() {
  modalRoot.innerHTML = '';
  stack.forEach(function (m) {
    var el = m.render();
    m.el = el;
    modalRoot.appendChild(el);
  });
  document.body.style.overflow = stack.length ? 'hidden' : '';
  var last = stack[stack.length - 1];
  if (last && last.el) {
    var focusable = last.el.querySelector('input,select,textarea');
    if (focusable && !('ontouchstart' in window)) focusable.focus();
  }
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

/* ---------------------------------------------------------
   9. Recipe form
   --------------------------------------------------------- */

function blankRecipe() {
  return {
    id: '', name: '', coffeeId: state.coffees[0] ? state.coffees[0].id : '',
    grinderId: state.grinders[0] ? state.grinders[0].id : '', grindSize: '',
    methodId: state.methods[0] ? state.methods[0].id : '',
    styleId: state.styles[0] ? state.styles[0].id : '',
    dose: '', water: '', temp: 94, brewTime: '',
    steps: [{ t: '', label: '', water: '' }],
    notes: '', rating: 0, fav: false
  };
}

function entitySelect(type, value, id) {
  var list = coll(type).slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
  var opts = '<option value="">— none —</option>';
  list.forEach(function (e) {
    opts += '<option value="' + esc(e.id) + '"' + (e.id === value ? ' selected' : '') + '>' + esc(e.name) + '</option>';
  });
  return '<div class="with-add">' +
    '<select class="inp" id="' + id + '" data-role="' + type + '">' + opts + '</select>' +
    '<button type="button" class="addbtn" data-action="quick-add" data-type="' + type + '" ' +
      'title="Add ' + esc(ENTITIES[type].label.toLowerCase()) + '">' + ICON.plus + '</button>' +
  '</div>';
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
    '<div class="row row-2">' +
      '<div class="field"><label for="f-coffee-sel">Coffee</label>' + entitySelect('coffee', d.coffeeId, 'f-coffee-sel') + '</div>' +
      '<div class="field"><label for="f-method-sel">Brewing method</label>' + entitySelect('method', d.methodId, 'f-method-sel') + '</div>' +
    '</div>' +
    '<div class="row row-2">' +
      '<div class="field"><label for="f-grinder-sel">Grinder</label>' + entitySelect('grinder', d.grinderId, 'f-grinder-sel') + '</div>' +
      '<div class="field"><label for="f-grind">Grind size</label>' +
        '<input class="inp" id="f-grind" value="' + esc(d.grindSize) + '" placeholder="e.g. 75 clicks" /></div>' +
    '</div>' +
    '<div class="field"><label for="f-style-sel">Recipe style</label>' + entitySelect('style', d.styleId, 'f-style-sel') +
      '<div class="hint">Pouring steps always follow the chosen recipe style — set the dose and water below and they scale automatically.</div></div>' +

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
        '<div class="inp" style="display:flex;align-items:center;background:var(--paper-2);border-style:dashed">' +
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
      '<div class="field"><label>Rating</label>' +
        '<div class="rate" id="rateWrap">' +
          [1, 2, 3, 4, 5].map(function (i) {
            return '<button type="button" class="' + (i <= (d.rating || 0) ? 'on' : '') + '" data-action="rate" data-v="' + i + '" aria-label="' + i + ' stars">' +
              '<svg viewBox="0 0 24 24"><path d="M12 3.6l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9z"/></svg></button>';
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
  if (!d.coffeeId) { toast('Pick a coffee first.'); return; }
  if (!d.methodId) { toast('Pick a brewing method.'); return; }

  if (hasFormula(d.styleId)) {
    // Style-driven steps are computed live at render time — nothing to store.
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
   10. Entity form (coffee / grinder / method / style)
   --------------------------------------------------------- */

function openEntityForm(type, existing, onSaved) {
  var def = ENTITIES[type];
  var m = {
    draft: existing ? JSON.parse(JSON.stringify(existing)) : { id: '' },
    capture: function () { readEntityForm(m, def); },
    render: function () {
      var d = m.draft;
      var body = def.fields.map(function (f) {
        var val = esc(d[f.k] == null ? '' : d[f.k]);
        return '<div class="field"><label for="e-' + f.k + '">' + esc(f.l) + (f.req ? '' : ' <span style="text-transform:none;letter-spacing:0">(optional)</span>') + '</label>' +
          (f.area
            ? '<textarea class="inp" id="e-' + f.k + '" data-k="' + f.k + '" placeholder="' + esc(f.ph || '') + '">' + val + '</textarea>'
            : '<input class="inp" id="e-' + f.k + '" data-k="' + f.k + '" value="' + val + '" placeholder="' + esc(f.ph || '') + '" />') +
          '</div>';
      }).join('');
      var foot = '<button class="btn btn-ghost" data-action="close-modal">Cancel</button>' +
        '<button class="btn btn-primary" data-action="save-entity">' + (d.id ? 'Save changes' : 'Add ' + def.label.toLowerCase()) + '</button>';
      return sheet({ title: (d.id ? 'Edit ' : 'Add ') + def.label.toLowerCase(), body: body, foot: foot, narrow: true });
    },
    type: type,
    onSaved: onSaved
  };
  openModal(m);
}

function readEntityForm(m, def) {
  if (!m.el) return;
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
        var used = state.recipes.filter(function (r) { return r[def.ref] === e.id; }).length;
        var meta = def.meta(e);
        return '<div class="list-item">' +
          '<div class="txt"><div class="nm">' + esc(e.name) + '</div>' +
            (meta ? '<div class="mt">' + esc(meta) + '</div>' : '') + '</div>' +
          '<span class="cnt">' + used + ' ' + (used === 1 ? 'recipe' : 'recipes') + '</span>' +
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
  var used = state.recipes.filter(function (r) { return r[def.ref] === id; }).length;
  var msg = 'Delete “' + e.name + '”?';
  if (used) msg += '\n\nIt is used by ' + used + ' ' + (used === 1 ? 'recipe' : 'recipes') +
    ', which will show “—” for this field until you edit them.';
  if (!confirm(msg)) return;
  state[def.coll] = coll(type).filter(function (x) { return x.id !== id; });
  save();
  renderModals();
  render();
  toast(def.label + ' deleted.');
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
    try {
      var data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.recipes) || !Array.isArray(data.coffees)) throw new Error('bad shape');
      if (!confirm('Replace your current library with the imported file?\n\nThis cannot be undone — export a backup first if unsure.')) return;
      state = data;
      ['coffees', 'grinders', 'methods', 'styles', 'recipes'].forEach(function (k) {
        if (!Array.isArray(state[k])) state[k] = [];
      });
      save();
      render();
      toast('Library imported.');
    } catch (e) {
      toast('That file does not look like a Brew Library export.');
    }
  };
  reader.readAsText(file);
}

function resetAll() {
  if (!confirm('Reset the library back to the starter data?\n\nEvery recipe and coffee you added will be deleted.')) return;
  state = initialLibraryFor(currentUser);
  save({ keepPristine: true });
  location.hash = '#/';
  render();
  toast('Library reset.');
}

/* ---------------------------------------------------------
   13. Events
   --------------------------------------------------------- */

function closeMenu() { document.getElementById('appMenu').hidden = true; }

document.addEventListener('click', function (ev) {
  var t = ev.target.closest('[data-action]');
  var menu = ev.target.closest('#appMenu, [data-action="toggle-menu"]');
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
      if (fr) { fr.fav = !fr.fav; save(); render(); }
      return;

    case 'edit':
      ev.preventDefault();
      openRecipeForm(recipeById(id));
      return;

    case 'duplicate':
      ev.preventDefault();
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
      var dr = recipeById(id);
      if (!dr) return;
      if (!confirm('Delete “' + titleOf(dr) + '”?')) return;
      state.recipes = state.recipes.filter(function (r) { return r.id !== id; });
      save();
      location.hash = '#/';
      render();
      toast('Recipe deleted.');
      return;

    case 'clear-filters':
      filters.q = ''; filters.coffee = ''; filters.roaster = ''; filters.grinder = '';
      filters.method = ''; filters.style = ''; filters.fav = false;
      render();
      return;

    case 'toggle-fav-filter':
      filters.fav = !filters.fav;
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

    case 'add-step':
      top.capture();
      top.draft.steps.push({ t: '', label: '', water: '' });
      renderModals();
      return;

    case 'del-step':
      top.capture();
      top.draft.steps.splice(Number(t.getAttribute('data-i')), 1);
      if (!top.draft.steps.length) top.draft.steps.push({ t: '', label: '', water: '' });
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

    case 'quick-add':
      openEntityForm(type, null, function (newId) {
        var parent = stack[stack.length - 1];
        if (parent && parent.draft) parent.draft[ENTITIES[type].ref] = newId;
      });
      return;

    case 'lib-tab': top.tab = type; renderModals(); return;
    case 'lib-add': openEntityForm(type, null, null); return;
    case 'lib-edit': openEntityForm(type, findIn(type, id), null); return;
    case 'lib-del': deleteEntity(type, id); return;

    /* --- data --- */
    case 'export': exportData(); return;
    case 'import': document.getElementById('importFile').click(); return;
    case 'reset': resetAll(); return;
  }
});

document.addEventListener('input', function (ev) {
  if (ev.target.id === 'q') {
    filters.q = ev.target.value;
    var pos = ev.target.selectionStart;
    renderHome();
    var again = document.getElementById('q');
    if (again) { again.focus(); again.setSelectionRange(pos, pos); }
  }
});

document.addEventListener('change', function (ev) {
  var f = ev.target.getAttribute && ev.target.getAttribute('data-filter');
  if (!f) return;
  if (f === 'sort') filters.sort = ev.target.value;
  else filters[f] = ev.target.value;
  renderHome();
});

document.addEventListener('keydown', function (ev) {
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

/* ---------------------------------------------------------
   14. Boot — wait for Firebase auth before showing anything.
   --------------------------------------------------------- */

function boot() {
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
      if (!data || (data.pristine && data.seedVersion !== SEED_VERSION)) {
        state = initialLibraryFor(user);
        window.Brew.saveLibrary(user.uid, state);
      } else {
        state = data;
      }
      render();

      // Live sync: any change (from this device or another) re-renders.
      unsubscribeLibrary = window.Brew.subscribeLibrary(user.uid, function (remote) {
        state = remote;
        render();
      });
    });
  });
}

boot();

})();
