@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ================================================
echo   Setup Center —— 生成新的激活码
echo ================================================
echo.
echo   这一步会新增激活码，并追加到台账。
echo   已有的记录不会被改动。
echo.
echo   输入格式：  数量 类型
echo.
echo   例子：
echo     200 pro     生成 200 个专业版码
echo     100 free    生成 100 个免费版码
echo.
echo   直接回车 = 取消
echo.

set /p ARGS=请输入（数量 类型）:

if "%ARGS%"=="" (
    echo.
    echo 已取消，什么都没生成。
    echo.
    pause
    exit /b 0
)

echo.
echo --- 正在生成 ---
echo.

issue.exe %ARGS%
set RC=%ERRORLEVEL%

echo.
if %RC% NEQ 0 (
    echo *** 生成失败（代码 %RC%）。上面的输出里应该有原因。***
) else (
    echo *** 生成成功。台账和导出文件都已更新。***
    echo.
    echo 用「查码.exe」可以查看新生成的码。
)

echo.
pause
