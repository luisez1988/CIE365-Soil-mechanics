/* VLab.Oedo — one-dimensional consolidation of a saturated clay specimen in an
   oedometer (incremental loading, ASTM D2435), with no DOM code.

   Soil generator  randomSoil(seed): w, Gs -> e0 (S = 1); LI -> LL, PL, PI;
                   Wroth & Wood Cc = Gs·PI/200; Cr = Cc/10..Cc/5; Mesri Cα/Cc = 0.03..0.05;
                   σ'p from sampling depth and OCR; k(e) from a target cv (Tavenas Ck = e0/2).

   Constitutive model (natural strain ε, compression positive, σ' in kPa), per node:
     ε = κi·ln(σ'/σ'0)                 instantaneous elastic
       + εr                            delayed elastic (Eyring, bidirectional):
                                         dεr/dt = (μr/τr)·sinh(x/μr),  x = κr·ln(σ'/σ'0) − εr
       + Σ wj·εcj                      viscoplastic (Soft-Soil-Creep / Bjerrum isotachs),
                                         dεcj/dt = (μ/τ)·(σ'/σ'pj)^(a/μ),  σ'pj = σ'p,j0·exp(εcj/a)
   The σ'p,j0 are spread lognormally (5-point Gauss–Hermite) so the yield is smeared, not kinked.
   Unloading and reloading stay in the elastic range; creep follows from the isotachs.

   Coupling: ∂ε/∂t = ∂/∂z[(k(e)/γw)·∂u/∂z], σ' = σ − u, u = 0 at both porous stones.
   Backward Euler, Newton on u with the consistent tangent dε/dσ' (tridiagonal),
   each constitutive update solved exactly (Lambert W for the isotachs). */
