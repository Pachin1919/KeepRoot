@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-keeproot.ps1" -Mode Install %*
set "keeprootExit=%ERRORLEVEL%"
echo.
if "%keeprootExit%"=="0" (echo Keeproot installation finished.) else (echo Installation failed. Read the reason above.)
pause
exit /b %keeprootExit%
