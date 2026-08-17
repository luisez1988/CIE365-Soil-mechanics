"""One-time Spotify authorization for start_class.ps1.

Run this once, ever:

    python spotify_setup.py

It walks you through creating a Spotify developer app, opens a browser so you can
approve access, and writes the resulting refresh token to .spotify_auth.json
(which is gitignored -- it contains your client secret).

After that, start_class.ps1 can start and pause your class playlist on its own.
Requires Spotify Premium; playback control is not available on free accounts.
"""

import base64
import http.server
import json
import os
import secrets
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

REPO = os.path.dirname(os.path.abspath(__file__))
AUTH_FILE = os.path.join(REPO, '.spotify_auth.json')

# Spotify no longer accepts "localhost" in redirect URIs -- it must be the
# literal loopback address. This must match the app settings exactly.
CALLBACK_PORT = 8888
REDIRECT_URI = 'http://127.0.0.1:%d/callback' % CALLBACK_PORT

# The playback scopes are what actually start/pause music. The playlist-read one
# is optional: it only lets the launcher pick a random starting track in a
# private playlist. Without it, playback still works and shuffle still applies.
SCOPES = ('user-modify-playback-state user-read-playback-state '
          'playlist-read-private playlist-read-collaborative')

AUTHORIZE_URL = 'https://accounts.spotify.com/authorize'
TOKEN_URL = 'https://accounts.spotify.com/api/token'

PAGE = """<!doctype html><meta charset="utf-8">
<title>Spotify connected</title>
<style>
 body{font-family:system-ui,sans-serif;background:#121212;color:#eee;
      display:flex;height:100vh;margin:0;align-items:center;justify-content:center}
 div{text-align:center} h1{color:#1db954;font-size:1.6rem;margin:0 0 .5rem}
 p{color:#aaa}
</style>
<div><h1>%s</h1><p>%s</p></div>
"""


class CallbackHandler(http.server.BaseHTTPRequestHandler):
    """Catches the single ?code= redirect Spotify sends back, then stops."""

    result = None

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != '/callback':
            self.send_error(404)
            return

        params = urllib.parse.parse_qs(parsed.query)
        CallbackHandler.result = params

        if 'code' in params:
            body = PAGE % ('&#10003; Connected',
                           'You can close this tab and go back to the terminal.')
        else:
            body = PAGE % ('Authorization failed',
                           params.get('error', ['unknown error'])[0])

        encoded = body.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, fmt, *args):
        pass  # keep the console clean


def port_is_free(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        return sock.connect_ex(('127.0.0.1', port)) != 0


def prompt_credentials():
    print()
    print('Step 1 - create a Spotify app (only needed once)')
    print('-' * 60)
    print('  1. Open https://developer.spotify.com/dashboard and log in.')
    print('  2. Click "Create app". Any name/description will do.')
    print('  3. Under "Redirect URIs" add exactly:')
    print()
    print('         ' + REDIRECT_URI)
    print()
    print('  4. Tick the "Web API" checkbox, save, then open Settings to see')
    print('     your Client ID and Client secret.')
    print()

    client_id = input('Client ID     : ').strip()
    client_secret = input('Client secret : ').strip()

    if not client_id or not client_secret:
        sys.exit('\nBoth values are required. Nothing was written.')
    return client_id, client_secret


def post_token(client_id, client_secret, payload):
    data = urllib.parse.urlencode(payload).encode('utf-8')
    basic = base64.b64encode(
        ('%s:%s' % (client_id, client_secret)).encode('utf-8')).decode('ascii')
    req = urllib.request.Request(
        TOKEN_URL,
        data=data,
        headers={'Authorization': 'Basic ' + basic,
                 'Content-Type': 'application/x-www-form-urlencoded'},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode('utf-8', 'replace')
        sys.exit('\nSpotify rejected the token request (HTTP %d):\n  %s\n\n'
                 'The usual cause is a Client ID/secret typo, or a redirect URI\n'
                 'in the dashboard that does not exactly match:\n  %s'
                 % (exc.code, detail, REDIRECT_URI))


def main():
    if os.path.exists(AUTH_FILE):
        print('.spotify_auth.json already exists.')
        if input('Overwrite and re-authorize? [y/N] ').strip().lower() != 'y':
            print('Left the existing authorization alone.')
            return

    if not port_is_free(CALLBACK_PORT):
        sys.exit('Port %d is already in use, so the Spotify redirect cannot be\n'
                 'caught. Close whatever is using it and run this again.'
                 % CALLBACK_PORT)

    client_id, client_secret = prompt_credentials()

    state = secrets.token_urlsafe(16)
    query = urllib.parse.urlencode({
        'client_id': client_id,
        'response_type': 'code',
        'redirect_uri': REDIRECT_URI,
        'scope': SCOPES,
        'state': state,
        'show_dialog': 'true',
    })
    url = AUTHORIZE_URL + '?' + query

    print()
    print('Step 2 - approve access in the browser')
    print('-' * 60)
    print('Opening Spotify now. If nothing happens, paste this into a browser:')
    print()
    print('  ' + url)
    print()
    print('Waiting for the redirect...')

    webbrowser.open(url)

    server = http.server.HTTPServer(('127.0.0.1', CALLBACK_PORT), CallbackHandler)
    server.timeout = 5
    deadline = time.monotonic() + 300
    # Ignore stray requests (favicon.ico and friends) and keep waiting for the
    # one that actually carries the ?code=.
    while CallbackHandler.result is None and time.monotonic() < deadline:
        server.handle_request()
    server.server_close()

    if CallbackHandler.result is None:
        sys.exit('\nTimed out waiting for Spotify to redirect back.')

    params = CallbackHandler.result
    if 'code' not in params:
        sys.exit('\nAuthorization was denied: %s'
                 % params.get('error', ['unknown error'])[0])
    if params.get('state', [None])[0] != state:
        sys.exit('\nState mismatch -- the redirect did not come from the request\n'
                 'this script started. Nothing was written; please run it again.')

    tokens = post_token(client_id, client_secret, {
        'grant_type': 'authorization_code',
        'code': params['code'][0],
        'redirect_uri': REDIRECT_URI,
    })

    refresh_token = tokens.get('refresh_token')
    if not refresh_token:
        sys.exit('\nSpotify did not return a refresh token. Please run this again.')

    with open(AUTH_FILE, 'w', encoding='utf-8') as handle:
        json.dump({'client_id': client_id,
                   'client_secret': client_secret,
                   'refresh_token': refresh_token},
                  handle, indent=2)
    os.chmod(AUTH_FILE, 0o600)

    print()
    print('Done. Wrote .spotify_auth.json')
    print()
    print('That file holds your client secret and refresh token -- it is listed')
    print('in .gitignore, so keep it out of commits and do not share it.')
    print('The refresh token does not expire, so this is a one-time step.')
    print()
    print('Next: put your class playlist URI in class_config.json')
    print('(in Spotify: right-click the playlist -> Share -> Copy Spotify URI),')
    print('then launch class with start_class.bat')


if __name__ == '__main__':
    main()
