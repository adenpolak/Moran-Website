/* Shared pricing rules. The storefront (inlined at build) and api/checkout.js both use this file,
   so the server always re-prices an order from catalog.json and never trusts prices sent by a browser. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Pricing = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, '').toUpperCase(); }

  function findChoice(opt, v) {
    return opt.choices.find(function (c) { return c.id === v; }) || opt.choices[0];
  }

  function findProduct(catalog, id) {
    return catalog.products.find(function (p) { return p.id === id; });
  }

  // Price of one unit of a product with the given option values.
  function unitPrice(product, options) {
    options = options || {};
    var base = product.price || 0;
    (product.options || []).forEach(function (opt) {
      var v = options[opt.id];
      if (opt.type === 'size') {
        base = findChoice(opt, v).price;
      } else if (opt.type === 'choice') {
        base += findChoice(opt, v).delta || 0;
      } else if (opt.type === 'text') {
        var t = clean(v);
        if (opt.charPrices) {
          var n = Math.min(Math.max(t.length, 1), opt.maxLength);
          base += opt.charPrices[String(n)] || 0;
        } else if (opt.priceIfFilled && t.length) {
          base += opt.priceIfFilled;
        }
      }
    });
    return base;
  }

  // One-line summary of the chosen options, e.g. "50 · Gold & crown · Pistachio · gold topper".
  function describe(product, options) {
    options = options || {};
    var parts = [];
    (product.options || []).forEach(function (opt) {
      var v = options[opt.id];
      if (opt.type === 'text') {
        var t = clean(v);
        if (t) parts.push(opt.short ? opt.short + ' ' + t : t);
      } else {
        var c = findChoice(opt, v);
        parts.push(c.short || c.label);
      }
    });
    return parts.join(' · ');
  }

  // Returns an error message, or null when the options are valid.
  function validate(product, options) {
    options = options || {};
    var opts = product.options || [];
    for (var i = 0; i < opts.length; i++) {
      var opt = opts[i];
      var v = options[opt.id];
      if (opt.type === 'text') {
        var t = clean(v);
        if (opt.required && !t) return opt.label + ' is required.';
        if (t.length > opt.maxLength) return opt.label + ': ' + opt.maxLength + ' characters max.';
        if (t && opt.pattern && !(new RegExp('^' + opt.pattern + '$')).test(t)) {
          return opt.label + ': ' + (opt.patternHint || 'letters and numbers only') + '.';
        }
      } else if (!opt.choices.some(function (c) { return c.id === v; })) {
        return 'Pick a ' + opt.label.toLowerCase() + '.';
      }
    }
    return null;
  }

  function clampQty(q) { q = parseInt(q, 10); if (!(q > 0)) q = 1; return Math.min(q, 20); }

  // Line items, subtotal, delivery fee and total for a list of {productId, options, qty}.
  function totals(catalog, items, method) {
    var lines = [], subtotal = 0;
    (items || []).forEach(function (it) {
      var p = findProduct(catalog, it.productId);
      if (!p) return;
      var unit = unitPrice(p, it.options), qty = clampQty(it.qty);
      lines.push({ product: p, item: it, unit: unit, qty: qty, amount: unit * qty, summary: describe(p, it.options) });
      subtotal += unit * qty;
    });
    var d = catalog.fulfillment.delivery;
    var deliveryFee = method === 'delivery' ? (subtotal >= d.freeOver ? 0 : d.fee) : 0;
    return { lines: lines, subtotal: subtotal, deliveryFee: deliveryFee, total: subtotal + deliveryFee };
  }

  // Longest lead time in the box, in days.
  function leadDays(catalog, items) {
    return (items || []).reduce(function (m, it) {
      var p = findProduct(catalog, it.productId);
      return Math.max(m, p ? p.leadDays : 0);
    }, 0);
  }

  return { clean: clean, unitPrice: unitPrice, describe: describe, validate: validate, totals: totals, leadDays: leadDays, clampQty: clampQty, findProduct: findProduct };
});
