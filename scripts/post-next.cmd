@echo off
REM Wrapper invoked by Windows Task Scheduler. Keeps its own dated log so a
REM failed slot can be diagnosed after the fact.
setlocal
set ROOT=%~dp0..
cd /d "%ROOT%"
if not exist "work\logs" mkdir "work\logs"
REM %DATE% formatting is locale-dependent; ask PowerShell for a sortable date.
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set STAMP=%%i
echo. >> "work\logs\post-%STAMP%.log"
echo ===== %DATE% %TIME% ===== >> "work\logs\post-%STAMP%.log"
node src\cli.js post-next >> "work\logs\post-%STAMP%.log" 2>&1
exit /b %ERRORLEVEL%
