@echo off

echo Disabling automatic time synchronization...
reg add "HKLM\SYSTEM\CurrentControlSet\Services\W32Time\TimeProviders\NtpClient" /v "Enabled" /t REG_DWORD /d 0 /f
net stop w32time
net start w32time
echo Automatic time synchronization disabled.

REM 拷贝相关文件
xcopy "\\host.lan\Data\node" "c:\node" /E /H /C /I /Y
xcopy "\\host.lan\Data\work" "c:\work" /E /H /C /I /Y

REM 设置开机自动启动
copy "\\host.lan\Data\start.bat" "C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Startup\start.bat"

REM 方便调试
copy "\\host.lan\Data\start.bat" "C:\Users\Docker\Desktop\start.bat"

REM 准备chromedriver.exe  108
set SOURCE_PATH=C:\work\chromedriver.exe
set TARGET_DIR=%TEMP%\chromedriver\win64-108\chromedriver-win64
REM 创建目标目录（如果不存在）
if not exist "%TARGET_DIR%" (
    mkdir "%TARGET_DIR%"
)

REM 复制 chromedriver.exe 到目标目录
copy "%SOURCE_PATH%" "%TARGET_DIR%"

REM 准备chromedriver.exe  109
set SOURCE_PATH=C:\work\chromedriver\win64-109\chromedriver-win64\chromedriver.exe
set TARGET_DIR=%TEMP%\chromedriver\win64-109\chromedriver-win64
REM 创建目标目录（如果不存在）
if not exist "%TARGET_DIR%" (
    mkdir "%TARGET_DIR%"
)

REM 复制 chromedriver.exe 109 到目标目录
copy "%SOURCE_PATH%" "%TARGET_DIR%"

copy "\\host.lan\Data\Windows6.1-KB3080149-x64.msu" "C:\Windows6.1-KB3080149-x64.msu"
set TARGET_PATH=C:\Windows6.1-KB3080149-x64.msu

:: 安装更新包
echo Installing update package...
wusa %TARGET_PATH% /quiet /forcerestart

:: 检查安装是否成功
if %errorlevel% equ 0 (
    echo Installation successful. The system will now restart.
    shutdown /r /t 0
) else (
    echo Installation failed with error code %errorlevel%.
    pause
    exit /b 1
)

