# Authoring worked examples

One file per example produces both renderings:

| | |
|---|---|
| **Slides** | steps revealed one at a time, notes in the right margin |
| **Ebook** | `.fill` / `.ans` become fill-in blanks; everything else is pre-printed |

Nothing is written twice, and the answers never reach `ebook/`.

---

## The governing principle

> **Students write what requires a decision. They read what is bookkeeping.**

A solution is mostly *given to them*. What they fill in is the part where the
physics actually happens — choosing which quantity goes where — not the algebra
in between.

## The four roles

These are the course colour code. There is nothing else to learn.

| Class | Colour | Meaning | Slides | Ebook |
|---|---|---|---|---|
| *(unwrapped)* | black | given / pre-printed scaffolding | written in as its step appears | always visible |
| `.fill` | blue `#000080` | a value the student works out | one reveal step | a blank |
| `.ans` | green `#008000` | what the problem asked for | final reveal step | a boxed blank |
| `.note` | red `#ff0000` | annotation | one reveal step, beside its step | shown in flow |

**Black** carries the `.lead` label, the governing equation in symbolic form, the
`=` chain, and the units — so the route is visible *before* anything is solved.

The two targets differ in *when* the black appears, which is deliberate:

- **Ebook** — pre-printed. The student is reading with the scaffolding already on the page.
- **Slides** — written in progressively. You are building the solution live, so the box
  starts empty and fills under your control.

### Reveal order on slides

One click per element, in document order:

```
step 1 black line -> its .fill -> its .fill -> its .note
step 2 black line -> its .fill -> …
…
result line       -> its .ans  -> its .note
```

About 20 clicks for a six-step example. Everything is written left-to-right rather than
popping in, with a pencil at the leading edge and a chalk sound. Because reveal hides
fragments with `visibility: hidden`, the box is **already full height while empty** — nothing
shifts as it fills.

It is a real typewriter: characters appear one at a time, in reading order, so a line that
wraps types line one and then line two. Speed is in characters per second, so everything
writes at the same pace whatever its length.

```js
solution: {
  sound:          true,
  charsPerSecond: 20    // the one dial. Lower is slower.
}
```

Spaces are free — they cost no time, so words are not padded out by their gaps.

Equations type glyph by glyph like everything else. MathJax CHTML emits one `<mjx-c>` element
per glyph, so no splitting is needed; plain text is split one span per character. Hiding uses
`visibility`, never `display`, so nothing reflows as a line fills in.

## The handwriting face

Solutions are set in **Caveat** — prose and equations alike — which is already this project's
handwriting face (`.atb` blanks in the deck theme, `--hand` in `book.css`).

The woff2 files are **self-hosted** in [assets/fonts/](assets/fonts/) rather than pulled from
Google Fonts, and `ebook_build.py` copies them into `ebook/assets/fonts/`. That is deliberate:
the old SVG figures were lettered in `Gunny Rewritten`, which has no `@font-face` anywhere in
this repo, so they only ever looked right on one machine. Verified with Google Fonts blocked at
the DNS level — the slides render identically. 104 KB for two subsets; Caveat is a variable
font, so one file covers 400–700. Licensed OFL 1.1 ([assets/fonts/OFL.txt](assets/fonts/OFL.txt)).

**One known gap: Greek.** No handwriting font on Google Fonts ships a Greek subset, Caveat
included, so `π`, `γ`, `σ`, `Δ` fall through to MathJax's own TeX face. That is why
`MJXZERO, MJXTEX` stay at the end of the font stack instead of a generic `cursive` — the Greek
letters still render correctly, just not in handwriting.

Maths spacing is slightly airy, because MathJax's advance widths come from its TeX metrics
while the glyphs are drawn in Caveat. It reads better than handwritten prose sitting next to
typeset equations. If you ever want the equations back in the TeX face, delete the
`.sol mjx-c, .sol mjx-math` rule in [assets/solutions.css](assets/solutions.css).

