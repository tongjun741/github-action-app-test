@echo off
REM ============================================================
REM  Win7 Docker VM 内 autorun 入口（由 \\host.lan\Data\start.bat 调用）
REM  挂载点：win7/shared      ->  \\host.lan\Data
REM          win7/shared/work ->  c:\work
REM
REM  Run#26 实测：start.log 停在「exe 定位结束 CLI=[]」后 25 分钟零增长，
REM  卡点在「安装客户端」块的首条 echo 之前。三个嫌疑：
REM    ① SMB 写挂起（echo 全部直写共享，共享一抖动脚本就失明+卡死）
REM    ② cmd 括号块内放 :WaitInstall 标签（解析雷区，块行为未定义）
REM    ③ installer.exe /S 无超时无退出码
REM  本版修复（2026-10-10）：
REM    A. 运行期日志一律写本地 c:\work\boot-local.log；后台 logsync.bat 每 20s
REM       同步到共享 start.log（独立进程，同步挂起不影响主流程）
REM    B. 所有标签移到顶层，绝不放进括号块
REM    C. installer 启动后轮询（120×5s=10min 上限），超时 taskkill 并如实记录
REM    D. MapDrive 有界重试（60 次×10s），持续失败重启 VM 而非死循环
REM ============================================================
set NODE_SKIP_PLATFORM_CHECK=1
set SHARE=\\host.lan\Data
set LLOG=c:\work\boot-local.log

cd /d c:\work
echo == verify-win7 start %DATE% %TIME% == >> %LLOG%

REM ---- 生成并启动后台日志同步器（独立进程，SMB 挂起只挂同步器不挂主脚本） ----
(
  echo @echo off
  echo :Sync
  echo ping -n 21 127.0.0.1 ^>nul
  echo net use \\host.lan\Data /persistent:no ^>nul 2^>^&1
  echo copy /y c:\work\boot-local.log \\host.lan\Data\start.log ^>nul 2^>^&1
  echo goto Sync
) > c:\work\logsync.bat
start /b "" cmd /c c:\work\logsync.bat

REM ---- 映射共享（有界重试；持续失败重启 VM 而非死循环） ----
set /a _MD=0
:MapDrive
net use %SHARE% /persistent:no >nul 2>&1
if not errorlevel 1 goto Mapped
set /a _MD+=1
echo [%TIME%] 映射共享失败(第 %_MD% 次)，10s 后重试 >> %LLOG%
if %_MD% LSS 60 (
  timeout /t 10 >nul
  goto MapDrive
)
echo [%TIME%] 共享持续不可达(10 分钟)，重启 VM 重试 >> %LLOG%
copy /y %LLOG% %SHARE%\start.log >nul 2>&1
shutdown /r /t 10
exit /b 2
:Mapped
echo [%TIME%] 共享 %SHARE% 可用 >> %LLOG%

REM ---- 开机脚印（本地 + 共享双写） ----
echo [boot] %DATE% %TIME% >> %LLOG%
echo [boot] %DATE% %TIME% >> %SHARE%\boots.log

REM ---- 读取宿主写入的验证配置（KEY=VALUE，避免把登录信息写进仓库文件） ----
if exist c:\work\e2e-env.txt (
  for /f "usebackq tokens=1,* delims==" %%a in ("c:\work\e2e-env.txt") do set "%%a=%%b"
)
if not defined E2E_PLATFORM set "E2E_PLATFORM=Windows 7"
if not defined CLONE_NAME set "CLONE_NAME=UA152"
if not defined REMOTE_DEBUG_PORT set "REMOTE_DEBUG_PORT=9221"
if not defined OUT set "OUT=results-Windows_7.json"
echo [%TIME%] 表头已写 平台=%E2E_PLATFORM% 分身=%CLONE_NAME% 端口=%REMOTE_DEBUG_PORT% >> %LLOG%

REM ---- 定位客户端 exe（通配 + 过滤卸载/安装程序；中文路径会变 ????? 故不硬编码） ----
set "HD=%ProgramFiles%\HuaYoung"
if not exist "%HD%" set "HD=C:\Program Files\HuaYoung"
set "FILTER=uninst setup update crashpad report repair"
call :FindCli
echo [%TIME%] exe 定位结束 CLI=[%CLI%] >> %LLOG%

REM ---- 安装客户端（若未安装；标签全部在顶层，绝不放进括号块） ----
if defined CLI goto CliReady
echo [%TIME%] 未发现已装客户端，installer.exe /S 静默安装（上限 10 分钟） >> %LLOG%
start "" installer.exe /S
set /a _IW=0
:InstWait
set /a _IW+=1
call :FindCli
if defined CLI goto InstDone
tasklist /FI "IMAGENAME eq installer.exe" 2>nul | find /I "installer.exe" >nul
if errorlevel 1 goto InstDone
if %_IW% LSS 120 (
  timeout /t 5 >nul
  goto InstWait
)
echo [%TIME%] 安装超时(10 分钟)，taskkill installer >> %LLOG%
taskkill /F /IM installer.exe >nul 2>&1
:InstDone
call :FindCli
echo [%TIME%] 安装后 CLI=[%CLI%] (轮询 %_IW% 次) >> %LLOG%
if defined CLI goto CliReady
echo [%TIME%] 致命：安装后仍无客户端 exe，放弃本轮 >> %LLOG%
copy /y %LLOG% %SHARE%\start.log >nul 2>&1
echo "verify-win7 fatal: no client exe" >> %SHARE%\done.log
exit /b 1
:CliReady
echo [%TIME%] 客户端就绪 CLI=[%CLI%] >> %LLOG%

REM ---- 给客户端 main.js 注入 remoteDebugPort + 假媒体开关 ----
echo [%TIME%] 开始 modifyMain.js（注入 remoteDebugPort=%REMOTE_DEBUG_PORT%） >> %LLOG%
c:\node\node c:\work\modifyMain.js >> %LLOG% 2>&1
echo [%TIME%] modifyMain.js 结束 >> %LLOG%

REM ---- 依赖守卫（宿主已预装 node_modules，仅缺 webdriverio 时补装） ----
if not exist c:\work\node_modules\webdriverio (
  echo [%TIME%] 缺少 webdriverio，VM 内补装依赖... >> %LLOG%
  call npm install yarn -g >> %LLOG% 2>&1
  call yarn install >> %LLOG% 2>&1
  call npm install puppeteer-core@21 --no-save >> %LLOG% 2>&1
)

REM ---- WDIO 驱动主壳：登录 -> 打开目标分身 -> 连分身内核 9221 跑验证 ----
echo [%TIME%] == start e2e-verify == >> %LLOG%
c:\node\node c:\work\tests\e2e-verify.cjs >> %LLOG% 2>&1
echo [%TIME%] e2e-verify 退出码=%errorlevel% >> %LLOG%

REM ---- 收尾：立即同步 + done.log（直写共享，宿主靠它结束等待） ----
copy /y %LLOG% %SHARE%\start.log >nul 2>&1
echo "verify-win7 done" >> %SHARE%\done.log
echo "done" >> %SHARE%\done.log
REM 不要 pause：无人值守，pause 会让 cmd 永久挂起占住会话。
exit /b 0

:FindCli
set CLI=
for /f "delims=" %%i in ('dir /b "%HD%\*.exe" 2^>nul ^| findstr /I /V "%FILTER%"') do set "CLI=%HD%\%%i"
exit /b 0
