# Writing example solutions — instructions for an AI assistant

You are asked to turn a worked example from a lecture deck into a solution that can be shown on the reveal.js slides and, later, in the interactive ebook.

Solutions are **written from scratch, not transcribed.** The problem statements are already machine-readable text in the deck HTML. Read the problem, solve it yourself, verify the numbers independently, and author the solution with deliberate pedagogic scaffolding. Do not copy an existing figure — the whole point of this work is that the old handwritten SVGs cannot be edited, searched, or turned into fill-in blanks.

---

## The work happens in two phases. Do not run them together.

### Phase 1 — solve it and write the `.md`. **Then stop.**

Produce exactly one file: `<deck>/solutions/ex-5-3.md`. It contains the statement, the assumptions, the full worked solution in LaTeX, the numerical verification, and your scaffolding plan.

**Do not write any `.html`. Do not touch the deck's `index.html`. Do not run the ebook build.** Hand the `.md` back and wait.

This exists so the *engineering* can be checked before any of it is turned into markup. A wrong assumption or a wrong number is cheap to fix in Markdown and expensive to fix once it is wired into a slide.

### Phase 2 — only after an explicit green light

Once the `.md` has been reviewed and approved, and only then:

1. Write `<deck>/solutions/ex-5-3.html` from the approved `.md`, following [SOLUTIONS.md](SOLUTIONS.md).
2. Wire the slide in `<deck>/index.html`.

**Slides only.** Do not run `ebook_build.py` and do not verify the book — publishing to the ebook is a separate step the author does. Your job ends when the slide renders.

If you have not been told the `.md` is approved, you are in Phase 1.

---

## How to write the `.md`

These are the formatting rules. They matter because the file is read and edited by a human, and reflowed text is tedious to fix.

**One paragraph is one line.** Never hard-wrap prose at 80 or 100 columns. Write the whole paragraph on a single long line and let the editor soft-wrap it. The same goes for every list item, every table row, and every blockquote line. The only line breaks in the file are the ones that mean something in Markdown: between paragraphs, between list items, and around headings and code fences.

**All maths in LaTeX, never Unicode.** Write `$\pi d^2/4$`, not `πd²/4`. Write `$1 \times 10^{-3}$`, not `1 × 10⁻³`. Use `$...$` inline and `$$...$$` for a display equation — both render in GitHub and in the VS Code Markdown preview, which is the point: the reviewer should see typeset maths, not source. Prose stays prose; only the maths goes in `$`.

Units belong inside the maths: `$45.4\ \mathrm{cm^2}$`. Symbols in prose are still maths: write "solve for $k$", not "solve for `k`".

**Fill in every heading** in the template below. Write "None" rather than deleting a section.

**Avoid AI writing styles** Do not use parenthical dashing (e.g., Sentence 1 - Aside not- conclusion sentence 1). Avoid words and euphemisms typically used by AI such as "critically" or "This is not just X, it is Y", or "this is where X lives". You can read a junior level geotechnical book to benchmark your language use. 

---

## Procedure for Phase 1

### 1. Get the statement

Find the example in `<deck>/index.html`. Take the statement **verbatim** from its `<div class='textBox'>`; do not paraphrase. Note the legacy `EX….svg` the slide currently points at — it goes in the `.md` for provenance.

Check what the statement depends on:

- **Self-contained** — all data in the text or an HTML table. Proceed.
- **Cross-referenced** — "for the soil in Example 2.7". Find that example first, in whichever deck it lives, and record where you got the values.
- **Figure-dependent** — "in the figure below". The geometry lives *only* inside the handwritten SVG and cannot be read from path data. If the user provides the pdf of the slides, you can get the figure from that file. **Stop and ask** for the dimensions, or render the SVG to PNG and read them off. Do not guess elevations or datums.

### 2. Solve it and verify the numbers

Every value you write is a claim, not a transcription. Compute each one in Python and check the printed value against what you wrote. Check units dimensionally on every step, not just on the answer. Where a later example reuses an earlier result, confirm they agree.

Paste the script's output into the Verification section. If a number cannot be verified, say so there.

### 3. Plan the scaffolding

You are not writing the HTML yet, but you must decide — and record — what will be pre-printed and what the student fills in. The governing rule, from SOLUTIONS.md:

> **Students write what requires a decision. They read what is bookkeeping.**

- **black** (unwrapped) — the step label, the governing equation in symbolic form, the `=` chain, the units. The route is visible before anything is solved.
- **blue** (`.fill`) — the substitution and each intermediate value.
- **green** (`.ans`) — the quantity the problem actually asked for.
- **red** (`.note`) — what you would say out loud but not write: unit traps, why *this* equation, datum conventions, the classic mistake. At most one per step, and keep each under about 110 visible characters.

