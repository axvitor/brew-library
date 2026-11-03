/* ============================================================
   Firebase bridge — Google sign-in + one private Firestore
   document per user. Loaded before app.js; exposes a small
   API on window.Brew that app.js's storage layer calls into.

   The config below is not a secret — it only tells the browser
   which Firebase project to talk to. Access control (each user
   can only read/write their own library) lives entirely in
   firestore.rules, configured in the Firebase console.
   ============================================================ */
(function () {
  'use strict';

  var firebaseConfig = {
    apiKey: "AIzaSyDkCd2bGwI0XceVqmnJ_Jq4G-PjiUJ4XE0",
    authDomain: "brew-library.firebaseapp.com",
    projectId: "brew-library",
    storageBucket: "brew-library.firebasestorage.app",
    messagingSenderId: "736797528441",
    appId: "1:736797528441:web:a2e29ce572027798011fa8"
  };

  if (typeof firebase === 'undefined') {
    // SDK failed to load (offline, ad blocker, CDN down) — app.js checks
    // for window.Brew and shows a "can't connect" screen instead of crashing.
    return;
  }

  firebase.initializeApp(firebaseConfig);

  var auth = firebase.auth();
  var db = firebase.firestore();
  var provider = new firebase.auth.GoogleAuthProvider();

  // Cache reads locally (IndexedDB) so the app opens instantly and keeps
  // working offline; writes made offline sync up once back online.
  try {
    db.enablePersistence({ synchronizeTabs: true }).catch(function (err) {
      console.warn('Offline persistence unavailable:', err.code);
    });
  } catch (e) { /* older browsers without IndexedDB */ }

  function libraryRef(userId) {
    return db.collection('libraries').doc(userId);
  }
  function profileRef(userId) {
    return db.collection('profiles').doc(userId);
  }

  // Local calendar day, "2026-11-02" — the unit activity is counted in.
  function dayKey(d) {
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  }

  /* ---- storage: one document per item ----
     A library used to be a single document holding every coffee, recipe
     and grinder as arrays. That made two devices overwrite each other
     (the last save rewrote everything) and capped a library at Firestore's
     1 MiB per document. Now libraries/{uid} holds only the settings, and
     each item is its own document under it:

       libraries/{uid}                    version, seedVersion, scanLearn…
       libraries/{uid}/recipes/{id}       one recipe
       libraries/{uid}/coffees/{id}       one coffee … and so on per kind

     app.js still works with the whole library as one object. This bridge
     keeps what it last saw of each document and, on every save, writes
     only the items that changed and deletes the ones that went. Items
     keep the order they were added in through _pos, which only this
     file reads or writes. */
  var KINDS = ['coffees', 'recipes', 'roasters', 'grinders', 'methods', 'styles'];
  var BATCH = 400;                      // Firestore allows 500 writes per batch

  // Same content, same string — key order included — so an item read back
  // from Firestore compares equal to the one about to be saved.
  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; })
        .map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
    }
    return JSON.stringify(v === undefined ? null : v);
  }
  // What Firestore can hold: no undefined anywhere.
  function plain(v) { return JSON.parse(JSON.stringify(v)); }
  /* Firestore refuses an array directly inside an array, and the label
     scan's learning keeps its examples as [text, field] pairs. On the way
     in each inner array is wrapped as { __list: [...] }; on the way out
     it is unwrapped, so app.js never sees the difference. */
  function enc(v) {
    if (Array.isArray(v)) return v.map(function (x) { return Array.isArray(x) ? { __list: enc(x) } : enc(x); });
    if (v && typeof v === 'object') {
      var o = {};
      Object.keys(v).forEach(function (k) { o[k] = enc(v[k]); });
      return o;
    }
    return v;
  }
  function dec(v) {
    if (Array.isArray(v)) return v.map(dec);
    if (v && typeof v === 'object') {
      var keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === '__list' && Array.isArray(v.__list)) return dec(v.__list);
      var o = {};
      keys.forEach(function (k) { o[k] = dec(v[k]); });
      return o;
    }
    return v;
  }
  function docId(id) { return String(id).replace(/\//g, '%2F'); }
  function hasArrays(d) {
    return !!d && KINDS.some(function (k) { return Array.isArray(d[k]); });
  }
  function metaOf(lib) {
    var m = {};
    Object.keys(lib || {}).forEach(function (k) { if (KINDS.indexOf(k) === -1) m[k] = lib[k]; });
    m.schema = 2;
    return plain(m);
  }
  function itemOf(data) {
    var e = {};
    Object.keys(data).forEach(function (k) { if (k !== '_pos') e[k] = data[k]; });
    return dec(e);
  }
  // Runs writes in batches; each batch is all-or-nothing.
  function commit(ops) {
    var chunks = [];
    for (var i = 0; i < ops.length; i += BATCH) chunks.push(ops.slice(i, i + BATCH));
    return Promise.all(chunks.map(function (chunk) {
      try {
        var b = db.batch();
        chunk.forEach(function (op) { if (op.del) b['delete'](op.ref); else b.set(op.ref, enc(op.data)); });
        return b.commit();
      } catch (err) {
        return Promise.reject(err);      // data Firestore refused outright
      }
    }));
  }

  /* The one-time move from the old single document. Nothing old is
     removed until everything new is confirmed:
       1. a full copy of the old document goes to backup/v1;
       2. every item is written as its own document;
       3. each kind is read back and counted against the old arrays;
       4. only then is libraries/{uid} replaced by its settings alone.
     If any step fails the old document is untouched and the next load
     simply tries again. */
  function migrate(userId, old) {
    var ref = libraryRef(userId);
    var ops = [];
    KINDS.forEach(function (kind) {
      (Array.isArray(old[kind]) ? old[kind] : []).forEach(function (e, i) {
        if (!e || e.id == null) return;
        ops.push({ ref: ref.collection(kind).doc(docId(e.id)), data: Object.assign(plain(e), { _pos: i }) });
      });
    });
    return ref.collection('backup').doc('v1')
      .set({ savedAt: firebase.firestore.FieldValue.serverTimestamp(), library: enc(plain(old)) })
      .then(function () { return commit(ops); })
      .then(function () {
        return Promise.all(KINDS.map(function (kind) {
          return ref.collection(kind).get().then(function (s) {
            var want = {};
            (Array.isArray(old[kind]) ? old[kind] : []).forEach(function (e) { if (e && e.id != null) want[docId(e.id)] = true; });
            var have = {};
            s.forEach(function (d) { have[d.id] = true; });
            var missing = Object.keys(want).filter(function (id) { return !have[id]; });
            if (missing.length) throw new Error('Moved ' + kind + ' are missing ' + missing.length + ' items');
          });
        }));
      })
      .then(function () { return ref.set(enc(metaOf(old))); });
  }

  // One live session per signed-in library: the listeners, and what they
  // last saw of each document — the baseline saves are compared against.
  var session = null;
  function openSession(userId) {
    if (session && session.uid === userId) return session;
    closeSession();
    var s = session = { uid: userId, meta: null, metaKey: null, items: {}, seen: {}, stops: [], cb: null, ready: null, timer: 0 };
    KINDS.forEach(function (k) { s.items[k] = {}; });
    var ref = libraryRef(userId);
    var resolveReady, rejectReady;
    s.ready = new Promise(function (res, rej) { resolveReady = res; rejectReady = rej; });

    function assemble() {
      var lib = Object.assign({}, s.meta || {});
      delete lib.schema;
      KINDS.forEach(function (k) {
        lib[k] = Object.keys(s.items[k]).map(function (id) { return s.items[k][id]; })
          .sort(function (a, b) { return a.pos - b.pos; })
          .map(function (x) { return x.data; });
      });
      return lib;
    }
    s.assemble = assemble;
    // Seven listeners report one change in several pieces; they're folded
    // into a single update for the app.
    function changed() {
      var all = s.seen.meta && KINDS.every(function (k) { return s.seen[k]; });
      if (!all) return;
      if (resolveReady) { var r = resolveReady; resolveReady = null; r(assemble()); return; }
      clearTimeout(s.timer);
      s.timer = setTimeout(function () { if (s.cb && session === s) s.cb(assemble()); }, 0);
    }
    function fail(err) {
      console.error('Library sync error', err);
      if (rejectReady) { var r = rejectReady; rejectReady = null; resolveReady = null; r(err); }
    }

    s.stops.push(ref.onSnapshot(function (snap) {
      var d = snap.exists ? dec(snap.data()) : null;
      // An out-of-date copy of the app saved the old layout over this one.
      // Its arrays are the newest whole-library save, so they're moved in
      // again rather than lost.
      if (hasArrays(d)) { migrate(userId, d).catch(fail); return; }
      s.meta = d;
      s.metaKey = d ? stable(d) : null;
      s.seen.meta = true;
      changed();
    }, fail));
    KINDS.forEach(function (kind) {
      s.stops.push(ref.collection(kind).onSnapshot(function (snap) {
        var map = {};
        snap.forEach(function (doc) {
          var data = doc.data();
          var item = itemOf(data);
          map[doc.id] = { pos: typeof data._pos === 'number' ? data._pos : 0, data: item, key: stable(item) };
        });
        s.items[kind] = map;
        s.seen[kind] = true;
        changed();
      }, fail));
    });
    return s;
  }
  function closeSession() {
    if (!session) return;
    clearTimeout(session.timer);
    session.stops.forEach(function (stop) { stop(); });
    session = null;
  }

  window.Brew = {
    // Popup rather than redirect: a redirect round-trips through
    // brew-library.firebaseapp.com, a different domain than wherever this
    // app is hosted, and Chrome/Safari increasingly block the storage
    // access that hand-off needs — sign-in silently fails and bounces back
    // to the login screen. Popup avoids that by messaging the opener window
    // directly instead of relying on cross-domain storage.
    signIn: function () {
      return auth.signInWithPopup(provider);
    },
    signOutUser: function () {
      return auth.signOut();
    },
    // Fires immediately with the current user (or null), then again on
    // every sign-in/sign-out.
    onAuthChange: function (callback) {
      return auth.onAuthStateChanged(callback);
    },
    // The whole library as one object, or null for a new account. A library
    // still in the old single-document layout is moved first. The listeners
    // started here stay on and feed subscribeLibrary, so the library is
    // read once, not twice.
    loadLibrary: function (userId) {
      closeSession();
      return libraryRef(userId).get().then(function (snap) {
        var d = snap.exists ? dec(snap.data()) : null;
        if (!d) { openSession(userId); return null; }
        return (hasArrays(d) ? migrate(userId, d) : Promise.resolve())
          .then(function () { return openSession(userId).ready; });
      });
    },
    // Writes only what differs from the last thing seen in Firestore: the
    // items that changed, the ones that went, and the settings if they moved.
    saveLibrary: function (userId, data) {
      var s = openSession(userId), ref = libraryRef(userId), ops = [];
      KINDS.forEach(function (kind) {
        var have = s.items[kind], keep = {}, top = -1;
        Object.keys(have).forEach(function (id) { if (have[id].pos > top) top = have[id].pos; });
        (Array.isArray(data[kind]) ? data[kind] : []).forEach(function (e) {
          if (!e || e.id == null) return;
          var id = docId(e.id), item = plain(e), key = stable(item), was = have[id];
          keep[id] = true;
          if (was && was.key === key) return;
          var pos = was ? was.pos : ++top;
          have[id] = { pos: pos, data: item, key: key };
          ops.push({ ref: ref.collection(kind).doc(id), data: Object.assign({}, item, { _pos: pos }) });
        });
        Object.keys(have).forEach(function (id) {
          if (keep[id]) return;
          delete have[id];
          ops.push({ ref: ref.collection(kind).doc(id), del: true });
        });
      });
      var meta = metaOf(data), metaKey = stable(meta);
      if (metaKey !== s.metaKey) {
        s.meta = meta;
        s.metaKey = metaKey;
        ops.push({ ref: ref, data: meta });
      }
      return ops.length ? commit(ops) : Promise.resolve();
    },
    // Fires with the whole library now, then on every change from this
    // device or any other. Returns a function that stops it.
    subscribeLibrary: function (userId, callback) {
      var s = openSession(userId);
      s.cb = callback;
      // The library as it stands now — saves made since loading included —
      // not the copy the first load returned.
      s.ready.then(function () { if (session === s && s.cb === callback) callback(s.assemble()); });
      return function () { if (session === s) closeSession(); };
    },

    /* The account's profile: what the admin dashboard lists. Written at
       most once a day per device — the name and email Google gave, when
       the account was made, when it was last used (the server's clock,
       which the rules insist on) and the days it was used, kept to the
       last 120 so the document stays small. */
    touchProfile: function (user) {
      var today = dayKey(new Date());
      var mark = 'brewSeen:' + user.uid;
      try { if (localStorage.getItem(mark) === today) return Promise.resolve(); } catch (e) {}
      var ref = profileRef(user.uid);
      return ref.get().then(function (snap) {
        var days = (snap.exists && snap.data().activeDays) || [];
        if (days.indexOf(today) === -1) days.push(today);
        days = days.sort().slice(-120);
        // Fixed once written — the rules refuse to move it.
        var created = snap.exists && snap.data().createdAt;
        if (typeof created !== 'number') created = Date.parse(user.metadata && user.metadata.creationTime);
        return ref.set({
          name: String(user.displayName || '').slice(0, 200),
          email: user.email || '',
          createdAt: isFinite(created) ? created : Date.now(),
          lastActive: firebase.firestore.FieldValue.serverTimestamp(),
          activeDays: days
        });
      }).then(function () {
        try { localStorage.setItem(mark, today); } catch (e) {}
      }).catch(function (err) {
        console.warn('Profile not updated', err.code || err);
      });
    },

    /* The account's admin role, or null. Only decides whether the app
       shows the way in — the data behind it is guarded by the rules,
       which check the same document on every request. */
    getAdminRole: function (userId) {
      return db.collection('admins').doc(userId).get().then(function (snap) {
        return snap.exists ? (snap.data().role || null) : null;
      }).catch(function () { return null; });
    },

    /* Every library and profile, live. Fails with permission-denied for
       anyone the rules don't list as an admin. Returns an unsubscribe. */
    watchAdminData: function (onData, onError) {
      // Settings and profiles per account, plus every item of each kind
      // across all accounts (one collection-group query per kind). An
      // account not yet moved to per-item documents still has its arrays
      // in the settings document, and those are used as they are.
      var metas = null, profiles = null, groups = {}, timer = 0;
      function emit() {
        if (!metas || !profiles || !KINDS.every(function (k) { return groups[k]; })) return;
        clearTimeout(timer);
        timer = setTimeout(function () {
          var libs = {};
          Object.keys(metas).forEach(function (uid) {
            var m = metas[uid], lib = {};
            KINDS.forEach(function (k) {
              lib[k] = Array.isArray(m[k]) ? m[k]
                : (groups[k][uid] || []).sort(function (x, y) { return x.pos - y.pos; }).map(function (x) { return x.data; });
            });
            libs[uid] = lib;
          });
          onData({ libraries: libs, profiles: profiles });
        }, 0);
      }
      function collect(snap) {
        var out = {};
        snap.forEach(function (doc) {
          var d = doc.data();
          if (d.lastActive && d.lastActive.toMillis) d.lastActive = d.lastActive.toMillis();
          out[doc.id] = dec(d);
        });
        return out;
      }
      var stops = [
        db.collection('libraries').onSnapshot(function (s) { metas = collect(s); emit(); }, onError),
        db.collection('profiles').onSnapshot(function (s) { profiles = collect(s); emit(); }, onError)
      ];
      KINDS.forEach(function (kind) {
        stops.push(db.collectionGroup(kind).onSnapshot(function (snap) {
          var byUser = {};
          snap.forEach(function (doc) {
            var owner = doc.ref.parent.parent;
            if (!owner || owner.parent.id !== 'libraries') return;
            var data = doc.data();
            (byUser[owner.id] = byUser[owner.id] || []).push({ pos: typeof data._pos === 'number' ? data._pos : 0, data: itemOf(data) });
          });
          groups[kind] = byUser;
          emit();
        }, onError));
      });
      return function () { clearTimeout(timer); stops.forEach(function (stop) { stop(); }); };
    },

    // An entry in the admin audit log: who looked at what, and when.
    logAdmin: function (userId, action, target) {
      return db.collection('adminLog').add({
        by: userId,
        action: String(action).slice(0, 40),
        target: String(target || '').slice(0, 128),
        at: firebase.firestore.FieldValue.serverTimestamp()
      }).catch(function (err) { console.warn('Admin log not written', err.code || err); });
    }
  };

})();
