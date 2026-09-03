@echo off
setlocal
title AI Job Print Terminal - Device Binding
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0provision-installed-agent.ps1"
set "RESULT=%ERRORLEVEL%"
echo.
if not "%RESULT%"=="0" echo Device binding did not complete. Review the error above and retry.
pause
exit /b %RESULT%
