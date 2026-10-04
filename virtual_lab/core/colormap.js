/* VLab.colormap — continuous maps t in [0,1] -> [r,g,b] (0-255) and their
   discrete N-band versions (what matplotlib's contourf(levels=N) shows). */
(function (VLab) {
  'use strict';

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  function hex(h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }

  function ramp(stops) {
    var cs = stops.map(hex), n = cs.length - 1;
    return function (t) {
      t = clamp01(t) * n;
      var i = Math.min(Math.floor(t), n - 1), f = t - i, a = cs[i], b = cs[i + 1];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    };
  }

  var maps = {
    /* matplotlib 'rainbow' (the notebook's cmap) */
    rainbow: function (t) {
      t = clamp01(t);
      return [255 * clamp01(Math.abs(2 * t - 0.5)), 255 * clamp01(Math.sin(Math.PI * t)),
              255 * clamp01(Math.cos(Math.PI / 2 * t))];
    },
    viridis: ramp(['#440154', '#482878', '#3e4989', '#31688e', '#26828e',
                   '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725']),
    RdBu_r: ramp(['#053061', '#2166ac', '#4393c3', '#92c5de', '#d1e5f0', '#f7f7f7',
                  '#fddbc7', '#f4a582', '#d6604d', '#b2182b', '#67001f']),
    Blues: ramp(['#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6',
                 '#4292c6', '#2171b5', '#08519c', '#08306b'])
  };

  /* Colour of band b (0..N-1). */
  function band(name, b, N) {
    var f = maps[name] || maps.rainbow;
    return f(N <= 1 ? 0.5 : b / (N - 1));
  }

  /* Pre-computed lookup for N bands between lo and hi: returns fn(v) -> [r,g,b]. */
  function banded(name, N, lo, hi) {
    var table = [];
    for (var b = 0; b < N; b++) table.push(band(name, b, N).map(Math.round));
    var span = hi - lo || 1;
    return function (v) {
      var b = Math.floor((v - lo) / span * N);
      return table[b < 0 ? 0 : b >= N ? N - 1 : b];
    };
  }

  function css(rgb) { return 'rgb(' + rgb.map(Math.round).join(',') + ')'; }

  VLab.colormap = { maps: maps, band: band, banded: banded, css: css, names: Object.keys(maps) };
})(window.VLab = window.VLab || {});
