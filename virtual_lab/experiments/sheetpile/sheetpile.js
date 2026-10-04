/* Virtual Lab experiment: steady seepage under a single sheet pile.
   Geometry follows Example 4.18 (the old JupyterLite notebook): 60 m x 30 m of
   soil, sheet pile at x = 30 m driven to 11 m depth, water ponded on both sides.
   Heads are measured from a datum at the base of the soil (elevation 0), so
   the ground surface is at elevation 30 m. */
(function (VLab) {
  'use strict';

  var GEO = {
    L: 60, D: 30,            /* soil block (m) */
    xWall: 30, wallDepth: 11,
    nx: 152, nz: 76,         /* 0.397 m x 0.4 m: wall falls between two columns, tip on a face edge */
    hMin: 30, hMax: 45       /* head slider range = water above the ground surface */
  };
  var GAMMA_W = 9.81;

  /* ---------- model ---------- */
  var g = new VLab.Grid2D({ x0: 0, x1: GEO.L, z0: 0, z1: GEO.D, nx: GEO.nx, nz: GEO.nz });
  var wall = g.cutVertical(GEO.xWall, 0, GEO.wallDepth);
  var h = new Float64Array(g.n);
  var solver = new VLab.Laplace.Direct(g);
  var solveCount = 0;

  function elev(z) { return GEO.D - z; }

  function applyBC(s) {
    var nx = g.nx, nz = g.nz, i, j;
    g.clearFixed();
    if (s.bottom === 'fixed') for (i = 0; i < nx; i++) g.fix(i, nz - 1, s.hb);
    if (s.left === 'fixed') for (j = 0; j < nz; j++) g.fix(0, j, s.hu);
    if (s.right === 'fixed') for (j = 0; j < nz; j++) g.fix(nx - 1, j, s.hd);
    for (i = 0; i < nx; i++) g.fix(i, 0, i <= wall.iLeft ? s.hu : s.hd);
  }

  /* ---------- UI ---------- */
  var schema = [
    { type: 'heading', label: 'Boundary conditions' },
    { type: 'range', key: 'hu', label: 'Upstream head h<sub>up</sub>', min: GEO.hMin, max: GEO.hMax, step: 0.5, value: 40, unit: 'm', digits: 1 },
    { type: 'range', key: 'hd', label: 'Downstream head h<sub>down</sub>', min: GEO.hMin, max: GEO.hMax, step: 0.5, value: 33, unit: 'm', digits: 1 },
    { type: 'select', key: 'left', label: 'Left side <span class="vl-muted">(h<sub>up</sub>)</span>', value: 'fixed',
      options: [['fixed', 'Fixed head'], ['noflow', 'No flow']] },
    { type: 'select', key: 'right', label: 'Right side <span class="vl-muted">(h<sub>down</sub>)</span>', value: 'fixed',
      options: [['fixed', 'Fixed head'], ['noflow', 'No flow']] },
    { type: 'select', key: 'bottom', label: 'Bottom', value: 'noflow',
      options: [['noflow', 'No flow (rock)'], ['fixed', 'Fixed head (drain)']] },
    { type: 'range', key: 'hb', label: 'Bottom head h<sub>b</sub>', min: 20, max: GEO.hMax, step: 0.5, value: 33, unit: 'm', digits: 1,
      visibleIf: function (s) { return s.bottom === 'fixed'; } },
    { type: 'number', key: 'k', label: 'k (m/s)', value: 3.5e-5, step: 'any' },

    { type: 'heading', label: 'Display' },
    { type: 'range', key: 'nd', label: 'Colour bands = head drops N<sub>d</sub>', min: 2, max: 20, step: 1, value: 7 },
    { type: 'select', key: 'cmap', label: 'Colour map', value: 'rainbow',
      options: VLab.colormap.names.map(function (n) { return [n, n]; }) },
    { type: 'toggle', key: 'eq', label: 'Equipotential lines', value: true },
    { type: 'toggle', key: 'flow', label: 'Flow lines', value: true },
    { type: 'select', key: 'fmode', label: 'Flow-line spacing', value: 'square',
      options: [['square', 'Square flow net'], ['count', 'Choose Nf']],
      visibleIf: function (s) { return s.flow; } },
    { type: 'range', key: 'nf', label: 'Flow channels N<sub>f</sub>', min: 1, max: 15, step: 1, value: 4,
      visibleIf: function (s) { return s.flow && s.fmode === 'count'; } },
    { type: 'toggle', key: 'mesh', label: 'Show mesh', value: false },

    { type: 'heading', label: 'Standpipes' },
    { type: 'buttons', items: [
      { label: 'Add standpipe', id: 'sp-add', onClick: function () { pipes.setAdding(!pipes.adding); } },
      { label: 'Clear', onClick: function () { pipes.clear(); } }
    ] },
    { type: 'html', id: 'sp-table' },

    { type: 'heading', label: 'Results' },
    { type: 'html', id: 'results' }
  ];

  var initial = VLab.Hash.read();
  if (/[?&]embed=1/.test(location.search)) document.body.classList.add('vl-embed');
  var theme = /[?&]theme=(light|dark)/.exec(location.search);
  if (theme) document.documentElement.setAttribute('data-theme', theme[1]);

  var physicsKeys = { hu: 1, hd: 1, left: 1, right: 1, bottom: 1, hb: 1 };
  var ui = new VLab.Controls(document.getElementById('panel'), schema, function (s, key) {
    update(!!physicsKeys[key]);
  }, initial);
  var S = ui.state;

  var view = new VLab.View(document.getElementById('cv'),
    { xmin: 0, xmax: GEO.L, ymin: 0, ymax: GEO.hMax + 1 },
    { margin: { l: 56, r: 92, t: 14, b: 44 } });

  var addBtn = document.getElementById('sp-add');
  var pipes = new VLab.Standpipes(view, {
    gammaW: GAMMA_W,
    table: document.getElementById('sp-table'),
    contains: function (x, y) {
      if (x <= 0.2 || x >= GEO.L - 0.2 || y <= 0.2 || y >= GEO.D - 0.05) return false;
      return !(x > wall.xLeft - 0.15 && x < wall.xRight + 0.15 && y > GEO.D - wall.zTip - 0.2);
    },
    head: function (x, y) { return g.sample(h, x, GEO.D - y); },
    onChange: function () { saveHash(); view.render(); },
    onMode: function (on) {
      addBtn.classList.toggle('vl-on', on);
      addBtn.textContent = on ? 'Click in the soil…' : 'Add standpipe';
    }
  });
  pipes.decode(initial.sp);

  var saveTimer = 0;
  function saveHash() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      var o = {};
      Object.keys(S).forEach(function (k) { o[k] = S[k]; });
      if (pipes.list.length) o.sp = pipes.encode();
      VLab.Hash.write(o);
    }, 250);
  }

  /* ---------- solve + derived quantities ---------- */
  var R = null, raster = null, rasterKey = '';

  function toElev(seg) {
    for (var k = 1; k < seg.length; k += 2) seg[k] = elev(seg[k]);
    return seg;
  }

  function update(physics) {
    if (physics || !R) {
      applyBC(S);
      var t0 = performance.now(), info = solver.solve(h);
      info.ms = performance.now() - t0;
      solveCount++;
      var Q = VLab.Laplace.fluxes(g, h, 1);
      var bf = VLab.Laplace.boundaryFlux(g, Q);
      var sf = VLab.Laplace.streamFunction(g, Q);
      var lo = Infinity, hi = -Infinity;
      for (var k = 0; k < g.n; k++) if (g.fixed[k]) { lo = Math.min(lo, g.value[k]); hi = Math.max(hi, g.value[k]); }
      if (hi - lo < 1e-9) { lo -= 0.5; hi += 0.5; }
      R = { info: info, bf: bf, sf: sf, lo: lo, hi: hi };
      R.exit = exitGradient();
      rasterKey = '';
    }
    /* contours */
    var nd = S.nd, xs = [], zs = [], i, m;
    for (i = 0; i < g.nx; i++) xs.push(g.x(i));
    for (i = 0; i < g.nz; i++) zs.push(g.z(i));
    R.eq = [];
    if (S.eq) for (m = 1; m < nd; m++) {
      R.eq = R.eq.concat(toElev(VLab.contour(h, g.nx, g.nz, xs, zs, R.lo + m * (R.hi - R.lo) / nd,
        function (a, b) { return g.cellCut(a, b); })));
    }
    R.fl = [];
    var sf = R.sf, span = sf.max - sf.min;
    if (S.flow && span > 1e-12) {
      var dpsi = S.fmode === 'count' ? span / S.nf : (R.hi - R.lo) / nd;
      for (m = 1; sf.min + m * dpsi < sf.max - 1e-6 * span && m < 200; m++) {
        R.fl = R.fl.concat(toElev(VLab.contour(sf.psi, sf.nx, sf.nz, sf.xs, sf.zs, sf.min + m * dpsi)));
      }
    }
    results();
    pipes.table();
    saveHash();
    view.render();
  }

  /* Largest upward gradient at the ground surface on the low-head side. */
  function exitGradient() {
    var best = { i: 0, x: NaN }, low = S.hu >= S.hd ? 'down' : 'up';
    for (var i = 0; i < g.nx; i++) {
      var down = i > wall.iLeft;
      if ((low === 'down') !== down) continue;
      var grad = (h[g.nx + i] - h[i]) / g.dz;
      if (grad > best.i) best = { i: grad, x: g.x(i) };
    }
    return best;
  }

  function sci(v) {
    if (!isFinite(v)) return '–';
    if (v === 0) return '0';
    var e = Math.floor(Math.log10(Math.abs(v)));
    if (e >= -2 && e < 4) return v.toFixed(3);
    return (v / Math.pow(10, e)).toFixed(2) + '×10<sup>' + e + '</sup>';
  }

  function results() {
    var dH = S.hu - S.hd, q1 = R.bf.qIn, q = q1 * S.k;
    var shape = Math.abs(dH) > 1e-9 ? q1 / Math.abs(dH) : NaN;
    var bal = R.bf.qIn > 0 ? Math.abs(R.bf.qIn - R.bf.qOut) / R.bf.qIn * 100 : 0;
    var rows = [
      ['Seepage q (m³/s per m)', sci(q)],
      ['Seepage q (m³/day per m)', (q * 86400).toFixed(3)],
      ['Head loss ΔH (m)', dH.toFixed(2)],
      ['Shape factor N<sub>f</sub>/N<sub>d</sub> = q/(kΔH)', isFinite(shape) ? shape.toFixed(3) : '–'],
      ['N<sub>f</sub> of a square net with N<sub>d</sub> = ' + S.nd, isFinite(shape) ? (shape * S.nd).toFixed(2) : '–'],
      ['Flow-net estimate kΔH·N<sub>f</sub>/N<sub>d</sub>',
        S.fmode === 'count' && isFinite(shape) ? sci(S.k * Math.abs(dH) * S.nf / S.nd) : '<span class="vl-muted">set N<sub>f</sub></span>'],
      ['Max exit gradient i<sub>exit</sub>', R.exit.i > 0 ? R.exit.i.toFixed(3) + ' @ x = ' + R.exit.x.toFixed(1) + ' m' : '–']
    ];
    document.getElementById('results').innerHTML = '<dl class="vl-results">' + rows.map(function (r) {
      return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>';
    }).join('') + '</dl><p class="vl-muted">' + g.nx + ' × ' + g.nz + ' nodes, direct solve in ' + R.info.ms.toFixed(0) +
      ' ms, mass balance error ' + bal.toExponential(1) + ' %. Datum (elevation 0) at the base of the soil.</p>';
  }

  /* ---------- drawing ---------- */
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  view.draw = function (c, v) {
    if (!R) return;
    var ink = css('--vl-ink'), water = css('--vl-water'), edge = css('--vl-soil-edge'), wallInk = css('--vl-wall');
    var lut = VLab.colormap.banded(S.cmap, S.nd, R.lo, R.hi);
    var key = [S.cmap, S.nd, v.W, v.H, v.dpr, R.lo, R.hi, solveCount, S.hu, S.hd, S.left, S.right, S.bottom, S.hb].join('|');
    if (key !== rasterKey) {
      raster = v.raster(0, GEO.L, 0, GEO.D, function (x, y) { return lut(g.sample(h, x, GEO.D - y)); });
      rasterKey = key;
    }

    /* ponded water */
    c.save();
    c.globalAlpha = 0.28;
    c.fillStyle = water;
    c.beginPath();
    if (S.hu > GEO.D) v.rect(c, 0, GEO.D, wall.xLeft, S.hu);
    if (S.hd > GEO.D) v.rect(c, wall.xRight, GEO.D, GEO.L, S.hd);
    c.fill();
    c.restore();
    waterLine(c, v, 0, wall.xLeft, S.hu, water, ink);
    waterLine(c, v, wall.xRight, GEO.L, S.hd, water, ink);

    /* soil field */
    c.drawImage(raster.canvas, raster.x, raster.y, raster.w, raster.h);

    if (S.mesh) {
      var gm = [], i, j;
      for (i = 0; i < g.nx; i++) gm.push(g.x(i), 0, g.x(i), GEO.D);
      for (j = 0; j < g.nz; j++) gm.push(0, elev(g.z(j)), GEO.L, elev(g.z(j)));
      v.segments(c, gm, { color: 'rgba(0,0,0,0.18)', width: 0.5 });
    }
    if (R.eq.length) v.segments(c, R.eq, { color: '#111', width: 1, dash: [5, 3] });
    if (R.fl.length) v.segments(c, R.fl, { color: '#111', width: 1.6 });

    /* boundaries */
    boundary(c, v, 'left', S.left, water, edge);
    boundary(c, v, 'right', S.right, water, edge);
    boundary(c, v, 'bottom', S.bottom, water, edge);
    c.save();
    c.strokeStyle = edge; c.lineWidth = 1;
    c.beginPath(); v.rect(c, 0, 0, GEO.L, GEO.D); c.stroke();
    c.restore();

    /* sheet pile */
    c.save();
    c.fillStyle = wallInk;
    c.beginPath();
    v.rect(c, wall.xLeft, GEO.D - wall.zTip, wall.xRight, Math.min(GEO.hMax + 1, Math.max(S.hu, S.hd) + 1.5));
    c.fill();
    c.restore();

    v.axes(c, { x0: 0, x1: GEO.L, y0: 0, y1: GEO.hMax, dxTick: 10, dyTick: 5,
      xlabel: 'x (m)', ylabel: 'Elevation z (m)', color: ink });
    colorbar(c, v, ink);
    pipes.draw(c, { ink: '#111', water: water });
  };

  function waterLine(c, v, x0, x1, hw, water, ink) {
    if (hw <= GEO.D) return;
    c.save();
    c.strokeStyle = water; c.lineWidth = 2;
    c.beginPath(); c.moveTo(v.sx(x0), v.sy(hw)); c.lineTo(v.sx(x1), v.sy(hw)); c.stroke();
    var xm = v.sx(x0 + 0.2 * (x1 - x0)), ym = v.sy(hw);
    c.fillStyle = water;
    c.beginPath(); c.moveTo(xm - 7, ym - 11); c.lineTo(xm + 7, ym - 11); c.lineTo(xm, ym - 1); c.closePath(); c.fill();
    c.fillStyle = ink; c.font = '12px system-ui, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'bottom';
    c.fillText('h = ' + hw.toFixed(1) + ' m', xm + 11, ym - 2);
    c.restore();
  }

  /* Fixed head: blue band. No flow: hatching on the outside. */
  function boundary(c, v, side, type, water, edge) {
    var x0, y0, x1, y1, nxo, nyo;
    if (side === 'left')   { x0 = 0; y0 = 0; x1 = 0; y1 = GEO.D; nxo = -1; nyo = 0; }
    if (side === 'right')  { x0 = GEO.L; y0 = 0; x1 = GEO.L; y1 = GEO.D; nxo = 1; nyo = 0; }
    if (side === 'bottom') { x0 = 0; y0 = 0; x1 = GEO.L; y1 = 0; nxo = 0; nyo = 1; }
    var ax = v.sx(x0), ay = v.sy(y0), bx = v.sx(x1), by = v.sy(y1);
    c.save();
    if (type === 'fixed') {
      c.strokeStyle = water; c.lineWidth = 4;
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
    } else {
      c.strokeStyle = edge; c.lineWidth = 1;
      var len = Math.hypot(bx - ax, by - ay), n = Math.floor(len / 9);
      c.beginPath();
      for (var k = 0; k <= n; k++) {
        var px = ax + (bx - ax) * k / n, py = ay + (by - ay) * k / n;
        c.moveTo(px, py);
        c.lineTo(px + nxo * 6 - (nyo ? 6 : 0), py + nyo * 6 + (nxo ? 6 : 0));
      }
      c.stroke();
    }
    c.restore();
  }

  function colorbar(c, v, ink) {
    var N = S.nd, x = v.sx(GEO.L) + 24, w = 14, top = v.sy(GEO.D), bot = v.sy(0), hgt = bot - top;
    c.save();
    for (var b = 0; b < N; b++) {
      c.fillStyle = VLab.colormap.css(VLab.colormap.band(S.cmap, b, N));
      c.fillRect(x, bot - (b + 1) * hgt / N, w, hgt / N + 0.5);
    }
    c.strokeStyle = ink; c.lineWidth = 1;
    c.strokeRect(x + 0.5, top + 0.5, w, hgt);
    c.fillStyle = ink; c.font = '11px system-ui, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
    var every = N > 10 ? 2 : 1;
    for (var m = 0; m <= N; m += every) {
      var y = bot - m * hgt / N;
      c.beginPath(); c.moveTo(x + w, y); c.lineTo(x + w + 3, y); c.stroke();
      c.fillText((R.lo + m * (R.hi - R.lo) / N).toFixed(1), x + w + 5, y);
    }
    c.textAlign = 'center'; c.textBaseline = 'bottom'; c.font = '600 12px system-ui, sans-serif';
    c.fillText('h (m)', x + w / 2 + 8, top - 6);
    c.restore();
  }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { view.render(); });

  update(true);

  /* exposed for tests and for future decks that script the lab */
  VLab.sheetpile = { grid: g, head: h, wall: wall, ui: ui, pipes: pipes, view: view,
    results: function () { return R; }, update: update };
})(window.VLab);
