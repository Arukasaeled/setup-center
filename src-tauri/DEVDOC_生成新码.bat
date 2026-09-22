@echo off
cd /d "%~dp0"

echo ================================================
echo   Setup Center -- Generate New License Codes
echo ================================================
echo.
echo   This adds new codes and appends them to the ledger.
echo   Existing records are not touched.
echo.
echo   Format:   COUNT TIER
echo.
echo   Examples:
echo     200 pro     generate 200 pro codes
echo     100 free    generate 100 free codes
echo.
echo   Press Enter alone = cancel
echo.
echo   New plaintext pages go to D:\license-export\ (next to p01..p10),
echo   NOT into this devkit folder.
echo.

set /p ARGS=Enter (count tier):

if not defined ARGS goto cancelled

echo.
echo --- Generating ---
echo.

rem Ledger = this folder (exe-adjacent, auto-detected)
rem Plaintext export = two levels up, i.e. D:\license-export\
rem   %~dp0 already ends with a backslash, so use ..\..
rem --overwrite-export: overwrite the page number when run twice on the
rem   same day, instead of stacking new codes into the same page
issue.exe %ARGS% --export-dir "%~dp0..\.." --overwrite-export
set RC=%ERRORLEVEL%

echo.
if %RC% NEQ 0 goto failed

echo *** OK. Ledger and plaintext page are both updated. ***
echo.
echo Plaintext pages are in D:\license-export\, named like:
echo     codes_export_YYYYMMDD_pNN.txt
echo Use the lookup tool to find a code by serial number.
goto finish

:failed
echo *** FAILED (exit code %RC%). ***
echo The reason should be in the output above.
goto finish

:cancelled
echo.
echo Cancelled. Nothing was generated.

:finish
echo.
pause
