@echo off
title Stremio TR Sources - Durdur
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\manage-startup.ps1" -Action stop
pause
