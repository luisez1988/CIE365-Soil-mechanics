<#
.SYNOPSIS
    Starts a lecture: serves the repo, opens a reveal.js deck, plays a Spotify
    playlist while students arrive, then rings a bell and stops the music at the
    class start time.

.DESCRIPTION
    Run this 5-10 minutes before class (double-click start_class.bat, or call
    this script directly). It will:

      1. ask which deck to open (or take -Deck)
      2. start "python -m http.server" from the repo root -- decks must be
         served over http:// or the worked solutions fail to fetch
      3. open the deck in your default browser
      4. start your class playlist on the Spotify desktop app
      5. count down in this window, fade the music out over the last few
         seconds, and at the bell time pause it and ring a bell

    Settings come from class_config.json; every one can be overridden with a
    switch below. Spotify needs a one-time setup: run "python spotify_setup.py".

    Anything Spotify-related that fails is reported as a warning and skipped --
    the deck always opens and the bell always rings.

.EXAMPLE
    start_class.bat
    start_class.bat -Deck 1D_flow
    start_class.bat -Deck Consolidation -BellTime 14:05
    start_class.bat -Playlist spotify:playlist:37i9dQZF1DXcBWIGoYBM5M
    start_class.bat -FadeSeconds 15
    start_class.bat -NoMusic
#>

