@echo off
setlocal
rem AI Job Print Terminal - start the kiosk browser once (manual / troubleshooting)
rem Normal operation is the AIJobPrintKioskWatchdog scheduled task; this only helps
rem an operator who closed the kiosk window and wants it back without logging off.
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0kiosk-watchdog.ps1" -Url "https://zyidai.cn/" -Once
exit /b %ERRORLEVEL%
