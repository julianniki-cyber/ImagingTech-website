/*
 * Cart — kept in the visitor's own browser (localStorage), shared by every page.
 *
 *   ITCart.items()          → array of cart lines
 *   ITCart.add(line)        → adds a line (from a product page's Add to Cart)
 *   ITCart.remove(id)       → removes one line
 *   ITCart.clear()          → empties the cart (after an order request is sent)
 *   ITCart.count()          → number of lines
 *   ITCart.subtotal()       → sum of line totals
 *
 * Every element with class "cart-count" shows the count (hidden when empty), and the
 * header's Cart link points to cart.html. Other tabs stay in sync via the storage event.
 */
(function () {
  var KEY = 'itCart.v1';
  var css = document.createElement('style');
  css.textContent = '.cart-count[hidden]{display:none !important;}';
  document.head.appendChild(css);

  function read() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function write(items) {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) {}
    paint();
    document.dispatchEvent(new CustomEvent('itcart:change'));
  }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function paint() {
    var n = read().length;
    document.querySelectorAll('.cart-count').forEach(function (c) {
      c.textContent = n > 99 ? '99+' : String(n);
      c.hidden = n === 0;
    });
    document.querySelectorAll('.cart-count').forEach(function (c) {
      var a = c.closest('a');
      if (a) {
        a.setAttribute('href', 'cart.html');
        a.setAttribute('aria-label', 'Cart, ' + n + ' item' + (n === 1 ? '' : 's'));
      }
    });
  }

  window.ITCart = {
    items: read,
    count: function () { return read().length; },
    subtotal: function () {
      return Math.round(read().reduce(function (s, l) { return s + (Number(l.total) || 0); }, 0) * 100) / 100;
    },
    add: function (line) {
      var items = read();
      line = Object.assign({}, line, { id: uid(), added: Date.now() });
      items.push(line);
      write(items);
      return line;
    },
    remove: function (id) { write(read().filter(function (l) { return l.id !== id; })); },
    clear: function () { write([]); }
  };

  window.addEventListener('storage', function (e) {
    if (e.key === KEY) { paint(); document.dispatchEvent(new CustomEvent('itcart:change')); }
  });
  // header: "Trade sign in" becomes "My account" for signed-in trade customers
  function account() {
    document.querySelectorAll('.header-action').forEach(function (a) {
      var t = a.querySelector('.label-text');
      if (!t || !/trade sign in|my account/i.test(t.textContent)) return;
      a.setAttribute('href', 'account.html');
      if (window.itUser) window.itUser.then(function (u) {
        t.textContent = u ? 'My account' : 'Trade sign in';
        if (u) a.setAttribute('aria-label', 'My account');
      });
    });
  }
  function boot() { paint(); account(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
