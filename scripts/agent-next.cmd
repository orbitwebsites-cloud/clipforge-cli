@echo off
REM Daily producer: discover up to two fresh Minecraft uploads, generate five
REM captioned Shorts from each, and keep the posting queue stocked.
setlocal
set ROOT=%~dp0..
cd /d "%ROOT%"
if not exist "work\logs" mkdir "work\logs"
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set STAMP=%%i
echo. >> "work\logs\agent-%STAMP%.log"
echo ===== %DATE% %TIME% ===== >> "work\logs\agent-%STAMP%.log"
node src\cli.js agent --n 5 --min 15 --max 32 --recent 3 --max-videos 2 --target-pending 10 --post >> "work\logs\agent-%STAMP%.log" 2>&1
exit /b %ERRORLEVEL%
