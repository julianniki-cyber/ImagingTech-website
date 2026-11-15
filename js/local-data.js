/*
 * Data layer — gives every page the same window.claude.use('db' | 'user' | 'assets')
 * interface it was built against, backed by one of:
 *
 *   1. Claude's built-in database, when the site runs on Claude (this file steps aside).
 *   2. Supabase (database + login + image storage), when SUPABASE_CONFIG below is filled in.
 *      Editors sign in to admin.html with an emailed login link; saves and image
 *      uploads go live for every visitor.
 *   3. The JSON files in data/ (read-only), when SUPABASE_CONFIG is null.
 *
 * With Supabase, data/products.json and data/menu.json are still used as a fallback
 * until the database has content, and are copied into it automatically the first
 * time an editor signs in to admin.html. See README section 6 and supabase.sql.
 *
 * Needs a web server (VS Code "Live Server" or any host); browsers block reading
 * JSON files when a page is opened straight from disk.
 */

// From Supabase dashboard → Project Settings → API. Both values are public by design;
// who can change what is controlled by the policies in supabase.sql.
var SUPABASE_CONFIG = {
  url: "https://xnfnliiasgnumptwjgcg.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuZm5saWlhc2dudW1wdHdqZ2NnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxNzYzMzUsImV4cCI6MjA5ODc1MjMzNX0.emJkaa0gnIIx-dcbwqS3avWOH-KoX4TqaEn9XFXmSlE"
};

