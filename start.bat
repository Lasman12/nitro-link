@echo off
rem NITRO LINK - double-click to play locally.
rem Starts a small local web server and opens the game in your browser.
cd /d "%~dp0"
set PORT=8777
echo.
echo   NITRO LINK is running at http://localhost:%PORT%
echo   Keep this window open while you play. Close it to stop.
echo.
start "" "http://localhost:%PORT%"
where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server %PORT% --bind 127.0.0.1
) else (
  where py >nul 2>nul
  if %errorlevel%==0 (
    py -m http.server %PORT% --bind 127.0.0.1
  ) else (
    echo   Python was not found. Install it from https://www.python.org/downloads/
    echo   or upload the folder to GitHub Pages and play from there.
    pause
  )
)
