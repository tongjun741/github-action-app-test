@echo off
REM ============================================================
REM  Win7 Docker VM 内 autorun 入口（由 \\host.lan\Data\start.bat 调用）
REM  挂载点：win7/shared      ->  \\host.lan\Data
REM          win7/shared/work ->  c:\work
REM
REM  作用：安装花漾客户端 -> modifyMain 注入 remoteDebugPort=9221
REM        -> WDIO(chromedriver 108) 驱动主壳：登录 -> 打开目标分身
REM        -> puppeteer 连「分身内核浏览器」9221 跑 14 项 -> 写 results + done.log
REM
REM  重要：不要给客户端命令行加 --remote-debugging-port，否则主壳会抢占 9221，
REM        连上的是主壳(Electron/108)而非分身内核(目标 152 内核)。
REM
REM  说明：VM 内 node 为镜像预装的 c:\node\node（node18，最后支持 Win7 的版本）
REM
REM  诊断约定（本脚本由 Startup 自启，每次登录都会重跑）：
REM    - boots.log：每次开机 append 一行 → 用于区分「脚本卡住」与「VM 反复重启」
REM    - start.log：关键步骤逐步 append [时间] 打点 → 卡在哪一行一眼可见
REM      注意 start.log 一律用 >> 追加，绝不用 > 覆盖（覆盖会把上一次的痕迹抹掉）
REM ============================================================
set NODE_SKIP_PLATFORM_CHECK=1
set SHARE=\\host.lan\Data

:MapDrive
net use %SHARE% /persistent:no >nul 2>&1
if errorlevel 1 (
  echo Failed to map %SHARE%. Waiting 10s...
  timeout /t 10 >nul
  goto MapDrive
)
echo Network share %SHARE% is accessible.
cd c:\work

REM ---- 开机脚印（append，绝不覆盖） ----
echo [boot] %DATE% %TIME% >> %SHARE%\boots.log

REM ---- 读取宿主写入的验证配置（KEY=VALUE，避免把登录信息写进仓库文件） ----
if exist c:\work\e2e-env.txt (
  for /f "usebackq tokens=1,* delims==" %%a in ("c:\work\e2e-env.txt") do set "%%a=%%b"
)
if not defined E2E_PLATFORM set "E2E_PLATFORM=Windows 7"
if not defined CLONE_NAME set "CLONE_NAME=UA152"
if not defined REMOTE_DEBUG_PORT set "REMOTE_DEBUG_PORT=9221"
if not defined OUT set "OUT=results-Windows_7.json"

REM ---- 尽早创建 start.log，避免宿主「等待测试开始」长时间空等 ----
echo "== verify-win7 start %DATE% %TIME% ==" >> %SHARE%\start.log
echo [%TIME%] 表头已写 平台=%E2E_PLATFORM% 分身=%CLONE_NAME% 端口=%REMOTE_DEBUG_PORT% >> %SHARE%\start.log

REM ---- 定位客户端 exe（通配 + 过滤卸载/安装程序；中文路径会变 ????? 故不硬编码） ----
set "HD=%ProgramFiles%\HuaYoung"
if not exist "%HD%" set "HD=C:\Program Files\HuaYoung"
set "FILTER=uninst setup update crashpad report repair"
set CLI=
echo [%TIME%] 开始定位客户端 exe (HD=%HD%) >> %SHARE%\start.log
for /f "delims=" %%i in ('dir /b "%HD%\*.exe" 2^>nul ^| findstr /I /V "%FILTER%"') do set "CLI=%HD%\%%i"
echo [%TIME%] exe 定位结束 CLI=[%CLI%] >> %SHARE%\start.log

REM ---- 安装客户端（若未安装） ----
if not defined CLI (
  echo [%TIME%] 未发现已装客户端，执行 installer.exe /S >> %SHARE%\start.log
  installer.exe /S
  set /a _WAIT=0
  :WaitInstall
  set /a _WAIT+=1
  for /f "delims=" %%i in ('dir /b "%HD%\*.exe" 2^>nul ^| findstr /I /V "%FILTER%"') do set "CLI=%HD%\%%i"
  if not defined CLI if %_WAIT% LSS 60 (
    timeout /t 5 >nul
    goto WaitInstall
  )
)
echo [%TIME%] 客户端就绪 CLI=[%CLI%] >> %SHARE%\start.log

REM ---- 给客户端 main.js 注入 remoteDebugPort=9221 + 假媒体开关 ----
echo [%TIME%] 开始 modifyMain.js（注入 remoteDebugPort=%REMOTE_DEBUG_PORT%） >> %SHARE%\start.log
c:\node\node c:\work\modifyMain.js >> %SHARE%\start.log 2>&1
echo [%TIME%] modifyMain.js 结束 >> %SHARE%\start.log

REM ---- 安装依赖（VM 内 node18：wdio/chromedriver/puppeteer-core） ----
REM 宿主机已用 Linux 的 npm 在共享目录预装整套 node_modules（含 @wdio/*、puppeteer-core），
REM 会随 OEM xcopy 一起进 c:\work。守卫改成检查真正被 require 的 webdriverio，
REM 只有它缺失时才在 VM 内补装（yarn install 在 VM 里很慢，非必要不跑）。
if not exist c:\work\node_modules\webdriverio (
  echo [%TIME%] 缺少 webdriverio，VM 内补装依赖... >> %SHARE%\start.log
  call npm install yarn -g >> %SHARE%\start.log 2>&1
  call yarn install >> %SHARE%\start.log 2>&1
  call npm install puppeteer-core@21 --no-save >> %SHARE%\start.log 2>&1
)

REM ---- WDIO 驱动主壳：登录 -> 打开目标分身 -> 连分身内核 9221 跑 14 项 ----
echo [%TIME%] == start e2e-verify == >> %SHARE%\start.log
c:\node\node c:\work\tests\e2e-verify.cjs >> %SHARE%\start.log 2>&1
echo [%TIME%] e2e-verify 退出码=%errorlevel% >> %SHARE%\start.log

echo "verify-win7 done" >> %SHARE%\done.log
echo "done" >> %SHARE%\done.log
REM 不要 pause：无人值守，pause 会让 cmd 永久挂起占住会话。