### Written means written

Once an element has finished writing it is retired: it stays on screen permanently, and it is
removed from reveal's stepping (`disabled`). Consequences, all intended:

- Stepping **back** does not un-write anything. On a fully worked slide, back goes to the
  previous slide.
- Stepping **forward** on a fully worked slide goes to the next slide — no clicking through
  twenty fragments to get past work you have already done.
- Leaving a slide and returning leaves it exactly as you left it.

**Blue** is normally two per step: the substitution, then its value.

**Red** is what you would say out loud but not write: unit traps, why *this*
equation, datum conventions, the classic mistake. At most one per step.

Use `class="note book-hide"` to keep a note out of the book.

### Note length, and `data-slide`

On a slide a note sits **beside its own step**, and they all persist. It is in the normal
flow (an inline-block, not absolutely positioned) so the browser wraps it and notes can
never overlap — but that means length costs vertical space, and a slide does not scroll.

**Budget: roughly 110 visible characters.** Longer than that and the solution stops fitting.

When the full explanation is worth keeping for the book, put the short form in `data-slide`:

```html
<span class="note"
  data-slide="<strong>Assumed:</strong> the stone&rsquo;s 1/2&Prime; is its <em>thickness</em>.">
  Two readings of the statement have to be pinned down. A stone "of 1/2 inch" must be its
  thickness — it has to span the full 6&Prime; chamber to seal against the wall. …
</span>
```

The slide shows `data-slide`; the book strips the attribute and shows the full text. Same
single-source split that `data-part` uses. Markup is allowed inside the attribute — but no
double quotes (use `&rsquo;` / `&Prime;` / `&quot;`), since the attribute is double-quoted.

## A complete file

`1D_flow/solutions/ex-5-3.html` — no `<html>`, no `<head>`, no boilerplate:

```html
<div class="sol" data-id="ex-5-3">

  <div class="step">
    <span class="lead">Cross-sectional area</span>
    \(A=\dfrac{\pi d^{2}}{4}=\)
    <span class="fill">\(\dfrac{\pi(7.6)^{2}}{4}\)</span>
    \(=\) <span class="fill">45.4</span> \(\unit{cm^2}\)
  </div>

  <div class="step result">
    <span class="lead">Permeability</span>
    \(k=\dfrac{q}{i\,A}=\) <span class="fill">\(\dfrac{8.78}{4.78\times45.4}\)</span>
    \(=\) <span class="ans">\(4.05\times10^{-2}\)</span> \(\unit{cm/s}\)
  </div>

</div>
```

Put it on a slide with:

```html
<div class='ProblemBox'>
  <div class='Solution' data-src='solutions/ex-5-3.html'></div>
</div>
```

Keep the `ProblemBox` wrapper — it supplies the cream background and the
"📝 Solution:" heading in both the deck and the book.

## Structure

| Class | Use |
|---|---|
| `.sol` | root; `data-id` matches the filename |
| `.step` | one solution line — **one physical quantity obtained**, not one algebraic move. Numbered automatically; never write `1)` yourself |
| `.step.result` | the final line, boxed |
| `.sol-table` | a table of givens or per-layer data |
| `.sol-fig` | a genuine drawing (inline `<svg>` or `<img>`) |
| `.sol-cols` / `.sol-col` | figure beside algebra |
| `.u` | underline annotation |

Six to eight steps is the usual range.

## Maths

Inline `\(...\)`, display `\[...\]`. Shared macros live in
[assets/mathjax-macros.js](assets/mathjax-macros.js) and are available in both
the deck and the book:

`\unit{cm/s}` · `\ee{4.05}{-2}` · `\dd{a}{b}` · `\Gs` `\gw` `\gd` `\gsat`
`\keq` `\kx` `\kz` `\vD` `\vs` `\hp` `\hz` `\ht`

Annotate *inside* an equation with plain MathJax: `\underbrace{x}_{\text{why}}`,
`\xrightarrow{\text{step}}`, `\boxed{}`, `\overset{}{}`, `\underline{}`.

