@echo off
:: produce-batch.bat — Produce 3 YouTube Shorts in one run.
:: Double-click to run, or schedule via Windows Task Scheduler.
::
:: To schedule daily at 10 AM:
::   schtasks /create /tn "YT Shorts Daily" /tr "%~f0" /sc daily /st 10:00

cd /d "%~dp0\.."
echo ═══════════════════════════════════════════
echo   YouTube Shorts — Batch Production (3x)
echo ═══════════════════════════════════════════
echo.

npx tsx src/cli.ts produce --batch 3 --verbose

echo.
echo Done. Press any key to close.
pause >nul
