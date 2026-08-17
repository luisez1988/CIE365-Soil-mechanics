# Class bell

`start_class.ps1` looks for the file named by `bell_sound` in `class_config.json`
(by default `assets/sounds/bell.mp3`) and plays it at the class start time.

Drop any `.mp3` or `.wav` here and point `bell_sound` at it. Something short —
2 to 4 seconds — works best.

If the file is missing, the script falls back to a built-in six-note chime played
through the PC speaker, so the bell works whether or not you add a sound file.
