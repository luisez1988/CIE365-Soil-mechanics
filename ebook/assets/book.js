/* Interactive course ebook — blanks + sticky-notes + drawing runtime.
   Everything is stored per-chapter in localStorage:
     "ebook:answers:<dir>"  -> { blankId: text }
     "ebook:notes:<dir>"    -> [ {id, anchor, x, y, text} ]
     "ebook:draw:<dir>"     -> [ {id, anchor, fig, tool, color, w, pts} ]
   Nothing is ever sent to a server. */
(function () {
  'use strict';

  var APREFIX = 'ebook:answers:';
  var NPREFIX = 'ebook:notes:';
  var DPREFIX = 'ebook:draw:';
  /* Pen preferences live outside DPREFIX on purpose: the TOC export scans
     localStorage by prefix, so a key under "ebook:draw:" would be exported as
     a phantom chapter named "prefs". */
  var PENKEY = 'ebook:pen';
  var page = document.body.getAttribute('data-page');
  var CODE = document.body.getAttribute('data-course-code') || 'course';

  function store() {
    try {
      localStorage.setItem('ebook:test', '1');
      localStorage.removeItem('ebook:test');
      return localStorage;
    } catch (e) {
      return null;
    }
  }
  var LS = store();

  function loadJSON(key, fallback) {
    if (!LS) return fallback;
    try {
      return JSON.parse(LS.getItem(key) || JSON.stringify(fallback));
    } catch (e) {
      return fallback;
    }
  }

  /* Returns false when the write did not happen — either storage is
     unavailable or the 5 MB per-origin quota is full. Callers that can lose
     work (drawings) check this; the older ones ignore it, as before. */
  function saveJSON(key, value) {
    if (!LS) return false;
    try {
      LS.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* A backup entry may be the old flat answers map or {answers, notes, drawings}.
     Files written before drawings existed simply yield an empty list. */
  function unpackEntry(entry) {
    if (entry && typeof entry === 'object' &&
        (entry.answers || entry.notes || entry.drawings)) {
      return {
        answers: entry.answers || {},
        notes: entry.notes || [],
        drawings: entry.drawings || []
      };
    }
    return { answers: entry || {}, notes: [], drawings: [] };
  }

  /* Merge two lists of {id, ...} records, incoming winning on collision.
     Used for both sticky notes and drawings. */
  function mergeById(existing, incoming) {
    var byId = {};
    existing.forEach(function (n) { byId[n.id] = n; });
    (incoming || []).forEach(function (n) {
      if (n && n.id) byId[n.id] = n;
    });
    return Object.keys(byId).map(function (k) { return byId[k]; });
  }

  /* Mobile Safari/Chrome bug: a `position: sticky` element that was
     `display:none` while the page was scrolled past its normal spot does not
     always reposition itself when it becomes visible again -- it renders
     wherever it would sit in normal flow (off-screen, above the fold) until
     the next scroll event forces a recompute. That is what made the toolbar
     and draw palette seem to "vanish" until scrolling back up. A same-frame
     1px scroll nudge forces the recompute without a visible jump. */
  function nudgeSticky() {
    var y = window.scrollY;
    window.scrollTo(0, y + 1);
    window.scrollTo(0, y);
  }

  /* MathJax is loaded async, so a caller can land before it is ready. Wait for
     its startup promise rather than silently skipping typeset. Module-level
     because both the Q&A feed and the symbol-bar preview need it -- it used to
     live inside initQA, which returns early when Q&A is switched off. */
  function typesetMath(node) {
    return new Promise(function (resolve) {
      var tries = 0;
      (function attempt() {
        var mj = window.MathJax;
        if (mj && mj.startup && mj.startup.promise) {
          resolve(mj.startup.promise.then(function () {
            return mj.typesetPromise([node]);
          }));
          return;
        }
        if (++tries < 100) { setTimeout(attempt, 100); } else { resolve(); }
      })();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Friendly math -> TeX, for the symbol bar's preview ONLY.            */
  /*                                                                     */
  /* What a student types stays exactly as typed: blanks are plaintext   */
  /* and MathJax is told to skip them (ignoreHtmlClass:'blank'). This    */
  /* converts a COPY into TeX so the preview can show what it means.     */
  /* Nothing here is ever written back into a blank.                     */
  /* ------------------------------------------------------------------ */

  var TEX_UNI = {
    'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta',
    'ε': '\\epsilon', 'ζ': '\\zeta', 'η': '\\eta', 'θ': '\\theta',
    'λ': '\\lambda', 'μ': '\\mu', 'µ': '\\mu', 'ν': '\\nu', 'ξ': '\\xi',
    'π': '\\pi', 'ρ': '\\rho', 'σ': '\\sigma', 'τ': '\\tau', 'φ': '\\phi',
    'χ': '\\chi', 'ψ': '\\psi', 'ω': '\\omega',
    'Δ': '\\Delta', 'Γ': '\\Gamma', 'Σ': '\\Sigma', 'Ω': '\\Omega',
    'Φ': '\\Phi', 'Θ': '\\Theta', 'Λ': '\\Lambda',
    '×': '\\times', '·': '\\cdot', '÷': '\\div', '≈': '\\approx',
    '≤': '\\le', '≥': '\\ge', '±': '\\pm', '≠': '\\neq', '∞': '\\infty',
    '°': '^\\circ', '′': "'", '√': '\\surd'
  };

  var TEX_WORDS = [
    'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta',
    'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma', 'tau', 'phi', 'chi',
    'psi', 'omega',
    'Delta', 'Gamma', 'Sigma', 'Omega', 'Phi', 'Theta', 'Lambda',
    'sinh', 'cosh', 'tanh', 'sin', 'cos', 'tan', 'log', 'ln', 'exp',
    'max', 'min'
  ];

  /* Multi-character units only. A bare "m" is a variable at least as often as
     it is a metre, so single-letter units are never detected. */
  var TEX_UNITS = ['kN/m^3', 'kN/m3', 'g/cm^3', 'kg/m^3', 'cm/s^2', 'cm/s',
                   'm/s', 'kPa', 'MPa', 'kN', 'mm'];

  var SUP_CHARS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  var SUB_CHARS = '₀₁₂₃₄₅₆₇₈₉';

  function reEscape(s) { return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'); }

  /* One combined left-to-right pass over Unicode symbols AND ASCII words.
     It must be a single pass: replacing them in sequence would let a later
     rule re-match an earlier rule's output (`\mu` -> `\\mu`, since `\` counts
     as a word boundary). String.replace never rescans what it just wrote. */
  var TOKEN_RE = (function () {
    var parts = Object.keys(TEX_UNI).map(reEscape);
    parts = parts.concat(TEX_WORDS.slice().sort(function (a, b) {
      return b.length - a.length;             // "sinh" must beat "sin"
    }).map(function (w) { return '\\b' + w + '\\b'; }));
    return new RegExp(parts.join('|'), 'g');
  })();

  function texToken(m) {
    return Object.prototype.hasOwnProperty.call(TEX_UNI, m) ? TEX_UNI[m] : '\\' + m;
  }

  /* Index of the ')' matching the '(' at i, or -1. */
  function matchParen(s, i) {
    var depth = 0;
    for (var j = i; j < s.length; j++) {
      if (s.charAt(j) === '(') depth++;
      else if (s.charAt(j) === ')') { depth--; if (!depth) return j; }
    }
    return -1;
  }

  function sqrtify(s) {
    var k = s.indexOf('sqrt(');
    if (k < 0) return s;
    var end = matchParen(s, k + 4);
    if (end < 0) return s;
    return s.slice(0, k) + '\\sqrt{' + sqrtify(s.slice(k + 5, end)) + '}' +
           sqrtify(s.slice(end + 1));
  }

  /* Only an explicit (...)/(...) becomes a fraction. A general a/b rule would
     wreck "kN/m^3" and silently turn "1/2*3" into 1/(2*3). The a/b key on the
     palette inserts the parentheses, which teaches the convention in one tap. */
  function fracify(s) {
    for (var i = 0; i < s.length; i++) {
      if (s.charAt(i) !== '(') continue;
      var a = matchParen(s, i);
      if (a < 0) return s;
      if (s.charAt(a + 1) !== '/' || s.charAt(a + 2) !== '(') { i = a; continue; }
      var b = matchParen(s, a + 2);
      if (b < 0) return s;
      return s.slice(0, i) +
             '\\frac{' + fracify(s.slice(i + 1, a)) + '}' +
             '{' + fracify(s.slice(a + 3, b)) + '}' +
             fracify(s.slice(b + 1));
    }
    return s;
  }

  function balanced(s, open, close) {
    var d = 0;
    for (var i = 0; i < s.length; i++) {
      if (s.charAt(i) === open) d++;
      else if (s.charAt(i) === close) { if (--d < 0) return false; }
    }
    return d === 0;
  }

  function texAllowed(s) {
    var allow = {};
    TEX_WORDS.concat(['frac', 'sqrt', 'surd', 'cdot', 'times', 'div', 'approx',
      'le', 'ge', 'pm', 'neq', 'infty', 'circ', 'mathrm', 'text',
      'left', 'right']).forEach(function (w) { allow[w] = true; });
    Object.keys(window.SOL_MACROS || {}).forEach(function (w) { allow[w] = true; });
    var m, re = /\\([A-Za-z]+)/g;
    while ((m = re.exec(s))) { if (!allow[m[1]]) return false; }
    return true;
  }

  /* True when there is something worth rendering. A bare number or a one-word
     answer gets no preview -- an empty bar row is quieter than a pointless one. */
  function isMathy(src) {
    return /[_^*\\√]/.test(src) ||
           /[Ͱ-Ͽ°±µ×÷′≈≤≥≠∞]/.test(src) ||
           new RegExp('[' + SUP_CHARS + SUB_CHARS + ']').test(src) ||
           /\b(sqrt|sin|cos|tan|log|ln|exp)\b/.test(src) ||
           /\)\s*\/\s*\(/.test(src) ||            // the explicit (a)/(b) fraction
           /\d\s*\/\s*[(\d]/.test(src);
  }

  /* Returns TeX, or null meaning "show nothing". Never throws, and never
     returns something that would make MathJax draw a red error box. */
  function friendlyTeX(src) {
    var s = (src || '').trim();
    if (!s || /^[\d.,\s%+-]*$/.test(s)) return null;   // plain number: no preview
    if (!isMathy(s)) return null;

    if (s.indexOf('\\') >= 0) {
      // Already LaTeX -- a student who knows it keeps working, macros included.
      s = s.replace(/^\\\(([\s\S]*)\\\)$/, '$1')
           .replace(/^\$\$?([\s\S]*?)\$\$?$/, '$1').trim();
    } else {
      // Unicode scripts pasted from a PDF: collapse runs so D₆₀ is one group.
      s = s.replace(new RegExp('[' + SUB_CHARS + ']+', 'g'), function (run) {
        return '_{' + run.replace(/./g, function (c) { return String(SUB_CHARS.indexOf(c)); }) + '}';
      }).replace(new RegExp('[' + SUP_CHARS + ']+', 'g'), function (run) {
        return '^{' + run.replace(/./g, function (c) { return String(SUP_CHARS.indexOf(c)); }) + '}';
      });

      s = s.replace(TOKEN_RE, texToken);
      s = sqrtify(s);
      s = fracify(s);

      TEX_UNITS.forEach(function (u) {
        s = s.replace(new RegExp('(^|[\\d}\\s])' + reEscape(u) + '\\b', 'g'),
                      '$1\\,\\mathrm{' + u + '}');
      });

      // Multi-character scripts need braces; single characters do not.
      s = s.replace(/_([+-][A-Za-z0-9.]+|[A-Za-z0-9.]{2,})/g, '_{$1}')
           .replace(/\^([+-][A-Za-z0-9.]+|[A-Za-z0-9.]{2,})/g, '^{$1}');

      s = s.replace(/\*/g, '\\cdot ').replace(/(^|[^\\])%/g, '$1\\%');
    }

    if (!balanced(s, '{', '}') || !balanced(s, '(', ')')) return null;
    if (/\\$/.test(s)) return null;
    if (!texAllowed(s)) return null;
    return s;
  }

  /* Insert at the caret of a contenteditable host, optionally backing the caret
     up `back` characters so a key like "sqrt()" lands you inside the brackets. */
  function insertAtCaret(host, text, back) {
    var ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
    if (!ok) {
      var sel = window.getSelection();
      if (sel && sel.rangeCount && host.contains(sel.getRangeAt(0).startContainer)) {
        var r = sel.getRangeAt(0);
        r.deleteContents();
        var node = document.createTextNode(text);
        r.insertNode(node);
        r.setStartAfter(node);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
      } else {
        host.textContent += text;
      }
    }
    if (back > 0) {
      var s2 = window.getSelection();
      if (s2 && s2.rangeCount) {
        var r2 = s2.getRangeAt(0);
        try {
          r2.setStart(r2.startContainer, Math.max(0, r2.startOffset - back));
          r2.collapse(true);
          s2.removeAllRanges();
          s2.addRange(r2);
        } catch (e) { /* caret stays put; not fatal */ }
      }
    }
    // execCommand does not always fire `input`, and the fallbacks never do.
    host.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function download(filename, obj) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  function today() {
    return new Date().toISOString().slice(0, 10).replace(/-/g, '');
  }

  /* ------------------------------------------------------------------ */
  /* Chapter page                                                        */
  /* ------------------------------------------------------------------ */
  if (page === 'chapter') {
    var chapter = document.body.getAttribute('data-chapter');
    var blanks = Array.prototype.slice.call(document.querySelectorAll('.blank'));
    var saveTimer = null;
    var notesTimer = null;
    var notes = loadJSON(NPREFIX + chapter, []);
    var drawings = loadJSON(DPREFIX + chapter, []);

    var progCount = document.getElementById('prog-count');
    var progFill = document.getElementById('prog-fill');

    /* ---------------- blanks ---------------- */

    function updateProgress() {
      var filled = 0;
      blanks.forEach(function (b) {
        var has = b.textContent.trim().length > 0;
        if (has) filled++;
        b.classList.toggle('filled', has);
      });
      if (progCount) progCount.textContent = String(filled);
      if (progFill) {
        progFill.style.width = blanks.length
          ? (100 * filled / blanks.length).toFixed(1) + '%' : '0';
      }
    }

    function collect() {
      // preserve saved answers whose blanks are not on this build of the page
      var answers = loadJSON(APREFIX + chapter, {});
      blanks.forEach(function (b) {
        var bid = b.getAttribute('data-bid');
        var txt = b.textContent.trim();
        if (txt) { answers[bid] = txt; } else { delete answers[bid]; }
      });
      return answers;
    }

    function scheduleSave() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        saveJSON(APREFIX + chapter, collect());
      }, 400);
    }

    function applyAnswers(answers) {
      var matched = 0;
      blanks.forEach(function (b) {
        var bid = b.getAttribute('data-bid');
        if (Object.prototype.hasOwnProperty.call(answers, bid)) {
          b.textContent = answers[bid];
          matched++;
        }
      });
      updateProgress();
      return matched;
    }

    applyAnswers(loadJSON(APREFIX + chapter, {}));

    /* Move focus to the neighbouring blank in document order. In a sieve-analysis
       table that is 40+ cells, so blurring on Enter (what this used to do) meant
       re-tapping a ~20px target for every value. `blanks` is a static snapshot,
       which is exactly the stable document-order index this wants. */
    function focusNeighbour(b, step) {
      var next = blanks[blanks.indexOf(b) + step];
      if (!next) { b.blur(); return; }
      next.focus();
      if (next.scrollIntoView) next.scrollIntoView({ block: 'center' });
    }

    blanks.forEach(function (b) {
      /* iOS otherwise capitalises and autocorrects short answers -- it turns
         "gamma" into "Gamma" and mangles unit tokens. Set at runtime rather than
         in the build so every already-generated chapter gets it too. */
      b.setAttribute('autocapitalize', 'off');
      b.setAttribute('autocorrect', 'off');
      b.setAttribute('autocomplete', 'off');
      b.setAttribute('enterkeyhint', 'next');

      b.addEventListener('input', function () {
        updateProgress();
        scheduleSave();
      });
      b.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          focusNeighbour(b, e.shiftKey ? -1 : 1);
        }
      });
      // plain-text paste fallback for browsers without contenteditable="plaintext-only"
      b.addEventListener('paste', function (e) {
        e.preventDefault();
        var text = (e.clipboardData || window.clipboardData).getData('text/plain');
        if (document.queryCommandSupported && document.queryCommandSupported('insertText')) {
          document.execCommand('insertText', false, text);
        } else {
          b.textContent += text;
        }
        updateProgress();
        scheduleSave();
      });
      b.addEventListener('blur', function () {
        saveJSON(APREFIX + chapter, collect());
      });
    });

    /* ---------------- sticky notes ---------------- */

    function saveNotesNow() {
      saveJSON(NPREFIX + chapter, notes);
    }

    function scheduleNotesSave() {
      if (notesTimer) clearTimeout(notesTimer);
      notesTimer = setTimeout(saveNotesNow, 400);
    }

    function blockFor(anchor) {
      return document.querySelector('.block[data-anchor="' + anchor + '"]') ||
             document.querySelector('.block');
    }

    function positionNote(el, n) {
      el.style.left = (n.x * 100) + '%';
      el.style.top = n.y + 'px';
    }

    function dropNote(el, n, viewLeft, viewTop) {
      var probeY = viewTop + 12;
      var target = null;
      Array.prototype.forEach.call(document.querySelectorAll('.block'), function (b) {
        var r = b.getBoundingClientRect();
        if (probeY >= r.top && probeY <= r.bottom) target = b;
      });
      var host = target || el.parentNode;
      if (host !== el.parentNode) host.appendChild(el);
      var hr = host.getBoundingClientRect();
      var x = (viewLeft - hr.left) / Math.max(1, hr.width);
      x = Math.max(0, Math.min(x, 1 - el.offsetWidth / Math.max(1, hr.width)));
      n.anchor = host.getAttribute('data-anchor') || host.id;
      n.x = x;
      n.y = Math.max(0, viewTop - hr.top);
      positionNote(el, n);
      saveNotesNow();
    }

    function wireNote(el, n) {
      var body = el.querySelector('.fnote-body');
      var bar = el.querySelector('.fnote-bar');

      body.addEventListener('input', function () {
        n.text = body.textContent;
        scheduleNotesSave();
      });
      body.addEventListener('paste', function (e) {
        e.preventDefault();
        var text = (e.clipboardData || window.clipboardData).getData('text/plain');
        if (document.queryCommandSupported && document.queryCommandSupported('insertText')) {
          document.execCommand('insertText', false, text);
        } else {
          body.textContent += text;
        }
        n.text = body.textContent;
        scheduleNotesSave();
      });
      body.addEventListener('blur', saveNotesNow);

      el.querySelector('.fnote-del').addEventListener('click', function () {
        if (n.text && n.text.trim() && !confirm('Delete this note?')) return;
        var i = notes.indexOf(n);
        if (i !== -1) notes.splice(i, 1);
        el.parentNode.removeChild(el);
        saveNotesNow();
      });

      bar.addEventListener('pointerdown', function (e) {
        if (e.target.classList.contains('fnote-del')) return;
        e.preventDefault();
        var rect = el.getBoundingClientRect();
        var offX = e.clientX - rect.left;
        var offY = e.clientY - rect.top;
        el.classList.add('dragging');
        bar.setPointerCapture(e.pointerId);

        function onMove(ev) {
          var hr = el.parentNode.getBoundingClientRect();
          el.style.left = (ev.clientX - offX - hr.left) + 'px';
          el.style.top = (ev.clientY - offY - hr.top) + 'px';
        }
        function onUp(ev) {
          bar.removeEventListener('pointermove', onMove);
          bar.removeEventListener('pointerup', onUp);
          bar.removeEventListener('pointercancel', onUp);
          el.classList.remove('dragging');
          dropNote(el, n, ev.clientX - offX, ev.clientY - offY);
        }
        bar.addEventListener('pointermove', onMove);
        bar.addEventListener('pointerup', onUp);
        bar.addEventListener('pointercancel', onUp);
      });
    }

    function renderNote(n) {
      var host = blockFor(n.anchor);
      if (!host) return null;
      var el = document.createElement('div');
      el.className = 'fnote';
      el.setAttribute('data-nid', n.id);
      el.innerHTML =
        '<div class="fnote-bar"><span class="fnote-grip" title="Drag to move">⠀⠿</span>' +
        '<button class="fnote-del" type="button" title="Delete note">✕</button></div>' +
        '<div class="fnote-body" contenteditable="plaintext-only" spellcheck="true"></div>';
      el.querySelector('.fnote-body').textContent = n.text || '';
      host.appendChild(el);
      positionNote(el, n);
      wireNote(el, n);
      return el;
    }

    function renderAllNotes() {
      Array.prototype.forEach.call(document.querySelectorAll('.fnote'), function (el) {
        el.parentNode.removeChild(el);
      });
      notes.forEach(renderNote);
    }

    function addNote() {
      var mid = window.innerHeight / 2;
      var best = null;
      var bestDist = Infinity;
      Array.prototype.forEach.call(document.querySelectorAll('.block'), function (b) {
        var r = b.getBoundingClientRect();
        var d = (mid >= r.top && mid <= r.bottom)
          ? 0 : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid));
        if (d < bestDist) { bestDist = d; best = b; }
      });
      if (!best) return;
      var hr = best.getBoundingClientRect();
      var n = {
        id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        anchor: best.getAttribute('data-anchor') || best.id,
        x: 0.55,
        y: Math.max(10, mid - hr.top - 30),
        text: ''
      };
      notes.push(n);
      var el = renderNote(n);
      saveNotesNow();
      if (el) el.querySelector('.fnote-body').focus();
    }

    renderAllNotes();
    document.getElementById('btn-addnote').addEventListener('click', addNote);

    /* ---------------- drawings ---------------- */

    /* Student marks are SVG shapes in an overlay attached to a host element —
       the <figure> the mark was drawn on, or the .block when it was not on one.
       Coordinates are fractions of the host's WIDTH in BOTH axes, and the
       surface's fixed viewBox/preserveAspectRatio pair makes the renderer scale
       both axes by that width. Geometry is therefore written once and never
       recomputed: window resize, MathJax typesetting, lazy images and the print
       relayout all come out right with no JavaScript involved. */

    var SVGNS = 'http://www.w3.org/2000/svg';
    var DOT_RATIO = 2.6;   // dot diameter as a multiple of stroke width
    var TAP_SLOP = 4;      // px of travel still counted as a tap, not a drag
    var UNDO_MAX = 50;
    var INK_MIN_STEP = 0.0015;  // min gap between kept ink samples, host widths
    var INK_EPS = 0.002;        // Douglas-Peucker tolerance, host widths

    var HINTS = {
      point: 'Click to place a point.',
      line: 'Press and drag to draw a line. Hold Shift to snap the angle.',
      arrow: 'Press and drag; the arrowhead lands where you let go. Shift snaps the angle.',
      circle: 'Press at the centre and drag out to the radius.',
      ink: 'Press and draw freehand.',
      erase: 'Click or drag across a mark to erase it.'
    };

    var drawTimer = null;
    var drawMode = false;
    var drawTool = 'point';
    var drawColor = '#cc0000';
    var drawW = 3;
    var fingerDraw = false;
    var drawUndo = [];
    var drawQuotaWarned = false;
    var drawHint = null;   // set by initDrawing; stays null on older chapters

    /* ---- storage ---- */

    function setHint(msg) {
      // once storage has failed that warning stays put; it matters more
      if (drawHint && !drawQuotaWarned) drawHint.textContent = msg;
    }

    function saveDrawNow() {
      if (!LS) return true;   // private browsing: marks work for this session
      if (saveJSON(DPREFIX + chapter, drawings)) return true;
      /* Quota is full. Roll back to what is actually on disk so the screen
         never shows marks that would vanish on reload. */
      drawings = loadJSON(DPREFIX + chapter, []);
      drawUndo = [];
      renderAllDrawings();
      if (!drawQuotaWarned && drawHint) {
        // written directly: setHint refuses to overwrite this warning later
        drawHint.textContent = 'Storage is full — that mark was not saved. Use ' +
          '"Save notes" to back up your work, then "Clear" a chapter you have finished.';
      }
      drawQuotaWarned = true;
      return false;
    }

    function scheduleDrawSave() {
      if (drawTimer) clearTimeout(drawTimer);
      drawTimer = setTimeout(saveDrawNow, 400);
    }

    function newDrawId() {
      return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    function rnd(v) {
      return Math.round(v * 10000) / 10000;
    }

    /* ---- hosts and surfaces ---- */

    /* A figure is keyed by its image filename, which is stable across rebuilds
       and survives the figure moving inside its block — more robust than a
       positional index. Repeats within one block get -2, -3, ... */
    function figKey(fig) {
      var img = fig.querySelector('img');
      var src = img ? (img.getAttribute('src') || '') : '';
      var name = src.split('/').pop().split('?')[0].replace(/\.[a-z0-9]+$/i, '');
      return name || 'fig';
    }

    function indexFigures(block) {
      if (block.getAttribute('data-figs')) return;
      block.setAttribute('data-figs', '1');
      var seen = {};
      Array.prototype.forEach.call(block.querySelectorAll('figure'), function (fig) {
        var key = figKey(fig);
        seen[key] = (seen[key] || 0) + 1;
        fig.setAttribute('data-fig', seen[key] > 1 ? key + '-' + seen[key] : key);
      });
    }

    /* Falls back to the block when a figure key no longer exists after a
       rebuild: the mark is then misplaced but still visible and erasable,
       which beats losing it silently. */
    function hostFor(d) {
      var block = blockFor(d.anchor);
      if (!block || !d.fig) return block;
      indexFigures(block);
      var figs = block.querySelectorAll('figure');
      for (var i = 0; i < figs.length; i++) {
        if (figs[i].getAttribute('data-fig') === d.fig) return figs[i];
      }
      return block;
    }

    function anchorOf(host) {
      var block = host.closest('.block');
      return block ? (block.getAttribute('data-anchor') || block.id) : '';
    }

    function figOf(host) {
      return host.nodeName.toLowerCase() === 'figure'
        ? (host.getAttribute('data-fig') || undefined) : undefined;
    }

    /* Direct children only — a block containing an annotated figure must not
       pick up that figure's surface. */
    function findSurface(host) {
      var kids = host.children;
      for (var i = 0; i < kids.length; i++) {
        if (kids[i].nodeName.toLowerCase() === 'svg' &&
            kids[i].getAttribute('class') === 'dsurf') return kids[i];
      }
      return null;
    }

    /* viewBox "0 0 1 1000" with "slice" gives a uniform scale of
       max(width / 1, height / 1000). No host is 1000x taller than it is wide,
       so that is always the host width — one user unit = one host width, in
       both axes, permanently, with no state to keep fresh. */
    function surfaceFor(host) {
      var surf = findSurface(host);
      if (surf) return surf;
      surf = document.createElementNS(SVGNS, 'svg');
      surf.setAttribute('class', 'dsurf');
      surf.setAttribute('viewBox', '0 0 1 1000');
      surf.setAttribute('preserveAspectRatio', 'xMinYMin slice');
      surf.setAttribute('aria-hidden', 'true');
      host.appendChild(surf);
      return surf;
    }

    function localPt(rect, cx, cy) {
      var w = Math.max(1, rect.width);
      return { x: rnd((cx - rect.left) / w), y: rnd((cy - rect.top) / w) };
    }

    /* ---- rendering ---- */

    function svgEl(name, attrs) {
      var el = document.createElementNS(SVGNS, name);
      Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
      return el;
    }

    function nodeNameFor(tool) {
      if (tool === 'arrow') return 'path';   // shaft and head in one subpath set
      if (tool === 'circle') return 'circle';
      if (tool === 'ink') return 'polyline';
      return 'line';
    }

    function hyp(dx, dy) {
      return Math.sqrt(dx * dx + dy * dy);
    }

    /* Arrowhead as a stroked "V" rather than a filled triangle, so every shape
       can share fill:none and one stroke colour. Head length scales with the
       shaft but is capped, so short arrows stay legible and long ones do not
       grow a comic-book head. */
    function arrowPath(x0, y0, x1, y1) {
      var dx = x1 - x0, dy = y1 - y0;
      var len = Math.sqrt(dx * dx + dy * dy);
      var d = 'M' + x0 + ' ' + y0 + 'L' + x1 + ' ' + y1;
      if (!len) return d;
      var a = Math.atan2(dy, dx);
      var h = Math.min(0.015, 0.07 * len);
      var s = 0.44;   // half-angle of the head, radians (~25 degrees)
      return d +
        'M' + (x1 - h * Math.cos(a - s)) + ' ' + (y1 - h * Math.sin(a - s)) +
        'L' + x1 + ' ' + y1 +
        'L' + (x1 - h * Math.cos(a + s)) + ' ' + (y1 - h * Math.sin(a + s));
    }

    /* Geometry only; stroke styling is set once in shapeFor. */
    function applyShape(node, d) {
      var p = d.pts;
      switch (d.tool) {
      case 'point':
        /* A dot is a zero-length round-capped line, so its diameter comes from
           the non-scaling stroke width and stays constant in px at any host
           width. The epsilon avoids zero-length-subpath rendering gaps. */
        node.setAttribute('x1', p[0]);
        node.setAttribute('y1', p[1]);
        node.setAttribute('x2', p[0] + 0.0001);
        node.setAttribute('y2', p[1]);
        break;
      case 'line':
        node.setAttribute('x1', p[0]);
        node.setAttribute('y1', p[1]);
        node.setAttribute('x2', p[2]);
        node.setAttribute('y2', p[3]);
        break;
      case 'arrow':
        node.setAttribute('d', arrowPath(p[0], p[1], p[2], p[3]));
        break;
      case 'circle':
        /* Stored as centre + a point on the rim, so there is no separate radius
           to keep consistent. Both axes scale by the host width, so this stays
           a true circle at every viewport size. */
        node.setAttribute('cx', p[0]);
        node.setAttribute('cy', p[1]);
        node.setAttribute('r', hyp(p[2] - p[0], p[3] - p[1]));
        break;
      case 'ink':
        node.setAttribute('points', p.join(' '));
        break;
      }
    }

    function shapeFor(d) {
      var node = svgEl(nodeNameFor(d.tool), {
        stroke: d.color,
        fill: 'none',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'vector-effect': 'non-scaling-stroke',
        'stroke-width': d.tool === 'point' ? d.w * DOT_RATIO : d.w,
        'data-did': d.id
      });
      applyShape(node, d);
      return node;
    }

    function renderDrawing(d) {
      var host = hostFor(d);
      if (!host) return null;
      var node = shapeFor(d);
      surfaceFor(host).appendChild(node);
      var block = host.closest('.block');
      if (block) block.classList.add('has-drawing');
      return node;
    }

    function renderAllDrawings() {
      Array.prototype.forEach.call(document.querySelectorAll('.dsurf'), function (s) {
        s.parentNode.removeChild(s);
      });
      Array.prototype.forEach.call(
        document.querySelectorAll('.block.has-drawing'), function (b) {
          b.classList.remove('has-drawing');
        });
      drawings.forEach(renderDrawing);
    }

    function removeDrawing(d) {
      var i = drawings.indexOf(d);
      if (i === -1) return -1;
      drawings.splice(i, 1);
      var node = document.querySelector('[data-did="' + d.id + '"]');
      if (node && node.parentNode) node.parentNode.removeChild(node);
      return i;
    }

    /* ---- hit testing ---- */

    function distSeg(px, py, ax, ay, bx, by) {
      var dx = bx - ax, dy = by - ay;
      var len = dx * dx + dy * dy;
      var t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
      t = Math.max(0, Math.min(1, t));
      var qx = ax + t * dx, qy = ay + t * dy;
      return Math.sqrt((px - qx) * (px - qx) + (py - qy) * (py - qy));
    }

    function distTo(d, x, y) {
      var p = d.pts;
      switch (d.tool) {
      case 'point':
        return Math.sqrt((x - p[0]) * (x - p[0]) + (y - p[1]) * (y - p[1]));
      case 'line':
      case 'arrow':
        return distSeg(x, y, p[0], p[1], p[2], p[3]);
      case 'circle':
        // distance to the ring itself, so clicking the empty middle misses
        return Math.abs(hyp(x - p[0], y - p[1]) - hyp(p[2] - p[0], p[3] - p[1]));
      case 'ink':
        var best = Infinity;
        for (var i = 0; i + 3 < p.length; i += 2) {
          best = Math.min(best, distSeg(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]));
        }
        // a single-sample stroke has no segment to measure against
        return p.length === 2 ? hyp(x - p[0], y - p[1]) : best;
      }
      return Infinity;
    }

    /* Walks this host's own surface rather than every drawing in the chapter,
       so a drag-erase stays cheap. Later marks win, so the thing drawn most
       recently is the first to come off. */
    function hitTest(host, x, y, tol) {
      var surf = findSurface(host);
      if (!surf) return null;
      var byId = {};
      drawings.forEach(function (d) { byId[d.id] = d; });
      var hit = null;
      Array.prototype.forEach.call(surf.childNodes, function (node) {
        if (!node.getAttribute) return;
        var d = byId[node.getAttribute('data-did')];
        if (d && distTo(d, x, y) <= tol) hit = d;
      });
      return hit;
    }

    /* ---- undo ---- */

    function pushUndo(op, rec, index) {
      drawUndo.push({ op: op, rec: rec, index: index });
      if (drawUndo.length > UNDO_MAX) drawUndo.shift();
    }

    function undoLast() {
      var last = drawUndo.pop();
      if (!last) { setHint('Nothing to undo.'); return; }
      if (last.op === 'add') {
        removeDrawing(last.rec);
        setHint('Mark removed.');
      } else {
        drawings.splice(Math.min(last.index, drawings.length), 0, last.rec);
        renderDrawing(last.rec);
        setHint('Mark restored.');
      }
      saveDrawNow();
    }

    /* ---- input ---- */

    function commit(rec) {
      drawings.push(rec);
      pushUndo('add', rec, drawings.length - 1);
      renderDrawing(rec);
      scheduleDrawSave();
    }

    function eraseAt(host, x, y, tol) {
      var d = hitTest(host, x, y, tol);
      if (!d) return;
      var i = removeDrawing(d);
      if (i === -1) return;
      pushUndo('del', d, i);
      scheduleDrawSave();
      setHint('Mark erased.');
    }

    /* Ramer-Douglas-Peucker on a flat [x,y,x,y,...] array. Iterative with an
       explicit stack rather than recursive: a long stylus stroke can carry
       thousands of samples and would otherwise risk blowing the call stack.
       Typically drops 70-90% of points with no visible change, which is what
       keeps freehand inside the 5 MB localStorage budget. */
    function simplify(pts, eps) {
      var n = pts.length / 2;
      if (n < 3) return pts.slice();
      var keep = new Array(n);
      var i;
      for (i = 0; i < n; i++) keep[i] = false;
      keep[0] = keep[n - 1] = true;

      var stack = [[0, n - 1]];
      while (stack.length) {
        var seg = stack.pop();
        var first = seg[0], last = seg[1];
        var maxD = -1, idx = -1;
        for (i = first + 1; i < last; i++) {
          var dist = distSeg(pts[i * 2], pts[i * 2 + 1],
                             pts[first * 2], pts[first * 2 + 1],
                             pts[last * 2], pts[last * 2 + 1]);
          if (dist > maxD) { maxD = dist; idx = i; }
        }
        if (maxD > eps && idx !== -1) {
          keep[idx] = true;
          stack.push([first, idx]);
          stack.push([idx, last]);
        }
      }

      var out = [];
      for (i = 0; i < n; i++) {
        if (keep[i]) { out.push(pts[i * 2], pts[i * 2 + 1]); }
      }
      return out;
    }

    /* Rotate the end point onto the nearest 15-degree spoke, keeping length. */
    function snap15(from, to) {
      var dx = to.x - from.x, dy = to.y - from.y;
      var len = Math.sqrt(dx * dx + dy * dy);
      var step = Math.PI / 12;
      var a = Math.round(Math.atan2(dy, dx) / step) * step;
      return { x: rnd(from.x + len * Math.cos(a)),
               y: rnd(from.y + len * Math.sin(a)) };
    }

    /* Nearest <figure> inside a .block, else the block itself. Page chrome is
       excluded so the capture-phase preventDefault below never swallows a click
       meant for one of our own controls. */
    function resolveHost(target) {
      if (!target || !target.closest) return null;
      if (target.closest('.toolbar, .toolbar-toggle, .draw-bar, .qa-overlay, .fnote, #sym-bar')) {
        return null;
      }
      var block = target.closest('.block');
      if (!block) return null;
      indexFigures(block);
      var fig = target.closest('figure');
      return (fig && block.contains(fig)) ? fig : block;
    }

    /* The one drag primitive every tool is built from. */
    function beginStroke(e) {
      if (!drawMode || !e.isPrimary) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // finger scrolls the page unless the student opted in; this is also what
      // gives Apple Pencil palm rejection for free
      if (e.pointerType === 'touch' && !fingerDraw) return;
      var host = resolveHost(e.target);
      if (!host) return;
      e.preventDefault();

      var surf = surfaceFor(host);
      var rect = surf.getBoundingClientRect();   // read once, reused all stroke
      var tol = Math.max(0.01, 12 / Math.max(1, rect.width));
      var p0 = localPt(rect, e.clientX, e.clientY);
      var downX = e.clientX, downY = e.clientY;
      var erasing = (drawTool === 'erase');
      var rec = null, preview = null;

      if (erasing) {
        eraseAt(host, p0.x, p0.y, tol);
      } else if (drawTool !== 'point') {
        rec = { id: newDrawId(), anchor: anchorOf(host), fig: figOf(host),
                tool: drawTool, color: drawColor, w: drawW,
                // ink grows point by point; the others only ever move their end
                pts: drawTool === 'ink' ? [p0.x, p0.y] : [p0.x, p0.y, p0.x, p0.y] };
        preview = shapeFor(rec);
        surf.appendChild(preview);
      }

      /* Capture keeps the stroke alive over an activated embed iframe. If the
         browser refuses we carry on: the stroke still works as long as the
         pointer stays over the host, which beats aborting half-committed. */
      try { host.setPointerCapture(e.pointerId); } catch (err) { /* not fatal */ }

      function detach() {
        host.removeEventListener('pointermove', onMove);
        host.removeEventListener('pointerup', onUp);
        host.removeEventListener('pointercancel', onCancel);
        if (preview && preview.parentNode) preview.parentNode.removeChild(preview);
      }

      function onMove(ev) {
        var p = localPt(rect, ev.clientX, ev.clientY);
        if (erasing) { eraseAt(host, p.x, p.y, tol); return; }
        if (!rec) return;
        if (rec.tool === 'ink') {
          /* Drop samples closer than INK_MIN_STEP to the previous one. This,
             not rounding, is what actually controls ink size — a stylus emits
             120-240 Hz and would otherwise bury the quota in duplicates. */
          var n = rec.pts.length;
          if (hyp(p.x - rec.pts[n - 2], p.y - rec.pts[n - 1]) < INK_MIN_STEP) return;
          rec.pts.push(p.x, p.y);
          applyShape(preview, rec);
          return;
        }
        // Shift snaps to 15 degrees — handy for failure planes and axes
        if (ev.shiftKey) p = snap15(p0, p);
        rec.pts[2] = p.x;
        rec.pts[3] = p.y;
        applyShape(preview, rec);
      }

      function onCancel() { detach(); }

      function onUp(ev) {
        detach();
        if (erasing) return;
        var moved = Math.abs(ev.clientX - downX) + Math.abs(ev.clientY - downY);
        if (drawTool === 'point') {
          // a drag with the point tool is a mis-click, not a dot
          if (moved > TAP_SLOP) return;
          commit({ id: newDrawId(), anchor: anchorOf(host), fig: figOf(host),
                   tool: 'point', color: drawColor, w: drawW,
                   pts: [p0.x, p0.y] });
          setHint('Point added.');
          return;
        }
        if (!rec || moved <= TAP_SLOP) return;   // degenerate drag: discard
        if (rec.tool === 'ink') {
          if (rec.pts.length < 4) return;        // nothing but the first sample
          rec.pts = simplify(rec.pts, INK_EPS);
        }
        commit(rec);
      }

      host.addEventListener('pointermove', onMove);
      host.addEventListener('pointerup', onUp);
      host.addEventListener('pointercancel', onCancel);
    }

    /* Sieve worksheets are 5-6 columns wide and the chapters set them at
       font-size 0.6em with width:100%, so on a phone they overflow the viewport
       and the student types into a cell that is half off-screen. Wrapping is
       done here rather than in the build so already-generated chapters get it.
       Runs before renderAllDrawings() below: drawing anchors key off .block and
       <figure>, neither of which this wrapper sits between. */
    (function wrapWideTables() {
      var main = document.querySelector('main') || document.body;
      Array.prototype.forEach.call(main.querySelectorAll('table'), function (t) {
        if (t.parentNode.classList.contains('table-scroll')) return;
        var wrap = document.createElement('div');
        wrap.className = 'table-scroll';
        t.parentNode.insertBefore(wrap, t);
        wrap.appendChild(t);
      });
    })();

    /* Rendered unconditionally, outside initDrawing, so saved marks still show
       on a chapter page built before the palette existed. */
    renderAllDrawings();

    (function initDrawing() {
      var bar = document.getElementById('draw-bar');
      var btn = document.getElementById('btn-draw');
      if (!bar || !btn) return;   // chapter not yet rebuilt with the palette
      drawHint = document.getElementById('draw-hint');

      var prefs = loadJSON(PENKEY, {});
      if (prefs.tool && prefs.tool !== 'erase') drawTool = prefs.tool;
      if (prefs.color) drawColor = prefs.color;
      if (prefs.w) drawW = prefs.w;
      fingerDraw = !!prefs.finger;

      function savePrefs() {
        saveJSON(PENKEY, {
          tool: drawTool, color: drawColor, w: drawW, finger: fingerDraw
        });
      }

      function press(sel, attr, value) {
        Array.prototype.forEach.call(bar.querySelectorAll(sel), function (b) {
          b.setAttribute('aria-pressed',
            String(b.getAttribute(attr) === String(value)));
        });
      }

      function setTool(name) {
        drawTool = name;
        press('.dtool', 'data-tool', name);
        document.body.classList.toggle('tool-erase', name === 'erase');
        setHint(HINTS[name] || '');
        savePrefs();
      }

      function setColor(c) {
        drawColor = c;
        press('.dcolor', 'data-color', c);
        savePrefs();
      }

      function setWidth(w) {
        drawW = w;
        press('.dwidth', 'data-w', w);
        savePrefs();
      }

      function setFinger(on) {
        fingerDraw = on;
        document.body.classList.toggle('finger-draw', on);
        var fb = document.getElementById('btn-draw-finger');
        if (fb) fb.setAttribute('aria-pressed', String(on));
        savePrefs();
      }

      /* Draw mode itself is deliberately never persisted — a student returning
         to find their blanks unclickable would think the book was broken. */
      var toolbar = document.getElementById('toolbar');

      /* The palette sticks directly under the main toolbar, whose height
         changes when its buttons wrap, so measure rather than hard-code it. */
      function alignBar() {
        if (!toolbar || toolbar.classList.contains('collapsed')) return;
        bar.style.top = toolbar.offsetHeight + 'px';
      }

      function setDrawMode(on) {
        drawMode = on;
        document.body.classList.toggle('draw-mode', on);
        bar.hidden = !on;
        btn.setAttribute('aria-pressed', String(on));
        if (on) alignBar();
        if (on) nudgeSticky();
        if (on) {
          // preventDefault blocks NEW focus, but a blank that already has focus
          // would keep taking keystrokes
          if (document.activeElement && document.activeElement.blur) {
            document.activeElement.blur();
          }
          setHint(HINTS[drawTool] || '');
        }
      }

      setTool(drawTool);
      setColor(drawColor);
      setWidth(drawW);
      setFinger(fingerDraw);
      setDrawMode(false);

      btn.addEventListener('click', function () { setDrawMode(!drawMode); });

      bar.addEventListener('click', function (e) {
        var t = e.target.closest('button');
        if (!t) return;
        if (t.hasAttribute('data-tool')) { setTool(t.getAttribute('data-tool')); return; }
        if (t.hasAttribute('data-color')) { setColor(t.getAttribute('data-color')); return; }
        if (t.hasAttribute('data-w')) { setWidth(parseFloat(t.getAttribute('data-w'))); return; }
        if (t.id === 'btn-draw-finger') { setFinger(!fingerDraw); return; }
        if (t.id === 'btn-draw-undo') { undoLast(); return; }
        if (t.id === 'btn-draw-done') { setDrawMode(false); return; }
        if (t.id === 'btn-draw-clear') {
          if (!drawings.length) { setHint('There are no marks to clear.'); return; }
          if (!confirm('Erase all ' + drawings.length + ' drawing mark(s) in this ' +
                       'chapter? Your blanks and sticky notes are not affected.')) return;
          drawings = [];
          drawUndo = [];
          renderAllDrawings();
          saveDrawNow();
          setHint('All marks cleared.');
        }
      });

      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape' || !drawMode) return;
        var ov = document.getElementById('qa-overlay');
        if (ov && !ov.hidden) return;   // the Q&A panel gets the key first
        setDrawMode(false);
      });

      /* Collapsing the toolbar takes the palette with it. Leaving draw mode on
         would then trap the student: clicks would still draw with no visible
         way to stop, so collapse means "done drawing" too. */
      var toolsBtn = document.getElementById('btn-tools');
      if (toolsBtn) {
        toolsBtn.addEventListener('click', function () {
          if (toolbar && toolbar.classList.contains('collapsed')) {
            if (drawMode) setDrawMode(false);
          } else {
            alignBar();
          }
        });
      }

      window.addEventListener('resize', function () {
        if (drawMode) alignBar();
      });

      document.addEventListener('pointerdown', beginStroke, true);
    })();

    /* ---------------- click-to-load embeds ---------------- */

    Array.prototype.forEach.call(
      document.querySelectorAll('.embed-placeholder'), function (ph) {
        function activate() {
          var frame = document.createElement('iframe');
          frame.src = ph.getAttribute('data-src');
          frame.className = 'embed-frame';
          frame.setAttribute('allowfullscreen', '');
          ph.parentNode.replaceChild(frame, ph);
        }
        ph.addEventListener('click', activate);
        ph.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
        });
      });

    /* ---------------- toolbar collapse toggle ---------------- */

    (function initToolbarToggle() {
      var toolbar = document.getElementById('toolbar');
      var btn = document.getElementById('btn-tools');
      if (!toolbar || !btn) return;

      function apply(collapsed, persist) {
        toolbar.classList.toggle('collapsed', collapsed);
        btn.innerHTML = collapsed ? '&#9881; Tools' : '&#9650; Hide tools';
        btn.setAttribute('aria-expanded', String(!collapsed));
        if (persist && LS) {
          LS.setItem('ebook:toolbar', collapsed ? 'collapsed' : 'open');
        }
      }

      var stored = LS ? LS.getItem('ebook:toolbar') : null;
      // no saved preference: start collapsed on phone-sized screens
      apply(stored ? stored === 'collapsed' : window.innerWidth < 700, false);

      btn.addEventListener('click', function () {
        var collapsed = toolbar.classList.contains('collapsed');
        apply(!collapsed, true);
        // only a real un-collapse (mid-scroll tap) needs the sticky nudge --
        // skip it on the initial apply() above, which never toggled display
        if (collapsed) nudgeSticky();
      });
    })();

    /* ---------------- symbol bar ---------------- */

    /* A keyboard-accessory strip for math blanks: the keycap shows the finished
       form, the key inserts plain readable text, and the row above renders it.
       Students never type or see a backslash.

       Built here in JS rather than in chapter_template.html so it reaches every
       already-generated chapter -- regenerating them would destroy hand edits. */
    (function initSymbolBar() {
      var SYMKEY = 'ebook:sym';
      var HINT = 'Type it how you say it: γ_w, D_60, m^3, sqrt(2). ' +
                 'The line above shows how it will look.';

      /* ins defaults to cap; back = characters to move the caret left after. */
      var GROUPS = [
        ['Structure', [
          { cap: 'x_n', ins: '_' }, { cap: 'x^n', ins: '^' },
          { cap: '√', ins: 'sqrt()', back: 1 }, { cap: '( )', ins: '()', back: 1 },
          { cap: 'a/b', ins: '()/()', back: 4 },
          { cap: '×', ins: '*' }, { cap: '÷', ins: '/' },
          { cap: '%' }, { cap: '=' }
        ]],
        ['Greek', [
          { cap: 'γ' }, { cap: 'γ_w' }, { cap: 'γ_d' }, { cap: 'γ_sat' },
          { cap: 'γ′' }, { cap: 'σ' }, { cap: 'σ′' }, { cap: 'σ_v' },
          { cap: 'τ' }, { cap: 'φ' }, { cap: 'ρ' }, { cap: 'Δ' },
          { cap: 'π' }, { cap: 'θ' }, { cap: 'ε' }, { cap: 'µ' }
        ]],
        ['Properties', [
          { cap: 'G_s' }, { cap: 'D_10' }, { cap: 'D_30' }, { cap: 'D_60' },
          { cap: 'C_u' }, { cap: 'C_c' }, { cap: 'e_max' }, { cap: 'e_min' },
          { cap: 'w_L' }, { cap: 'w_P' }, { cap: 'PI' }, { cap: 'k_eq' }
        ]],
        ['Units', [
          { cap: 'kN/m^3' }, { cap: 'kPa' }, { cap: 'g/cm^3' }, { cap: 'kg/m^3' },
          { cap: 'cm/s' }, { cap: 'm/s' }, { cap: 'mm' }, { cap: '°' },
          { cap: '≈' }, { cap: '≤' }, { cap: '≥' }
        ]]
      ];

      /* Render _x / ^x in a keycap as real <sub>/<sup>, so the button looks
         like the finished symbol rather than like its source. */
      function keycap(btn, label) {
        var re = /([_^])([A-Za-z0-9]+)|([\s\S]?[^_^]*)/g, m;
        while ((m = re.exec(label)) && m[0]) {
          if (m[3]) {
            btn.appendChild(document.createTextNode(m[3]));
          } else {
            var e = document.createElement(m[1] === '_' ? 'sub' : 'sup');
            e.textContent = m[2];
            btn.appendChild(e);
          }
        }
      }

      var bar = document.createElement('div');
      bar.className = 'sym-bar';
      bar.id = 'sym-bar';
      bar.hidden = true;

      var preview = document.createElement('div');
      preview.className = 'sym-preview';
      preview.id = 'sym-preview';
      preview.hidden = true;
      bar.appendChild(preview);

      /* The keys scroll horizontally; the controls sit outside that scroller so
         "Done" is always reachable instead of being stranded at the far end. */
      var row = document.createElement('div');
      row.className = 'sym-row';
      bar.appendChild(row);

      var keys = document.createElement('div');
      keys.className = 'sym-keys';
      row.appendChild(keys);

      GROUPS.forEach(function (g) {
        var grp = document.createElement('span');
        grp.className = 'sym-group';
        grp.setAttribute('role', 'group');
        grp.setAttribute('aria-label', g[0]);
        g[1].forEach(function (k) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'sym-key';
          b.setAttribute('data-ins', k.ins || k.cap);
          if (k.back) b.setAttribute('data-back', String(k.back));
          b.title = 'Insert ' + (k.ins || k.cap);
          keycap(b, k.cap);
          grp.appendChild(b);
        });
        keys.appendChild(grp);
      });

      var ctrl = document.createElement('span');
      ctrl.className = 'sym-group sym-ctrl';
      var btnHint = document.createElement('button');
      btnHint.type = 'button';
      btnHint.className = 'sym-key';
      btnHint.setAttribute('data-act', 'hint');
      btnHint.textContent = '?';
      btnHint.title = 'How do I write this?';
      var btnDone = document.createElement('button');
      btnDone.type = 'button';
      btnDone.className = 'sym-key sym-done';
      btnDone.setAttribute('data-act', 'done');
      btnDone.textContent = '✓ Done';
      ctrl.appendChild(btnHint);
      ctrl.appendChild(btnDone);
      row.appendChild(ctrl);

      document.body.appendChild(bar);

      var host = null;
      var lastRange = null;
      var previewTimer = null;
      var enabled = LS ? LS.getItem(SYMKEY) !== 'off' : true;

      function isMathBlank(el) {
        return !!(el && el.classList && el.classList.contains('blank') &&
                  el.getAttribute('data-math') === '1');
      }

      /* vv.height + vv.offsetTop is the bottom edge of the VISUAL viewport
         inside the layout viewport. iOS does not shrink innerHeight when the
         soft keyboard opens, so that difference is the keyboard; Android
         Chrome shrinks the layout viewport, the difference is ~0, and bottom:0
         is already correct. */
      function place() {
        var vv = window.visualViewport;
        bar.style.bottom = vv
          ? Math.max(0, window.innerHeight - (vv.height + vv.offsetTop)) + 'px'
          : '0px';
      }

      function renderPreview() {
        if (!host) return;
        var tex = friendlyTeX(host.textContent);
        if (!tex) {
          preview.textContent = '';
          preview.hidden = true;
          return;
        }
        preview.hidden = false;
        try {
          if (window.MathJax && MathJax.typesetClear) MathJax.typesetClear([preview]);
        } catch (e) { /* first run, nothing to clear */ }
        preview.textContent = '\\(' + tex + '\\)';
        typesetMath(preview).then(function () {
          // MathJax 3 does not throw on bad TeX, it draws a red error box.
          // Showing nothing is better than showing the student an error.
          if (preview.querySelector('mjx-merror')) {
            preview.textContent = '';
            preview.hidden = true;
          }
        }).catch(function () {
          preview.textContent = '';
          preview.hidden = true;
        });
      }

      function schedulePreview() {
        if (previewTimer) clearTimeout(previewTimer);
        previewTimer = setTimeout(renderPreview, 250);
      }

      function open() {
        if (!enabled) return;
        /* Deliberately no nudgeSticky() here. That workaround is for
           position:sticky; this bar is fixed, and a 1px scroll while the soft
           keyboard is up moves the visual viewport and can pull the caret
           off-screen. */
        bar.hidden = false;
        document.body.classList.add('symbar-open');
        place();
        renderPreview();
      }

      function close() {
        bar.hidden = true;
        preview.hidden = true;
        document.body.classList.remove('symbar-open');
        host = null;
        lastRange = null;
      }

      document.addEventListener('focusin', function (e) {
        var t = e.target;
        if (t && t.closest && t.closest('#sym-bar')) return;   // stay open
        if (isMathBlank(t)) { host = t; open(); } else { close(); }
      });

      /* focusin does not fire when focus lands on nothing (a tap on the page
         background), so catch that case too. */
      document.addEventListener('focusout', function (e) {
        if (!isMathBlank(e.target)) return;
        setTimeout(function () {
          var a = document.activeElement;
          if (a && a.closest && a.closest('#sym-bar')) return;
          if (isMathBlank(a)) return;
          close();
        }, 0);
      });

      document.addEventListener('selectionchange', function () {
        if (!host || document.activeElement !== host) return;
        var sel = window.getSelection();
        if (sel && sel.rangeCount &&
            host.contains(sel.getRangeAt(0).startContainer)) {
          lastRange = sel.getRangeAt(0).cloneRange();
        }
      });

      document.addEventListener('input', function (e) {
        if (host && e.target === host) schedulePreview();
      });

      /* Keep the caret in the blank when a key is pressed. pointerdown alone is
         not enough -- WebKit only honours mousedown for focus suppression -- so
         both are prevented, and the saved Range is a last-resort restore. */
      function keepFocus(e) {
        if (e.target.closest && e.target.closest('.sym-key')) e.preventDefault();
      }
      bar.addEventListener('pointerdown', keepFocus);
      bar.addEventListener('mousedown', keepFocus);

      bar.addEventListener('click', function (e) {
        var t = e.target.closest ? e.target.closest('button') : null;
        if (!t) return;

        var act = t.getAttribute('data-act');
        if (act === 'done') { if (host) host.blur(); close(); return; }
        if (act === 'hint') {
          preview.hidden = false;
          preview.textContent = HINT;
          return;
        }

        var ins = t.getAttribute('data-ins');
        if (ins === null || !host) return;

        if (document.activeElement !== host) {
          host.focus();
          if (lastRange) {
            var sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(lastRange);
          }
        }
        insertAtCaret(host, ins, parseInt(t.getAttribute('data-back') || '0', 10));
        renderPreview();
      });

      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape' || bar.hidden) return;
        var ov = document.getElementById('qa-overlay');
        if (ov && !ov.hidden) return;      // the Q&A panel gets the key first
        if (host) host.blur();
        close();
      });

      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', place);
        window.visualViewport.addEventListener('scroll', place);
      }
      window.addEventListener('resize', place);

      /* Toolbar toggle, so the bar is discoverable and can be switched off. */
      var actions = document.querySelector('.toolbar-actions');
      if (actions) {
        var toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.id = 'btn-sym';
        toggle.textContent = 'Σ Symbols';
        toggle.title = 'Show a symbol keyboard when typing a math answer';
        toggle.setAttribute('aria-pressed', String(enabled));
        toggle.addEventListener('click', function () {
          enabled = !enabled;
          toggle.setAttribute('aria-pressed', String(enabled));
          if (LS) LS.setItem(SYMKEY, enabled ? 'on' : 'off');
          if (!enabled) { close(); } else if (isMathBlank(document.activeElement)) {
            host = document.activeElement;
            open();
          }
        });
        var clearBtn = document.getElementById('btn-clear');
        actions.insertBefore(toggle, clearBtn || null);
      }
    })();

    /* ---------------- student Q&A ---------------- */

    (function initQA() {
      var endpoint = document.body.getAttribute('data-qa-endpoint');
      if (!endpoint) return; // feature disabled — everything stays hidden

      var qaBlock = document.getElementById('qa-block');
      var qaList = document.getElementById('qa-list');
      var qaStatus = document.getElementById('qa-status');
      var overlay = document.getElementById('qa-overlay');
      var idInput = document.getElementById('qa-id');
      var textInput = document.getElementById('qa-text');
      var honeypot = document.getElementById('qa-website');
      var msg = document.getElementById('qa-msg');
      var btnAsk = document.getElementById('btn-ask');
      var btnSend = document.getElementById('qa-send');
      var btnCancel = document.getElementById('qa-cancel');

      var ERRORS = {
        unknown_id: 'That ID isn’t on the class roster — check for typos (no spaces).',
        empty_question: 'Please write a question before sending.',
        question_too_long: 'Your question is too long — please keep it under 1000 characters.',
        too_fast: 'Please wait a minute between questions.',
        bad_request: 'Something was wrong with the submission — please try again.',
        server_error: 'The Q&A service had a problem — please try again later.'
      };
      var UNREACHABLE = 'Could not reach the Q&A service — check your connection. ' +
        'If this keeps happening the service may be misconfigured; tell your instructor.';
      var BAD_RESPONSE = 'The Q&A service returned an unexpected response (it may be ' +
        'misconfigured) — tell your instructor.';

      qaBlock.hidden = false;
      btnAsk.hidden = false;
      if (LS && LS.getItem('ebook:studentid')) {
        idInput.value = LS.getItem('ebook:studentid');
      }

      function showMsg(text, isError) {
        msg.textContent = text;
        msg.classList.toggle('error', !!isError);
        msg.hidden = false;
      }

      function parseResponse(text) {
        try {
          return JSON.parse(text);
        } catch (e) {
          return null;
        }
      }

      /* feed */
      fetch(endpoint + '?chapter=' + encodeURIComponent(chapter))
        .then(function (r) { return r.text(); })
        .then(function (text) {
          var data = parseResponse(text);
          if (!data || data.ok !== true || !data.items) {
            qaStatus.textContent = 'The Q&A feed is unavailable right now.';
            return;
          }
          if (!data.items.length) {
            qaStatus.textContent = 'No answered questions yet — be the first to ask!';
            return;
          }
          qaStatus.hidden = true;
          data.items.forEach(function (item) {
            var wrap = document.createElement('div');
            wrap.className = 'qa-item';
            var q = document.createElement('div');
            q.className = 'InquiryBox qa-q';
            q.textContent = item.q;
            var a = document.createElement('div');
            a.className = 'findingBox qa-a';
            a.textContent = item.a;
            var d = document.createElement('div');
            d.className = 'qa-date';
            d.textContent = item.date || '';
            wrap.appendChild(q);
            wrap.appendChild(a);
            wrap.appendChild(d);
            qaList.appendChild(wrap);
          });
          typesetMath(qaList).catch(function () {});
        })
        .catch(function () {
          qaStatus.textContent = 'The Q&A feed is unavailable right now.';
        });

      /* panel open/close */
      function openPanel() {
        msg.hidden = true;
        overlay.hidden = false;
        (idInput.value ? textInput : idInput).focus();
      }
      function closePanel() {
        overlay.hidden = true;
      }
      btnAsk.addEventListener('click', openPanel);
      btnCancel.addEventListener('click', closePanel);
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closePanel();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !overlay.hidden) closePanel();
      });

      /* submit */
      btnSend.addEventListener('click', function () {
        var id = idInput.value.replace(/\s+/g, '');
        var question = textInput.value.trim();
        if (!id) { showMsg('Please enter your student ID.', true); return; }
        if (!question) { showMsg(ERRORS.empty_question, true); return; }
        var last = LS ? parseInt(LS.getItem('ebook:qa:last') || '0', 10) : 0;
        if (Date.now() - last < 60000) { showMsg(ERRORS.too_fast, true); return; }

        btnSend.disabled = true;
        showMsg('Sending…', false);
        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            id: id,
            chapter: chapter,
            question: question,
            website: honeypot.value
          })
        })
          .then(function (r) { return r.text(); })
          .then(function (text) {
            btnSend.disabled = false;
            var data = parseResponse(text);
            if (!data) {
              showMsg(text.charAt(0) === '<' ? BAD_RESPONSE : UNREACHABLE, true);
              return;
            }
            if (data.ok === true) {
              if (LS) {
                LS.setItem('ebook:studentid', id);
                LS.setItem('ebook:qa:last', String(Date.now()));
              }
              textInput.value = '';
              showMsg('Question sent! It will appear here once your instructor answers it.', false);
            } else {
              showMsg(ERRORS[data.error] || ERRORS.server_error, true);
            }
          })
          .catch(function () {
            btnSend.disabled = false;
            showMsg(UNREACHABLE, true);
          });
      });
    })();

    /* ---------------- toolbar ---------------- */

    var fileInput = document.getElementById('file-import');

    document.getElementById('btn-export').addEventListener('click', function () {
      download(CODE + '-' + chapter + '-answers-' + today() + '.json', {
        version: 2,
        kind: 'chapter',
        chapter: chapter,
        exported: new Date().toISOString(),
        answers: collect(),
        notes: notes,
        drawings: drawings
      });
    });

    document.getElementById('btn-import').addEventListener('click', function () {
      fileInput.click();
    });

    fileInput.addEventListener('change', function () {
      var file = fileInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var data;
        try { data = JSON.parse(reader.result); }
        catch (e) { alert('That file is not a valid notes backup.'); return; }
        var entry = null;
        if (data.kind === 'chapter' && data.chapter === chapter) {
          entry = unpackEntry(data);
        } else if (data.kind === 'chapter' && data.answers) {
          entry = unpackEntry(data); // older single-chapter file without dir match
        } else if (data.kind === 'all' && data.chapters && data.chapters[chapter]) {
          entry = unpackEntry(data.chapters[chapter]);
        }
        if (!entry) {
          alert('No answers for this chapter were found in that file.');
          return;
        }
        var answers = loadJSON(APREFIX + chapter, {});
        Object.keys(entry.answers).forEach(function (k) { answers[k] = entry.answers[k]; });
        saveJSON(APREFIX + chapter, answers);
        var matched = applyAnswers(answers);
        saveJSON(APREFIX + chapter, collect());
        notes = mergeById(notes, entry.notes);
        saveNotesNow();
        renderAllNotes();
        drawings = mergeById(drawings, entry.drawings);
        drawUndo = [];
        saveDrawNow();
        renderAllDrawings();
        alert('Loaded: ' + matched + ' blank(s) filled' +
              (entry.notes.length ? ', ' + entry.notes.length + ' sticky note(s)' : '') +
              (entry.drawings.length ? ', ' + entry.drawings.length + ' drawing mark(s)' : '') +
              '.');
        fileInput.value = '';
      };
      reader.readAsText(file);
    });

    document.getElementById('btn-print').addEventListener('click', function () {
      window.print();
    });

    document.getElementById('btn-clear').addEventListener('click', function () {
      if (!confirm('Erase every answer, sticky note and drawing mark in this chapter ' +
                   'on this device? Consider "Save notes" first — this cannot be undone.')) return;
      if (LS) {
        LS.removeItem(APREFIX + chapter);
        LS.removeItem(NPREFIX + chapter);
        LS.removeItem(DPREFIX + chapter);
      }
      blanks.forEach(function (b) { b.textContent = ''; });
      notes = [];
      renderAllNotes();
      drawings = [];
      drawUndo = [];
      renderAllDrawings();
      updateProgress();
    });

    updateProgress();
    if (!LS) {
      var label = document.querySelector('.progress-label');
      if (label) label.textContent = 'Private browsing: answers will NOT be saved between visits.';
    }
  }

  /* ------------------------------------------------------------------ */
  /* TOC page                                                            */
  /* ------------------------------------------------------------------ */
  if (page === 'toc') {
    function refreshChips() {
      Array.prototype.forEach.call(
        document.querySelectorAll('.chapter-link'), function (link) {
          var dir = link.getAttribute('data-chapter');
          var total = parseInt(link.getAttribute('data-total'), 10) || 0;
          var chip = link.querySelector('.ch-progress');
          if (!chip) return;
          var answers = loadJSON(APREFIX + dir, {});
          var noteCount = loadJSON(NPREFIX + dir, []).length;
          var markCount = loadJSON(DPREFIX + dir, []).length;
          var filled = Object.keys(answers).filter(function (k) {
            return String(answers[k]).trim().length > 0;
          }).length;
          if (filled > total) filled = total;
          chip.textContent = filled + ' / ' + total + ' blanks' +
            (noteCount ? ' · ' + noteCount + ' note' + (noteCount > 1 ? 's' : '') : '') +
            (markCount ? ' · ' + markCount + ' mark' + (markCount > 1 ? 's' : '') : '');
          chip.classList.toggle('done', total > 0 && filled >= total);
        });
    }

    var fileInput = document.getElementById('file-import');

    document.getElementById('btn-export-all').addEventListener('click', function () {
      var chapters = {};
      function ensure(dir) {
        chapters[dir] = chapters[dir] || { answers: {}, notes: [], drawings: [] };
        return chapters[dir];
      }
      if (LS) {
        for (var i = 0; i < LS.length; i++) {
          var key = LS.key(i);
          if (!key) continue;
          if (key.indexOf(APREFIX) === 0) {
            ensure(key.slice(APREFIX.length)).answers = loadJSON(key, {});
          } else if (key.indexOf(NPREFIX) === 0) {
            ensure(key.slice(NPREFIX.length)).notes = loadJSON(key, []);
          } else if (key.indexOf(DPREFIX) === 0) {
            ensure(key.slice(DPREFIX.length)).drawings = loadJSON(key, []);
          }
        }
      }
      download(CODE + '-all-answers-' + today() + '.json', {
        version: 2,
        kind: 'all',
        exported: new Date().toISOString(),
        chapters: chapters
      });
    });

    document.getElementById('btn-import-all').addEventListener('click', function () {
      fileInput.click();
    });

    fileInput.addEventListener('change', function () {
      var file = fileInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var data;
        try { data = JSON.parse(reader.result); }
        catch (e) { alert('That file is not a valid notes backup.'); return; }

        function absorb(dir, rawEntry) {
          var entry = unpackEntry(rawEntry);
          var answers = loadJSON(APREFIX + dir, {});
          Object.keys(entry.answers).forEach(function (k) { answers[k] = entry.answers[k]; });
          saveJSON(APREFIX + dir, answers);
          if (entry.notes.length) {
            saveJSON(NPREFIX + dir, mergeById(loadJSON(NPREFIX + dir, []), entry.notes));
          }
          if (entry.drawings.length) {
            saveJSON(DPREFIX + dir, mergeById(loadJSON(DPREFIX + dir, []), entry.drawings));
          }
        }

        var count = 0;
        if (data.kind === 'all' && data.chapters) {
          Object.keys(data.chapters).forEach(function (dir) {
            absorb(dir, data.chapters[dir]);
            count++;
          });
        } else if (data.kind === 'chapter' && data.chapter) {
          absorb(data.chapter, data);
          count = 1;
        } else {
          alert('That file does not look like a notes backup.');
          return;
        }
        refreshChips();
        alert('Loaded notes for ' + count + ' chapter(s).');
        fileInput.value = '';
      };
      reader.readAsText(file);
    });

    refreshChips();
    window.addEventListener('focus', refreshChips);
  }
})();
