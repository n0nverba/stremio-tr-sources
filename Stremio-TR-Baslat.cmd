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

echo [2/2] Sunucu baslatiliyor (Port: 7000)...
echo.
echo ============================================================
echo   Yonetim Paneli : http://127.0.0.1:7000/admin/
echo   Eklenti Adresi : http://127.0.0.1:7000/manifest.json
echo.
echo   * Bu pencere ACIK kaldigi surece eklenti Stremio'da calisacaktir.
echo   * Kapatmak icin pencereyi kapatin veya Ctrl+C tusuna basin.
echo ============================================================
echo.

start "" "http://127.0.0.1:7000/admin/"
start "" "stremio://127.0.0.1:7000/manifest.json"

node dist/index.js
set "exitCode=%ERRORLEVEL%"
pause
exit /b %exitCode%
