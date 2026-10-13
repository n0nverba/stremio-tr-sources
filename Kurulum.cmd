@echo off
title Stremio TR Sources - Tek Tikla Otomatik Kurulum
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\manage-startup.ps1" -Action install
pause
