/* VLab.Standpipes — virtual piezometers on a VLab.View.
   The tip sits at (x, y=elevation). The water in the pipe rises to the total
   head h at the tip: elevation head z = y, pressure head h_p = h - z,
   pore pressure u = gamma_w * h_p.
   opts: {
     contains(x, y) -> bool      where a tip may be placed
     head(x, y)     -> h         total head at a point (same datum as y)
     gammaW         unit weight of water (kN/m3), default 9.81
     max            maximum number of pipes, default 6
     table          element that receives the readout table (optional)
     onChange(list) after any add / move / remove
     onMode(adding) when add-mode toggles (to update a button label)
   } */
(function (VLab) {
  'use strict';

  var HIT = 11;

  function Standpipes(view, opts) {
    this.view = view;
    this.o = opts;
    this.list = [];
    this.adding = false;
    this.drag = -1;
    var self = this, cv = view.canvas;

    cv.addEventListener('pointerdown', function (e) {
      var p = view.at(e), hit = self.hit(p);
      if (hit >= 0) {
        self.drag = hit;
      } else if (self.adding && opts.contains(p.x, p.y)) {
        self.add(p.x, p.y);
        self.drag = self.list.length - 1;
        self.setAdding(false);
      } else {
        return;
      }
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
    });
    cv.addEventListener('pointermove', function (e) {
      var p = view.at(e);
      if (self.drag >= 0) {
        if (opts.contains(p.x, p.y)) {
          self.list[self.drag].x = p.x;
          self.list[self.drag].y = p.y;
          self.changed();
        }
        return;
      }
      cv.style.cursor = self.hit(p) >= 0 ? 'grab' : (self.adding && opts.contains(p.x, p.y) ? 'crosshair' : '');
    });
    function up() { self.drag = -1; }
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('dblclick', function (e) {
      var hit = self.hit(view.at(e));
      if (hit >= 0) { self.list.splice(hit, 1); self.changed(); }
    });
  }

  var P = Standpipes.prototype;

  P.hit = function (p) {
    var v = this.view;
    for (var k = this.list.length - 1; k >= 0; k--) {
      var q = this.list[k];
      if (Math.abs(v.sx(q.x) - p.px) < HIT && Math.abs(v.sy(q.y) - p.py) < HIT) return k;
    }
    return -1;
  };

  P.add = function (x, y) {
    if (this.list.length >= (this.o.max || 6)) this.list.shift();
    this.list.push({ x: x, y: y });
    this.changed();
  };

  P.clear = function () { this.list = []; this.changed(); };

  P.setAdding = function (on) {
    this.adding = on;
    if (this.o.onMode) this.o.onMode(on);
  };

  P.changed = function () {
    this.table();
    if (this.o.onChange) this.o.onChange(this.list);
  };

  P.values = function (q) {
    var h = this.o.head(q.x, q.y), g = this.o.gammaW || 9.81;
    return { x: q.x, z: q.y, h: h, hp: h - q.y, u: g * (h - q.y) };
  };

  /* Serialise as "x,y;x,y" for the URL hash. */
  P.encode = function () {
    return this.list.map(function (q) { return q.x.toFixed(2) + ',' + q.y.toFixed(2); }).join(';');
  };
  P.decode = function (s) {
    var self = this;
    this.list = [];
    (s || '').split(';').forEach(function (t) {
      var a = t.split(',').map(Number);
      if (a.length === 2 && isFinite(a[0]) && isFinite(a[1]) && self.o.contains(a[0], a[1])) {
        self.list.push({ x: a[0], y: a[1] });
      }
    });
    this.table();
  };

  P.draw = function (c, style) {
    var v = this.view, self = this;
    style = style || {};
    c.save();
    c.font = '600 12px system-ui, sans-serif';
    c.textAlign = 'center';
    this.list.forEach(function (q, n) {
      var val = self.values(q);
      var px = Math.round(v.sx(q.x)) + 0.5, tip = v.sy(q.y), lvl = v.sy(val.h);
      var top = Math.min(lvl, tip) - 26, w = 8;
      /* glass tube */
      c.fillStyle = style.glass || 'rgba(255,255,255,0.55)';
      c.fillRect(px - w / 2, top, w, tip - top);
      /* water column */
      if (lvl < tip) {
        c.fillStyle = style.water || '#1f6fd1';
        c.fillRect(px - w / 2, lvl, w, tip - lvl);
      }
      c.strokeStyle = style.ink || '#111';
      c.lineWidth = 1.25;
      c.strokeRect(px - w / 2, top, w, tip - top);
      /* screened tip */
      c.fillStyle = style.ink || '#111';
      c.fillRect(px - w / 2 - 1, tip - 4, w + 2, 6);
      /* water level marker */
      c.beginPath();
      c.moveTo(px + w / 2 + 3, lvl); c.lineTo(px + w / 2 + 11, lvl - 5); c.lineTo(px + w / 2 + 11, lvl + 5);
      c.closePath();
      c.fillStyle = style.water || '#1f6fd1';
      c.fill();
      /* label */
      var label = 'P' + (n + 1);
      c.fillStyle = style.labelBg || 'rgba(255,255,255,0.9)';
      c.fillRect(px - 13, top - 18, 26, 16);
      c.fillStyle = style.ink || '#111';
      c.fillText(label, px, top - 6);
    });
    c.restore();
  };

  P.table = function () {
    var box = this.o.table;
    if (!box) return;
    if (!this.list.length) {
      box.innerHTML = '<p class="vl-muted">No standpipes yet. Press <b>Add standpipe</b>, then click in the soil. ' +
        'Drag a tip to move it; double-click it to remove.</p>';
      return;
    }
    var self = this, rows = this.list.map(function (q, n) {
      var v = self.values(q);
      return '<tr><td>P' + (n + 1) + '</td><td>' + v.x.toFixed(1) + '</td><td>' + v.z.toFixed(2) +
        '</td><td>' + v.h.toFixed(2) + '</td><td>' + v.hp.toFixed(2) + '</td><td>' + v.u.toFixed(1) + '</td></tr>';
    }).join('');
    box.innerHTML = '<table class="vl-table"><thead><tr><th></th><th>x (m)</th><th>z (m)</th>' +
      '<th>h (m)</th><th>h<sub>p</sub> (m)</th><th>u (kPa)</th></tr></thead><tbody>' + rows + '</tbody></table>';
  };

  VLab.Standpipes = Standpipes;
})(window.VLab = window.VLab || {});
