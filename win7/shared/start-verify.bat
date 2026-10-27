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
REM 2026-10-23 盲区修复：run#39893966159 实证 boots.log 有脚印但 start.log 40 分钟
REM 未出现——logsync 后台同步一次都没成功，宿主完全看不到 VM 内进展。
REM 修：关键节点直写共享（copy 单文件，短操作，SMB 挂起风险可控），logsync 保留兜底。
copy /y %LLOG% %SHARE%\start.log >nul 2>&1

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
copy /y %LLOG% %SHARE%\start.log >nul 2>&1

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
copy /y %LLOG% %SHARE%\start.log >nul 2>&1
if defined CLI goto CliReady
echo [%TIME%] 致命：安装后仍无客户端 exe，放弃本轮 >> %LLOG%
copy /y %LLOG% %SHARE%\start.log >nul 2>&1
echo "verify-win7 fatal: no client exe" >> %SHARE%\done.log
exit /b 1
:CliReady
echo [%TIME%] 客户端就绪 CLI=[%CLI%] >> %LLOG%
copy /y %LLOG% %SHARE%\start.log >nul 2>&1

REM ---- 关闭 Windows 防火墙（run#40279717971 破案：OOBE 后防火墙弹窗拦截 ----
REM ---- 客户端/分身浏览器联网 → 打开会话卡网络层 3 轮 19min 超时。截图 OCR ----
REM ---- 实锤满屏 "Windows Firewall has blocked some features"。    ----
REM ---- 无人值守 VM 无法点弹窗；netsh 关闭三 profile 一劳永逸。   ----
netsh advfirewall set allprofiles state off >nul 2>&1
echo [%TIME%] 防火墙已关闭(errorlevel=%errorlevel%) >> %LLOG%

REM ---- 2026-10-27 run#40307091958 破案：满屏 Windows Script Host 编译错误弹窗 ----
REM ---- （截图 OCR 实锤：ScriptHost 引擎试图把 c:\work\cmd.js 当 JScript 执行，   ----
REM ---- 第 1 行 const 即语法错误 → 刷屏弹窗盖住桌面）。源头=老链路遗留 cmd.js     ----
REM ----（rsync 全仓文件到 c:\work 时带入）。处置：改名 .legacy 使任何自启/关联    ----
REM ---- 启动都找不到它；并把 .js 默认引擎强制为 CScript（静默、无 GUI 弹窗）。    ----
if exist "c:\work\cmd.js" ren "c:\work\cmd.js" "cmd.js.legacy" >nul 2>&1
cscript //B //H:CScript >nul 2>&1
echo [%TIME%] 老链路 cmd.js 已改名(.legacy)+CScript 静默模式已设 >> %LLOG%
copy /y %LLOG% %SHARE%\start.log >nul 2>&1

copy /y %LLOG% %SHARE%\start.log >nul 2>&1

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
REM 2026-10-23 盲区根治：原同步执行 e2e-verify 时共享 start.log 只靠 logsync 同步
REM （run#39898638320 实证 logsync 早夭 → e2e 全程 40 分钟宿主看不到任何进展，
REM 无法区分「还在跑」与「卡死」）。改为：后台启动 e2e-verify + 主脚本每 30s
REM 轮询 node 存活并把 LLOG 直写共享 start.log（直写已在 boot/关键节点实证可靠）。
echo [%TIME%] == start e2e-verify == >> %LLOG%
copy /y %LLOG% %SHARE%\start.log >nul 2>&1
start "" /b "c:\node\node.exe" "c:\work\tests\e2e-verify.cjs" >> %LLOG% 2>&1
set /a _EW=0
:WaitE2E
tasklist /FI "IMAGENAME eq node.exe" 2>nul | find /I "node.exe" >nul
if errorlevel 1 goto E2EDone
set /a _EW+=1
copy /y %LLOG% %SHARE%\start.log >nul 2>&1
ping -n 31 127.0.0.1 >nul
goto WaitE2E
:E2EDone
copy /y %LLOG% %SHARE%\start.log >nul 2>&1
echo [%TIME%] e2e-verify 结束(轮询 %_EW% 次) >> %LLOG%
copy /y %LLOG% %SHARE%\start.log >nul 2>&1

REM ---- 回传产物到共享（run#39928606998 破案：c:\work 是 OEM xcopy 的本地副本， ----
REM ---- results/shots 写在 VM 本地宿主永远看不到。e2e 结束后显式 copy 回共享。----
echo [%TIME%] 回传产物: results/screenshot/shots - >> %LLOG%
if exist "c:\work\results-Windows_7.json" copy /y "c:\work\results-Windows_7.json" %SHARE%\work\ >nul 2>&1
if exist "c:\work\screenshot-Windows_7.png" copy /y "c:\work\screenshot-Windows_7.png" %SHARE%\work\ >nul 2>&1
if exist "c:\work\iphey-*.png" copy /y "c:\work\iphey-*.png" %SHARE%\work\ >nul 2>&1
if exist "c:\work\shots" xcopy /y /e /i "c:\work\shots" "%SHARE%\work\shots" >nul 2>&1
REM ---- 2026-10-26 Win7 调试：回传客户端运行时日志（含 [BROWSER] launch error） ----
REM 客户端的 console.log/内部 logger 落盘在 %APPDATA%/%LOCALAPPDATA%\HuaYoung；分身内核
REM 启动失败的根因（沙箱/缺依赖）只在这里有迹，e2e 的 CDP 探活只能看到「离线」结果。
set "CLLOG=%SHARE%\work\client-logs"
if exist "%APPDATA%\HuaYoung" xcopy /y /e /i "%APPDATA%\HuaYoung" "%CLLOG%\appdata" >nul 2>&1
if exist "%LOCALAPPDATA%\HuaYoung" xcopy /y /e /i "%LOCALAPPDATA%\HuaYoung" "%CLLOG%\localappdata" >nul 2>&1
echo [%TIME%] 客户端日志回传: %CLLOG% >> %LLOG%
copy /y %LLOG% %SHARE%\start.log >nul 2>&1
echo [%TIME%] 回传完成: %SHARE%\work\ 内容: >> %LLOG%
dir /b %SHARE%\work\ 2>nul >> %LLOG%
copy /y %LLOG% %SHARE%\start.log >nul 2>&1

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
