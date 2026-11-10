/* Virtual Lab experiment: Mohr's circle of stress (State of Stress, Module 9).

   Sign convention, as in the deck (and Examples 9.1-9.3):
     - compression is positive;
     - a shear stress is positive when it makes the element turn counter-clockwise;
     - angles are positive counter-clockwise, and a plane's angle alpha is measured
       from the horizontal (the x axis).
   tau_xy is the shear on the vertical faces (the x faces), so

     sigma_a = (sx + sy)/2 + (sy - sx)/2 cos 2a + txy sin 2a
     tau_a   = (sy - sx)/2 sin 2a - txy cos 2a

   The horizontal plane (a = 0) plots at (sy, -txy), the vertical plane at (sx, txy),
   and the pole (origin of planes) is (sx, -txy). A plane at angle a plots 2a
   counter-clockwise round the circle from the horizontal plane, and the line from
   the pole to that point is parallel to the plane.

   The element is the original element rotated by theta. Its y' faces are planes at
   theta (top/bottom), its x' faces are planes at theta + 90 (left/right). */
(function (VLab) {
  'use strict';

  var D2R = Math.PI / 180, R2D = 180 / Math.PI;
  var qs = location.search;
  if (/[?&]embed=1/.test(qs)) document.body.classList.add('vl-embed');
  var theme = /[?&]theme=(light|dark)/.exec(qs);
  if (theme) document.documentElement.setAttribute('data-theme', theme[1]);

  /* ---------- model ---------- */
  var M = {
    stress: function (s, a) {                  /* stresses on the plane at a degrees */
      var c = (s.sx + s.sy) / 2, d = (s.sy - s.sx) / 2, t = 2 * a * D2R;
      return { s: c + d * Math.cos(t) + s.txy * Math.sin(t), t: d * Math.sin(t) - s.txy * Math.cos(t) };
    },
    circle: function (s) {
      var c = (s.sx + s.sy) / 2, d = (s.sy - s.sx) / 2, R = Math.hypot(d, s.txy);
      var phi0 = Math.atan2(-s.txy, d) * R2D;  /* angle of the horizontal plane's point */
      if (R < 1e-12) phi0 = 0;
      var a1 = norm90(-phi0 / 2);              /* plane on which sigma_1 acts */
      return { c: c, R: R, phi0: phi0, s1: c + R, s3: c - R, a1: a1, a3: norm90(a1 + 90),
        aT: norm90((90 - phi0) / 2), pole: { s: s.sx, t: -s.txy } };
    },
    /* rebuild sx, sy, txy from a circle, keeping the horizontal plane at phi0 */
    fromCircle: function (c, R, phi0) {
      var d = R * Math.cos(phi0 * D2R);
      return { sx: c - d, sy: c + d, txy: -R * Math.sin(phi0 * D2R) };
    }
  };
  VLab.Mohr = M;

  function norm90(a) {                         /* angle of a plane, in (-90, 90] */
    a = ((a % 180) + 180) % 180;
    return a > 90 + 1e-9 ? a - 180 : a;
  }
  function r1(v) { return Math.round(v * 10) / 10; }
  function f1(v) {
    var x = Math.abs(v) < 0.05 ? 0 : v;
    return Math.abs(x) >= 1e4 ? x.toFixed(0) : x.toFixed(1);
  }
  function fa(v) { return f1(v) + '°'; }

  /* ---------- state + panel ---------- */
  var DEFAULTS = { sx: 200, sy: 300, txy: -75, th: 0, th0: 0 };   /* Example 9.1 */
  var initial = VLab.Hash.read();
  var S0 = {};
  ['sx', 'sy', 'txy', 'th', 'th0'].forEach(function (k) {
    var v = Number(initial[k]);
    S0[k] = initial[k] != null && isFinite(v) ? v : DEFAULTS[k];
  });

  var schema = [
    { type: 'heading', label: 'Show' },
    { type: 'toggle', key: 'pr', label: '<span><span class="mc-sw" style="background:var(--mc-pr)"></span>Principal stresses &sigma;<sub>1</sub>, &sigma;<sub>3</sub></span>', value: true },
    { type: 'toggle', key: 'ts', label: '<span><span class="mc-sw" style="background:var(--mc-ts)"></span>Maximum shear &tau;<sub>max</sub></span>', value: false },
    { type: 'toggle', key: 'pole', label: '<span><span class="mc-sw" style="background:var(--vl-ink)"></span>Pole (origin of planes)</span>', value: false },
    { type: 'toggle', key: 'cen', label: '<span><span class="mc-sw" style="background:var(--vl-green)"></span>Centre: mean stress &sigma;<sub>m</sub></span>', value: false },
    { type: 'toggle', key: 'orig', label: '<span><span class="mc-sw" style="background:var(--vl-muted)"></span>Original element&rsquo;s planes (&theta;<sub>0</sub>)</span>', value: true },

    { type: 'heading', label: 'Stress on a plane' },
    { type: 'toggle', key: 'aon', label: '<span><span class="mc-sw" style="background:var(--mc-q)"></span>Plane at angle &alpha;</span>', value: false },
    { type: 'number', key: 'a', label: '<span>&alpha; from horizontal (&deg;)</span>', value: 25, min: -180, max: 180,
      visibleIf: function (s) { return s.aon; } },
    { type: 'html', id: 'aread', visibleIf: function (s) { return s.aon; } },
    { type: 'buttons', items: [{ label: 'Rotate element to α', id: 'to-a', onClick: function () { setTheta(norm90(S.a)); } }],
      visibleIf: function (s) { return s.aon; } },

    { type: 'heading', label: 'Results' },
    { type: 'html', id: 'res' },

    { type: 'heading', label: 'Options' },
    { type: 'select', key: 'u', label: 'Units', value: 'kPa',
      options: [['kPa', 'kPa'], ['MPa', 'MPa'], ['psf', 'psf'], ['ksf', 'ksf'], ['psi', 'psi']] },
    { type: 'buttons', items: [
      { label: 'Fit view', onClick: function () { fit(true); } },
      { label: 'Example 9.1', onClick: function () { S.th0 = 0; setStress(DEFAULTS); setTheta(0); } }
    ] },
    { type: 'html', id: 'hint' }
  ];

  var S = null;
  var ui = new VLab.Controls(document.getElementById('panel'), schema, function () {
    redraw(); saveHash();
  }, initial);
  S = ui.state;
  S.sx = S0.sx; S.sy = S0.sy; S.txy = S0.txy; S.th = norm90(S0.th); S.th0 = norm90(S0.th0);

  document.getElementById('hint').innerHTML =
    '<p class="mc-hint"><b>On the circle:</b> drag the <span style="color:var(--mc-y)">y′</span> or ' +
    '<span style="color:var(--mc-x)">x′</span> point to rotate the element, the rim to change its size, ' +
    'and the inside to slide it along &sigma;.' + '<br><b>On the element:</b> drag it, or use the arrow keys, to rotate it ' +
    '(Shift: 5° steps).</p>';

  /* ---------- colours (follow the theme) ---------- */
  var C = {};
  function readColors() {
    var cs = getComputedStyle(document.documentElement), dark = cs.getPropertyValue('color-scheme').trim() === 'dark';
    function v(n) { return cs.getPropertyValue(n).trim(); }
    C = { ink: v('--vl-ink'), muted: v('--vl-muted'), line: v('--vl-line'), bg: v('--vl-bg'), panel: v('--vl-panel'),
      circle: v('--vl-green'),
      y: dark ? '#ff6b6b' : '#cc0000',      /* y' faces (planes at theta) */
      x: dark ? '#6aaeff' : '#1f5fbf',      /* x' faces (planes at theta + 90) */
      pr: dark ? '#e879f9' : '#a21caf',     /* principal */
      ts: dark ? '#fbbf24' : '#c2410c',     /* maximum shear */
      q: dark ? '#2dd4bf' : '#0f766e' };    /* plane at alpha */
    var st = document.documentElement.style;
    st.setProperty('--mc-y', C.y); st.setProperty('--mc-x', C.x); st.setProperty('--mc-pr', C.pr);
    st.setProperty('--mc-ts', C.ts); st.setProperty('--mc-q', C.q);
  }
  readColors();
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', function () { readColors(); redraw(); });
  }

  /* ---------- canvases ---------- */
  function Canvas(cv) {
    this.cv = cv; this.ctx = cv.getContext('2d'); this.W = 0; this.H = 0; this.dpr = 1;
  }
  Canvas.prototype.size = function () {
    var host = this.cv.parentElement, W = host.clientWidth, H = host.clientHeight, d = window.devicePixelRatio || 1;
    if (W === this.W && H === this.H && d === this.dpr) return false;
    this.W = W; this.H = H; this.dpr = d;
    this.cv.style.width = W + 'px'; this.cv.style.height = H + 'px';
    this.cv.width = Math.round(W * d); this.cv.height = Math.round(H * d);
    return true;
  };
  Canvas.prototype.begin = function () {
    var c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.W, this.H);
    return c;
  };

  var stage = document.getElementById('stage');
  var plot = new Canvas(document.getElementById('mohr'));
  var elem = new Canvas(document.getElementById('elem'));
  var elemCard = document.getElementById('elemCard');
  var tensorEl = document.getElementById('tensor');

  /* plot mapping: px = ox + sigma*s, py = oy - tau*s (equal aspect) */
  var V = { s: 1, ox: 0, oy: 0 }, Vt = null, anim = 0;
  function px(sig) { return V.ox + sig * V.s; }
  function py(tau) { return V.oy - tau * V.s; }
  function wx(x) { return (x - V.ox) / V.s; }
  function wy(y) { return (V.oy - y) / V.s; }

  /* the part of the plot the circle should sit in: right of the element card */
  function region() {
    var W = plot.W, H = plot.H, left = 18;
    if (W > 640) left = elemCard.offsetLeft + elemCard.offsetWidth + 24;
    var right = W - 26 - (W > 640 ? 0.3 * tensorEl.offsetWidth : 0);   /* lean away from the tensor card */
    return { l: left, r: right, t: 26, b: H - 30 };
  }

  function targetView() {
    var K = M.circle(S), g = region();
    var R = Math.max(K.R, 1e-6);
    if (K.R < 1e-9) R = Math.max(Math.abs(K.c) * 0.25, 10);
    /* keep sigma = 0 in view only when the circle is near it; otherwise the axis is drawn broken */
    var withOrigin = Math.abs(K.c) - R < 0.8 * R;
    var x0 = withOrigin ? Math.min(0, K.c - R) : K.c - R, x1 = withOrigin ? Math.max(0, K.c + R) : K.c + R;
    var pad = 0.14 * Math.max(x1 - x0, 2 * R);
    x0 -= pad; x1 += pad;
    var yr = 2 * R * 1.26;
    var s = Math.min((g.r - g.l) / (x1 - x0), (g.b - g.t) / yr);
    return { s: s, ox: (g.l + g.r) / 2 - s * (x0 + x1) / 2, oy: (g.t + g.b) / 2 };
  }

  function fit(animate) {
    var T = targetView();
    if (!animate || !plot.W) { V = T; Vt = null; redraw(); return; }
    var from = { s: V.s, ox: V.ox, oy: V.oy }, t0 = performance.now();
    Vt = T;
    cancelAnimationFrame(anim);
    (function step(now) {
      var u = Math.min(1, (now - t0) / 280), e = 1 - Math.pow(1 - u, 3);
      V = { s: from.s + (T.s - from.s) * e, ox: from.ox + (T.ox - from.ox) * e, oy: from.oy + (T.oy - from.oy) * e };
      redraw();
      if (u < 1) anim = requestAnimationFrame(step); else Vt = null;
    })(t0);
  }

  /* refit after a drag only when the circle no longer sits well in view */
  function fitIfNeeded() {
    var K = M.circle(S), g = region(), r = K.R * V.s;
    var outside = px(K.c - K.R) < g.l - 4 || px(K.c + K.R) > g.r + 4 || py(K.R) < g.t - 4 || py(-K.R) > g.b + 4;
    if (outside || r < 0.22 * Math.min(g.r - g.l, g.b - g.t)) fit(true);
  }

  /* ---------- drawing helpers ---------- */
  function niceStep(raw) {
    var p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  }
  function dot(c, x, y, r, fill, stroke) {
    c.beginPath(); c.arc(x, y, r, 0, 2 * Math.PI);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.lineWidth = 1.6; c.strokeStyle = stroke; c.stroke(); }
  }
  function line(c, x0, y0, x1, y1, color, w, dash) {
    c.save(); c.strokeStyle = color; c.lineWidth = w || 1; if (dash) c.setLineDash(dash);
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); c.restore();
  }
  /* arc between world angles a0 -> a1 (degrees, counter-clockwise +), with an arrow head */
  function arcArrow(c, x, y, r, a0, a1, color, label, lw, atEnd) {
    if (Math.abs(a1 - a0) < 0.3) return;
    c.save(); c.strokeStyle = color; c.fillStyle = color; c.lineWidth = lw || 1.4;
    c.beginPath(); c.arc(x, y, r, -a0 * D2R, -a1 * D2R, a1 > a0); c.stroke();
    var e = a1 * D2R, dir = a1 > a0 ? 1 : -1;
    var hx = x + r * Math.cos(e), hy = y - r * Math.sin(e);
    var tx = -Math.sin(e) * dir, ty = -Math.cos(e) * dir;   /* screen tangent, direction of travel */
    c.beginPath();
    c.moveTo(hx, hy);
    c.lineTo(hx - 7 * tx + 3.5 * ty, hy - 7 * ty - 3.5 * tx);
    c.lineTo(hx - 7 * tx - 3.5 * ty, hy - 7 * ty + 3.5 * tx);
    c.closePath(); c.fill();
    if (label) {
      /* at the end: step past the ray by ~16 px so the text clears the line drawn along it */
      var m = (atEnd ? a1 + (a1 > a0 ? 1 : -1) * (16 / r) * R2D : (a0 + a1) / 2) * D2R, lr = r + (atEnd ? 4 : 12);
      var lx = x + lr * Math.cos(m), ly = y - lr * Math.sin(m);
      c.font = '600 13px system-ui, sans-serif';
      c.textAlign = Math.cos(m) > 0.3 ? 'left' : Math.cos(m) < -0.3 ? 'right' : 'center';
      c.textBaseline = Math.sin(m) > 0.3 ? 'bottom' : Math.sin(m) < -0.3 ? 'top' : 'middle';
      halo(c, label, lx, ly);
    }
    c.restore();
  }
  function halo(c, text, x, y) { c.fillText(text, x, y); }   /* plain fill: no outline round the text */
  /* text placed just outside a circle point, away from the centre */
  function labelOut(c, text, x, y, ang, color, gap) {
    gap = gap || 12;
    var lx = x + gap * Math.cos(ang), ly = y - gap * Math.sin(ang);
    c.font = '600 13px system-ui, sans-serif'; c.fillStyle = color;
    c.textAlign = Math.cos(ang) > 0.35 ? 'left' : Math.cos(ang) < -0.35 ? 'right' : 'center';
    c.textBaseline = Math.sin(ang) > 0.35 ? 'bottom' : Math.sin(ang) < -0.35 ? 'top' : 'middle';
    halo(c, text, lx, ly);
  }
  function pt(p) { return '(' + f1(p.s) + ', ' + f1(p.t) + ')'; }

  /* ---------- Mohr plot ---------- */
  var hover = null, drag = null;

  function points() {
    var K = M.circle(S), Y = M.stress(S, S.th), X = M.stress(S, S.th + 90);
    return { K: K, Y: Y, X: X, H: M.stress(S, S.th0), Vv: M.stress(S, S.th0 + 90), Q: S.aon ? M.stress(S, S.a) : null };
  }

  function drawPlot() {
    var c = plot.begin(), W = plot.W, H = plot.H, P = points(), K = P.K;
    var cx = px(K.c), cy = py(0), r = K.R * V.s;

    /* grid + axes through the origin */
    var step = niceStep(70 / V.s);
    c.font = '12px system-ui, sans-serif';
    c.lineWidth = 1;
    var sMin = wx(0), sMax = wx(W), tMin = wy(H), tMax = wy(0), v;
    c.strokeStyle = C.line; c.globalAlpha = 0.55;
    c.beginPath();
    for (v = Math.ceil(sMin / step) * step; v <= sMax; v += step) { c.moveTo(Math.round(px(v)) + 0.5, 0); c.lineTo(Math.round(px(v)) + 0.5, H); }
    for (v = Math.ceil(tMin / step) * step; v <= tMax; v += step) { c.moveTo(0, Math.round(py(v)) + 0.5); c.lineTo(W, Math.round(py(v)) + 0.5); }
    c.stroke(); c.globalAlpha = 1;

    /* tau axis at sigma = 0, or broken and moved to the plot's edge when 0 is off to the side */
    var g = region(), broken = px(0) < g.l - 30 || px(0) > g.r + 20;
    var ax = broken ? (px(0) < g.l ? g.l - 14 : g.r + 6) : px(0), ay = Math.min(Math.max(py(0), 0), H);
    line(c, 0, Math.round(ay) + 0.5, W, Math.round(ay) + 0.5, C.ink, 1.3);
    line(c, Math.round(ax) + 0.5, 0, Math.round(ax) + 0.5, H, C.ink, 1.3);
    if (broken) {                                   /* break mark on the sigma axis */
      c.save(); c.fillStyle = C.bg; c.fillRect(ax + 6, ay - 7, 9, 14);
      c.strokeStyle = C.ink; c.lineWidth = 1.3; c.beginPath();
      c.moveTo(ax + 3, ay + 6); c.lineTo(ax + 9, ay - 6); c.moveTo(ax + 12, ay + 6); c.lineTo(ax + 18, ay - 6);
      c.stroke(); c.restore();
    }
    c.fillStyle = C.muted;
    c.textAlign = 'center'; c.textBaseline = 'top';
    for (v = Math.ceil(sMin / step) * step; v <= sMax; v += step) {
      if (Math.abs(v) < step / 2) continue;
      var tx = px(v); if (tx < 30 || tx > W - 30 || (broken && Math.abs(tx - ax) < 26)) continue;
      halo(c, String(+v.toPrecision(6)), tx, ay + 4);
    }
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (v = Math.ceil(tMin / step) * step; v <= tMax; v += step) {
      if (Math.abs(v) < step / 2) continue;
      var ty = py(v); if (ty < 14 || ty > H - 14) continue;
      if (broken) { c.textAlign = 'left'; halo(c, String(+v.toPrecision(6)), ax + 5, ty); }
      else halo(c, String(+v.toPrecision(6)), ax - 5, ty);
    }
    c.fillStyle = C.ink; c.font = '600 15px system-ui, sans-serif';
    c.textAlign = 'right'; c.textBaseline = 'bottom';
    halo(c, 'σ [' + S.u + ']', W - 8, ay - 4);
    c.textAlign = 'left'; c.textBaseline = 'top';
    halo(c, 'τ [' + S.u + ']', ax + 8, 6);

    /* circle */
    c.save();
    c.beginPath(); c.arc(cx, cy, Math.max(r, 0.5), 0, 2 * Math.PI);
    c.globalAlpha = 0.07; c.fillStyle = C.circle; c.fill(); c.globalAlpha = 1;
    c.lineWidth = hover === 'rim' || (drag && drag.mode === 'rim') ? 3.2 : 2.2;
    c.strokeStyle = C.circle; c.stroke();
    c.restore();
    var moving = hover === 'move' || (drag && drag.mode === 'move');
    if (S.cen) {                                   /* centre = mean stress */
      dot(c, cx, cy, moving ? 6.5 : 5.5, C.circle, C.bg);
      c.font = '600 13px system-ui, sans-serif'; c.fillStyle = C.circle; c.textAlign = 'left'; c.textBaseline = 'top';
      halo(c, 'σm = ' + f1(K.c), cx + 7, cy + 18);
    } else if (moving) dot(c, cx, cy, 4, C.circle);

    var Yp = { x: px(P.Y.s), y: py(P.Y.t) }, Xp = { x: px(P.X.s), y: py(P.X.t) };
    var phiY = Math.atan2(P.Y.t, P.Y.s - K.c), phiX = Math.atan2(P.X.t, P.X.s - K.c);
    var Pole = { x: px(K.pole.s), y: py(K.pole.t) };
    var showOrig = S.orig && Math.abs(norm90(S.th - S.th0)) > 0.05;

    /* principal stresses + max shear (markers first, lines below the main points) */
    if (S.pr) {
      line(c, px(K.s3), cy, px(K.s1), cy, C.pr, 2.4);
      dot(c, px(K.s1), cy, 5.5, C.pr); dot(c, px(K.s3), cy, 5.5, C.pr);
      c.fillStyle = C.pr; c.font = '600 13px system-ui, sans-serif'; c.textBaseline = 'top';
      c.textAlign = 'left'; halo(c, 'σ₁ = ' + f1(K.s1), px(K.s1) + 6, cy + 18);
      c.textAlign = 'right'; halo(c, 'σ₃ = ' + f1(K.s3), px(K.s3) - 6, cy + 18);
    }
    if (S.ts) {
      line(c, cx, py(K.R), cx, py(-K.R), C.ts, 1.4, [6, 4]);
      dot(c, cx, py(K.R), 5.5, C.ts); dot(c, cx, py(-K.R), 5.5, C.ts);
      c.fillStyle = C.ts; c.font = '600 13px system-ui, sans-serif'; c.textAlign = 'left';
      c.textBaseline = 'bottom'; halo(c, 'τmax = ' + f1(K.R), cx + 7, py(K.R) - 5);
      c.textBaseline = 'top'; halo(c, '−τmax', cx + 7, py(-K.R) + 5);
    }

    if (!S.pole) {
      /* angles at the centre, measured from the original element's y0 point (2 x the physical angle) */
      var rr = Math.max(18, Math.min(r * 0.32, 60)), ref = K.phi0 + 2 * S.th0, o0 = Math.abs(S.th0) > 0.05;
      function rel(a) { return 2 * norm90(a - S.th0); }
      function lab(n) { return o0 ? '2(' + n + '−θ₀) = ' : '2' + n + ' = '; }
      if (showOrig) arcArrow(c, cx, cy, rr, ref, ref + rel(S.th), C.y, lab('θ') + fa(rel(S.th)));
      if (S.pr) arcArrow(c, cx, cy, rr + 22, ref, ref + rel(K.a1), C.pr, lab('α₁') + fa(rel(K.a1)));
      if (S.ts) arcArrow(c, cx, cy, rr + 44, ref, ref + rel(K.aT), C.ts, lab('α') + fa(rel(K.aT)));
      if (P.Q) {
        line(c, cx, cy, px(P.Q.s), py(P.Q.t), C.q, 1.6, [5, 4]);
        arcArrow(c, cx, cy, rr + 66, ref, ref + rel(S.a), C.q, lab('α') + fa(rel(S.a)));
      }
    } else {
      /* pole: lines parallel to the planes through their points meet at the pole */
      var Hp = { x: px(P.H.s), y: py(P.H.t) }, Vp = { x: px(P.Vv.s), y: py(P.Vv.t) };
      line(c, Hp.x, Hp.y, Pole.x, Pole.y, C.muted, 1.3, [6, 4]);
      line(c, Vp.x, Vp.y, Pole.x, Pole.y, C.muted, 1.3, [6, 4]);
      poleRay(c, Pole, P.Y, S.th, C.y, 'θ = ' + fa(S.th), 2.2, 36);
      poleRay(c, Pole, P.X, S.th + 90, C.x, null, 1.6, 0);
      if (S.pr) {
        poleRay(c, Pole, { s: K.s1, t: 0 }, K.a1, C.pr, 'α₁ = ' + fa(K.a1), 1.4, 66, [7, 4]);
        poleRay(c, Pole, { s: K.s3, t: 0 }, K.a3, C.pr, null, 1.4, 0, [7, 4]);
      }
      if (S.ts) {
        poleRay(c, Pole, { s: K.c, t: K.R }, K.aT, C.ts, 'α = ' + fa(K.aT), 1.4, 96, [3, 4]);
      }
      if (P.Q) poleRay(c, Pole, P.Q, S.a, C.q, 'α = ' + fa(norm90(S.a)), 1.8, 126, [5, 4]);
    }

    /* the original element's planes (theta0 and theta0 + 90) */
    if (showOrig || S.pole) {
      var Hq = { x: px(P.H.s), y: py(P.H.t) }, Vq = { x: px(P.Vv.s), y: py(P.Vv.t) };
      dot(c, Hq.x, Hq.y, 5, C.bg, C.muted); dot(c, Vq.x, Vq.y, 5, C.bg, C.muted);
      if (showOrig) {
        labelOut(c, 'y₀ ' + pt(P.H), Hq.x, Hq.y, Math.atan2(P.H.t, P.H.s - K.c), C.muted, 10);
        labelOut(c, 'x₀ ' + pt(P.Vv), Vq.x, Vq.y, Math.atan2(P.Vv.t, P.Vv.s - K.c), C.muted, 10);
      }
    }

    /* the element's two planes */
    line(c, Xp.x, Xp.y, Yp.x, Yp.y, C.ink, 1.2);
    var hy = hover === 'y' || (drag && drag.mode === 'y'), hx = hover === 'x' || (drag && drag.mode === 'x');
    dot(c, Xp.x, Xp.y, hx ? 9 : 7, C.x, C.bg);
    dot(c, Yp.x, Yp.y, hy ? 9 : 7, C.y, C.bg);
    labelOut(c, 'x′ ' + pt(P.X), Xp.x, Xp.y, phiX, C.x, 14);
    labelOut(c, 'y′ ' + pt(P.Y), Yp.x, Yp.y, phiY, C.y, 14);

    if (P.Q) {
      var Qp = { x: px(P.Q.s), y: py(P.Q.t) }, hq = hover === 'q' || (drag && drag.mode === 'q');
      c.save(); c.translate(Qp.x, Qp.y); c.rotate(Math.PI / 4);
      c.fillStyle = C.q; c.strokeStyle = C.bg; c.lineWidth = 1.6;
      var q = hq ? 7.5 : 6; c.fillRect(-q, -q, 2 * q, 2 * q); c.strokeRect(-q, -q, 2 * q, 2 * q);
      c.restore();
      labelOut(c, 'α: ' + pt(P.Q), Qp.x, Qp.y, Math.atan2(P.Q.t, P.Q.s - K.c), C.q, 14);
    }

    if (S.pole) {
      c.save(); c.translate(Pole.x, Pole.y);
      c.fillStyle = C.ink; c.strokeStyle = C.bg; c.lineWidth = 2;
      c.beginPath();
      for (var k = 0; k < 10; k++) {
        var rad = k % 2 ? 4 : 9, an = -Math.PI / 2 + k * Math.PI / 5;
        c.lineTo(rad * Math.cos(an), rad * Math.sin(an));
      }
      c.closePath(); c.stroke(); c.fill(); c.restore();
      var pa = Math.atan2(K.pole.t, K.pole.s - K.c);
      labelOut(c, 'Pole ' + pt(K.pole), Pole.x, Pole.y, pa + (Math.cos(pa) > 0 ? -0.6 : 0.6), C.ink, 16);
    }
  }

  /* line from the pole through a point (parallel to the plane at angle a) + its angle */
  function poleRay(c, Pole, p, a, color, label, w, arcR, dash) {
    var tx = px(p.s), ty = py(p.t), dx = tx - Pole.x, dy = ty - Pole.y, L = Math.hypot(dx, dy);
    var ux = Math.cos(a * D2R), uy = -Math.sin(a * D2R);           /* screen direction of the plane */
    if (L > 1) { ux = dx / L; uy = dy / L; }
    var ext = 26;
    line(c, Pole.x - ux * ext, Pole.y - uy * ext, tx + ux * ext, ty + uy * ext, color, w, dash);
    if (!label || !arcR) return;
    var dirW = Math.atan2(-uy, ux) * R2D;                          /* world angle of the ray towards the point */
    var ref = Math.round((dirW - norm90(a)) / 180) * 180;          /* horizontal ray on the same side (0 or 180) */
    c.save(); c.setLineDash([]);
    line(c, Pole.x, Pole.y, Pole.x + Math.cos(ref * D2R) * (arcR + 10), Pole.y, color, 1, [2, 3]);
    arcArrow(c, Pole.x, Pole.y, arcR, ref, ref + norm90(a), color, label, 1.4, true);
    c.restore();
  }

  /* ---------- element ---------- */
  function drawElement() {
    var c = elem.begin(), W = elem.W, H = elem.H, P = points(), K = P.K;
    var ox = W / 2, oy = H / 2 + 2, h = 34, th = S.th * D2R;
    var Mx = Math.max(Math.abs(K.s1), Math.abs(K.s3), K.R, 1e-9);

    /* world (y up) -> screen */
    function sp(x, y) { return [ox + x, oy - y]; }
    function rot(x, y) { return [x * Math.cos(th) - y * Math.sin(th), x * Math.sin(th) + y * Math.cos(th)]; }

    /* original axes, rotated axes, theta */
    c.font = '12px system-ui, sans-serif';
    var a1 = sp(-92, 0), a2 = sp(92, 0), b1 = sp(0, -92), b2 = sp(0, 92);
    line(c, a1[0], a1[1], a2[0], a2[1], C.muted, 1, [3, 3]);
    line(c, b1[0], b1[1], b2[0], b2[1], C.muted, 1, [3, 3]);
    c.fillStyle = C.muted; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText('x', a2[0] + 3, a2[1]);
    c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText('y', b2[0], b2[1] - 1);
    if (Math.abs(S.th) > 0.05) {
      var e1 = rot(84, 0), e2 = rot(0, 84);
      var q1 = sp(e1[0], e1[1]), q2 = sp(e2[0], e2[1]);
      line(c, ox, oy, q1[0], q1[1], C.ink, 1);
      line(c, ox, oy, q2[0], q2[1], C.ink, 1);
      c.fillStyle = C.ink; c.textAlign = 'center'; c.textBaseline = 'middle';
      var l1 = rot(80, -9), l2 = rot(-9, 80), t1 = sp(l1[0], l1[1]), t2 = sp(l2[0], l2[1]);
      c.fillText('x′', t1[0], t1[1]); c.fillText('y′', t2[0], t2[1]);
      arcArrow(c, ox, oy, 74, 0, S.th, C.ink, null, 1.2);
    }

    /* the square */
    c.save(); c.translate(ox, oy); c.rotate(-th);
    c.fillStyle = 'rgba(214, 160, 110, 0.55)'; c.strokeStyle = C.ink; c.lineWidth = 1.5;
    c.fillRect(-h, -h, 2 * h, 2 * h); c.strokeRect(-h, -h, 2 * h, 2 * h);
    c.restore();
    if (Math.abs(norm90(S.th - S.th0)) > 0.05) {            /* the original element, dashed */
      c.save(); c.translate(ox, oy); c.rotate(-S.th0 * D2R);
      c.strokeStyle = C.muted; c.lineWidth = 1.2; c.setLineDash([4, 3]);
      c.strokeRect(-h, -h, 2 * h, 2 * h);
      c.restore();
    }

    /* faces: outward normal n (world), stress on that face; label two of them */
    var faces = [
      { n: rot(0, 1), st: P.Y, col: C.y, lab: true },
      { n: rot(0, -1), st: P.Y, col: C.y },
      { n: rot(1, 0), st: P.X, col: C.x, lab: true },
      { n: rot(-1, 0), st: P.X, col: C.x }
    ];
    faces.forEach(function (f) {
      var nx = f.n[0], ny = f.n[1], tx = -ny, ty = nx;                 /* t: n turned counter-clockwise */
      /* normal stress: arrows point at the face for compression */
      if (Math.abs(f.st.s) > 1e-6 * Mx) {
        var L = 10 + 24 * Math.abs(f.st.s) / Mx, gap = 13;
        var near = [nx * (h + gap), ny * (h + gap)], far = [nx * (h + gap + L), ny * (h + gap + L)];
        if (f.st.s > 0) arrow(c, sp(far[0], far[1]), sp(near[0], near[1]), f.col, 2);
        else arrow(c, sp(near[0], near[1]), sp(far[0], far[1]), f.col, 2);
        if (f.lab) {
          var lp = sp(nx * (h + gap + L + 12), ny * (h + gap + L + 12));
          c.font = '600 12px system-ui, sans-serif'; c.fillStyle = f.col; c.textAlign = 'center'; c.textBaseline = 'middle';
          halo(c, f1(Math.abs(f.st.s)), lp[0], lp[1]);
        }
      }
      /* shear: along +t on this face when positive (counter-clockwise couple) */
      if (Math.abs(f.st.t) > 1e-6 * Mx) {
        var l = Math.min(2 * h - 4, 14 + 40 * Math.abs(f.st.t) / Mx), sg = f.st.t > 0 ? 1 : -1, off = h + 6;
        var p0 = [nx * off - tx * sg * l / 2, ny * off - ty * sg * l / 2];
        var p1 = [nx * off + tx * sg * l / 2, ny * off + ty * sg * l / 2];
        arrow(c, sp(p0[0], p0[1]), sp(p1[0], p1[1]), f.col, 1.6, true);
        if (f.lab) {
          var side = 1;                                                 /* label beside the arrow head */
          var lq = sp(p1[0] + nx * 12 * side + tx * sg * 6, p1[1] + ny * 12 * side + ty * sg * 6);
          c.font = 'italic 600 12px system-ui, sans-serif'; c.fillStyle = f.col; c.textAlign = 'center'; c.textBaseline = 'middle';
          halo(c, f1(Math.abs(f.st.t)), lq[0], lq[1]);
        }
      }
    });

    c.font = '12px system-ui, sans-serif'; c.fillStyle = C.muted; c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillText('θ = ' + fa(S.th), 6, 4);
    c.textAlign = 'right';
    c.fillText(S.u, W - 6, 4);
  }

  function arrow(c, a, b, color, w, half) {
    var dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    if (L < 1) return;
    var ux = dx / L, uy = dy / L, hl = Math.min(7, L * 0.6);
    c.save(); c.strokeStyle = color; c.fillStyle = color; c.lineWidth = w;
    c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0] - ux * hl * 0.6, b[1] - uy * hl * 0.6); c.stroke();
    c.beginPath(); c.moveTo(b[0], b[1]);
    c.lineTo(b[0] - ux * hl - uy * hl * 0.45, b[1] - uy * hl + ux * hl * 0.45);
    c.lineTo(b[0] - ux * hl + uy * hl * 0.45, b[1] - uy * hl - ux * hl * 0.45);
    c.closePath(); c.fill(); c.restore();
  }

  /* ---------- tensor + readouts ---------- */
  function mat(a, b, cc, d) {
    return '<span class="mc-mat"><span>' + f1(a) + '</span><span>' + f1(b) + '</span><span>' + f1(cc) +
      '</span><span>' + f1(d) + '</span></span>';
  }

  function drawTensor() {
    var P = points(), K = P.K;
    /* tensor shear: the x' face value, written in both off-diagonal places (the tensor is symmetric) */
    var h = '<div class="mc-card-head">Stress tensor <span class="mc-sub">[' + S.u + ']</span></div>' +
      '<div class="mc-trow"><span>σ<sub>x′y′</sub> =</span>' + mat(P.X.s, P.X.t, P.X.t, P.Y.s) +
      '<span class="mc-sub" style="color:var(--vl-muted);font-size:12px">θ = ' + fa(S.th) + '</span></div>';
    if (S.pr) {
      h += '<div class="mc-trow"><span>σ<sub>1,3</sub> =</span>' + mat(K.s3, 0, 0, K.s1) +
        '<span class="mc-sub" style="color:var(--vl-muted);font-size:12px">θ = α<sub>1</sub> = ' + fa(K.a1) + '</span></div>';
    }
    tensorEl.innerHTML = h;
  }

  function drawPanel() {
    var P = points(), K = P.K, u = ' ' + S.u;
    var rows = [
      ['σ<sub>m</sub> (centre)', f1(K.c) + u],
      ['R = τ<sub>max</sub>', f1(K.R) + u],
      ['<span style="color:var(--mc-pr)">σ<sub>1</sub></span>', f1(K.s1) + u],
      ['<span style="color:var(--mc-pr)">σ<sub>3</sub></span>', f1(K.s3) + u],
      ['plane of σ<sub>1</sub>, α<sub>1</sub>', fa(K.a1)],
      ['plane of σ<sub>3</sub>, α<sub>3</sub>', fa(K.a3)],
      ['plane of +τ<sub>max</sub>', fa(K.aT)],
      ['pole', pt(K.pole)],
      ['<span style="color:var(--mc-y)">y′ face (θ)</span>', pt(P.Y)],
      ['<span style="color:var(--mc-x)">x′ face (θ+90°)</span>', pt(P.X)]
    ];
    document.getElementById('res').innerHTML = '<dl class="vl-results">' + rows.map(function (r) {
      return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>';
    }).join('') + '</dl>';
    if (P.Q) {
      document.getElementById('aread').innerHTML = '<dl class="vl-results">' +
        '<dt>σ<sub>α</sub></dt><dd style="color:var(--mc-q)">' + f1(P.Q.s) + u + '</dd>' +
        '<dt>τ<sub>α</sub></dt><dd style="color:var(--mc-q)">' + f1(P.Q.t) + u + '</dd></dl>';
    }
    document.getElementById('elemTitle').textContent = Math.abs(norm90(S.th - S.th0)) < 0.05
      ? '(original, θ₀ = ' + fa(S.th0) + ')' : '(original at θ₀ = ' + fa(S.th0) + ')';
  }

  /* ---------- inputs on the element card ---------- */
  var IN = { sx: document.getElementById('in-sx'), sy: document.getElementById('in-sy'),
    txy: document.getElementById('in-txy'), th: document.getElementById('in-th') };
  /* the boxes show the element as drawn (at theta): sigma_x', sigma_y', tau_x'y' */
  function current() {
    var X = M.stress(S, S.th + 90), Y = M.stress(S, S.th);
    return { sx: X.s, sy: Y.s, txy: X.t, th: S.th };
  }
  function syncInputs() {
    var cur = current();
    Object.keys(IN).forEach(function (k) {
      if (document.activeElement !== IN[k]) IN[k].value = +r1(cur[k]).toFixed(1);
    });
  }
  Object.keys(IN).forEach(function (k) {
    IN[k].addEventListener('change', function () {
      var v = Number(IN[k].value);
      if (!isFinite(v) || IN[k].value === '') { syncInputs(); return; }
      if (k === 'th') { setTheta(norm90(v)); return; }
      /* typing a stress makes the element as drawn the new original element: theta0 = theta */
      var L = current(), t = S.th;
      L[k] = v;
      var Xg = M.stress(L, 90 - t), Yg = M.stress(L, -t);       /* back to the horizontal frame */
      S.th0 = t;
      setStress({ sx: Xg.s, sy: Yg.s, txy: Xg.t });
    });
    IN[k].addEventListener('keydown', function (e) { if (e.key === 'Enter') IN[k].blur(); });
  });

  function setTheta(t) { S.th = Math.round(norm90(t) * 10) / 10; syncInputs(); redraw(); saveHash(); }
  function setStress(o) { S.sx = o.sx; S.sy = o.sy; S.txy = o.txy; syncInputs(); fit(true); saveHash(); }

  /* ---------- pointer: Mohr plot ---------- */
  var mcv = plot.cv;
  function hit(e) {
    var r = mcv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    var P = points(), K = P.K;
    function near(p, tol) { return Math.hypot(px(p.s) - x, py(p.t) - y) <= tol; }
    if (P.Q && near(P.Q, 11)) return 'q';
    if (near(P.Y, 11)) return 'y';
    if (near(P.X, 11)) return 'x';
    var d = Math.hypot(x - px(K.c), y - py(0)), rr = K.R * V.s;
    if (Math.abs(d - rr) <= 7) return 'rim';
    if (d < rr) return 'move';
    return null;
  }
  function world(e) {
    var r = mcv.getBoundingClientRect();
    return { s: wx(e.clientX - r.left), t: wy(e.clientY - r.top) };
  }
  var CURSOR = { y: 'grab', x: 'grab', q: 'grab', rim: 'nwse-resize', move: 'ew-resize' };

  mcv.addEventListener('pointermove', function (e) {
    if (drag) { dragTo(e); return; }
    var h = hit(e);
    if (h !== hover) { hover = h; mcv.style.cursor = h ? CURSOR[h] : 'default'; redraw(); }
  });
  mcv.addEventListener('pointerleave', function () { if (!drag && hover) { hover = null; redraw(); } });
  mcv.addEventListener('pointerdown', function (e) {
    var h = hit(e);
    if (!h) return;
    e.preventDefault();
    try { mcv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
    var K = M.circle(S), w = world(e);
    drag = { mode: h, K: K, s0: w.s };
    if (h === 'y' || h === 'x' || h === 'q') mcv.style.cursor = 'grabbing';
    redraw();
  });
  function endDrag() {
    if (!drag) return;
    var m = drag.mode; drag = null;
    if (m === 'rim' || m === 'move') fitIfNeeded();
    redraw(); saveHash();
  }
  mcv.addEventListener('pointerup', endDrag);
  mcv.addEventListener('pointercancel', endDrag);

  function dragTo(e) {
    var w = world(e), K = drag.K;
    if (drag.mode === 'y' || drag.mode === 'x' || drag.mode === 'q') {
      var phi = Math.atan2(w.t, w.s - K.c) * R2D;
      var a = (phi - K.phi0) / 2 - (drag.mode === 'x' ? 90 : 0);
      if (e.shiftKey) a = Math.round(a / 5) * 5;
      if (drag.mode === 'q') { ui.set('a', Math.round(norm90(a) * 10) / 10); }
      else { S.th = Math.round(norm90(a) * 10) / 10; syncInputs(); }
    } else if (drag.mode === 'rim') {
      var R = Math.max(Math.hypot(w.s - K.c, w.t), 0.5 / V.s);
      var o = M.fromCircle(K.c, R, K.phi0);
      S.sx = r1(o.sx); S.sy = r1(o.sy); S.txy = r1(o.txy); syncInputs();
    } else if (drag.mode === 'move') {
      var cNew = K.c + (w.s - drag.s0);
      var o2 = M.fromCircle(cNew, K.R, K.phi0);
      S.sx = r1(o2.sx); S.sy = r1(o2.sy); S.txy = r1(o2.txy); syncInputs();
    }
    redraw();
  }

  /* keyboard on the plot: arrows rotate */
  function keyRotate(e) {
    var st = e.shiftKey ? 5 : 1, k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowDown') { setTheta(S.th - st); e.preventDefault(); }
    else if (k === 'ArrowRight' || k === 'ArrowUp') { setTheta(S.th + st); e.preventDefault(); }
  }
  mcv.addEventListener('keydown', keyRotate);

  /* ---------- pointer: element (rotate) ---------- */
  var ecv = elem.cv, edrag = null;
  function eAngle(e) {
    var r = ecv.getBoundingClientRect();
    return Math.atan2(-(e.clientY - r.top - (elem.H / 2 + 2)), e.clientX - r.left - elem.W / 2) * R2D;
  }
  ecv.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    try { ecv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
    edrag = { a0: eAngle(e), th0: S.th };
    ecv.style.cursor = 'grabbing';
    ecv.focus({ preventScroll: true });
  });
  ecv.addEventListener('pointermove', function (e) {
    if (!edrag) return;
    var d = eAngle(e) - edrag.a0, t = edrag.th0 + d;
    if (e.shiftKey) t = Math.round(t / 5) * 5;
    S.th = Math.round(norm90(t) * 10) / 10; syncInputs(); redraw();
  });
  function eEnd() { if (edrag) { edrag = null; ecv.style.cursor = 'grab'; saveHash(); } }
  ecv.addEventListener('pointerup', eEnd);
  ecv.addEventListener('pointercancel', eEnd);
  ecv.addEventListener('keydown', keyRotate);

  /* ---------- hash ---------- */
  var saveTimer = 0;
  function saveHash() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      var o = {};
      Object.keys(S).forEach(function (k) { o[k] = typeof S[k] === 'number' ? Math.round(S[k] * 1000) / 1000 : S[k]; });
      VLab.Hash.write(o);
    }, 250);
  }

  /* ---------- frame ---------- */
  var queued = false;
  function redraw() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      drawPlot(); drawElement(); drawTensor(); drawPanel();
    });
  }

  function resize() {
    var a = plot.size(), b = elem.size();
    if (a) { V = targetView(); }
    if (a || b) redraw();
  }
  if (window.ResizeObserver) {
    new ResizeObserver(resize).observe(stage);
    new ResizeObserver(resize).observe(elem.cv.parentElement);
  }
  window.addEventListener('resize', resize);

  syncInputs();
  resize();
  fit(false);

  /* ---------- self test (?autotest=1) ---------- */
  M.selfTest = function () {
    var out = [], ok = true;
    function chk(name, got, want, tol) {
      var pass = Math.abs(got - want) <= (tol || 0.05);
      ok = ok && pass;
      out.push((pass ? 'ok   ' : 'FAIL ') + name + ': ' + got.toFixed(3) + ' (want ' + want + ')');
    }
    var s = { sx: 200, sy: 300, txy: -75 }, K = M.circle(s);
    chk('Ex 9.1 sigma_1', K.s1, 340.14);
    chk('Ex 9.1 sigma_3', K.s3, 159.86);
    chk('Ex 9.1 alpha_1', K.a1, -28.15);
    chk('Ex 9.1 sigma at 25', M.stress(s, 25).s, 224.69);
    chk('Ex 9.1 tau at 25', M.stress(s, 25).t, 86.51);
    chk('Ex 9.1 pole sigma', K.pole.s, 200); chk('Ex 9.1 pole tau', K.pole.t, 75);
    chk('horizontal plane sigma', M.stress(s, 0).s, 300); chk('horizontal plane tau', M.stress(s, 0).t, 75);
    chk('principal plane has no shear', M.stress(s, K.a1).t, 0, 1e-9);
    chk('principal plane sigma', M.stress(s, K.a1).s, K.s1, 1e-9);
    chk('max shear plane tau', M.stress(s, K.aT).t, K.R, 1e-9);
    /* pole property: line from the pole to the point of plane a is parallel to that plane */
    [10, 25, 47, 80, -35].forEach(function (a) {
      var q = M.stress(s, a), dir = Math.atan2(q.t - K.pole.t, q.s - K.pole.s) * R2D;
      chk('pole ray parallel to plane ' + a, norm90(dir - a), 0, 1e-9);
    });
    var b = M.fromCircle(K.c, K.R, K.phi0);
    chk('round trip sx', b.sx, 200, 1e-9); chk('round trip sy', b.sy, 300, 1e-9); chk('round trip txy', b.txy, -75, 1e-9);
    out.unshift(ok ? 'ALL PASS' : 'FAILURES');
    return out.join('\n');
  };
  if (/[?&]autotest=1/.test(qs)) {
    var pre = document.getElementById('selftest');
    pre.hidden = false; pre.textContent = M.selfTest();
  }
})(window.VLab = window.VLab || {});