**Three rules that matter:**

1. A value that must become an ebook blank has to be a real
   `<span class="fill">` or `<span class="ans">`. The colour macros
   (`\fillv` `\ansv` `\notev`) tint part of an expression but **cannot** become
   a blank — MathJax renders an expression as one unit.
2. Tables must be HTML (`.sol-table`), not LaTeX arrays, for the same reason.
3. **A blank is never typeset.** Blanks are excluded from MathJax
   (`ignoreHtmlClass: 'blank'`) and are `contenteditable="plaintext-only"`, so
   whatever a student types stays literal — `\dfrac{a}{b}` shows as source, not
   as a fraction. This is by design: the book is meant to be printed and filled
   in by hand, and on screen `pi*7.6^2/4` reads fine.

   It does shape what is worth blanking. A short value (`45.4`, `0.771`) is easy
   to type and easy to write; a long expression is neither. Prefer blanking the
   *result* of a substitution over the substitution itself when the substitution
   is long, and reserve expression blanks for short, memorable ones.

## Examples split across two slides

One file still holds the whole solution. Mark every step, and point both slides
at the same file:

```html
<!-- slide 1 -->  <div class='Solution' data-src='solutions/ex-5-8.html' data-part='1'></div>
<!-- slide 2 -->  <div class='Solution' data-src='solutions/ex-5-8.html' data-part='2'></div>
```

```html
<div class="step" data-part="1"> … </div>
<div class="step" data-part="2"> … </div>
```

Only elements carrying `data-part` are filtered — anything unmarked shows on
every part, which is what you want for a standing note or a shared figure. Step
numbering continues across parts (part 2 starts at 5, not 1).

The book ignores `data-part` and inlines each file **once**, so the solution
reads continuously.

## Naming

Name from the real example number: `solutions/ex-5-3.html`. The legacy SVG
filenames drifted from the example numbers, so do not copy them:

| Example | Legacy SVG | | Example | Legacy SVG |
|---|---|---|---|---|
| 4.10 | `EX4100` | | 5.4 | `EX540` |
| 4.11 | `EX4110` | | 5.5 | `EX550` + `EX551` |
| 4.12 | `EX4120` | | 5.6 | `EX490` + `EX491`, `Example_tubes` |
| 4.13 | `EX4130` + `EX4131` | | 5.7 | `ex570` |
| 5.1 | `EX470` + `EX471` | | 5.8 | `EX4140` + `EX4141` |
| 5.2 | `EX480` + `EX481` | | 5.9 | `EX4150` + `EX4151` |
| 5.3 | `EX530` | | 5.10 | `EX51000` |

Converted so far: **5.3, 5.4, 5.8**.

## Checks

```
python ebook_build.py 1D_flow
```

must print `[VALID]`. It fails the build on a missing `solutions/*.html`, an
unexpanded `.Solution`, a `.fill`/`.ans` that survived into the book, or a
duplicate blank id. It also prints a `[note]` when an answer string appears in
the visible prose — **read those**: they mean the solution gives itself away.
That check caught two leaks in the first three examples written.

Then serve and look at it:

```
python -m http.server 8000
#  slides -> http://localhost:8000/1D_flow/
#  book   -> http://localhost:8000/ebook/1D_flow/
```

Solutions are fetched, so a deck opened over `file://` shows
`⚠ solution not loaded`. That is expected — serve it over http.

**Verify every number.** These solutions are written, not transcribed, so each
`.ans` is a claim. Recompute it independently before committing.

## Still on the old SVG figures

Unconverted examples keep working — `<object class='Animation'>` is untouched.
But note what the book does with them: in these handwritten figures the whole
drawing is built up in steps, so once the step layers are stripped nothing is
left. Those figures are dropped from the book and the empty `ProblemBox` is left
as writing space; the build names them on every run. Converting the example is
the fix.
