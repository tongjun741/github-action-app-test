@echo off
REM ============================================================
REM Win7 VM 内 OEM 安装脚本（dockurr-windows 在系统装完后执行一次）
REM 关键：本阶段发生在 start.log 之前，是宿主「等待测试开始」时唯一的盲区。
REM       故把每个阶段的进度写到 \\host.lan\Data\oem.log，宿主可据此判断卡在哪一步。
REM ============================================================
set LOG=\\host.lan\Data\oem.log

echo [OEM] install.bat 开始 >> %LOG%

echo Disabling automatic time synchronization...
reg add "HKLM\SYSTEM\CurrentControlSet\Services\W32Time\TimeProviders\NtpClient" /v "Enabled" /t REG_DWORD /d 0 /f
net stop w32time
net start w32time
echo Automatic time synchronization disabled.
echo [OEM] 时间同步已关闭 >> %LOG%

REM 拷贝相关文件（node_modules 走 SMB，可能耗时数分钟）
echo [OEM] xcopy node -> c:\node 开始 >> %LOG%
xcopy "\\host.lan\Data\node" "c:\node" /E /H /C /I /Y
echo [OEM] xcopy node 完成 >> %LOG%

echo [OEM] xcopy work -> c:\work 开始（含 node_modules，最慢的一步） >> %LOG%
xcopy "\\host.lan\Data\work" "c:\work" /E /H /C /I /Y
echo [OEM] xcopy work 完成 >> %LOG%

REM 设置开机自动启动
copy "\\host.lan\Data\start.bat" "C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Startup\start.bat"
echo [OEM] start.bat 已放入启动目录 >> %LOG%

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

:: 安装更新包（KB3080149：SHA-2 代码签名支持，Win7 上客户端能跑起来的前提之一）
echo Installing update package...
echo [OEM] wusa KB3080149 开始 >> %LOG%
wusa %TARGET_PATH% /quiet /forcerestart
REM 无人值守：无论 wusa 成功与否都必须重启进入「登录自启」阶段，
REM 绝不能用 pause（会让 VM 永久挂在无人应答的按键提示上）。
if %errorlevel% equ 0 (
    echo [OEM] KB3080149 安装成功，重启 >> %LOG%
) else (
    echo [OEM] 警告: KB3080149 返回 %errorlevel%，仍继续重启 >> %LOG%
)
shutdown /r /t 0

