/* VLab.contour — marching squares on a rectilinear grid.
   f[j*nx+i] sampled at (xs[i], zs[j]). Returns a flat array of segments
   [xa, za, xb, zb, ...] in world coordinates. skipCell(i, j) lets a caller
   drop cells that straddle a discontinuity (e.g. a sheet pile). */
(function (VLab) {
  'use strict';

  function contour(f, nx, nz, xs, zs, level, skipCell) {
    var out = [], pts = new Array(8), i, j;
    for (j = 0; j < nz - 1; j++) {
      for (i = 0; i < nx - 1; i++) {
        if (skipCell && skipCell(i, j)) continue;
        var k = j * nx + i;
        var a = f[k], b = f[k + 1], c = f[k + nx + 1], d = f[k + nx];
        var sa = a >= level, sb = b >= level, sc = c >= level, sd = d >= level;
        if (sa === sb && sb === sc && sc === sd) continue;
        var x0 = xs[i], x1 = xs[i + 1], z0 = zs[j], z1 = zs[j + 1], n = 0;
        /* edges in order: top a-b, right b-c, bottom d-c, left a-d */
        var e = [null, null, null, null];
        if (sa !== sb) e[0] = [x0 + (x1 - x0) * (level - a) / (b - a), z0];
        if (sb !== sc) e[1] = [x1, z0 + (z1 - z0) * (level - b) / (c - b)];
        if (sd !== sc) e[2] = [x0 + (x1 - x0) * (level - d) / (c - d), z1];
        if (sa !== sd) e[3] = [x0, z0 + (z1 - z0) * (level - a) / (d - a)];
        var hits = [];
        for (n = 0; n < 4; n++) if (e[n]) hits.push(n);
        if (hits.length === 2) {
          push(out, e[hits[0]], e[hits[1]]);
        } else if (hits.length === 4) {
          /* saddle: resolve with the cell-centre value */
          var sm = (a + b + c + d) / 4 >= level;
          if (sm === sa) { push(out, e[0], e[1]); push(out, e[2], e[3]); }
          else { push(out, e[0], e[3]); push(out, e[1], e[2]); }
        }
      }
    }
    return out;
  }

  function push(out, p, q) { out.push(p[0], p[1], q[0], q[1]); }

  VLab.contour = contour;
})(window.VLab = window.VLab || {});