[CmdletBinding()]
param(
    # Deck folder to open, e.g. 1D_flow. Omit for an interactive menu.
    [string] $Deck,

    # Class start time, 24-hour HH:mm. Overrides class_config.json.
    [string] $BellTime,

    # Port for the local static server.
    [int] $Port = 0,

    # Spotify volume, 0-100.
    [int] $Volume = -1,

    # A different playlist for this session, e.g. spotify:playlist:xxxx
    [string] $Playlist,

    # Seconds spent fading the music out before the bell. 0 cuts it dead.
    [int] $FadeSeconds,

    # Skip the playlist. The countdown and the bell still happen.
    [switch] $NoMusic
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 1.0

# PowerShell 5.1 still defaults to TLS 1.0/1.1, which Spotify's endpoints reject.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$RepoRoot  = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ConfigFile = Join-Path $RepoRoot 'class_config.json'
$AuthFile   = Join-Path $RepoRoot '.spotify_auth.json'

# Root folders that hold generated output or shared assets rather than a deck.
$NotDecks = @('assets', 'ebook', 'ebook_src', '__pycache__', '.git', '.vscode')


# ---------------------------------------------------------------- helpers ----

function Write-Step   ($msg) { Write-Host "  $msg" -ForegroundColor Gray }
function Write-Ok     ($msg) { Write-Host "  $msg" -ForegroundColor Green }
function Write-Warn   ($msg) { Write-Host "  ! $msg" -ForegroundColor Yellow }
function Write-Title  ($msg) {
    Write-Host ''
    Write-Host "  $msg" -ForegroundColor Cyan
    Write-Host ('  ' + ('-' * $msg.Length)) -ForegroundColor DarkGray
}

function Get-Setting {
    # Command-line value wins; otherwise fall back to class_config.json.
    param($Override, $FromConfig, $Default)
    if ($null -ne $Override -and "$Override" -ne '' -and "$Override" -ne '0' -and "$Override" -ne '-1') {
        return $Override
    }
    if ($null -ne $FromConfig -and "$FromConfig" -ne '') { return $FromConfig }
    return $Default
}

function ConvertTo-SpotifyUri {
    <#
        Spotify's "Copy link to playlist" gives a share URL, while the API wants
        a context URI. Accept either -- including a share URL pasted after the
        spotify:playlist: prefix, which is the easy mistake to make.
    #>
    param([string] $Raw)

    if (-not $Raw) { return '' }
    $value = $Raw.Trim()

    # Already a well-formed URI of any playable type: leave it alone.
    if ($value -match '^spotify:(playlist|album|artist|show):[A-Za-z0-9]{10,}$') {
        return $value
    }

    # Drop any ?si=... tracking suffix before hunting for the id.
    $bare = ($value -split '\?')[0]

    # Greedy .* so we take the LAST "playlist/" or "playlist:" in the string --
    # that is what makes the doubled-up "spotify:playlist:https://..." resolve.
    if ($bare -match '^.*playlist[:/]([A-Za-z0-9]{10,})') {
        return "spotify:playlist:$($matches[1])"
    }

    # A bare id pasted on its own.
    if ($bare -match '^[A-Za-z0-9]{10,}$') {
        return "spotify:playlist:$bare"
    }

    return $value
}

function Initialize-NativeAudio {
    # MCI plays mp3 straight from a console script, unlike SoundPlayer (wav only)
    # and without the dispatcher that WPF's MediaPlayer expects.
    if (-not ('ClassAudio' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class ClassAudio
{
    [DllImport("winmm.dll", CharSet = CharSet.Auto)]
    public static extern int mciSendString(string command, StringBuilder ret, int retLen, IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

    private const byte VK_MEDIA_STOP = 0xB2;
    private const uint KEYEVENTF_KEYUP = 0x0002;

    public static int Send(string command)
    {
        return mciSendString(command, null, 0, IntPtr.Zero);
    }

    // Stop, never play/pause: the toggle key would *start* music if the room
    // happened to be quiet already.
    public static void MediaStop()
    {
        keybd_event(VK_MEDIA_STOP, 0, 0, UIntPtr.Zero);
        keybd_event(VK_MEDIA_STOP, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    }
}
'@
    }
}

function Set-SpotifyVolume {
    param($Headers, [string] $DeviceId, [int] $Level)
    if ($Level -lt 0)   { $Level = 0 }
    if ($Level -gt 100) { $Level = 100 }
    Invoke-RestMethod -Method Put -Headers $Headers `
        -Uri "https://api.spotify.com/v1/me/player/volume?volume_percent=$Level&device_id=$DeviceId" | Out-Null
}

function Invoke-SpotifyFade {
    <#
        Ramps the volume down so it reaches silence exactly at $EndAt, rather
        than cutting the room off mid-bar. Driven off the wall clock instead of
        a fixed step count, so the round-trip time of each API call cannot make
        the fade overrun the bell.
    #>
    param($Headers, [string] $DeviceId, [int] $FromVolume, [datetime] $EndAt)

    $startAt = Get-Date
    $span = ($EndAt - $startAt).TotalSeconds
    if ($span -le 0) { return }

    while ($true) {
        $t = ((Get-Date) - $startAt).TotalSeconds / $span
        if ($t -ge 1) { break }

        # Amplitude to the power 1.5 makes the *perceived* loudness fall evenly.
        # A straight linear ramp sounds like it holds level and then drops off a
        # cliff, which is the abruptness we are trying to get rid of.
        $level = [int][Math]::Round($FromVolume * [Math]::Pow(1 - $t, 1.5))
        try { Set-SpotifyVolume $Headers $DeviceId $level } catch { }
        Write-Host ("`r   fading out... {0,3}%      " -f $level) -NoNewline -ForegroundColor DarkGray
        Start-Sleep -Milliseconds 350
    }

    try { Set-SpotifyVolume $Headers $DeviceId 0 } catch { }
}

function Send-MediaStop {
    try {
        Initialize-NativeAudio
        [ClassAudio]::MediaStop()
        Write-Ok 'Sent the media stop key'
    } catch {
        Write-Warn "Could not stop the music automatically: $($_.Exception.Message)"
    }
}

function Invoke-Chime {
    # Zero-asset fallback so the bell works before any sound file is added.
    foreach ($note in @(880, 1175, 1568)) { [Console]::Beep($note, 220) }
    Start-Sleep -Milliseconds 120
    foreach ($note in @(1568, 1175, 880)) { [Console]::Beep($note, 220) }
}

function Invoke-Bell {
    param([string] $Path)

    if (-not (Test-Path $Path)) {
        Write-Step 'No bell.mp3 found -- using the built-in chime.'
        Invoke-Chime
        return
    }

    try {
        Initialize-NativeAudio
        $ext  = [IO.Path]::GetExtension($Path).ToLowerInvariant()
        $type = 'mpegvideo'
        if ($ext -eq '.wav') { $type = 'waveaudio' }

        $alias = 'classbell'
        [ClassAudio]::Send("close $alias") | Out-Null
        if ([ClassAudio]::Send("open `"$Path`" type $type alias $alias") -ne 0) {
            throw "MCI could not open $Path"
        }
        try {
            # "wait" blocks until the clip finishes, which is what we want here.
            [ClassAudio]::Send("play $alias wait") | Out-Null
        } finally {
            [ClassAudio]::Send("close $alias") | Out-Null
        }
        Write-Ok 'Bell rung'
    } catch {
        Write-Warn "Could not play $Path ($($_.Exception.Message)) -- using the chime."
        Invoke-Chime
    }
}

function Test-PortInUse {
    param([int] $TestPort)
    $client = New-Object Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect('127.0.0.1', $TestPort, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(400)) { return $false }
        $client.EndConnect($async)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}


# ----------------------------------------------------------------- config ----

$config = $null
if (Test-Path $ConfigFile) {
    try {
        $config = Get-Content $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        Write-Warn "class_config.json could not be parsed, using defaults: $($_.Exception.Message)"
    }
} else {
    Write-Warn 'class_config.json not found, using defaults.'
}

function Get-ConfigValue {
    param([string] $Name)
    if ($null -eq $config) { return $null }
    if ($config.PSObject.Properties.Name -contains $Name) { return $config.$Name }
    return $null
}

$Port      = [int](Get-Setting $Port      (Get-ConfigValue 'port')         8000)
$BellTime  = [string](Get-Setting $BellTime (Get-ConfigValue 'bell_time')  '08:30')
$Volume    = [int](Get-Setting $Volume    (Get-ConfigValue 'music_volume') 45)
$PlaylistRaw = [string](Get-Setting $Playlist (Get-ConfigValue 'playlist_uri') '')
$PlaylistUri = ConvertTo-SpotifyUri $PlaylistRaw
$BellSound   = [string](Get-Setting $null (Get-ConfigValue 'bell_sound') 'assets/sounds/bell.mp3')
$Shuffle     = $true
if ($null -ne (Get-ConfigValue 'shuffle')) { $Shuffle = [bool](Get-ConfigValue 'shuffle') }

# Not routed through Get-Setting: 0 is a meaningful value here ("no fade"), and
# Get-Setting treats 0 as "argument not supplied".
if (-not $PSBoundParameters.ContainsKey('FadeSeconds')) {
    if ($null -ne (Get-ConfigValue 'fade_seconds')) {
        $FadeSeconds = [int](Get-ConfigValue 'fade_seconds')
    } else {
        $FadeSeconds = 8
    }
}
if ($FadeSeconds -lt 0) { $FadeSeconds = 0 }

# Today's bell, as a real DateTime.
$bellStamp = $null
foreach ($fmt in @('HH:mm', 'H:mm', 'HH:mm:ss')) {
    try {
        $parsed = [datetime]::ParseExact($BellTime, $fmt, [Globalization.CultureInfo]::InvariantCulture)
        $now = Get-Date
        $bellStamp = Get-Date -Year $now.Year -Month $now.Month -Day $now.Day `
                              -Hour $parsed.Hour -Minute $parsed.Minute -Second 0 -Millisecond 0
        break
    } catch { }
}
if ($null -eq $bellStamp) {
    throw "Could not read '$BellTime' as a time. Use 24-hour HH:mm, e.g. 08:30."
}


# ------------------------------------------------------------- deck choice ----

if (-not $Deck) {
    $defaultDeck = [string](Get-Setting $null (Get-ConfigValue 'default_deck') '')

    $decks = Get-ChildItem -Path $RepoRoot -Directory |
             Where-Object { $NotDecks -notcontains $_.Name } |
             Where-Object { Test-Path (Join-Path $_.FullName 'index.html') } |
             Sort-Object Name

    if ($decks.Count -eq 0) { throw "No decks found in $RepoRoot." }

    Write-Title 'Which deck?'
    for ($i = 0; $i -lt $decks.Count; $i++) {
        $marker = '  '
        if ($decks[$i].Name -eq $defaultDeck) { $marker = ' *' }
        Write-Host ("   {0,2}.{1} {2}" -f ($i + 1), $marker, $decks[$i].Name)
    }
    Write-Host ''
    if ($defaultDeck) {
        $answer = Read-Host "  Number (Enter for $defaultDeck)"
    } else {
        $answer = Read-Host '  Number'
    }

    if (-not $answer) {
        if (-not $defaultDeck) { throw 'No deck selected.' }
        $Deck = $defaultDeck
    } else {
        $index = 0
        if (-not [int]::TryParse($answer, [ref] $index) -or $index -lt 1 -or $index -gt $decks.Count) {
            throw "'$answer' is not one of the listed numbers."
        }
        $Deck = $decks[$index - 1].Name
    }
}

$deckPath = Join-Path $RepoRoot $Deck
if (-not (Test-Path (Join-Path $deckPath 'index.html'))) {
    throw "No index.html in '$Deck' -- is that a deck folder name?"
}


# ----------------------------------------------------------- static server ----

$serverProcess = $null   # only set when *we* started it, so we only kill ours

try {
    Write-Title "Class setup - $Deck"

    if (Test-PortInUse $Port) {
        Write-Ok "Reusing the server already listening on port $Port"
    } else {
        # Must serve from the repo root: decks reference ../assets/.
        $serverProcess = Start-Process -FilePath 'python' `
                                       -ArgumentList '-m', 'http.server', "$Port" `
                                       -WorkingDirectory $RepoRoot `
                                       -WindowStyle Hidden `
                                       -PassThru

        $ready = $false
        for ($i = 0; $i -lt 20; $i++) {
            Start-Sleep -Milliseconds 250
            if (Test-PortInUse $Port) { $ready = $true; break }
        }
        if ($ready) {
            Write-Ok "Serving $RepoRoot on port $Port"
        } else {
            throw "python -m http.server did not come up on port $Port. Is python on PATH?"
        }
    }

    $deckUrl = "http://localhost:$Port/$Deck/"
    Start-Process $deckUrl | Out-Null
    Write-Ok "Opened $deckUrl"


    # -------------------------------------------------------------- music ----

    # Populated if Spotify comes up, so the bell knows how to pause it.
    $spotifyToken  = $null
    $spotifyDevice = $null

    $musicWanted = (-not $NoMusic) -and ($bellStamp -gt (Get-Date))

    if ($NoMusic) {
        Write-Step 'Music skipped (-NoMusic).'
    } elseif ($bellStamp -le (Get-Date)) {
        Write-Warn "It is already past $BellTime -- opening the deck only, no music or bell."
    } elseif (-not (Test-Path $AuthFile)) {
        Write-Warn 'Spotify is not set up yet. Run: python spotify_setup.py'
        $musicWanted = $false
    } elseif ($PlaylistUri -notmatch '^spotify:(playlist|album|artist|show):[A-Za-z0-9]{10,}$') {
        if (-not $PlaylistRaw -or $PlaylistRaw -like '*PASTE_YOUR_PLAYLIST*') {
            Write-Warn 'No playlist set yet. Put one in class_config.json -- in Spotify, right-click the playlist -> Share -> Copy link to playlist.'
        } else {
            Write-Warn "Could not read a playlist id out of '$PlaylistRaw'."
            Write-Step 'Expected something like spotify:playlist:2lrvAdQOOHbxPsMMH6ZcpC'
            Write-Step 'or https://open.spotify.com/playlist/2lrvAdQOOHbxPsMMH6ZcpC'
        }
        $musicWanted = $false
    }

    if ($musicWanted) {
        try {
            $auth = Get-Content $AuthFile -Raw -Encoding UTF8 | ConvertFrom-Json

            # Access tokens last an hour; the refresh token is permanent.
            $basic = [Convert]::ToBase64String(
                [Text.Encoding]::UTF8.GetBytes("$($auth.client_id):$($auth.client_secret)"))
            $tokenResponse = Invoke-RestMethod -Method Post `
                -Uri 'https://accounts.spotify.com/api/token' `
                -Headers @{ Authorization = "Basic $basic" } `
                -ContentType 'application/x-www-form-urlencoded' `
                -Body @{ grant_type = 'refresh_token'; refresh_token = $auth.refresh_token }
            $spotifyToken = $tokenResponse.access_token

            $apiHeaders = @{ Authorization = "Bearer $spotifyToken" }

            # Wake the desktop client; it only registers as a device once running.
            Start-Process 'spotify:' -ErrorAction SilentlyContinue | Out-Null

            Write-Step 'Waiting for the Spotify desktop app...'
            for ($i = 0; $i -lt 30; $i++) {
                $devices = Invoke-RestMethod -Method Get `
                    -Uri 'https://api.spotify.com/v1/me/player/devices' -Headers $apiHeaders
                if ($devices.devices.Count -gt 0) {
                    # Prefer the desktop client, but take whatever is there.
                    $spotifyDevice = $devices.devices |
                        Where-Object { $_.type -eq 'Computer' } | Select-Object -First 1
                    if ($null -eq $spotifyDevice) {
                        $spotifyDevice = $devices.devices | Select-Object -First 1
                    }
                    break
                }
                Start-Sleep -Milliseconds 500
            }

            if ($null -eq $spotifyDevice) {
                throw 'no Spotify device showed up -- is the desktop app installed and logged in?'
            }

            $deviceId = $spotifyDevice.id

            # Make the device active first, so shuffle/volume/play all land on it.
            Invoke-RestMethod -Method Put -Uri 'https://api.spotify.com/v1/me/player' `
                -Headers $apiHeaders -ContentType 'application/json' `
                -Body (@{ device_ids = @($deviceId); play = $false } | ConvertTo-Json) | Out-Null
            Start-Sleep -Milliseconds 700

            if ($Shuffle) {
                try {
                    Invoke-RestMethod -Method Put -Headers $apiHeaders `
                        -Uri "https://api.spotify.com/v1/me/player/shuffle?state=true&device_id=$deviceId" | Out-Null
                } catch { Write-Warn "Could not turn shuffle on: $($_.Exception.Message)" }
            }

            try {
                Invoke-RestMethod -Method Put -Headers $apiHeaders `
                    -Uri "https://api.spotify.com/v1/me/player/volume?volume_percent=$Volume&device_id=$deviceId" | Out-Null
            } catch { Write-Warn "Could not set the volume: $($_.Exception.Message)" }

            # Shuffle still starts from the top of the playlist, so jump to a
            # random track -- otherwise every class opens with the same song.
            $playBody = @{ context_uri = $PlaylistUri }
            if ($Shuffle) {
                try {
                    $playlistId = ($PlaylistUri -split ':')[-1]
                    $meta = Invoke-RestMethod -Method Get -Headers $apiHeaders `
                        -Uri "https://api.spotify.com/v1/playlists/${playlistId}?fields=tracks.total"
                    if ($meta.tracks.total -gt 1) {
                        $playBody['offset'] = @{ position = (Get-Random -Maximum $meta.tracks.total) }
                    }
                } catch { }
            }

            Invoke-RestMethod -Method Put -Headers $apiHeaders -ContentType 'application/json' `
                -Uri "https://api.spotify.com/v1/me/player/play?device_id=$deviceId" `
                -Body ($playBody | ConvertTo-Json) | Out-Null

            Write-Ok "Playing on $($spotifyDevice.name) at $Volume%"
        } catch {
            Write-Warn "Spotify did not start: $($_.Exception.Message)"
            Write-Step 'Carrying on -- the deck is open and the bell will still ring.'
            $spotifyToken = $null
        }
    }


    # ----------------------------------------------------------- countdown ----

    if ($bellStamp -gt (Get-Date)) {
        Write-Title "Class starts at $($bellStamp.ToString('HH:mm'))"
        Write-Host '   Ctrl+C to cancel.' -ForegroundColor DarkGray
        Write-Host ''

        # We can only fade what we are driving over the API; the media-key
        # fallback has no volume control, so that path still cuts out.
        $canFade = ($FadeSeconds -gt 0) -and
                   ($null -ne $spotifyToken) -and ($null -ne $spotifyDevice)

        $fadeStart = $bellStamp
        if ($canFade) {
            # Never eat more of the countdown than we actually have.
            $available = ($bellStamp - (Get-Date)).TotalSeconds
            $fadeLength = [Math]::Min($FadeSeconds, [Math]::Max(0, $available - 1))
            if ($fadeLength -lt 1) {
                $canFade = $false
            } else {
                $fadeStart = $bellStamp.AddSeconds(-$fadeLength)
            }
        }

        # Recompute from the clock every tick rather than sleeping a fixed
        # total, so a laptop suspend cannot push the bell late.
        while ($true) {
            $now = Get-Date
            if ($now -ge $fadeStart) { break }
            $left = $bellStamp - $now
            Write-Host ("`r   T-{0:hh\:mm\:ss}      " -f $left) -NoNewline -ForegroundColor White
            Start-Sleep -Milliseconds 500
        }

        $apiHeaders = @{ Authorization = "Bearer $spotifyToken" }

        if ($canFade) {
            Invoke-SpotifyFade $apiHeaders $spotifyDevice.id $Volume $bellStamp
            # The fade lands on the bell, but a slow last call can undershoot.
            while ((Get-Date) -lt $bellStamp) { Start-Sleep -Milliseconds 50 }
        }

        Write-Host "`r   T-00:00:00      "
        Write-Host ''

        # -------------------------------------------------------- the bell ----

        if ($null -ne $spotifyToken -and $null -ne $spotifyDevice) {
            try {
                Invoke-RestMethod -Method Put -Headers $apiHeaders `
                    -Uri "https://api.spotify.com/v1/me/player/pause?device_id=$($spotifyDevice.id)" | Out-Null
                if ($canFade) { Write-Ok "Music faded out over ${FadeSeconds}s and paused" }
                else          { Write-Ok 'Music paused' }
            } catch {
                Write-Warn "Could not pause over the API, sending the media stop key instead."
                Send-MediaStop
            }
            # Put the volume back so the playlist is not silent if you resume it
            # later -- the fade left the device at 0.
            if ($canFade) {
                try { Set-SpotifyVolume $apiHeaders $spotifyDevice.id $Volume } catch { }
            }
        } elseif (-not $NoMusic) {
            # Nothing was started by us, but something may still be playing.
            Send-MediaStop
        }

        Invoke-Bell (Join-Path $RepoRoot ($BellSound -replace '/', '\'))

        Write-Host ''
        Write-Host '   *** Class time ***' -ForegroundColor Magenta
    }


    # ------------------------------------------------------------ hold on ----

    Write-Host ''
    Write-Host "   Deck is live at http://localhost:$Port/$Deck/" -ForegroundColor Gray
    Write-Host '   Leave this window open. Ctrl+C when class ends.' -ForegroundColor DarkGray
    while ($true) { Start-Sleep -Seconds 30 }

} finally {
    if ($null -ne $serverProcess) {
        Write-Host ''
        Write-Host '   Stopping the local server...' -ForegroundColor DarkGray
        try {
            Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
        } catch { }
    }
}
