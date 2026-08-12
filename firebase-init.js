/* ============================================================
   Firebase bridge — Google sign-in + one private Firestore
   document per user. Loaded before app.js; exposes a small
   API on window.Brew that app.js's storage layer calls into.

   The config below is not a secret — it only tells the browser
   which Firebase project to talk to. Real access control lives
   in the Firestore security rules and the allowlist document,
   both configured in the Firebase console, never in this file.
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
    // Resolves true/false. A denied read (email not on the list) resolves
    // to false rather than throwing — callers treat both the same way.
    checkAllowlist: function (email) {
      return db.collection('config').doc('allowlist').get()
        .then(function (snap) {
          if (!snap.exists) return false;
          var emails = (snap.data().emails || []).map(function (e) { return String(e).toLowerCase(); });
          return emails.indexOf(String(email).toLowerCase()) > -1;
        })
        .catch(function (err) {
          if (err && err.code === 'permission-denied') return false;
          throw err;
        });
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
    }
  };

})();
