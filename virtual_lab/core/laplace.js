/* VLab.Laplace — steady seepage on a VLab.Grid2D.
   solve():          SOR on the conductance stencil, sum c*(h_nb - h) = 0 at free nodes.
   Direct:           banded-Cholesky solver of the same system (fast for repeated solves).
   fluxes():         Darcy discharge through every face (per unit thickness).
   boundaryFlux():   what each fixed-head node feeds into the domain.
   streamFunction(): psi on the dual grid (control-volume corners), built by
                     integrating face fluxes, so psi is exactly conservative and
                     constant along every no-flow face (walls, impermeable edges). */
(function (VLab) {
  'use strict';

  function solve(g, h, opt) {
    opt = opt || {};
    var nx = g.nx, nz = g.nz, cx = g.cx, cz = g.cz, fixed = g.fixed, val = g.value;
    var omega = opt.omega || 2 / (1 + Math.sin(Math.PI / Math.max(nx, nz)));
    var tol = opt.tol || 1e-9, maxIter = opt.maxIter || 20000;
    var k, i, j, it, s, w, c, d, maxd = 0;
    for (k = 0; k < g.n; k++) if (fixed[k]) h[k] = val[k];
    for (it = 1; it <= maxIter; it++) {
      maxd = 0;
      for (j = 0; j < nz; j++) {
        for (i = 0; i < nx; i++) {
          k = j * nx + i;
          if (fixed[k]) continue;
          s = 0; w = 0;
          if (i > 0)      { c = cx[j * (nx - 1) + i - 1]; s += c * h[k - 1];  w += c; }
          if (i < nx - 1) { c = cx[j * (nx - 1) + i];     s += c * h[k + 1];  w += c; }
          if (j > 0)      { c = cz[(j - 1) * nx + i];     s += c * h[k - nx]; w += c; }
          if (j < nz - 1) { c = cz[j * nx + i];           s += c * h[k + nx]; w += c; }
          if (w > 0) {
            d = s / w - h[k];
            h[k] += omega * d;
            if (d < 0) d = -d;
            if (d > maxd) maxd = d;
          }
        }
      }
      if (maxd < tol) break;
    }
    return { iterations: Math.min(it, maxIter), change: maxd };
  }

  /* Direct solver: banded Cholesky of the same stencil (bandwidth nx).
     The matrix depends only on the conductances and on WHICH nodes are fixed,
     not on the fixed values, so factor() runs when BC types change and every
     head-slider move is just a forward/back substitution (a few ms).
     Fixed nodes become identity rows, decoupled from the free ones, which
     keeps the matrix symmetric positive definite. */
  function Direct(g) {
    this.g = g;
    /* number nodes along the shorter side: bandwidth = min(nx, nz) */
    this.colMajor = g.nz < g.nx;
    this.b = this.colMajor ? g.nz : g.nx;
    this.B = this.b + 1;            /* stored band: diagonal + b sub-diagonals */
    this.L = new Float64Array(g.n * this.B);
    this.y = new Float64Array(g.n);
    this.perm = new Int32Array(g.n); /* perm[k] = band index of node k */
    for (var j = 0; j < g.nz; j++)
      for (var i = 0; i < g.nx; i++)
        this.perm[j * g.nx + i] = this.colMajor ? i * g.nz + j : j * g.nx + i;
    this.sig = '';
  }

  /* Calls fn(nbNode, conductance) for every linked neighbour of node k. */
  function eachLink(g, k, fn) {
    var nx = g.nx, nz = g.nz, i = k % nx, j = (k - i) / nx;
    if (i > 0)      fn(k - 1,  g.cx[j * (nx - 1) + i - 1]);
    if (i < nx - 1) fn(k + 1,  g.cx[j * (nx - 1) + i]);
    if (j > 0)      fn(k - nx, g.cz[(j - 1) * nx + i]);
    if (j < nz - 1) fn(k + nx, g.cz[j * nx + i]);
  }

  Direct.prototype.factor = function () {
    var g = this.g, n = g.n, B = this.B, b = this.b, L = this.L, perm = this.perm;
    L.fill(0);
    /* assemble lower band of A: L[p*B + d] = A(p, p-d) */
    for (var k = 0; k < n; k++) {
      var p = perm[k];
      if (g.fixed[k]) { L[p * B] = 1; continue; }
      var diag = 0;
      eachLink(g, k, function (nb, c) {
        diag += c;
        var q = perm[nb];
        if (q < p && !g.fixed[nb]) L[p * B + (p - q)] = -c;
      });
      L[p * B] = diag > 0 ? diag : 1;
    }
    /* free-node <- fixed-neighbour couplings, so solve() only scales values */
    var dst = [], src = [], cc = [];
    for (k = 0; k < n; k++) {
      if (g.fixed[k]) continue;
      eachLink(g, k, function (nb, c) {
        if (g.fixed[nb] && c > 0) { dst.push(perm[k]); src.push(nb); cc.push(c); }
      });
    }
    this.rDst = new Int32Array(dst); this.rSrc = new Int32Array(src); this.rC = new Float64Array(cc);
    /* in-place banded Cholesky, A = L L^T */
    for (p = 0; p < n; p++) {
      var p0 = Math.max(0, p - b), pb = p * B;
      for (var i = p0; i <= p; i++) {
        var s = L[pb + (p - i)], ib = i * B, m0 = Math.max(p0, i - b);
        for (var m = m0; m < i; m++) s -= L[pb + (p - m)] * L[ib + (i - m)];
        if (i === p) L[pb] = Math.sqrt(s > 1e-300 ? s : 1e-300);
        else L[pb + (p - i)] = s / L[ib];
      }
    }
  };

  /* Re-factors only when the fixed-node pattern or conductances changed. */
  Direct.prototype.solve = function (h, force) {
    var g = this.g, n = g.n, B = this.B, b = this.b, L = this.L, y = this.y, perm = this.perm;
    var sig = sigOf(g), refactored = false, k, m, s;
    if (force || sig !== this.sig) { this.factor(); this.sig = sig; refactored = true; }
    /* right-hand side: fixed values, and fixed neighbours moved over */
    for (k = 0; k < n; k++) y[perm[k]] = g.fixed[k] ? g.value[k] : 0;
    var rDst = this.rDst, rSrc = this.rSrc, rC = this.rC;
    for (k = 0; k < rDst.length; k++) y[rDst[k]] += rC[k] * g.value[rSrc[k]];
    /* L z = rhs */
    for (k = 0; k < n; k++) {
      s = y[k];
      for (m = Math.max(0, k - b); m < k; m++) s -= L[k * B + (k - m)] * y[m];
      y[k] = s / L[k * B];
    }
    /* L^T x = z */
    for (k = n - 1; k >= 0; k--) {
      s = y[k];
      var mEnd = Math.min(n - 1, k + b);
      for (m = k + 1; m <= mEnd; m++) s -= L[m * B + (m - k)] * y[m];
      y[k] = s / L[k * B];
    }
    for (k = 0; k < n; k++) h[k] = y[perm[k]];
    return { refactored: refactored };
  };

  function sigOf(g) {
    /* cheap signature of the fixed mask + conductance sum */
    var s = 0, t = 0;
    for (var k = 0; k < g.n; k++) if (g.fixed[k]) { s += k + 1; t = (t * 31 + k) % 1000000007; }
    var cs = 0;
    for (k = 0; k < g.cx.length; k++) cs += g.cx[k];
    for (k = 0; k < g.cz.length; k++) cs += g.cz[k];
    return s + ':' + t + ':' + cs;
  }

  /* Qx: +x discharge through face between (i,j),(i+1,j). Qz: +z (downward)
     discharge through face between (i,j),(i,j+1). Multiply by k when the grid
     was built with unit conductivity. */
  function fluxes(g, h, k) {
    var nx = g.nx, nz = g.nz, i, j, a;
    k = k || 1;
    var Qx = new Float64Array(g.cx.length), Qz = new Float64Array(g.cz.length);
    for (j = 0; j < nz; j++)
      for (i = 0; i < nx - 1; i++) {
        a = j * (nx - 1) + i;
        Qx[a] = k * g.cx[a] * (h[j * nx + i] - h[j * nx + i + 1]);
      }
    for (j = 0; j < nz - 1; j++)
      for (i = 0; i < nx; i++) {
        a = j * nx + i;
        Qz[a] = k * g.cz[a] * (h[a] - h[a + nx]);
      }
    return { Qx: Qx, Qz: Qz };
  }

  /* Net discharge each fixed node pushes into the domain (positive = inflow). */
  function boundaryFlux(g, Q) {
    var nx = g.nx, nz = g.nz, out = new Float64Array(g.n), qIn = 0, qOut = 0;
    for (var j = 0; j < nz; j++)
      for (var i = 0; i < nx; i++) {
        var k = j * nx + i;
        if (!g.fixed[k]) continue;
        var s = 0;
        if (i < nx - 1) s += Q.Qx[j * (nx - 1) + i];
        if (i > 0)      s -= Q.Qx[j * (nx - 1) + i - 1];
        if (j < nz - 1) s += Q.Qz[j * nx + i];
        if (j > 0)      s -= Q.Qz[(j - 1) * nx + i];
        out[k] = s;
        if (s > 0) qIn += s; else qOut -= s;
      }
    return { perNode: out, qIn: qIn, qOut: qOut };
  }

  /* psi on the (nx+1) x (nz+1) dual grid. Convention (z downward):
       going +z along a vertical face:   dpsi = +Qx
       going +x along a horizontal face: dpsi = -Qz                         */
  function streamFunction(g, Q) {
    var nx = g.nx, nz = g.nz, NX = nx + 1, NZ = nz + 1, I, J;
    var psi = new Float64Array(NX * NZ);
    var xs = new Float64Array(NX), zs = new Float64Array(NZ);
    xs[0] = g.x0; xs[nx] = g.x1;
    for (I = 1; I < nx; I++) xs[I] = g.x0 + (I - 0.5) * g.dx;
    zs[0] = g.z0; zs[nz] = g.z1;
    for (J = 1; J < nz; J++) zs[J] = g.z0 + (J - 0.5) * g.dz;

    function P(I, J) { return J * NX + I; }
    /* reference path: dual row nz-1 (between the last two node rows) */
    var Jr = nz - 1;
    psi[P(0, Jr)] = 0;
    for (I = 0; I < nx; I++) psi[P(I + 1, Jr)] = psi[P(I, Jr)] - Q.Qz[(nz - 2) * nx + I];
    /* interior dual columns, marching up and down from the reference row */
    for (I = 1; I < nx; I++) {
      psi[P(I, nz)] = psi[P(I, Jr)] + Q.Qx[(nz - 1) * (nx - 1) + I - 1];
      for (J = Jr - 1; J >= 0; J--) psi[P(I, J)] = psi[P(I, J + 1)] - Q.Qx[J * (nx - 1) + I - 1];
    }
    /* edge columns from their inner neighbours */
    for (J = 1; J < Jr; J++) {
      psi[P(0, J)] = psi[P(1, J)] + Q.Qz[(J - 1) * nx];
      psi[P(nx, J)] = psi[P(nx - 1, J)] - Q.Qz[(J - 1) * nx + nx - 1];
    }
    psi[P(nx, Jr)] = psi[P(nx - 1, Jr)] - Q.Qz[(Jr - 1) * nx + nx - 1];
    psi[P(0, 0)] = psi[P(0, 1)]; psi[P(nx, 0)] = psi[P(nx, 1)];
    psi[P(0, nz)] = psi[P(0, Jr)]; psi[P(nx, nz)] = psi[P(nx, Jr)];

    var lo = Infinity, hi = -Infinity;
    for (var k = 0; k < psi.length; k++) { if (psi[k] < lo) lo = psi[k]; if (psi[k] > hi) hi = psi[k]; }
    return { psi: psi, nx: NX, nz: NZ, xs: xs, zs: zs, min: lo, max: hi };
  }

  VLab.Laplace = { solve: solve, Direct: Direct, fluxes: fluxes, boundaryFlux: boundaryFlux, streamFunction: streamFunction };
})(window.VLab = window.VLab || {});