(function () {
  if (window.claude) return; // running on Claude: use the real database

  var SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
  var BUCKET = 'uploads';

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
  if (!SUPABASE_CONFIG) {
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
    window.itUser = Promise.resolve(null);
    window.claude = {
      use: function (name) { return Promise.resolve(name === 'db' ? jsonDb : name === 'user' ? jsonUser : null); }
    };
    return;
  }

  // ---------- 2. Supabase mode ----------
  var base = SUPABASE_CONFIG.url.replace(/\/+$/, '');
  window.itImageUrl = function (id) { return base + '/storage/v1/object/public/' + BUCKET + '/' + encodeURIComponent(id); };

  var ready = new Promise(function (res, rej) {
    var s = document.createElement('script');
    s.src = SUPABASE_JS; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  }).then(function () {
    return window.supabase.createClient(base, SUPABASE_CONFIG.anonKey);
  });
  window.itSupabase = ready; // used by cart.html to send order requests

  // getSession waits for a login link in the URL to be processed
  var authP = ready.then(function (sb) {
    return sb.auth.getSession().then(function (r) { return (r.data && r.data.session && r.data.session.user) || null; });
  }).catch(function () { return null; });
  window.itUser = authP; // signed-in Supabase user (or null) for trade accounts, cart and header
  var editorWhy = '';
  var editorP = authP.then(function (u) {
    if (!u) return false;
    return ready.then(function (sb) { return sb.rpc('is_editor'); }).then(function (r) {
      if (r.error) { editorWhy = r.error.message || r.error.code || 'check failed'; console.warn('ImagingTech: editor check failed', r.error); }
      else if (r.data !== true) editorWhy = 'database answered ' + JSON.stringify(r.data);
      return !r.error && r.data === true;
    });
  }).catch(function (e) { editorWhy = (e && e.message) || 'check failed'; return false; });

  // map Supabase / Postgres errors onto the codes the pages already handle
  function mapErr(err) {
    var c = String((err && (err.code || err.statusCode || err.status)) || ''), m = String((err && err.message) || '');
    if (c === '42501' || c === '401' || c === '403' || /row-level security|permission|unauthori[sz]ed/i.test(m)) return { code: 'invalid_argument', message: m };
    if (c === '413' || /too large|exceeded the maximum/i.test(m)) return { code: 'too_large', message: m };
    if (/mime|content type/i.test(m)) return { code: 'unsupported_type', message: m };
    return err || { code: 'unknown' };
  }
  function check(r) { if (r.error) throw mapErr(r.error); return r; }

  // one realtime channel shared by every listener on the page
  var listeners = [];
  var channelP = null;
  function listen(fn) {
    listeners.push(fn);
    if (!channelP) channelP = ready.then(function (sb) {
      return sb.channel('docs-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, function (p) {
          var row = (p.new && p.new.collection) ? p.new : p.old;
          listeners.slice().forEach(function (l) { l(row || {}); });
        })
        .subscribe();
    });
    return function () { listeners = listeners.filter(function (l) { return l !== fn; }); };
  }

  function fetchDoc(col, id) {
    return ready.then(function (sb) {
      return sb.from('docs').select('data').eq('collection', col).eq('id', id).maybeSingle();
    }).then(check).then(function (r) {
      return r.data ? docSnap(id, r.data.data) : jsonDoc(col, id);
    });
  }
  function fetchCol(col) {
    return ready.then(function (sb) {
      return sb.from('docs').select('id,data').eq('collection', col);
    }).then(check).then(function (r) {
      if (!r.data || !r.data.length) return jsonCol(col);
      var map = {};
      r.data.forEach(function (row) { map[row.id] = row.data; });
      return colSnap(map);
    });
  }

  function sbRef(path) {
    var parts = path.split('/'), col = parts[0], id = parts[1];
    return {
      id: id, path: path,
      get: function () { return fetchDoc(col, id); },
      onSnapshot: function (next, error) {
        var pull = function () { fetchDoc(col, id).then(next, error || function () {}); };
        pull();
        return listen(function (row) { if (row.collection === col && (!row.id || row.id === id)) pull(); });
      },
      set: function (data) {
        return ready.then(function (sb) {
          return sb.from('docs').upsert({ collection: col, id: id, data: data, updated_at: new Date().toISOString() });
        }).then(check).then(function () {});
      },
      update: function (data) {
        return fetchDoc(col, id).then(function (s) {
          return sbRef(path).set(Object.assign({}, s.data() || {}, data));
        });
      },
      delete: function () {
        return ready.then(function (sb) {
          return sb.from('docs').delete().eq('collection', col).eq('id', id).select('id');
        }).then(check).then(function (r) {
          // row-level security makes a forbidden delete silently match nothing
          if (!r.data || !r.data.length) return editorP.then(function (ok) { if (!ok) throw { code: 'invalid_argument' }; });
        });
      }
    };
  }
  function sbCol(col) {
    return {
      path: col,
      get: function () { return fetchCol(col); },
      onSnapshot: function (next, error) {
        var pull = function () { fetchCol(col).then(next, error || function () {}); };
        pull();
        return listen(function (row) { if (row.collection === col) pull(); });
      },
      doc: function (id) { return sbRef(col + '/' + id); }
    };
  }
  var sbDb = { doc: sbRef, collection: sbCol };

  var sbUser = {
    canEdit: function () { return editorP; },
    id: function () { return authP.then(function (u) { return u ? u.id : null; }); }
  };

  function randomId() {
    var a = new Uint8Array(15); crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  var sbAssets = {
    upload: function (blob, opts) {
      var id = randomId(), type = (opts && opts.type) || blob.type || 'image/jpeg';
      if (blob.size > 20 * 1024 * 1024) return Promise.reject({ code: 'too_large' });
      return ready.then(function (sb) {
        return sb.storage.from(BUCKET).upload(id, blob, { contentType: type, cacheControl: '31536000', upsert: false });
      }).then(check).then(function () { return { id: id, url: window.itImageUrl(id) }; });
    },
    delete: function (id) {
      return ready.then(function (sb) { return sb.storage.from(BUCKET).remove([id]); }).then(check);
    }
  };

  window.claude = {
    use: function (name) {
      if (name === 'db') return Promise.resolve(sbDb);
      if (name === 'user') return Promise.resolve(sbUser);
      if (name === 'assets') return editorP.then(function (ok) { return ok ? sbAssets : null; });
      return Promise.resolve(null);
    }
  };

  // ---------- admin page: login bar + first-run seeding ----------
  if (!/admin\.html$/.test(location.pathname)) return;

  var seedWhy = '';
  function seed(sb) {
    return sb.from('docs').select('id').eq('collection', 'site').eq('id', 'menu').maybeSingle().then(check).then(function (r) {
      if (r.data) return;
      return Promise.all([menuP, productsP]).then(function (j) {
        var menu = j[0], products = j[1] || {};
        if (!menu) return;
        var rows = [{ collection: 'site', id: 'menu', data: menu }];
        Object.keys(products).forEach(function (id) { rows.push({ collection: 'products', id: id, data: products[id] }); });
        return sb.from('docs').upsert(rows).then(check).then(function () {
          console.info('ImagingTech: copied data/*.json into Supabase.');
        });
      });
    }).catch(function (e) {
      console.warn('ImagingTech: could not seed Supabase', e);
      seedWhy = 'Could not copy products into the database: ' + ((e && e.message) || (e && e.code) || 'unknown error');
    });
  }

  function bar(sb, user, isEditor) {
    var b = document.createElement('form');
    b.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;gap:10px;align-items:center;flex-wrap:wrap;max-width:calc(100vw - 32px);background:#14152A;color:#fff;font:600 13px Inter,sans-serif;padding:10px 14px;border-radius:22px;box-shadow:0 10px 30px rgba(0,0,0,.25);';
    var t = document.createElement('span');
    var btn = document.createElement('button');
    btn.type = 'submit';
    btn.style.cssText = 'background:#FFC72C;color:#14152A;border:none;border-radius:999px;padding:7px 14px;font:700 13px Sora,Inter,sans-serif;cursor:pointer;';
    b.appendChild(t);
    if (user) {
      t.textContent = 'Signed in as ' + (user.email || 'editor') + (isEditor ? '' : ' (not an editor: ' + editorWhy + ')');
      btn.textContent = 'Sign out';
      b.onsubmit = function (e) { e.preventDefault(); sb.auth.signOut().then(function () { location.reload(); }); };
    } else {
      t.textContent = 'Editors:';
      var inp = document.createElement('input');
      inp.type = 'email'; inp.required = true; inp.placeholder = 'Your email'; inp.setAttribute('aria-label', 'Email address');
      inp.style.cssText = 'border:none;border-radius:999px;padding:7px 12px;font:500 13px Inter,sans-serif;min-width:180px;';
      b.appendChild(inp);
      btn.textContent = 'Email me a login link';
      b.onsubmit = function (e) {
        e.preventDefault();
        btn.disabled = true;
        sb.auth.signInWithOtp({ email: inp.value.trim(), options: { emailRedirectTo: location.href.split('#')[0] } }).then(function (r) {
          if (r.error) { t.textContent = 'Could not send: ' + r.error.message; btn.disabled = false; return; }
          inp.remove(); btn.remove();
          t.textContent = 'Check your inbox and open the login link.';
        });
      };
    }
    b.appendChild(btn);
    document.body.appendChild(b);
  }

  Promise.all([ready, authP, editorP]).then(function (r) {
    var sb = r[0], user = r[1], isEditor = r[2];
    var show = function () { bar(sb, user, isEditor); };
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
    if (isEditor) seed(sb).then(function () {
      if (!seedWhy) return;
      var n = document.createElement('div');
      n.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:9999;max-width:min(520px,calc(100vw - 32px));background:#E91E63;color:#fff;font:600 13px Inter,sans-serif;padding:10px 14px;border-radius:12px;';
      n.textContent = seedWhy;
      document.body.appendChild(n);
    });
  });
})();
