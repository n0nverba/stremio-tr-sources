@echo off
title Stremio TR Sources - Guncelleyici
setlocal
cd /d "%~dp0"

echo ============================================================
echo           Stremio TR Sources - Guncelleyici
echo ============================================================
echo.

node scripts/updater.mjs --apply

echo.
pause
