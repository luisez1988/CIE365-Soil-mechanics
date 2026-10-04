/* VLab.View — a canvas that maps a world rectangle (x right, y = ELEVATION up)
   onto its container with equal aspect ratio, handles devicePixelRatio and
   resizing, and offers a few drawing helpers shared by every experiment. */
(function (VLab) {
  'use strict';

  function View(canvas, world, opt) {
    opt = opt || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.margin = opt.margin || { l: 52, r: 16, t: 12, b: 42 };
    this.draw = null;
    this.s = 1; this.ox = 0; this.oy = 0; this.dpr = 1;
    var self = this, pending = false;
    function schedule() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; self.resize(); });
    }
    if (window.ResizeObserver) new ResizeObserver(schedule).observe(canvas.parentElement);
    window.addEventListener('resize', schedule);
    this.resize();
  }

  var P = View.prototype;

  P.resize = function () {
    var host = this.canvas.parentElement, m = this.margin, w = this.world;
    var W = Math.max(200, host.clientWidth), H = host.clientHeight;
    var ww = w.xmax - w.xmin, wh = w.ymax - w.ymin;
    if (H < 120) H = Math.round((W - m.l - m.r) * wh / ww) + m.t + m.b;
    var s = Math.min((W - m.l - m.r) / ww, (H - m.t - m.b) / wh);
    this.s = s;
    this.ox = m.l + ((W - m.l - m.r) - s * ww) / 2;
    this.oy = m.t + ((H - m.t - m.b) - s * wh) / 2;
    this.W = W; this.H = H;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = W + 'px';
    this.canvas.style.height = H + 'px';
    this.canvas.width = Math.round(W * this.dpr);
    this.canvas.height = Math.round(H * this.dpr);
    this.cache = null;
    this.render();
  };

  P.sx = function (x) { return this.ox + (x - this.world.xmin) * this.s; };
  P.sy = function (y) { return this.oy + (this.world.ymax - y) * this.s; };
  P.wx = function (px) { return this.world.xmin + (px - this.ox) / this.s; };
  P.wy = function (py) { return this.world.ymax - (py - this.oy) / this.s; };

  P.render = function () {
    var c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.W, this.H);
    if (this.draw) this.draw(c, this);
  };

  /* Rasterise colorAt(x, y) -> [r,g,b] | null over a world rectangle at device
     resolution. Returns an offscreen canvas plus where to blit it (css px). */
  P.raster = function (x0, x1, y0, y1, colorAt) {
    var d = this.dpr, px0 = this.sx(x0), px1 = this.sx(x1), py0 = this.sy(y1), py1 = this.sy(y0);
    var w = Math.max(1, Math.round((px1 - px0) * d)), h = Math.max(1, Math.round((py1 - py0) * d));
    var off = document.createElement('canvas');
    off.width = w; off.height = h;
    var octx = off.getContext('2d'), img = octx.createImageData(w, h), data = img.data;
    for (var r = 0; r < h; r++) {
      var y = y1 - (r + 0.5) / h * (y1 - y0);
      for (var q = 0; q < w; q++) {
        var x = x0 + (q + 0.5) / w * (x1 - x0), rgb = colorAt(x, y), o = (r * w + q) * 4;
        if (!rgb) continue;
        data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; data[o + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    return { canvas: off, x: px0, y: py0, w: px1 - px0, h: py1 - py0 };
  };

  /* Stroke world-space segments [xa, ya, xb, yb, ...]. */
  P.segments = function (c, seg, style) {
    c.save();
    c.strokeStyle = style.color || '#000';
    c.lineWidth = style.width || 1;
    if (style.dash) c.setLineDash(style.dash);
    c.beginPath();
    for (var k = 0; k < seg.length; k += 4) {
      c.moveTo(this.sx(seg[k]), this.sy(seg[k + 1]));
      c.lineTo(this.sx(seg[k + 2]), this.sy(seg[k + 3]));
    }
    c.stroke();
    c.restore();
  };

  P.rect = function (c, x0, y0, x1, y1) {
    var a = this.sx(x0), b = this.sy(y1);
    c.rect(a, b, this.sx(x1) - a, this.sy(y0) - b);
  };

  /* Axes along the plotted rectangle [x0,x1] x [y0,y1]. */
  P.axes = function (c, o) {
    var self = this, ink = o.color || '#333';
    c.save();
    c.strokeStyle = ink; c.fillStyle = ink; c.lineWidth = 1;
    c.font = (o.font || 12) + 'px system-ui, sans-serif';
    var bx = this.sy(o.y0) + 0.5, ly = this.sx(o.x0) - 0.5;
    c.beginPath();
    c.moveTo(this.sx(o.x0), bx); c.lineTo(this.sx(o.x1), bx);
    c.moveTo(ly, this.sy(o.y0)); c.lineTo(ly, this.sy(o.y1));
    c.stroke();
    c.textAlign = 'center'; c.textBaseline = 'top';
    for (var x = o.x0; x <= o.x1 + 1e-9; x += o.dxTick) {
      var px = self.sx(x);
      c.beginPath(); c.moveTo(px, bx); c.lineTo(px, bx + 4); c.stroke();
      c.fillText(String(Math.round(x * 100) / 100), px, bx + 6);
    }
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (var y = o.y0; y <= o.y1 + 1e-9; y += o.dyTick) {
      var py = self.sy(y);
      c.beginPath(); c.moveTo(ly, py); c.lineTo(ly - 4, py); c.stroke();
      c.fillText(String(Math.round(y * 100) / 100), ly - 6, py);
    }
    if (o.xlabel) {
      c.textAlign = 'center'; c.textBaseline = 'top';
      c.fillText(o.xlabel, (this.sx(o.x0) + this.sx(o.x1)) / 2, bx + 22);
    }
    if (o.ylabel) {
      c.translate(ly - 38, (this.sy(o.y0) + this.sy(o.y1)) / 2);
      c.rotate(-Math.PI / 2);
      c.textAlign = 'center'; c.textBaseline = 'bottom';
      c.fillText(o.ylabel, 0, 0);
    }
    c.restore();
  };

  /* Pointer event -> css px and world coordinates. */
  P.at = function (e) {
    var r = this.canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    return { px: px, py: py, x: this.wx(px), y: this.wy(py) };
  };

  VLab.View = View;
})(window.VLab = window.VLab || {});
