/* VLab.Grid2D — structured node grid with link conductances.
   Coordinates: x to the right, z = DEPTH (positive downward), node (i, j) at
   x0 + i*dx, z0 + j*dz. Node id k = j*nx + i.
   Every pair of neighbouring nodes is joined by a link whose conductance is the
   finite-volume transmissivity of the face between them (k * faceLength / spacing;
   faces on the domain edge are half length). A missing (zero) link is a no-flow
   face, so impermeable boundaries come for free and internal walls are "cuts". */
(function (VLab) {
  'use strict';

  function Grid2D(o) {
    this.x0 = o.x0; this.x1 = o.x1; this.z0 = o.z0; this.z1 = o.z1;
    this.nx = o.nx; this.nz = o.nz;
    this.dx = (o.x1 - o.x0) / (o.nx - 1);
    this.dz = (o.z1 - o.z0) / (o.nz - 1);
    this.n = this.nx * this.nz;
    /* horizontal link (i,j)-(i+1,j): index j*(nx-1)+i ; vertical (i,j)-(i,j+1): j*nx+i */
    this.cx = new Float64Array((this.nx - 1) * this.nz);
    this.cz = new Float64Array(this.nx * (this.nz - 1));
    this.cutX = new Uint8Array(this.cx.length);
    this.cutZ = new Uint8Array(this.cz.length);
    this.fixed = new Uint8Array(this.n);
    this.value = new Float64Array(this.n);
    this.setK(1, 1);
  }

  var P = Grid2D.prototype;

  P.x = function (i) { return this.x0 + i * this.dx; };
  P.z = function (j) { return this.z0 + j * this.dz; };
  P.id = function (i, j) { return j * this.nx + i; };

  /* Uniform (optionally anisotropic) conductivity. Cuts are re-applied. */
  P.setK = function (kx, kz) {
    var nx = this.nx, nz = this.nz, dx = this.dx, dz = this.dz, i, j;
    for (j = 0; j < nz; j++) {
      var fh = dz * (j === 0 || j === nz - 1 ? 0.5 : 1);
      for (i = 0; i < nx - 1; i++) {
        var a = j * (nx - 1) + i;
        this.cx[a] = this.cutX[a] ? 0 : kx * fh / dx;
      }
    }
    for (j = 0; j < nz - 1; j++) {
      for (i = 0; i < nx; i++) {
        var fw = dx * (i === 0 || i === nx - 1 ? 0.5 : 1);
        var b = j * nx + i;
        this.cz[b] = this.cutZ[b] ? 0 : kz * fw / dz;
      }
    }
  };

  /* Thin impermeable vertical wall at x = xc between depths zTop and zBot.
     Cuts every horizontal link that crosses xc and whose face overlaps the wall.
     Returns the column pair and the effective tip depth (face edge). */
  P.cutVertical = function (xc, zTop, zBot) {
    var nx = this.nx, i = Math.floor((xc - this.x0) / this.dx);
    i = Math.max(0, Math.min(nx - 2, i));
    var last = -1, first = -1;
    for (var j = 0; j < this.nz; j++) {
      var zc = this.z(j);
      var top = j === 0 ? zc : zc - this.dz / 2;
      if (top < zBot - 1e-9 && zc + this.dz / 2 > zTop + 1e-9) {
        var a = j * (nx - 1) + i;
        this.cutX[a] = 1; this.cx[a] = 0;
        if (first < 0) first = j;
        last = j;
      }
    }
    return {
      iLeft: i, iRight: i + 1, jFrom: first, jTo: last,
      xLeft: this.x(i), xRight: this.x(i + 1),
      zTip: last < 0 ? zTop : Math.min(this.z1, this.z(last) + this.dz / 2)
    };
  };

  /* Thin impermeable horizontal layer at depth zc between x = xA and xB (future use). */
  P.cutHorizontal = function (zc, xA, xB) {
    var nx = this.nx, j = Math.floor((zc - this.z0) / this.dz);
    j = Math.max(0, Math.min(this.nz - 2, j));
    for (var i = 0; i < nx; i++) {
      var xcn = this.x(i);
      if (xcn + this.dx / 2 > xA && xcn - this.dx / 2 < xB) {
        var b = j * nx + i;
        this.cutZ[b] = 1; this.cz[b] = 0;
      }
    }
  };

  P.clearFixed = function () {
    this.fixed.fill(0);
    this.value.fill(0);
  };

  P.fix = function (i, j, v) {
    var k = j * this.nx + i;
    this.fixed[k] = 1;
    this.value[k] = v;
  };

  /* Bilinear sample of a nodal field at (x, depth z). Inside a cell crossed by a
     cut the value is taken from the nearer side, so walls stay sharp. */
  P.sample = function (f, x, z) {
    var nx = this.nx, nz = this.nz;
    var fx = (x - this.x0) / this.dx, fz = (z - this.z0) / this.dz;
    if (fx < 0) fx = 0; else if (fx > nx - 1) fx = nx - 1;
    if (fz < 0) fz = 0; else if (fz > nz - 1) fz = nz - 1;
    var i = Math.min(Math.floor(fx), nx - 2), j = Math.min(Math.floor(fz), nz - 2);
    var tx = fx - i, tz = fz - j;
    if (this.cutX[j * (nx - 1) + i] || this.cutX[(j + 1) * (nx - 1) + i]) tx = tx < 0.5 ? 0 : 1;
    if (this.cutZ[j * nx + i] || this.cutZ[j * nx + i + 1]) tz = tz < 0.5 ? 0 : 1;
    var k = j * nx + i;
    var a = f[k], b = f[k + 1], c = f[k + nx], d = f[k + nx + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };

  /* True when the grid cell (i, j)-(i+1, j+1) touches a cut link. */
  P.cellCut = function (i, j) {
    var nx = this.nx;
    return !!(this.cutX[j * (nx - 1) + i] || this.cutX[(j + 1) * (nx - 1) + i] ||
              this.cutZ[j * nx + i] || this.cutZ[j * nx + i + 1]);
  };

  VLab.Grid2D = Grid2D;
})(window.VLab = window.VLab || {});
