@echo off
REM Double-click this to start class: serves the repo, opens a deck, plays the
REM Spotify playlist, then rings a bell and stops the music at the class time.
REM
REM Extra options are passed straight through, e.g.
REM     start_class.bat -Deck 1D_flow
REM     start_class.bat -Deck Consolidation -BellTime 14:05
REM     start_class.bat -Playlist spotify:playlist:xxxxxxxxxxxx
REM     start_class.bat -FadeSeconds 15
REM     start_class.bat -NoMusic

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_class.ps1" %*

REM Keep the window up if the script stopped with an error.
if errorlevel 1 (
    echo.
    pause
)
