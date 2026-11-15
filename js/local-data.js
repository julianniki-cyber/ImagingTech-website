/*
 * Data layer — gives every page the same window.claude.use('db' | 'user' | 'assets')
 * interface it was built against, backed by one of:
 *
 *   1. Claude's built-in database, when the site runs on Claude (this file steps aside).
 *   2. Firebase (Firestore + Auth + Storage), when FIREBASE_CONFIG below is filled in.
 *      The admin signs in with Google; saves and image uploads go live for everyone.
 *   3. The JSON files in data/ (read-only), when FIREBASE_CONFIG is null.
 *
 * With Firebase, data/products.json and data/menu.json are still used as a fallback
 * until the database has content, and are copied into Firestore automatically the
 * first time an editor signs in to admin.html. See README section 6.
 *
 * Needs a web server (VS Code "Live Server" or any host); browsers block reading
 * JSON files when a page is opened straight from disk.
 */

// Paste the config from Firebase console → Project settings → Your apps → Web app.
// These values are public by design; access is controlled by firestore.rules / storage.rules.
var FIREBASE_CONFIG = null;
/* e.g.
var FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "imagingtech-xxxx.firebaseapp.com",
  projectId: "imagingtech-xxxx",
  storageBucket: "imagingtech-xxxx.firebasestorage.app",
  appId: "1:123:web:abc"
};
*/

