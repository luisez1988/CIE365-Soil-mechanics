/* ==========================================================================
   Shared MathJax 3 macros — used by BOTH the reveal.js decks and the ebook,
   so a symbol means the same thing in the lecture and in the notes.

   Load this BEFORE the `window.MathJax = {...}` config block, then reference
   it as `macros: window.SOL_MACROS`.

   Requires a MathJax build with the `color` package (tex-chtml-full has it).
   ========================================================================== */

window.SOL_MACROS = {

  /* ---- role colours, for part of an expression --------------------------
     Wrapping math in <span class="fill"> already colours it (MathJax CHTML
     inherits `color`). Use these only to colour a FRAGMENT of a larger
     expression.

     Note the trade-off: a value coloured with \fillv inside \(...\) CANNOT
     become an ebook blank, because MathJax renders the expression as one
     unit. Anything the student must fill in has to be a real
     <span class="fill">…</span> in the HTML.                              */

  fillv: ['\\textcolor{#000080}{#1}', 1],
  ansv:  ['\\textcolor{#008000}{#1}', 1],
  notev: ['\\textcolor{#ff0000}{#1}', 1],

  /* ---- notation --------------------------------------------------------- */

  unit: ['\\,\\mathrm{#1}', 1],        // \unit{cm/s}      -> thin space + upright
  ee:   ['#1\\times 10^{#2}', 2],      // \ee{4.05}{-2}    -> 4.05 x 10^-2
  dd:   ['\\dfrac{#1}{#2}', 2],        // \dd{q L}{h A}    -> display fraction

  /* ---- soil mechanics symbols ------------------------------------------- */

  Gs:   '{G_s}',
  gw:   '{\\gamma_w}',
  gd:   '{\\gamma_d}',
  gsat: '{\\gamma_{sat}}',
  gsub: "{\\gamma'}",

  keq:  '{k_{eq}}',
  kx:   '{k_x}',
  kz:   '{k_z}',

  vD:   '{v}',                         // Darcy (superficial) velocity
  vs:   '{v_s}',                       // seepage (true) velocity

  hp:   '{h_p}',                       // pressure head
  hz:   '{h_z}',                       // elevation head
  ht:   '{h_t}'                        // total head
};
