/* Virtual oedometer: incremental-loading consolidation test (ASTM D2435).
   Physics in core/oedometer.js (VLab.Oedo). This file draws the load frame,
   clock and gauges, runs the accelerated clock, keeps the load schedule and
   builds the time curve and the end-of-primary (EOP) compressibility curve. */
(function () {
  'use strict';

  var O = VLab.Oedo;
  var qs = location.search;
  if (/[?&]embed=1/.test(qs)) document.body.classList.add('vl-embed');
  var theme = /[?&]theme=(light|dark)/.exec(qs);
  if (theme) document.documentElement.setAttribute('data-theme', theme[1]);
  var AUTOTEST = /[?&]autotest=1/.test(qs);
  var initial = VLab.Hash.read();

  var DAY = 86400, AREA = Math.PI * 0.0635 * 0.0635 / 4;   // m², 63.5 mm ring
  var READ_MIN = [0.1, 0.25, 0.5, 1, 2, 4, 8, 15, 30, 60, 120, 240, 480, 1440, 2880, 5760, 10080];
  var PHASE = { load: 'Loading', unload: 'Unloading', reload: 'Reloading' };

  function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function colors() {
    return { ink: css('--vl-ink'), grid: css('--vl-line'), bg: css('--vl-bg'), muted: css('--vl-muted'), accent: css('--vl-accent') };
  }
  function phaseColor(ph) { return ph === 'unload' ? css('--vl-water') : ph === 'reload' ? css('--vl-green') : css('--vl-accent'); }
  function $(id) { return document.getElementById(id); }
  function newSeed() { return 1 + Math.floor(Math.random() * 999999); }
  function sig3(v) { return +(+v).toPrecision(4); }

  function fmtDur(s) {
    if (s < 60) return s.toFixed(s < 10 ? 1 : 0) + ' s';
    if (s < 3600) return (s / 60).toFixed(1) + ' min';
    if (s < 2 * DAY) return (s / 3600).toFixed(2) + ' h';
    return (s / DAY).toFixed(2) + ' d';
  }
  function fmtClock(s) {
    s = Math.floor(s);
    var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (x < 10 ? '0' : '') + x;
  }

  /* ---------------- state ---------------- */
  var seed = parseInt(initial.seed, 10);
  if (!(seed > 0)) seed = newSeed();
  var soil, sim, rows = [], next = 0, running = false, whole = false, selInc = -1, hoverRow = null;
  var dispSigma = 5, knob = { angle: 0, acc: 0, drag: false, last: 0 }, flash = 0, schedDirty = true;

  /* ---------------- panel ---------------- */
  var schema = [
    { type: 'heading', label: 'Specimen' },
    { type: 'html', id: 'card' },
    { type: 'heading', label: 'Run the test' },
    { type: 'html', id: 'run' },
    { type: 'select', key: 'meth', label: 'ASTM D2435', value: 'B',
      options: [['B', 'Method B: until EOP'], ['A', 'Method A: 24 h each']] },
    { type: 'html', id: 'clock' },
    { type: 'heading', label: 'Load schedule' },
    { type: 'number', key: 'seat', label: 'Seating stress (kPa)', value: 5 },
    { type: 'number', key: 'first', label: 'First load (kPa)', value: 12.5 },
    { type: 'number', key: 'lir', label: 'Load increment ratio', value: 1, step: 0.25 },
    { type: 'number', key: 'smax', label: 'Maximum load (kPa)', value: 800 },
    { type: 'number', key: 'sunl', label: 'Unload to (kPa)', value: 50 },
    { type: 'number', key: 'srel', label: 'Reload to (kPa, 0 = no reload)', value: 1600, min: 0 },
    { type: 'buttons', items: [{ label: 'Rebuild schedule (restarts the test)', onClick: function () { rebuild(true); } }] },
    { type: 'heading', label: 'Display' },
    { type: 'toggle', key: 'uview', label: 'Model view: pore pressure inside the specimen', value: false },
    { type: 'heading', label: 'Interpretation' },
    { type: 'toggle', key: 'ipsp', label: "Preconsolidation stress &sigma;'<sub>p</sub> (Casagrande)", value: false },
    { type: 'toggle', key: 'ipcc', label: 'Compression index C<sub>c</sub>', value: false },
    { type: 'toggle', key: 'ipcr', label: 'Unloading index C<sub>r</sub>', value: false },
    { type: 'toggle', key: 'ipmv', label: 'Coefficient of volume compressibility m<sub>v</sub>', value: false },
    { type: 'toggle', key: 'ipca', label: 'Secondary compression index C<sub>&alpha;</sub>', value: false },
    { type: 'toggle', key: 'ipcar', label: 'C<sub>&alpha;,r</sub> (unloading / reloading / recompression)', value: false },
    { type: 'html', id: 'interp' },
    { type: 'heading', label: 'Lab' },
    { type: 'buttons', items: [
      { label: 'New specimen', onClick: function () { seed = newSeed(); makeSoil(); resetTest(); } },
      { label: 'Restart test', onClick: function () { resetTest(); } },
      { label: 'Export CSV', onClick: exportCSV }] },
    { type: 'toggle', key: 'truth', label: 'Show model parameters (instructor)', value: false },
    { type: 'html', id: 'truth', visibleIf: function (s) { return s.truth; } }
  ];
  var SCHED_KEYS = ['seat', 'first', 'lir', 'smax', 'sunl', 'srel'];
  var ui = new VLab.Controls($('panel'), schema, function (s, key) {
    if (SCHED_KEYS.indexOf(key) >= 0) {
      if (!sim.cur) rebuild(false);
      else setSchedMsg('Press “Rebuild schedule” to restart the test with the new schedule.');
    }
    if (key === 'truth') renderTruth();
    if (key === 'ipmv') schedDirty = true;
    writeHash();
    renderAll();
  }, initial);
  var st = ui.state;

  $('run').innerHTML =
    '<button type="button" class="vl-btn oe-apply" id="apply">Apply first load ▸</button>' +
    '<div class="oe-status" id="status"></div>' +
    '<div class="vl-buttons"><button type="button" class="vl-btn" id="play">Pause clock</button>' +
    '<button type="button" class="vl-btn" id="skipEOP">Skip to EOP</button>' +
    '<button type="button" class="vl-btn" id="skipLog">+1 log cycle</button>' +
    '<button type="button" class="vl-btn" id="whole">Run whole test</button></div>';
  $('clock').innerHTML =
    '<label class="vl-row vl-toggle"><input type="checkbox" id="auto"><span class="vl-label">Auto clock: one log cycle of time every 2 s</span></label>' +
    '<label class="vl-row vl-range oe-range"><span class="vl-label"><span>Clock speed</span><output class="vl-value" id="spdv"></output></span>' +
    '<input type="range" id="spd" min="0" max="5" step="0.5"></label>';
  $('auto').checked = initial.auto !== '0';
  $('spd').value = initial.spd != null && isFinite(+initial.spd) ? +initial.spd : 2;
  $('auto').addEventListener('change', function () { writeHash(); updateSpeed(); });
  $('spd').addEventListener('input', function () { writeHash(); updateSpeed(); });
  $('apply').addEventListener('click', applyNext);
  $('play').addEventListener('click', function () {
    if (!sim.cur) return;
    running = !running;
    if (running && sim.t >= pauseCap() - 1e-6) running = false;
    whole = false;
    renderAll();
  });
  $('skipEOP').addEventListener('click', function () {
    if (!sim.cur || sim.cur.eop) return;
    sim.runUntilEOP(7 * DAY);
    renderAll(true);
  });
  $('skipLog').addEventListener('click', function () {
    if (!sim.cur) return;
    var cap = st.meth === 'A' ? DAY : 7 * DAY;
    sim.advanceTo(Math.min(cap, Math.max(sim.t * 10, sim.t + 60)));
    renderAll(true);
  });
  $('whole').addEventListener('click', function () {
    whole = !whole;
    if (whole) { running = true; if (!sim.cur || canApply()) applyNext(); }
    renderAll();
  });

  function setSchedMsg(t) { $('schedNote').textContent = t || ''; }

  /* ---------------- soil, schedule, test ---------------- */
  function makeSoil() {
    soil = O.randomSoil(seed);
    renderCard();
    renderTruth();
  }

  function buildRows() {
    var r = [], lir = Math.max(0.1, st.lir), smax = Math.max(st.smax, st.first), s = st.first;
    r.push({ sigma: sig3(s), phase: 'load' });
    while (s < smax * 0.999 && r.length < 30) {
      s = s * (1 + lir);
      if (s > smax * 0.97) s = smax;
      r.push({ sigma: sig3(s), phase: 'load' });
    }
    if (st.sunl < smax) {
      for (var n = 0; s > st.sunl * 1.001 && n < 12; n++) { s = Math.max(st.sunl, s / 4); r.push({ sigma: sig3(s), phase: 'unload' }); }
      if (st.srel > s) {
        for (n = 0; s < st.srel * 0.999 && n < 20; n++) {
          s = s < smax * 0.999 ? Math.min(smax, s * 4) : Math.min(st.srel, s * (1 + lir));
          r.push({ sigma: sig3(s), phase: 'reload' });
        }
      }
    }
    return r;
  }

  function rebuild(reset) {
    rows = buildRows();
    setSchedMsg('');
    if (reset || !sim || !sim.cur) resetTest();
  }

  function resetTest() {
    soil.seat = st.seat;
    sim = new O.Sim(soil);
    next = 0; running = false; whole = false; selInc = -1; dispSigma = soil.seat;
    setSchedMsg('');
    schedDirty = true;
    renderAll(true);
  }

  function canApply() {
    if (next >= rows.length) return false;
    if (!sim.cur) return true;
    return st.meth === 'A' ? sim.t >= DAY - 1e-6 : sim.cur.eop;
  }

  function applyNext() {
    if (!canApply()) { flash = 1; renderStatus(); return; }
    sim.applyLoad(rows[next].sigma, { row: next });
    next++;
    selInc = -1;
    running = true;
    schedDirty = true;
    renderAll(true);
  }

  function pauseCap() { return st.meth === 'A' || sim.t < DAY - 1e-6 ? DAY : 7 * DAY; }
  function clockRate() {
    if ($('auto').checked || whole) return Math.max(2, (sim.t + 3) * Math.LN10 / (whole ? 0.7 : 2));
    return Math.pow(10, +$('spd').value);
  }
  function updateSpeed() {
    var auto = $('auto').checked;
    $('spd').disabled = auto;
    var r = sim && sim.cur && running ? clockRate() : (auto ? null : Math.pow(10, +$('spd').value));
    $('spdv').textContent = r == null ? 'auto' : '×' + (r >= 100 ? Math.round(r).toLocaleString('en-US') : r.toFixed(r < 10 ? 1 : 0));
  }

  /* ---------------- derived results ---------------- */
  function eOf(eps) { return soil.e0 - (1 + soil.e0) * eps; }
  function yOf(eps, q) { return q === 'd' ? eps * soil.H0 : q === 's' ? eps * 100 : eOf(eps); }
  function yOfE(e, q) { return yOf((soil.e0 - e) / (1 + soil.e0), q); }
  var YLAB = { d: 'Deformation δ (mm)', s: 'Axial strain εa (%)', e: 'Void ratio e' };
  var YNAME = { d: 'δ', s: 'εa', e: 'e' };
  function fmtY(v, q) { return q === 'd' ? v.toFixed(3) + ' mm' : q === 's' ? v.toFixed(2) + ' %' : v.toFixed(4); }

  function sigPrev(i) { return i > 0 ? rows[i - 1].sigma : soil.seat; }
  function eopE(i) {
    if (i < 0) return soil.e0;
    var inc = sim.incs[i];
    return inc && inc.eop ? eOf(inc.epsEOP) : null;
  }
  function mv(i) {   /* 1/MPa */
    var e1 = eopE(i - 1), e2 = eopE(i);
    if (e1 == null || e2 == null) return null;
    return (e1 - e2) / ((1 + e1) * (rows[i].sigma - sigPrev(i))) * 1000;
  }

  function lsq(pts) {
    var n = pts.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
    pts.forEach(function (p) { sx += p[0]; sy += p[1]; sxx += p[0] * p[0]; sxy += p[0] * p[1]; });
    var b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    return { b: b, a: (sy - b * sx) / n };
  }

  /* EOP points as [log10 σ', e], by branch. */
  function branches() {
    var out = { load: [[Math.log10(soil.seat), soil.e0, -1]], unload: [], reload: [] };
    for (var i = 0; i < sim.incs.length; i++) {
      var e = eopE(i);
      if (e == null) continue;
      out[rows[i].phase].push([Math.log10(rows[i].sigma), e, i]);
    }
    return out;
  }

  /* Fritsch–Carlson monotone cubic through (x, y); returns f(x) -> [y, y', y''] */
  function monotone(xs, ys) {
    var n = xs.length, d = [], m = [];
    for (var i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
      var a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
      if (h > 9) { var t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    return function (x) {
      var k = 0;
      while (k < n - 2 && x > xs[k + 1]) k++;
      var hh = xs[k + 1] - xs[k], t = (x - xs[k]) / hh, y0 = ys[k], y1 = ys[k + 1], m0 = m[k] * hh, m1 = m[k + 1] * hh;
      var t2 = t * t, t3 = t2 * t;
      var y = (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * m1;
      var dy = ((6 * t2 - 6 * t) * y0 + (3 * t2 - 4 * t + 1) * m0 + (-6 * t2 + 6 * t) * y1 + (3 * t2 - 2 * t) * m1) / hh;
      var d2 = ((12 * t - 6) * y0 + (6 * t - 4) * m0 + (-12 * t + 6) * y1 + (6 * t - 2) * m1) / (hh * hh);
      return [y, dy, d2];
    };
  }

  /* Interpretation from the simulated data, the way a student would do it. */
  function interpret() {
    var B = branches(), L = B.load, R = {};
    if (L.length >= 5) {
      var vir = L.slice(-3), fit = lsq(vir);
      R.Cc = -fit.b; R.vir = fit; R.virX = [vir[0][0], vir[vir.length - 1][0]];
      var xs = L.map(function (p) { return p[0]; }), ys = L.map(function (p) { return p[1]; });
      var f = monotone(xs, ys), xr = xs[xs.length - 1] - xs[0], yr = Math.max(1e-9, ys[0] - ys[ys.length - 1]);
      var best = -Infinity, xm = null;
      for (var k = 0; k <= 400; k++) {
        var x = xs[0] + (xs[xs.length - 2] - xs[0]) * k / 400, v = f(x);
        var dn = v[1] * xr / yr, d2n = v[2] * xr * xr / yr;
        var curv = -d2n / Math.pow(1 + dn * dn, 1.5);
        if (curv > best) { best = curv; xm = x; }
      }
      var vm = f(xm), sn = vm[1] * xr / yr, bis = Math.tan(Math.atan(sn) / 2) * yr / xr;
      var xp = (fit.a - vm[0] + bis * xm) / (bis - fit.b);
      if (isFinite(xp) && xp > xs[0] && xp < xs[xs.length - 1] + 0.3) {
        R.sp = Math.pow(10, xp);
        R.cas = { xm: xm, em: vm[0], slope: vm[1], bis: bis, xp: xp, ep: fit.a + fit.b * xp, xr: xr };
      }
    }
    if (B.unload.length && L.length) {
      var top = L[L.length - 1], pts = [top].concat(B.unload), fr = lsq(pts);
      R.Cr = -fr.b; R.unl = fr; R.unlX = [pts[pts.length - 1][0], top[0]];
    }
    return R;
  }

  function caFit(i) {
    var inc = sim.incs[i];
    if (!inc || !inc.eop) return null;
    var t1 = 2 * Math.max(inc.tEOP, 1), t2 = inc.tEnd;
    if (t2 < 2.5 * t1) return { short: true };
    var pts = [];
    inc.hist.forEach(function (h) { if (h[0] >= t1 && h[0] <= t2) pts.push([Math.log10(h[0]), eOf(h[1])]); });
    if (pts.length < 3) return { short: true };
    var f = lsq(pts);
    return { Ca: -f.b, a: f.a, b: f.b, t1: t1, t2: t2 };
  }
  function isRecomp(i, R) {
    var ph = rows[i].phase;
    if (ph !== 'load') return true;
    return R.sp ? rows[i].sigma < R.sp : false;
  }

  /* ---------------- plots ---------------- */
  var tplot = new VLab.XYPlot($('tplot'), { colors: colors, onHover: function (id) { link(id, 'tp'); } });
  var cplot = new VLab.XYPlot($('cplot'), { colors: colors, onHover: function (id) { link(id, 'cp'); } });
  $('cplot').addEventListener('click', function () {
    if (typeof cplot.hoverId === 'number') { selInc = cplot.hoverId; renderAll(); }
  });
  ['tpY', 'tpX', 'cpY', 'cpX'].forEach(function (id) {
    if (initial[id]) $(id).value = initial[id];
    $(id).addEventListener('change', function () { writeHash(); renderAll(); });
  });
  $('tpInc').addEventListener('change', function () { selInc = +$('tpInc').value; renderAll(); });

  function link(id, src) {
    hoverRow = typeof id === 'number' ? id : null;
    cplot.highlight = hoverRow; tplot.highlight = hoverRow;
    if (src !== 'cp') cplot.render();
    if (src !== 'tp') tplot.render();
    var trs = $('sched').querySelectorAll('tr[data-i]');
    for (var k = 0; k < trs.length; k++) trs[k].classList.toggle('oe-hl', +trs[k].getAttribute('data-i') === hoverRow);
  }

  function logLine(a, b, x0, x1, q) {   /* e = a + b·log10 σ' sampled in σ' */
    var pts = [];
    for (var k = 0; k <= 24; k++) {
      var x = x0 + (x1 - x0) * k / 24;
      pts.push([Math.pow(10, x), yOfE(a + b * x, q)]);
    }
    return pts;
  }

  function tpIndex() { return selInc >= 0 && selInc < sim.incs.length ? selInc : sim.incs.length - 1; }

  function renderTP(R) {
    var k = tpIndex(), inc = sim.incs[k], q = $('tpY').value, log = $('tpX').value === 'log';
    if (!inc) { tplot.data = { series: [], empty: 'Apply the first load to start the test' }; tplot.render(); return; }
    var row = rows[k], colr = phaseColor(row.phase), tEndMin = inc.tEnd / 60;
    var pts = [];
    inc.hist.forEach(function (h) { if (!log || h[0] > 0) pts.push([h[0] / 60, yOf(h[1], q)]); });
    var rd = [];
    READ_MIN.forEach(function (m) { if (m * 60 <= inc.tEnd + 1e-6) rd.push([m, yOf(O.epsAt(inc, m * 60), q)]); });
    var series = [{ pts: pts, color: colr, width: 2 }, { pts: rd, color: css('--vl-ink'), noLine: true, dots: 2.6 }];
    var points = [], ann = [];
    if (inc.eop) {
      var yE = yOf(inc.epsEOP, q);
      points.push({ x: inc.tEOP / 60, y: yE, id: k, color: colr, r: 5,
        tip: ['End of primary (EOP), increment ' + (k + 1), 't = ' + fmtDur(inc.tEOP), YNAME[q] + ' = ' + fmtY(yE, q)] });
      ann.push({ type: 'text', x: inc.tEOP / 60, y: yE, text: 'EOP', dx: 8, dy: q === 'e' ? -6 : 16 });
    }
    var R = interpret(), ca = caFit(k);
    if (ca && !ca.short) {
      var recomp = isRecomp(k, R), on = recomp ? st.ipcar : st.ipca;
      if (on) {
        var lp = [];
        for (var j = 0; j <= 20; j++) {
          var lt = Math.log10(inc.tEOP) + (Math.log10(ca.t2 * 1.5) - Math.log10(inc.tEOP)) * j / 20;
          lp.push([Math.pow(10, lt) / 60, yOfE(ca.a + ca.b * lt, q)]);
        }
        series.push({ pts: lp, color: css('--vl-ink'), width: 1.4, dash: [6, 4] });
        ann.push({ type: 'text', x: ca.t2 / 60, y: yOfE(ca.a + ca.b * Math.log10(ca.t2), q),
          text: (recomp ? 'Cα,r' : 'Cα') + ' = ' + ca.Ca.toFixed(4), align: 'right', dy: q === 'e' ? -8 : 18 });
      }
    }
    tplot.data = {
      xLog: log, yInvert: q !== 'e',
      xLabel: 'Time since load applied (min)' + (log ? ', log scale' : ''), yLabel: YLAB[q],
      xRange: log ? [0.01, Math.max(10, tEndMin * 1.6)] : [0, Math.max(1, tEndMin * 1.03)],
      series: series, points: points, ann: ann,
      readout: function (x) {
        if (x * 60 > inc.tEnd || x <= 0) return null;
        var v = yOf(O.epsAt(inc, x * 60), q);
        return { y: v, color: colr, lines: ['t = ' + fmtDur(x * 60), YNAME[q] + ' = ' + fmtY(v, q)] };
      }
    };
    tplot.render();
  }

  function renderCP() {
    var q = $('cpY').value, log = $('cpX').value === 'log', points = [], series = [], ann = [];
    var ink = css('--vl-ink');
    points.push({ x: soil.seat, y: yOf(0, q), id: 'seat', color: ink,
      tip: ['Seating load, start of test', "σ' = " + soil.seat + ' kPa', 'e₀ = ' + soil.e0.toFixed(4)] });
    var prev = [soil.seat, yOf(0, q)], cur = null, seen = {};
    for (var i = 0; i < sim.incs.length; i++) {
      var inc = sim.incs[i], row = rows[i], c = phaseColor(row.phase);
      if (!inc.eop) {
        points.push({ x: row.sigma, y: yOf(sim.epsBar(), q), id: 'live', ring: true, color: c,
          tip: ['Increment ' + (i + 1) + ' in progress', 'primary consolidation not finished yet'] });
        continue;
      }
      var y = yOf(inc.epsEOP, q);
      if (!cur || cur.phase !== row.phase) {
        cur = { phase: row.phase, pts: [prev], color: c, width: 1.6, label: seen[row.phase] ? null : PHASE[row.phase] };
        seen[row.phase] = true;
        series.push(cur);
      }
      cur.pts.push([row.sigma, y]);
      prev = [row.sigma, y];
      points.push({ x: row.sigma, y: y, id: i, color: c,
        tip: ['Increment ' + (i + 1) + ': ' + PHASE[row.phase].toLowerCase() + ' to ' + row.sigma + ' kPa',
          'EOP reached after ' + fmtDur(inc.tEOP), YNAME[q] + ' = ' + fmtY(y, q)] });
    }
    var R = interpret();
    if (st.ipcc && R.Cc != null) {
      var x0 = R.cas ? R.cas.xp - 0.25 : R.virX[0] - 0.3;
      series.push({ pts: logLine(R.vir.a, R.vir.b, x0, R.virX[1] + 0.15, q), color: ink, width: 1.3, dash: [7, 4] });
      ann.push({ type: 'text', x: Math.pow(10, R.virX[1]), y: yOfE(R.vir.a + R.vir.b * R.virX[1], q),
        text: 'Cc = ' + R.Cc.toFixed(3), align: 'right', dx: -10, dy: q === 'e' ? 16 : -8 });
    }
    if (st.ipcr && R.Cr != null) {
      series.push({ pts: logLine(R.unl.a, R.unl.b, R.unlX[0] - 0.1, R.unlX[1] + 0.1, q), color: css('--vl-water'), width: 1.3, dash: [7, 4] });
      var xm = (R.unlX[0] + R.unlX[1]) / 2;
      ann.push({ type: 'text', x: Math.pow(10, xm), y: yOfE(R.unl.a + R.unl.b * xm, q), text: 'Cr = ' + R.Cr.toFixed(3),
        color: css('--vl-water'), dy: q === 'e' ? -8 : 16 });
    }
    if (st.ipsp && R.cas) {
      var K = R.cas, g = css('--vl-muted'), xr = K.xr;
      series.push({ pts: logLine(K.em, 0, K.xm, K.xm + 0.45 * xr, q), color: g, width: 1.2 });
      series.push({ pts: logLine(K.em - K.slope * K.xm, K.slope, K.xm - 0.12 * xr, K.xm + 0.35 * xr, q), color: g, width: 1.2 });
      series.push({ pts: logLine(K.em - K.bis * K.xm, K.bis, K.xm, Math.max(K.xp, K.xm) + 0.05, q), color: g, width: 1.2, dash: [3, 3] });
      if (!st.ipcc) series.push({ pts: logLine(R.vir.a, R.vir.b, K.xp - 0.15, R.virX[1], q), color: g, width: 1.2, dash: [7, 4] });
      points.push({ x: Math.pow(10, K.xm), y: yOfE(K.em, q), color: g, r: 3 });
      ann.push({ type: 'vline', x: R.sp, color: css('--vl-accent'), dash: [4, 4] });
      ann.push({ type: 'text', x: R.sp, y: yOfE(K.ep, q), text: "σ'p ≈ " + R.sp.toFixed(0) + ' kPa',
        color: css('--vl-accent'), dx: 6, dy: q === 'e' ? 18 : -8 });
    }
    cplot.data = {
      xLog: log, yInvert: q !== 'e',
      xLabel: "Effective vertical stress σ' (kPa)" + (log ? ', log scale' : ''), yLabel: YLAB[q],
      series: series, points: points, ann: ann, legendLeft: q !== 'e', legendBottom: q !== 'e'
    };
    cplot.render();
  }

  /* ---------------- schedule table ---------------- */
  function renderTable(force) {
    var tb = $('sched');
    if (!force && tb.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    var mvOn = st.ipmv;
    var h = '<thead><tr><th>#</th><th>Stage</th><th>σ (kPa)</th><th>LIR</th><th>Held</th><th>t<sub>EOP</sub></th>' +
      '<th>δ<sub>EOP</sub> (mm)</th><th>e<sub>EOP</sub></th>' + (mvOn ? '<th>m<sub>v</sub> (1/MPa)</th>' : '') + '</tr></thead><tbody>';
    h += '<tr data-i="-1" class="oe-done"><td>0</td><td><span class="oe-ph" style="background:' + css('--vl-muted') +
      '"></span>Seating</td><td>' + soil.seat + '</td><td></td><td></td><td></td><td>0.000</td><td>' + soil.e0.toFixed(4) + '</td>' +
      (mvOn ? '<td></td>' : '') + '</tr>';
    rows.forEach(function (r, i) {
      var inc = sim.incs[i], cls = i >= next ? 'oe-pend' : (i === next - 1 && !(next >= rows.length && inc.eop) ? 'oe-cur' : 'oe-done');
      if (i === tpIndex() && inc) cls += ' oe-sel';
      if (i === hoverRow) cls += ' oe-hl';
      var lir = (r.sigma - sigPrev(i)) / sigPrev(i), m = mvOn ? mv(i) : null;
      h += '<tr data-i="' + i + '" class="' + cls + '"><td>' + (i + 1) + '</td>' +
        '<td><span class="oe-ph" style="background:' + phaseColor(r.phase) + '"></span>' + PHASE[r.phase] + '</td>' +
        '<td>' + (i >= next ? '<input type="number" min="0" step="any" value="' + r.sigma + '" data-row="' + i + '">' : r.sigma) + '</td>' +
        '<td>' + lir.toFixed(2) + '</td>' +
        '<td>' + (inc ? fmtDur(inc.tEnd) : '') + '</td>' +
        '<td>' + (inc ? (inc.eop ? fmtDur(inc.tEOP) : '…') : '') + '</td>' +
        '<td>' + (inc && inc.eop ? (inc.epsEOP * soil.H0).toFixed(3) : '') + '</td>' +
        '<td>' + (inc && inc.eop ? eOf(inc.epsEOP).toFixed(4) : '') + '</td>' +
        (mvOn ? '<td>' + (m != null ? m.toFixed(3) : '') + '</td>' : '') + '</tr>';
    });
    tb.innerHTML = h + '</tbody>';
    schedDirty = false;
  }
  $('sched').addEventListener('change', function (e) {
    var i = +e.target.getAttribute('data-row'), v = +e.target.value;
    if (e.target.tagName !== 'INPUT' || !(v > 0)) { renderTable(true); return; }
    rows[i].sigma = sig3(v);
    renderTable(true);
  });
  $('sched').addEventListener('mouseover', function (e) {
    var tr = e.target.closest('tr[data-i]');
    if (!tr) return;
    var i = +tr.getAttribute('data-i');
    if (i !== hoverRow) link(i >= 0 && sim.incs[i] && sim.incs[i].eop ? i : null, 'table');
  });
  $('sched').addEventListener('mouseleave', function () { link(null, 'table'); });
  $('sched').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-i]');
    if (!tr || e.target.tagName === 'INPUT') return;
    var i = +tr.getAttribute('data-i');
    if (i >= 0 && sim.incs[i]) { selInc = i; renderAll(); }
  });

  function renderIncSelect() {
    var s = $('tpInc'), n = sim.incs.length, want = n + 1;
    if (s.options.length !== want) {
      var h = '<option value="-1">Current increment</option>';
      for (var i = 0; i < n; i++) h += '<option value="' + i + '">' + (i + 1) + ': ' + rows[i].sigma + ' kPa</option>';
      s.innerHTML = h;
    }
    s.value = selInc >= 0 && selInc < n ? selInc : -1;
  }

  /* ---------------- panel text ---------------- */
  function dl(items) {
    return '<dl class="vl-results">' + items.map(function (p) { return '<dt>' + p[0] + '</dt><dd>' + p[1] + '</dd>'; }).join('') + '</dl>';
  }
  function renderCard() {
    $('card').innerHTML = dl([
      ['Specimen diameter × height', soil.D + ' × ' + soil.H0 + ' mm'],
      ['Sampling depth', soil.depth.toFixed(1) + ' m'],
      ['Water content w', soil.w.toFixed(1) + ' %'],
      ['Specific gravity G<sub>s</sub>', soil.Gs.toFixed(2)],
      ['Initial void ratio e<sub>0</sub>', soil.e0.toFixed(3)],
      ['LL / PL / PI', soil.LL.toFixed(0) + ' / ' + soil.PL.toFixed(0) + ' / ' + soil.PI.toFixed(0)],
      ['Liquidity index LI', soil.LI.toFixed(2)]
    ]) + '<p class="oe-note">Specimen #' + soil.seed + ', saturated, drained top and bottom.</p>';
  }
  function renderTruth() {
    if (!soil) return;
    $('truth').innerHTML = dl([
      ["σ'<sub>v0</sub> in situ", soil.svo.toFixed(0) + ' kPa'],
      ["σ'<sub>p</sub> (1-day reference)", soil.sp.toFixed(0) + ' kPa'],
      ['OCR', soil.OCR.toFixed(2)],
      ['C<sub>c</sub> (Wroth & Wood)', soil.Cc.toFixed(3)],
      ['C<sub>r</sub>', soil.Cr.toFixed(3)],
      ['C<sub>α</sub> / C<sub>c</sub>', soil.CaCc.toFixed(3)],
      ['C<sub>α</sub> / C<sub>α,r</sub>', soil.Ca.toFixed(4) + ' / ' + soil.Car.toFixed(4)],
      ['c<sub>v</sub> near σ\'<sub>p</sub>', soil.cv.toFixed(1) + ' m²/yr'],
      ['k<sub>0</sub>, C<sub>k</sub>', soil.k0.toExponential(2) + ' m/s, ' + soil.Ck.toFixed(2)]
    ]) + '<p class="oe-note">Elasto-viscoplastic isotach model with Terzaghi coupling. Interpreted values differ a little from these, as in a real test.</p>';
  }
  function renderInterp() {
    var any = st.ipsp || st.ipcc || st.ipcr || st.ipmv || st.ipca || st.ipcar;
    if (!any) { $('interp').innerHTML = ''; return; }
    var R = interpret(), items = [], need = 'run more load increments';
    if (st.ipsp) items.push(["σ'<sub>p</sub>", R.sp ? R.sp.toFixed(0) + ' kPa' : need]);
    if (st.ipcc) items.push(['C<sub>c</sub>', R.Cc != null ? R.Cc.toFixed(3) : need]);
    if (st.ipcr) items.push(['C<sub>r</sub>', R.Cr != null ? R.Cr.toFixed(3) : 'unload first']);
    if (st.ipmv) items.push(['m<sub>v</sub>', 'see the table']);
    var k = tpIndex();
    if ((st.ipca || st.ipcar) && k >= 0) {
      var ca = caFit(k), rc = isRecomp(k, R), lab = (rc ? 'C<sub>α,r</sub>' : 'C<sub>α</sub>') + ' (increment ' + (k + 1) + ')';
      if ((rc && st.ipcar) || (!rc && st.ipca))
        items.push([lab, !ca ? 'wait for EOP' : ca.short ? 'keep the load on longer' : ca.Ca.toFixed(4)]);
      else items.push([lab, 'turn on ' + (rc ? 'C<sub>α,r</sub>' : 'C<sub>α</sub>')]);
    }
    $('interp').innerHTML = dl(items) +
      ((st.ipsp || st.ipcc || st.ipcr) && $('cpX').value !== 'log' ? '<p class="oe-note">Constructions are made on a log σ\' axis.</p>' : '') +
      ((st.ipca || st.ipcar) && $('tpX').value !== 'log' ? '<p class="oe-note">C<sub>α</sub> is the slope of e against log time after EOP.</p>' : '');
  }

  function renderStatus() {
    var s, inc = sim.cur, row = next > 0 ? rows[next - 1] : null, ap = $('apply');
    if (!inc) s = 'The specimen is seated under ' + soil.seat + ' kPa. Apply the first load when ready.';
    else {
      s = 'Increment ' + next + ' of ' + rows.length + ': ' + PHASE[row.phase].toLowerCase() + ' to <b>' + row.sigma + ' kPa</b>. ';
      if (!inc.eop) s += 'Primary consolidation: water drains through the porous stones and the specimen ' +
        (inc.dsig > 0 ? 'compresses.' : 'swells.');
      else s += 'End of primary after ' + fmtDur(inc.tEOP) + '. ' + (inc.dsig > 0 ? 'Secondary compression (creep) continues.' : 'Only slow secondary movement now.');
      if (st.meth === 'A' && sim.t < DAY - 1e-6) s += ' Method A holds every load for 24 h (' + fmtDur(DAY - sim.t) + ' left).';
      if (next >= rows.length && inc.eop) s += ' <b>Last increment.</b> Export the readings or interpret the curves.';
      if (!running && sim.t < pauseCap() - 1e-6) s += ' (clock paused)';
      else if (!running) s += ' (clock stopped at ' + fmtDur(sim.t) + ')';
    }
    if (flash > 0 && !canApply() && next < rows.length) s = '<b>Not yet.</b> ' + (st.meth === 'A' ? 'Method A keeps each load for 24 h.' : 'Wait for the end of primary consolidation.') + ' ' + s;
    $('status').innerHTML = s;
    ap.disabled = !canApply();
    ap.textContent = next >= rows.length ? 'Schedule finished' : (next === 0 ? 'Apply first load ▸ ' : 'Apply next load ▸ ') + rows[next].sigma + ' kPa';
    $('play').textContent = running ? 'Pause clock' : 'Resume clock';
    $('play').disabled = !inc;
    $('whole').classList.toggle('vl-on', whole);
  }

  function renderAll(full) {
    if (full || schedDirty) renderTable(true); else renderTable(false);
    renderIncSelect();
    renderTP();
    renderCP();
    renderInterp();
    renderStatus();
    updateSpeed();
    drawRig();
  }

  /* ---------------- hash, CSV ---------------- */
  function writeHash() {
    var o = { seed: seed };
    ['meth', 'seat', 'first', 'lir', 'smax', 'sunl', 'srel', 'uview', 'ipsp', 'ipcc', 'ipcr', 'ipmv', 'ipca', 'ipcar'].forEach(function (k) {
      o[k] = typeof st[k] === 'boolean' ? (st[k] ? 1 : 0) : st[k];
    });
    o.auto = $('auto').checked ? 1 : 0; o.spd = $('spd').value;
    ['tpY', 'tpX', 'cpY', 'cpX'].forEach(function (k) { o[k] = $(k).value; });
    VLab.Hash.write(o);
  }

  function exportCSV() {
    var L = ['increment,stage,stress_kPa,reading,time_min,test_time_h,deformation_mm,axial_strain_pct,void_ratio'];
    L.push('0,seating,' + soil.seat + ',start,0,0,0,0,' + soil.e0.toFixed(5));
    sim.incs.forEach(function (inc, i) {
      var r = rows[i];
      function line(lab, t) {
        var eps = O.epsAt(inc, t);
        L.push([i + 1, r.phase, r.sigma, lab, (t / 60).toFixed(3), ((inc.T0 + t) / 3600).toFixed(4),
          (eps * soil.H0).toFixed(4), (eps * 100).toFixed(4), eOf(eps).toFixed(5)].join(','));
      }
      line('0', 0);
      READ_MIN.forEach(function (m) { if (m * 60 <= inc.tEnd) line('ASTM', m * 60); });
      if (inc.eop) line('EOP', inc.tEOP);
      line('end', inc.tEnd);
    });
    var blob = new Blob([L.join('\n') + '\n'], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'oedometer_specimen_' + seed + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* ---------------- the rig ---------------- */
  var rig = $('rig'), rc = rig.getContext('2d'), RW = 480, RH = 340, rs = { W: 1, H: 1, dpr: 1, sc: 1, ox: 0, oy: 0 };
  function rigResize() {
    var host = rig.parentElement;
    rs.W = Math.max(60, host.clientWidth); rs.H = Math.max(60, host.clientHeight);
    rs.dpr = window.devicePixelRatio || 1;
    rig.style.width = rs.W + 'px'; rig.style.height = rs.H + 'px';
    rig.width = Math.round(rs.W * rs.dpr); rig.height = Math.round(rs.H * rs.dpr);
    rs.sc = Math.min(rs.W / RW, rs.H / RH); rs.ox = (rs.W - RW * rs.sc) / 2; rs.oy = (rs.H - RH * rs.sc) / 2;
    drawRig();
  }
  if (window.ResizeObserver) new ResizeObserver(function () { requestAnimationFrame(rigResize); }).observe(rig.parentElement);
  window.addEventListener('resize', rigResize);

  var KNOB = { x: 408, y: 250, r: 19 };
  function rigXY(e) {
    var r = rig.getBoundingClientRect();
    return [(e.clientX - r.left - rs.ox) / rs.sc, (e.clientY - r.top - rs.oy) / rs.sc];
  }
  function onKnob(p) { return Math.hypot(p[0] - KNOB.x, p[1] - KNOB.y) < KNOB.r + 8; }
  rig.addEventListener('pointerdown', function (e) {
    var p = rigXY(e);
    if (!onKnob(p)) return;
    knob.drag = true; knob.acc = 0; knob.last = Math.atan2(p[1] - KNOB.y, p[0] - KNOB.x);
    try { rig.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
  });
  rig.addEventListener('pointermove', function (e) {
    var p = rigXY(e);
    rig.style.cursor = knob.drag ? 'grabbing' : onKnob(p) ? 'grab' : '';
    if (!knob.drag) return;
    var a = Math.atan2(p[1] - KNOB.y, p[0] - KNOB.x), d = a - knob.last;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    knob.last = a;
    if (d > 0) {
      knob.angle += d; knob.acc += d;
      if (knob.acc > 1.5) { knob.acc = 0; knob.drag = false; applyNext(); }
    }
    drawRig();
  });
  function endDrag() { knob.drag = false; }
  rig.addEventListener('pointerup', endDrag);
  rig.addEventListener('pointercancel', endDrag);

  function rrect(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  function drawRig() {
    if (!sim) return;
    var c = rc, ink = css('--vl-ink'), muted = css('--vl-muted'), dark = css('color-scheme') === 'dark';
    c.setTransform(rs.dpr, 0, 0, rs.dpr, 0, 0);
    c.clearRect(0, 0, rs.W, rs.H);
    c.fillStyle = css('--vl-panel'); c.fillRect(0, 0, rs.W, rs.H);
    c.translate(rs.ox, rs.oy); c.scale(rs.sc, rs.sc);
    var metal = dark ? '#7d8792' : '#9aa4af', metalD = dark ? '#59616b' : '#6e7883', steel = dark ? '#b8c0c8' : '#d3d9df';
    var eps = sim.epsBar(), dmm = eps * soil.H0, inc = sim.cur;

    /* bench */
    c.fillStyle = dark ? '#3a332b' : '#b59b7a'; c.fillRect(-200, 300, RW + 400, 60);
    c.fillStyle = dark ? '#2a251f' : '#8c7558'; c.fillRect(-200, 300, RW + 400, 4);

    /* wall clock */
    var tt = 8 * 3600 + sim.T + sim.t, cx = 58, cy = 46, R = 34;
    c.fillStyle = '#fbfbf8'; c.strokeStyle = '#2b2b2b'; c.lineWidth = 4;
    c.beginPath(); c.arc(cx, cy, R, 0, 2 * Math.PI); c.fill(); c.stroke();
    c.lineWidth = 1.5; c.strokeStyle = '#333';
    for (var k = 0; k < 12; k++) {
      var a = k / 12 * 2 * Math.PI, r0 = k % 3 ? R - 7 : R - 11;
      c.beginPath(); c.moveTo(cx + r0 * Math.sin(a), cy - r0 * Math.cos(a)); c.lineTo(cx + (R - 3) * Math.sin(a), cy - (R - 3) * Math.cos(a)); c.stroke();
    }
    function hand(frac, len, w, col) {
      var an = frac * 2 * Math.PI;
      c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round';
      c.beginPath(); c.moveTo(cx - 5 * Math.sin(an), cy + 5 * Math.cos(an)); c.lineTo(cx + len * Math.sin(an), cy - len * Math.cos(an)); c.stroke();
    }
    hand((tt / 43200) % 1, R * 0.5, 3.5, '#222');
    hand((tt / 3600) % 1, R * 0.75, 2.5, '#222');
    hand((tt / 60) % 1, R * 0.82, 1, '#cc0000');
    c.lineCap = 'butt';
    c.fillStyle = '#222'; c.beginPath(); c.arc(cx, cy, 2.5, 0, 2 * Math.PI); c.fill();
    c.fillStyle = ink; c.textAlign = 'center'; c.textBaseline = 'top';
    c.font = '600 11px system-ui, sans-serif';
    c.fillText('Day ' + (Math.floor(tt / DAY) + 1) + ' · ' + fmtClock(tt % DAY).slice(0, 5), cx, cy + R + 5);
    c.font = '10px system-ui, sans-serif'; c.fillStyle = muted;
    c.fillText('test time ' + fmtDur(sim.T + sim.t), cx, cy + R + 18);
    c.fillText('this load ' + (inc ? fmtClock(sim.t) : '—'), cx, cy + R + 29);
    var rate = inc && running ? clockRate() : 0;
    c.fillText(rate ? 'clock ×' + (rate >= 100 ? Math.round(rate).toLocaleString('en-US') : rate.toFixed(1)) : 'clock stopped', cx, cy + R + 40);

    /* load frame */
    c.fillStyle = metalD; c.fillRect(150, 286, 180, 14);
    c.fillStyle = metal; c.fillRect(160, 40, 10, 246); c.fillRect(310, 40, 10, 246);
    c.fillStyle = metalD; rrect(c, 148, 38, 184, 24, 3); c.fill();
    c.fillStyle = dark ? '#4a525c' : '#59636e'; rrect(c, 214, 6, 52, 34, 5); c.fill();
    c.fillStyle = '#c9d0d8'; c.font = '8px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('actuator', 240, 23);

    /* specimen geometry (true scale: 34 px = 25.4 mm) */
    var hs0 = 34, hs = hs0 * (1 - eps), yBot = 262, yTop = yBot - hs, yStone = yTop - 7, yCap = yStone - 8;
    var yLC = yCap - 32, armY = yCap + 3;
    /* bath */
    c.fillStyle = dark ? 'rgba(90,162,255,0.10)' : 'rgba(31,111,209,0.08)'; c.fillRect(186, 206, 108, 80);
    c.fillStyle = dark ? 'rgba(90,162,255,0.28)' : 'rgba(31,111,209,0.22)'; c.fillRect(188, 216, 104, 70);
    c.strokeStyle = metalD; c.lineWidth = 2;
    c.beginPath(); c.moveTo(186, 204); c.lineTo(186, 286); c.lineTo(294, 286); c.lineTo(294, 204); c.stroke();
    c.fillStyle = metal; c.fillRect(214, 270, 52, 16);                    // pedestal
    /* porous stones */
    function stone(y, x0, w) {
      c.fillStyle = '#cfc8b8'; c.fillRect(x0, y, w, 7);
      c.fillStyle = '#9b927f';
      for (var sx = x0 + 2; sx < x0 + w - 1; sx += 4) for (var sy = y + 1.5; sy < y + 6.5; sy += 2.5) c.fillRect(sx + ((sy * 7) % 2), sy, 1, 1);
    }
    stone(yBot, 218, 44);
    /* specimen, optional pore-pressure colouring */
    c.fillStyle = dark ? '#8d6e4c' : '#8a6a48'; c.fillRect(218, yTop, 44, hs);
    if (st.uview && inc) {
      var uref = Math.max(1e-9, Math.abs(inc.dsig)), H = soil.H0 / 1000;
      for (var i = 0; i < sim.N - 1; i++) {
        var um = (sim.u[i] + sim.u[i + 1]) / 2 / uref * Math.sign(inc.dsig || 1), y0 = yTop + sim.z[i] / H * hs, y1 = yTop + sim.z[i + 1] / H * hs;
        c.fillStyle = um >= 0 ? 'rgba(40,120,255,' + Math.min(0.9, um * 0.9) + ')' : 'rgba(255,140,30,' + Math.min(0.9, -um * 0.9) + ')';
        c.fillRect(218, y0, 44, y1 - y0 + 0.3);
      }
    }
    stone(yStone, 218, 44);
    /* ring */
    c.fillStyle = steel; c.fillRect(213, yBot - hs0 - 9, 5, hs0 + 9); c.fillRect(262, yBot - hs0 - 9, 5, hs0 + 9);
    c.strokeStyle = metalD; c.lineWidth = 0.8; c.strokeRect(213, yBot - hs0 - 9, 5, hs0 + 9); c.strokeRect(262, yBot - hs0 - 9, 5, hs0 + 9);
    /* loading cap, load cell, ram */
    c.fillStyle = metal; c.fillRect(220, yCap, 40, 8);
    c.fillStyle = steel; c.fillRect(236, 62, 8, yLC - 62); c.fillRect(237, yLC + 16, 6, yCap - yLC - 16);
    c.fillStyle = dark ? '#3c6e9e' : '#2f5f8e'; rrect(c, 226, yLC, 28, 16, 3); c.fill();
    c.fillStyle = '#e8eef5'; c.font = '7px system-ui, sans-serif'; c.fillText('load cell', 240, yLC + 8.5);
    /* arms to the gauges */
    c.fillStyle = metalD; c.fillRect(190, armY, 32, 3); c.fillRect(258, armY, 34, 3);
    /* LVDT on a bracket from the right column */
    c.fillStyle = metalD; c.fillRect(290, 146, 20, 4);
    c.fillStyle = dark ? '#6a7684' : '#5f6b78'; rrect(c, 280, 140, 10, 40, 2); c.fill();
    c.fillStyle = steel; c.fillRect(284, 180, 2, armY - 180);
    c.fillStyle = muted; c.font = '8px system-ui, sans-serif'; c.textAlign = 'left';
    c.fillText('LVDT', 293, 166);
    /* dial gauge on a bracket from the left column */
    c.fillStyle = metalD; c.fillRect(170, 142, 18, 4);
    c.fillStyle = steel; c.fillRect(193, 142, 2, armY - 142);
    var gx = 194, gy = 124, gr = 16;
    c.fillStyle = '#fbfbf8'; c.strokeStyle = metalD; c.lineWidth = 2.5;
    c.beginPath(); c.arc(gx, gy, gr, 0, 2 * Math.PI); c.fill(); c.stroke();
    c.strokeStyle = '#555'; c.lineWidth = 0.7;
    for (k = 0; k < 50; k++) {
      var ga = k / 50 * 2 * Math.PI, gl = k % 5 ? 2.5 : 4.5;
      c.beginPath(); c.moveTo(gx + (gr - 2) * Math.sin(ga), gy - (gr - 2) * Math.cos(ga));
      c.lineTo(gx + (gr - 2 - gl) * Math.sin(ga), gy - (gr - 2 - gl) * Math.cos(ga)); c.stroke();
    }
    var na = (dmm % 1) * 2 * Math.PI, ra = dmm / 10 * 2 * Math.PI;
    c.strokeStyle = '#555'; c.lineWidth = 1; c.beginPath(); c.moveTo(gx, gy + 6); c.lineTo(gx + 4 * Math.sin(ra), gy + 6 - 4 * Math.cos(ra)); c.stroke();
    c.strokeStyle = '#cc0000'; c.lineWidth = 1.4;
    c.beginPath(); c.moveTo(gx, gy); c.lineTo(gx + (gr - 4) * Math.sin(na), gy - (gr - 4) * Math.cos(na)); c.stroke();
    c.fillStyle = '#222'; c.beginPath(); c.arc(gx, gy, 1.6, 0, 2 * Math.PI); c.fill();
    c.fillStyle = muted; c.textAlign = 'center'; c.font = '8px system-ui, sans-serif';
    c.fillText('dial 0.01 mm', gx, gy - gr - 7);

    /* cables */
    c.strokeStyle = dark ? '#aaa' : '#444'; c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(254, yLC + 8); c.bezierCurveTo(300, yLC + 8, 300, 105, 344, 108); c.stroke();
    c.beginPath(); c.moveTo(285, 140); c.bezierCurveTo(285, 120, 320, 128, 344, 128); c.stroke();

    /* controller */
    c.fillStyle = dark ? '#262b33' : '#39414c'; rrect(c, 344, 66, 128, 222, 8); c.fill();
    c.fillStyle = '#10201a'; rrect(c, 352, 76, 112, 86, 4); c.fill();
    dispSigma = isFinite(dispSigma) ? dispSigma : sim.sigma;
    var F = dispSigma * AREA;  // kN
    c.font = '600 11px ui-monospace, Consolas, monospace'; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillStyle = '#7CFC9A';
    c.fillText('LOAD  ' + pad(F.toFixed(3), 7) + ' kN', 358, 88);
    c.fillText('σ     ' + pad(dispSigma.toFixed(1), 7) + ' kPa', 358, 104);
    c.fillText('DISP  ' + pad(dmm.toFixed(3), 7) + ' mm', 358, 120);
    c.fillText('t     ' + pad(inc ? fmtClock(sim.t) : '--:--:--', 8), 358, 136);
    c.fillStyle = '#4c8a62'; c.font = '9px ui-monospace, Consolas, monospace';
    c.fillText('INC ' + next + '/' + rows.length, 358, 152);
    var stat, led;
    if (!inc) { stat = 'SEATED'; led = '#9aa0a6'; }
    else if (!inc.eop) { stat = 'PRIMARY'; led = (performance.now() / 400 | 0) % 2 && running ? '#ffb020' : '#a86d00'; }
    else if (next >= rows.length) { stat = 'COMPLETE'; led = '#4fc3f7'; }
    else { stat = canApply() ? 'EOP – READY' : 'EOP – HOLD'; led = '#3ddc84'; }
    c.fillStyle = led; c.beginPath(); c.arc(362, 178, 5, 0, 2 * Math.PI); c.fill();
    c.fillStyle = '#e8eef5'; c.font = '600 10px system-ui, sans-serif'; c.fillText(stat, 372, 178);
    c.fillStyle = '#c9d0d8'; c.font = '9px system-ui, sans-serif'; c.textAlign = 'center';
    c.fillText('LOAD SETPOINT', KNOB.x, 204);
    c.fillText(next < rows.length ? 'next: ' + rows[next].sigma + ' kPa' : 'schedule done', KNOB.x, 216);
    var ready = canApply();
    c.fillStyle = '#1b1f24'; c.beginPath(); c.arc(KNOB.x, KNOB.y, KNOB.r + 3, 0, 2 * Math.PI); c.fill();
    if (ready) { c.strokeStyle = css('--vl-accent'); c.lineWidth = 2.5 + Math.sin(performance.now() / 250); c.stroke(); }
    var kg = c.createRadialGradient(KNOB.x - 5, KNOB.y - 5, 2, KNOB.x, KNOB.y, KNOB.r);
    kg.addColorStop(0, '#d9dde2'); kg.addColorStop(1, '#7c858f');
    c.fillStyle = kg; c.beginPath(); c.arc(KNOB.x, KNOB.y, KNOB.r, 0, 2 * Math.PI); c.fill();
    c.strokeStyle = '#222'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(KNOB.x, KNOB.y);
    c.lineTo(KNOB.x + (KNOB.r - 4) * Math.sin(knob.angle), KNOB.y - (KNOB.r - 4) * Math.cos(knob.angle)); c.stroke();
    c.fillStyle = '#c9d0d8'; c.font = '9px system-ui, sans-serif';
    c.fillText(ready ? 'turn ↻ to load' : '', KNOB.x, 280);

    /* isochrone (model view) */
    if (st.uview) {
      var bx = 14, by = 176, bw = 108, bh = 112;
      c.fillStyle = css('--vl-bg'); c.globalAlpha = 0.9; rrect(c, bx - 6, by - 26, bw + 14, bh + 46, 6); c.fill(); c.globalAlpha = 1;
      c.fillStyle = ink; c.textAlign = 'left'; c.textBaseline = 'top'; c.font = '600 9.5px system-ui, sans-serif';
      c.fillText('Excess pore pressure u', bx - 2, by - 22);
      c.fillStyle = muted; c.font = '8.5px system-ui, sans-serif';
      c.fillText('model view, not measured', bx - 2, by - 11);
      var px0 = bx + 6, px1 = bx + bw - 4, py0 = by + 6, py1 = by + bh - 10;
      c.strokeStyle = muted; c.lineWidth = 1;
      c.strokeRect(px0 + 0.5, py0 + 0.5, px1 - px0, py1 - py0);
      c.fillStyle = muted; c.textBaseline = 'top'; c.textAlign = 'center';
      c.fillText('0', px0, py1 + 2); c.fillText('Δσ', px1, py1 + 2); c.fillText('u', (px0 + px1) / 2, py1 + 2);
      c.save(); c.translate(bx - 1, (py0 + py1) / 2); c.rotate(-Math.PI / 2); c.textBaseline = 'middle'; c.fillText('depth', 0, 0); c.restore();
      if (inc) {
        var ur = Math.max(1e-9, Math.abs(inc.dsig)), sg = Math.sign(inc.dsig || 1), Hm = soil.H0 / 1000;
        c.strokeStyle = sg > 0 ? css('--vl-water') : '#e08a1e'; c.lineWidth = 2; c.beginPath();
        for (i = 0; i < sim.N; i++) {
          var xx = px0 + Math.max(0, Math.min(1, sim.u[i] * sg / ur)) * (px1 - px0), yy = py0 + sim.z[i] / Hm * (py1 - py0);
          if (i) c.lineTo(xx, yy); else c.moveTo(xx, yy);
        }
        c.stroke();
        c.fillStyle = ink; c.textAlign = 'right'; c.textBaseline = 'top';
        c.fillText('u max ' + Math.abs(sim.uMax()).toFixed(1) + ' kPa', px1 - 2, py0 + 3);
      }
    }
  }
  function pad(s, n) { s = String(s); while (s.length < n) s = ' ' + s; return s; }

  /* ---------------- clock loop ---------------- */
  var lastT = 0, tableT = 0;
  function frame(now) {
    var dtR = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0;
    lastT = now;
    if (flash > 0) { flash -= dtR / 2.5; if (flash <= 0) renderStatus(); }
    if (running && sim.cur) {
      var cap = pauseCap(), wasEOP = sim.cur.eop;
      sim.advanceTo(Math.min(cap, sim.t + clockRate() * dtR));
      if (sim.t >= cap - 1e-6) running = false;
      if (whole) {
        var hold = st.meth === 'A' ? DAY : Math.max(6 * (sim.cur.tEOP || 0), 120);
        if (canApply() && (sim.t >= hold - 1e-6 || !running)) {
          if (next < rows.length) applyNext(); else { whole = false; running = false; }
        } else if (!running && next >= rows.length) whole = false;
      }
      if (!wasEOP && sim.cur.eop) schedDirty = true;
      if (now - tableT > 300 || schedDirty || !running) { tableT = now; renderTable(schedDirty); renderInterp(); renderStatus(); }
      renderTP(); renderCP(); updateSpeed();
    }
    dispSigma += (sim.sigma - dispSigma) * Math.min(1, dtR * 5);
    drawRig();
    requestAnimationFrame(frame);
  }

  /* ---------------- self test ---------------- */
  function autotest() {
    var out = [], ok = true;
    function check(name, cond, info) { out.push((cond ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); ok = ok && cond; }
    var T = O.selfTest();
    out = out.concat(T.lines); ok = ok && T.ok;
    /* turning the setpoint knob applies the first load */
    resetTest();
    var rr = rig.getBoundingClientRect();
    function knobEv(type, ang) {
      var x = KNOB.x + 15 * Math.sin(ang), y = KNOB.y - 15 * Math.cos(ang);
      rig.dispatchEvent(new PointerEvent(type, { clientX: rr.left + rs.ox + x * rs.sc, clientY: rr.top + rs.oy + y * rs.sc, pointerId: 1, bubbles: true }));
    }
    knobEv('pointerdown', 0);
    for (var ka = 0.2; ka <= 2.0; ka += 0.2) knobEv('pointermove', ka);
    knobEv('pointerup', 2.0);
    check('knob turn applies the first load', sim.incs.length === 1);
    /* full scripted test on this specimen */
    resetTest();
    var t0 = performance.now();
    rows.forEach(function () {
      applyNext();
      sim.runUntilEOP(7 * DAY);
      sim.advanceTo(Math.max(sim.t, 6 * sim.cur.tEOP));
    });
    running = false;
    out.push('full test ' + rows.length + ' increments in ' + (performance.now() - t0).toFixed(0) + ' ms');
    check('every increment reached EOP', sim.incs.every(function (c) { return c.eop; }));
    var B = branches(), mono = B.load.every(function (p, i) { return !i || p[1] < B.load[i - 1][1]; });
    check('loading e decreases monotonically', mono);
    check('unloading rebounds', B.unload.length && B.unload[B.unload.length - 1][1] > B.load[B.load.length - 1][1]);
    ['ipsp', 'ipcc', 'ipcr', 'ipmv', 'ipca', 'ipcar'].forEach(function (k) { ui.set(k, true); });
    selInc = rows.findIndex(function (r) { return r.sigma === Math.max(st.smax, st.first) && r.phase === 'load'; });
    renderAll(true);
    var R = interpret(), ca = caFit(selInc);
    /* hovering an EOP point highlights the table row and the time-curve EOP point */
    var cr = $('cplot').getBoundingClientRect(), inc6 = sim.incs[selInc];
    $('cplot').dispatchEvent(new PointerEvent('pointermove', { bubbles: true,
      clientX: cr.left + cplot.X.px(rows[selInc].sigma), clientY: cr.top + cplot.Y.px(eOf(inc6.epsEOP)) }));
    var tr = $('sched').querySelector('tr[data-i="' + selInc + '"]');
    check('hover links plot, table and time curve', cplot.hoverId === selInc && tr.classList.contains('oe-hl') && tplot.highlight === selInc);
    $('cplot').dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    check("σ'p interpreted", R.sp > 0, "σ'p = " + (R.sp || 0).toFixed(0) + ' (model ' + soil.sp.toFixed(0) + ')');
    check('Cc within 25 %', Math.abs(R.Cc / soil.Cc - 1) < 0.25, R.Cc.toFixed(3) + ' vs ' + soil.Cc.toFixed(3));
    check('Cr within 50 %', Math.abs(R.Cr / soil.Cr - 1) < 0.5, R.Cr.toFixed(3) + ' vs ' + soil.Cr.toFixed(3));
    check('Cα within 40 %', ca && !ca.short && Math.abs(ca.Ca / soil.Ca - 1) < 0.4, ca && ca.Ca ? ca.Ca.toFixed(4) + ' vs ' + soil.Ca.toFixed(4) : 'none');
    /* 50 random specimens */
    var lo = { e0: 9, Cc: 9, tE: 1e9 }, hi = { e0: 0, Cc: 0, tE: 0 }, bad = 0;
    t0 = performance.now();
    for (var n = 0; n < 50; n++) {
      var s = O.randomSoil(1000 + n * 7919), m = new O.Sim(s);
      [12.5, 25, 50, 100, 200, 400, 800].forEach(function (L) {
        var c = m.applyLoad(L); m.runUntilEOP(7 * DAY); m.advanceTo(2 * c.tEOP);
        if (!c.eop || !isFinite(c.epsEOP)) bad++;
        lo.tE = Math.min(lo.tE, c.tEOP); hi.tE = Math.max(hi.tE, c.tEOP);
      });
      lo.e0 = Math.min(lo.e0, s.e0); hi.e0 = Math.max(hi.e0, s.e0); lo.Cc = Math.min(lo.Cc, s.Cc); hi.Cc = Math.max(hi.Cc, s.Cc);
    }
    check('50 specimens, no failures', bad === 0, (performance.now() - t0).toFixed(0) + ' ms');
    out.push('e0 ' + lo.e0.toFixed(2) + '–' + hi.e0.toFixed(2) + ', Cc ' + lo.Cc.toFixed(2) + '–' + hi.Cc.toFixed(2) +
      ', t_EOP ' + (lo.tE / 60).toFixed(1) + '–' + (hi.tE / 60).toFixed(1) + ' min');
    var pre = document.createElement('pre');
    pre.id = 'selftest'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
    document.title = 'AUTOTEST ' + (ok ? 'PASS' : 'FAIL');
  }

  /* ---------------- boot ---------------- */
  makeSoil();
  rows = buildRows();
  resetTest();
  writeHash();
  rigResize();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { renderAll(true); });
  if (AUTOTEST) { try { autotest(); } catch (err) { document.title = 'AUTOTEST ERROR'; var p = document.createElement('pre'); p.id = 'selftest'; p.textContent = err.stack; document.body.appendChild(p); } }
  requestAnimationFrame(frame);
})();
