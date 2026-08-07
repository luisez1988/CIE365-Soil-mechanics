/* ==========================================================================
   RevealSolution — loads worked-example solutions into the slides and types
   them in, character by character.

     <div class='Solution' data-src='solutions/ex-5-3.html' data-part='1'></div>

   Register it in the deck's plugins array. reveal.js awaits a Promise returned
   from init() (js/controllers/plugins.js:129), so every partial is in the DOM
   *before* reveal builds its fragment map — which is what gives us native
   keyboard stepping, fragment URLs and PDF export with no Reveal.sync().

   Optional deck config:

     solution: {
       sound:           true,   // chalk while typing (solution fragments only)
       charsPerSecond:  30,     // typing speed — the one dial
       soundSrc:        'plugin/complete_box/chalk-on-chalkboard-32542.mp3'
     }

   Authoring format and the four roles: see SOLUTIONS.md.
   ========================================================================== */

window.RevealSolution = function () {

  /* Document order matters: `.step` is always matched before the values inside
     it, so the black scaffolding line is written first and its blue/green
     values fill in afterwards. */
  var ROLES = '.step, .fill, .ans, .note';

  var DEFAULTS = {
    sound: true,
    charsPerSecond: 30,
    soundSrc: 'plugin/complete_box/chalk-on-chalkboard-32542.mp3'
  };

  var cfg = DEFAULTS;
  var chalk = null;
  var restoring = false;      // suppress typing/chalk while replaying a slide
  var completed = Object.create(null);
  var instant = false;        // print export / reduced motion: no typing at all

  /* Fetch each distinct file once, even when two slides share it (a solution
     split across parts). */
  var cache = {};

  function load(src) {
    if (!cache[src]) {
      cache[src] = fetch(src).then(function (r) {
        if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
        return r.text();
      });
    }
    return cache[src];
  }

  /* Keep only what belongs to this slide's part.

     Rule: ONLY elements carrying data-part are filtered. Anything unmarked
     shows on every part, which is what you want for a standing note or a
     figure the whole solution refers back to. In a multi-part solution, mark
     every step explicitly. */
  function selectPart(root, part) {
    if (!part) return;

    /* Steps dropped from earlier parts still "happened" as far as the student
       is concerned, so the continuation slide carries on numbering instead of
       restarting at 1. */
    var before = 0;
    Array.prototype.forEach.call(
      root.querySelectorAll('.step[data-part]'), function (el) {
        if (+el.getAttribute('data-part') < +part) before++;
      });

    Array.prototype.forEach.call(
      root.querySelectorAll('[data-part]'), function (el) {
        if (el.getAttribute('data-part') !== part) el.remove();
      });

    var sol = root.querySelector('.sol') || root;
    if (before) sol.style.counterReset = 'solstep ' + before;
  }

  /* A note sits beside its step on the slide, where vertical space is scarce;
     in the book it is a paragraph in the flow with no height limit. `data-slide`
     lets one note carry both: the short form for the slide, the full text for
     the book. Same single-source split that data-part uses.

     ebook_build.py strips data-slide, so the book always shows the full text. */
  function useSlideText(root) {
    Array.prototype.forEach.call(
      root.querySelectorAll('.note[data-slide]'), function (el) {
        el.innerHTML = el.getAttribute('data-slide');
      });
  }

  /* Turn the roles into reveal fragments, in document order. Authors write no
     fragment markup: the schema implies the reveal order.

     data-step="N" on several elements groups them into one reveal (e.g. show a
     substitution and its result together). */
  function fragmentize(root) {
    var index = 0;
    var groups = {};
    Array.prototype.forEach.call(root.querySelectorAll(ROLES), function (el) {
      var key = el.getAttribute('data-step');
      var i;
      if (key && groups[key] !== undefined) {
        i = groups[key];
      } else {
        i = index++;
        if (key) groups[key] = i;
      }
      el.classList.add('fragment', 'writing');
      el.setAttribute('data-fragment-index', i);
    });
  }

  /* MathJax 3 typesets the whole document on startup. If it has already run by
     the time we inject, typeset the new nodes explicitly; otherwise its startup
     pass will pick them up. Either order is safe. */
  function typeset(nodes) {
    if (window.MathJax && window.MathJax.typesetPromise && nodes.length) {
      return window.MathJax.typesetPromise(nodes).catch(function (e) {
        console.warn('[RevealSolution] MathJax typeset failed', e);
      });
    }
    return Promise.resolve();
  }

  /* MathJax is loaded with `async`, so at plugin-init time the library itself
     may not have run yet — window.MathJax exists (it is the config object) but
     startup.promise does not. Poll briefly for it rather than assume. */
  function whenMathJaxSettles(fn) {
    var ready = function () {
      return window.MathJax && window.MathJax.startup && window.MathJax.startup.promise;
    };
    if (ready()) { window.MathJax.startup.promise.then(fn); return; }
    var tries = 0;
    var timer = window.setInterval(function () {
      if (ready()) {
        window.clearInterval(timer);
        window.MathJax.startup.promise.then(fn);
      } else if (++tries > 100) {          // ~10 s, then give up quietly
        window.clearInterval(timer);
        fn();
      }
    }, 100);
  }

  /* ------------------------------------------------------------------------
     Atoms: the individual characters a line is typed in.

     A left-to-right clip could not do this. A clip sweeps a vertical band
     across the whole element at once, so on a line that wraps it uncovers the
     second line at the same time as the first — which is what looked wrong.
     Revealing real characters follows the text flow, wrapping included.

     Plain text is split one span per character. MathJax is NOT split: CHTML
     already emits one <mjx-c> element per glyph (and <mjx-line> for a fraction
     bar), so those elements are the characters. mjx-assistive-mml is skipped —
     it is a hidden duplicate of the whole expression for screen readers, and
     walking into it would type every symbol twice.
     ------------------------------------------------------------------------ */

  var SKIP_TAGS = /^(MJX-ASSISTIVE-MML|SCRIPT|STYLE)$/;
  var GLYPH_TAGS = /^(MJX-C|MJX-LINE|IMG|BR)$/;

  function collectAtoms(node, out) {
    Array.prototype.slice.call(node.childNodes).forEach(function (n) {
      if (n.nodeType === 3) {                                   // text node
        var txt = n.nodeValue;
        if (!txt || /^\s*$/.test(txt)) return;                  // layout whitespace
        var frag = document.createDocumentFragment();
        for (var i = 0; i < txt.length; i++) {
          var s = document.createElement('span');
          s.className = 'sol-atom pending';
          s.textContent = txt[i];
          // spaces cost no time, so words are not padded out by their gaps
          if (!/\S/.test(txt[i])) s.setAttribute('data-free', '');
          frag.appendChild(s);
          out.push(s);
        }
        n.parentNode.replaceChild(frag, n);
        return;
      }
      if (n.nodeType !== 1) return;
      var tag = n.tagName.toUpperCase();
      if (SKIP_TAGS.test(tag)) return;
      /* A nested .writing element is a fragment in its own right — a step
         contains its .fill values and its .note, and each of those is revealed
         at its own click. Descending into them would make the step type its own
         answers in along with the scaffolding. */
      if (n.classList && n.classList.contains('writing')) return;
      if (GLYPH_TAGS.test(tag)) {
        n.classList.add('sol-atom', 'pending');
        out.push(n);
        return;
      }
      collectAtoms(n, out);
    });
  }

  function buildAtoms(root) {
    /* The colon after a step label comes from `.lead::after`, and a pseudo
       element cannot be an atom — so it would hang there on its own while the
       label typed in behind it. Hand it to the typewriter as a real character
       and switch the CSS one off (`.sol.typing`); the book keeps the CSS
       version, since nothing types there. */
    Array.prototype.forEach.call(root.querySelectorAll('.sol'), function (s) {
      s.classList.add('typing');
    });
    Array.prototype.forEach.call(root.querySelectorAll('.lead'), function (l) {
      if (!l.__colon) { l.appendChild(document.createTextNode(':')); l.__colon = true; }
    });

    Array.prototype.forEach.call(root.querySelectorAll('.writing'), function (el) {
      if (el.__atoms) return;                     // already built
      var atoms = [];
      collectAtoms(el, atoms);
      var cost = [];
      var total = 0;
      atoms.forEach(function (a) {
        if (!(a.hasAttribute && a.hasAttribute('data-free'))) total++;
        cost.push(total);
      });
      el.__atoms = atoms;
      el.__cost = cost;
      el.__chars = total;
      if (instant) showAll(el);
    });
  }

  function showAll(el) {
    if (el.__raf) { window.cancelAnimationFrame(el.__raf); el.__raf = 0; }
    (el.__atoms || []).forEach(function (a) { a.classList.remove('pending'); });
    dropPencil(el);
  }

  /* The pencil sits at the character being written, so it tracks the text
     across line wraps and stops the moment the characters run out — rather
     than sweeping the full width of the block whether there is text there or
     not. Positioned against the fragment, which solutions.css makes relative.
     getBoundingClientRect is in screen pixels, so undo reveal's scale. */
  function movePencil(el, atom, deck) {
    var p = el.__pencil;
    if (!p) {
      p = document.createElement('span');
      p.className = 'sol-pencil';
      p.textContent = '✍🏽';
      el.appendChild(p);
      el.__pencil = p;
    }
    var s = (deck.getScale && deck.getScale()) || 1;
    var a = atom.getBoundingClientRect();
    var h = el.getBoundingClientRect();
    p.style.left = ((a.right - h.left) / s) + 'px';
    p.style.top = ((a.top - h.top) / s) + 'px';
  }

  function dropPencil(el) {
    if (el.__pencil) {
      el.__pencil.parentNode && el.__pencil.parentNode.removeChild(el.__pencil);
      el.__pencil = null;
    }
  }

  /* Type an element in at cfg.charsPerSecond. Driven off requestAnimationFrame
     against elapsed time rather than a per-character setTimeout chain, so a
     dropped frame does not slow the line down. */
  function typeIn(el, deck, onDone) {
    var atoms = el.__atoms || [];
    if (instant || restoring || !atoms.length) { showAll(el); onDone(); return; }

    var cost = el.__cost;
    var shown = 0;
    var start = null;

    function frame(now) {
      if (start === null) start = now;
      var budget = (now - start) / 1000 * cfg.charsPerSecond;
      var last = null;
      while (shown < atoms.length && cost[shown] <= budget) {
        atoms[shown].classList.remove('pending');
        last = atoms[shown];
        shown++;
      }
      if (shown < atoms.length) {
        if (last) movePencil(el, last, deck);
        el.__raf = window.requestAnimationFrame(frame);
      } else {
        el.__raf = 0;
        dropPencil(el);
        onDone();
      }
    }
    el.__raf = window.requestAnimationFrame(frame);
  }

  /* Retire an element once it has finished writing.

     `written` (see solutions.css) pins it visible for good. `disabled` is
     reveal's own opt-out: every navigation query is
     `.fragment:not(.disabled)`, so a disabled fragment stops being a step —
     which is the point. Written work should not have to be clicked past again.

     The renumbering is not optional. Fragments.goto() derives the current index
     from the data-fragment-index of the last visible non-disabled fragment, so
     if steps 0-4 were disabled the remaining ones would still claim indices
     5-19 while reveal computed 0, and pressing forward would match nothing and
     silently skip to the next slide. Re-indexing what is left from 0 keeps
     reveal's arithmetic honest. */
  function retire(el) {
    if (el.classList.contains('written')) return;
    showAll(el);
    el.classList.add('written', 'disabled');

    var slide = el.closest('section');
    if (!slide) return;
    var i = 0;
    Array.prototype.forEach.call(
      slide.querySelectorAll('.fragment:not(.disabled)'), function (f) {
        f.setAttribute('data-fragment-index', i++);
      });
  }

  /* Chalk while the line is being typed — but only inside a solution. The deck
     has plenty of unrelated fragments and they must stay silent.

     The clip is loaded from the deck's own plugin folder rather than a CDN, so
     a lecture with no internet still has sound. Advancing a fragment is a user
     gesture, so autoplay policy is satisfied; the catch is for the cases where
     it is not (e.g. fragment restored from the URL hash on load). */
  function playChalk(ms) {
    if (!chalk || restoring || instant || ms <= 0) return;
    try {
      chalk.currentTime = 0;
      var p = chalk.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) { /* no sound is never worth breaking a lecture over */ }
    window.clearTimeout(chalk.__stop);
    chalk.__stop = window.setTimeout(function () {
      chalk.pause();
      chalk.currentTime = 0;
    }, ms);
  }

  function slideKey(deck) {
    var i = deck.getIndices();
    return i.h + '.' + (i.v || 0);
  }

  function initState(deck) {
    deck.on('fragmentshown', function (event) {
      /* Several elements share one step when grouped with data-step, and reveal
         reports those in event.fragments; event.fragment is only the first. */
      var shown = event.fragments || (event.fragment ? [event.fragment] : []);
      var mine = Array.prototype.filter.call(shown, function (el) {
        return el && el.closest && el.closest('.sol');
      });
      if (!mine.length) return;

      /* If the previous line is still typing, finish it instantly rather than
         run two at once — the presenter has already moved on. */
      Array.prototype.forEach.call(
        deck.getCurrentSlide().querySelectorAll('.writing'), function (el) {
          if (el.__raf && mine.indexOf(el) === -1) retire(el);
        });

      var chars = 0;
      mine.forEach(function (el) { chars = Math.max(chars, el.__chars || 0); });
      playChalk((chars / cfg.charsPerSecond) * 1000);

      mine.forEach(function (el) {
        typeIn(el, deck, function () { retire(el); });
      });

      if (!deck.availableFragments().next) completed[slideKey(deck)] = true;
    });

    /* Reveal resets a slide's fragments whenever you enter it going forward. On
       a 20-fragment solution that would mean clicking through the whole thing
       again just to get past a slide you have already worked. */
    deck.on('slidechanged', function (event) {
      var slide = event.currentSlide;
      if (!slide || !slide.querySelector('.sol')) return;
      if (!completed[slideKey(deck)]) return;
      restoring = true;
      var guard = 0;
      while (deck.availableFragments().next && ++guard < 300) deck.nextFragment();
      restoring = false;
    });
  }

  return {
    id: 'solution',

    init: function (deck) {
      var user = (deck && deck.getConfig && deck.getConfig().solution) || {};
      cfg = {
        sound: user.sound !== undefined ? user.sound : DEFAULTS.sound,
        charsPerSecond: user.charsPerSecond || DEFAULTS.charsPerSecond,
        soundSrc: user.soundSrc || DEFAULTS.soundSrc
      };

      /* PDF export needs every character on the page at once, and a viewer who
         has asked for reduced motion should not be made to watch it type. */
      instant = /print-pdf/gi.test(window.location.search) ||
        (window.matchMedia &&
         window.matchMedia('(prefers-reduced-motion: reduce)').matches);

      var hosts = Array.prototype.slice.call(
        document.querySelectorAll('.Solution[data-src]'));
      if (!hosts.length) return Promise.resolve();

      if (cfg.sound && !instant) {
        chalk = new Audio(cfg.soundSrc);
        chalk.volume = 0.25;
        chalk.preload = 'auto';
      }
      initState(deck);

      return Promise.all(hosts.map(function (host) {
        var src = host.getAttribute('data-src');
        return load(src).then(function (html) {
          host.innerHTML = html;
          selectPart(host, host.getAttribute('data-part'));
          useSlideText(host);
          fragmentize(host);
        }).catch(function (err) {
          /* Never take the deck down over one missing solution. The most
             common cause is opening index.html over file:// — fetch is
             blocked there; serve the deck over http instead. */
          console.warn('[RevealSolution] could not load ' + src, err);
          host.innerHTML = '<p class="sol-error">⚠ solution not loaded (' +
            src + ') — serve the deck over http://, not file://</p>';
        });
      })).then(function () {
        return typeset(hosts);
      }).then(function () {
        /* Atoms can only be built once MathJax has produced its <mjx-c>
           elements — before that there is nothing to split. Splitting text
           earlier would also hand MathJax one span per character instead of the
           `\(...\)` source it needs. */
        whenMathJaxSettles(function () {
          hosts.forEach(buildAtoms);
        });
      });
    }
  };
};
