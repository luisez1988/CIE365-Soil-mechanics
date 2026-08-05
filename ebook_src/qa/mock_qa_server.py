#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Local mock of the Apps Script Q&A endpoint, for testing the ebook client
without a Google account.

    python ebook_src/qa/mock_qa_server.py            # normal behavior, port 8765
    python ebook_src/qa/mock_qa_server.py --broken   # every response is an HTML
                                                     # page (simulates a
                                                     # misconfigured deployment)

Point ebook_src/config.json at it ("qa_endpoint": "http://localhost:8765"),
rebuild, and serve the repo with `python -m http.server 8000` so the page
(:8000) and the API (:8765) are genuinely cross-origin.

Known roster ID: 200123456 (name "Mock Student"). POSTed questions are
auto-"answered" in memory so a page reload shows the full round trip.

Like the real Apps Script, this server implements NO OPTIONS handler:
a client that triggers a CORS preflight fails here exactly as it would live.
"""

import json
import sys
from datetime import date
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

BROKEN = '--broken' in sys.argv
ROSTER = {'200123456': 'Mock Student'}

ITEMS = [
    {'q': 'Does the datum for total head have to be at the ground surface?',
     'a': 'No — the datum is arbitrary; only differences in total head matter. '
          'Pick whatever elevation makes the numbers easy.',
     'date': str(date.today())},
    {'q': 'Why is the hydraulic gradient dimensionless?',
     'a': 'It is a length divided by a length: change in total head [L] over '
          'flow path length [L], so the units cancel.',
     'date': str(date.today())},
]


class Handler(BaseHTTPRequestHandler):

    def _send_json(self, obj):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_broken(self):
        body = b'<!DOCTYPE html><html><body><h1>Sign in</h1></body></html>'
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if BROKEN:
            self._send_broken()
            return
        params = parse_qs(urlparse(self.path).query)
        if 'ping' in params:
            self._send_json({'ok': True, 'pong': True, 'version': 1})
            return
        chapter = (params.get('chapter') or [''])[0].strip()
        if not chapter:
            self._send_json({'ok': False, 'error': 'bad_request'})
            return
        self._send_json({'ok': True, 'items': list(reversed(ITEMS))})

    def do_POST(self):
        if BROKEN:
            self._send_broken()
            return
        try:
            length = int(self.headers.get('Content-Length', 0))
            data = json.loads(self.rfile.read(length).decode('utf-8'))
        except (ValueError, KeyError):
            self._send_json({'ok': False, 'error': 'bad_request'})
            return
        if str(data.get('website') or ''):
            self._send_json({'ok': True})
            return
        sid = str(data.get('id') or '').replace(' ', '')
        question = str(data.get('question') or '').strip()
        if not sid or not str(data.get('chapter') or '').strip():
            self._send_json({'ok': False, 'error': 'bad_request'})
            return
        if not question:
            self._send_json({'ok': False, 'error': 'empty_question'})
            return
        if len(question) > 1000:
            self._send_json({'ok': False, 'error': 'question_too_long'})
            return
        if sid not in ROSTER:
            self._send_json({'ok': False, 'error': 'unknown_id'})
            return
        ITEMS.append({'q': question,
                      'a': '(mock auto-answer) Good question — see the lecture notes.',
                      'date': str(date.today())})
        print('  [MOCK] stored question from %s (%s): %s'
              % (sid, ROSTER[sid], question[:60]))
        self._send_json({'ok': True})

    def log_message(self, fmt, *args):
        print('  [MOCK] %s' % (fmt % args))


if __name__ == '__main__':
    mode = 'BROKEN (html responses)' if BROKEN else 'normal'
    print('Mock Q&A endpoint on http://localhost:8765  [%s]' % mode)
    print('Roster ID that works: 200123456')
    HTTPServer(('127.0.0.1', 8765), Handler).serve_forever()
