@echo off
cd /d "%~dp0"

echo ================================================
echo   Setup Center -- License Ledger
echo ================================================
echo.
echo   1  List all records      (list)
echo   2  Statistics only       (status)
echo   3  Verify one code       (verify)
echo   4  Mark: ACTIVATED
echo   5  Mark: back to UNUSED
echo   6  Mark: REVOKED
echo.
echo   0  Exit
echo.

set /p CHOICE=Choose a number:

if "%CHOICE%"=="1" goto list
if "%CHOICE%"=="2" goto status
if "%CHOICE%"=="3" goto verify
if "%CHOICE%"=="4" goto mark_activated
if "%CHOICE%"=="5" goto mark_unused
if "%CHOICE%"=="6" goto mark_revoked
if not defined CHOICE goto bad
if "%CHOICE%"=="0" exit /b 0
:bad
echo Not understood. Please run this file again.
pause
exit /b 1

:list
license_admin.exe list
goto done

:status
license_admin.exe status
goto done

:verify
echo.
echo Paste the whole license code (like SC-ABCDE-23456-FGHJK-VWXYZ)
echo.
set /p CODE=Code:
if not defined CODE goto done
echo.
license_admin.exe verify %CODE%
goto done

:mark_activated
echo.
set /p ID=Serial number (e.g. 137):
if not defined ID goto done
set /p DEV=Device hash of the other machine (press Enter if unknown):
set /p NOTE=Note, e.g. who you gave it to (can be empty):
echo.
if not defined DEV goto act_nodev
license_admin.exe mark %ID% activated %DEV% --note "%NOTE%"
goto done

:act_nodev
license_admin.exe mark %ID% activated "" --note "%NOTE%"
goto done

:mark_unused
echo.
set /p ID=Serial number (e.g. 137):
if not defined ID goto done
echo.
license_admin.exe mark %ID% unused
goto done

:mark_revoked
echo.
set /p ID=Serial number (e.g. 137):
if not defined ID goto done
echo.
license_admin.exe mark %ID% revoked
goto done

:done
echo.
echo --- Done ---
echo.
pause
