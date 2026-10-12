@echo off
title Stremio TR Sources - Durum Kontrolu
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\manage-startup.ps1" -Action status
pause