(function () {
  if (window.claude) return; // running on Claude: use the real database

  var FIREBASE_VERSION = '10.14.1';

  // ---------- JSON snapshot (fallback + seed source) ----------
  function load(path) {
    return fetch(path, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }
  var productsP = load('data/products.json');
  var menuP = load('data/menu.json');

  function docSnap(id, data) {
    return { id: id, exists: !!data, data: function () { return data || undefined; }, metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function colSnap(map) {
    map = map || {};
    var docs = Object.keys(map).map(function (k) { return docSnap(k, map[k]); });
    return { docs: docs, size: docs.length, empty: !docs.length, docChanges: function () { return []; }, metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function jsonDoc(col, id) {
    if (col === 'site' && id === 'menu') return menuP.then(function (m) { return docSnap(id, m); });
    if (col === 'products') return productsP.then(function (p) { return docSnap(id, p && p[id]); });
    return Promise.resolve(docSnap(id, null));
  }
  function jsonCol(col) {
    return (col === 'products' ? productsP : Promise.resolve(null)).then(colSnap);
  }

  // ---------- 3. read-only JSON mode ----------
  if (!FIREBASE_CONFIG) {
    var readOnly = function () {
      return Promise.reject({ code: 'invalid_argument', message: 'Local data is read-only. Edit the files in /data instead.' });
    };
    var jsonRef = function (path) {
      var parts = path.split('/'), col = parts[0], id = parts[1];
      return {
        id: id, path: path,
        get: function () { return jsonDoc(col, id); },
        onSnapshot: function (next) { jsonDoc(col, id).then(next); return function () {}; },
        set: readOnly, update: readOnly, delete: readOnly
      };
    };
    var jsonDb = {
      doc: jsonRef,
      collection: function (col) {
        return {
          path: col,
          get: function () { return jsonCol(col); },
          onSnapshot: function (next) { jsonCol(col).then(next); return function () {}; },
          doc: function (id) { return jsonRef(col + '/' + id); }
        };
      }
    };
    var jsonUser = { canEdit: function () { return Promise.resolve(false); }, id: function () { return Promise.resolve(null); } };
    window.itImageUrl = function (id) { return '/_blob/' + id; };
    window.claude = {
      use: function (name) { return Promise.resolve(name === 'db' ? jsonDb : name === 'user' ? jsonUser : null); }
    };
    return;
  }

  // ---------- 2. Firebase mode ----------
  var bucket = FIREBASE_CONFIG.storageBucket;
  window.itImageUrl = function (id) {
    return 'https://firebasestorage.googleapis.com/v0/b/' + bucket + '/o/' + encodeURIComponent('uploads/' + id) + '?alt=media';
  };

  function script(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  var base = 'https://www.gstatic.com/firebasejs/' + FIREBASE_VERSION + '/';
  var ready = script(base + 'firebase-app-compat.js').then(function () {
    return Promise.all(['firestore', 'auth', 'storage'].map(function (m) { return script(base + 'firebase-' + m + '-compat.js'); }));
  }).then(function () {
    firebase.initializeApp(FIREBASE_CONFIG);
    return firebase;
  });

  // the first auth state tells us whether someone is signed in
  var authP = ready.then(function (fb) {
    return new Promise(function (res) {
      var off = fb.auth().onAuthStateChanged(function (u) { off(); res(u); });
    });
  });

  // map Firebase error codes onto the codes the pages already handle
  function mapErr(err) {
    var c = (err && err.code) || '';
    var storage = c.indexOf('storage/') === 0;
    if (/permission-denied|unauthenticated|unauthorized/.test(c)) return { code: storage ? 'not_granted' : 'invalid_argument', message: err.message };
    if (/resource-exhausted|quota-exceeded/.test(c)) return { code: storage ? 'quota_or_state' : 'quota_exceeded', message: err.message };
    return err;
  }
  function wrapWrite(p) { return p.catch(function (e) { throw mapErr(e); }); }

  function fsRef(path) {
    var parts = path.split('/'), col = parts[0], id = parts[1];
    var ref = function () { return ready.then(function (fb) { return fb.firestore().doc(path); }); };
    return {
      id: id, path: path,
      get: function () {
        return ref().then(function (r) { return r.get(); }).then(function (s) { return s.exists ? s : jsonDoc(col, id); });
      },
      onSnapshot: function (next, error) {
        var off = null, stopped = false;
        ref().then(function (r) {
          if (stopped) return;
          off = r.onSnapshot(function (s) {
            if (s.exists) next(s); else jsonDoc(col, id).then(next);
          }, error || function () {});
        }, error || function () {});
        return function () { stopped = true; if (off) off(); };
      },
      set: function (data) { return wrapWrite(ref().then(function (r) { return r.set(data); })); },
      update: function (data) { return wrapWrite(ref().then(function (r) { return r.set(data, { merge: true }); })); },
      delete: function () { return wrapWrite(ref().then(function (r) { return r.delete(); })); }
    };
  }
  function fsCol(col) {
    var ref = function () { return ready.then(function (fb) { return fb.firestore().collection(col); }); };
    return {
      path: col,
      get: function () {
        return ref().then(function (r) { return r.get(); }).then(function (s) { return s.empty ? jsonCol(col) : s; });
      },
      onSnapshot: function (next, error) {
        var off = null, stopped = false;
        ref().then(function (r) {
          if (stopped) return;
          off = r.onSnapshot(function (s) {
            if (s.empty) jsonCol(col).then(next); else next(s);
          }, error || function () {});
        }, error || function () {});
        return function () { stopped = true; if (off) off(); };
      },
      doc: function (id) { return fsRef(col + '/' + id); }
    };
  }
  var fsDb = { doc: fsRef, collection: fsCol };

  var fsUser = {
    canEdit: function () { return authP.then(function (u) { return !!u; }); },
    id: function () { return authP.then(function (u) { return u ? u.uid : null; }); }
  };

  function randomId() {
    var a = new Uint8Array(15); crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  var fsAssets = {
    upload: function (blob, opts) {
      var id = randomId(), type = (opts && opts.type) || blob.type || 'image/jpeg';
      if (blob.size > 20 * 1024 * 1024) return Promise.reject({ code: 'too_large' });
      return ready.then(function (fb) {
        return fb.storage().ref('uploads/' + id).put(blob, { contentType: type, cacheControl: 'public, max-age=31536000' });
      }).then(function () { return { id: id, url: window.itImageUrl(id) }; }, function (e) { throw mapErr(e); });
    },
    delete: function (id) {
      return ready.then(function (fb) { return fb.storage().ref('uploads/' + id).delete(); }).catch(function (e) { throw mapErr(e); });
    }
  };

  window.claude = {
    use: function (name) {
      if (name === 'db') return Promise.resolve(fsDb);
      if (name === 'user') return Promise.resolve(fsUser);
      if (name === 'assets') return authP.then(function (u) { return u ? fsAssets : null; });
      return Promise.resolve(null);
    }
  };

  // ---------- admin page: sign-in bar + first-run seeding ----------
  if (!/admin\.html$/.test(location.pathname)) return;

  function seed(fb) {
    var fs = fb.firestore();
    return fs.doc('site/menu').get().then(function (s) {
      if (s.exists) return;
      return Promise.all([menuP, productsP]).then(function (r) {
        var menu = r[0], products = r[1] || {};
        if (!menu) return;
        var batch = fs.batch();
        batch.set(fs.doc('site/menu'), menu);
        Object.keys(products).forEach(function (id) { batch.set(fs.doc('products/' + id), products[id]); });
        return batch.commit().then(function () { console.info('ImagingTech: copied data/*.json into Firestore.'); });
      });
    }).catch(function (e) { console.warn('ImagingTech: could not seed Firestore', e); });
  }

  function bar(user) {
    var b = document.createElement('div');
    b.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;gap:10px;align-items:center;background:#14152A;color:#fff;font:600 13px Inter,sans-serif;padding:10px 14px;border-radius:999px;box-shadow:0 10px 30px rgba(0,0,0,.25);';
    var t = document.createElement('span');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = 'background:#FFC72C;color:#14152A;border:none;border-radius:999px;padding:7px 14px;font:700 13px Sora,Inter,sans-serif;cursor:pointer;';
    if (user) {
      t.textContent = 'Signed in as ' + (user.email || 'editor');
      btn.textContent = 'Sign out';
      btn.onclick = function () { firebase.auth().signOut().then(function () { location.reload(); }); };
    } else {
      t.textContent = 'Sign in to edit products';
      btn.textContent = 'Sign in with Google';
      btn.onclick = function () {
        firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider())
          .then(function () { location.reload(); })
          .catch(function (e) { t.textContent = 'Sign-in failed: ' + (e.code || e.message); });
      };
    }
    b.appendChild(t); b.appendChild(btn);
    document.body.appendChild(b);
  }

  Promise.all([ready, authP]).then(function (r) {
    var user = r[1];
    var show = function () { bar(user); };
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
    if (user) seed(r[0]);
  });
})();
