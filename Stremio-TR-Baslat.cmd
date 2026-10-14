@echo off
title Stremio TR Sources
setlocal
cd /d "%~dp0"

echo ============================================================
echo           Stremio TR Sources Baslatiliyor...
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [HATA] Bilgisayarinizda Node.js kurulu degil!
    echo Lutfen https://nodejs.org/ adresinden Node.js kurun.
    start "" "https://nodejs.org/"
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo [Paketler] Ilk calisma: Gerekli paketler yukleniyor (npm install)...
    call npm.cmd install
    if errorlevel 1 (
        echo [HATA] Paketler yuklenemedi. Internet baglantinizi kontrol edin.
        pause
        exit /b 1
    )
)

if not exist "cloudflared.exe" (
    echo [Tunel] Guvenli HTTPS tuneli (cloudflared.exe) indiriliyor...
    powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe' -UseBasicParsing" >nul 2>nul
)

if not "%1"=="--no-update" (
    echo [Guncelleme] GitHub surum kontrolu yapiliyor...
    node scripts/updater.mjs --check-and-update
)

if not exist "dist\index.js" (
    echo [Derleme] Ilk derleme yapiliyor (npm run build)...
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

if not "%1"=="--silent" start "" "http://127.0.0.1:7000/admin/"

node dist/index.js
set "exitCode=%ERRORLEVEL%"
pause
exit /b %exitCode%