One step = one physical quantity obtained, not one algebraic move. Six to eight steps is normal.

### 4. Write the `.md` and stop

---

## The `.md` template

````markdown
# Example 5.3 — constant-head permeability test

| | |
|---|---|
| Deck | `1D_flow` |
| Slide | Example 5.3 |
| Replaces | `FiguresGeneral/EX530.svg` |
| Status | draft — awaiting review |

## Statement

> Verbatim from the deck's textBox, on one line however long it is.

## Given / Find

- $d = 7.6\ \mathrm{cm}$, $L = 17.8\ \mathrm{cm}$, $h = 85\ \mathrm{cm}$, $t = 2\ \mathrm{min}$, mass of water $= 1054\ \mathrm{g}$, $T = 20^\circ\mathrm{C}$
- **Find:** $k$

## Assumptions

Anything the statement leaves open, and what you chose, one paragraph per assumption on one line each. If there are none, write "None — the statement is complete." Anything recorded here must also become a red note on the slide in Phase 2.

## Solution

One line of prose naming the governing relation and why it applies, then the steps.

1. Area — $A = \dfrac{\pi d^2}{4} = \dfrac{\pi (7.6)^2}{4} = 45.4\ \mathrm{cm^2}$
2. …
6. Permeability — $k = \dfrac{q}{iA} = \dfrac{8.78}{4.78 \times 45.4} = \mathbf{4.05 \times 10^{-2}\ \mathrm{cm/s}}$

## Verification

The script and its output in a fenced block, then one line stating that each answer was recomputed independently and noting anything that could not be checked.

## Scaffolding decisions

What will be pre-printed, what the student fills in, and why — one line per decision. Call out anything non-obvious, such as a substitution too long to be worth blanking, or a note that will need a `data-slide` short form because the full text exceeds the slide budget.

## Flags

Open questions, ambiguities in the statement, cross-deck dependencies, values worth a second opinion. "None" if genuinely none.
````

---

## Things that are easy to get wrong

These have all bitten before.

1. **Never invent a number.** An illustrative placeholder written before computing is how a wrong answer reaches a slide. Compute first, then write.
2. **Do not restate an answer in a note.** A note that gives away its own blank defeats the exercise. In Phase 2 the ebook build prints `[note] answer text also appears in prose` when this happens; catch it earlier by not doing it.
3. **State ambiguities as assumptions.** Example 5.8's statement says the porous stones are "1/2 inches of diameter", which has to mean *thickness*. That reading changes the answer, so it is an entry under Assumptions and later a red note on the slide.
4. **Sanity-check the magnitude.** A permeability of $10^{-2}\ \mathrm{cm/s}$ is a clean sand; $10^{-8}\ \mathrm{cm/s}$ is a clay. If the result does not match the soil described, re-check the unit conversions before writing it down.

Phase 2 has its own traps — blanks must be real spans, tables must be HTML rather than LaTeX arrays, notes have a length budget. They are in [SOLUTIONS.md](SOLUTIONS.md); read it when you get there.

---

## Where things live

| | |
|---|---|
| Problem statements | `<deck>/index.html`, in a `<div class='textBox'>` above the figure |
| Solutions | `<deck>/solutions/` — every deck already has this folder |
| Shared CSS / plugin / macros | [assets/](assets/) — do not duplicate per deck |
| Format reference (Phase 2) | [SOLUTIONS.md](SOLUTIONS.md) |
| Worked reference | [1D_flow/solutions/](1D_flow/solutions/) |

All 18 decks are already wired for solutions — stylesheet, MathJax 3 with the shared macros, the `RevealSolution` plugin, the `solution:` config block, and an empty `solutions/` folder. Nothing needs setting up before you start.

Name files from the **real example number** (`ex-5-3`), never from the legacy SVG code — those drifted badly: `EX470.svg` is Example 5.1, `EX4140.svg` is Example 5.8.

---

## Remaining work in `1D_flow`

Done: **5.3, 5.4, 5.8**.

| Wave | Examples | Note |
|---|---|---|
| Self-contained | 5.5, 5.10, 4.11, 4.12 | Statement and data already in HTML; no blockers |
| Cross-referenced | 4.10 → Example 4.9; 4.13 → Example 2.7 | Read the referenced example first; record the source |
| Figure-dependent | 5.1, 5.2, 5.6, 5.7, 5.9 | Geometry exists only inside the handwritten SVG — **ask or rasterize before starting** |

Every other deck is wired but has no solutions yet.
