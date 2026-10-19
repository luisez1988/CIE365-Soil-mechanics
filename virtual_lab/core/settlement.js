/* VLab.Settle — 1D primary-consolidation settlement of a layered soil column,
   in any consistent unit system (m, kPa, kN/m³ or ft, psf, pcf). No DOM code.

   layers (top to bottom): { name, type: 'fine' | 'coarse', H, g (above the water
     table), gs (saturated), and for fine layers e0, Cc, Cr, hist: 'ocr' | 'pop', ocr, pop }
   Coarse layers are treated as incompressible; only fine layers settle.

   Per sub-layer (H, σ'0, σ'p, σ'f = σ'0 + Δσ), as in class:
     NC  (σ'p = σ'0)        δ = H/(1+e0) · Cc log(σ'f/σ'0)
     OC  σ'f ≤ σ'p          δ = H/(1+e0) · Cr log(σ'f/σ'0)
     OC  σ'f >  σ'p         δ = H/(1+e0) · [Cr log(σ'p/σ'0) + Cc log(σ'f/σ'p)]
     unloading (Δσ < 0)     δ = H/(1+e0) · Cr log(σ'f/σ'0)   (negative: heave) */
(function (VLab) {
  'use strict';

  /* Profile: geometry and in-situ stresses. */
  function profile(layers, gwt, gw) {
    var tops = [], z = 0;
    layers.forEach(function (L) { tops.push(z); z += L.H; });
    var P = { layers: layers, gwt: gwt, gw: gw, tops: tops, D: z };

    P.index = function (zz) {
      for (var k = layers.length - 1; k >= 0; k--) if (zz >= tops[k] - 1e-12) return k;
      return 0;
    };
    /* total vertical stress: integrate unit weights, γ above the water table, γsat below */
    P.sv = function (zz) {
      var s = 0;
      for (var k = 0; k < layers.length; k++) {
        var a = tops[k], b = Math.min(a + layers[k].H, zz);
        if (b <= a) break;
        var dry = Math.max(0, Math.min(b, gwt) - a), wet = (b - a) - dry;
        s += dry * layers[k].g + wet * layers[k].gs;
      }
      return s;
    };
    P.u0 = function (zz) { return gw * Math.max(0, zz - gwt); };
    P.s0 = function (zz) { return P.sv(zz) - P.u0(zz); };
    P.sp = function (zz) {
      var L = layers[P.index(zz)];
      if (L.type !== 'fine') return NaN;
      return L.hist === 'pop' ? P.s0(zz) + L.pop : P.s0(zz) * Math.max(1, L.ocr);
    };
    return P;
  }

  function subSettle(L, H, s0, sp, ds) {
    var k = H / (1 + L.e0), sf = s0 + ds, cs, d;
    if (ds < 0) {
      cs = 'heave';
      if (sf < 0.01 * s0) { sf = 0.01 * s0; cs = 'heave*'; }
      d = k * L.Cr * Math.log10(sf / s0);
    } else if (sp <= s0 * (1 + 1e-9)) { cs = 'NC'; d = k * L.Cc * Math.log10(sf / s0); }
    else if (sf <= sp) { cs = 'OC-a'; d = k * L.Cr * Math.log10(sf / s0); }
    else { cs = 'OC-b'; d = k * (L.Cr * Math.log10(sp / s0) + L.Cc * Math.log10(sf / sp)); }
    return { sf: sf, cs: cs, d: d };
  }

  /* One vertical column. dsAt(z) is the stress increment at depth z.
     nsub sub-layers per fine layer. Returns sub-layers, layer totals, the total
     and the vertical displacement at every layer interface (bottom fixed). */
  function column(P, dsAt, nsub) {
    var subs = [], per = P.layers.map(function () { return { d: 0, n: 0, cases: {} }; });
    P.layers.forEach(function (L, k) {
      if (L.type !== 'fine' || L.H <= 0) return;
      var h = L.H / nsub;
      for (var i = 0; i < nsub; i++) {
        var zt = P.tops[k] + i * h, z = zt + h / 2, s0 = P.s0(z);
        if (!(s0 > 0)) continue;
        var sp = P.sp(z), ds = dsAt(z), r = subSettle(L, h, s0, sp, ds);
        subs.push({ layer: k, ztop: zt, zbot: zt + h, z: z, H: h, s0: s0, sp: sp, ds: ds, sf: r.sf, cs: r.cs, d: r.d });
        per[k].d += r.d; per[k].n++; per[k].cases[r.cs] = (per[k].cases[r.cs] || 0) + 1;
      }
    });
    var total = 0;
    per.forEach(function (p) { total += p.d; });
    /* displacement of each interface: sum of the settlement of everything below it */
    var wInt = [], acc = 0;
    for (var k = P.layers.length; k >= 0; k--) {
      wInt[k] = acc;
      if (k > 0) acc += per[k - 1].d;
    }
    return { subs: subs, per: per, total: total, wInt: wInt,
      w: function (z) {   /* displacement at depth z, linear inside a sub-layer */
        var s = 0;
        subs.forEach(function (q) {
          if (q.zbot <= z) return;
          s += q.ztop >= z ? q.d : q.d * (q.zbot - z) / q.H;
        });
        return s;
      } };
  }

  /* ---------- self test (console: VLab.Settle.selfTest()) ---------- */
  function selfTest() {
    var out = [], ok = true;
    function check(name, cond, info) { out.push((cond ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); ok = ok && cond; }
    /* Example 7.4 (US units): 25 ft CH clay, WT at surface, strip q = 6000 psf, B = 15 ft */
    var clay = { type: 'fine', H: 25, g: 125, gs: 125, e0: 0.95, Cc: 0.33, Cr: 0.04, hist: 'ocr', ocr: 1.5 };
    var P = profile([clay], 0, 62.4);
    function strip(z) { var a = Math.atan(7.5 / z); return 6000 * 2 / Math.PI * (a + Math.sin(a) * Math.cos(a)); }
    var c1 = column(P, strip, 1), c10 = column(P, strip, 10);
    check('Example 7.4 (a) single layer', Math.abs(c1.total - 2.5725) < 5e-4, c1.total.toFixed(4) + ' ft (2.5725)');
    check('Example 7.4 (b) 10 sub-layers', Math.abs(c10.total - 3.134) < 5e-3, c10.total.toFixed(4) + ' ft (3.13)');
    check('Example 7.4 (b) sub-layer 1', Math.abs(c10.subs[0].d - 0.7339) < 5e-4, c10.subs[0].d.toFixed(4) + ' ft (0.734)');
    /* sand over OC clay, case a, by hand */
    var P2 = profile([{ type: 'coarse', H: 2, g: 18, gs: 20 },
      { type: 'fine', H: 4, g: 19, gs: 19, e0: 1, Cc: 0.4, Cr: 0.05, hist: 'ocr', ocr: 2 }], 2, 9.81);
    var c2 = column(P2, function () { return 50; }, 1), s0 = 36 + 2 * (19 - 9.81);
    var hand = 4 / 2 * 0.05 * Math.log10((s0 + 50) / s0);
    check('OC case a by hand', Math.abs(c2.total - hand) < 1e-12 && c2.subs[0].cs === 'OC-a', c2.total.toFixed(5) + ' m');
    check('coarse layer does not settle', c2.per[0].d === 0 && c2.per[0].n === 0);
    check('surface displacement = total', Math.abs(c2.wInt[0] - c2.total) < 1e-12 && c2.wInt[2] === 0);
    var c3 = column(P2, function () { return 200; }, 1);
    check('OC case b', c3.subs[0].cs === 'OC-b' && c3.total > c2.total);
    var c4 = column(P2, function () { return -20; }, 1);
    check('unloading heaves', c4.total < 0 && c4.subs[0].cs === 'heave');
    return { ok: ok, lines: out };
  }

  VLab.Settle = { profile: profile, column: column, selfTest: selfTest };
})(window.VLab = window.VLab || {});
