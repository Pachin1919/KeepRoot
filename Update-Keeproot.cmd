@echo off
echo Close Keeproot before updating. Your existing state will be retained.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-keeproot.ps1" -Mode Update %*
set "keeprootExit=%ERRORLEVEL%"
echo.
if "%keeprootExit%"=="0" (echo Keeproot update finished.) else (echo Update failed. Read the reason above.)
pause
exit /b %keeprootExit%
