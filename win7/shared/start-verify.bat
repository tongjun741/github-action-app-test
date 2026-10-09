@echo off
REM ============================================================
REM  Win7 Docker VM 内 autorun 入口（由 \\host.lan\Data\start.bat 调用）
REM  挂载点：win7/shared  ->  \\host.lan\Data
REM          win7/shared/work -> c:\work
REM  作用：安装花漾客户端 -> modifyMain 注入 CDP 9221 -> 启动客户端
REM        -> 用 puppeteer-core 连真实客户端 CDP 跑矩阵验证 -> 写 results + done.log
REM  说明：VM 内 node 为镜像预装的 c:\node\node（node18，最后支持 Win7 的版本）
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

REM ---- 定位客户端 exe（用通配避开中文路径硬编码） ----
set "HD=%ProgramFiles%\HuaYoung"
if not exist "%HD%" set "HD=C:\Program Files\HuaYoung"
set CLI=
for /f "delims=" %%i in ('dir /b "%HD%\*.exe" 2^>nul') do set "CLI=%HD%\%%i"

REM ---- 安装客户端（若未安装） ----
if not defined CLI (
  echo Installing HuaYoung client...
  installer.exe /S
  :WaitInstall
  for /f "delims=" %%i in ('dir /b "%HD%\*.exe" 2^>nul') do set "CLI=%HD%\%%i"
  if not defined CLI (
    timeout /t 10 >nul
    goto WaitInstall
  )
)
echo Client: %CLI%

REM ---- 给客户端 main.js 注入 remoteDebugPort=9221 + 假媒体开关 ----
c:\node\node c:\work\modifyMain.js

REM ---- 启动客户端并暴露 CDP 9221 ----
start "" "%CLI%" --remote-debugging-port=9221
echo Launched client, waiting for CDP 9221...

:WaitCDP
c:\node\node -e "require('http').get('http://127.0.0.1:9221/json/version',function(r){process.exit(0)}).on('error',function(){process.exit(1)})" >nul 2>&1
if errorlevel 1 (
  timeout /t 5 >nul
  goto WaitCDP
)
echo CDP 9221 is ready.

REM ---- 跑矩阵验证（puppeteer-core 引擎，连真实客户端 CDP） ----
c:\node\node c:\work\tests\runner.mjs --platforms "Windows 7" --engine puppeteer --cdp http://127.0.0.1:9221 --out c:\work\results-Windows_7.json > %SHARE%\start.log 2>&1

echo "verify-win7 done" >> %SHARE%\done.log
echo "done" >> %SHARE%\done.log
pause
