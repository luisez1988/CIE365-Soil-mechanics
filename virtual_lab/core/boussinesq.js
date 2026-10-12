/* VLab.Boussinesq — vertical stress increment Δσz beneath loads on the surface
   of a homogeneous, isotropic, elastic half-space (Boussinesq, 1885) and the
   closed forms obtained by integrating it over lines and areas.

   Coordinates: plan (x, y), depth z >= 0 downward. A load is a plain object
     { type: 'point' | 'line' | 'strip' | 'rect' | 'tri' | 'circle',
       q,                 signed: Q (kN) point, q (kN/m) line, q (kPa) areas,
                          q_max (kPa) at the +B/2 edge for the triangular load
       cx, cy,            centre (m)
       angle,             degrees, counter-clockwise from the x axis
       B, L,              width along local x', length along local y' (m)
       r,                 radius (m), circle only
       inf }              line / strip / tri: infinitely long along y'
   Negative q is unloading (an excavation); superposition is linear.

   All functions return Δσz in kPa. influence() returns the deck's influence
   factor for one load: I = Δσz z²/Q (point), Δσz/q in 1/m (line) or
   I' = Δσz/q (areas). */
(function (VLab) {
  'use strict';

  var PI = Math.PI, TWO_PI = 2 * Math.PI;
  var TRI_SLICES = 48, CIRCLE_STEPS = 128;

  /* Load frame: x' across (B), y' along (L). */
  function local(ld, x, y) {
    var a = (ld.angle || 0) * PI / 180, c = Math.cos(a), s = Math.sin(a);
    var dx = x - ld.cx, dy = y - ld.cy;
    return { u: dx * c + dy * s, v: -dx * s + dy * c };
  }

  /* ---------- unit-load kernels in the load frame ---------- */

  function point(r2, z) {
    if (z <= 0) return 0;
    var R2 = r2 + z * z;
    return 3 * z * z * z / (TWO_PI * R2 * R2 * Math.sqrt(R2));
  }

  /* Line along v from v1 to v2 at horizontal offset u. */
  function lineSeg(u, v1, v2, z) {
    if (z <= 0) return 0;
    var a2 = u * u + z * z;
    function F(s) { var t = s * s + a2; return s * (2 * s * s + 3 * a2) / (3 * a2 * a2 * t * Math.sqrt(t)); }
    return 3 * z * z * z / TWO_PI * (F(v2) - F(v1));
  }

  function lineInf(u, z) {
    if (z <= 0) return 0;
    var a2 = u * u + z * z;
    return 2 * z * z * z / (PI * a2 * a2);
  }

  /* Corner of a uniformly loaded a x b rectangle (deck form, atan2 keeps z = 0). */
  function corner(a, b, z) {
    if (a === 0 || b === 0) return 0;
    var sg = (a < 0) !== (b < 0) ? -1 : 1;
    a = Math.abs(a); b = Math.abs(b);
    var R3 = Math.sqrt(a * a + b * b + z * z), t1 = Math.atan2(a * b, z * R3);
    var t2 = z > 0 ? a * b * z / R3 * (1 / (a * a + z * z) + 1 / (b * b + z * z)) : 0;
    return sg * (t1 + t2) / TWO_PI;
  }

  /* Uniform rectangle [u1,u2] x [v1,v2] (already relative to the point). */
  function rect(u1, u2, v1, v2, z) {
    return corner(u2, v2, z) - corner(u1, v2, z) - corner(u2, v1, z) + corner(u1, v1, z);
  }

  /* Infinite uniform strip, edges at u1 < u2 relative to the point:
     (1/π)[atan(w/z) + wz/(w²+z²)] between the edges, i.e. (1/π)[α + sin α cos(α+2β)]. */
  function G(w, z) { var d = w * w + z * z; return Math.atan2(w, z) + (d > 0 ? w * z / d : 0); }
  function stripInf(u1, u2, z) { return (G(u2, z) - G(u1, z)) / PI; }

  /* Infinite strip, load rising linearly from 0 at u0 to 1 at u0 + B
     (u relative to the point). Equivalent to the deck's (1/π)[(x/B)α − ½ sin 2β]. */
  function triInf(u0, B, z) {
    var c = -u0;  /* distance from the zero edge to the point */
    function H(w) { var d = w * w + z * z; return c * G(w, z) + (d > 0 ? z * z * z / d : 0); }
    return (H(c) - H(c - B)) / (PI * B);
  }

  /* Uniform disk radius a, point at radial distance r: polar integration about
     the point, ρ-integral exact, θ-integral by the midpoint rule. */
  function disk(r, a, z) {
    if (z <= 0) return r < a ? 1 : r === a ? 0.5 : 0;
    var z3 = z * z * z, n = CIRCLE_STEPS, sum = 0, k, th, ct, st, root, p;
    function K(rho) { var t = rho * rho + z * z; return z3 / (t * Math.sqrt(t)); }
    if (r < 1e-12) return 1 - K(a);
    if (r < a) {
      for (k = 0; k < n; k++) {
        th = (k + 0.5) * TWO_PI / n; ct = Math.cos(th); st = Math.sin(th);
        root = Math.sqrt(a * a - r * r * st * st);
        sum += 1 - K(-r * ct + root);
      }
      return sum / n;
    }
    /* outside: rays within ±θm of the direction to the centre cut the disk twice */
    var thm = Math.asin(Math.min(1, a / r)), h = 2 * thm / n;
    for (k = 0; k < n; k++) {
      th = -thm + (k + 0.5) * h; ct = Math.cos(th); st = Math.sin(th);
      root = Math.sqrt(Math.max(0, a * a - r * r * st * st));
      p = r * ct;
      sum += K(p - root) - K(p + root);
    }
    return sum * h / TWO_PI;
  }

  /* ---------- per-load evaluation ---------- */

  /* Δσz per unit q for one load at (x, y, z). */
  function unit(ld, x, y, z) {
    var p = local(ld, x, y), u = p.u, v = p.v, hb = ld.B / 2, hl = ld.L / 2;
    switch (ld.type) {
      case 'point': return point(u * u + v * v, z);
      case 'line': return ld.inf ? lineInf(u, z) : lineSeg(u, -hl - v, hl - v, z);
      case 'strip':
      case 'rect':
        if (ld.inf && ld.type === 'strip') return stripInf(-hb - u, hb - u, z);
        return rect(-hb - u, hb - u, -hl - v, hl - v, z);
      case 'tri':
        if (ld.inf) return triInf(-hb - u, ld.B, z);
        var s = 0, w = ld.B / TRI_SLICES;
        for (var k = 0; k < TRI_SLICES; k++) {
          var ua = -hb + k * w;
          s += (k + 0.5) / TRI_SLICES * rect(ua - u, ua + w - u, -hl - v, hl - v, z);
        }
        return s;
      case 'circle': return disk(Math.sqrt(u * u + v * v), ld.r, z);
    }
    return 0;
  }

  function stress(ld, x, y, z) { return ld.q * unit(ld, x, y, z); }

  function total(loads, x, y, z) {
    var s = 0;
    for (var k = 0; k < loads.length; k++) s += loads[k].q * unit(loads[k], x, y, z);
    return s;
  }

  /* Influence factor as defined in the deck (independent of q). */
  function influence(ld, x, y, z) {
    var I = unit(ld, x, y, z);
    return ld.type === 'point' ? I * z * z : I;
  }

  function influenceUnit(type) {
    return type === 'line' ? '1/m' : '–';
  }

  /* Point and line loads are singular at the surface. */
  function singular(ld) { return ld.type === 'point' || ld.type === 'line'; }

  /* ---------- checks against the deck (run in the console) ---------- */
  function selfTest() {
    var out = [], ok = true;
    function chk(name, got, want, tol) {
      var pass = Math.abs(got - want) <= tol * Math.max(1, Math.abs(want));
      ok = ok && pass;
      out.push((pass ? 'ok   ' : 'FAIL ') + name + ': ' + got.toFixed(4) + ' (expected ' + want.toFixed(4) + ')');
    }
    var sq = { type: 'rect', q: 16, cx: 0, cy: 0, angle: 0, B: 2.5, L: 2.5 };
    chk('Ex 6.3 centre A (kPa)', stress(sq, 0, 0, 2), 7.19, 0.002);
    chk('Ex 6.3 mid-edge B (kPa)', stress(sq, 1.25, 0, 2), 4.74, 0.002);
    chk('Ex 6.3 point load at A (kPa)', stress({ type: 'point', q: 100, cx: 0, cy: 0 }, 0, 0, 2), 11.94, 0.002);
    chk('rotated square = square', stress({ type: 'rect', q: 16, cx: 0, cy: 0, angle: 90, B: 2.5, L: 2.5 }, 1.25, 0, 2), 4.74, 0.002);
    chk('long line -> infinite line', unit({ type: 'line', cx: 0, cy: 0, L: 4000 }, 1.5, 0, 3),
      unit({ type: 'line', cx: 0, cy: 0, inf: true }, 1.5, 0, 3), 1e-6);
    chk('long rectangle -> infinite strip', unit({ type: 'rect', cx: 0, cy: 0, B: 3, L: 4000 }, 2, 0, 2.5),
      unit({ type: 'strip', cx: 0, cy: 0, B: 3, inf: true }, 2, 0, 2.5), 1e-5);
    chk('strip centre, z = B/2 (0.818)', unit({ type: 'strip', cx: 0, cy: 0, B: 2, inf: true }, 0, 0, 1), 0.8183, 1e-3);
    var t = { type: 'tri', cx: 0, cy: 0, B: 4, L: 4000 }, ti = { type: 'tri', cx: 0, cy: 0, B: 4, inf: true };
    chk('finite tri -> infinite tri', unit(t, 0.7, 0, 2), unit(ti, 0.7, 0, 2), 1e-3);
    chk('tri + mirrored tri = strip', unit(ti, 0.7, 0, 2) + unit({ type: 'tri', cx: 0, cy: 0, B: 4, inf: true, angle: 180 }, 0.7, 0, 2),
      unit({ type: 'strip', cx: 0, cy: 0, B: 4, inf: true }, 0.7, 0, 2), 1e-9);
    chk('circle axis', unit({ type: 'circle', cx: 0, cy: 0, r: 2 }, 0, 0, 3), 1 - Math.pow(1 / (1 + 4 / 9), 1.5), 1e-9);
    chk('circle off-axis continuity at edge', unit({ type: 'circle', cx: 0, cy: 0, r: 2 }, 1.999999, 0, 1.5),
      unit({ type: 'circle', cx: 0, cy: 0, r: 2 }, 2.000001, 0, 1.5), 1e-4);
    chk('circle far field -> point load (x1000)', 1000 * unit({ type: 'circle', cx: 0, cy: 0, r: 0.5 }, 6, 0, 4),
      1000 * point(36, 4) * PI * 0.25, 0.01);
    chk('surface under a rectangle = q', stress(sq, 0.3, 0.2, 0), 16, 1e-9);
    if (window.console) window.console.log(out.join('\n'));
    return ok;
  }

  VLab.Boussinesq = {
    unit: unit, stress: stress, total: total, influence: influence, influenceUnit: influenceUnit,
    singular: singular, local: local, selfTest: selfTest,
    kernels: { point: point, lineSeg: lineSeg, lineInf: lineInf, corner: corner, rect: rect,
               stripInf: stripInf, triInf: triInf, disk: disk }
  };
})(window.VLab = window.VLab || {});
