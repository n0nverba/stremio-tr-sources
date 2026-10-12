@echo off
setlocal
cd /d "%~dp0"
call npm.cmd run sources:check -- --selected
set "sourceCheckExitCode=%ERRORLEVEL%"
pause
exit /b %sourceCheckExitCode%
