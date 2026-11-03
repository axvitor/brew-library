// A small in-memory stand-in for the Firebase compat SDK: enough of
// Firestore (docs, collections, collection groups, batches, listeners) and
// Auth for firebase-init.js to run unchanged.
'use strict';

function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

function makeFirebase() {
  var store = new Map();          // path -> data
  var listeners = [];             // { kind: 'doc'|'coll'|'group', key, cb }
  var stats = { writes: 0, deletes: 0, reads: 0 };
  var faults = { failBatch: 0, failPrefix: null };
  var SERVER_TS = { __ts: true };

  function notify(changedPaths) {
    setTimeout(function () {
      listeners.slice().forEach(function (l) {
        var hit = changedPaths.some(function (p) {
          if (l.kind === 'doc') return p === l.key;
          var segs = p.split('/');
          var parent = segs.slice(0, -1).join('/');
          if (l.kind === 'coll') return parent === l.key;
          return segs[segs.length - 2] === l.key;   // group
        });
        if (hit) l.fire();
      });
    }, 0);
  }
  function resolveTs(data) {
    var out = clone(data);
    (function walk(o) {
      Object.keys(o || {}).forEach(function (k) {
        if (o[k] && o[k].__ts) o[k] = Date.now();
        else if (o[k] && typeof o[k] === 'object') walk(o[k]);
      });
    })(out);
    return out;
  }

  function DocSnap(path) {
    var data = store.get(path);
    return {
      exists: data !== undefined, id: path.split('/').pop(),
      ref: docRef(path), data: function () { return clone(data); }
    };
  }
  function QuerySnap(paths) {
    var snaps = paths.sort().map(DocSnap);
    stats.reads += snaps.length;
    return { forEach: function (fn) { snaps.forEach(fn); }, size: snaps.length };
  }
  function childrenOf(collPath) {
    var out = [];
    store.forEach(function (_, p) {
      var segs = p.split('/');
      if (segs.slice(0, -1).join('/') === collPath) out.push(p);
    });
    return out;
  }
  function groupMembers(id) {
    var out = [];
    store.forEach(function (_, p) { var s = p.split('/'); if (s[s.length - 2] === id) out.push(p); });
    return out;
  }
  // Real Firestore throws on the spot for an array directly inside an array.
  function validate(v) {
    if (Array.isArray(v)) v.forEach(function (x) { if (Array.isArray(x)) throw new Error('Nested arrays are not supported'); validate(x); });
    else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { validate(v[k]); });
  }
  function checkFault(path) {
    if (faults.failPrefix && path.indexOf(faults.failPrefix) === 0) throw new Error('fault on ' + path);
  }
  function write(path, data) {
    checkFault(path);
    store.set(path, resolveTs(data)); stats.writes++;
  }
  function del(path) { checkFault(path); store.delete(path); stats.deletes++; }

  function docRef(path) {
    var segs = path.split('/');
    var ref = {
      id: segs[segs.length - 1], path: path,
      get parent() { return collRef(segs.slice(0, -1).join('/')); },
      collection: function (name) { return collRef(path + '/' + name); },
      get: function () { stats.reads++; return Promise.resolve(DocSnap(path)); },
      set: function (data) {
        validate(data);
        return new Promise(function (res, rej) {
          try { write(path, data); notify([path]); res(); } catch (e) { rej(e); }
        });
      },
      onSnapshot: function (cb, err) {
        var l = { kind: 'doc', key: path, fire: function () { stats.reads++; cb(DocSnap(path)); } };
        listeners.push(l); setTimeout(l.fire, 0);
        return function () { listeners.splice(listeners.indexOf(l), 1); };
      }
    };
    return ref;
  }
  function collRef(path) {
    var segs = path.split('/');
    return {
      id: segs[segs.length - 1], path: path,
      get parent() { return segs.length > 1 ? docRef(segs.slice(0, -1).join('/')) : null; },
      doc: function (id) { return docRef(path + '/' + id); },
      add: function (data) { var id = 'auto' + Math.random().toString(36).slice(2, 8); return docRef(path + '/' + id).set(data); },
      get: function () { return Promise.resolve(QuerySnap(childrenOf(path))); },
      onSnapshot: function (cb, err) {
        var l = { kind: 'coll', key: path, fire: function () { cb(QuerySnap(childrenOf(path))); } };
        listeners.push(l); setTimeout(l.fire, 0);
        return function () { listeners.splice(listeners.indexOf(l), 1); };
      }
    };
  }
  var db = {
    enablePersistence: function () { return Promise.resolve(); },
    collection: function (name) { return collRef(name); },
    collectionGroup: function (id) {
      return {
        onSnapshot: function (cb, err) {
          var l = { kind: 'group', key: id, fire: function () { cb(QuerySnap(groupMembers(id))); } };
          listeners.push(l); setTimeout(l.fire, 0);
          return function () { listeners.splice(listeners.indexOf(l), 1); };
        }
      };
    },
    batch: function () {
      var ops = [];
      return {
        set: function (ref, data) { validate(data); ops.push(['set', ref.path, clone(data)]); },
        'delete': function (ref) { ops.push(['del', ref.path]); },
        commit: function () {
          return new Promise(function (res, rej) {
            if (faults.failBatch > 0) { faults.failBatch--; return rej(new Error('batch failed')); }
            try { ops.forEach(function (o) { checkFault(o[1]); }); } catch (e) { return rej(e); }
            ops.forEach(function (o) { if (o[0] === 'set') write(o[1], o[2]); else del(o[1]); });
            notify(ops.map(function (o) { return o[1]; }));
            res();
          });
        }
      };
    }
  };
  var firebase = {
    initializeApp: function () {},
    auth: Object.assign(function () {
      return { onAuthStateChanged: function () {}, signInWithPopup: function () {}, signOut: function () {} };
    }, { GoogleAuthProvider: function () {} }),
    firestore: Object.assign(function () { return db; }, {
      FieldValue: { serverTimestamp: function () { return SERVER_TS; } }
    })
  };
  return { firebase: firebase, store: store, stats: stats, faults: faults, db: db };
}
module.exports = makeFirebase;
