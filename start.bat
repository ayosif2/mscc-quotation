@echo off
:: ════════════════════════════════════════════════════════════
:: FILE 5: start.bat  (save in your project root folder)
:: Double-click this file to launch the MSCC Quotation System
:: ════════════════════════════════════════════════════════════

title MSCC Quotation System
setlocal enabledelayedexpansion

echo.
echo  ========================================
echo   MSCC Quotation System — Starting...
echo  ========================================
echo.

:: Check if node_modules exists, install if not
if not exist "node_modules\" (
    echo  First run detected. Installing dependencies...
    echo  This may take a few minutes. Please wait.
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo  ERROR: npm install failed.
        echo  Make sure Node.js is installed from https://nodejs.org
        pause
        exit /b 1
    )
    echo.
    echo  Dependencies installed successfully.
    echo.
)

:: Build the React app
echo  Building frontend...
call npm run build
if errorlevel 1 (
    echo.
    echo  ERROR: Build failed. Check the error above.
    pause
    exit /b 1
)

echo.
echo  Frontend built successfully.
echo.
echo  Starting server...
echo.

:: Start the server in its own minimized window so this script can carry on
start "MSCC Server" /min cmd /c "node server.js"

:: Give the server a moment to bind before we point a tunnel at it
timeout /t 3 /nobreak >nul

:: ─── Locate cloudflared: same folder as this script, then C:\cloudflared\, then PATH ──
set "CLOUDFLARED="
if exist "%~dp0cloudflared.exe" set "CLOUDFLARED=%~dp0cloudflared.exe"
if not defined CLOUDFLARED if exist "C:\cloudflared\cloudflared.exe" set "CLOUDFLARED=C:\cloudflared\cloudflared.exe"
if not defined CLOUDFLARED (
    where cloudflared.exe >nul 2>nul && set "CLOUDFLARED=cloudflared.exe"
)

set "TUNNEL_URL="
if defined CLOUDFLARED (
    echo  Starting public tunnel...
    set "TUNNEL_LOG=%TEMP%\mscc_tunnel.log"
    set "TUNNEL_RUNNER=%TEMP%\mscc_run_tunnel.bat"
    if exist "!TUNNEL_LOG!" del "!TUNNEL_LOG!"
    if exist "!TUNNEL_RUNNER!" del "!TUNNEL_RUNNER!"

    :: Write a tiny one-line helper script so we never have to nest quotes inside "start ... cmd /c ..."
    > "!TUNNEL_RUNNER!" echo "!CLOUDFLARED!" tunnel --url http://localhost:3001 ^> "!TUNNEL_LOG!" 2^>^&1
    start "MSCC Tunnel" /min "!TUNNEL_RUNNER!"

    :: PowerShell does its own retry loop (up to ~15s) and prints the URL once cloudflared logs it, or nothing if it times out
    for /f "usebackq delims=" %%u in (`powershell -NoProfile -Command "$u=$null; for($i=0;$i -lt 15 -and -not $u;$i++){Start-Sleep -Seconds 1; if(Test-Path '!TUNNEL_LOG!'){$m=Select-String -Path '!TUNNEL_LOG!' -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1; if($m){$u=$m.Matches[0].Value}}}; $u"`) do (
        set "TUNNEL_URL=%%u"
    )
) else (
    echo  cloudflared.exe not found ^(checked this folder, C:\cloudflared\, and PATH^).
    echo  Download it from https://github.com/cloudflare/cloudflared/releases if you want a public link.
)

:: ─── LAN IP, via PowerShell so it doesn't depend on Windows' display language ──
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceAlias -notmatch 'Loopback' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1 -ExpandProperty IPAddress)"`) do (
    set "LANIP=%%i"
)

echo.
echo  ========================================
echo   MSCC Quotation System — Ready
echo  ========================================
echo   Local:    http://localhost:3001
if defined LANIP (
    echo   Network:  http://!LANIP!:3001
) else (
    echo   Network:  could not detect LAN IP — check ipconfig manually
)
if defined TUNNEL_URL (
    echo   Public:   !TUNNEL_URL!
) else if defined CLOUDFLARED (
    echo   Public:   not ready yet — check !TUNNEL_LOG!
) else (
    echo   Public:   n/a ^(cloudflared not found^)
)
echo  ========================================
echo.
echo  Server and tunnel keep running in their own windows.
echo  Closing this window only stops this status screen.
echo.
pause