(function (VLab) {
  'use strict';

  var GW = 9.81, LN10 = Math.LN10;
  var GH_X = [-2.856970, -1.355626, 0, 1.355626, 2.856970];
  var GH_W = [0.011257, 0.222076, 0.533333, 0.222076, 0.011257];

  /* ---------- seeded random numbers ---------- */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- soil generator ---------- */
  function randomSoil(seed) {
    var r = rng(seed), U = function (a, b) { return a + (b - a) * r(); };
    var s = { seed: seed };
    s.Gs = U(2.68, 2.78);
    s.w = U(35, 75);                               // %
    s.e0 = s.w / 100 * s.Gs;                        // saturated
    s.LI = U(0.75, 1.0);
    var a = U(0.68, 0.9);                           // PI = a(LL − 20): on/above the A-line
    s.LL = (s.w - 20 * a * (1 - s.LI)) / (1 - a * (1 - s.LI));
    s.PI = a * (s.LL - 20);
    s.PL = s.LL - s.PI;
    s.Cc = 0.5 * s.Gs * s.PI / 100;                 // Wroth & Wood (1978)
    s.Cr = s.Cc * U(0.1, 0.2);
    s.CaCc = U(0.03, 0.05);                         // Mesri & Godlewski
    s.Ca = s.CaCc * s.Cc;
    s.Car = s.CaCc * s.Cr;
    s.depth = U(5, 15);                             // m
    s.gammaP = (s.Gs - 1) / (1 + s.e0) * GW;        // kN/m³
    s.svo = s.gammaP * s.depth;
    s.OCR = U(1.3, 2.5);
    s.sp = s.OCR * s.svo;
    s.cv = Math.exp(U(Math.log(2), Math.log(12)));  // m²/yr on the virgin line, log-uniform
    s.Ck = 0.5 * s.e0;
    s.H0 = 25.4;                                    // mm
    s.D = 63.5;                                     // mm
    s.seat = 5;                                     // kPa
    return derive(s);
  }

  /* Model constants from the index-style parameters. */
  function derive(s) {
    var n = LN10 * (1 + s.e0);
    s.kap = s.Cr / n;                // κ*  (unload)
    s.lam = s.Cc / n;                // λ*
    s.ki = s.kap;                    // instantaneous elastic
    s.kr = 0.4 * s.kap;              // delayed elastic (Eyring)
    s.mur = s.Car / n;
    s.tr = 1e6;                      // s
    s.ap = s.lam - s.ki - 0.5 * s.kr; // viscoplastic slope so the virgin line is ≈ λ*
    s.sa = s.sa == null ? 0.15 * s.sp : s.sa; // elastic stiffness offset: ε_e ∝ ln(σ' + σa)
    s.mup = Math.max(1e-6, s.Ca / n - s.mur);
    s.tau = 86400;                   // s, reference time of the isotachs
    s.smear = s.smear == null ? 0.22 : s.smear;
    s.k0 = s.cv / 3.156e7 * GW * (s.lam / s.sp); // m/s at e0
    return s;
  }

  /* ---------- Lambert W ---------- */
  function lambertWlog(lz) {        // W(exp(lz)), lz may be huge
    if (lz < -40) return Math.exp(lz);
    var w;
    if (lz < 1) {
      var z = Math.exp(lz);
      w = Math.log1p(z);
      for (var i = 0; i < 30; i++) {
        var ew = Math.exp(w), f = w * ew - z, d = ew * (w + 1);
        var dw = f / (d - (w + 2) * f / (2 * w + 2));
        w -= dw;
        if (Math.abs(dw) < 1e-14 * (1 + Math.abs(w))) break;
      }
      return w;
    }
    w = lz - Math.log(lz);
    for (var k = 0; k < 40; k++) {
      var g = w + Math.log(w) - lz, dw2 = g / (1 + 1 / w);
      w -= dw2;
      if (w <= 0) w = 1e-12;
      if (Math.abs(dw2) < 1e-14 * w) break;
    }
    return w;
  }

  /* s + d·sinh(s) = S0, solved for s (odd in S0). */
  function eyring(S0, d) {
    if (S0 === 0) return 0;
    var sg = S0 < 0 ? -1 : 1, A = Math.abs(S0);
    var s = Math.min(A, Math.asinh(A / Math.max(d, 1e-300)));
    for (var i = 0; i < 60; i++) {
      var f = s + d * Math.sinh(s) - A, fp = 1 + d * Math.cosh(s);
      var ds = f / fp;
      s -= ds;
      if (s < 0) s = 0;
      if (Math.abs(ds) < 1e-13 * (1 + s)) break;
    }
    return sg * s;
  }

  /* ---------- simulator ---------- */
  function Sim(soil, opt) {
    opt = opt || {};
    this.soil = soil;
    var N = this.N = opt.nodes || 41;
    var H = soil.H0 / 1000, z = this.z = new Float64Array(N);
    for (var i = 0; i < N; i++) z[i] = H * 0.5 * (1 - Math.cos(Math.PI * i / (N - 1)));
    this.V = new Float64Array(N);
    for (i = 0; i < N; i++) {
      var lo = i > 0 ? z[i - 1] : z[i], hi = i < N - 1 ? z[i + 1] : z[i];
      this.V[i] = (hi - lo) / 2;
    }
    this.M = soil.smear > 0 ? GH_X.length : 1;
    this.spj0 = []; this.wj = [];
    for (var j = 0; j < this.M; j++) {
      this.spj0.push(this.M === 1 ? soil.sp : soil.sp * Math.exp(soil.smear * GH_X[j]));
      this.wj.push(this.M === 1 ? 1 : GH_W[j]);
    }
    /* state per node */
    this.u = new Float64Array(N);
    this.spr = new Float64Array(N).fill(soil.seat);   // σ' at last converged step
    this.er = new Float64Array(N);
    this.ec = []; for (j = 0; j < this.M; j++) this.ec.push(new Float64Array(N));
    this.eps = new Float64Array(N);
    this.sigma = soil.seat;
    this.t = 0;                 // time in the current increment, s
    this.T = 0;                 // test time at the start of the current increment, s
    this.dt = 0.01;
    this.incs = [];
    this.cur = null;
    this.work = { sp: new Float64Array(N), eps: new Float64Array(N), m: new Float64Array(N),
      er: new Float64Array(N), ec: this.ec.map(function () { return new Float64Array(N); }) };
  }

  Sim.EOP = 0.05;   /* end of primary: max excess pore pressure below 5 % of Δσ (≈ Casagrande t100) */
  var S = Sim.prototype;

  /* Constitutive update of node i from the converged state to σ'. Writes into w. */
  S.local = function (i, sp, dt, w) {
    var s = this.soil;
    var L = Math.log((sp + s.sa) / (s.seat + s.sa)), dL = 1 / (sp + s.sa);
    var eps = s.ki * L, m = s.ki * dL;
    /* Eyring delayed elastic */
    var S0 = (s.kr * L - this.er[i]) / s.mur, d = dt / s.tr;
    var sv = eyring(S0, d);
    var er = s.kr * L - s.mur * sv;
    eps += er; m += s.kr * dL * (1 - 1 / (1 + d * Math.cosh(sv)));
    w.er[i] = er;
    /* isotachs */
    var beta = s.ap / s.mup, lnDt = Math.log(dt / s.tau);
    for (var j = 0; j < this.M; j++) {
      var ec0 = this.ec[j][i];
      var lz = lnDt + beta * Math.log(sp / this.spj0[j]) - ec0 / s.mup;
      var W = lambertWlog(lz);
      var ec = ec0 + s.mup * W;
      w.ec[j][i] = ec;
      eps += this.wj[j] * ec;
      m += this.wj[j] * s.ap * W / (1 + W) / sp;
    }
    w.eps[i] = eps;
    w.m[i] = m;
  };

  S.kAt = function (i) {
    var s = this.soil, e = s.e0 - (1 + s.e0) * this.eps[i];
    return s.k0 * Math.pow(10, (e - s.e0) / s.Ck);
  };

  /* One backward-Euler step of size dt. Returns false if Newton fails. */
  S.trial = function (dt) {
    var N = this.N, z = this.z, V = this.V, w = this.work, sig = this.sigma;
    var n = N - 2, u = Float64Array.from(this.u);
    u[0] = 0; u[N - 1] = 0;
    var C = new Float64Array(N - 1);
    for (var i = 0; i < N - 1; i++) {
      var k1 = this.kAt(i), k2 = this.kAt(i + 1);
      C[i] = 2 * k1 * k2 / (k1 + k2) / (GW * (z[i + 1] - z[i]));
    }
    var a = new Float64Array(n), b = new Float64Array(n), c = new Float64Array(n), r = new Float64Array(n);
    var scale = Math.max(1, Math.abs(this.cur ? this.cur.dsig : 1));
    for (var it = 0; it < 40; it++) {
      for (i = 0; i < N; i++) {
        var sp = sig - u[i];
        if (sp < 1e-3) sp = 1e-3;
        w.sp[i] = sp;
        this.local(i, sp, dt, w);
      }
      for (var q = 0; q < n; q++) {
        i = q + 1;
        var R = V[i] * (w.eps[i] - this.eps[i]) + dt * (C[i] * (u[i + 1] - u[i]) - C[i - 1] * (u[i] - u[i - 1]));
        b[q] = V[i] * w.m[i] + dt * (C[i] + C[i - 1]);
        a[q] = -dt * C[i - 1];
        c[q] = -dt * C[i];
        r[q] = R;
      }
      /* Thomas: A du = R */
      for (q = 1; q < n; q++) {
        var f = a[q] / b[q - 1];
        b[q] -= f * c[q - 1];
        r[q] -= f * r[q - 1];
      }
      r[n - 1] /= b[n - 1];
      for (q = n - 2; q >= 0; q--) r[q] = (r[q] - c[q] * r[q + 1]) / b[q];
      var big = 0;
      for (q = 0; q < n; q++) {
        i = q + 1;
        var du = r[q], spc = w.sp[i], spn = sig - (u[i] + du);
        if (spn < 0.3 * spc) du = sig - 0.3 * spc - u[i];
        else if (spn > 3 * spc) du = sig - 3 * spc - u[i];
        u[i] += du;
        if (Math.abs(du) > big) big = Math.abs(du);
      }
      if (!isFinite(big)) return false;
      if (big < 1e-7 * scale) {
        for (i = 0; i < N; i++) { var sp2 = Math.max(1e-3, sig - u[i]); w.sp[i] = sp2; this.local(i, sp2, dt, w); }
        this.u = u;
        this.iters = it + 1;
        return true;
      }
    }
    return false;
  };

  /* Commit the work arrays as the new converged state. */
  S.commit = function (dt) {
    var w = this.work;
    this.spr.set(w.sp); this.er.set(w.er); this.eps.set(w.eps);
    for (var j = 0; j < this.M; j++) this.ec[j].set(w.ec[j]);
    this.t += dt;
  };

  S.epsBar = function () {
    var s = 0, H = this.soil.H0 / 1000;
    for (var i = 0; i < this.N; i++) s += this.V[i] * this.eps[i];
    return s / H;
  };
  S.uMax = function () {
    var m = 0;
    for (var i = 1; i < this.N - 1; i++) if (Math.abs(this.u[i]) > Math.abs(m)) m = this.u[i];
    return m;
  };

  /* Advance one adaptive step, at most to tMax. */
  S.step = function (tMax) {
    var dt = Math.min(this.dt, tMax - this.t);
    if (dt <= 0) return false;
    var tries = 0;
    while (!this.trial(dt)) {
      dt /= 4;
      if (++tries > 12) throw new Error('consolidation solver failed at t = ' + this.t);
    }
    var limited = dt < this.dt;
    this.commit(dt);
    if (!limited || tries) {
      var grow = this.iters > 10 ? 1.0 : 1.3;
      this.dt = Math.min(dt * grow, 0.07 * (this.t + 1));
    }
    this.record();
    return true;
  };

  S.record = function () {
    var c = this.cur;
    if (!c) return;
    var eb = this.epsBar(), um = this.uMax();
    var prev = c.hist[c.hist.length - 1], lim = Sim.EOP * Math.abs(c.dsig);
    c.hist.push([this.t, eb, um]);
    if (!c.eop && Math.abs(um) < lim) {   /* crossing time, log-interpolated in u */
      var f = prev[0] > 0 && Math.abs(prev[2]) > lim ? Math.log(Math.abs(prev[2]) / lim) / Math.log(Math.abs(prev[2]) / Math.max(Math.abs(um), 1e-12)) : 1;
      c.eop = true;
      c.tEOP = prev[0] + f * (this.t - prev[0]);
      c.epsEOP = prev[1] + f * (eb - prev[1]);
    }
    c.tEnd = this.t; c.epsEnd = eb;
  };

  S.advanceTo = function (t) { while (this.t < t - 1e-12) if (!this.step(t)) break; };
  S.runUntilEOP = function (tMax) {
    tMax = tMax || 30 * 86400;
    while (this.cur && !this.cur.eop && this.t < tMax) this.step(tMax);
  };

  /* Start a new load increment at total vertical stress sigma (kPa). */
  S.applyLoad = function (sigma, meta) {
    if (this.cur) this.T += this.t;
    var ds = sigma - this.sigma;
    for (var i = 1; i < this.N - 1; i++) this.u[i] += ds;   // undrained response
    this.sigma = sigma;
    this.t = 0;
    this.dt = 0.01;
    var eb = this.epsBar();
    this.cur = { sigma: sigma, sig0: sigma - ds, dsig: ds, T0: this.T, hist: [[0, eb, ds]],
      eps0: eb, eop: false, tEOP: null, epsEOP: null, tEnd: 0, epsEnd: eb, meta: meta || {} };
    this.incs.push(this.cur);
    return this.cur;
  };

  /* Interpolate the history of increment inc at time t (s). */
  function epsAt(inc, t) {
    var h = inc.hist;
    if (t <= h[0][0]) return h[0][1];
    for (var k = 1; k < h.length; k++) {
      if (h[k][0] >= t) {
        var a = h[k - 1], b = h[k], f = (t - a[0]) / (b[0] - a[0]);
        return a[1] + f * (b[1] - a[1]);
      }
    }
    return h[h.length - 1][1];
  }

  /* ---------- self test (console: VLab.Oedo.selfTest()) ---------- */
  function terzaghiU(Tv) {
    var s = 0;
    for (var m = 0; m < 200; m++) {
      var M = Math.PI / 2 * (2 * m + 1);
      s += 2 / (M * M) * Math.exp(-M * M * Math.max(Tv, 1e-12));
    }
    return 1 - s;
  }

  function selfTest() {
    var out = [], ok = true;
    function check(name, cond, info) { out.push((cond ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); ok = ok && cond; }

    /* 1. Terzaghi: elastic only, constant k, tiny load increment. */
    var s = derive({ e0: 1, Cc: 0.4, Cr: 0.05, Ca: 1e-9, Car: 1e-12, sp: 1e9, cv: 3, Ck: 1e9,
      H0: 25.4, seat: 100, smear: 0 });
    s.kr = 0; s.ki = s.kap; s.mur = 1e-9; s.ap = 1e-6; s.mup = 1e-9; s.sa = 0;
    s.k0 = s.cv / 3.156e7 * GW * (s.ki / 100.5);
    var sim = new Sim(s, { nodes: 61 });
    var inc = sim.applyLoad(101);
    var mv = s.ki / 100.5, cv = s.k0 / (GW * mv), Hdr = s.H0 / 2000;
    var worst = 0;
    [0.02, 0.05, 0.1, 0.2, 0.5, 1].forEach(function (Tv) {
      var t = Tv * Hdr * Hdr / cv;
      sim.advanceTo(t);
      var U = (epsAt(inc, t) - inc.eps0) / (s.ki * Math.log(101 / 100));
      worst = Math.max(worst, Math.abs(U - terzaghiU(Tv)));
    });
    check('Terzaghi U(Tv) match', worst < 0.01, 'max |ΔU| = ' + worst.toFixed(4));

    /* 2. Virgin slope and 3. secondary slope on a random clay. */
    var soil = randomSoil(12345), sm = new Sim(soil), e = function (eps) { return soil.e0 - (1 + soil.e0) * eps; };
    var loads = [12.5, 25, 50, 100, 200, 400, 800, 1600, 3200], eop = {};
    loads.forEach(function (L) {
      var c = sm.applyLoad(L); sm.runUntilEOP();
      eop[L] = e(c.epsEOP);
      if (L === 1600) { sm.advanceTo(86400); c.e1 = e(epsAt(c, 5 * c.tEOP)); c.e2 = e(epsAt(c, 50 * c.tEOP)); c.keep = true; sm.c1600 = c; }
      else sm.advanceTo(Math.max(sm.t, 3 * c.tEOP));
    });
    var CcMeas = (eop[800] - eop[3200]) / Math.log10(4);
    check('virgin slope ≈ Cc', Math.abs(CcMeas / soil.Cc - 1) < 0.2,
      'Cc in = ' + soil.Cc.toFixed(3) + ', measured = ' + CcMeas.toFixed(3));
    var CaMeas = sm.c1600.e1 - sm.c1600.e2;
    check('secondary slope ≈ Cα', Math.abs(CaMeas / soil.Ca - 1) < 0.35,
      'Cα in = ' + soil.Ca.toFixed(4) + ', measured = ' + CaMeas.toFixed(4));
    return { ok: ok, lines: out };
  }

  VLab.Oedo = { randomSoil: randomSoil, derive: derive, Sim: Sim, epsAt: epsAt, selfTest: selfTest,
    lambertWlog: lambertWlog, terzaghiU: terzaghiU, GW: GW };
})(window.VLab = window.VLab || {});
