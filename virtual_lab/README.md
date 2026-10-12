# Virtual Soil Lab

Browser-only interactive models for CIE 365. No build step and no dependencies. These are plain
`<script>` files that share one `window.VLab` namespace, so the pages work from the class server
(`start_class`), from GitHub Pages and from `file://`.

## Layout

```
virtual_lab/
  index.html                     landing page
  core/                          shared, physics-agnostic pieces
    vlab.css                     panel / slider / table styles, light + dark tokens
    grid.js       VLab.Grid2D    node grid, link conductances, fixed-head nodes, walls (cuts), sampling
    laplace.js    VLab.Laplace   steady seepage: SOR + direct (banded Cholesky) solvers,
                                 face fluxes, boundary flux, stream function
    colormap.js   VLab.colormap  continuous + N-band colour maps
    contour.js    VLab.contour   marching squares
    view.js       VLab.View      world<->canvas mapping, raster fill, axes, segments
    controls.js   VLab.Controls  control panel from a schema; VLab.Hash for URL presets
    probes.js     VLab.Standpipes draggable piezometers with h / h_p / u readout
    boussinesq.js VLab.Boussinesq Δσz under point, line, strip, rectangle, triangular and circular
                                 surface loads; influence factors; selfTest() in the console
    plot.js       VLab.Plot      profile line chart; can share an axis with a VLab.View
  experiments/
    sheetpile/                   seepage under a sheet pile (Example 4.18 geometry)
    stress/                      induced vertical stress (Example 6.2/6.3 default scenario)
```

## Embedding in a deck

```html
<iframe src='../virtual_lab/experiments/sheetpile/index.html?embed=1&theme=light'
        width='100%' height='680px' style='border:0;'></iframe>
```

- `?embed=1` hides the page header. `?theme=light|dark` forces a theme.
- Any control can be preset in the hash, for example
  `#hu=42&hd=31&left=noflow&nd=10&fmode=count&nf=5&sp=12,20;45,10`
  (`sp` = standpipe tips as `x,elevation` pairs). The page also writes its current state to the
  hash, so you can set up a scenario, copy the URL and paste it into a slide.

## Model notes (sheet pile)

- 152 × 76 node finite-volume grid. The sheet pile is a cut between the two node columns either
  side of x = 30 m, from 0 to 11 m depth. Heads use a datum at the base of the soil (elevation 0).
- The matrix depends only on which nodes are fixed, so it is factored when a boundary *type*
  changes. Moving a head slider only needs a back-substitution.
- Flow lines are contours of the stream function, built from face fluxes. "Square flow net" uses
  Δψ = k·Δh_band, so each band of the colour map and each flow channel form curvilinear squares.

## Model notes (induced stress)

- Plan view (x, y) holds up to 8 loads; a vertical section A–A′ along x or y shows Δσz(s, z) on a
  161-column node grid. The depth profile and horizontal profile charts borrow the section's
  axis mapping, so they line up with it.
- Closed forms: point (Boussinesq), finite and infinite line, rectangle (corner formula, four signed
  sub-rectangles), infinite strip, infinite triangular strip. Numerical: circle off its axis
  (polar, ρ exact, θ by 128-point midpoint rule) and the finite triangular load (48 thin rectangles).
  `VLab.Boussinesq.selfTest()` checks Example 6.3 (7.19 and 4.74 kPa) and the limiting cases.
- Results belong to the last run. With Auto-run off, changing loads or the section marks them out of
  date until Run; profiles, points and CSV exports always use the last run.
- Hash keys: the panel keys (`sax`, `sec`, `sl`, `zl`, `W`, `D`, `field`, `nb`, `cmap`, `rng`, `rmin`,
  `rmax`, `iso`, `pq`, `contrib`, `auto`), plus
  `ld` = loads as `type,q,cx,cy,angle,B,L,r,inf` joined by `;` (type p, l, s, r, t, c) and
  `pt` = points as `s,z` pairs. Example, a negative rotated rectangle and a point load:
  `#ld=r,-20,0,0,30,3,2,0,0;p,100,2,1,0,0,0,0,0&sax=y&sec=0.5`

## Adding an experiment

1. Create `experiments/<name>/index.html` (copy the sheet-pile shell) and `<name>.js`.
2. Build a `VLab.Grid2D`, cut walls and layers, and fix boundary nodes from the UI state.
3. Describe the controls as a schema for `VLab.Controls` and draw in `view.draw`.
4. Physics other than steady seepage (for example consolidation) gets its own solver file in
   `core/`. Everything else is reused.
