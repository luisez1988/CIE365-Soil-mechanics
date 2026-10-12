/* VLab.Plot — a small canvas line chart for profiles.
   One axis is a position (x, y or depth), the other a value.
     orient 'h': position runs left -> right, value up (a profile along x).
     orient 'v': position runs top -> bottom (depth), value to the right.
   The position axis can borrow another canvas' mapping (posPx) so a profile
   lines up with a VLab.View drawn next to it (give posInv too, for hover);
   otherwise it spans the margins. Hovering shows a crosshair and the value of
   every series at that position.
   Data: plot.data = { pos0, pos1, series: [{ pts: [[pos, val], ...], color, width, dash, label }],
                       markers: [{ pos, val, label }], posLabel, valLabel, posFmt }. */
(function (VLab) {
  'use strict';

  function niceStep(span, n) {
    var raw = span / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
  }

  function fmtTick(v, step) {
    var d = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    return (Math.abs(v) < step * 1e-6 ? 0 : v).toFixed(Math.min(d, 4));
  }

  function Plot(canvas, opt) {
    opt = opt || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.orient = opt.orient || 'h';
    this.margin = opt.margin || { l: 56, r: 12, t: 22, b: 40 };
    this.posPx = opt.posPx || null;
    this.posInv = opt.posInv || null;
    this.hover = null;
    this.colors = opt.colors || function () { return { ink: '#333', grid: '#ddd' }; };
    this.data = null;
    var self = this, pending = false;
    function schedule() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; self.resize(); });
    }
    if (window.ResizeObserver) new ResizeObserver(schedule).observe(canvas.parentElement);
    window.addEventListener('resize', schedule);
    canvas.addEventListener('pointermove', function (e) {
      var r = canvas.getBoundingClientRect();
      self.hover = self.orient === 'h' ? e.clientX - r.left : e.clientY - r.top;
      self.render();
    });
    canvas.addEventListener('pointerleave', function () { self.hover = null; self.render(); });
    this.resize();
  }

  /* Linear interpolation of a series at position p. */
  function at(pts, p) {
    for (var k = 1; k < pts.length; k++) {
      var a = pts[k - 1], b = pts[k];
      if ((p - a[0]) * (p - b[0]) <= 0 && a[0] !== b[0]) return a[1] + (b[1] - a[1]) * (p - a[0]) / (b[0] - a[0]);
    }
    return NaN;
  }

  var P = Plot.prototype;

  P.resize = function () {
    var host = this.canvas.parentElement;
    this.W = Math.max(60, host.clientWidth);
    this.H = Math.max(60, host.clientHeight);
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = this.W + 'px';
    this.canvas.style.height = this.H + 'px';
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.render();
  };

  P.render = function () {
    var c = this.ctx, d = this.data, m = this.margin, W = this.W, H = this.H, self = this;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    if (!d) return;
    var col = this.colors(), horiz = this.orient === 'h';

    /* position axis -> px */
    var p0 = d.pos0, p1 = d.pos1, pos, inv;
    if (this.posPx) { pos = this.posPx; inv = this.posInv; }
    else if (horiz) {
      pos = function (p) { return m.l + (p - p0) / (p1 - p0) * (W - m.l - m.r); };
      inv = function (px) { return p0 + (px - m.l) / (W - m.l - m.r) * (p1 - p0); };
    } else {
      pos = function (p) { return m.t + (p - p0) / (p1 - p0) * (H - m.t - m.b); };
      inv = function (px) { return p0 + (px - m.t) / (H - m.t - m.b) * (p1 - p0); };
    }

    /* value range, always including 0 */
    var lo = 0, hi = 0;
    d.series.forEach(function (s) {
      s.pts.forEach(function (q) { if (isFinite(q[1])) { if (q[1] < lo) lo = q[1]; if (q[1] > hi) hi = q[1]; } });
    });
    if (d.valRange) { lo = d.valRange[0]; hi = d.valRange[1]; }
    if (hi - lo < 1e-12) { hi = lo + 1; }
    var step = niceStep(hi - lo, horiz ? Math.max(2, (H - m.t - m.b) / 40) : Math.max(2, (W - m.l - m.r) / 70));
    lo = Math.floor(lo / step - 1e-9) * step; hi = Math.ceil(hi / step + 1e-9) * step;
    var val = horiz
      ? function (v) { return H - m.b - (v - lo) / (hi - lo) * (H - m.t - m.b); }
      : function (v) { return m.l + (v - lo) / (hi - lo) * (W - m.l - m.r); };
    function xy(p, v) { return horiz ? [pos(p), val(v)] : [val(v), pos(p)]; }

    var a = pos(p0), b = pos(p1);
    c.save();
    c.font = '11px system-ui, sans-serif';
    c.lineWidth = 1;

    /* value grid + ticks */
    for (var v = lo; v <= hi + step * 1e-6; v += step) {
      var g = val(v);
      c.strokeStyle = Math.abs(v) < step * 1e-6 ? col.ink : col.grid;
      c.beginPath();
      if (horiz) { c.moveTo(a, g + 0.5); c.lineTo(b, g + 0.5); } else { c.moveTo(g + 0.5, a); c.lineTo(g + 0.5, b); }
      c.stroke();
      c.fillStyle = col.ink;
      if (horiz) { c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText(fmtTick(v, step), Math.min(a, b) - 6, g); }
      else { c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText(fmtTick(v, step), g, Math.min(a, b) - 4); }
    }

    /* position ticks */
    var pstep = niceStep(Math.abs(p1 - p0), Math.max(2, Math.abs(b - a) / (horiz ? 70 : 40)));
    c.strokeStyle = col.ink; c.fillStyle = col.ink;
    c.beginPath();
    if (horiz) { c.moveTo(a, H - m.b + 0.5); c.lineTo(b, H - m.b + 0.5); }
    else { c.moveTo(m.l - 0.5, a); c.lineTo(m.l - 0.5, b); }
    c.stroke();
    for (var p = Math.ceil(Math.min(p0, p1) / pstep) * pstep; p <= Math.max(p0, p1) + 1e-9; p += pstep) {
      var t = pos(p), lab = d.posFmt ? d.posFmt(p) : fmtTick(p, pstep);
      c.beginPath();
      if (horiz) { c.moveTo(t, H - m.b); c.lineTo(t, H - m.b + 4); c.stroke(); c.textAlign = 'center'; c.textBaseline = 'top'; c.fillText(lab, t, H - m.b + 6); }
      else { c.moveTo(m.l, t); c.lineTo(m.l - 4, t); c.stroke(); c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText(lab, m.l - 6, t); }
    }

    /* labels */
    c.font = '600 12px system-ui, sans-serif';
    if (horiz) {
      c.textAlign = 'center'; c.textBaseline = 'bottom';
      c.fillText(d.posLabel || '', (a + b) / 2, H - 2);
      c.save(); c.translate(Math.max(13, Math.min(a, b) - 46), (m.t + H - m.b) / 2); c.rotate(-Math.PI / 2);
      c.textBaseline = 'middle'; c.fillText(d.valLabel || '', 0, 0); c.restore();
    } else {
      c.textAlign = 'center'; c.textBaseline = 'bottom';
      c.fillText(d.valLabel || '', (m.l + W - m.r) / 2, H - 2);
      c.save(); c.translate(13, (a + b) / 2); c.rotate(-Math.PI / 2);
      c.textBaseline = 'middle'; c.fillText(d.posLabel || '', 0, 0); c.restore();
    }

    /* clip to the plotting box, then series */
    c.beginPath();
    if (horiz) c.rect(Math.min(a, b), m.t - 2, Math.abs(b - a), H - m.t - m.b + 4);
    else c.rect(m.l - 2, Math.min(a, b), W - m.l - m.r + 4, Math.abs(b - a));
    c.clip();
    d.series.forEach(function (s) {
      c.strokeStyle = s.color || col.ink;
      c.lineWidth = s.width || 1.6;
      c.setLineDash(s.dash || []);
      c.beginPath();
      var pen = false;
      s.pts.forEach(function (q) {
        if (!isFinite(q[1])) { pen = false; return; }
        var r = xy(q[0], q[1]);
        if (pen) c.lineTo(r[0], r[1]); else c.moveTo(r[0], r[1]);
        pen = true;
      });
      c.stroke();
    });
    c.setLineDash([]);
    (d.markers || []).forEach(function (k) {
      var r = xy(k.pos, k.val);
      c.fillStyle = col.ink;
      c.beginPath(); c.arc(r[0], r[1], 3.5, 0, 2 * Math.PI); c.fill();
      if (k.label) {
        c.font = '600 11px system-ui, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'bottom';
        c.fillText(k.label, r[0] + 5, r[1] - 3);
      }
    });
    /* hover crosshair + readout */
    if (this.hover != null && inv) {
      var hp = inv(this.hover);
      if (hp >= Math.min(p0, p1) && hp <= Math.max(p0, p1)) {
        var hpx = pos(hp);
        c.strokeStyle = col.ink; c.lineWidth = 1; c.setLineDash([3, 3]);
        c.beginPath();
        if (horiz) { c.moveTo(hpx, m.t); c.lineTo(hpx, H - m.b); } else { c.moveTo(m.l, hpx); c.lineTo(W - m.r, hpx); }
        c.stroke(); c.setLineDash([]);
        var lines = [(d.posName || 'pos') + ' = ' + hp.toFixed(2)];
        d.series.forEach(function (s) {
          var v = at(s.pts, hp);
          if (!isFinite(v)) return;
          var r = xy(hp, v);
          c.fillStyle = s.color || col.ink;
          c.beginPath(); c.arc(r[0], r[1], 3, 0, 2 * Math.PI); c.fill();
          lines.push((s.label || d.valName || 'value') + ': ' + v.toPrecision(4));
        });
        c.font = '11px system-ui, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'top';
        var tw = 0;
        lines.forEach(function (t) { tw = Math.max(tw, c.measureText(t).width); });
        var bx = horiz ? hpx + 8 : W - m.r - tw - 12, by = horiz ? m.t + 2 : hpx + 6;
        if (horiz && bx + tw + 10 > W) bx = hpx - tw - 18;
        if (!horiz && by + lines.length * 14 + 6 > H) by = hpx - lines.length * 14 - 10;
        c.fillStyle = col.bg || 'rgba(255,255,255,0.92)';
        c.fillRect(bx, by, tw + 10, lines.length * 14 + 6);
        c.strokeStyle = col.grid; c.strokeRect(bx + 0.5, by + 0.5, tw + 10, lines.length * 14 + 6);
        c.fillStyle = col.ink;
        lines.forEach(function (t, n) { c.fillText(t, bx + 5, by + 4 + n * 14); });
      }
    }
    c.restore();

    /* legend */
    var named = d.series.filter(function (s) { return s.label; });
    if (named.length > 1) {
      c.save();
      c.font = '11px system-ui, sans-serif'; c.textBaseline = 'middle'; c.textAlign = 'left';
      var lw = 0;
      named.forEach(function (s) { lw = Math.max(lw, c.measureText(s.label).width); });
      lw += 30;
      var lx = horiz ? Math.max(a, b) - lw - 4 : Math.max(m.l + 4, W - m.r - lw),
        ly = horiz ? m.t + 6 : Math.max(a, b) - named.length * 14 - 2;
      c.fillStyle = col.bg || 'rgba(255,255,255,0.9)'; c.globalAlpha = 0.85;
      c.fillRect(lx - 4, ly - 9, lw + 4, named.length * 14 + 4);
      c.globalAlpha = 1;
      named.forEach(function (s, n) {
        var y = ly + n * 14;
        c.strokeStyle = s.color || col.ink; c.lineWidth = s.width || 1.6; c.setLineDash(s.dash || []);
        c.beginPath(); c.moveTo(lx, y); c.lineTo(lx + 18, y); c.stroke();
        c.fillStyle = col.ink; c.fillText(s.label, lx + 22, y);
      });
      c.restore();
    }
  };

  VLab.Plot = Plot;
  VLab.Plot.niceStep = niceStep;
})(window.VLab = window.VLab || {});
