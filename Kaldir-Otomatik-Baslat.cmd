@echo off
title Stremio TR Sources - Otomatik Baslatmayi Kaldir
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\manage-startup.ps1" -Action uninstall
pause
