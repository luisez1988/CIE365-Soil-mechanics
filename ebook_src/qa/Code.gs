/**
 * Course ebook — student Q&A backend (Google Apps Script web app).
 *
 * Paste this whole file into Extensions → Apps Script of the Q&A Google Sheet,
 * then deploy as a Web app (Execute as: Me, Who has access: Anyone).
 * Full instructions: ebook_src/qa/SETUP.md in the course repository.
 *
 * The Sheet must contain two tabs:
 *   "Questions": Timestamp | Chapter | StudentID | Name | Question | Answer | Hide
 *   "Roster":    StudentID | Name | Questions asked  (column A formatted as Plain text)
 *
 * Column C of Roster is a running per-student total, incremented on every
 * question a student submits (regardless of chapter). Because it lives on
 * Roster rather than Questions, it survives clearing or replacing the
 * Questions tab between modules.
 *
 * Privacy: the public endpoints below return ONLY question text, answer text,
 * and date. Student IDs and names are written to the Sheet but are never
 * included in any response.
 */

var SHEET_QUESTIONS = 'Questions';
var SHEET_ROSTER = 'Roster';
var MAX_QUESTION = 1000;
var COOLDOWN_SECONDS = 60;

/* ------------------------------------------------------------------ */

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    if (p.ping) {
      return json_({ ok: true, pong: true, version: 1 });
    }
    var chapter = String(p.chapter || '').trim();
    if (!chapter) {
      return json_({ ok: false, error: 'bad_request' });
    }
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_QUESTIONS);
    if (!sheet) {
      return json_({ ok: false, error: 'server_error' });
    }
    var rows = sheet.getDataRange().getValues(); // row 0 = header
    var items = [];
    for (var i = rows.length - 1; i >= 1 && items.length < 200; i--) {
      var row = rows[i];
      if (String(row[1]).trim() !== chapter) continue;      // B Chapter
      var answer = String(row[5] || '').trim();             // F Answer
      if (!answer) continue;
      if (isTruthyCell_(row[6])) continue;                  // G Hide
      // Build items field-by-field: IDs and names must never leak.
      items.push({
        q: String(row[4] || '').trim(),                     // E Question
        a: answer,
        date: formatDate_(row[0])                           // A Timestamp
      });
    }
    return json_({ ok: true, items: items });
  } catch (err) {
    return json_({ ok: false, error: 'server_error' });
  }
}

/* ------------------------------------------------------------------ */

function doPost(e) {
  try {
    var data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return json_({ ok: false, error: 'bad_request' });
    }

    // Honeypot: silently accept without writing so bots learn nothing.
    if (String(data.website || '') !== '') {
      return json_({ ok: true });
    }

    var id = String(data.id || '').replace(/\s+/g, '');
    var chapter = String(data.chapter || '').trim();
    var question = String(data.question || '').trim();

    if (!id || !chapter) return json_({ ok: false, error: 'bad_request' });
    if (!question) return json_({ ok: false, error: 'empty_question' });
    if (question.length > MAX_QUESTION) return json_({ ok: false, error: 'question_too_long' });

    var roster = lookupRoster_(id);
    if (roster === null) return json_({ ok: false, error: 'unknown_id' });
    var name = roster.name;

    // Per-student cooldown.
    var cache = CacheService.getScriptCache();
    var cdKey = 'cd:' + id;
    if (cache.get(cdKey)) return json_({ ok: false, error: 'too_fast' });
    cache.put(cdKey, '1', COOLDOWN_SECONDS);

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return json_({ ok: false, error: 'server_error' });
    try {
      var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_QUESTIONS);
      if (!sheet) return json_({ ok: false, error: 'server_error' });
      sheet.appendRow([new Date(), chapter, id, name, question, '', false]);
      // best-effort: a failure here should not make the client think the
      // question itself (already appended above) was lost
      try { bumpRosterCount_(roster.row); } catch (bumpErr) { /* ignore */ }
    } finally {
      lock.releaseLock();
    }

    // Deliberately do not echo the resolved name back.
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: 'server_error' });
  }
}

/* ------------------------------------------------------------------ */

/** Increments a student's running question count in Roster column C. `row`
 *  is the 1-based sheet row, as returned by lookupRoster_. */
function bumpRosterCount_(row) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ROSTER);
  if (!sheet) return;
  var cell = sheet.getRange(row, 3);
  cell.setValue((Number(cell.getValue()) || 0) + 1);
}

/** Returns { name, row } for a student ID (row is 1-based, for
 *  bumpRosterCount_), or null if not registered. */
function lookupRoster_(id) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ROSTER);
  if (!sheet) return null;
  var rows = sheet.getDataRange().getValues();
  var idNoZeros = /^\d+$/.test(id) ? id.replace(/^0+/, '') : null;
  for (var i = 1; i < rows.length; i++) {
    var cell = String(rows[i][0]).replace(/\s+/g, '');
    if (!cell) continue;
    // Fallback for Sheets coercing a numeric ID column: compare without
    // leading zeros when both sides are purely numeric.
    var match = cell === id ||
      (idNoZeros !== null && /^\d+$/.test(cell) && cell.replace(/^0+/, '') === idNoZeros);
    if (match) {
      return { name: String(rows[i][1] || '').trim(), row: i + 1 };
    }
  }
  return null;
}

/** True when a Hide cell is checked/marked (checkbox true, "x", "TRUE", ...). */
function isTruthyCell_(value) {
  if (value === true) return true;
  var s = String(value || '').trim().toLowerCase();
  return s !== '' && s !== 'false';
}

function formatDate_(value) {
  try {
    return Utilities.formatDate(new Date(value), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  } catch (err) {
    return '';
  }
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
