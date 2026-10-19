/* Virtual Lab experiment: primary-consolidation settlement of a layered soil.
   Surface loads are placed in plan as in the induced-stress lab (the load code is
   forked from experiments/stress/stress.js). Each vertical column is a 1D problem:
   Δσz from VLab.Boussinesq, σ'v0 and σ'p from the layer profile, settlement of the
   fine-grained layers by sub-layers (VLab.Settle). The section shows the layers and
   their deformed shape, the plan the surface settlement, the charts the stress
   profiles and the surface settlement along A–A′.
   The model is stored in the current unit system (SI or US); switching units
   converts every value. γw = 9.81 kN/m³ or 62.4 pcf. */
(function (VLab) {
  'use strict';

  var BQ = VLab.Boussinesq, ST = VLab.Settle;

  var UNITS = {
    SI: { len: 'm', st: 'kPa', gam: 'kN/m³', P: 'kN', Pl: 'kN/m', set: 'mm', setF: 1000, gw: 9.81, Wmin: 3, Wmax: 60, Wstep: 1 },
    US: { len: 'ft', st: 'psf', gam: 'pcf', P: 'lb', Pl: 'lb/ft', set: 'in', setF: 12, gw: 62.4, Wmin: 10, Wmax: 200, Wstep: 5 }
  };
  var FAC = { len: 3.28084, st: 20.8854, gam: 6.36588, P: 224.809, Pl: 68.5218 };   /* SI -> US */

  var TYPES = {
    point:  { name: 'Point', kind: 'P', q: 1000 },
    line:   { name: 'Line', kind: 'Pl', q: 100, L: 10, inf: false, rot: true, canInf: true },
    strip:  { name: 'Strip', kind: 'st', q: 100, B: 4, L: 20, inf: true, rot: true, canInf: true },
    rect:   { name: 'Rectangle', kind: 'st', q: 100, B: 10, L: 10, rot: true },
    tri:    { name: 'Triangular', kind: 'st', q: 100, B: 6, L: 20, inf: true, rot: true, canInf: true },
    circle: { name: 'Circle', kind: 'st', q: 100, r: 5 }
  };
  var ORDER = ['point', 'line', 'strip', 'rect', 'tri', 'circle'];
  var CODE = { point: 'p', line: 'l', strip: 's', rect: 'r', tri: 't', circle: 'c' };
  var FROM_CODE = { p: 'point', l: 'line', s: 'strip', r: 'rect', t: 'tri', c: 'circle' };
  var SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
  var SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
  var FINE_COL = ['#9c7a54', '#7f6b94', '#6f8a5b', '#a0654f', '#5f7f99', '#8c6d3c'];
  var COARSE_COL = ['#e0c486', '#cfb27a', '#e8d4a2', '#c9a86b'];
  var MAX_LOADS = 8, MAX_LAYERS = 8, NXS = 121, NMAP = 41, HIT = 9, HEAD = 0.2;

  var qs = location.search;
  if (/[?&]embed=1/.test(qs)) document.body.classList.add('vl-embed');
  var theme = /[?&]theme=(light|dark)/.exec(qs);
  if (theme) document.documentElement.setAttribute('data-theme', theme[1]);
  var AUTOTEST = /[?&]autotest=1/.test(qs);

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function dark() { return css('color-scheme') === 'dark'; }
  function slotColor(ld) { return (dark() ? SERIES_DARK : SERIES)[ld.slot % SERIES.length]; }
  function rgba(hex, a) {
    return 'rgba(' + parseInt(hex.slice(1, 3), 16) + ',' + parseInt(hex.slice(3, 5), 16) + ',' +
      parseInt(hex.slice(5, 7), 16) + ',' + a + ')';
  }
  function snap(v, d) { return Math.round(v / d) * d; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function p4(v) { return v === 0 ? 0 : +(+v).toPrecision(4); }
  function num(v, d) { return isFinite(v) ? Number(v).toFixed(d) : '–'; }
  function sig(v) {
    if (!isFinite(v)) return '–';
    var a = Math.abs(v);
    return a === 0 ? '0' : a >= 100 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : a >= 0.01 ? v.toFixed(3) : v.toExponential(2);
  }
  function signed(v) { return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function $(id) { return document.getElementById(id); }

  /* ---------- state ---------- */
  var initial = VLab.Hash.read();
  var units = initial.u === 'US' ? 'US' : 'SI';
  function U() { return UNITS[units]; }
  function loadUnit(type) { return U()[TYPES[type].kind]; }

  var loads = [], layers = [], selKind = 'load', selId = 0, selLayer = 0, nextId = 1;

  function freeSlot() {
    for (var s = 0; s < SERIES.length; s++) if (!loads.some(function (l) { return l.slot === s; })) return s;
    return loads.length % SERIES.length;
  }
  /* template values are SI; convert for the current units */
  function tq(type) { var t = TYPES[type]; return units === 'US' ? p4(t.q * FAC[t.kind]) : t.q; }
  function tl(v) { return v == null ? 0 : units === 'US' ? p4(v * FAC.len) : v; }
  function makeLoad(type, x, y, o) {
    var t = TYPES[type];
    var ld = { id: nextId++, slot: freeSlot(), type: type, q: tq(type), cx: r2(x), cy: r2(y), angle: 0,
      B: tl(t.B), L: tl(t.L), r: tl(t.r), inf: !!t.inf };
    if (o) Object.keys(o).forEach(function (k) { ld[k] = o[k]; });
    return ld;
  }
  function byId(list, id) { for (var k = 0; k < list.length; k++) if (list[k].id === id) return list[k]; return null; }
  function selected() { return selKind === 'load' ? byId(loads, selId) : null; }
  function label(ld) { return '#' + (loads.indexOf(ld) + 1) + ' ' + TYPES[ld.type].name; }
  function qText(ld) { return signed(ld.q) + ' ' + loadUnit(ld.type); }
  function toPlan(ld, u, v) {
    var a = ld.angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [ld.cx + u * c - v * s, ld.cy + u * s + v * c];
  }

  function encodeLoads() {
    return loads.map(function (l) { return [CODE[l.type], l.q, l.cx, l.cy, l.angle, l.B, l.L, l.r, l.inf ? 1 : 0].join(','); }).join(';');
  }
  function decodeLoads(s) {
    var out = [];
    (s || '').split(';').forEach(function (t) {
      var a = t.split(','), type = FROM_CODE[a[0]], v = a.slice(1).map(Number);
      if (!type || v.length < 8 || v.slice(0, 7).some(function (x) { return !isFinite(x); }) || out.length >= MAX_LOADS) return;
      loads = out;
      out.push(makeLoad(type, v[1], v[2], { q: v[0], angle: v[3], B: Math.max(0.05, v[4] || 1), L: Math.max(0.05, v[5] || 1),
        r: Math.max(0.05, v[6] || 1), inf: v[7] === 1 && !!TYPES[type].canInf }));
    });
    return out;
  }

  function newLayer(type, o) {
    var L = { name: type === 'fine' ? 'Clay' : 'Sand', type: type, H: 2, g: type === 'fine' ? 18 : 17, gs: type === 'fine' ? 18 : 19.5,
      e0: 1.0, Cc: 0.35, Cr: 0.06, hist: 'ocr', ocr: 1.0, pop: 0 };
    if (units === 'US') { L.H = p4(L.H * FAC.len); L.g = p4(L.g * FAC.gam); L.gs = p4(L.gs * FAC.gam); }
    if (o) Object.keys(o).forEach(function (k) { L[k] = o[k]; });
    return L;
  }
  function defaultLayers() {
    return [newLayer('coarse', { name: 'Sand', H: 2, g: 17, gs: 19.5 }),
      newLayer('fine', { name: 'Clay 1', H: 6, g: 18, gs: 18, e0: 1.0, Cc: 0.35, Cr: 0.06, ocr: 1.5 }),
      newLayer('coarse', { name: 'Sand', H: 2, g: 19, gs: 20 }),
      newLayer('fine', { name: 'Clay 2', H: 4, g: 17.5, gs: 17.5, e0: 1.2, Cc: 0.45, Cr: 0.08, ocr: 1.0 })];
  }
  function cleanName(s) { return String(s || '').replace(/[,;|=&#]/g, ' ').slice(0, 24) || 'Layer'; }
  function encodeLayers() {
    return layers.map(function (L) {
      return [cleanName(L.name), L.type === 'fine' ? 'f' : 'c', L.H, L.g, L.gs, L.e0, L.Cc, L.Cr, L.hist === 'pop' ? 'p' : 'o', L.ocr, L.pop].join(',');
    }).join(';');
  }
  function decodeLayers(s) {
    var out = [];
    (s || '').split(';').forEach(function (t) {
      var a = t.split(',');
      if (a.length < 11 || out.length >= MAX_LAYERS) return;
      var v = a.slice(2).map(Number);
      if ([0, 1, 2, 3, 4, 5, 7, 8].some(function (k) { return !isFinite(v[k]); }) || !(v[0] > 0)) return;
      out.push({ name: cleanName(a[0]), type: a[1] === 'f' ? 'fine' : 'coarse', H: v[0], g: v[1], gs: v[2], e0: v[3], Cc: v[4], Cr: v[5],
        hist: a[8] === 'p' ? 'pop' : 'ocr', ocr: Math.max(1, v[7]), pop: Math.max(0, v[8]) });
    });
    return out;
  }
  function layerColor(k) {
    var L = layers[k], n = 0;
    for (var i = 0; i < k; i++) if (layers[i].type === L.type) n++;
    return L.type === 'fine' ? FINE_COL[n % FINE_COL.length] : COARSE_COL[n % COARSE_COL.length];
  }

  /* ---------- panel ---------- */
  var ui, S;
  function makeSchema() {
    var u = U();
    return [
      { type: 'select', key: 'u', label: 'Units', value: 'SI', options: [['SI', 'SI (m, kPa, kN/m³)'], ['US', 'US (ft, psf, pcf)']] },
      { type: 'heading', label: 'Selected item' },
      { type: 'html', id: 'edit' },
      { type: 'heading', label: 'Soil profile' },
      { type: 'number', key: 'gwt', label: 'Water table depth (' + u.len + ')', value: 2, min: 0, step: 'any' },
      { type: 'range', key: 'nsub', label: 'Sub-layers per fine layer', min: 1, max: 50, step: 1, value: 10 },
      { type: 'heading', label: 'Cross-section A–A′' },
      { type: 'select', key: 'sax', label: 'Section runs', value: 'x', options: [['x', 'along x (y fixed)'], ['y', 'along y (x fixed)']] },
      { type: 'number', key: 'sec', label: 'Section position (' + u.len + ')', value: 0, min: -1e5, step: 'any' },
      { type: 'number', key: 'sl', label: 'Settlement column at (' + u.len + ')', value: 0, min: -1e5, step: 'any' },
      { type: 'range', key: 'W', label: 'Plan half-width', min: u.Wmin, max: u.Wmax, step: u.Wstep, value: 15, unit: u.len },
      { type: 'heading', label: 'Display' },
      { type: 'toggle', key: 'map', label: 'Surface settlement map in the plan', value: true },
      { type: 'toggle', key: 'def', label: 'Deformed profile in the section', value: true },
      { type: 'select', key: 'dsc', label: 'Deformation scale', value: 'auto', visibleIf: function (s) { return s.def; },
        options: [['auto', 'automatic']].concat([1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].map(function (k) { return [String(k), '×' + k]; })) },
      { type: 'toggle', key: 'pv0', label: "Profile: initial σ'<sub>v0</sub>", value: true },
      { type: 'toggle', key: 'ppc', label: "Profile: preconsolidation σ'<sub>p</sub>", value: true },
      { type: 'toggle', key: 'pds', label: 'Profile: increment Δσ<sub>z</sub>', value: true },
      { type: 'toggle', key: 'pvf', label: "Profile: final σ'<sub>vf</sub>", value: true },
      { type: 'heading', label: 'Results' },
      { type: 'buttons', items: [
        { label: 'Sub-layer table', onClick: function () { openModal(); } },
        { label: 'CSV: sub-layers', onClick: function () { download(subCSV(), 'settlement_sublayers.csv'); } },
        { label: 'CSV: surface A–A′', onClick: function () { download(surfCSV(), 'settlement_surface.csv'); } }] },
      { type: 'heading', label: 'Model' },
      { type: 'html', id: 'notes' }
    ];
  }

  function onPanel(s, key) {
    if (key === 'u') { convertUnits(units, s.u); return; }
    if (key === 'W') setWorlds();
    if (key === 'map' || key === 'def' || key === 'dsc' || key === 'gwt' || key === 'nsub' || key === 'sax' || key === 'sec' || key === 'sl' || key === 'W') markDirty();
    else { profiles(); }
    planView.render(); secView.render();
    saveHash();
  }

  function buildPanel(init) {
    var panel = $('panel');
    panel.innerHTML = '';
    ui = new VLab.Controls(panel, makeSchema(), onPanel, init);
    S = ui.state;
    $('notes').innerHTML =
      '<p class="vl-muted">Each column is a 1D problem: Δσ<sub>z</sub> from Boussinesq (homogeneous elastic half-space, flexible ' +
      'surface loads) and the in-situ stresses of the layered profile. Only fine-grained layers settle; coarse layers are ' +
      'treated as incompressible. The base of the profile is fixed.</p>' +
      '<p class="vl-muted">Per sub-layer: NC δ = H C<sub>c</sub>/(1+e<sub>0</sub>) log(σ\'<sub>f</sub>/σ\'<sub>0</sub>); OC uses C<sub>r</sub> ' +
      'up to σ\'<sub>p</sub> and C<sub>c</sub> beyond; unloading uses C<sub>r</sub> (heave). γ<sub>w</sub> = ' + U().gw + ' ' + U().gam + '.</p>';
    buildEditor();
  }

  /* SI <-> US: convert the whole model and rebuild the panel. */
  function convertUnits(from, to) {
    if (from === to) return;
    var f = function (kind) { return to === 'US' ? FAC[kind] : 1 / FAC[kind]; };
    loads.forEach(function (ld) {
      ld.q = p4(ld.q * f(TYPES[ld.type].kind));
      ['cx', 'cy', 'B', 'L', 'r'].forEach(function (k) { ld[k] = p4(ld[k] * f('len')); });
    });
    layers.forEach(function (L) { L.H = p4(L.H * f('len')); L.g = p4(L.g * f('gam')); L.gs = p4(L.gs * f('gam')); L.pop = p4(L.pop * f('st')); });
    var st = {};
    Object.keys(S).forEach(function (k) { st[k] = S[k]; });
    ['gwt', 'sec', 'sl'].forEach(function (k) { st[k] = p4(st[k] * f('len')); });
    units = to;
    st.u = to;
    st.W = Math.max(U().Wmin, Math.min(U().Wmax, snap(st.W * f('len'), U().Wstep)));
    buildPanel(st);
    buildLists();
    setWorlds();
    markDirty();
    saveHash();
  }

  /* ---------- hash ---------- */
  var saveTimer = 0;
  function saveHash() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      var o = {};
      Object.keys(S).forEach(function (k) { o[k] = typeof S[k] === 'boolean' ? (S[k] ? 1 : 0) : S[k]; });
      o.ld = encodeLoads();
      o.ly = encodeLayers();
      VLab.Hash.write(o);
    }, 250);
  }

  /* ---------- views ---------- */
  var planView = new VLab.View($('plan'), { xmin: -15, xmax: 15, ymin: -15, ymax: 15 }, { margin: { l: 48, r: 66, t: 10, b: 32 } });
  var secView = new VLab.View($('sec'), { xmin: -15, xmax: 15, ymin: -14, ymax: 3 }, { margin: { l: 56, r: 16, t: 8, b: 42 } });
  function plotColors() { return { ink: css('--vl-ink'), grid: css('--vl-line'), bg: css('--vl-bg') }; }
  var zPlot = new VLab.Plot($('zprof'), {
    orient: 'v', margin: { l: 42, r: 12, t: 26, b: 34 }, colors: plotColors,
    posPx: function (z) { return secView.sy(-z); }, posInv: function (py) { return -secView.wy(py); }
  });
  var xPlot = new VLab.Plot($('xprof'), {
    orient: 'h', margin: { l: 56, r: 16, t: 14, b: 34 }, colors: plotColors,
    posPx: function (s) { return secView.sx(s); }, posInv: function (px) { return secView.wx(px); }
  });
  var secResize = secView.resize;
  secView.resize = function () { secResize.call(secView); zPlot.render(); xPlot.render(); };

  function depth() { var d = 0; layers.forEach(function (L) { d += L.H; }); return d; }
  function setWorlds() {
    var W = S.W, D = depth();
    planView.world = { xmin: -W, xmax: W, ymin: -W, ymax: W };
    secView.world = { xmin: -W, xmax: W, ymin: -D, ymax: HEAD * D };
    planView.resize();
    secView.resize();
  }
  function axisName() { return S.sax === 'x' ? 'x' : 'y'; }
  function otherName() { return S.sax === 'x' ? 'y' : 'x'; }
  function planXY(s) { return S.sax === 'x' ? [s, S.sec] : [S.sec, s]; }

  /* ---------- computation ---------- */
  var R = null, runTimer = 0;
  function dsFn(x, y, D) { return function (z) { return BQ.total(loads, x, y, Math.max(z, D * 1e-3)); }; }
  function columnAt(x, y) { return ST.column(R.P, dsFn(x, y, R.P.D), S.nsub); }

  function run() {
    var P = ST.profile(layers, S.gwt, U().gw), W = S.W;
    R = { P: P, cols: [], maxAbs: 0, map: null };
    for (var i = 0; i < NXS; i++) {
      var s = -W + 2 * W * i / (NXS - 1), xy = planXY(s), c = ST.column(P, dsFn(xy[0], xy[1], P.D), S.nsub);
      R.cols.push({ s: s, total: c.total, per: c.per.map(function (p) { return p.d; }), wInt: c.wInt });
      R.maxAbs = Math.max(R.maxAbs, Math.abs(c.total));
    }
    var sl = Math.max(-W, Math.min(W, S.sl)), xy0 = planXY(sl);
    R.sl = sl; R.col = ST.column(P, dsFn(xy0[0], xy0[1], P.D), S.nsub);
    if (S.map) {
      var f = new Float64Array(NMAP * NMAP), xs = [], lo = Infinity, hi = -Infinity;
      for (var k = 0; k < NMAP; k++) xs.push(-W + 2 * W * k / (NMAP - 1));
      for (var j = 0; j < NMAP; j++) for (i = 0; i < NMAP; i++) {
        var v = ST.column(P, dsFn(xs[i], xs[j], P.D), S.nsub).total;
        f[j * NMAP + i] = v;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      R.map = { f: f, xs: xs, lo: lo, hi: hi };
      mapColors();
    }
    profiles();
    readout();
    planView.render();
    secView.render();
    if (!$('modal').hidden) openModal();
  }

  function markDirty() {
    if (!runTimer) runTimer = requestAnimationFrame(function () { runTimer = 0; run(); });
  }

  /* settlement colour scale for the plan (display units) */
  var mapRange = null;
  function mapColors() {
    var m = R.map, F = U().setF, lo = m.lo * F, hi = m.hi * F, NB = 10, name;
    if (lo < -1e-9) { var a = Math.max(-lo, hi); lo = -a; hi = a; name = 'RdBu_r'; }
    else { lo = 0; hi = Math.max(hi, 1e-6); name = 'Blues'; }
    var iso = [];
    for (var b = 1; b < NB; b++) {
      var seg = VLab.contour(Array.prototype.map.call(m.f, function (v) { return v * F; }), NMAP, NMAP, m.xs, m.xs, lo + b * (hi - lo) / NB);
      iso = iso.concat(seg);
    }
    mapRange = { lo: lo, hi: hi, nb: NB, name: name, lut: VLab.colormap.banded(name, NB, lo, hi), iso: iso, key: '' };
  }
  function mapSample(x, y) {
    var m = R.map, n = NMAP, W = S.W, fx = (x + W) / (2 * W) * (n - 1), fy = (y + W) / (2 * W) * (n - 1);
    var i = Math.max(0, Math.min(n - 2, Math.floor(fx))), j = Math.max(0, Math.min(n - 2, Math.floor(fy))), a = fx - i, b = fy - j;
    var f = m.f;
    return (f[j * n + i] * (1 - a) + f[j * n + i + 1] * a) * (1 - b) + (f[(j + 1) * n + i] * (1 - a) + f[(j + 1) * n + i + 1] * a) * b;
  }

  /* ---------- charts ---------- */
  function profiles() {
    if (!R) return;
    var P = R.P, D = P.D, xy = planXY(R.sl), ds = dsFn(xy[0], xy[1], D), n = 200, ink = css('--vl-ink');
    var a = [], b = [], c = [], d = [], k, z;
    for (k = 0; k <= n; k++) {
      z = D * k / n;
      /* evaluate just inside each layer at the interfaces so σ'p shows its jumps */
      var zz = Math.min(D, Math.max(0, z));
      var s0 = P.s0(zz), dsv = ds(zz);
      a.push([z, s0]); b.push([z, P.sp(Math.min(D - 1e-9, zz + (k === n ? -1e-9 : 1e-9)))]); c.push([z, dsv]); d.push([z, s0 + dsv]);
    }
    var series = [];
    if (S.pv0) series.push({ pts: a, color: ink, width: 2, label: "σ'v0" });
    if (S.ppc) series.push({ pts: b, color: css('--vl-accent'), width: 2, dash: [6, 3], label: "σ'p" });
    if (S.pds) series.push({ pts: c, color: css('--vl-water'), width: 2, label: 'Δσz' });
    if (S.pvf) series.push({ pts: d, color: css('--vl-green') || '#1e8a4c', width: 2, label: "σ'vf" });
    var zd = { pos0: 0, pos1: D, series: series, posName: 'z', valName: U().st,
      posLabel: 'Depth z (' + U().len + ')', valLabel: 'Stress (' + U().st + ') at ' + axisName() + ' = ' + num(R.sl, 2) };
    if (loads.some(BQ.singular)) {
      var hi = 0;
      series.forEach(function (s) { s.pts.forEach(function (q) { if (q[0] > 0.08 * D && isFinite(q[1])) hi = Math.max(hi, q[1]); }); });
      zd.valRange = [0, hi * 1.15 || 1];
    }
    zPlot.data = zd;
    zPlot.render();

    var F = U().setF, tot = [], parts = [];
    layers.forEach(function (L, j) { if (L.type === 'fine') parts.push({ j: j, pts: [] }); });
    R.cols.forEach(function (col) {
      tot.push([col.s, -col.total * F]);
      parts.forEach(function (p) { p.pts.push([col.s, -col.per[p.j] * F]); });
    });
    var xs = [];
    if (parts.length > 1) parts.forEach(function (p) {
      xs.push({ pts: p.pts, color: layerColor(p.j), width: 1.5, dash: [5, 3], label: cleanName(layers[p.j].name) });
    });
    xs.push({ pts: tot, color: ink, width: 2, label: parts.length > 1 ? 'Total' : null });
    var mk = -R.col.total * F;
    xPlot.data = { pos0: -S.W, pos1: S.W, series: xs, posName: axisName(), valName: 'w (' + U().set + ')',
      markers: [{ pos: R.sl, val: mk, label: sig(-mk) + ' ' + U().set }],
      posLabel: axisName() + ' (' + U().len + ') along A–A′', valLabel: 'Surface w (' + U().set + ')' };
    xPlot.render();
  }

  /* ---------- readout (bottom right) ---------- */
  function caseText(cases) {
    return Object.keys(cases).map(function (k) { return k + (Object.keys(cases).length > 1 ? '×' + cases[k] : ''); }).join(', ');
  }
  function readout() {
    if (!R) return;
    var u = U(), xy = planXY(R.sl), c = R.col, F = u.setF;
    var h = '<p style="margin:0 0 4px;font-weight:600">Column at x = ' + num(xy[0], 2) + ', y = ' + num(xy[1], 2) + ' ' + u.len + '</p>' +
      '<table class="vl-table"><thead><tr><th>Layer</th><th>H (' + u.len + ')</th><th>n</th><th>case</th><th>δ (' + u.set + ')</th></tr></thead><tbody>';
    layers.forEach(function (L, k) {
      var p = c.per[k];
      h += '<tr><td><span class="vs-swatch" style="display:inline-block;vertical-align:-1px;margin-right:4px;background:' + layerColor(k) + '"></span>' +
        esc(L.name) + '</td><td>' + sig(L.H) + '</td><td>' + (L.type === 'fine' ? p.n : '') + '</td><td>' +
        (L.type === 'fine' ? caseText(p.cases) : 'coarse') + '</td><td>' + (L.type === 'fine' ? sig(p.d * F) : '0') + '</td></tr>';
    });
    h += '<tr><td><b>Total</b></td><td></td><td></td><td></td><td><b>' + sig(c.total * F) + '</b></td></tr></tbody></table>';
    if (c.subs.some(function (q) { return q.cs === 'heave*'; }))
      h += '<p class="vs-hint">σ\'<sub>f</sub> would be ≤ 0 in places: the unloading is larger than the overburden.</p>';
    $('readout').innerHTML = h;
  }

  /* ---------- sub-layer table + CSV ---------- */
  function openModal() {
    var m = $('modal'), u = U(), c = R.col, F = u.setF, xy = planXY(R.sl);
    var h = '<div class="st-modal-head"><b>Sub-layers at x = ' + num(xy[0], 2) + ', y = ' + num(xy[1], 2) + ' ' + u.len +
      '</b><button type="button" class="vl-btn" id="mclose">Close</button></div>' +
      '<table class="vl-table st-wide"><thead><tr><th>i</th><th>Layer</th><th>z<sub>i</sub> (' + u.len + ')</th><th>H (' + u.len + ')</th>' +
      '<th>σ\'<sub>0</sub></th><th>σ\'<sub>p</sub></th><th>Δσ<sub>z</sub></th><th>σ\'<sub>f</sub></th><th>case</th><th>δ<sub>i</sub> (' + u.len + ')</th></tr></thead><tbody>';
    c.subs.forEach(function (q, i) {
      h += '<tr><td>' + (i + 1) + '</td><td>' + esc(layers[q.layer].name) + '</td><td>' + num(q.z, 3) + '</td><td>' + num(q.H, 3) + '</td><td>' +
        sig(q.s0) + '</td><td>' + sig(q.sp) + '</td><td>' + sig(q.ds) + '</td><td>' + sig(q.sf) + '</td><td>' + q.cs + '</td><td>' + q.d.toFixed(4) + '</td></tr>';
    });
    h += '</tbody></table><p class="vs-hint">Stresses in ' + u.st + '. Total δ = Σ δ<sub>i</sub> = <b>' + c.total.toFixed(4) + ' ' + u.len +
      '</b> = ' + sig(c.total * F) + ' ' + u.set + '. Change “Sub-layers per fine layer” to see how the answer converges.</p>';
    m.innerHTML = h;
    m.hidden = false;
    $('mclose').addEventListener('click', function () { m.hidden = true; });
  }
  function subCSV() {
    var u = U(), xy = planXY(R.sl), L = ['# CIE 365 Virtual Soil Lab: primary consolidation settlement, column at x = ' + num(xy[0], 3) + ', y = ' + num(xy[1], 3) + ' ' + u.len,
      ['i', 'layer', 'z_' + u.len, 'H_' + u.len, "s0_" + u.st, 'sp_' + u.st, 'dsigma_' + u.st, 'sf_' + u.st, 'case', 'delta_' + u.len].join(',')];
    R.col.subs.forEach(function (q, i) {
      L.push([i + 1, cleanName(layers[q.layer].name), q.z.toFixed(4), q.H.toFixed(4), q.s0.toPrecision(6), isFinite(q.sp) ? q.sp.toPrecision(6) : '',
        q.ds.toPrecision(6), q.sf.toPrecision(6), q.cs, q.d.toPrecision(6)].join(','));
    });
    L.push('# total,' + R.col.total.toPrecision(6));
    return L.join('\r\n');
  }
  function surfCSV() {
    var u = U(), L = ['# Surface settlement along A-A\' (' + axisName() + ' at ' + otherName() + ' = ' + S.sec + ' ' + u.len + ')',
      [axisName() + '_' + u.len, 'settlement_' + u.set].concat(layers.map(function (Ly, k) { return Ly.type === 'fine' ? 'layer' + (k + 1) + '_' + u.set : null; })
        .filter(Boolean)).join(',')];
    R.cols.forEach(function (c) {
      L.push([c.s.toFixed(4), (c.total * u.setF).toPrecision(6)].concat(c.per.filter(function (d, k) { return layers[k].type === 'fine'; })
        .map(function (d) { return (d * u.setF).toPrecision(6); })).join(','));
    });
    return L.join('\r\n');
  }
  function download(text, name) {
    if (!R) return;
    var url = URL.createObjectURL(new Blob([text + '\r\n'], { type: 'text/csv' })), a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---------- lists + editor ---------- */
  var addingType = null;
  function buildLists() {
    var box = $('loads');
    box.innerHTML = '';
    box.appendChild(VLab.el('h3', 'vl-heading', 'Surface loads'));
    var tools = VLab.el('div', 'vs-tools');
    ORDER.forEach(function (type) {
      var b = VLab.el('button', 'vl-btn' + (addingType === type ? ' vl-on' : ''), '+ ' + TYPES[type].name);
      b.type = 'button';
      b.disabled = loads.length >= MAX_LOADS;
      b.addEventListener('click', function () { addingType = addingType === type ? null : type; buildLists(); planView.render(); });
      tools.appendChild(b);
    });
    box.appendChild(tools);
    var ul = VLab.el('ul', 'vs-list');
    loads.forEach(function (ld) {
      var li = VLab.el('li', selKind === 'load' && ld.id === selId ? 'vs-sel' : '');
      var sw = VLab.el('span', 'vs-swatch'); sw.style.background = slotColor(ld);
      li.appendChild(sw);
      li.appendChild(VLab.el('span', null, label(ld) + '  ' + qText(ld)));
      li.addEventListener('click', function () { selectLoad(ld.id); });
      ul.appendChild(li);
    });
    box.appendChild(ul);
    if (addingType) box.appendChild(VLab.el('p', 'vs-hint', 'Click in the plan to place the ' + TYPES[addingType].name.toLowerCase() + ' load.'));

    box.appendChild(VLab.el('h3', 'vl-heading', 'Soil layers, top to bottom'));
    var t2 = VLab.el('div', 'vs-tools');
    [['fine', '+ Fine-grained layer'], ['coarse', '+ Coarse-grained layer']].forEach(function (p) {
      var b = VLab.el('button', 'vl-btn', p[1]);
      b.type = 'button';
      b.disabled = layers.length >= MAX_LAYERS;
      b.addEventListener('click', function () {
        layers.push(newLayer(p[0], { name: p[0] === 'fine' ? 'Clay ' + (layers.filter(function (L) { return L.type === 'fine'; }).length + 1) : 'Sand' }));
        selectLayer(layers.length - 1);
        layersChanged();
      });
      t2.appendChild(b);
    });
    box.appendChild(t2);
    var ul2 = VLab.el('ul', 'vs-list');
    layers.forEach(function (L, k) {
      var li = VLab.el('li', selKind === 'layer' && selLayer === k ? 'vs-sel' : '');
      var sw = VLab.el('span', 'vs-swatch'); sw.style.background = layerColor(k);
      li.appendChild(sw);
      li.appendChild(VLab.el('span', null, (k + 1) + '  ' + L.name + ' · ' + sig(L.H) + ' ' + U().len));
      li.appendChild(VLab.el('span', 'st-badge st-' + L.type, L.type === 'fine' ? 'fine' : 'coarse'));
      li.addEventListener('click', function () { selectLayer(k); });
      ul2.appendChild(li);
    });
    box.appendChild(ul2);
    box.appendChild(VLab.el('p', 'vs-hint', 'Only fine-grained layers get consolidation properties and settle. Click a layer here or in the section to edit it.'));
  }

  function selectLoad(id) { selKind = 'load'; selId = id; buildLists(); buildEditor(); planView.render(); }
  function selectLayer(k) { selKind = 'layer'; selLayer = k; buildLists(); buildEditor(); secView.render(); planView.render(); }

  function buildEditor() {
    var slot = $('edit');
    if (!slot) return;
    slot.innerHTML = '';
    var u = U();
    if (selKind === 'layer' && layers[selLayer]) {
      var L = layers[selLayer], k = selLayer;
      var title = VLab.el('div', 'vl-row');
      title.innerHTML = '<label class="vl-row vl-number"><span class="vl-label"><span class="vs-swatch" style="display:inline-block;background:' +
        layerColor(k) + '"></span>&nbsp;Layer ' + (k + 1) + ' name</span><input type="text" id="lyname" maxlength="24"></label>';
      slot.appendChild(title);
      var nm = $('lyname'); nm.value = L.name;
      nm.addEventListener('change', function () { L.name = cleanName(nm.value); layersChanged(); });
      var sc = [
        { type: 'select', key: 'type', label: 'Soil type', value: L.type, options: [['fine', 'Fine-grained (clay, silt)'], ['coarse', 'Coarse-grained (sand, gravel)']] },
        { type: 'number', key: 'H', label: 'Thickness (' + u.len + ')', value: L.H, step: 'any' },
        { type: 'number', key: 'g', label: 'γ above water table (' + u.gam + ')', value: L.g, step: 'any' },
        { type: 'number', key: 'gs', label: 'γ<sub>sat</sub> (' + u.gam + ')', value: L.gs, step: 'any' },
        { type: 'number', key: 'e0', label: 'e<sub>0</sub>', value: L.e0, step: 'any', visibleIf: function (s) { return s.type === 'fine'; } },
        { type: 'number', key: 'Cc', label: 'C<sub>c</sub>', value: L.Cc, step: 'any', visibleIf: function (s) { return s.type === 'fine'; } },
        { type: 'number', key: 'Cr', label: 'C<sub>r</sub>', value: L.Cr, step: 'any', visibleIf: function (s) { return s.type === 'fine'; } },
        { type: 'select', key: 'hist', label: 'Stress history', value: L.hist, visibleIf: function (s) { return s.type === 'fine'; },
          options: [['ocr', "OCR = σ'p/σ'v0"], ['pop', "POP = σ'p − σ'v0"]] },
        { type: 'number', key: 'ocr', label: 'OCR', value: L.ocr, min: 1, step: 'any', visibleIf: function (s) { return s.type === 'fine' && s.hist === 'ocr'; } },
        { type: 'number', key: 'pop', label: 'POP (' + u.st + ')', value: L.pop, min: 0, step: 'any', visibleIf: function (s) { return s.type === 'fine' && s.hist === 'pop'; } },
        { type: 'buttons', items: [
          { label: '↑ Up', onClick: function () { moveLayer(k, -1); } },
          { label: '↓ Down', onClick: function () { moveLayer(k, 1); } },
          { label: 'Delete', onClick: function () {
            if (layers.length < 2) return;
            layers.splice(k, 1); selLayer = Math.min(k, layers.length - 1); buildEditor(); layersChanged();
          } }] }
      ];
      new VLab.Controls(slot, sc, function (s, key) { L[key] = s[key]; if (key === 'type') buildEditor(); layersChanged(); });
      return;
    }
    var ld = selected();
    if (!ld) { slot.innerHTML = '<p class="vl-muted">Nothing selected. Click a load in the plan or a layer in the section.</p>'; return; }
    var t = TYPES[ld.type], qlab = (ld.type === 'point' ? 'Q' : ld.type === 'tri' ? 'q<sub>max</sub>' : 'q') + ' (' + loadUnit(ld.type) + ')';
    var head = VLab.el('p', 'vl-row');
    head.style.cssText = 'display:flex;align-items:center;gap:8px;font-weight:600';
    head.innerHTML = '<span class="vs-swatch" style="background:' + slotColor(ld) + '"></span>' + esc(label(ld));
    slot.appendChild(head);
    var sc2 = [
      { type: 'number', key: 'q', label: '<span>' + qlab + ' <span class="vl-muted">(− unloads)</span></span>', value: ld.q, min: -1e9, step: 'any' },
      { type: 'number', key: 'cx', label: 'Centre x (' + u.len + ')', value: ld.cx, min: -1e5, step: 'any' },
      { type: 'number', key: 'cy', label: 'Centre y (' + u.len + ')', value: ld.cy, min: -1e5, step: 'any' }
    ];
    if (t.B) sc2.push({ type: 'number', key: 'B', label: 'Width B (' + u.len + ')', value: ld.B, step: 'any' });
    if (t.L) sc2.push({ type: 'number', key: 'L', label: 'Length L (' + u.len + ')', value: ld.L, step: 'any', visibleIf: function (s) { return !s.inf; } });
    if (t.r) sc2.push({ type: 'number', key: 'r', label: 'Radius r<sub>0</sub> (' + u.len + ')', value: ld.r, step: 'any' });
    if (t.canInf) sc2.push({ type: 'toggle', key: 'inf', label: 'Infinitely long (2D case)', value: ld.inf });
    if (t.rot) sc2.push({ type: 'range', key: 'angle', label: 'Rotation', min: -180, max: 180, step: 1, value: ld.angle, unit: '°', digits: 0 });
    sc2.push({ type: 'buttons', items: [
      { label: 'Duplicate', onClick: function () {
        if (loads.length >= MAX_LOADS) return;
        var c = makeLoad(ld.type, ld.cx + 1, ld.cy - 1, { q: ld.q, angle: ld.angle, B: ld.B, L: ld.L, r: ld.r, inf: ld.inf });
        loads.push(c); selectLoad(c.id); loadsChanged();
      } },
      { label: 'Delete', onClick: function () { removeLoad(ld.id); } }] });
    editor = new VLab.Controls(slot, sc2, function (s, key) { ld[key] = s[key]; buildLists(); loadsChanged(); });
  }
  var editor = null;
  function syncEditor(keys) {
    var ld = selected();
    if (!editor || !ld) return;
    keys.forEach(function (k) { editor.set(k, ld[k]); });
  }
  function moveLayer(k, d) {
    var j = k + d;
    if (j < 0 || j >= layers.length) return;
    var t = layers[k]; layers[k] = layers[j]; layers[j] = t;
    selLayer = j;
    buildEditor();
    layersChanged();
  }
  function removeLoad(id) {
    loads = loads.filter(function (l) { return l.id !== id; });
    if (selId === id) selId = loads.length ? loads[loads.length - 1].id : 0;
    buildEditor();
    loadsChanged();
  }
  function loadsChanged() { buildLists(); planView.render(); markDirty(); saveHash(); }
  function layersChanged() { buildLists(); setWorlds(); markDirty(); saveHash(); }

  /* ---------- plan view ---------- */
  function rotHandle(ld, v) {
    var a = ld.angle * Math.PI / 180, Rr = (ld.inf ? 0.4 * S.W : ld.L / 2) + 22 / v.s;
    return [ld.cx + Rr * Math.sin(a), ld.cy - Rr * Math.cos(a)];
  }
  function sizeHandle(ld) {
    if (ld.type === 'point') return null;
    if (ld.type === 'circle') return [ld.cx + ld.r, ld.cy];
    if (ld.type === 'line') return ld.inf ? null : toPlan(ld, 0, ld.L / 2);
    return toPlan(ld, ld.B / 2, ld.inf ? 0 : ld.L / 2);
  }
  function grips() { var W = S.W, x = S.sax === 'x'; return [x ? [-W, S.sec] : [S.sec, -W], x ? [W, S.sec] : [S.sec, W]]; }
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
    c.save(); c.clip();
    c.strokeStyle = rgba(css('--vl-ink').length === 7 ? css('--vl-ink') : '#000000', 0.55); c.lineWidth = 1;
    c.beginPath();
    for (var d = -v.H; d < v.W; d += 7) { c.moveTo(d, v.H); c.lineTo(d + v.H, 0); }
    c.stroke(); c.restore();
  }
  function planTick(w) {
    var c = [1, 2, 2.5, 5, 10, 20, 25, 50];
    for (var k = 0; k < c.length; k++) if (w / c[k] <= 3 && Math.abs(w / c[k] - Math.round(w / c[k])) < 1e-9) return c[k];
    return w;
  }
  function tickFor(w) {
    var cands = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50];
    for (var k = 0; k < cands.length; k++) if (w / cands[k] <= 6 && Math.abs(w / cands[k] - Math.round(w / cands[k])) < 1e-9) return cands[k];
    return VLab.Plot.niceStep(w, 4);
  }

  var planHover = null;
  planView.draw = function (c, v) {
    var ink = css('--vl-ink'), line = css('--vl-line'), accent = css('--vl-accent'), bg = css('--vl-bg'), W = S.W;
    /* settlement map */
    if (S.map && R && R.map && mapRange) {
      var key = [v.W, v.H, v.dpr, mapRange.lo, mapRange.hi, R.map.f[0], R.map.f[(NMAP * NMAP) >> 1], W].join('|');
      if (key !== mapRange.key) {
        var F = U().setF;
        mapRange.raster = v.raster(-W, W, -W, W, function (x, y) { return mapRange.lut(mapSample(x, y) * F); });
        mapRange.key = key;
      }
      var rs = mapRange.raster;
      c.save(); c.globalAlpha = 0.85; c.drawImage(rs.canvas, rs.x, rs.y, rs.w, rs.h); c.restore();
      v.segments(c, mapRange.iso, { color: 'rgba(0,0,0,0.35)', width: 1 });
      planColorbar(c, v, ink);
    }
    var step = VLab.Plot.niceStep(2 * W, 6);
    c.save();
    c.strokeStyle = line; c.lineWidth = 1; c.globalAlpha = S.map ? 0.5 : 1;
    c.beginPath();
    for (var g = Math.ceil(-W / step) * step; g <= W + 1e-9; g += step) {
      c.moveTo(v.sx(g) + 0.5, v.sy(-W)); c.lineTo(v.sx(g) + 0.5, v.sy(W));
      c.moveTo(v.sx(-W), v.sy(g) + 0.5); c.lineTo(v.sx(W), v.sy(g) + 0.5);
    }
    c.stroke(); c.restore();
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
        c.fillStyle = rgba(col, S.map ? 0.18 : 0.38); c.fill();
        c.strokeStyle = col; c.lineWidth = 2; c.stroke();
        if (ld.q < 0) { footprint(c, v, ld); hatch(c, v); }
      }
      c.restore();
    });
    c.restore();
    /* section line and column marker */
    var gp = grips(), s0 = planXY(Math.max(-W, Math.min(W, S.sl)));
    c.save();
    c.strokeStyle = ink; c.lineWidth = 1.5; c.setLineDash([8, 4, 2, 4]);
    c.beginPath(); c.moveTo(v.sx(gp[0][0]), v.sy(gp[0][1])); c.lineTo(v.sx(gp[1][0]), v.sy(gp[1][1])); c.stroke();
    c.setLineDash([]);
    c.strokeStyle = accent; c.lineWidth = 2.5;
    c.beginPath(); c.arc(v.sx(s0[0]), v.sy(s0[1]), 5, 0, 2 * Math.PI); c.stroke();
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
    var len = U().len;
    v.axes(c, { x0: -W, x1: W, y0: -W, y1: W, dxTick: planTick(W), dyTick: planTick(W), xlabel: 'x (' + len + ')', ylabel: 'y (' + len + ')', color: ink, font: 11 });
    if (addingType) {
      c.save(); c.fillStyle = accent; c.font = '600 12px system-ui, sans-serif'; c.textAlign = 'center';
      c.fillText('Click to place', v.sx(0), v.sy(W) + 14); c.restore();
    } else if (planHover && R && !drag) {
      var w = ST.column(R.P, dsFn(planHover.x, planHover.y, R.P.D), S.nsub).total * U().setF;
      tip(c, v.sx(planHover.x), v.sy(planHover.y), ['x, y = ' + num(planHover.x, 2) + ', ' + num(planHover.y, 2) + ' ' + len,
        'settlement δ = ' + sig(w) + ' ' + U().set], ink, bg);
    }
  };
  function planColorbar(c, v, ink) {
    var m = mapRange, N = m.nb, x = v.sx(S.W) + 12, w = 12, top = v.sy(S.W), bot = v.sy(-S.W), hgt = bot - top;
    c.save();
    for (var b = 0; b < N; b++) {
      c.fillStyle = VLab.colormap.css(VLab.colormap.band(m.name, b, N));
      c.fillRect(x, bot - (b + 1) * hgt / N, w, hgt / N + 0.5);
    }
    c.strokeStyle = ink; c.lineWidth = 1; c.strokeRect(x + 0.5, top + 0.5, w, hgt);
    c.fillStyle = ink; c.font = '10px system-ui, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
    var every = Math.ceil(N / Math.max(2, Math.floor(hgt / 16)));
    for (var k = 0; k <= N; k += every) c.fillText(sig(m.lo + k * (m.hi - m.lo) / N), x + w + 4, bot - k * hgt / N);
    c.save(); c.translate(x + w + 40, (top + bot) / 2); c.rotate(-Math.PI / 2); c.textAlign = 'center';
    c.font = '600 11px system-ui, sans-serif'; c.fillText('settlement δ (' + U().set + ')', 0, 0); c.restore();
    c.restore();
  }
  function tip(c, px, py, lines, ink, bg) {
    c.save();
    c.font = '12px system-ui, sans-serif';
    var tw = 0;
    lines.forEach(function (t) { tw = Math.max(tw, c.measureText(t).width); });
    var bw = tw + 12, bh = lines.length * 15 + 8, bx = px + 12, by = py - bh - 6;
    if (bx + bw > c.canvas.width / (window.devicePixelRatio || 1) - 4) bx = px - bw - 12;
    if (by < 2) by = py + 12;
    c.fillStyle = bg; c.globalAlpha = 0.95; c.fillRect(bx, by, bw, bh); c.globalAlpha = 1;
    c.strokeStyle = css('--vl-line'); c.strokeRect(bx + 0.5, by + 0.5, bw, bh);
    c.fillStyle = ink; c.textAlign = 'left'; c.textBaseline = 'top';
    lines.forEach(function (t, n) { c.font = (n ? '' : '600 ') + '12px system-ui, sans-serif'; c.fillText(t, bx + 6, by + 5 + n * 15); });
    c.restore();
  }

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
        loads.push(nl); addingType = null; selectLoad(nl.id); loadsChanged();
        drag = { mode: 'move', dx: 0, dy: 0 };
      }
    } else if (ld && sizeHandle(ld) && near(v, p, sizeHandle(ld))) drag = { mode: 'size' };
    else if (ld && TYPES[ld.type].rot && near(v, p, rotHandle(ld, v))) drag = { mode: 'rot' };
    else if (near(v, p, grips()[0]) || near(v, p, grips()[1])) drag = { mode: 'sec' };
    else {
      var hit = hitLoad(p);
      if (hit) { if (!(selKind === 'load' && hit.id === selId)) selectLoad(hit.id); drag = { mode: 'move', dx: p.x - hit.cx, dy: p.y - hit.cy }; }
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
      pcv.style.cursor = addingType ? 'crosshair' : over ? 'pointer' : near(v, p, grips()[0]) || near(v, p, grips()[1]) ? (S.sax === 'x' ? 'ns-resize' : 'ew-resize') :
        hitLoad(p) ? 'move' : '';
      planHover = Math.abs(p.x) <= S.W && Math.abs(p.y) <= S.W ? { x: p.x, y: p.y } : null;
      planView.render();
      return;
    }
    planHover = null;
    if (drag.mode === 'sec') {
      ui.set('sec', r2(snap(Math.max(-S.W, Math.min(S.W, S.sax === 'x' ? p.y : p.x)), 0.1)));
      markDirty(); planView.render(); saveHash();
      return;
    }
    if (!ld) return;
    var keys;
    if (drag.mode === 'move') { ld.cx = r2(snap(p.x - drag.dx, 0.1)); ld.cy = r2(snap(p.y - drag.dy, 0.1)); keys = ['cx', 'cy']; }
    else if (drag.mode === 'size') {
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
  pcv.addEventListener('pointerleave', function () { planHover = null; planView.render(); });
  pcv.addEventListener('dblclick', function (e) { var hit = hitLoad(planView.at(e)); if (hit) removeLoad(hit.id); });
  pcv.addEventListener('keydown', function (e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected()) { removeLoad(selId); e.preventDefault(); }
    if (e.key === 'Escape' && addingType) { addingType = null; buildLists(); planView.render(); }
  });

  /* ---------- section ---------- */
  function surfaceLoad(ld, x, y) {
    var q = BQ.local(ld, x, y);
    if (ld.type === 'circle') return Math.hypot(q.u, q.v) <= ld.r ? 1 : 0;
    if (Math.abs(q.u) > ld.B / 2 || (!ld.inf && Math.abs(q.v) > ld.L / 2)) return 0;
    return ld.type === 'tri' ? (q.u + ld.B / 2) / ld.B : 1;
  }
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
  /* loads drawn on the (possibly displaced) ground surface: surf(s) -> world y */
  function drawSectionLoads(c, v, ink, surf) {
    var W = S.W, D = depth(), top = 0.11 * D, n = 300, qmax = 0, placed = [];
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
        var px = v.sx(sp), y0 = surf(sp);
        c.save();
        if (off > 0.01) c.setLineDash([4, 3]);
        if (ld.q >= 0) arrow(c, px, v.sy(y0 + top), v.sy(y0) - 1, col); else arrow(c, px, v.sy(y0) - 1, v.sy(y0 + top), col);
        c.restore();
        c.fillStyle = ink;
        tag(qText(ld), px, v.sy(y0 + top) - 2);
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
      for (k = 0; k <= n; k++) { s = -W + 2 * W * k / n; c.lineTo(v.sx(s), v.sy(surf(s) + h[k] * hs)); }
      for (k = n; k >= 0; k--) { s = -W + 2 * W * k / n; c.lineTo(v.sx(s), v.sy(surf(s))); }
      c.closePath();
      c.fillStyle = rgba(col, 0.35); c.fill();
      c.strokeStyle = col; c.stroke();
      var sMax = -W, best = -1;
      for (k = 0; k <= n; k++) if (h[k] > best) { best = h[k]; sMax = -W + 2 * W * k / n; }
      c.fillStyle = ink;
      tag(qText(ld), v.sx(sMax), v.sy(surf(sMax) + best * hs) - 2);
    });
    c.restore();
  }

  function defScale() {
    if (!S.def || !R) return 0;
    if (S.dsc !== 'auto') return +S.dsc;
    if (R.maxAbs < 1e-12) return 1;
    var raw = 0.07 * R.P.D / R.maxAbs, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * p;
  }

  function depthTick(D) {
    var c = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50];
    for (var k = 0; k < c.length; k++) if (D / c[k] <= 8 && Math.abs(D / c[k] - Math.round(D / c[k])) < 1e-6) return c[k];
    return VLab.Plot.niceStep(D, 4);
  }
  var secHover = null;
  secView.draw = function (c, v) {
    var ink = css('--vl-ink'), accent = css('--vl-accent'), bg = css('--vl-bg'), W = S.W, D = depth();
    if (!R) return;
    var P = R.P, sc = defScale(), cols = R.cols, nL = layers.length;
    function yInt(k, i) { return -P.tops.concat([P.D])[k] - cols[i].wInt[k] * sc; }
    /* layers as polygons between displaced interfaces */
    for (var k = 0; k < nL; k++) {
      c.save();
      c.beginPath();
      var i;
      for (i = 0; i < cols.length; i++) c.lineTo(v.sx(cols[i].s), v.sy(yInt(k, i)));
      for (i = cols.length - 1; i >= 0; i--) c.lineTo(v.sx(cols[i].s), v.sy(yInt(k + 1, i)));
      c.closePath();
      var col = layerColor(k);
      c.fillStyle = rgba(col, dark() ? 0.55 : 0.75); c.fill();
      c.clip();
      c.strokeStyle = rgba('#000000', 0.25); c.fillStyle = rgba('#000000', 0.28); c.lineWidth = 1;
      var y0 = v.sy(-P.tops[k] + 0.2 * D), y1 = v.sy(-P.tops[k] - layers[k].H - 0.2 * D);
      if (layers[k].type === 'fine') {
        c.beginPath();
        for (var yy = y0; yy < y1; yy += 7) for (var xx = v.sx(-W) + ((yy / 7) % 2) * 6; xx < v.sx(W); xx += 12) { c.moveTo(xx, yy); c.lineTo(xx + 6, yy); }
        c.stroke();
      } else {
        for (var y2 = y0; y2 < y1; y2 += 6) for (var x2 = v.sx(-W) + ((y2 / 6) % 2) * 3; x2 < v.sx(W); x2 += 6) c.fillRect(x2, y2, 1.4, 1.4);
      }
      c.restore();
      if (selKind === 'layer' && selLayer === k) {
        c.save(); c.strokeStyle = accent; c.lineWidth = 2.5; c.beginPath();
        for (i = 0; i < cols.length; i++) c.lineTo(v.sx(cols[i].s), v.sy(yInt(k, i)));
        for (i = cols.length - 1; i >= 0; i--) c.lineTo(v.sx(cols[i].s), v.sy(yInt(k + 1, i)));
        c.closePath(); c.stroke(); c.restore();
      }
    }
    /* interfaces: displaced solid, original dashed */
    c.save();
    for (k = 0; k <= nL; k++) {
      c.strokeStyle = k === 0 ? ink : rgba('#000000', 0.55); c.lineWidth = k === 0 ? 2 : 1;
      c.beginPath();
      for (var j = 0; j < cols.length; j++) c.lineTo(v.sx(cols[j].s), v.sy(yInt(k, j)));
      c.stroke();
      if (sc > 0 && k < nL) {
        c.setLineDash([5, 4]); c.strokeStyle = rgba(ink.length === 7 ? ink : '#000000', 0.6); c.lineWidth = 1;
        c.beginPath(); c.moveTo(v.sx(-W), v.sy(-P.tops[k])); c.lineTo(v.sx(W), v.sy(-P.tops[k])); c.stroke();
        c.setLineDash([]);
      }
    }
    c.restore();
    /* layer labels */
    c.save();
    c.font = '600 11px system-ui, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
    layers.forEach(function (L, k2) {
      var ym = v.sy(-P.tops[k2] - L.H / 2);
      if (L.H * v.s < 14) return;
      var t = L.name + (L.type === 'fine' ? '  e₀ ' + L.e0 + ', Cc ' + L.Cc + ', Cr ' + L.Cr + ', ' + (L.hist === 'pop' ? 'POP ' + L.pop : 'OCR ' + L.ocr) : '  (coarse)');
      var tw = c.measureText(t).width + 8;
      c.fillStyle = rgba(bg.length === 7 ? bg : '#ffffff', 0.78); c.fillRect(v.sx(-W) + 4, ym - 8, tw, 16);
      c.fillStyle = ink; c.fillText(t, v.sx(-W) + 8, ym);
    });
    c.restore();
    /* water table */
    if (S.gwt < D) {
      var yw = v.sy(-S.gwt), xw = v.sx(W) - 26, wc = css('--vl-water');
      c.save(); c.strokeStyle = wc; c.lineWidth = 1.5; c.setLineDash([10, 4]);
      c.beginPath(); c.moveTo(v.sx(-W), yw); c.lineTo(v.sx(W), yw); c.stroke(); c.setLineDash([]);
      c.fillStyle = wc; c.beginPath(); c.moveTo(xw - 7, yw - 11); c.lineTo(xw + 7, yw - 11); c.lineTo(xw, yw - 1); c.closePath(); c.fill();
      c.restore();
    }
    /* loads on the displaced surface */
    function surf(s) {
      var fi = (s + W) / (2 * W) * (cols.length - 1), i0 = Math.max(0, Math.min(cols.length - 2, Math.floor(fi))), t = fi - i0;
      return -(cols[i0].wInt[0] * (1 - t) + cols[i0 + 1].wInt[0] * t) * sc;
    }
    drawSectionLoads(c, v, ink, surf);
    /* settlement column */
    var sl = R.sl;
    c.save();
    c.strokeStyle = accent; c.lineWidth = 1.6; c.setLineDash([7, 4]);
    c.beginPath(); c.moveTo(v.sx(sl), v.sy(surf(sl))); c.lineTo(v.sx(sl), v.sy(-D)); c.stroke();
    c.setLineDash([]); c.fillStyle = accent; c.fillRect(v.sx(sl) - 5, v.sy(-D) - 10, 10, 10);
    c.restore();
    var len = U().len;
    /* x axis from VLab.View; depth ticks drawn here so they are round numbers from the surface */
    v.axes(c, { x0: -W, x1: W, y0: -D, y1: 0, dxTick: tickFor(W), dyTick: 2 * D + 1,
      xlabel: axisName() + ' (' + len + ')  ·  section A–A′ at ' + otherName() + ' = ' + num(S.sec, 2) + ' ' + len, ylabel: 'Depth z (' + len + ')',
      yfmt: function () { return ''; }, color: ink });
    var dt = depthTick(D), lx = v.sx(-W) - 0.5;
    c.save(); c.strokeStyle = ink; c.fillStyle = ink; c.lineWidth = 1; c.font = '12px system-ui, sans-serif';
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (var zt = 0; zt <= D + 1e-9; zt += dt) {
      var py = v.sy(-zt);
      c.beginPath(); c.moveTo(lx, py); c.lineTo(lx - 4, py); c.stroke();
      c.fillText(String(Math.round(zt * 100) / 100), lx - 6, py);
    }
    c.restore();
    if (sc > 0) {
      c.save(); c.font = '600 11px system-ui, sans-serif'; c.fillStyle = ink; c.textAlign = 'right'; c.textBaseline = 'top';
      c.fillText('deformation ×' + sc + (S.dsc === 'auto' ? ' (auto)' : ''), v.sx(W) - 2, v.sy(HEAD * D) + 2); c.restore();
    }
    if (secHover) {
      var hz = -secHover.y, xy = planXY(secHover.x), kk = P.index(hz), cl = ST.column(P, dsFn(xy[0], xy[1], D), S.nsub);
      var ds = BQ.total(loads, xy[0], xy[1], Math.max(hz, D * 1e-3)), s0 = P.s0(hz), u = U();
      var lines = [axisName() + ' = ' + num(secHover.x, 2) + ' ' + len + ', z = ' + num(hz, 2) + ' ' + len, layers[kk].name + (layers[kk].type === 'fine' ? ' (fine)' : ' (coarse)'),
        "σ'v0 = " + sig(s0) + ' ' + u.st, 'Δσz = ' + sig(ds) + ' ' + u.st, "σ'vf = " + sig(s0 + ds) + ' ' + u.st];
      if (layers[kk].type === 'fine') lines.splice(3, 0, "σ'p = " + sig(P.sp(hz)) + ' ' + u.st);
      lines.push('displacement w = ' + sig(cl.w(hz) * u.setF) + ' ' + u.set);
      tip(c, secHover.px, secHover.py, lines, ink, bg);
    }
  };

  var sdrag = null, scv = secView.canvas;
  function inSoil(p) { return Math.abs(p.x) <= S.W && p.y <= 0 && p.y >= -depth(); }
  function onVLine(p) { return R && Math.abs(secView.sx(R.sl) - p.px) < 6 && p.y <= 0.05 * depth() && p.y >= -depth() * 1.05; }
  scv.addEventListener('pointerdown', function (e) {
    var p = secView.at(e);
    if (onVLine(p)) sdrag = true;
    else if (inSoil(p) && R) { selectLayer(R.P.index(-p.y)); return; }
    else return;
    e.preventDefault();
    try { scv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
  });
  scv.addEventListener('pointermove', function (e) {
    var p = secView.at(e);
    if (!sdrag) {
      scv.style.cursor = onVLine(p) ? 'ew-resize' : inSoil(p) ? 'pointer' : '';
      secHover = inSoil(p) ? p : null;
      secView.render();
      return;
    }
    secHover = null;
    ui.set('sl', r2(snap(Math.max(-S.W, Math.min(S.W, p.x)), 0.05)));
    markDirty(); saveHash();
  });
  function endSDrag() { sdrag = null; }
  scv.addEventListener('pointerup', endSDrag);
  scv.addEventListener('pointercancel', endSDrag);
  scv.addEventListener('pointerleave', function () { secHover = null; secView.render(); });

  /* ---------- self test ---------- */
  function autotest() {
    var T = ST.selfTest(), out = T.lines.slice(), ok = T.ok;
    function check(name, cond, info) { out.push((cond ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); ok = ok && cond; }
    /* default scenario */
    run();
    var mid = (NXS - 1) / 2, cm = R.cols[mid];
    check('coarse layers do not settle', layers.every(function (L, k) { return L.type === 'fine' || cm.per[k] === 0; }));
    var edge = R.cols[Math.round(mid + 5 / (2 * S.W) * (NXS - 1))], far = R.cols[NXS - 2];
    check('centre > edge > far', cm.total > edge.total && edge.total > far.total,
      (cm.total * 1000).toFixed(1) + ' > ' + (edge.total * 1000).toFixed(1) + ' > ' + (far.total * 1000).toFixed(1) + ' mm');
    var mc = R.map.f[((NMAP - 1) / 2) * NMAP + (NMAP - 1) / 2];
    check('plan map = section at the centre', Math.abs(mc - cm.total) < 1e-12);
    check('surface displacement = total', Math.abs(cm.wInt[0] - cm.total) < 1e-12 && cm.wInt[layers.length] === 0);
    /* units round trip */
    var before = JSON.stringify([encodeLoads(), encodeLayers(), S.gwt]);
    var totSI = cm.total;
    ui.set('u', 'US'); convertUnits('SI', 'US'); run();
    var totUS = R.cols[(NXS - 1) / 2].total;
    check('US units: same settlement (ft vs m)', Math.abs(totUS / 3.28084 / totSI - 1) < 0.01, (totUS * 12).toFixed(2) + ' in vs ' + (totSI * 1000).toFixed(1) + ' mm');
    convertUnits('US', 'SI'); run();
    var after = JSON.stringify([encodeLoads(), encodeLayers(), S.gwt]);
    check('SI → US → SI round trip', Math.abs(R.cols[(NXS - 1) / 2].total / totSI - 1) < 2e-3, before === after ? 'identical' : 'within rounding');
    /* Example 7.4 through the lab (US units, Boussinesq strip) */
    convertUnits('SI', 'US');
    layers = [newLayer('fine', { name: 'CH clay', H: 25, g: 125, gs: 125, e0: 0.95, Cc: 0.33, Cr: 0.04, ocr: 1.5 })];
    loads = []; loads = [makeLoad('strip', 0, 0, { q: 6000, B: 15, inf: true })];
    ui.set('gwt', 0); ui.set('nsub', 10); ui.set('sl', 0); ui.set('W', 40);
    setWorlds(); run();
    check('Example 7.4 in the lab, 10 sub-layers', Math.abs(R.col.total - 3.134) < 5e-3, R.col.total.toFixed(4) + ' ft');
    ui.set('nsub', 1); run();
    check('Example 7.4 in the lab, single layer', Math.abs(R.col.total - 2.5725) < 1e-3, R.col.total.toFixed(4) + ' ft');
    ui.set('nsub', 10); run();
    var pre = document.createElement('pre'); pre.id = 'selftest'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
    document.title = 'AUTOTEST ' + (ok ? 'PASS' : 'FAIL');
  }

  /* ---------- boot ---------- */
  layers = decodeLayers(initial.ly);
  if (!layers.length) layers = defaultLayers();
  loads = decodeLoads(initial.ld);
  if (!initial.ld) loads = [makeLoad('rect', 0, 0, { q: units === 'US' ? 2089 : 100, B: units === 'US' ? 32.8 : 10, L: units === 'US' ? 32.8 : 10 })];
  selId = loads.length ? loads[0].id : 0;
  var init0 = {};
  Object.keys(initial).forEach(function (k) { init0[k] = initial[k]; });
  init0.u = units;
  if (initial.W == null && units === 'US') init0.W = 50;
  buildPanel(init0);
  buildLists();
  setWorlds();
  run();
  saveHash();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { buildLists(); profiles(); planView.render(); secView.render(); });
  if (AUTOTEST) {
    try { autotest(); } catch (err) {
      document.title = 'AUTOTEST ERROR';
      var p = document.createElement('pre'); p.id = 'selftest'; p.textContent = err.stack; document.body.appendChild(p);
    }
  }
  VLab.settlement = { run: run, results: function () { return R; }, layers: function () { return layers; }, loads: function () { return loads; }, ui: function () { return ui; } };
})(window.VLab);
