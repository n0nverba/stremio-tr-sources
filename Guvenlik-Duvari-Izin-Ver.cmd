@echo off
title Stremio TR Sources - Guvenlik Duvari Izni
cd /d "%~dp0"
echo ============================================================
echo   Stremio TR Sources - Guvenlik Duvari Izni
echo ============================================================
echo.
echo Telefon, tablet ve Android TV'nizin bilgisayara
echo baglanabilmesi icin Windows Guvenlik Duvarinda Port 7000'e
echo izin veriliyor...
echo.
echo Lutfen acilacak pencerede "EVET"e (Yes) basin.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd -ArgumentList '/c netsh advfirewall firewall add rule name=\"\"Stremio TR Sources (Port 7000)\"\" dir=in action=allow protocol=TCP localport=7000 profile=any && echo. && echo [OK] Guvenlik duvari izni basariyla eklendi! && echo Artik telefon ve TV sorunsuz baglanabilir. && timeout /t 5' -Verb RunAs"
echo.
echo Islem penceresi acildi. Onay verdikten sonra bu pencereyi kapatabilirsiniz.
pause
