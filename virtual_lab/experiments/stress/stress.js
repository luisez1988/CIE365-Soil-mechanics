/* Virtual Lab experiment: vertical stress increment beneath surface loads.
   Loads are placed in a plan view (x, y). A vertical section A–A′ through the
   plan shows Δσz(s, z) as a banded colour map, where s is the coordinate along
   the section (x or y). A vertical and a horizontal line in the section give
   the two profiles, plotted on charts that share the section's axes.
   Physics: VLab.Boussinesq (closed forms superposed). The results always belong
   to the last run: with Auto-run off, edits to loads or to the section mark
   the field as out of date until Run is pressed. */
(function (VLab) {
  'use strict';

  var BQ = VLab.Boussinesq;

  var TYPES = {
    point:  { name: 'Point', unit: 'kN', qLabel: 'Q (kN)', q: 100 },
    line:   { name: 'Line', unit: 'kN/m', qLabel: 'q (kN/m)', q: 50, L: 6, inf: false, rot: true, canInf: true },
    strip:  { name: 'Strip', unit: 'kPa', qLabel: 'q (kPa)', q: 100, B: 2, L: 10, inf: true, rot: true, canInf: true },
    rect:   { name: 'Rectangle', unit: 'kPa', qLabel: 'q (kPa)', q: 100, B: 2.5, L: 2.5, rot: true },
    tri:    { name: 'Triangular', unit: 'kPa', qLabel: 'q<sub>max</sub> (kPa)', q: 100, B: 4, L: 10, inf: true, rot: true, canInf: true },
    circle: { name: 'Circle', unit: 'kPa', qLabel: 'q (kPa)', q: 100, r: 1.5 }
  };
  var ORDER = ['point', 'line', 'strip', 'rect', 'tri', 'circle'];
  var CODE = { point: 'p', line: 'l', strip: 's', rect: 'r', tri: 't', circle: 'c' };
  var FROM_CODE = { p: 'point', l: 'line', s: 'strip', r: 'rect', t: 'tri', c: 'circle' };
  /* categorical slots, assigned per load and kept for its life (colour follows the load) */
  var SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
  var SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
  var MAX_LOADS = 8, MAX_PTS = 8, NX = 161, HIT = 9, HEAD = 0.2;   /* HEAD: room above the section for the loads */

  if (/[?&]embed=1/.test(location.search)) document.body.classList.add('vl-embed');
  var theme = /[?&]theme=(light|dark)/.exec(location.search);
  if (theme) document.documentElement.setAttribute('data-theme', theme[1]);

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function dark() { return css('color-scheme') === 'dark'; }
  function slotColor(ld) { return (dark() ? SERIES_DARK : SERIES)[ld.slot % SERIES.length]; }
  function rgba(hex, a) {
    return 'rgba(' + parseInt(hex.slice(1, 3), 16) + ',' + parseInt(hex.slice(3, 5), 16) + ',' +
      parseInt(hex.slice(5, 7), 16) + ',' + a + ')';
  }
  function snap(v, d) { return Math.round(v / d) * d; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function num(v, d) { return isFinite(v) ? Number(v).toFixed(d) : '–'; }
  function sig(v) {
    if (!isFinite(v)) return '–';
    var a = Math.abs(v);
    return a === 0 ? '0' : a >= 100 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : a >= 0.01 ? v.toFixed(3) : v.toExponential(2);
  }
  function signed(v) { return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ---------- loads ---------- */
  var loads = [], selId = 0, nextId = 1;

  function freeSlot() {
    for (var s = 0; s < SERIES.length; s++) {
      if (!loads.some(function (l) { return l.slot === s; })) return s;
    }
    return loads.length % SERIES.length;
  }

  function makeLoad(type, x, y, o) {
    var t = TYPES[type];
    var ld = { id: nextId++, slot: freeSlot(), type: type, q: t.q, cx: r2(x), cy: r2(y), angle: 0,
      B: t.B || 0, L: t.L || 0, r: t.r || 0, inf: !!t.inf };
    if (o) Object.keys(o).forEach(function (k) { ld[k] = o[k]; });
    return ld;
  }

  function byId(list, id) {
    for (var k = 0; k < list.length; k++) if (list[k].id === id) return list[k];
    return null;
  }
  function selected() { return byId(loads, selId); }
  function clone(ld) { var o = {}; Object.keys(ld).forEach(function (k) { o[k] = ld[k]; }); return o; }
  function label(ld, list) { return '#' + ((list || loads).indexOf(ld) + 1) + ' ' + TYPES[ld.type].name; }
  function qText(ld) { return signed(ld.q) + ' ' + TYPES[ld.type].unit; }
  function describe(ld) {
    var t = TYPES[ld.type], s = t.name.toLowerCase() + ', ' + (ld.type === 'point' ? 'Q' : ld.type === 'tri' ? 'q_max' : 'q') +
      ' = ' + ld.q + ' ' + t.unit + ', centre (' + ld.cx + ', ' + ld.cy + ') m';
    if (ld.type === 'circle') return s + ', r0 = ' + ld.r + ' m';
    if (t.B) s += ', B = ' + ld.B + ' m';
    if (ld.type !== 'point') s += ld.inf ? ', infinitely long' : ', L = ' + ld.L + ' m';
    if (t.rot) s += ', rotation = ' + ld.angle + ' deg';
    return s;
  }

  function encodeLoads() {
    return loads.map(function (l) {
      return [CODE[l.type], l.q, l.cx, l.cy, l.angle, l.B, l.L, l.r, l.inf ? 1 : 0].join(',');
    }).join(';');
  }
  function decodeLoads(s) {
    var out = [];
    (s || '').split(';').forEach(function (t) {
      var a = t.split(','), type = FROM_CODE[a[0]], v = a.slice(1).map(Number);
      if (!type || v.length < 8 || v.slice(0, 7).some(function (x) { return !isFinite(x); }) || out.length >= MAX_LOADS) return;
      loads = out; /* freeSlot looks at the list being built */
      var ld = makeLoad(type, v[1], v[2], { q: v[0], angle: v[3], B: Math.max(0.05, v[4] || TYPES[type].B || 1),
        L: Math.max(0.05, v[5] || TYPES[type].L || 1), r: Math.max(0.05, v[6] || TYPES[type].r || 1), inf: v[7] === 1 && !!TYPES[type].canInf });
      out.push(ld);
    });
    return out;
  }

  /* Load frame -> plan. */
  function toPlan(ld, u, v) {
    var a = ld.angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [ld.cx + u * c - v * s, ld.cy + u * s + v * c];
  }

  /* ---------- controls ---------- */
  var schema = [
    { type: 'heading', label: 'Selected load' },
    { type: 'html', id: 'ld-edit' },

    { type: 'heading', label: 'Cross-section A–A′' },
    { type: 'select', key: 'sax', label: 'Section runs', value: 'x',
      options: [['x', 'along x (y fixed)'], ['y', 'along y (x fixed)']] },
    { type: 'number', key: 'sec', label: 'Section position (m)', value: 0, min: -1000, step: 'any' },
    { type: 'number', key: 'sl', label: 'Vertical profile at (m)', value: 0, min: -1000, step: 'any' },
    { type: 'number', key: 'zl', label: 'Horizontal profile depth z (m)', value: 2, min: 0, step: 'any' },
    { type: 'range', key: 'W', label: 'Plan half-width', min: 3, max: 50, step: 1, value: 6, unit: 'm' },
    { type: 'range', key: 'D', label: 'Section depth', min: 2, max: 40, step: 1, value: 8, unit: 'm' },

    { type: 'heading', label: 'Colour map' },
    { type: 'select', key: 'field', label: 'Field', value: 'ds',
      options: [['ds', 'Δσz (kPa)'], ['I', 'I of selected load']] },
    { type: 'range', key: 'nb', label: 'Colour bands', min: 2, max: 20, step: 1, value: 8 },
    { type: 'select', key: 'cmap', label: 'Colour map', value: 'auto',
      options: [['auto', 'auto']].concat(VLab.colormap.names.map(function (n) { return [n, n]; })) },
    { type: 'select', key: 'rng', label: 'Range', value: 'auto', options: [['auto', 'Automatic'], ['manual', 'Manual']] },
    { type: 'number', key: 'rmin', label: 'Minimum', value: 0, min: -1e6, step: 'any',
      visibleIf: function (s) { return s.rng === 'manual'; } },
    { type: 'number', key: 'rmax', label: 'Maximum', value: 16, min: -1e6, step: 'any',
      visibleIf: function (s) { return s.rng === 'manual'; } },
    { type: 'toggle', key: 'iso', label: 'Isobars at band edges', value: true },

    { type: 'heading', label: 'Profiles' },
    { type: 'select', key: 'pq', label: 'Plot', value: 'ds',
      options: [['ds', 'Δσz (kPa)'], ['I', 'I of selected load']] },
    { type: 'toggle', key: 'contrib', label: 'Show each load’s share', value: false,
      visibleIf: function (s) { return s.pq === 'ds'; } },

    { type: 'heading', label: 'Run' },
    { type: 'toggle', key: 'auto', label: 'Auto-run on every change', value: true },
    { type: 'buttons', items: [{ label: 'Run', id: 'run-btn', onClick: function () { run(); } }] },
    { type: 'html', id: 'run-state' },

    { type: 'heading', label: 'Points' },
    { type: 'buttons', items: [
      { label: 'Add point', id: 'pt-add', onClick: function () { setAddingPt(!addingPt); } },
      { label: 'Clear', onClick: function () { pts = []; pointsChanged(); } }
    ] },
    { type: 'html', id: 'pt-table' },

    { type: 'heading', label: 'Export CSV' },
    { type: 'buttons', items: [
      { label: 'Vertical profile', onClick: function () { exportProfile('v'); } },
      { label: 'Horizontal profile', onClick: function () { exportProfile('h'); } },
      { label: 'Points', onClick: function () { exportPoints(); } }
    ] },

    { type: 'heading', label: 'Model' },
    { type: 'html', id: 'notes' }
  ];

  var initial = VLab.Hash.read();
  var physicsKeys = { sax: 1, sec: 1, W: 1, D: 1, field: 1 };
  var colourKeys = { nb: 1, cmap: 1, rng: 1, rmin: 1, rmax: 1, iso: 1 };
  var ui = new VLab.Controls(document.getElementById('panel'), schema, function (s, key) {
    if (key === 'W' || key === 'D') setWorlds();
    if (physicsKeys[key]) markDirty();
    else if (colourKeys[key]) { recolor(); secView.render(); }
    else if (key === 'sl' || key === 'zl' || key === 'pq' || key === 'contrib') { profiles(); secView.render(); }
    else if (key === 'auto' && S.auto && stale) run();
    runState();
    planView.render();
    saveHash();
  }, initial);
  var S = ui.state;

  loads = decodeLoads(initial.ld);
  if (!initial.ld) loads = [makeLoad('rect', 0, 0, { q: 16 })];   /* Example 6.2: 100 kN on 2.5 m x 2.5 m */
  selId = loads.length ? loads[0].id : 0;

  var pts = [];
  (initial.pt || (initial.ld ? '' : '0,2;1.25,2')).split(';').forEach(function (t) {
    var a = t.split(',').map(Number);
    if (a.length === 2 && isFinite(a[0]) && isFinite(a[1]) && a[1] >= 0 && pts.length < MAX_PTS) pts.push({ s: a[0], z: a[1] });
  });

  var saveTimer = 0;
  function saveHash() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      var o = {};
      Object.keys(S).forEach(function (k) { o[k] = S[k]; });
      o.ld = encodeLoads();
      if (pts.length) o.pt = pts.map(function (p) { return r2(p.s) + ',' + r2(p.z); }).join(';');
      VLab.Hash.write(o);
    }, 250);
  }

  /* ---------- views ---------- */
  var planView = new VLab.View(document.getElementById('plan'),
    { xmin: -S.W, xmax: S.W, ymin: -S.W, ymax: S.W }, { margin: { l: 48, r: 10, t: 10, b: 32 } });
  var secView = new VLab.View(document.getElementById('sec'),
    { xmin: -S.W, xmax: S.W, ymin: -S.D, ymax: HEAD * S.D }, { margin: { l: 56, r: 86, t: 8, b: 42 } });

  function plotColors() { return { ink: css('--vl-ink'), grid: css('--vl-line'), bg: css('--vl-bg') }; }
  var zPlot = new VLab.Plot(document.getElementById('zprof'), {
    orient: 'v', margin: { l: 42, r: 12, t: 26, b: 34 }, colors: plotColors,
    posPx: function (z) { return secView.sy(-z); }, posInv: function (py) { return -secView.wy(py); }
  });
  var xPlot = new VLab.Plot(document.getElementById('xprof'), {
    orient: 'h', margin: { l: 56, r: 86, t: 14, b: 34 }, colors: plotColors,
    posPx: function (s) { return secView.sx(s); }, posInv: function (px) { return secView.wx(px); }
  });
  /* the profile charts borrow the section's mapping: redraw them whenever it changes */
  var secResize = secView.resize;
  secView.resize = function () { secResize.call(secView); zPlot.render(); xPlot.render(); };

  function setWorlds() {
    planView.world = { xmin: -S.W, xmax: S.W, ymin: -S.W, ymax: S.W };
    secView.world = { xmin: -S.W, xmax: S.W, ymin: -S.D, ymax: HEAD * S.D };
    planView.resize();
    secView.resize();
  }

  /* ---------- section geometry ---------- */
  function axisName(sax) { return (sax || S.sax) === 'x' ? 'x' : 'y'; }
  function otherName(sax) { return (sax || S.sax) === 'x' ? 'y' : 'x'; }
  function planXY(s, sec) { sec = sec || { sax: S.sax, pos: S.sec }; return sec.sax === 'x' ? [s, sec.pos] : [sec.pos, s]; }

  /* ---------- results (always for the last run) ---------- */
  var run0 = null, stale = true, raster = null, rasterKey = '', runCount = 0, field = null, grid = null;
  var range = { lo: 0, hi: 1, cmap: 'viridis' }, isobars = [];

  /* The load whose influence factor is shown, from the run snapshot. */
  function runSel() { return run0 ? byId(run0.loads, selId) : null; }

  function value(kind, x, y, z) {
    if (kind === 'I') { var ld = runSel(); return ld ? BQ.influence(ld, x, y, z) : NaN; }
    return BQ.total(run0.loads, x, y, z);
  }

  function run() {
    run0 = { loads: loads.map(clone), sec: { sax: S.sax, pos: S.sec }, W: S.W, D: S.D, field: S.field };
    var nz = Math.max(21, Math.min(161, Math.round((NX - 1) * S.D / (2 * S.W)) + 1));
    grid = new VLab.Grid2D({ x0: -S.W, x1: S.W, z0: 0, z1: S.D, nx: NX, nz: nz });
    field = new Float64Array(grid.n);
    var kind = S.field === 'I' && runSel() ? 'I' : 'ds', zmin = 0.25 * grid.dz;
    run0.kind = kind;
    for (var j = 0; j < nz; j++) {
      var z = Math.max(grid.z(j), zmin);
      for (var i = 0; i < NX; i++) {
        var p = planXY(grid.x(i), run0.sec);
        field[j * NX + i] = value(kind, p[0], p[1], z);
      }
    }
    runCount++;
    stale = false;
    recolor();
    profiles();
    pointsTable();
    runState();
    secView.render();
  }

  function singularRun() {
    if (run0.kind === 'I') { var ld = runSel(); return ld && ld.type === 'line'; }
    return run0.loads.some(BQ.singular);
  }

  function recolor() {
    if (!field) return;
    var lo, hi;
    if (S.rng === 'manual' && S.rmax > S.rmin) { lo = S.rmin; hi = S.rmax; }
    else {
      var v = Array.prototype.slice.call(field).filter(isFinite).sort(function (a, b) { return a - b; });
      lo = v.length ? v[0] : 0; hi = v.length ? v[v.length - 1] : 1;
      if (singularRun() && v.length) {   /* point / line loads are infinite at the surface: clip the tails */
        if (lo < 0) lo = v[Math.floor(0.02 * (v.length - 1))];
        if (hi > 0) hi = v[Math.ceil(0.98 * (v.length - 1))];
      }
      lo = Math.min(0, lo); hi = Math.max(0, hi);
      if (lo < 0) { var m = Math.max(-lo, hi); lo = -m; hi = m; }
      if (hi - lo < 1e-12) hi = lo + 1;
    }
    var name = S.cmap !== 'auto' ? S.cmap : lo < 0 ? 'RdBu_r' : 'viridis';
    range = { lo: lo, hi: hi, cmap: name, lut: VLab.colormap.banded(name, S.nb, lo, hi) };
    isobars = [];
    if (S.iso) {
      var xs = [], zs = [], k;
      for (k = 0; k < grid.nx; k++) xs.push(grid.x(k));
      for (k = 0; k < grid.nz; k++) zs.push(grid.z(k));
      for (var b = 1; b < S.nb; b++) {
        var seg = VLab.contour(field, grid.nx, grid.nz, xs, zs, lo + b * (hi - lo) / S.nb);
        for (k = 1; k < seg.length; k += 2) seg[k] = -seg[k];
        isobars = isobars.concat(seg);
      }
    }
    rasterKey = '';
  }

  var runTimer = 0;
  function markDirty() {
    stale = true;
    if (S.auto) {
      if (!runTimer) runTimer = requestAnimationFrame(function () { runTimer = 0; if (stale) run(); });
    } else {
      runState();
      secView.render();
    }
  }

  function runState() {
    var box = document.getElementById('run-state'), btn = document.getElementById('run-btn');
    btn.classList.toggle('vl-on', stale && !S.auto);
    box.innerHTML = stale && !S.auto
      ? '<p class="vs-hint"><span class="vs-badge">Out of date</span> Loads or section changed. Press <b>Run</b>.</p>'
      : '<p class="vs-hint">Results match the loads shown' + (run0 ? ' (run ' + runCount + ')' : '') + '.</p>';
    readout(null);
  }

  /* ---------- profiles ---------- */
  function profileData(dir, n) {
    var W = run0.W, D = run0.D, sl = Math.max(-W, Math.min(W, S.sl)), zl = Math.max(0, Math.min(D, S.zl));
    var zeps = D * 1e-3, out = { pos: [], total: [], parts: run0.loads.map(function () { return []; }), I: [] };
    var sel = runSel();
    for (var k = 0; k <= n; k++) {
      var s, z;
      if (dir === 'v') { z = D * k / n; s = sl; } else { s = -W + 2 * W * k / n; z = zl; }
      var ze = Math.max(z, zeps), p = planXY(s, run0.sec), tot = 0;
      out.pos.push(dir === 'v' ? z : s);
      run0.loads.forEach(function (ld, m) {
        var v = BQ.stress(ld, p[0], p[1], ze);
        out.parts[m].push(v);
        tot += v;
      });
      out.total.push(tot);
      out.I.push(sel ? BQ.influence(sel, p[0], p[1], ze) : NaN);
    }
    out.sl = sl; out.zl = zl;
    return out;
  }

  function profiles() {
    if (!run0) return;
    var ink = css('--vl-ink'), sel = runSel(), wantI = S.pq === 'I' && sel;
    [['v', zPlot, 160], ['h', xPlot, 240]].forEach(function (cfg) {
      var dir = cfg[0], pd = profileData(dir, cfg[2]), series = [];
      function pairs(arr) { return pd.pos.map(function (p, k) { return [p, arr[k]]; }); }
      if (wantI) series.push({ pts: pairs(pd.I), color: ink, width: 2, label: 'I ' + label(sel, run0.loads) });
      else {
        if (S.contrib && run0.loads.length > 1) run0.loads.forEach(function (ld, m) {
          series.push({ pts: pairs(pd.parts[m]), color: slotColor(ld), width: 1.5, dash: [5, 3], label: label(ld, run0.loads) });
        });
        series.push({ pts: pairs(pd.total), color: ink, width: 2, label: run0.loads.length > 1 ? 'Total' : 'Δσz' });
      }
      var valName = wantI ? 'I' : 'Δσz (kPa)', vals = series[series.length - 1].pts;
      var at = dir === 'v' ? pd.zl : pd.sl, mk = interp(vals, at);
      var d = {
        pos0: dir === 'v' ? 0 : -run0.W, pos1: dir === 'v' ? run0.D : run0.W, series: series,
        markers: isFinite(mk) ? [{ pos: at, val: mk, label: sig(mk) }] : [],
        posName: dir === 'v' ? 'z' : axisName(run0.sec.sax), valName: valName,
        posLabel: dir === 'v' ? 'Depth z (m)' : axisName(run0.sec.sax) + ' (m) along A–A′, at z = ' + num(pd.zl, 2) + ' m',
        valLabel: dir === 'v' ? valName + ' at ' + axisName(run0.sec.sax) + ' = ' + num(pd.sl, 2) + ' m' : valName
      };
      if (singularRun() && !wantI) d.valRange = valRange(series);
      cfg[1].data = d;
      cfg[1].render();
    });
  }

  /* With point / line loads, cap the axis at the colour range so the surface spike does not flatten the plot. */
  function valRange(series) {
    var lo = 0, hi = 0, cap = Math.max(Math.abs(range.lo), Math.abs(range.hi)) * 1.25;
    series.forEach(function (s) { s.pts.forEach(function (q) { if (isFinite(q[1])) { lo = Math.min(lo, q[1]); hi = Math.max(hi, q[1]); } }); });
    return [Math.max(lo, -cap), Math.min(hi, cap)];
  }

  function interp(pts, p) {
    for (var k = 1; k < pts.length; k++) {
      var a = pts[k - 1], b = pts[k];
      if ((p - a[0]) * (p - b[0]) <= 0 && a[0] !== b[0]) return a[1] + (b[1] - a[1]) * (p - a[0]) / (b[0] - a[0]);
    }
    return NaN;
  }

  /* ---------- points ---------- */
  var addingPt = false;
  function setAddingPt(on) {
    addingPt = on;
    var b = document.getElementById('pt-add');
    b.classList.toggle('vl-on', on);
    b.textContent = on ? 'Click in the section…' : 'Add point';
  }

  function pointValues(p) {
    var xy = planXY(p.s, run0.sec), ze = Math.max(p.z, run0.D * 1e-3), sel = runSel();
    return { x: xy[0], y: xy[1], z: p.z, ds: BQ.total(run0.loads, xy[0], xy[1], ze),
      parts: run0.loads.map(function (ld) { return BQ.stress(ld, xy[0], xy[1], ze); }),
      I: sel ? BQ.influence(sel, xy[0], xy[1], ze) : NaN };
  }

  function pointsChanged() { pointsTable(); secView.render(); planView.render(); saveHash(); }

  function pointsTable() {
    var box = document.getElementById('pt-table');
    if (!pts.length) {
      box.innerHTML = '<p class="vl-muted">No points. Press <b>Add point</b>, then click in the section. Drag to move, double-click to remove.</p>';
      return;
    }
    if (!run0) return;
    var sel = runSel();
    box.innerHTML = '<table class="vl-table"><thead><tr><th></th><th>x</th><th>y</th><th>z</th><th>Δσ<sub>z</sub></th><th>I' +
      (sel ? '<sub>#' + (run0.loads.indexOf(sel) + 1) + '</sub>' : '') + '</th></tr></thead><tbody>' +
      pts.map(function (p, n) {
        var v = pointValues(p);
        return '<tr title="' + esc(v.parts.map(function (d, m) { return label(run0.loads[m], run0.loads) + ': ' + sig(d) + ' kPa'; }).join('\n')) +
          '"><td>P' + (n + 1) + '</td><td>' + num(v.x, 2) + '</td><td>' + num(v.y, 2) + '</td><td>' + num(v.z, 2) +
          '</td><td>' + sig(v.ds) + '</td><td>' + sig(v.I) + '</td></tr>';
      }).join('') + '</tbody></table><p class="vl-muted">m, kPa. Hover a row for each load’s share.</p>';
  }

  /* ---------- CSV ---------- */
  function header(extra) {
    var L = ['# CIE 365 Virtual Soil Lab: vertical stress increment, Boussinesq elastic half-space',
      '# Section A-A\' along ' + axisName(run0.sec.sax) + ' at ' + otherName(run0.sec.sax) + ' = ' + run0.sec.pos + ' m'];
    run0.loads.forEach(function (ld, m) { L.push('# Load ' + (m + 1) + ': ' + describe(ld)); });
    var sel = runSel();
    if (sel) L.push('# Influence factor I is for load ' + (run0.loads.indexOf(sel) + 1) + ' (' + TYPES[sel.type].name.toLowerCase() + ')');
    if (stale) L.push('# NOTE: exported from the last run; loads changed since then');
    return L.concat(extra);
  }

  function cols(prefix) { return run0.loads.map(function (ld, m) { return prefix + (m + 1); }); }

  function exportProfile(dir) {
    if (run0) download(profileCSV(dir), dir === 'v' ? 'stress_profile_vertical.csv' : 'stress_profile_horizontal.csv');
  }

  function profileCSV(dir) {
    var pd = profileData(dir, dir === 'v' ? 100 : 200), rows;
    if (dir === 'v') {
      var xy = planXY(pd.sl, run0.sec);
      rows = header(['# Vertical profile at x = ' + num(xy[0], 3) + ' m, y = ' + num(xy[1], 3) + ' m',
        ['z_m', 'dsigma_z_kPa'].concat(cols('dsigma_z_load'), ['I']).join(',')]);
    } else {
      rows = header(['# Horizontal profile at depth z = ' + num(pd.zl, 3) + ' m',
        ['x_m', 'y_m', 'dsigma_z_kPa'].concat(cols('dsigma_z_load'), ['I']).join(',')]);
    }
    pd.pos.forEach(function (p, k) {
      var r = dir === 'v' ? [num(p, 4)] : planXY(p, run0.sec).map(function (c) { return num(c, 4); });
      r.push(pd.total[k].toPrecision(6));
      pd.parts.forEach(function (a) { r.push(a[k].toPrecision(6)); });
      r.push(isFinite(pd.I[k]) ? pd.I[k].toPrecision(6) : '');
      rows.push(r.join(','));
    });
    return rows.join('\r\n');
  }

  function exportPoints() {
    if (run0 && pts.length) download(pointsCSV(), 'stress_points.csv');
  }

  function pointsCSV() {
    var rows = header([['point', 'x_m', 'y_m', 'z_m', 'dsigma_z_kPa'].concat(cols('dsigma_z_load'), ['I']).join(',')]);
    pts.forEach(function (p, n) {
      var v = pointValues(p);
      rows.push(['P' + (n + 1), num(v.x, 4), num(v.y, 4), num(v.z, 4), v.ds.toPrecision(6)]
        .concat(v.parts.map(function (d) { return d.toPrecision(6); }), [isFinite(v.I) ? v.I.toPrecision(6) : '']).join(','));
    });
    return rows.join('\r\n');
  }

  function download(text, name) {
    var url = URL.createObjectURL(new Blob([text + '\r\n'], { type: 'text/csv' })), a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---------- load list + editor ---------- */
  var addingType = null, editor = null;

  function buildLoadBar() {
    var box = document.getElementById('loads');
    box.innerHTML = '';
    var tools = VLab.el('div', 'vs-tools');
    ORDER.forEach(function (type) {
      var b = VLab.el('button', 'vl-btn' + (addingType === type ? ' vl-on' : ''), '+ ' + TYPES[type].name);
      b.type = 'button';
      b.disabled = loads.length >= MAX_LOADS;
      b.addEventListener('click', function () { addingType = addingType === type ? null : type; buildLoadBar(); planView.render(); });
      tools.appendChild(b);
    });
    box.appendChild(tools);
    var ul = VLab.el('ul', 'vs-list');
    loads.forEach(function (ld) {
      var li = VLab.el('li', ld.id === selId ? 'vs-sel' : '');
      var sw = VLab.el('span', 'vs-swatch');
      sw.style.background = slotColor(ld);
      li.appendChild(sw);
      li.appendChild(VLab.el('span', null, label(ld) + '  ' + qText(ld).replace(/<[^>]+>/g, '')));
      li.addEventListener('click', function () { select(ld.id); });
      ul.appendChild(li);
    });
    box.appendChild(ul);
    box.appendChild(VLab.el('p', 'vs-hint', addingType
      ? 'Click in the plan to place the ' + TYPES[addingType].name.toLowerCase() + ' load.'
      : loads.length ? 'Drag a load to move it, the square handle to size it, the round handle to rotate. ' +
        'Double-click or Delete removes it. Drag A or A′ to move the section.'
      : 'No loads. Add one with the buttons above.'));
  }

  function select(id) {
    selId = id;
    buildLoadBar();
    buildEditor();
    planView.render();
    if (S.field === 'I') markDirty();
    if (run0) { profiles(); pointsTable(); secView.render(); }
  }

  function buildEditor() {
    var slot = document.getElementById('ld-edit'), ld = selected();
    slot.innerHTML = '';
    editor = null;
    if (!ld) { slot.innerHTML = '<p class="vl-muted">None selected. Click a load in the plan or the list.</p>'; return; }
    var t = TYPES[ld.type], sc = [
      { type: 'html', id: 'ld-title' },
      { type: 'number', key: 'q', label: '<span>' + t.qLabel + ' <span class="vl-muted">(− unloads)</span></span>', value: ld.q, min: -1e6, step: 'any' },
      { type: 'number', key: 'cx', label: 'Centre x (m)', value: ld.cx, min: -1e4, step: 'any' },
      { type: 'number', key: 'cy', label: 'Centre y (m)', value: ld.cy, min: -1e4, step: 'any' }
    ];
    if (t.B) sc.push({ type: 'number', key: 'B', label: 'Width B (m)', value: ld.B, step: 'any' });
    if (t.L) sc.push({ type: 'number', key: 'L', label: 'Length L (m)', value: ld.L, step: 'any',
      visibleIf: function (s) { return !s.inf; } });
    if (t.r) sc.push({ type: 'number', key: 'r', label: '<span>Radius r<sub>0</sub> (m)</span>', value: ld.r, step: 'any' });
    if (t.canInf) sc.push({ type: 'toggle', key: 'inf', label: 'Infinitely long (2D case)', value: ld.inf });
    if (t.rot) sc.push({ type: 'range', key: 'angle', label: 'Rotation', min: -180, max: 180, step: 1, value: ld.angle, unit: '°', digits: 0 });
    sc.push({ type: 'buttons', items: [
      { label: 'Duplicate', onClick: function () {
        if (loads.length >= MAX_LOADS) return;
        var c = makeLoad(ld.type, ld.cx + 1, ld.cy - 1, { q: ld.q, angle: ld.angle, B: ld.B, L: ld.L, r: ld.r, inf: ld.inf });
        loads.push(c); select(c.id); loadsChanged();
      } },
      { label: 'Delete', onClick: function () { removeLoad(ld.id); } }
    ] });
    editor = new VLab.Controls(slot, sc, function (s, key) { ld[key] = s[key]; loadsChanged(); });
    editorTitle();
  }

  function editorTitle() {
    var ld = selected(), box = document.getElementById('ld-title');
    if (!ld || !box) return;
    box.innerHTML = '<p class="vl-row" style="display:flex;align-items:center;gap:8px;font-weight:600">' +
      '<span class="vs-swatch" style="background:' + slotColor(ld) + '"></span>' + esc(label(ld)) + '</p>' +
      (ld.type === 'tri' ? '<p class="vs-hint">Rises from 0 at the −B/2 edge to q<sub>max</sub> at +B/2 (rotate 180° to flip).</p>' : '');
  }

  function syncEditor(keys) {
    var ld = selected();
    if (!editor || !ld) return;
    keys.forEach(function (k) { editor.set(k, ld[k]); });
  }

  function removeLoad(id) {
    loads = loads.filter(function (l) { return l.id !== id; });
    if (selId === id) selId = loads.length ? loads[loads.length - 1].id : 0;
    buildEditor();
    loadsChanged();
  }

  function loadsChanged() {
    buildLoadBar();
    editorTitle();
    planView.render();
    markDirty();
    saveHash();
  }

  /* ---------- plan view: drawing ---------- */
  function rotHandle(ld, v) {
    var a = ld.angle * Math.PI / 180, R = (ld.inf ? 0.4 * S.W : ld.L / 2) + 22 / v.s;
    return [ld.cx + R * Math.sin(a), ld.cy - R * Math.cos(a)];
  }
  function sizeHandle(ld) {
    if (ld.type === 'point') return null;
    if (ld.type === 'circle') return [ld.cx + ld.r, ld.cy];
    if (ld.type === 'line') return ld.inf ? null : toPlan(ld, 0, ld.L / 2);
    return toPlan(ld, ld.B / 2, ld.inf ? 0 : ld.L / 2);
  }
  function grips(v) {
    var W = S.W, x = S.sax === 'x';
    return [x ? [-W, S.sec] : [S.sec, -W], x ? [W, S.sec] : [S.sec, W]];
  }

  function footprint(c, v, ld) {
    var far = 4 * S.W;
    c.beginPath();
    if (ld.type === 'circle') { c.arc(v.sx(ld.cx), v.sy(ld.cy), ld.r * v.s, 0, 2 * Math.PI); return; }
    var hl = ld.inf ? far : ld.L / 2, hb = ld.B / 2;
    [[-hb, -hl], [hb, -hl], [hb, hl], [-hb, hl]].forEach(function (q, k) {
      var p = toPlan(ld, q[0], q[1]);
      if (k) c.lineTo(v.sx(p[0]), v.sy(p[1])); else c.moveTo(v.sx(p[0]), v.sy(p[1]));
    });
    c.closePath();
  }

  function hatch(c, v) {
    c.save();
    c.clip();
    c.strokeStyle = rgba(css('--vl-ink').length === 7 ? css('--vl-ink') : '#000000', 0.55);
    c.lineWidth = 1;
    c.beginPath();
    for (var d = -v.H; d < v.W; d += 7) { c.moveTo(d, v.H); c.lineTo(d + v.H, 0); }
    c.stroke();
    c.restore();
  }

  planView.draw = function (c, v) {
    var ink = css('--vl-ink'), line = css('--vl-line'), accent = css('--vl-accent'), bg = css('--vl-bg'), W = S.W;
    var step = VLab.Plot.niceStep(2 * W, 6);

    /* grid */
    c.save();
    c.strokeStyle = line; c.lineWidth = 1;
    c.beginPath();
    for (var g = Math.ceil(-W / step) * step; g <= W + 1e-9; g += step) {
      c.moveTo(v.sx(g) + 0.5, v.sy(-W)); c.lineTo(v.sx(g) + 0.5, v.sy(W));
      c.moveTo(v.sx(-W), v.sy(g) + 0.5); c.lineTo(v.sx(W), v.sy(g) + 0.5);
    }
    c.stroke();
    c.restore();

    /* loads, clipped to the plan */
    c.save();
    c.beginPath(); v.rect(c, -W, -W, W, W); c.clip();
    loads.forEach(function (ld) {
      var col = slotColor(ld), cx = v.sx(ld.cx), cy = v.sy(ld.cy);
      c.save();
      if (ld.type === 'point') {
        c.fillStyle = col; c.strokeStyle = ink; c.lineWidth = 1.5;
        c.beginPath(); c.arc(cx, cy, 7, 0, 2 * Math.PI); c.fill(); c.stroke();
        c.beginPath(); c.moveTo(cx - 4, cy); c.lineTo(cx + 4, cy);
        if (ld.q > 0) { c.moveTo(cx, cy - 4); c.lineTo(cx, cy + 4); }
        c.stroke();
      } else if (ld.type === 'line') {
        var e = ld.inf ? 4 * W : ld.L / 2, a = toPlan(ld, 0, -e), b = toPlan(ld, 0, e);
        c.strokeStyle = col; c.lineWidth = 5; c.lineCap = 'round';
        if (ld.q < 0) c.setLineDash([8, 5]);
        c.beginPath(); c.moveTo(v.sx(a[0]), v.sy(a[1])); c.lineTo(v.sx(b[0]), v.sy(b[1])); c.stroke();
      } else {
        footprint(c, v, ld);
        if (ld.type === 'tri') {
          var p0 = toPlan(ld, -ld.B / 2, 0), p1 = toPlan(ld, ld.B / 2, 0);
          var gr = c.createLinearGradient(v.sx(p0[0]), v.sy(p0[1]), v.sx(p1[0]), v.sy(p1[1]));
          gr.addColorStop(0, rgba(col, 0.04)); gr.addColorStop(1, rgba(col, 0.7));
          c.fillStyle = gr;
        } else c.fillStyle = rgba(col, 0.38);
        c.fill();
        c.strokeStyle = col; c.lineWidth = 2; c.stroke();
        if (ld.q < 0) { footprint(c, v, ld); hatch(c, v); }
      }
      c.restore();
    });
    c.restore();

    /* section line A–A′ and the vertical-profile position on it */
    var gp = grips(v), s0 = planXY(Math.max(-W, Math.min(W, S.sl)));
    c.save();
    c.strokeStyle = ink; c.lineWidth = 1.5; c.setLineDash([8, 4, 2, 4]);
    c.beginPath(); c.moveTo(v.sx(gp[0][0]), v.sy(gp[0][1])); c.lineTo(v.sx(gp[1][0]), v.sy(gp[1][1])); c.stroke();
    c.setLineDash([]);
    c.strokeStyle = accent; c.lineWidth = 2;
    c.beginPath(); c.arc(v.sx(s0[0]), v.sy(s0[1]), 5, 0, 2 * Math.PI); c.stroke();
    pts.forEach(function (p) {
      var q = planXY(p.s);
      c.fillStyle = ink; c.beginPath(); c.arc(v.sx(q[0]), v.sy(q[1]), 2.5, 0, 2 * Math.PI); c.fill();
    });
    c.font = '600 12px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    ['A', 'A′'].forEach(function (t, k) {
      var px = v.sx(gp[k][0]), py = v.sy(gp[k][1]);
      c.fillStyle = bg; c.strokeStyle = ink; c.lineWidth = 1.5;
      c.beginPath(); c.arc(px, py, 9, 0, 2 * Math.PI); c.fill(); c.stroke();
      c.fillStyle = ink; c.fillText(t, px, py + 0.5);
    });
    c.restore();

    /* labels and handles */
    c.save();
    c.font = '600 11px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    loads.forEach(function (ld) {
      var px = v.sx(ld.cx), py = v.sy(ld.cy) + (ld.type === 'point' ? -15 : 0), t = label(ld).split(' ')[0] + ' ' + qText(ld);
      var tw = c.measureText(t).width + 8;
      c.fillStyle = rgba(bg.length === 7 ? bg : '#ffffff', 0.85); c.fillRect(px - tw / 2, py - 8, tw, 16);
      c.fillStyle = ink; c.fillText(t, px, py);
    });
    var ld = selected();
    if (ld) {
      c.strokeStyle = ink; c.lineWidth = 1.5;
      var sh = sizeHandle(ld);
      if (sh) { c.fillStyle = bg; c.fillRect(v.sx(sh[0]) - 5, v.sy(sh[1]) - 5, 10, 10); c.strokeRect(v.sx(sh[0]) - 5, v.sy(sh[1]) - 5, 10, 10); }
      if (TYPES[ld.type].rot) {
        var rh = rotHandle(ld, v);
        c.setLineDash([3, 3]);
        c.beginPath(); c.moveTo(v.sx(ld.cx), v.sy(ld.cy)); c.lineTo(v.sx(rh[0]), v.sy(rh[1])); c.stroke();
        c.setLineDash([]);
        c.fillStyle = bg; c.beginPath(); c.arc(v.sx(rh[0]), v.sy(rh[1]), 6, 0, 2 * Math.PI); c.fill(); c.stroke();
      }
    }
    c.restore();

    v.axes(c, { x0: -W, x1: W, y0: -W, y1: W, dxTick: tickFor(W), dyTick: tickFor(W), xlabel: 'x (m)', ylabel: 'y (m)', color: ink, font: 11 });
    if (addingType) {
      c.save(); c.fillStyle = accent; c.font = '600 12px system-ui, sans-serif'; c.textAlign = 'center';
      c.fillText('Click to place', v.sx(0), v.sy(W) + 14); c.restore();
    }
  };

  /* Tick step that divides the half-width, about 3–6 ticks per side. */
  function tickFor(w) {
    var c = [0.5, 1, 2, 2.5, 5, 10, 20, 25];
    for (var k = 0; k < c.length; k++) if (w / c[k] <= 6 && Math.abs(w / c[k] - Math.round(w / c[k])) < 1e-9) return c[k];
    return VLab.Plot.niceStep(w, 4);
  }

  /* ---------- plan view: interaction ---------- */
  var drag = null, pcv = planView.canvas;

  function near(v, p, w) { return Math.abs(v.sx(w[0]) - p.px) < HIT && Math.abs(v.sy(w[1]) - p.py) < HIT; }

  function hitLoad(p) {
    var v = planView;
    for (var k = loads.length - 1; k >= 0; k--) {
      var ld = loads[k], q = BQ.local(ld, p.x, p.y), tol = HIT / v.s;
      if (ld.type === 'point' ? Math.hypot(q.u, q.v) < tol
        : ld.type === 'line' ? Math.abs(q.u) < tol && (ld.inf || Math.abs(q.v) < ld.L / 2 + tol)
        : ld.type === 'circle' ? Math.hypot(q.u, q.v) <= ld.r
        : Math.abs(q.u) <= ld.B / 2 && (ld.inf || Math.abs(q.v) <= ld.L / 2)) return ld;
    }
    return null;
  }

  pcv.addEventListener('pointerdown', function (e) {
    var v = planView, p = v.at(e), ld = selected();
    pcv.focus();
    if (addingType) {
      if (Math.abs(p.x) <= S.W && Math.abs(p.y) <= S.W && loads.length < MAX_LOADS) {
        var nl = makeLoad(addingType, snap(p.x, 0.1), snap(p.y, 0.1));
        loads.push(nl);
        addingType = null;
        select(nl.id);
        loadsChanged();
        drag = { mode: 'move', dx: 0, dy: 0 };
      }
    } else if (ld && sizeHandle(ld) && near(v, p, sizeHandle(ld))) drag = { mode: 'size' };
    else if (ld && TYPES[ld.type].rot && near(v, p, rotHandle(ld, v))) drag = { mode: 'rot' };
    else if (near(v, p, grips(v)[0]) || near(v, p, grips(v)[1])) drag = { mode: 'sec' };
    else {
      var hit = hitLoad(p);
      if (hit) { if (hit.id !== selId) select(hit.id); drag = { mode: 'move', dx: p.x - hit.cx, dy: p.y - hit.cy }; }
      else if (Math.abs((S.sax === 'x' ? v.sy(S.sec) : v.sx(S.sec)) - (S.sax === 'x' ? p.py : p.px)) < 5) drag = { mode: 'sec' };
      else return;
    }
    e.preventDefault();
    try { pcv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
  });

  pcv.addEventListener('pointermove', function (e) {
    var v = planView, p = v.at(e), ld = selected();
    if (!drag) {
      var over = (ld && sizeHandle(ld) && near(v, p, sizeHandle(ld))) || (ld && TYPES[ld.type].rot && near(v, p, rotHandle(ld, v)));
      pcv.style.cursor = addingType ? 'crosshair' : over ? 'pointer' : near(v, p, grips(v)[0]) || near(v, p, grips(v)[1]) ? 'ns-resize' :
        hitLoad(p) ? 'move' : '';
      if (S.sax === 'y' && pcv.style.cursor === 'ns-resize') pcv.style.cursor = 'ew-resize';
      return;
    }
    if (drag.mode === 'sec') {
      ui.set('sec', r2(snap(Math.max(-S.W, Math.min(S.W, S.sax === 'x' ? p.y : p.x)), 0.1)));
      markDirty(); planView.render(); saveHash();
      return;
    }
    if (!ld) return;
    var keys;
    if (drag.mode === 'move') {
      ld.cx = r2(snap(p.x - drag.dx, 0.1)); ld.cy = r2(snap(p.y - drag.dy, 0.1)); keys = ['cx', 'cy'];
    } else if (drag.mode === 'size') {
      var q = BQ.local(ld, p.x, p.y);
      if (ld.type === 'circle') { ld.r = Math.max(0.1, r2(snap(Math.hypot(q.u, q.v), 0.05))); keys = ['r']; }
      else if (ld.type === 'line') { ld.L = Math.max(0.1, r2(snap(2 * Math.abs(q.v), 0.1))); keys = ['L']; }
      else {
        ld.B = Math.max(0.1, r2(snap(2 * Math.abs(q.u), 0.1))); keys = ['B'];
        if (!ld.inf) { ld.L = Math.max(0.1, r2(snap(2 * Math.abs(q.v), 0.1))); keys.push('L'); }
      }
    } else if (drag.mode === 'rot') {
      var a = Math.atan2(p.y - ld.cy, p.x - ld.cx) * 180 / Math.PI + 90;
      a = snap(a, 5); if (a > 180) a -= 360; if (a <= -180) a += 360;
      ld.angle = a; keys = ['angle'];
    }
    syncEditor(keys);
    loadsChanged();
  });

  function endDrag() { drag = null; }
  pcv.addEventListener('pointerup', endDrag);
  pcv.addEventListener('pointercancel', endDrag);
  pcv.addEventListener('dblclick', function (e) {
    var hit = hitLoad(planView.at(e));
    if (hit) removeLoad(hit.id);
  });
  pcv.addEventListener('keydown', function (e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected()) { removeLoad(selId); e.preventDefault(); }
    if (e.key === 'Escape' && addingType) { addingType = null; buildLoadBar(); planView.render(); }
  });

  /* ---------- section: drawing ---------- */
  function surfaceLoad(ld, x, y) {
    var q = BQ.local(ld, x, y);
    if (ld.type === 'circle') return Math.hypot(q.u, q.v) <= ld.r ? 1 : 0;
    if (Math.abs(q.u) > ld.B / 2 || (!ld.inf && Math.abs(q.v) > ld.L / 2)) return 0;
    return ld.type === 'tri' ? (q.u + ld.B / 2) / ld.B : 1;
  }

  /* Where a line load crosses the section: s, or null. */
  function lineCross(ld) {
    var a = ld.angle * Math.PI / 180, ex = -Math.sin(a), ey = Math.cos(a), t;
    if (S.sax === 'x') { if (Math.abs(ey) < 1e-9) return null; t = (S.sec - ld.cy) / ey; }
    else { if (Math.abs(ex) < 1e-9) return null; t = (S.sec - ld.cx) / ex; }
    if (!ld.inf && Math.abs(t) > ld.L / 2 + 1e-9) return null;
    return S.sax === 'x' ? ld.cx + t * ex : ld.cy + t * ey;
  }

  function arrow(c, x, y0, y1, col) {
    c.strokeStyle = col; c.fillStyle = col;
    c.beginPath(); c.moveTo(x, y0); c.lineTo(x, y1); c.stroke();
    var d = y1 > y0 ? 1 : -1;
    c.beginPath(); c.moveTo(x, y1); c.lineTo(x - 4, y1 - 7 * d); c.lineTo(x + 4, y1 - 7 * d); c.closePath(); c.fill();
  }

  function drawSectionLoads(c, v, ink) {
    var W = S.W, top = 0.11 * S.D, n = 300, qmax = 0, placed = [];
    /* load labels: lift a label one row while it overlaps one already drawn */
    function tag(t, px, py) {
      var w = c.measureText(t).width + 6, y = py;
      for (var guard = 0; guard < 8 && placed.some(function (b) {
        return px - w / 2 < b[0] + b[2] && px + w / 2 > b[0] && y - 13 < b[1] + 13 && y > b[1];
      }); guard++) y -= 13;
      placed.push([px - w / 2, y - 13, w]);
      c.fillText(t, px, y);
    }
    loads.forEach(function (ld) { if (ld.type !== 'point' && ld.type !== 'line') qmax = Math.max(qmax, Math.abs(ld.q)); });
    c.save();
    c.font = '600 11px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'bottom'; c.lineWidth = 1.4;
    loads.forEach(function (ld) {
      var col = slotColor(ld), k, s, f;
      if (ld.type === 'point' || ld.type === 'line') {
        var off = 0, sp;
        if (ld.type === 'point') { sp = S.sax === 'x' ? ld.cx : ld.cy; off = Math.abs((S.sax === 'x' ? ld.cy : ld.cx) - S.sec); }
        else sp = lineCross(ld);
        if (sp == null || sp < -W || sp > W) return;
        var px = v.sx(sp);
        c.save();
        if (off > 0.01) c.setLineDash([4, 3]);
        if (ld.q >= 0) arrow(c, px, v.sy(top), v.sy(0) - 1, col); else arrow(c, px, v.sy(0) - 1, v.sy(top), col);
        c.restore();
        c.fillStyle = ink;
        tag(qText(ld) + (off > 0.01 ? ' (' + num(off, 1) + ' m off A–A′)' : ''), px, v.sy(top) - 2);
        return;
      }
      var h = [], any = false;
      for (k = 0; k <= n; k++) {
        s = -W + 2 * W * k / n;
        var xy = planXY(s);
        f = surfaceLoad(ld, xy[0], xy[1]);
        h.push(f);
        if (f > 0) any = true;
      }
      if (!any) return;
      var hs = (qmax ? Math.abs(ld.q) / qmax : 1) * top * 0.8;
      c.beginPath();
      c.moveTo(v.sx(-W), v.sy(0));
      for (k = 0; k <= n; k++) c.lineTo(v.sx(-W + 2 * W * k / n), v.sy(h[k] * hs));
      c.lineTo(v.sx(W), v.sy(0));
      c.closePath();
      c.fillStyle = rgba(col, 0.35); c.fill();
      c.strokeStyle = col; c.stroke();
      if (ld.q < 0) { c.beginPath(); c.moveTo(v.sx(-W), v.sy(0)); for (k = 0; k <= n; k++) c.lineTo(v.sx(-W + 2 * W * k / n), v.sy(h[k] * hs)); c.lineTo(v.sx(W), v.sy(0)); c.closePath(); hatch(c, v); }
      var sMax = -W, best = -1;
      for (k = 0; k <= n; k++) if (h[k] > best) { best = h[k]; sMax = -W + 2 * W * k / n; }
      c.fillStyle = ink;
      tag(qText(ld), v.sx(sMax), v.sy(best * hs) - 2);
    });
    c.restore();
  }

  secView.draw = function (c, v) {
    var ink = css('--vl-ink'), accent = css('--vl-accent'), bg = css('--vl-bg'), edge = css('--vl-soil-edge'), W = S.W, D = S.D;
    if (field && run0 && run0.W === W && run0.D === D) {
      var key = [range.cmap, S.nb, range.lo, range.hi, v.W, v.H, v.dpr, runCount].join('|');
      if (key !== rasterKey) {
        raster = v.raster(-W, W, -D, 0, function (x, y) { return range.lut(grid.sample(field, x, -y)); });
        rasterKey = key;
      }
      c.save();
      if (stale) c.globalAlpha = 0.3;
      c.drawImage(raster.canvas, raster.x, raster.y, raster.w, raster.h);
      if (isobars.length) v.segments(c, isobars, { color: 'rgba(0,0,0,0.55)', width: 1 });
      c.restore();
      colorbar(c, v, ink);
    }
    c.save();
    c.strokeStyle = edge; c.lineWidth = 1;
    c.beginPath(); v.rect(c, -W, -D, W, 0); c.stroke();
    c.strokeStyle = ink; c.lineWidth = 2;
    c.beginPath(); c.moveTo(v.sx(-W), v.sy(0)); c.lineTo(v.sx(W), v.sy(0)); c.stroke();
    c.restore();
    drawSectionLoads(c, v, ink);

    /* profile lines */
    var sl = Math.max(-W, Math.min(W, S.sl)), zl = Math.max(0, Math.min(D, S.zl));
    c.save();
    c.strokeStyle = accent; c.lineWidth = 1.6; c.setLineDash([7, 4]);
    c.beginPath();
    c.moveTo(v.sx(sl), v.sy(0)); c.lineTo(v.sx(sl), v.sy(-D));
    c.moveTo(v.sx(-W), v.sy(-zl)); c.lineTo(v.sx(W), v.sy(-zl));
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = accent;
    c.fillRect(v.sx(sl) - 5, v.sy(-D) - 10, 10, 10);
    c.fillRect(v.sx(W) - 10, v.sy(-zl) - 5, 10, 10);
    c.restore();

    /* points */
    c.save();
    c.font = '600 12px system-ui, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'bottom';
    pts.forEach(function (p, n) {
      var px = v.sx(p.s), py = v.sy(-p.z);
      c.fillStyle = bg; c.strokeStyle = ink; c.lineWidth = 2;
      c.beginPath(); c.arc(px, py, 5, 0, 2 * Math.PI); c.fill(); c.stroke();
      var t = 'P' + (n + 1), tw = c.measureText(t).width + 6;
      c.fillStyle = rgba(bg.length === 7 ? bg : '#ffffff', 0.85); c.fillRect(px + 5, py - 19, tw, 15);
      c.fillStyle = ink; c.fillText(t, px + 8, py - 5);
    });
    c.restore();

    v.axes(c, { x0: -W, x1: W, y0: -D, y1: 0, dxTick: tickFor(W), dyTick: tickFor(D),
      xlabel: axisName() + ' (m)  ·  section A–A′ at ' + otherName() + ' = ' + num(S.sec, 2) + ' m', ylabel: 'Depth z (m)',
      yfmt: function (y) { return String(Math.round(-y * 100) / 100); }, color: ink });
    if (stale && !S.auto) {
      c.save(); c.fillStyle = ink; c.font = '600 14px system-ui, sans-serif'; c.textAlign = 'center';
      c.fillText('Out of date: press Run', v.sx(0), v.sy(-D / 2)); c.restore();
    }
  };

  function colorbar(c, v, ink) {
    var N = S.nb, x = v.sx(S.W) + 16, w = 14, top = v.sy(0), bot = v.sy(-S.D), hgt = bot - top;
    c.save();
    for (var b = 0; b < N; b++) {
      c.fillStyle = VLab.colormap.css(VLab.colormap.band(range.cmap, b, N));
      c.fillRect(x, bot - (b + 1) * hgt / N, w, hgt / N + 0.5);
    }
    c.strokeStyle = ink; c.lineWidth = 1;
    c.strokeRect(x + 0.5, top + 0.5, w, hgt);
    c.fillStyle = ink; c.font = '11px system-ui, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
    var every = Math.ceil(N / Math.max(2, Math.floor(hgt / 16)));
    for (var m = 0; m <= N; m += every) {
      var y = bot - m * hgt / N;
      c.beginPath(); c.moveTo(x + w, y); c.lineTo(x + w + 3, y); c.stroke();
      c.fillText(sig(range.lo + m * (range.hi - range.lo) / N), x + w + 5, y);
    }
    c.textAlign = 'center'; c.textBaseline = 'bottom'; c.font = '600 12px system-ui, sans-serif';
    c.fillText(run0.kind === 'I' ? 'I' : 'Δσz (kPa)', x + w / 2 + 10, top - 4);
    c.restore();
  }

  /* ---------- section: interaction ---------- */
  var sdrag = null, scv = secView.canvas;

  function inSoil(p) { return Math.abs(p.x) <= S.W && p.y <= 0 && p.y >= -S.D; }
  function hitPt(p) {
    for (var k = pts.length - 1; k >= 0; k--) {
      if (Math.abs(secView.sx(pts[k].s) - p.px) < HIT && Math.abs(secView.sy(-pts[k].z) - p.py) < HIT) return k;
    }
    return -1;
  }
  function onVLine(p) { return Math.abs(secView.sx(Math.max(-S.W, Math.min(S.W, S.sl))) - p.px) < 6 && p.y <= 0.02 * S.D && p.y >= -S.D - 0.04 * S.D; }
  function onHLine(p) { return Math.abs(secView.sy(-Math.max(0, Math.min(S.D, S.zl))) - p.py) < 6 && Math.abs(p.x) <= S.W * 1.02; }

  scv.addEventListener('pointerdown', function (e) {
    var p = secView.at(e), k = hitPt(p);
    if (addingPt && inSoil(p)) {
      if (pts.length >= MAX_PTS) pts.shift();
      pts.push({ s: r2(snap(p.x, 0.05)), z: r2(snap(-p.y, 0.05)) });
      sdrag = { mode: 'pt', k: pts.length - 1 };
      setAddingPt(false);
      pointsChanged();
    } else if (k >= 0) sdrag = { mode: 'pt', k: k };
    else if (onVLine(p)) sdrag = { mode: 'sl' };
    else if (onHLine(p)) sdrag = { mode: 'zl' };
    else return;
    e.preventDefault();
    try { scv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
  });

  scv.addEventListener('pointermove', function (e) {
    var p = secView.at(e);
    if (!sdrag) {
      scv.style.cursor = addingPt && inSoil(p) ? 'crosshair' : hitPt(p) >= 0 ? 'grab' : onVLine(p) ? 'ew-resize' : onHLine(p) ? 'ns-resize' : '';
      readout(inSoil(p) ? p : null);
      return;
    }
    var x = r2(snap(Math.max(-S.W, Math.min(S.W, p.x)), 0.05)), z = r2(snap(Math.max(0, Math.min(S.D, -p.y)), 0.05));
    if (sdrag.mode === 'pt') { pts[sdrag.k].s = x; pts[sdrag.k].z = z; pointsChanged(); }
    else {
      ui.set(sdrag.mode, sdrag.mode === 'sl' ? x : z);
      profiles(); secView.render(); planView.render(); saveHash();
    }
    readout(p);
  });
  function endSDrag() { sdrag = null; }
  scv.addEventListener('pointerup', endSDrag);
  scv.addEventListener('pointercancel', endSDrag);
  scv.addEventListener('pointerleave', function () { readout(null); });
  scv.addEventListener('dblclick', function (e) {
    var k = hitPt(secView.at(e));
    if (k >= 0) { pts.splice(k, 1); pointsChanged(); }
  });

  function readout(p) {
    var box = document.getElementById('readout'), h = '';
    if (stale && !S.auto) h += '<p><span class="vs-badge">Out of date</span></p>';
    if (p && run0) {
      var xy = planXY(p.x, run0.sec), z = Math.max(-p.y, run0.D * 1e-3), sel = runSel();
      h += '<dl class="vl-results"><dt>x, y (m)</dt><dd>' + num(xy[0], 2) + ', ' + num(xy[1], 2) + '</dd>' +
        '<dt>z (m)</dt><dd>' + num(-p.y, 2) + '</dd>' +
        '<dt>Δσ<sub>z</sub> (kPa)</dt><dd>' + sig(BQ.total(run0.loads, xy[0], xy[1], z)) + '</dd>' +
        (sel ? '<dt>I ' + esc(label(sel, run0.loads)) + '</dt><dd>' + sig(BQ.influence(sel, xy[0], xy[1], z)) + '</dd>' : '') + '</dl>';
    } else {
      h += '<p class="vs-hint">Hover the section to read Δσ<sub>z</sub>. Drag the dashed lines (or their square ends) ' +
        'to move the profiles; the charts share the section’s axes.</p>';
    }
    box.innerHTML = h;
  }

  /* ---------- notes ---------- */
  document.getElementById('notes').innerHTML =
    '<p class="vl-muted">Homogeneous, isotropic, linear-elastic half-space; flexible loads on the surface. ' +
    'Δσ<sub>z</sub> does not depend on E or ν. Negative loads model unloading (excavation); results add by superposition.</p>' +
    '<p class="vl-muted">Influence factors as in class: point I = Δσ<sub>z</sub>z²/Q, line I = Δσ<sub>z</sub>/q (1/m), ' +
    'areas I′ = Δσ<sub>z</sub>/q (q<sub>max</sub> for the triangular load).</p>' +
    '<p class="vl-muted">Closed forms for point, line, strip, rectangle and the 2D triangular load; ' +
    'the circle (off its axis) and the finite triangular load are integrated numerically.</p>';

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
    buildLoadBar(); editorTitle(); profiles(); planView.render(); secView.render();
  });

  buildLoadBar();
  buildEditor();
  pointsTable();
  run();
  planView.render();

  /* exposed for tests and for decks that script the lab */
  VLab.stress = { loads: function () { return loads; }, points: function () { return pts; }, ui: ui, run: run,
    results: function () { return run0; }, csv: { profile: profileCSV, points: pointsCSV }, plan: planView, section: secView, select: select, changed: loadsChanged };
})(window.VLab);
