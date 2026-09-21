@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ================================================
echo   Setup Center —— 台账记账
echo ================================================
echo.
echo   1  看全部记录      （等于 list）
echo   2  只看统计        （等于 status）
echo   3  验证一个码      （等于 verify）
echo   4  记：已激活
echo   5  记：退回未使用
echo   6  记：作废
echo.
echo   0  退出
echo.

set /p CHOICE=请输入数字:

if "%CHOICE%"=="1" goto list
if "%CHOICE%"=="2" goto status
if "%CHOICE%"=="3" goto verify
if "%CHOICE%"=="4" goto mark_activated
if "%CHOICE%"=="5" goto mark_unused
if "%CHOICE%"=="6" goto mark_revoked
if "%CHOICE%"=="0" exit /b 0
echo 没看懂，重新双击一次吧。
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
echo 把要验证的激活码整串粘进来（形如 SC-ABCDE-23456-FGHJK-VWXYZ）
echo.
set /p CODE=激活码:
if "%CODE%"=="" goto done
echo.
license_admin.exe verify %CODE%
goto done

:mark_activated
echo.
set /p ID=编号（例如 137）:
if "%ID%"=="" goto done
set /p DEV=对方设备哈希（不知道就直接回车）:
set /p NOTE=备注，比如发给谁（可留空）:
echo.
if "%DEV%"=="" (
    license_admin.exe mark %ID% activated "" --note "%NOTE%"
) else (
    license_admin.exe mark %ID% activated %DEV% --note "%NOTE%"
)
goto done

:mark_unused
echo.
set /p ID=编号（例如 137）:
if "%ID%"=="" goto done
echo.
license_admin.exe mark %ID% unused
goto done

:mark_revoked
echo.
set /p ID=编号（例如 137）:
if "%ID%"=="" goto done
echo.
license_admin.exe mark %ID% revoked
goto done

:done
echo.
echo --- 完成 ---
echo.
pause
