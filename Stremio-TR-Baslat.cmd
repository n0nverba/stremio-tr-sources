@echo off
title Stremio TR Sources
setlocal
cd /d "%~dp0"

echo ============================================================
echo           Stremio TR Sources Baslatiliyor...
echo ============================================================
echo.

if not exist "dist\index.js" (
    echo [1/2] Ilk derleme yapiliyor...
    call npm.cmd run build
    if errorlevel 1 (
        echo Derleme basarisiz oldu.
        pause
        exit /b 1
    )
)

for /f "tokens=*" %%i in ('powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias 'Ethernet*', 'Wi-Fi*' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty IPAddress -First 1"') do set "LAN_IP=%%i"
if "%LAN_IP%"=="" (
    for /f "tokens=*" %%i in ('powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -like '192.168.*' } | Select-Object -ExpandProperty IPAddress -First 1"') do set "LAN_IP=%%i"
)
if "%LAN_IP%"=="" set "LAN_IP=127.0.0.1"

echo ============================================================
echo   Yonetim Paneli : http://127.0.0.1:7000/admin/
echo   Eklenti (Ag)   : http://%LAN_IP%:7000/manifest.json (Mobil/TV/PC)
echo   Eklenti (PC)   : http://127.0.0.1:7000/manifest.json
echo.
echo   * Bu pencere ACIK kaldigi surece eklenti Stremio'da calisacaktir.
echo   * Kapatmak icin pencereyi kapatin veya Ctrl+C tusuna basin.
echo ============================================================
echo.

start "" "http://127.0.0.1:7000/admin/"
start "" "stremio://%LAN_IP%:7000/manifest.json"

node dist/index.js
set "exitCode=%ERRORLEVEL%"
pause
exit /b %exitCode%
