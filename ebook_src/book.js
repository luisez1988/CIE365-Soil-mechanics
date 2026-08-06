/* Interactive course ebook — blanks + sticky-notes runtime.
   Everything is stored per-chapter in localStorage:
     "ebook:answers:<dir>"  -> { blankId: text }
     "ebook:notes:<dir>"    -> [ {id, anchor, x, y, text} ]
   Nothing is ever sent to a server. */
(function () {
  'use strict';

  var APREFIX = 'ebook:answers:';
  var NPREFIX = 'ebook:notes:';
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

  function saveJSON(key, value) {
    if (LS) LS.setItem(key, JSON.stringify(value));
  }

  /* A backup entry may be the old flat answers map or {answers, notes}. */
  function unpackEntry(entry) {
    if (entry && typeof entry === 'object' && (entry.answers || entry.notes)) {
      return { answers: entry.answers || {}, notes: entry.notes || [] };
    }
    return { answers: entry || {}, notes: [] };
  }

  function mergeNotes(existing, incoming) {
    var byId = {};
    existing.forEach(function (n) { byId[n.id] = n; });
    (incoming || []).forEach(function (n) {
      if (n && n.id) byId[n.id] = n;
    });
    return Object.keys(byId).map(function (k) { return byId[k]; });
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

    blanks.forEach(function (b) {
      b.addEventListener('input', function () {
        updateProgress();
        scheduleSave();
      });
      b.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); b.blur(); }
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
        apply(!toolbar.classList.contains('collapsed'), true);
      });
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
          if (window.MathJax && MathJax.typesetPromise) {
            MathJax.typesetPromise([qaList]).catch(function () {});
          }
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
        version: 1,
        kind: 'chapter',
        chapter: chapter,
        exported: new Date().toISOString(),
        answers: collect(),
        notes: notes
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
        notes = mergeNotes(notes, entry.notes);
        saveNotesNow();
        renderAllNotes();
        alert('Loaded: ' + matched + ' blank(s) filled' +
              (entry.notes.length ? ', ' + entry.notes.length + ' sticky note(s)' : '') + '.');
        fileInput.value = '';
      };
      reader.readAsText(file);
    });

    document.getElementById('btn-print').addEventListener('click', function () {
      window.print();
    });

    document.getElementById('btn-clear').addEventListener('click', function () {
      if (!confirm('Erase every answer and sticky note in this chapter on this device? ' +
                   'Consider "Save notes" first — this cannot be undone.')) return;
      if (LS) {
        LS.removeItem(APREFIX + chapter);
        LS.removeItem(NPREFIX + chapter);
      }
      blanks.forEach(function (b) { b.textContent = ''; });
      notes = [];
      renderAllNotes();
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
          var filled = Object.keys(answers).filter(function (k) {
            return String(answers[k]).trim().length > 0;
          }).length;
          if (filled > total) filled = total;
          chip.textContent = filled + ' / ' + total + ' blanks' +
            (noteCount ? ' · ' + noteCount + ' note' + (noteCount > 1 ? 's' : '') : '');
          chip.classList.toggle('done', total > 0 && filled >= total);
        });
    }

    var fileInput = document.getElementById('file-import');

    document.getElementById('btn-export-all').addEventListener('click', function () {
      var chapters = {};
      function ensure(dir) {
        chapters[dir] = chapters[dir] || { answers: {}, notes: [] };
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
          }
        }
      }
      download(CODE + '-all-answers-' + today() + '.json', {
        version: 1,
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
            saveJSON(NPREFIX + dir, mergeNotes(loadJSON(NPREFIX + dir, []), entry.notes));
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
