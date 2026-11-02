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
    loadLibrary: function (userId) {
      return libraryRef(userId).get().then(function (snap) {
        return snap.exists ? snap.data() : null;
      });
    },
    saveLibrary: function (userId, data) {
      return libraryRef(userId).set(data);
    },
    // Real-time listener — fires on every change, from this device or any other.
    subscribeLibrary: function (userId, callback) {
      return libraryRef(userId).onSnapshot(function (snap) {
        if (snap.exists) callback(snap.data());
      }, function (err) {
        console.error('Library sync error', err);
      });
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
      var libs = null, profiles = null;
      function emit() { if (libs && profiles) onData({ libraries: libs, profiles: profiles }); }
      function collect(snap) {
        var out = {};
        snap.forEach(function (doc) {
          var d = doc.data();
          if (d.lastActive && d.lastActive.toMillis) d.lastActive = d.lastActive.toMillis();
          out[doc.id] = d;
        });
        return out;
      }
      var a = db.collection('libraries').onSnapshot(function (s) { libs = collect(s); emit(); }, onError);
      var b = db.collection('profiles').onSnapshot(function (s) { profiles = collect(s); emit(); }, onError);
      return function () { a(); b(); };
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
