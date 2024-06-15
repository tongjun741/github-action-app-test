@echo off

REM 获取当前时间，并格式化为 "HHMMSS" 格式
for /f "tokens=1-3 delims=:." %%a in ("%TIME%") do (
    set hh=%%a
    set mm=%%b
    set ss=%%c
)

REM 去掉时间中的空格（如果小时是个位数，比如 9 点）
if %hh% lss 10 set hh=0%hh%
if %mm% lss 10 set mm=0%mm%
if %ss% lss 10 set ss=0%ss%

set currentTime=%hh%%mm%%ss%

REM 替换 URL 中的 "newline2" 为当前时间
set url=http://ds.0728123.xyz:65080/log_channel12?text=%currentTime%

REM 使用 bitsadmin 发送请求
bitsadmin /transfer myDownloadJob /download /priority normal "%url%" "%CD%\response.txt"

REM 拷贝相关文件
xcopy "\\host.lan\Data\node" "c:\node" /E /H /C /I /Y
xcopy "\\host.lan\Data\work" "c:\work" /E /H /C /I /Y

REM 设置开机自动启动
copy "\\host.lan\Data\start.bat" "C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Startup\start.bat"

set TARGET_PATH=\\host.lan\Data\Windows6.1-KB3080149-x64.msu

:: 安装更新包
echo Installing update package...
wusa %TARGET_PATH% /quiet /norestart

:: 检查安装是否成功
if %errorlevel% equ 0 (
    echo Installation successful. The system will now restart.
    shutdown /r /t 0
) else (
    echo Installation failed with error code %errorlevel%.
    pause
    exit /b 1
)

