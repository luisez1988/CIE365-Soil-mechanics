/* VLab.XYPlot — a small canvas x–y chart with linear or log axes, hoverable
   points and annotation overlays (used by the oedometer lab).
   plot.data = {
     xLog, yLog, yInvert, xLabel, yLabel, xRange:[a,b], yRange:[a,b],
     series: [{ pts: [[x, y], ...], color, width, dash, label }],
     points: [{ x, y, id, color, r, ring, tip }],     hoverable, tip = text or [lines]
     ann:    [{ type:'line', x0, y0, x1, y1, color, dash, width },
              { type:'text', x, y, text, color, align, dx, dy },
              { type:'vline', x, color, dash }, { type:'hline', y, color, dash }],
     readout: function (x) -> [lines] | null,         crosshair text when no point is near
     empty: 'message shown when there is nothing to plot' }
   plot.highlight = id draws a ring around the matching point.
   opt.onHover(id | null) fires when the hovered point changes. */
(function (VLab) {
  'use strict';

  function niceStep(span, n) {
    var raw = span / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
  }
  function fmtLin(v, step) {
    var d = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    return (Math.abs(v) < step * 1e-6 ? 0 : v).toFixed(Math.min(d, 4));
  }
  function fmtLog(v) {
    if (v >= 1e5 || v < 1e-3) return v.toExponential(0).replace('e+', 'e');
    return String(+v.toPrecision(3));
  }

  /* Axis object: value <-> px, ticks. */
  function axis(lo, hi, log, p0, p1, nTicks) {
    var f = log ? Math.log10 : function (v) { return v; };
    var a = f(lo), b = f(hi);
    var ax = {
      log: log, lo: lo, hi: hi,
      px: function (v) { return p0 + (f(v) - a) / (b - a) * (p1 - p0); },
      val: function (px) { var t = a + (px - p0) / (p1 - p0) * (b - a); return log ? Math.pow(10, t) : t; },
      ticks: []
    };
    if (log) {
      var d0 = Math.floor(a - 1e-9), d1 = Math.ceil(b + 1e-9), span = b - a;
      var mult = span < 1.2 ? [1, 2, 3, 5] : span < 2.5 ? [1, 2, 5] : [1];
      for (var d = d0; d <= d1; d++) {
        for (var m = 1; m < 10; m++) {
          var v = m * Math.pow(10, d);
          if (v < lo * 0.9999 || v > hi * 1.0001) continue;
          ax.ticks.push({ v: v, major: m === 1, label: mult.indexOf(m) >= 0 ? fmtLog(v) : '' });
        }
      }
    } else {
      var step = niceStep(hi - lo, nTicks);
      for (var t = Math.ceil(lo / step - 1e-9) * step; t <= hi + step * 1e-6; t += step)
        ax.ticks.push({ v: t, major: true, label: fmtLin(t, step) });
    }
    return ax;
  }

  function range(vals, log, pad) {
    var lo = Infinity, hi = -Infinity;
    vals.forEach(function (v) { if (isFinite(v) && (!log || v > 0)) { if (v < lo) lo = v; if (v > hi) hi = v; } });
    if (!isFinite(lo)) return log ? [1, 10] : [0, 1];
    if (log) {
      var a = Math.log10(lo), b = Math.log10(hi);
      if (b - a < 0.3) { a -= 0.15; b += 0.15; }
      var p = (b - a) * pad;
      return [Math.pow(10, a - p), Math.pow(10, b + p)];
    }
    if (hi - lo < 1e-12) { var c = Math.abs(lo) || 1; lo -= c * 0.05; hi += c * 0.05; }
    var q = (hi - lo) * pad;
    return [lo - q, hi + q];
  }

  function XYPlot(canvas, opt) {
    opt = opt || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.margin = opt.margin || { l: 62, r: 14, t: 14, b: 40 };
    this.colors = opt.colors || function () { return { ink: '#333', grid: '#ddd', bg: '#fff', accent: '#c00' }; };
    this.onHover = opt.onHover || null;
    this.data = null;
    this.highlight = null;
    this.mouse = null;
    this.hoverId = null;
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
      self.mouse = [e.clientX - r.left, e.clientY - r.top];
      self.render();
    });
    canvas.addEventListener('pointerleave', function () { self.mouse = null; self.render(); });
    this.resize();
  }

  var P = XYPlot.prototype;

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

  P.setHover = function (id) {
    if (id === this.hoverId) return;
    this.hoverId = id;
    if (this.onHover) this.onHover(id);
  };

  P.render = function () {
    var c = this.ctx, d = this.data, m = this.margin, W = this.W, H = this.H, col = this.colors(), self = this;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    if (!d) return;
    var xs = [], ys = [];
    d.series.forEach(function (s) { s.pts.forEach(function (q) { xs.push(q[0]); ys.push(q[1]); }); });
    (d.points || []).forEach(function (p) { xs.push(p.x); ys.push(p.y); });
    if (!xs.length) {
      c.fillStyle = col.muted || col.ink; c.font = '13px system-ui, sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(d.empty || 'No data yet', W / 2, H / 2);
      this.setHover(null);
      return;
    }
    var xr = d.xRange || range(xs, d.xLog, 0.04), yr = d.yRange || range(ys, d.yLog, 0.08);
    var X = axis(xr[0], xr[1], d.xLog, m.l, W - m.r, Math.max(2, (W - m.l - m.r) / 80));
    var Y = d.yInvert ? axis(yr[0], yr[1], d.yLog, m.t, H - m.b, Math.max(2, (H - m.t - m.b) / 40))
      : axis(yr[0], yr[1], d.yLog, H - m.b, m.t, Math.max(2, (H - m.t - m.b) / 40));
    this.X = X; this.Y = Y;

    c.save();
    c.font = '11px system-ui, sans-serif';
    c.lineWidth = 1;
    /* grid and tick labels */
    X.ticks.forEach(function (t) {
      var x = Math.round(X.px(t.v)) + 0.5;
      c.strokeStyle = col.grid; c.globalAlpha = t.major ? 1 : 0.45;
      c.beginPath(); c.moveTo(x, m.t); c.lineTo(x, H - m.b); c.stroke();
      c.globalAlpha = 1;
      if (t.label) { c.fillStyle = col.ink; c.textAlign = 'center'; c.textBaseline = 'top'; c.fillText(t.label, x, H - m.b + 5); }
    });
    Y.ticks.forEach(function (t) {
      var y = Math.round(Y.px(t.v)) + 0.5;
      c.strokeStyle = col.grid; c.globalAlpha = t.major ? 1 : 0.45;
      c.beginPath(); c.moveTo(m.l, y); c.lineTo(W - m.r, y); c.stroke();
      c.globalAlpha = 1;
      if (t.label) { c.fillStyle = col.ink; c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText(t.label, m.l - 6, y); }
    });
    c.strokeStyle = col.ink;
    c.strokeRect(m.l + 0.5, m.t + 0.5, W - m.l - m.r, H - m.t - m.b);
    c.font = '600 12px system-ui, sans-serif'; c.fillStyle = col.ink;
    c.textAlign = 'center'; c.textBaseline = 'bottom';
    c.fillText(d.xLabel || '', (m.l + W - m.r) / 2, H - 3);
    c.save(); c.translate(14, (m.t + H - m.b) / 2); c.rotate(-Math.PI / 2);
    c.textBaseline = 'middle'; c.fillText(d.yLabel || '', 0, 0); c.restore();

    /* clip to the plotting box */
    c.beginPath(); c.rect(m.l, m.t, W - m.l - m.r, H - m.t - m.b); c.clip();
    function ok(x, y) { return isFinite(x) && isFinite(y) && (!d.xLog || x > 0) && (!d.yLog || y > 0); }
    d.series.forEach(function (s) {
      c.strokeStyle = s.color || col.ink; c.lineWidth = s.width || 1.6; c.setLineDash(s.dash || []);
      c.beginPath();
      var pen = false;
      s.pts.forEach(function (q) {
        if (!ok(q[0], q[1])) { pen = false; return; }
        var px = X.px(q[0]), py = Y.px(q[1]);
        if (pen) c.lineTo(px, py); else c.moveTo(px, py);
        pen = true;
      });
      if (!s.noLine) c.stroke();
      if (s.dots) {
        c.fillStyle = s.color || col.ink;
        s.pts.forEach(function (q) { if (ok(q[0], q[1])) { c.beginPath(); c.arc(X.px(q[0]), Y.px(q[1]), s.dots, 0, 2 * Math.PI); c.fill(); } });
      }
    });
    c.setLineDash([]);
    /* annotations */
    (d.ann || []).forEach(function (a) {
      c.strokeStyle = a.color || col.ink; c.fillStyle = a.color || col.ink;
      c.lineWidth = a.width || 1.3; c.setLineDash(a.dash || []);
      if (a.type === 'line' && ok(a.x0, a.y0) && ok(a.x1, a.y1)) {
        c.beginPath(); c.moveTo(X.px(a.x0), Y.px(a.y0)); c.lineTo(X.px(a.x1), Y.px(a.y1)); c.stroke();
      } else if (a.type === 'vline' && ok(a.x, 1)) {
        var vx = X.px(a.x); c.beginPath(); c.moveTo(vx, m.t); c.lineTo(vx, H - m.b); c.stroke();
      } else if (a.type === 'hline' && ok(1, a.y)) {
        var hy = Y.px(a.y); c.beginPath(); c.moveTo(m.l, hy); c.lineTo(W - m.r, hy); c.stroke();
      } else if (a.type === 'text' && ok(a.x, a.y)) {
        c.setLineDash([]);
        c.font = a.font || '600 12px system-ui, sans-serif';
        c.textAlign = a.align || 'left'; c.textBaseline = a.baseline || 'bottom';
        var tx = X.px(a.x) + (a.dx || 0), ty = Y.px(a.y) + (a.dy || 0);
        c.lineWidth = 3; c.strokeStyle = col.bg; c.strokeText(a.text, tx, ty);
        c.fillText(a.text, tx, ty);
      }
      c.setLineDash([]);
    });
    /* points */
    var near = null, best = 10;
    (d.points || []).forEach(function (p) {
      if (!ok(p.x, p.y)) return;
      var px = X.px(p.x), py = Y.px(p.y), r = p.r || 4.5;
      c.fillStyle = p.ring ? col.bg : (p.color || col.ink);
      c.strokeStyle = p.color || col.ink; c.lineWidth = 1.6;
      c.beginPath(); c.arc(px, py, r, 0, 2 * Math.PI); c.fill(); c.stroke();
      if (self.mouse) {
        var dd = Math.hypot(self.mouse[0] - px, self.mouse[1] - py);
        if (dd < best) { best = dd; near = p; }
      }
    });
    this.setHover(near && near.id != null ? near.id : null);
    var hi = near ? near.id : this.highlight;
    if (hi != null) {
      (d.points || []).forEach(function (p) {
        if (p.id !== hi || !ok(p.x, p.y)) return;
        c.strokeStyle = col.accent; c.lineWidth = 2.5;
        c.beginPath(); c.arc(X.px(p.x), Y.px(p.y), (p.r || 4.5) + 4, 0, 2 * Math.PI); c.stroke();
      });
    }
    c.restore();

    /* tooltip / crosshair readout */
    var lines = null, ax = 0, ay = 0;
    if (near && near.tip) {
      lines = [].concat(near.tip); ax = X.px(near.x); ay = Y.px(near.y);
    } else if (this.mouse && d.readout && this.mouse[0] > m.l && this.mouse[0] < W - m.r && this.mouse[1] > m.t && this.mouse[1] < H - m.b) {
      var xv = X.val(this.mouse[0]), res = d.readout(xv);
      if (res) {
        lines = res.lines; ax = this.mouse[0]; ay = this.mouse[1];
        c.save(); c.strokeStyle = col.ink; c.setLineDash([3, 3]); c.lineWidth = 1;
        c.beginPath(); c.moveTo(ax + 0.5, m.t); c.lineTo(ax + 0.5, H - m.b); c.stroke(); c.restore();
        if (res.y != null && ok(xv, res.y)) {
          c.fillStyle = res.color || col.accent; ay = Y.px(res.y);
          c.beginPath(); c.arc(ax, ay, 3.5, 0, 2 * Math.PI); c.fill();
        }
      }
    }
    if (lines) {
      c.save();
      c.font = '12px system-ui, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'top';
      var tw = 0;
      lines.forEach(function (t) { tw = Math.max(tw, c.measureText(t).width); });
      var bw = tw + 12, bh = lines.length * 15 + 8;
      var bx = ax + 12, by = ay - bh - 8;
      if (bx + bw > W - 2) bx = ax - bw - 12;
      if (by < 2) by = ay + 12;
      if (by + bh > H - 2) by = H - bh - 2;
      c.fillStyle = col.bg; c.globalAlpha = 0.95; c.fillRect(bx, by, bw, bh); c.globalAlpha = 1;
      c.strokeStyle = col.grid; c.strokeRect(bx + 0.5, by + 0.5, bw, bh);
      c.fillStyle = col.ink;
      lines.forEach(function (t, n) { c.font = (n === 0 ? '600 ' : '') + '12px system-ui, sans-serif'; c.fillText(t, bx + 6, by + 5 + n * 15); });
      c.restore();
    }

    /* legend */
    var named = d.series.filter(function (s) { return s.label; });
    if (named.length) {
      c.save();
      c.font = '11px system-ui, sans-serif'; c.textBaseline = 'middle'; c.textAlign = 'left';
      var lw = 0;
      named.forEach(function (s) { lw = Math.max(lw, c.measureText(s.label).width); });
      lw += 30;
      var lx = d.legendLeft ? m.l + 8 : W - m.r - lw - 6, ly = d.legendBottom ? H - m.b - named.length * 14 - 4 : m.t + 10;
      c.fillStyle = col.bg; c.globalAlpha = 0.88;
      c.fillRect(lx - 4, ly - 9, lw + 6, named.length * 14 + 4);
      c.globalAlpha = 1;
      named.forEach(function (s, n) {
        var y = ly + n * 14;
        c.strokeStyle = s.color || col.ink; c.lineWidth = s.width || 1.6; c.setLineDash(s.dash || []);
        c.beginPath(); c.moveTo(lx, y); c.lineTo(lx + 18, y); c.stroke();
        c.setLineDash([]);
        c.fillStyle = col.ink; c.fillText(s.label, lx + 22, y);
      });
      c.restore();
    }
  };

  VLab.XYPlot = XYPlot;
})(window.VLab = window.VLab || {});
